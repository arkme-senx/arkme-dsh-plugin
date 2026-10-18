import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { readUnderlineSnapshot, type MessageUnderlineChange, type MessageUnderlineSnapshot } from './message-annotations.js'

/** Private client data. No cloud outbox: sharing requires a separate, explicit migration. */
export class LocalMessageMarkStore {
  constructor(private readonly db: DatabaseSync, private readonly transaction: (work: () => void) => void) {
    db.exec(`
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

  read(scope: string, target: string, viewerId: number, digest: string): MessageUnderlineSnapshot {
    const row = this.db.prepare('SELECT payload FROM local_message_marks WHERE scope=? AND target=?').get(scope, target) as { payload: string } | undefined
    if (!row) return { revision: 0, accessible: true, items: [] }
    try {
      const snapshot = readUnderlineSnapshot(JSON.parse(row.payload), viewerId)
      if (!snapshot.accessible || snapshot.items.some(item => !item.mine)) throw new Error('Invalid local owner')
      return { ...snapshot, items: snapshot.items.map(item => ({ ...item, state: item.anchor.sourceDigest === digest ? 'available' : 'stale' })) }
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
        const duplicate = items.some(item => item.anchor.sourceDigest === change.anchor.sourceDigest
          && item.anchor.start === change.anchor.start && item.anchor.end === change.anchor.end)
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
