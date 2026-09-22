import type { DatabaseSync } from 'node:sqlite'
import { COMMON_GROUP_PAGE_SIZE, type CommonGroupCheckpoint, type CommonGroupRow, type CommonGroupStore } from './common-groups.js'

/** Uses the existing private SQLite database and transaction owner. */
export class CommonGroupDatabase implements CommonGroupStore {
  constructor(private readonly db: DatabaseSync, private readonly transaction: (work: () => void) => void) {
    db.exec(`CREATE TABLE IF NOT EXISTS common_group_sync (
      scope TEXT NOT NULL, peer TEXT NOT NULL, revision INTEGER NOT NULL,
      phase TEXT NOT NULL, after_uid TEXT NOT NULL, synced_at INTEGER NOT NULL,
      PRIMARY KEY(scope,peer));
      CREATE TABLE IF NOT EXISTS common_group_relation (
      scope TEXT NOT NULL, peer TEXT NOT NULL, group_uid TEXT NOT NULL,
      title TEXT NOT NULL, member_count INTEGER NOT NULL, avatar TEXT,
      PRIMARY KEY(scope,peer,group_uid),
      FOREIGN KEY(scope,peer) REFERENCES common_group_sync(scope,peer) ON DELETE CASCADE);`)
  }

  private rows(rows: unknown[]): CommonGroupRow[] {
    return (rows as Array<CommonGroupRow & { avatar: string | null }>).map(({ avatar, ...row }) => ({
      ...row, ...(avatar === null ? {} : { groupAvatar: JSON.parse(avatar) as NonNullable<CommonGroupRow['groupAvatar']> }),
    }))
  }

  get(scope: string, peer: string, uids: string[]): CommonGroupRow[] {
    if (uids.length > COMMON_GROUP_PAGE_SIZE) throw new Error('Invalid common group batch')
    if (!uids.length) return []
    return this.rows(this.db.prepare(`SELECT group_uid AS uid,title,member_count AS memberCount,avatar FROM common_group_relation
      WHERE scope=? AND peer=? AND group_uid IN (${uids.map(() => '?').join(',')})`).all(scope, peer, ...uids))
  }

  read(scope: string, peer: string, after = '') {
    const checkpoint = this.db.prepare(`SELECT revision, phase, after_uid AS after, synced_at AS syncedAtMillis
      FROM common_group_sync WHERE scope=? AND peer=?`).get(scope, peer) as unknown as CommonGroupCheckpoint | undefined
    const rows = this.db.prepare(`SELECT group_uid AS uid,title,member_count AS memberCount,avatar FROM common_group_relation
      WHERE scope=? AND peer=? AND group_uid>? ORDER BY group_uid LIMIT ?`).all(scope, peer, after, COMMON_GROUP_PAGE_SIZE + 1) as unknown as CommonGroupRow[]
    const total = Number(this.db.prepare('SELECT count(*) AS n FROM common_group_relation WHERE scope=? AND peer=?').get(scope, peer)?.n)
    return { items: this.rows(rows.slice(0, COMMON_GROUP_PAGE_SIZE)), total, hasMore: rows.length > COMMON_GROUP_PAGE_SIZE,
      checkpoint: checkpoint ?? { revision: 0, phase: 'check' as const, after: '', syncedAtMillis: 0 } }
  }

  apply(scope: string, peer: string, expected: CommonGroupCheckpoint, changes: {
    items: CommonGroupRow[]; removed: string[]; phase: CommonGroupCheckpoint['phase']; after: string
  }): boolean {
    if (changes.items.length > COMMON_GROUP_PAGE_SIZE || changes.removed.length > COMMON_GROUP_PAGE_SIZE
      || changes.items.some(row => !row.uid || row.uid.length > 128 || row.title.length > 4096 || !Number.isSafeInteger(row.memberCount) || row.memberCount < 0)
      || changes.removed.some(uid => !uid || uid.length > 128)
      || new Set([...changes.items.map(row => row.uid), ...changes.removed]).size !== changes.items.length + changes.removed.length
      || changes.items.some(row => row.groupAvatar && (row.groupAvatar.slots.length > 5 || JSON.stringify(row.groupAvatar).length > 16_384))) throw new Error('Invalid common group batch')
    let applied = false
    this.transaction(() => {
      const current = this.read(scope, peer).checkpoint
      if (current.revision !== expected.revision) return
      this.db.prepare(`INSERT INTO common_group_sync VALUES (?,?,?,?,?,?) ON CONFLICT(scope,peer) DO UPDATE SET
        revision=excluded.revision,phase=excluded.phase,after_uid=excluded.after_uid,synced_at=excluded.synced_at`)
        .run(scope, peer, current.revision + 1, changes.phase, changes.after, changes.phase === 'complete' ? Date.now() : current.syncedAtMillis)
      const upsert = this.db.prepare(`INSERT INTO common_group_relation VALUES (?,?,?,?,?,?) ON CONFLICT(scope,peer,group_uid)
        DO UPDATE SET title=excluded.title,member_count=excluded.member_count,avatar=excluded.avatar
        WHERE title IS NOT excluded.title OR member_count IS NOT excluded.member_count OR avatar IS NOT excluded.avatar`)
      for (const row of changes.items) upsert.run(scope, peer, row.uid, row.title, row.memberCount, row.groupAvatar ? JSON.stringify(row.groupAvatar) : null)
      const remove = this.db.prepare('DELETE FROM common_group_relation WHERE scope=? AND peer=? AND group_uid=?')
      for (const uid of changes.removed) remove.run(scope, peer, uid)
      // ponytail: quota scans at most 20,000 cached rows; use stored counters only if this becomes a measured hot path.
      // Exceeding the quota rolls back this batch without discarding prior relationships.
      const size = this.db.prepare('SELECT count(*) AS n,COALESCE(sum(length(CAST(title AS BLOB))+length(scope)+length(peer)+length(group_uid)+COALESCE(length(CAST(avatar AS BLOB)),0)+64),0) AS bytes FROM common_group_relation').get()!
      const peers = Number(this.db.prepare('SELECT count(*) AS n FROM common_group_sync').get()?.n)
      if (Number(size.n) > 20_000 || Number(size.bytes) > 16 * 1024 * 1024 || peers > 1000) throw new Error('共同群聊本地缓存容量已满')
      applied = true
    })
    return applied
  }
}
