import type { DatabaseSync, StatementSync } from 'node:sqlite'
import type { ArkmeMessageSyncProgress, ChatSyncCommand, ChatSyncLocalPage, ChatSyncPlan, ChatSyncSession, ChatSyncWork } from './chat-message-sync.js'
import type { ArkmeUnifiedTimelineEvent } from './unified-chat-timeline.js'

const MAX_WORK = 100_000
const MAX_SESSIONS = 10_000
type Row = Record<string, unknown>

/** Shares the timeline database and transaction boundary; runs only in its Worker. */
export class ChatMessageSyncStore {
  private readonly statements = new Map<string, StatementSync>()
  private prepare(sql: string): StatementSync {
    let statement = this.statements.get(sql)
    if (!statement) { statement = this.db.prepare(sql); this.statements.set(sql, statement) }
    return statement
  }
  constructor(private readonly db: DatabaseSync, private readonly reserve: () => number, private readonly enforceBudget: () => void) {
    db.exec(`CREATE TABLE IF NOT EXISTS message_sync_accounts (
      account TEXT PRIMARY KEY, epoch INTEGER NOT NULL, checkpoint TEXT NOT NULL DEFAULT '', cycle INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 0, discovering INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0, terminal INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0, dispatch_uid TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS message_sync_sessions (
      account TEXT NOT NULL, uid TEXT NOT NULL, scope TEXT NOT NULL UNIQUE, source_key TEXT NOT NULL, kind INTEGER NOT NULL,
      membership INTEGER NOT NULL, position TEXT NOT NULL, accessible INTEGER NOT NULL, PRIMARY KEY(account,uid));
      CREATE INDEX IF NOT EXISTS message_sync_source ON message_sync_sessions(source_key);
      CREATE TABLE IF NOT EXISTS message_sync_acks (account TEXT NOT NULL, source_key TEXT NOT NULL, through INTEGER NOT NULL, PRIMARY KEY(account,source_key));
      CREATE TABLE IF NOT EXISTS message_sync_work (
      account TEXT NOT NULL, uid TEXT NOT NULL, id TEXT NOT NULL, scope TEXT NOT NULL, event_id TEXT NOT NULL, item_key TEXT NOT NULL,
      revision INTEGER NOT NULL, version INTEGER NOT NULL, stored_revision INTEGER NOT NULL DEFAULT -1, stored_version INTEGER NOT NULL DEFAULT -1,
      state TEXT NOT NULL, sequence INTEGER NOT NULL DEFAULT 0, unread INTEGER NOT NULL DEFAULT 1,
      cycle INTEGER NOT NULL, counted INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0, pending INTEGER NOT NULL DEFAULT 1,
      attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(account,uid,id));
      CREATE INDEX IF NOT EXISTS message_sync_pending ON message_sync_work(account,retry_at,uid,sequence) WHERE pending=1;
      CREATE INDEX IF NOT EXISTS message_sync_fair ON message_sync_work(account,uid,retry_at,sequence) WHERE pending=1;
      CREATE INDEX IF NOT EXISTS message_sync_pin ON message_sync_work(scope,event_id);
      CREATE INDEX IF NOT EXISTS message_sync_local ON message_sync_work(scope,sequence DESC) WHERE pending=0 AND state='available';
      CREATE INDEX IF NOT EXISTS message_sync_item ON message_sync_work(scope,item_key);
      CREATE TRIGGER IF NOT EXISTS sync_account_added AFTER INSERT ON message_sync_accounts BEGIN UPDATE cache_stats SET bytes=bytes+length(CAST(NEW.checkpoint AS BLOB))+128 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS sync_account_changed AFTER UPDATE OF checkpoint ON message_sync_accounts BEGIN UPDATE cache_stats SET bytes=bytes+length(CAST(NEW.checkpoint AS BLOB))-length(CAST(OLD.checkpoint AS BLOB)) WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS sync_ack_added AFTER INSERT ON message_sync_acks BEGIN UPDATE cache_stats SET bytes=bytes+length(CAST(NEW.account||NEW.source_key AS BLOB))+64 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS sync_work_added AFTER INSERT ON message_sync_work BEGIN UPDATE cache_stats SET bytes=bytes+length(CAST(NEW.scope||NEW.id||NEW.event_id||NEW.item_key AS BLOB))+192 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS sync_work_removed AFTER DELETE ON message_sync_work BEGIN UPDATE cache_stats SET bytes=bytes-length(CAST(OLD.scope||OLD.id||OLD.event_id||OLD.item_key AS BLOB))-192 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS sync_session_added AFTER INSERT ON message_sync_sessions BEGIN UPDATE cache_stats SET bytes=bytes+length(CAST(NEW.scope||NEW.source_key||NEW.position AS BLOB))+128 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS sync_session_changed AFTER UPDATE OF position ON message_sync_sessions BEGIN UPDATE cache_stats SET bytes=bytes+length(CAST(NEW.position AS BLOB))-length(CAST(OLD.position AS BLOB)) WHERE id=1; END;`)
    this.initializeBudget()
  }
  private initializeBudget(): void {
    // O(1) admission checks. Bootstrap once for older stores, then maintain in
    // the same transactions as canonical contents and retention references.
    this.db.exec('CREATE TABLE IF NOT EXISTS message_sync_stats (id INTEGER PRIMARY KEY, metadata INTEGER NOT NULL, bodies INTEGER NOT NULL)')
    if (!this.prepare('SELECT id FROM message_sync_stats WHERE id=1').get()) this.db.exec(`INSERT INTO message_sync_stats SELECT 1,
        COALESCE((SELECT SUM(length(CAST(checkpoint AS BLOB))+128) FROM message_sync_accounts),0)+
        COALESCE((SELECT SUM(length(CAST(scope||id||event_id||item_key AS BLOB))+192) FROM message_sync_work),0)+
        COALESCE((SELECT SUM(length(CAST(scope||source_key||position AS BLOB))+128) FROM message_sync_sessions),0)+
        COALESCE((SELECT SUM(length(CAST(account||source_key AS BLOB))+64) FROM message_sync_acks),0),
        COALESCE((SELECT SUM(length(CAST(payload AS BLOB))) FROM contents c WHERE EXISTS(SELECT 1 FROM message_sync_work w WHERE w.scope=c.scope AND w.event_id=c.event_id)),0);`)
    this.db.exec(`CREATE TRIGGER IF NOT EXISTS sync_budget_account_added AFTER INSERT ON message_sync_accounts BEGIN UPDATE message_sync_stats SET metadata=metadata+length(CAST(NEW.checkpoint AS BLOB))+128 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS sync_budget_account_changed AFTER UPDATE OF checkpoint ON message_sync_accounts BEGIN UPDATE message_sync_stats SET metadata=metadata+length(CAST(NEW.checkpoint AS BLOB))-length(CAST(OLD.checkpoint AS BLOB)) WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS sync_budget_ack_added AFTER INSERT ON message_sync_acks BEGIN UPDATE message_sync_stats SET metadata=metadata+length(CAST(NEW.account||NEW.source_key AS BLOB))+64 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS sync_budget_session_added AFTER INSERT ON message_sync_sessions BEGIN UPDATE message_sync_stats SET metadata=metadata+length(CAST(NEW.scope||NEW.source_key||NEW.position AS BLOB))+128 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS sync_budget_session_changed AFTER UPDATE OF position ON message_sync_sessions BEGIN UPDATE message_sync_stats SET metadata=metadata+length(CAST(NEW.position AS BLOB))-length(CAST(OLD.position AS BLOB)) WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS sync_budget_work_added AFTER INSERT ON message_sync_work BEGIN
        UPDATE message_sync_stats SET metadata=metadata+length(CAST(NEW.scope||NEW.id||NEW.event_id||NEW.item_key AS BLOB))+192,
        bodies=bodies+CASE WHEN (SELECT COUNT(*) FROM message_sync_work WHERE scope=NEW.scope AND event_id=NEW.event_id)=1 THEN COALESCE((SELECT length(CAST(payload AS BLOB)) FROM contents WHERE scope=NEW.scope AND event_id=NEW.event_id),0) ELSE 0 END WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS sync_budget_work_removed AFTER DELETE ON message_sync_work BEGIN
        UPDATE message_sync_stats SET metadata=metadata-length(CAST(OLD.scope||OLD.id||OLD.event_id||OLD.item_key AS BLOB))-192,
        bodies=bodies-CASE WHEN NOT EXISTS(SELECT 1 FROM message_sync_work WHERE scope=OLD.scope AND event_id=OLD.event_id) THEN COALESCE((SELECT length(CAST(payload AS BLOB)) FROM contents WHERE scope=OLD.scope AND event_id=OLD.event_id),0) ELSE 0 END WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS sync_budget_body_added AFTER INSERT ON contents WHEN EXISTS(SELECT 1 FROM message_sync_work WHERE scope=NEW.scope AND event_id=NEW.event_id) BEGIN UPDATE message_sync_stats SET bodies=bodies+length(CAST(NEW.payload AS BLOB)) WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS sync_budget_body_changed AFTER UPDATE OF payload ON contents WHEN NEW.payload<>OLD.payload AND EXISTS(SELECT 1 FROM message_sync_work WHERE scope=NEW.scope AND event_id=NEW.event_id) BEGIN UPDATE message_sync_stats SET bodies=bodies+length(CAST(NEW.payload AS BLOB))-length(CAST(OLD.payload AS BLOB)) WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS sync_budget_body_removed AFTER DELETE ON contents WHEN EXISTS(SELECT 1 FROM message_sync_work WHERE scope=OLD.scope AND event_id=OLD.event_id) BEGIN UPDATE message_sync_stats SET bodies=bodies-length(CAST(OLD.payload AS BLOB)) WHERE id=1; END;`)
  }
  private get(account: string): Row {
    const row = this.prepare('SELECT * FROM message_sync_accounts WHERE account=?').get(account)
    if (!row) throw new Error('message-sync-account-missing')
    return row
  }
  private assert(account: string, epoch: number): Row {
    const row = this.get(account)
    if (row.epoch !== epoch) throw new Error('message-sync-stale')
    return row
  }
  private status(account: string): ChatSyncPlan {
    const row = this.get(account)
    const remaining = this.prepare('SELECT COUNT(*) AS pending,MIN(retry_at) AS retry FROM message_sync_work WHERE account=? AND pending=1').get(account)!
    const progress: ArkmeMessageSyncProgress = { accountKey: account, cycle: Number(row.cycle), revision: Number(row.revision),
      phase: row.discovering ? 'discovering' : remaining.pending ? 'syncing' : 'idle', total: Number(row.total), completed: Number(row.completed),
      terminal: Number(row.terminal), pending: Number(remaining.pending), ...(Number(remaining.retry) > 0 ? { retryAtMillis: Number(remaining.retry) } : {}) }
    return { progress, epoch: Number(row.epoch), checkpoint: String(row.checkpoint), active: row.active === 1 }
  }
  command(command: ChatSyncCommand): unknown {
    if (command.action === 'read') return this.read(command.scope, command.limit, command.anchorId, command.before)
    const { account } = command
    if (command.action === 'status') return this.status(account)
    if (command.action === 'ack') {
      if (!Number.isSafeInteger(command.through) || command.through < 0) return
      // Observe the existing server ACK; never create or advance one ourselves.
      this.prepare(`INSERT INTO message_sync_acks(account,source_key,through)
        SELECT ?,?,? WHERE (SELECT COUNT(*) FROM message_sync_acks)<? OR EXISTS(SELECT 1 FROM message_sync_acks WHERE account=? AND source_key=?)
        ON CONFLICT(account,source_key) DO UPDATE SET through=max(through,excluded.through)`)
        .run(account, command.sourceKey, command.through, MAX_SESSIONS, account, command.sourceKey)
      const session = this.prepare('SELECT scope,uid FROM message_sync_sessions WHERE account=? AND source_key=?').get(account, command.sourceKey)
      if (session) this.prepare('UPDATE message_sync_work SET unread=0 WHERE account=? AND uid=? AND sequence<=?').run(account, String(session.uid), command.through)
      return
    }
    if (command.action === 'pending') {
      this.assert(account, command.epoch)
      const cursor = String(this.get(account).dispatch_uid)
      const select = this.prepare(`SELECT DISTINCT uid FROM message_sync_work WHERE account=? AND pending=1 AND uid>? AND retry_at<=? ORDER BY uid LIMIT ?`)
      let sessions = select.all(account, cursor, command.now, 50)
      if (sessions.length < 50) sessions = sessions.concat(this.prepare(`SELECT DISTINCT uid FROM message_sync_work WHERE account=? AND pending=1 AND uid<=? AND retry_at<=? ORDER BY uid LIMIT ?`).all(account, cursor, command.now, 50 - sessions.length))
      const rows: Row[] = [], quota = Math.max(1, Math.floor(Math.min(400, command.limit) / Math.max(1, sessions.length)))
      const pending = this.prepare(`SELECT w.*,s.kind,s.membership FROM message_sync_work w JOIN message_sync_sessions s ON s.account=w.account AND s.uid=w.uid
        WHERE w.account=? AND w.uid=? AND w.pending=1 AND w.retry_at<=? AND s.accessible=1 ORDER BY w.sequence LIMIT ?`)
      for (const session of sessions) rows.push(...pending.all(account, String(session.uid), command.now, quota))
      if (sessions.length) this.prepare('UPDATE message_sync_accounts SET dispatch_uid=? WHERE account=?').run(String(sessions.at(-1)!.uid), account)
      const bySession = new Map<string, { uid: string; kind: number; membership: number; work: ChatSyncWork[] }>()
      for (const r of rows) {
        const uid = String(r.uid), entry = bySession.get(uid) ?? { uid, kind: Number(r.kind), membership: Number(r.membership), work: [] }
        entry.work.push({ id: String(r.id), revision: Number(r.revision), version: Number(r.version), state: r.state as ChatSyncWork['state'], sequence: Number(r.sequence), unread: r.unread === 1 })
        bySession.set(uid, entry)
      }
      return [...bySession.values()]
    }
    if (command.action === 'ranges') {
      this.assert(account, command.epoch)
      const rows = this.prepare('SELECT uid,position FROM message_sync_sessions WHERE account=? AND accessible=1 ORDER BY uid LIMIT 10000').all(account)
      const resume: Record<string, unknown> = {}, cached: Record<string, Array<{ from: number; to: number }>> = {}
      for (const row of rows) {
        const p = JSON.parse(String(row.position))
        if (p.initialized === true) resume[String(row.uid)] = { cursor: p.cursor, membership_version: p.membership_version }
      }
      // One indexed streaming scan, not one query per conversation.
      const seqs = this.prepare(`SELECT w.uid,w.sequence FROM message_sync_work w
        JOIN contents c ON c.scope=w.scope AND c.event_id=w.event_id
        JOIN message_sync_sessions s ON s.account=w.account AND s.uid=w.uid
        WHERE w.account=? AND s.accessible=1 AND w.pending=0 AND w.state='available' AND w.sequence>0 ORDER BY w.uid,w.sequence`)
      let count = 0
      for (const row of seqs.iterate(account)) {
        const uid = String(row.uid), seq = Number(row.sequence), ranges = cached[uid] ??= [], last = ranges.at(-1)
        if (last && seq <= last.to + 1) last.to = Math.max(last.to, seq)
        else { if (++count > 10000) throw new Error('message-sync-capacity'); ranges.push({ from: seq, to: seq }) }
      }
      return { resume, cached }
    }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (command.action === 'begin') {
        const epoch = this.reserve()
        this.prepare('INSERT OR IGNORE INTO message_sync_accounts(account,epoch) VALUES (?,?)').run(account, epoch)
        const row = this.get(account)
        this.prepare('UPDATE message_sync_accounts SET epoch=? WHERE account=?').run(epoch, account)
        if (!row.active) {
          // Completed read bodies have window-owned retention; retain unread pins.
          const released = this.prepare('DELETE FROM message_sync_work WHERE account=? AND pending=0 AND unread=0').run(account)
          if (Number(released.changes)) this.prepare('DELETE FROM contents WHERE refs=0 AND NOT EXISTS (SELECT 1 FROM message_sync_work w WHERE w.scope=contents.scope AND w.event_id=contents.event_id)').run()
          // Only unfinished work carries into the new cohort. Rewriting every
          // retained unread row on each realtime hint turns an empty check into
          // a database-size write; settled rows are recognized by stored versions.
          this.prepare('UPDATE message_sync_work SET counted=1,done=0,cycle=? WHERE account=? AND pending=1').run(Number(row.cycle) + 1, account)
          this.prepare('UPDATE message_sync_accounts SET active=1,discovering=1,cycle=cycle+1,total=0,completed=0,terminal=0 WHERE account=?').run(account)
        }
      } else {
        const row = this.assert(account, command.epoch)
        if (command.action === 'manifest' || command.action === 'commit') {
          if (row.checkpoint !== command.expectedCheckpoint || (command.action === 'manifest') !== command.page.manifest) throw new Error('message-sync-checkpoint-stale')
          for (const session of command.page.sessions) this.applySession(command, session, row)
          if (command.action === 'manifest') this.prepare('UPDATE message_sync_accounts SET checkpoint=? WHERE account=?').run(command.page.checkpoint, account)
        } else if (command.action === 'freeze') {
          const counts = this.prepare('SELECT COALESCE(SUM(counted),0) AS total,COALESCE(SUM(counted*done),0) AS completed,COALESCE(SUM(CASE WHEN state IN (\'removed\',\'restricted\') THEN counted*done ELSE 0 END),0) AS terminal FROM message_sync_work WHERE account=? AND cycle=?').get(account, Number(row.cycle))!
          this.prepare('UPDATE message_sync_accounts SET discovering=0,total=?,completed=?,terminal=? WHERE account=?').run(Number(counts.total), Number(counts.completed), Number(counts.terminal), account)
        } else if (command.action === 'finish') {
          if (row.discovering || this.status(account).progress.pending) throw new Error('message-sync-incomplete')
          this.prepare('UPDATE message_sync_accounts SET active=0 WHERE account=?').run(account)
        }
      }
      this.prepare('UPDATE message_sync_accounts SET revision=? WHERE account=?').run(this.reserve(), account)
      this.enforceBudget()
      const result = this.status(account)
      this.db.exec('COMMIT')
      return result
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  private applySession(command: Extract<ChatSyncCommand, { action: 'manifest' | 'commit' }>, session: ChatSyncSession, accountRow: Row): void {
    const { account, ticket, now } = command
    const scope = session.scope!, sourceKey = session.sourceKey!
    if (!scope || !sourceKey) throw new Error('message-sync-scope-missing')
    const oldSession = this.prepare('SELECT * FROM message_sync_sessions WHERE account=? AND uid=?').get(account, session.uid)
    const readThrough = Number(this.prepare('SELECT through FROM message_sync_acks WHERE account=? AND source_key=?').get(account, sourceKey)?.through ?? 0)
    const fence = Math.max(Number(this.prepare('SELECT fence FROM scopes WHERE scope=?').get(scope)?.fence ?? 0),
      Number(this.prepare('SELECT fence FROM cache_recovery WHERE id=1').get()!.fence))
    if (ticket < fence) throw new Error('message-sync-stale')
    if (command.action === 'commit' && !oldSession) throw new Error('message-sync-membership-changed')
    if (command.action === 'commit' && oldSession?.membership !== session.membership) session = { ...session, accessible: false, work: [] }
    if (oldSession && (oldSession.membership !== session.membership || !session.accessible)) {
      this.prepare('DELETE FROM entries WHERE scope=?').run(scope)
      this.prepare('DELETE FROM contents WHERE scope=?').run(scope)
      this.prepare('INSERT OR REPLACE INTO scopes VALUES (?,?)').run(scope, ticket)
      this.prepare('UPDATE message_sync_work SET stored_revision=-1,stored_version=-1,pending=1 WHERE account=? AND uid=?').run(account, session.uid)
    }
    if (command.action === 'manifest') {
      this.prepare(`INSERT INTO message_sync_sessions VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(account,uid) DO UPDATE SET
        kind=excluded.kind,membership=excluded.membership,position=excluded.position,accessible=excluded.accessible`).run(account, session.uid, scope, sourceKey, session.kind, session.membership, JSON.stringify(session.position), session.accessible ? 1 : 0)
    }
    if (!session.accessible) {
      this.prepare('UPDATE message_sync_sessions SET accessible=0 WHERE account=? AND uid=?').run(account, session.uid)
      const unsettled = this.prepare('SELECT COUNT(*) AS n FROM message_sync_work WHERE account=? AND uid=? AND counted=1 AND done=0 AND cycle=?').get(account, session.uid, Number(accountRow.cycle))!
      this.prepare("UPDATE message_sync_work SET pending=0,state='restricted',stored_revision=revision,stored_version=version,done=counted WHERE account=? AND uid=?").run(account, session.uid)
      if (!accountRow.discovering) this.prepare('UPDATE message_sync_accounts SET completed=completed+?,terminal=terminal+? WHERE account=?').run(Number(unsettled.n), Number(unsettled.n), account)
      return
    }
    for (let work of session.work) {
      const old = this.prepare('SELECT * FROM message_sync_work WHERE account=? AND uid=? AND id=?').get(account, session.uid, work.id)
      const terminal = work.state === 'removed' || work.state === 'restricted'
      const eventId = work.eventId!, itemKey = work.itemKey!
      if (!eventId || !itemKey) throw new Error('message-sync-identity-missing')
      const exists = this.prepare("SELECT version,ticket,json_extract(payload,'$.contentStatus') AS content_status FROM contents WHERE scope=? AND event_id=?").get(scope, eventId)
      const unread = (command.action === 'commit' && old ? old.unread === 1 : work.unread) && work.sequence > readThrough
      if (!unread && !old && !exists) continue
      if (old && (Number(old.revision) > work.revision || Number(old.version) > work.version)) work = { ...work, revision: Math.max(Number(old.revision), work.revision), version: Math.max(Number(old.version), work.version), state: terminal ? work.state : 'pending' }
      const already = old && old.stored_revision === work.revision && Number(old.stored_version) >= work.version && exists !== undefined && old.pending === 0
      const counted = old !== undefined && old.cycle === accountRow.cycle && old.counted === 1 || command.action === 'manifest' && accountRow.discovering === 1 && !terminal && !already ? 1 : 0
      const done = old !== undefined && old.cycle === accountRow.cycle && old.done === 1 ? 1 : 0
      let committed = terminal || already === true
      if (command.action === 'commit' && work.state === 'available') {
        if (!work.event || work.event.kind !== 'message' || work.event.eventId !== eventId || (work.event.item.recordVersion ?? work.event.item.version ?? 0) < work.version) throw new Error('message-sync-body-incomplete')
        // A later foreground request can still contain an older server version.
        // If its ticket blocks this write, retry instead of acknowledging a body
        // version that was never committed to canonical contents.
        if (exists && Number(exists.ticket) > ticket && (exists.content_status !== 'available' || Number(exists.version) < work.version)) throw new Error('message-sync-stale')
        if (!exists || Number(exists.ticket) <= ticket && Number(exists.version) <= work.version) this.prepare(`INSERT INTO contents(scope,event_id,source,payload,version,ticket) VALUES (?,?,'messages',?,?,?) ON CONFLICT(scope,event_id) DO UPDATE SET
          payload=excluded.payload,version=excluded.version,ticket=excluded.ticket`).run(scope, eventId, JSON.stringify(work.event), work.version, ticket)
        committed = true
      } else if (terminal) {
        if (exists && Number(exists.ticket) > ticket) throw new Error('message-sync-stale')
        this.prepare('DELETE FROM entries WHERE scope=? AND event_id=?').run(scope, eventId)
        this.prepare('DELETE FROM contents WHERE scope=? AND event_id=?').run(scope, eventId)
        this.prepare('INSERT OR REPLACE INTO scopes VALUES (?,?)').run(scope, ticket)
      }
      const attempts = committed || command.action === 'manifest' ? Number(old?.attempts ?? 0) : Math.min(6, Number(old?.attempts ?? 0) + 1)
      const retry = committed ? 0 : command.action === 'commit' ? now + 1000 * 2 ** attempts
        : old && old.revision === work.revision && old.version === work.version ? Number(old.retry_at) : 0
      this.prepare(`INSERT INTO message_sync_work(account,uid,id,scope,event_id,item_key,revision,version,stored_revision,stored_version,state,sequence,unread,cycle,counted,done,pending,attempts,retry_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account,uid,id) DO UPDATE SET revision=excluded.revision,version=excluded.version,stored_revision=excluded.stored_revision,
        stored_version=excluded.stored_version,state=excluded.state,sequence=max(sequence,excluded.sequence),unread=excluded.unread,cycle=excluded.cycle,counted=excluded.counted,
        done=excluded.done,pending=excluded.pending,attempts=excluded.attempts,retry_at=excluded.retry_at`).run(account, session.uid, work.id, scope, eventId, itemKey,
        work.revision, work.version, committed ? work.revision : Number(old?.stored_revision ?? -1), committed ? work.version : Number(old?.stored_version ?? -1), work.state, work.sequence, unread ? 1 : 0,
        Number(accountRow.cycle), counted, committed && counted ? 1 : done, committed ? 0 : 1, attempts, retry)
      if (committed && counted && !done && !accountRow.discovering) this.prepare('UPDATE message_sync_accounts SET completed=completed+1,terminal=terminal+? WHERE account=?').run(terminal ? 1 : 0, account)
    }
    if (Number(this.prepare('SELECT COUNT(*) AS n FROM message_sync_work').get()!.n) > MAX_WORK || Number(this.prepare('SELECT COUNT(*) AS n FROM message_sync_sessions').get()!.n) > MAX_SESSIONS) throw new Error('message-sync-capacity')
  }
  retire(scope: string, eventId?: string): void {
    this.prepare(`UPDATE message_sync_work SET pending=1,stored_revision=-1,retry_at=0 WHERE scope=?${eventId ? ' AND event_id=?' : ''}`).run(...(eventId ? [scope, eventId] : [scope]))
    this.prepare(`DELETE FROM contents WHERE scope=? AND source='messages'${eventId ? ' AND event_id=?' : ''}`).run(...(eventId ? [scope, eventId] : [scope]))
  }
  invalidate(scope: string, itemKey?: string): void {
    this.prepare(`UPDATE message_sync_work SET pending=1,stored_revision=-1,retry_at=0 WHERE scope=?${itemKey ? ' AND item_key=?' : ''}`).run(...(itemKey ? [scope, itemKey] : [scope]))
  }
  private read(scope: string, limit: number, anchorId?: string, before?: number): ChatSyncLocalPage | undefined {
    limit = Math.max(1, Math.min(100, limit))
    const session = this.prepare('SELECT accessible FROM message_sync_sessions WHERE scope=?').get(scope)
    if (!session?.accessible) return undefined
    let anchor: Row | undefined
    if (anchorId) {
      // Separate identity lookups keep each existing key indexed. A mixed OR
      // with JSON extraction otherwise scans every retained body in the chat.
      // CROSS JOIN keeps the selective record lookup ahead of the retention join.
      anchor = this.prepare(`SELECT w.sequence FROM message_sync_work w JOIN contents c ON c.scope=w.scope AND c.event_id=w.event_id
        WHERE w.scope=? AND w.event_id=? AND w.pending=0 AND w.state='available' LIMIT 1`).get(scope, anchorId)
        ?? this.prepare(`SELECT w.sequence FROM message_sync_work w JOIN contents c ON c.scope=w.scope AND c.event_id=w.event_id
          WHERE w.scope=? AND w.item_key=? AND w.pending=0 AND w.state='available' LIMIT 1`).get(scope, anchorId)
        ?? this.prepare(`SELECT w.sequence FROM contents c CROSS JOIN message_sync_work w ON w.scope=c.scope AND w.event_id=c.event_id
          WHERE c.scope=? AND c.source='messages' AND json_extract(c.payload,'$.item.itemUid')=? AND w.pending=0 AND w.state='available' LIMIT 1`).get(scope, anchorId)
      if (!anchor) return undefined
    }
    const upper = before ?? (anchor ? Number(anchor.sequence) + Math.floor(limit / 2) + 1 : Number.MAX_SAFE_INTEGER)
    const rows = this.prepare(`SELECT c.payload,w.sequence,c.ticket FROM message_sync_work w JOIN contents c ON c.scope=w.scope AND c.event_id=w.event_id
      WHERE w.scope=? AND w.pending=0 AND w.state='available' AND w.sequence<? ORDER BY w.sequence DESC LIMIT ?`).all(scope, upper, limit + 1)
    if (!rows.length) return undefined
    const selected: Row[] = []; let bytes = 0
    for (const row of rows.slice(0, limit)) {
      bytes += Buffer.byteLength(String(row.payload))
      if (bytes > 3 * 1024 * 1024) break
      selected.push(row)
    }
    if (!selected.length) throw new Error('message-sync-capacity')
    if (anchor && !selected.some(row => row.sequence === anchor!.sequence)) return undefined
    selected.reverse()
    const events = selected.map(row => JSON.parse(String(row.payload)) as ArkmeUnifiedTimelineEvent).filter(event => event.contentStatus === 'available')
    return { events, revision: Math.max(...selected.map(row => Number(row.ticket))), ...(rows.length > selected.length ? { before: Number(selected[0]!.sequence) } : {}) }
  }
}
