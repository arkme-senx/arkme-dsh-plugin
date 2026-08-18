import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { JotmoStateStore } from './state-store.js'
import type {
  JotmoCachedSnapshot,
  JotmoCachedQueryResult,
  JotmoPendingWrite,
  JotmoRecordCursor,
  JotmoSelfRecordItem,
  JotmoSelfRecordList,
  JotmoSelfSummary,
  JotmoUserProfile,
  JotmoUserProfileSnapshot,
} from './types.js'

type CacheState = 'synced' | 'pending' | 'failed'

interface RecordRow {
  record_uid: string
  send_at_millis: number
  title: string
  text_content: string
  template_kind: number
  status: number
  version: number
  sync_state: CacheState
  attempts: number
  last_error: string | null
  created_at_millis: number
}

interface MetaRow {
  record_count: number
  words_count: number
  total_sec: number
  has_more: number
  next_cursor_send_at: number | null
  next_cursor_record_uid: string | null
  refreshed_at_millis: number
  pagination_initialized?: number
  revision: number
}

interface ProfileRow {
  user_id: number
  display_name: string
  nickname: string
  avatar_ref: string
  avatar_url: string | null
  jotmo_id: string
  account_type: number
  created_at: number
  bind_apple: number
  bind_wechat: number
  bind_google: number
  phone_masked: string | null
  email_masked: string | null
  updated_at_millis: number
}

export class JotmoLocalDatabase {
  private readonly path: string
  private readonly database: DatabaseSync
  private readonly migrations = new Map<number, Promise<void>>()

