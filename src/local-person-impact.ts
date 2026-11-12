import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

type Counts = { recordingCount: number; chatCount: number }
/** Disposable preview bookkeeping: stores only opaque digests, never record text or identity facts. */
export class LocalPersonImpactStore {
  constructor(private readonly db: DatabaseSync, private readonly transaction: (work: () => void) => void) {
    db.exec(`CREATE TABLE IF NOT EXISTS person_impact_keys (
      scope TEXT NOT NULL, command TEXT NOT NULL, key TEXT NOT NULL, expires_at INTEGER NOT NULL,
      PRIMARY KEY(scope,command,key));
      CREATE TABLE IF NOT EXISTS person_impact_pages (
      scope TEXT NOT NULL, command TEXT NOT NULL, step INTEGER NOT NULL, digest TEXT NOT NULL,
      recording_count INTEGER NOT NULL, chat_count INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      PRIMARY KEY(scope,command,step));
      CREATE INDEX IF NOT EXISTS person_impact_keys_expiry ON person_impact_keys(expires_at);
      CREATE INDEX IF NOT EXISTS person_impact_pages_expiry ON person_impact_pages(expires_at);`)
  }
  append(scope: string, command: string, step: number, previous: Counts, keys: readonly string[], audio: boolean, expires: number): Counts {
    if (!/^[a-z_-]+:[1-9][0-9]*$/u.test(scope) || !/^[a-f0-9]{64}$/u.test(command) || !Number.isSafeInteger(step) || step < 1
      || !Number.isSafeInteger(expires) || expires <= Date.now() || keys.length > 100 || keys.some(key => !/^[A-Za-z0-9_-]{43}$/u.test(key))) throw new Error('人物影响核对已失效，请重新预览')
    const unique = [...new Set(keys)].sort()
    const digest = createHash('sha256').update(JSON.stringify([previous, unique, audio])).digest('hex')
    let result!: Counts
    this.transaction(() => {
      this.db.prepare('DELETE FROM person_impact_keys WHERE expires_at<=?').run(Date.now())
      this.db.prepare('DELETE FROM person_impact_pages WHERE expires_at<=?').run(Date.now())
      const saved = this.db.prepare('SELECT digest,recording_count,chat_count FROM person_impact_pages WHERE scope=? AND command=? AND step=?').get(scope, command, step) as { digest: string; recording_count: number; chat_count: number } | undefined
      if (saved) {
        if (saved.digest !== digest) throw new Error('人物来源已变化，请重新预览')
        result = { recordingCount: saved.recording_count, chatCount: saved.chat_count }; return
      }
      const last = this.db.prepare('SELECT step,recording_count,chat_count FROM person_impact_pages WHERE scope=? AND command=? ORDER BY step DESC LIMIT 1').get(scope, command) as { step: number; recording_count: number; chat_count: number } | undefined
      if (step !== (last?.step ?? 0) + 1 || previous.recordingCount !== (last?.recording_count ?? 0) || previous.chatCount !== (last?.chat_count ?? 0)) throw new Error('人物影响进度已失效，请重新预览')
      let added = 0
      const insert = this.db.prepare('INSERT OR IGNORE INTO person_impact_keys(scope,command,key,expires_at) VALUES(?,?,?,?)')
      for (const key of unique) added += Number(insert.run(scope, command, key, expires).changes)
      result = { recordingCount: previous.recordingCount + (audio ? added : 0), chatCount: previous.chatCount + (audio ? 0 : added) }
      this.db.prepare('INSERT INTO person_impact_pages(scope,command,step,digest,recording_count,chat_count,expires_at) VALUES(?,?,?,?,?,?,?)')
        .run(scope, command, step, digest, result.recordingCount, result.chatCount, expires)
    })
    return result
  }
}
