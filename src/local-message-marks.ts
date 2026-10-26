import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { readUnderlineSnapshot, type MessageUnderlineChange, type MessageUnderlineSnapshot } from './message-annotations.js'

/** Legacy local marks stay private; cloud cache and durable intents use separate account scopes. */
export class LocalMessageMarkStore {
  constructor(private readonly db: DatabaseSync, private readonly transaction: (work: () => void) => void) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS native_annotation_cache (
        scope TEXT NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(scope,key)
      );
      CREATE TABLE IF NOT EXISTS native_annotation_outbox (
        scope TEXT NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY(scope,key)
      );
      CREATE TABLE IF NOT EXISTS local_message_marks (
        scope TEXT NOT NULL, target TEXT NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(scope, target)
      );
      CREATE TABLE IF NOT EXISTS local_message_mark_operations (
        scope TEXT NOT NULL, target TEXT NOT NULL, operation_id TEXT NOT NULL, request_hash TEXT NOT NULL,
        PRIMARY KEY(scope, target, operation_id)
      );
    `)
  }

  readCloudCache<T>(scope: string, key: string): T | undefined {
    const row = this.db.prepare('SELECT payload FROM native_annotation_cache WHERE scope=? AND key=?').get(scope, key) as { payload: string } | undefined
    return row ? JSON.parse(row.payload) as T : undefined
  }
  writeCloudCache(scope: string, key: string, value: unknown) {
    const payload = JSON.stringify(value)
    if (Buffer.byteLength(payload) > 1024 * 1024) return
    this.transaction(() => {
      this.db.prepare('INSERT INTO native_annotation_cache(scope,key,payload,updated_at) VALUES(?,?,?,?) ON CONFLICT(scope,key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').run(scope, key, payload, Date.now())
      const rows = this.db.prepare('SELECT key,length(CAST(payload AS BLOB)) AS bytes FROM native_annotation_cache WHERE scope=? ORDER BY updated_at DESC,rowid DESC LIMIT 1001').all(scope) as { key: string; bytes: number }[]
      let bytes = 0
      for (let index = 0; index < rows.length; index++) {
        bytes += rows[index]!.bytes
        if (index >= 500 || bytes > 8 * 1024 * 1024) this.db.prepare('DELETE FROM native_annotation_cache WHERE scope=? AND key=?').run(scope, rows[index]!.key)
      }
    })
  }
  stageCloudOperation(scope: string, key: string, value: { path: string; body: Record<string, unknown> }) {
    const payload = JSON.stringify(value)
    this.transaction(() => {
      const old = this.db.prepare('SELECT payload FROM native_annotation_outbox WHERE scope=? AND key=?').get(scope, key) as { payload: string } | undefined
      if (old) { if (old.payload !== payload) throw new Error('同步操作已变化，请重新选择'); return }
      const size = this.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(length(CAST(payload AS BLOB))),0) AS bytes FROM native_annotation_outbox WHERE scope=?').get(scope) as { n: number; bytes: number }
      if (size.n >= 200 || size.bytes + Buffer.byteLength(payload) > 2 * 1024 * 1024) throw new Error('待同步标记已达上限，请联网同步后重试')
      this.db.prepare('INSERT INTO native_annotation_outbox(scope,key,payload,created_at) VALUES(?,?,?,?)').run(scope, key, payload, Date.now())
    })
  }
  cloudOperations(scope: string) {
    const rows = this.db.prepare('SELECT key,payload,created_at FROM native_annotation_outbox WHERE scope=? ORDER BY created_at,rowid LIMIT 200').all(scope) as { key: string; payload: string; created_at: number }[]
    return rows.map(row => ({ key: row.key, value: JSON.parse(row.payload) as { path: string; body: Record<string, unknown> }, createdAt: row.created_at }))
  }
  completeCloudOperation(scope: string, key: string) { this.db.prepare('DELETE FROM native_annotation_outbox WHERE scope=? AND key=?').run(scope, key) }

  private codexLegacyFilter(){return `scope>=? AND scope<? AND target IN (SELECT value FROM json_each(?))
      AND CASE WHEN json_valid(json_extract(scope,'$[3]')) THEN json_extract(json_extract(scope,'$[3]'),'$[2]') END IN (SELECT value FROM json_each(?))`}
  codexLegacyAcknowledged(prefix:string,tasks:readonly string[],messages:readonly string[],target:string):number {
    const row=this.db.prepare(`SELECT COALESCE(SUM(json_extract(payload,'$.codex_migration.next')),0) n FROM local_message_marks
      WHERE ${this.codexLegacyFilter()} AND json_extract(payload,'$.codex_migration.target')=?`)
      .get(prefix,prefix+'~',JSON.stringify(messages),JSON.stringify(tasks),target)
    return Number(row?.n??0)
  }
  *codexLegacyRows(prefix:string,tasks:readonly string[],messages:readonly string[]):IterableIterator<{scope:string;target:string;payload:string}> {
    // Keyset one row at a time: never hold an active SQLite reader across an HTTP await.
    let after:[string,string]=['','']
    const statement=this.db.prepare(`SELECT scope,target,payload FROM local_message_marks WHERE ${this.codexLegacyFilter()} AND (scope,target)>(?,?) ORDER BY scope,target LIMIT 1`)
    for(;;){
      const row=statement.get(prefix,prefix+'~',JSON.stringify(messages),JSON.stringify(tasks),...after) as {scope:string;target:string;payload:string}|undefined
      if(!row)return
      after=[row.scope,row.target];yield row
    }
  }
  legacyRows(prefix:string,after:readonly[string,string],limit=4){
    return this.db.prepare(`SELECT scope,target,payload FROM local_message_marks WHERE scope>=? AND scope<? AND (scope,target)>(?,?)
      AND COALESCE(json_extract(payload,'$.codex_migration.status'),'pending')='pending' AND json_array_length(payload,'$.annotations')>0 ORDER BY scope,target LIMIT ?`)
      .all(prefix,prefix+'~',...after,limit) as unknown as {scope:string;target:string;payload:string}[]
  }
  updateLocalPayload(scope:string,target:string,before:string,payload:unknown):boolean {
    const result=this.db.prepare('UPDATE local_message_marks SET payload=? WHERE scope=? AND target=? AND payload=?').run(JSON.stringify(payload),scope,target,before)
    return Number(result.changes)===1
  }

  read(scope: string, target: string, viewerId: number, digest: string): MessageUnderlineSnapshot {
    const row = this.db.prepare('SELECT payload FROM local_message_marks WHERE scope=? AND target=?').get(scope, target) as { payload: string } | undefined
    if (!row) return { revision: 0, accessible: true, items: [] }
    try {
      const snapshot = readUnderlineSnapshot(JSON.parse(row.payload), viewerId)
      if (!snapshot.accessible || snapshot.items.some(item => !item.mine)) throw new Error('Invalid local owner')
      return { ...snapshot, items: snapshot.items.map(item => ({ ...item, state: item.anchor!.sourceDigest === digest ? 'available' : 'stale' })) }
    } catch {
      // Never replace unreadable local data with an empty snapshot.
      throw new Error('本机标记数据读取失败，原数据已保留，请重试')
    }
  }

  change(scope: string, target: string, viewerId: number, digest: string, change: MessageUnderlineChange): MessageUnderlineSnapshot {
    const requestHash = createHash('sha256').update(JSON.stringify(change)).digest('hex')
    let result!: MessageUnderlineSnapshot
    this.transaction(() => {
      const receipt = this.db.prepare('SELECT request_hash FROM local_message_mark_operations WHERE scope=? AND target=? AND operation_id=?')
        .get(scope, target, change.operationId) as { request_hash: string } | undefined
      const before = this.read(scope, target, viewerId, digest)
      if (receipt) {
        if (receipt.request_hash !== requestHash) throw new Error('标记操作已变化，请重新选择')
        // A retry after a later removal must not resurrect the old mark.
        result = before
        return
      }
      let items = before.items
      if (change.kind === 'add') {
        const duplicate = items.some(item => item.anchor!.sourceDigest === change.anchor.sourceDigest
          && item.anchor!.start === change.anchor.start && item.anchor!.end === change.anchor.end)
        if (!duplicate) {
          if (items.length >= 500) throw new Error('这条消息的本机标记已达上限，请先取消不需要的标记')
          items = [...items, { id: `local:${randomUUID()}`, actorId: viewerId, actorName: '你', mine: true, anchor: change.anchor, state: 'available' }]
        }
      } else {
        items = items.filter(item => item.id !== change.annotationId)
      }
      result = { revision: before.revision + 1, accessible: true, items }
      const payload = { complete: true, accessible: true, revision: result.revision,
        annotations: items.map(item => ({ annotation_uid: item.id, actor_user_id: viewerId, actor_name: '你', anchor: item.anchor, state: 'available' })) }
      this.db.prepare('INSERT INTO local_message_marks(scope,target,payload) VALUES(?,?,?) ON CONFLICT(scope,target) DO UPDATE SET payload=excluded.payload')
        .run(scope, target, JSON.stringify(payload))
      this.db.prepare('INSERT INTO local_message_mark_operations(scope,target,operation_id,request_hash) VALUES(?,?,?,?)')
        .run(scope, target, change.operationId, requestHash)
    })
    return result
  }
}