  constructor(directory: string, private readonly legacy: JotmoStateStore) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    chmodSync(directory, 0o700)
    this.path = join(directory, 'records.sqlite3')
    this.database = new DatabaseSync(this.path)
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS record_cache (
        user_id INTEGER NOT NULL,
        record_uid TEXT NOT NULL,
        send_at_millis INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        text_content TEXT NOT NULL DEFAULT '',
        template_kind INTEGER NOT NULL DEFAULT 0,
        status INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 0,
        sync_state TEXT NOT NULL CHECK (sync_state IN ('synced', 'pending', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at_millis INTEGER NOT NULL,
        updated_at_millis INTEGER NOT NULL,
        PRIMARY KEY (user_id, record_uid)
      );
      CREATE INDEX IF NOT EXISTS record_cache_user_send
        ON record_cache (user_id, send_at_millis DESC, record_uid DESC);
      CREATE TABLE IF NOT EXISTS cache_meta (
        user_id INTEGER PRIMARY KEY,
        record_count INTEGER NOT NULL DEFAULT 0,
        words_count INTEGER NOT NULL DEFAULT 0,
        total_sec INTEGER NOT NULL DEFAULT 0,
        has_more INTEGER NOT NULL DEFAULT 0,
        next_cursor_send_at INTEGER,
        next_cursor_record_uid TEXT,
        pagination_initialized INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL DEFAULT 0,
        refreshed_at_millis INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS user_profile_cache (
        user_id INTEGER PRIMARY KEY,
        display_name TEXT NOT NULL,
        nickname TEXT NOT NULL,
        avatar_ref TEXT NOT NULL,
        avatar_url TEXT,
        jotmo_id TEXT NOT NULL,
        account_type INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        bind_apple INTEGER NOT NULL,
        bind_wechat INTEGER NOT NULL,
        bind_google INTEGER NOT NULL,
        phone_masked TEXT,
        email_masked TEXT,
        updated_at_millis INTEGER NOT NULL
      );
    `)
    const metaColumns = this.database.prepare('PRAGMA table_info(cache_meta)').all() as unknown as Array<{ name: string }>
    if (!metaColumns.some(column => column.name === 'pagination_initialized')) {
      this.database.exec('ALTER TABLE cache_meta ADD COLUMN pagination_initialized INTEGER NOT NULL DEFAULT 0')
    }
    if (!metaColumns.some(column => column.name === 'revision')) {
      this.database.exec('ALTER TABLE cache_meta ADD COLUMN revision INTEGER NOT NULL DEFAULT 0')
    }
    this.secureDatabaseFiles()
  }

  async uniqueCode(): Promise<string> {
    return await this.legacy.uniqueCode()
  }

  async cachedSnapshot(userId: number): Promise<JotmoCachedSnapshot> {
    await this.ensureMigrated(userId)
    const rows = this.database.prepare(`
      SELECT record_uid, send_at_millis, title, text_content, template_kind,
             status, version, sync_state, attempts, last_error, created_at_millis
      FROM record_cache
      WHERE user_id = ?
      ORDER BY send_at_millis DESC, record_uid DESC
      LIMIT 5000
    `).all(userId) as unknown as RecordRow[]
    const meta = this.database.prepare(`
      SELECT record_count, words_count, total_sec, has_more,
             next_cursor_send_at, next_cursor_record_uid, refreshed_at_millis, revision
      FROM cache_meta WHERE user_id = ?
    `).get(userId) as unknown as MetaRow | undefined
    return {
      items: rows.map(row => this.recordFromRow(row)),
      hasMore: meta?.has_more === 1,
      ...(meta?.next_cursor_send_at != null && meta.next_cursor_send_at > 0
        && meta.next_cursor_record_uid != null && meta.next_cursor_record_uid !== ''
        ? { nextCursor: { sendAtMillis: meta.next_cursor_send_at, recordUid: meta.next_cursor_record_uid } }
        : {}),
      ...(meta === undefined
        ? {}
        : { summary: { recordCount: meta.record_count, wordsCount: meta.words_count, totalSec: meta.total_sec } }),
      cachedAtMillis: meta?.refreshed_at_millis ?? 0,
      revision: meta?.revision ?? 0,
    }
  }

  async queryCached(
    userId: number,
    options: { query?: string; limit: number; beforeMillis?: number },
  ): Promise<JotmoCachedQueryResult> {
    await this.ensureMigrated(userId)
    const limit = Math.min(30, Math.max(1, Math.trunc(options.limit)))
    const query = options.query?.trim() ?? ''
    const pattern = `%${query.replace(/[\\%_]/g, value => `\\${value}`)}%`
    const beforeMillis = options.beforeMillis ?? Number.MAX_SAFE_INTEGER
    const rows = (query === ''
      ? this.database.prepare(`
          SELECT record_uid, send_at_millis, title, text_content, template_kind,
                 status, version, sync_state, attempts, last_error, created_at_millis
          FROM record_cache
          WHERE user_id = ? AND send_at_millis < ?
          ORDER BY send_at_millis DESC, record_uid DESC
          LIMIT ?
        `).all(userId, beforeMillis, limit)
      : this.database.prepare(`
          SELECT record_uid, send_at_millis, title, text_content, template_kind,
                 status, version, sync_state, attempts, last_error, created_at_millis
          FROM record_cache
          WHERE user_id = ? AND send_at_millis < ?
            AND (text_content LIKE ? ESCAPE '\\' COLLATE NOCASE OR title LIKE ? ESCAPE '\\' COLLATE NOCASE)
          ORDER BY send_at_millis DESC, record_uid DESC
          LIMIT ?
        `).all(userId, beforeMillis, pattern, pattern, limit)) as unknown as RecordRow[]
    const meta = this.database.prepare(`
      SELECT has_more, refreshed_at_millis, pagination_initialized, revision
      FROM cache_meta WHERE user_id = ?
    `).get(userId) as unknown as Pick<MetaRow, 'has_more' | 'refreshed_at_millis' | 'pagination_initialized' | 'revision'> | undefined
    return {
      items: rows.map(row => this.recordFromRow(row)),
      cacheComplete: meta?.pagination_initialized === 1 && meta.has_more === 0,
      cachedAtMillis: meta?.refreshed_at_millis ?? 0,
      revision: meta?.revision ?? 0,
    }
  }

  async revision(userId: number): Promise<number> {
    await this.ensureMigrated(userId)
    const row = this.database.prepare('SELECT revision FROM cache_meta WHERE user_id = ?')
      .get(userId) as unknown as { revision: number } | undefined
    return row?.revision ?? 0
  }

  async cachedProfile(userId: number): Promise<JotmoUserProfileSnapshot> {
    await this.ensureMigrated(userId)
    const row = this.database.prepare(`
      SELECT user_id, display_name, nickname, avatar_ref, avatar_url, jotmo_id,
             account_type, created_at, bind_apple, bind_wechat, bind_google,
             phone_masked, email_masked, updated_at_millis
      FROM user_profile_cache WHERE user_id = ?
    `).get(userId) as unknown as ProfileRow | undefined
    return {
      profile: row === undefined ? null : this.profileFromRow(row),
      cachedAtMillis: row?.updated_at_millis ?? 0,
      revision: await this.revision(userId),
    }
  }

  async cacheProfile(userId: number, profile: JotmoUserProfile): Promise<JotmoUserProfileSnapshot> {
    await this.ensureMigrated(userId)
    const now = Date.now()
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO user_profile_cache (
          user_id, display_name, nickname, avatar_ref, avatar_url, jotmo_id,
          account_type, created_at, bind_apple, bind_wechat, bind_google,
          phone_masked, email_masked, updated_at_millis
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          display_name = excluded.display_name,
          nickname = excluded.nickname,
          avatar_ref = excluded.avatar_ref,
          avatar_url = excluded.avatar_url,
          jotmo_id = excluded.jotmo_id,
          account_type = excluded.account_type,
          created_at = excluded.created_at,
          bind_apple = excluded.bind_apple,
          bind_wechat = excluded.bind_wechat,
          bind_google = excluded.bind_google,
          phone_masked = excluded.phone_masked,
          email_masked = excluded.email_masked,
          updated_at_millis = excluded.updated_at_millis
      `).run(
        userId, profile.displayName, profile.nickname, profile.avatarRef,
        profile.avatarUrl ?? null, profile.jotmoId, profile.accountType, profile.createdAt,
        profile.bindings.apple ? 1 : 0, profile.bindings.wechat ? 1 : 0, profile.bindings.google ? 1 : 0,
        profile.contact.phoneMasked ?? null, profile.contact.emailMasked ?? null, now,
      )
      this.bumpRevision(userId)
    })
    return await this.cachedProfile(userId)
  }

  async cacheSummary(userId: number, summary: JotmoSelfSummary): Promise<void> {
    await this.ensureMigrated(userId)
    this.database.prepare(`
      INSERT INTO cache_meta (
        user_id, record_count, words_count, total_sec, revision, refreshed_at_millis
      ) VALUES (?, ?, ?, ?, 1, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        record_count = excluded.record_count,
        words_count = excluded.words_count,
        total_sec = excluded.total_sec,
        revision = cache_meta.revision + 1,
        refreshed_at_millis = excluded.refreshed_at_millis
    `).run(userId, summary.recordCount, summary.wordsCount, summary.totalSec, Date.now())
    this.secureDatabaseFiles()
  }

  async cachePage(userId: number, page: JotmoSelfRecordList, requestCursor?: JotmoRecordCursor): Promise<void> {
    await this.ensureMigrated(userId)
    this.transaction(() => {
      for (const item of page.items) this.upsertSyncedRecord(userId, item)
      this.database.prepare(`
        INSERT INTO cache_meta (
          user_id, has_more, next_cursor_send_at, next_cursor_record_uid,
          pagination_initialized, revision, refreshed_at_millis
        ) VALUES (?, ?, ?, ?, 1, 1, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          has_more = CASE WHEN cache_meta.pagination_initialized = 0 OR ? = 1 THEN excluded.has_more ELSE cache_meta.has_more END,
          next_cursor_send_at = CASE WHEN cache_meta.pagination_initialized = 0 OR ? = 1 THEN excluded.next_cursor_send_at ELSE cache_meta.next_cursor_send_at END,
          next_cursor_record_uid = CASE WHEN cache_meta.pagination_initialized = 0 OR ? = 1 THEN excluded.next_cursor_record_uid ELSE cache_meta.next_cursor_record_uid END,
          pagination_initialized = 1,
          revision = cache_meta.revision + 1,
          refreshed_at_millis = excluded.refreshed_at_millis
      `).run(
        userId,
        page.hasMore ? 1 : 0,
        page.nextCursor?.sendAtMillis ?? null,
        page.nextCursor?.recordUid ?? null,
        Date.now(),
        requestCursor === undefined ? 0 : 1,
        requestCursor === undefined ? 0 : 1,
        requestCursor === undefined ? 0 : 1,
      )
    })
  }

  async listPending(userId: number): Promise<JotmoPendingWrite[]> {
    await this.ensureMigrated(userId)
    const rows = this.database.prepare(`
      SELECT record_uid, text_content, created_at_millis, send_at_millis, attempts, last_error
      FROM record_cache
      WHERE user_id = ? AND sync_state IN ('pending', 'failed')
      ORDER BY created_at_millis ASC, record_uid ASC
    `).all(userId) as unknown as Array<Pick<
      RecordRow, 'record_uid' | 'text_content' | 'created_at_millis' | 'send_at_millis' | 'attempts' | 'last_error'
    >>
    return rows.map(row => ({
      recordUid: row.record_uid,
      textContent: row.text_content,
      createdAtMillis: row.created_at_millis,
      sendAtMillis: row.send_at_millis,
      attempts: row.attempts,
      ...(row.last_error == null || row.last_error === '' ? {} : { lastError: row.last_error }),
    }))
  }

  async putPending(userId: number, pending: JotmoPendingWrite): Promise<void> {
    await this.ensureMigrated(userId)
    this.insertPending(userId, pending)
    this.bumpRevision(userId)
    this.secureDatabaseFiles()
  }

  async markAttempt(userId: number, recordUid: string, error: string): Promise<void> {
    await this.ensureMigrated(userId)
    const result = this.database.prepare(`
      UPDATE record_cache
      SET sync_state = 'failed', attempts = attempts + 1, last_error = ?, updated_at_millis = ?
      WHERE user_id = ? AND record_uid = ?
    `).run(error.slice(0, 500), Date.now(), userId, recordUid)
    if (Number(result.changes) > 0) this.bumpRevision(userId)
    this.secureDatabaseFiles()
  }

  async markSynced(userId: number, recordUid: string, status: number): Promise<void> {
    await this.ensureMigrated(userId)
    const result = this.database.prepare(`
      UPDATE record_cache
      SET sync_state = 'synced', status = ?, last_error = NULL, updated_at_millis = ?
      WHERE user_id = ? AND record_uid = ?
    `).run(status, Date.now(), userId, recordUid)
    if (Number(result.changes) > 0) this.bumpRevision(userId)
    this.secureDatabaseFiles()
  }

  close(): void {
    this.database.close()
  }

  private recordFromRow(row: RecordRow): JotmoSelfRecordItem {
    return {
      recordUid: row.record_uid,
      sendAtMillis: row.send_at_millis,
      title: row.title,
      textContent: row.text_content,
      templateKind: row.template_kind,
      status: row.status,
      version: row.version,
      localState: row.sync_state,
      ...(row.last_error == null || row.last_error === '' ? {} : { lastError: row.last_error }),
    }
  }

  private profileFromRow(row: ProfileRow): JotmoUserProfile {
    return {
      userId: row.user_id,
      displayName: row.display_name,
      nickname: row.nickname,
      avatarRef: row.avatar_ref,
      ...(row.avatar_url == null || row.avatar_url === '' ? {} : { avatarUrl: row.avatar_url }),
      jotmoId: row.jotmo_id,
      accountType: row.account_type,
      createdAt: row.created_at,
      bindings: { apple: row.bind_apple === 1, wechat: row.bind_wechat === 1, google: row.bind_google === 1 },
      contact: {
        ...(row.phone_masked == null || row.phone_masked === '' ? {} : { phoneMasked: row.phone_masked }),
        ...(row.email_masked == null || row.email_masked === '' ? {} : { emailMasked: row.email_masked }),
      },
    }
  }

  private insertPending(userId: number, pending: JotmoPendingWrite): void {
    const now = Date.now()
    this.database.prepare(`
      INSERT INTO record_cache (
        user_id, record_uid, send_at_millis, title, text_content, template_kind,
        status, version, sync_state, attempts, last_error,
        created_at_millis, updated_at_millis
      ) VALUES (?, ?, ?, '', ?, 1, 0, 0, 'pending', ?, ?, ?, ?)
      ON CONFLICT(user_id, record_uid) DO UPDATE SET
        send_at_millis = excluded.send_at_millis,
        text_content = excluded.text_content,
        template_kind = 1,
        sync_state = 'pending',
        attempts = excluded.attempts,
        last_error = excluded.last_error,
        updated_at_millis = excluded.updated_at_millis
    `).run(
      userId, pending.recordUid, pending.sendAtMillis, pending.textContent,
      pending.attempts, pending.lastError ?? null, pending.createdAtMillis, now,
    )
  }

  private upsertSyncedRecord(userId: number, item: JotmoSelfRecordItem): void {
    const now = Date.now()
    this.database.prepare(`
      INSERT INTO record_cache (
        user_id, record_uid, send_at_millis, title, text_content, template_kind,
        status, version, sync_state, attempts, last_error,
        created_at_millis, updated_at_millis
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synced', 0, NULL, ?, ?)
      ON CONFLICT(user_id, record_uid) DO UPDATE SET
        send_at_millis = excluded.send_at_millis,
        title = excluded.title,
        text_content = excluded.text_content,
        template_kind = excluded.template_kind,
        status = excluded.status,
        version = excluded.version,
        sync_state = 'synced',
        last_error = NULL,
        updated_at_millis = excluded.updated_at_millis
    `).run(
      userId, item.recordUid, item.sendAtMillis, item.title, item.textContent,
      item.templateKind, item.status, item.version, item.sendAtMillis || now, now,
    )
  }

  private async ensureMigrated(userId: number): Promise<void> {
    const existing = this.migrations.get(userId)
    if (existing !== undefined) return await existing
    const migration = (async () => {
      const pending = await this.legacy.listPending(userId)
      for (const item of pending) this.insertPending(userId, item)
      for (const item of pending) await this.legacy.removePending(userId, item.recordUid)
      if (pending.length > 0) this.bumpRevision(userId)
      this.secureDatabaseFiles()
    })()
    this.migrations.set(userId, migration)
    try {
      await migration
    } catch (error) {
      this.migrations.delete(userId)
      throw error
    }
  }

  private transaction(work: () => void): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      work()
      this.database.exec('COMMIT')
      this.secureDatabaseFiles()
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  private bumpRevision(userId: number): void {
    this.database.prepare(`
      INSERT INTO cache_meta (user_id, revision, refreshed_at_millis)
      VALUES (?, 1, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        revision = cache_meta.revision + 1,
        refreshed_at_millis = excluded.refreshed_at_millis
    `).run(userId, Date.now())
  }

  private secureDatabaseFiles(): void {
    for (const path of [this.path, `${this.path}-wal`, `${this.path}-shm`]) {
      try {
        chmodSync(path, 0o600)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }
}
