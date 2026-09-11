import { applyMemberUpdate, mergeMemberJoinEvents, validateMemberUpdate, cachedMemberItem } from './member-directory.js'
import { isRecentEmojiId, normalizeRecentEmojiIds, type RecentEmojiStore } from './emoji-recent.js'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ArkmeStateStore } from './state-store.js'
import type {
  ArkmeCachedSnapshot,
  ArkmeRecordingSpeakerCandidate,
  ArkmeSourceList, ArkmeSourceItem, ArkmeDirectoryProjection, ArkmeImageBytes,
  ArkmeConversationMemberCache,
  ArkmeConversationMemberUpdate,
  ArkmeCachedQueryResult,
  ArkmeLongArticleDraft,
  ArkmePendingWrite,
  ArkmeRecordCaptureContext,
  ArkmeRecordCursor,
  ArkmeRecordReeditDraft,
  ArkmeSelfRecordItem,
  ArkmeSelfRecordList,
  ArkmeSelfSummary,
  ArkmeUserProfile,
  ArkmeUserProfileSnapshot,
} from './types.js'
import type { ArkmeExtensionReviewOperation } from './extensions/types.js'
import type { RecordingImportJob } from './recording-import-contract.js'
import { securePrivateDirectorySync, securePrivateFileSync } from './private-filesystem.js'

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
  record_duration_millis?: number
  capture_context_json?: string | null
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
  arkme_id: string
  can_update_arkme_id: number | null
  account_type: number
  created_at: number
  bind_apple: number
  bind_wechat: number
  bind_google: number
  phone_masked: string | null
  email_masked: string | null
  updated_at_millis: number
}

export class ArkmeLocalDatabase implements RecentEmojiStore {
  private readonly path: string
  private readonly database: DatabaseSync
  private readonly migrations = new Map<number, Promise<void>>()
  private readonly securedWindowsFiles = new Set<string>()

  constructor(directory: string, private readonly operationalState: ArkmeStateStore) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    securePrivateDirectorySync(directory)
    this.path = join(directory, 'records.sqlite3')
    this.database = new DatabaseSync(this.path)
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS recording_speaker_cache (
        scope TEXT NOT NULL, user_id INTEGER NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(scope, user_id)
      );
      CREATE TABLE IF NOT EXISTS recent_emoji (
        account_key TEXT PRIMARY KEY, emoji_ids TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversation_directory (
        user_id INTEGER NOT NULL, identity TEXT NOT NULL, payload TEXT NOT NULL,
        visibility TEXT, PRIMARY KEY(user_id, identity)
      );
      CREATE TABLE IF NOT EXISTS conversation_directory_meta (
        user_id INTEGER PRIMARY KEY, payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS avatar_cache (
        user_id INTEGER NOT NULL, image_ref TEXT NOT NULL, media_type TEXT NOT NULL,
        data BLOB NOT NULL, touched_at INTEGER NOT NULL,
        PRIMARY KEY(user_id, image_ref)
      );
      CREATE TABLE IF NOT EXISTS conversation_member_cache (
        user_id INTEGER NOT NULL,
        group_key TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        payload_bytes INTEGER NOT NULL DEFAULT 0,
        updated_at_millis INTEGER NOT NULL,
        PRIMARY KEY (user_id, group_key)
      );
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
        record_duration_millis INTEGER NOT NULL DEFAULT 0,
        capture_context_json TEXT,
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
        arkme_id TEXT NOT NULL,
        can_update_arkme_id INTEGER,
        account_type INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        bind_apple INTEGER NOT NULL,
        bind_wechat INTEGER NOT NULL,
        bind_google INTEGER NOT NULL,
        phone_masked TEXT,
        email_masked TEXT,
        updated_at_millis INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS extension_review_outbox (
        user_id INTEGER NOT NULL,
        client_mutation_id TEXT NOT NULL,
        extension_id TEXT NOT NULL,
        record_uid TEXT NOT NULL,
        parent_review_id TEXT,
        text_content TEXT NOT NULL,
        rating INTEGER,
        operation_state TEXT NOT NULL CHECK (operation_state IN ('record_pending', 'registry_pending', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at_millis INTEGER NOT NULL,
        updated_at_millis INTEGER NOT NULL,
        PRIMARY KEY (user_id, client_mutation_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS extension_review_outbox_user_record
        ON extension_review_outbox (user_id, record_uid);
    `)
    this.transaction(() => {
      const columns = this.database.prepare('PRAGMA table_info(conversation_member_cache)').all() as unknown as Array<{ name: string }>
      if (!columns.some(column => column.name === 'payload_bytes')) {
        this.database.exec('ALTER TABLE conversation_member_cache ADD COLUMN payload_bytes INTEGER NOT NULL DEFAULT 0')
        this.database.exec('UPDATE conversation_member_cache SET payload_bytes = LENGTH(CAST(snapshot_json AS BLOB))')
      }
    })
    const recordColumns = this.database.prepare('PRAGMA table_info(record_cache)').all() as unknown as Array<{ name: string }>
    if (!recordColumns.some(column => column.name === 'record_duration_millis')) {
      this.database.exec('ALTER TABLE record_cache ADD COLUMN record_duration_millis INTEGER NOT NULL DEFAULT 0')
    }
    if (!recordColumns.some(column => column.name === 'capture_context_json')) {
      this.database.exec('ALTER TABLE record_cache ADD COLUMN capture_context_json TEXT')
    }
    const metaColumns = this.database.prepare('PRAGMA table_info(cache_meta)').all() as unknown as Array<{ name: string }>
    if (!metaColumns.some(column => column.name === 'pagination_initialized')) {
      this.database.exec('ALTER TABLE cache_meta ADD COLUMN pagination_initialized INTEGER NOT NULL DEFAULT 0')
    }
    if (!metaColumns.some(column => column.name === 'revision')) {
      this.database.exec('ALTER TABLE cache_meta ADD COLUMN revision INTEGER NOT NULL DEFAULT 0')
    }
    const profileColumns = this.database.prepare('PRAGMA table_info(user_profile_cache)').all() as unknown as Array<{ name: string }>
    if (!profileColumns.some(column => column.name === 'can_update_arkme_id')) {
      this.database.exec('ALTER TABLE user_profile_cache ADD COLUMN can_update_arkme_id INTEGER')
    }
    this.secureDatabaseFiles()
  }

  async uniqueCode(): Promise<string> {
    return await this.operationalState.uniqueCode()
  }

  async readRecordingSpeakerCache(scope: string, userId: number): Promise<ArkmeRecordingSpeakerCandidate[] | undefined> {
    const row = this.database.prepare('SELECT payload FROM recording_speaker_cache WHERE scope=? AND user_id=?').get(scope, userId) as { payload: string } | undefined
    if (row === undefined) return undefined
    try {
      const value: unknown = JSON.parse(row.payload)
      if (!Array.isArray(value) || !value.every(item => item !== null && typeof item === 'object'
        && typeof item.optionKey === 'string' && typeof item.speakerRef === 'string' && typeof item.label === 'string'
        && (item.kind === 'speaker' || item.kind === 'arkme-user') && typeof item.isCurrentUser === 'boolean'
        && (item.avatarRef === undefined || typeof item.avatarRef === 'string'))) return undefined
      return value
    } catch { return undefined }
  }

  async writeRecordingSpeakerCache(scope: string, userId: number, candidates: ArkmeRecordingSpeakerCandidate[]): Promise<void> {
    this.database.prepare('INSERT INTO recording_speaker_cache VALUES (?, ?, ?) ON CONFLICT(scope, user_id) DO UPDATE SET payload=excluded.payload')
      .run(scope, userId, JSON.stringify(candidates))
  }

  async clearRecordingSpeakerCache(scope: string, userId: number): Promise<void> {
    this.database.prepare('DELETE FROM recording_speaker_cache WHERE scope=? AND user_id=?').run(scope, userId)
  }

  async readDirectoryCache(userId: number): Promise<ArkmeSourceList | undefined> {
    const meta = this.database.prepare('SELECT payload FROM conversation_directory_meta WHERE user_id=?').get(userId) as { payload: string } | undefined
    if (meta === undefined) return undefined
    const rows = this.database.prepare('SELECT payload, visibility FROM conversation_directory WHERE user_id=?').all(userId) as unknown as Array<{ payload: string; visibility: string | null }>
    const projection = JSON.parse(meta.payload) as ArkmeDirectoryProjection
    return { directory: 'root', items: rows.map(row => JSON.parse(row.payload) as ArkmeSourceItem), hasMore: projection.phase !== 'complete',
      projection: { ...projection, phase: 'cached', visibility: rows.flatMap(row => row.visibility === null ? [] : [JSON.parse(row.visibility)]).concat(projection.visibility.filter(item => item.entryKind === 'bot')) } }
  }

  async writeDirectoryCache(userId: number, page: ArkmeSourceList): Promise<void> {
    if (page.projection === undefined) return
    const visibility = new Map(page.projection.visibility.map(item => [item.entryRef, item]))
    this.transaction(() => {
      for (const key of page.projection!.removedSourceKeys ?? []) this.database.prepare('DELETE FROM conversation_directory WHERE user_id=? AND identity=?').run(userId, key)
      const upsert = this.database.prepare(`INSERT INTO conversation_directory VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, identity) DO UPDATE SET payload=excluded.payload,
          visibility=COALESCE(excluded.visibility, conversation_directory.visibility)
        WHERE conversation_directory.payload != excluded.payload OR (excluded.visibility IS NOT NULL AND excluded.visibility IS NOT conversation_directory.visibility)`)
      for (const source of page.items.filter(source => !page.projection!.removedSourceKeys?.includes(source.sourceKey ?? source.sourceRef))) upsert.run(userId, source.sourceKey ?? source.sourceRef, JSON.stringify(source), visibility.has(source.sourceRef) ? JSON.stringify(visibility.get(source.sourceRef)) : null)
      for (const item of page.projection!.visibility.filter(item => item.entryKind === 'source')) {
        this.database.prepare("UPDATE conversation_directory SET visibility=? WHERE user_id=? AND json_extract(payload, '$.sourceRef')=? AND visibility IS NOT ?").run(JSON.stringify(item), userId, item.entryRef, JSON.stringify(item))
      }
      const previousMeta = this.database.prepare('SELECT payload FROM conversation_directory_meta WHERE user_id=?').get(userId) as { payload: string } | undefined
      const previousVisibility = previousMeta === undefined ? [] : (JSON.parse(previousMeta.payload) as ArkmeDirectoryProjection).visibility
      const botVisibility = new Map(previousVisibility.filter(item => item.entryKind === 'bot').map(item => [item.entryRef, item]))
      for (const item of page.projection!.visibility) if (item.entryKind === 'bot') botVisibility.set(item.entryRef, item)
      for (const ref of page.projection!.removedBotRefs ?? []) botVisibility.delete(ref)
      if (page.projection!.bots.length > 0) {
        const currentRefs = new Set(page.projection!.bots.map(bot => bot.botRef))
        for (const ref of botVisibility.keys()) if (!currentRefs.has(ref)) botVisibility.delete(ref)
      }
      this.database.prepare('INSERT INTO conversation_directory_meta VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload').run(userId, JSON.stringify({ ...page.projection, visibility: [...botVisibility.values()] }))
      const size = this.database.prepare('SELECT count(*) AS count, sum(length(CAST(payload AS BLOB))) AS bytes FROM conversation_directory WHERE user_id=?').get(userId) as { count: number; bytes: number }
      if (size.count > 20_000 || size.bytes > 32 * 1024 * 1024) throw new Error('Conversation directory cache capacity exceeded; synchronization remains incomplete')
    })
    this.secureDatabaseFiles()
  }

  async readAvatarCache(userId: number, imageRef: string): Promise<ArkmeImageBytes | undefined> {
    const row = this.database.prepare('SELECT media_type, data FROM avatar_cache WHERE user_id=? AND image_ref=?').get(userId, imageRef) as { media_type: ArkmeImageBytes['mediaType']; data: Uint8Array } | undefined
    if (row === undefined) return undefined
    this.database.prepare('UPDATE avatar_cache SET touched_at=? WHERE user_id=? AND image_ref=?').run(Date.now(), userId, imageRef)
    return { mediaType: row.media_type, data: row.data, bytes: row.data.byteLength }
  }

  async writeAvatarCache(userId: number, imageRef: string, image: ArkmeImageBytes): Promise<void> {
    if (image.bytes > 8 * 1024 * 1024) throw new Error("Avatar exceeds the established image limit")
    this.transaction(() => {
      this.database.prepare(`INSERT INTO avatar_cache VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, image_ref)
        DO UPDATE SET media_type=excluded.media_type, data=excluded.data, touched_at=excluded.touched_at`).run(userId, imageRef, image.mediaType, image.data, Date.now())
      // Disk cache has a byte budget; eviction never deletes directory identities or preferences.
      let bytes = (this.database.prepare('SELECT COALESCE(sum(length(data)),0) AS bytes FROM avatar_cache').get() as { bytes: number }).bytes
      if (bytes <= 256 * 1024 * 1024) return
      const oldest = this.database.prepare('SELECT a.user_id, a.image_ref, length(a.data) AS bytes FROM avatar_cache a WHERE NOT EXISTS (SELECT 1 FROM conversation_directory d, json_tree(d.payload) j WHERE d.user_id=a.user_id AND j.value=a.image_ref) AND NOT EXISTS (SELECT 1 FROM conversation_directory_meta m, json_tree(m.payload) j WHERE m.user_id=a.user_id AND j.value=a.image_ref) ORDER BY a.touched_at').all() as unknown as Array<{ user_id: number; image_ref: string; bytes: number }>
      for (const row of oldest) {
        if (bytes <= 256 * 1024 * 1024) break
        this.database.prepare('DELETE FROM avatar_cache WHERE user_id=? AND image_ref=?').run(row.user_id, row.image_ref)
        bytes -= row.bytes
      }
      if (bytes > 256 * 1024 * 1024) throw new Error("Avatar cache capacity exceeded; previous directory images retained")
    })
    this.secureDatabaseFiles()
  }

  async cachedSnapshot(userId: number): Promise<ArkmeCachedSnapshot> {
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
  ): Promise<ArkmeCachedQueryResult> {
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

  async cachedProfile(userId: number): Promise<ArkmeUserProfileSnapshot> {
    await this.ensureMigrated(userId)
    const row = this.database.prepare(`
      SELECT user_id, display_name, nickname, avatar_ref, avatar_url, arkme_id,
             can_update_arkme_id, account_type, created_at, bind_apple, bind_wechat, bind_google,
             phone_masked, email_masked, updated_at_millis
      FROM user_profile_cache WHERE user_id = ?
    `).get(userId) as unknown as ProfileRow | undefined
    return {
      profile: row === undefined ? null : this.profileFromRow(row),
      cachedAtMillis: row?.updated_at_millis ?? 0,
      revision: await this.revision(userId),
    }
  }

  async cachedConversationMembers(userId: number, group: string): Promise<ArkmeConversationMemberCache | undefined> {
    return this.readConversationMembers(userId, group)
  }

  private readConversationMembers(userId: number, group: string): ArkmeConversationMemberCache | undefined {
    const row = this.database.prepare('SELECT snapshot_json, updated_at_millis FROM conversation_member_cache WHERE user_id = ? AND group_key = ?').get(userId, group) as { snapshot_json: string; updated_at_millis: number } | undefined
    if (row === undefined || Date.now() - row.updated_at_millis > 14 * 24 * 60 * 60 * 1000 || Buffer.byteLength(row.snapshot_json) > 4_000_000) return undefined
    try {
      const data = JSON.parse(row.snapshot_json) as ArkmeConversationMemberCache & { schemaVersion: number }
      if (data.schemaVersion !== 1 || !Array.isArray(data.items) || data.items.length > 20_000 || !Array.isArray(data.joinEvents)) return undefined
      const items = data.items.map(cachedMemberItem)
      if (items.some(item => item === undefined) || new Set(items.map(item => item!.memberRef)).size !== items.length) return undefined
      const joinEvents = mergeMemberJoinEvents([], data.joinEvents)
      return { items: items as ArkmeConversationMemberCache['items'], joinEvents, cachedAtMillis: row.updated_at_millis }
    } catch { return undefined }
  }

  async mergeConversationMembers(userId: number, group: string, update: ArkmeConversationMemberUpdate): Promise<void> {
    validateMemberUpdate(update)
    // This read/merge/write is synchronous in one SQLite owner turn; concurrent pages cannot lose updates.
    const previous = this.readConversationMembers(userId, group)
    if (update.kind === 'presentation' && previous === undefined) return
    const members = new Map(previous?.items.map(item => [item.memberRef, item]))
    applyMemberUpdate(members, update)
    const joins = mergeMemberJoinEvents(previous?.joinEvents ?? [], update.kind === 'membership' ? update.joinEvents ?? [] : [])
    this.writeConversationMembers(userId, group, [...members.values()], joins)
  }

  async forgetCachedMembers(userId: number, group: string, refs: readonly string[]): Promise<void> {
    const cache = this.readConversationMembers(userId, group)
    if (cache === undefined) return
    const invalid = new Set(refs)
    this.writeConversationMembers(userId, group, cache.items.filter(item => !invalid.has(item.memberRef)), cache.joinEvents)
  }

  private writeConversationMembers(userId: number, group: string, items: ArkmeConversationMemberCache['items'], joins: ArkmeConversationMemberCache['joinEvents']): void {
    const payload = JSON.stringify({ schemaVersion: 1, items, joinEvents: joins })
    if (items.length > 20_000 || Buffer.byteLength(payload) > 4_000_000) return
    this.database.prepare('INSERT INTO conversation_member_cache (user_id, group_key, snapshot_json, payload_bytes, updated_at_millis) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, group_key) DO UPDATE SET snapshot_json=excluded.snapshot_json, payload_bytes=excluded.payload_bytes, updated_at_millis=excluded.updated_at_millis').run(userId, group, payload, Buffer.byteLength(payload), Date.now())
    this.database.prepare('DELETE FROM conversation_member_cache WHERE updated_at_millis < ? OR rowid NOT IN (SELECT rowid FROM conversation_member_cache ORDER BY updated_at_millis DESC, rowid DESC LIMIT 100)').run(Date.now() - 14 * 24 * 60 * 60 * 1000)
    while (Number(this.database.prepare('SELECT COALESCE(SUM(payload_bytes), 0) AS bytes FROM conversation_member_cache').get()?.bytes) > 32 * 1024 * 1024) {
      this.database.prepare('DELETE FROM conversation_member_cache WHERE rowid = (SELECT rowid FROM conversation_member_cache ORDER BY updated_at_millis, rowid LIMIT 1)').run()
    }
  }

  async clearConversationMembers(userId: number, group: string): Promise<void> {
    this.database.prepare('DELETE FROM conversation_member_cache WHERE user_id = ? AND group_key = ?').run(userId, group)
  }

  async cacheProfile(userId: number, profile: ArkmeUserProfile): Promise<ArkmeUserProfileSnapshot> {
    await this.ensureMigrated(userId)
    const now = Date.now()
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO user_profile_cache (
          user_id, display_name, nickname, avatar_ref, avatar_url, arkme_id,
          can_update_arkme_id, account_type, created_at, bind_apple, bind_wechat, bind_google,
          phone_masked, email_masked, updated_at_millis
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          display_name = excluded.display_name,
          nickname = excluded.nickname,
          avatar_ref = excluded.avatar_ref,
          avatar_url = excluded.avatar_url,
          arkme_id = excluded.arkme_id,
          can_update_arkme_id = excluded.can_update_arkme_id,
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
        profile.avatarUrl ?? null, profile.arkmeId,
        profile.canUpdateArkmeId === undefined ? null : profile.canUpdateArkmeId ? 1 : 0,
        profile.accountType, profile.createdAt,
        profile.bindings.apple ? 1 : 0, profile.bindings.wechat ? 1 : 0, profile.bindings.google ? 1 : 0,
        profile.contact.phoneMasked ?? null, profile.contact.emailMasked ?? null, now,
      )
      this.bumpRevision(userId)
    })
    return await this.cachedProfile(userId)
  }

  async cacheSummary(userId: number, summary: ArkmeSelfSummary): Promise<void> {
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

  async cachePage(userId: number, page: ArkmeSelfRecordList, requestCursor?: ArkmeRecordCursor): Promise<void> {
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

  async listPending(userId: number): Promise<ArkmePendingWrite[]> {
    await this.ensureMigrated(userId)
    const rows = this.database.prepare(`
      SELECT record_uid, text_content, created_at_millis, send_at_millis, attempts, last_error,
             record_duration_millis, capture_context_json
      FROM record_cache
      WHERE user_id = ? AND sync_state IN ('pending', 'failed')
      ORDER BY created_at_millis ASC, record_uid ASC
    `).all(userId) as unknown as Array<Pick<
      RecordRow, 'record_uid' | 'text_content' | 'created_at_millis' | 'send_at_millis' | 'attempts' | 'last_error'
        | 'record_duration_millis' | 'capture_context_json'
    >>
    return rows.map(row => {
      const captureContext = this.pendingCaptureContext(row.capture_context_json)
      const recordDurationMillis = Math.max(0, Math.trunc(row.record_duration_millis ?? 0))
      return {
        recordUid: row.record_uid,
        textContent: row.text_content,
        createdAtMillis: row.created_at_millis,
        sendAtMillis: row.send_at_millis,
        attempts: row.attempts,
        ...(recordDurationMillis === 0 ? {} : { recordDurationMillis }),
        ...(captureContext === undefined ? {} : { captureContext }),
        ...(row.last_error == null || row.last_error === '' ? {} : { lastError: row.last_error }),
      }
    })
  }

  async putPending(userId: number, pending: ArkmePendingWrite): Promise<void> {
    await this.ensureMigrated(userId)
    this.insertPending(userId, pending)
    this.bumpRevision(userId)
    this.secureDatabaseFiles()
  }

  async listExtensionReviewOperations(userId: number): Promise<ArkmeExtensionReviewOperation[]> {
    await this.ensureMigrated(userId)
    const rows = this.database.prepare(`
      SELECT extension_id, record_uid, parent_review_id, text_content, rating,
             client_mutation_id, operation_state, attempts, last_error, created_at_millis
      FROM extension_review_outbox
      WHERE user_id = ?
      ORDER BY created_at_millis ASC, client_mutation_id ASC
    `).all(userId) as unknown as Array<{
      extension_id: string
      record_uid: string
      parent_review_id: string | null
      text_content: string
      rating: number | null
      client_mutation_id: string
      operation_state: ArkmeExtensionReviewOperation['state']
      attempts: number
      last_error: string | null
      created_at_millis: number
    }>
    return rows.map(row => ({
      extensionId: row.extension_id,
      recordUid: row.record_uid,
      ...(row.parent_review_id == null || row.parent_review_id === '' ? {} : { parentReviewId: row.parent_review_id }),
      textContent: row.text_content,
      ...(row.rating == null ? {} : { rating: row.rating }),
      clientMutationId: row.client_mutation_id,
      state: row.operation_state,
      attempts: row.attempts,
      createdAtMillis: row.created_at_millis,
      ...(row.last_error == null || row.last_error === '' ? {} : { lastError: row.last_error }),
    }))
  }

  async putExtensionReviewOperation(userId: number, operation: ArkmeExtensionReviewOperation): Promise<void> {
    await this.ensureMigrated(userId)
    const now = Date.now()
    this.database.prepare(`
      INSERT INTO extension_review_outbox (
        user_id, client_mutation_id, extension_id, record_uid, parent_review_id,
        text_content, rating, operation_state, attempts, last_error,
        created_at_millis, updated_at_millis
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, client_mutation_id) DO UPDATE SET
        extension_id = excluded.extension_id,
        record_uid = excluded.record_uid,
        parent_review_id = excluded.parent_review_id,
        text_content = excluded.text_content,
        rating = excluded.rating,
        operation_state = excluded.operation_state,
        attempts = excluded.attempts,
        last_error = excluded.last_error,
        updated_at_millis = excluded.updated_at_millis
    `).run(
      userId, operation.clientMutationId, operation.extensionId, operation.recordUid,
      operation.parentReviewId ?? null, operation.textContent, operation.rating ?? null,
      operation.state, operation.attempts, operation.lastError ?? null,
      operation.createdAtMillis, now,
    )
    this.secureDatabaseFiles()
  }

  async markExtensionReviewOperation(
    userId: number,
    clientMutationId: string,
    state: ArkmeExtensionReviewOperation['state'],
    error?: string,
  ): Promise<void> {
    await this.ensureMigrated(userId)
    this.database.prepare(`
      UPDATE extension_review_outbox
      SET operation_state = ?, attempts = attempts + 1, last_error = ?, updated_at_millis = ?
      WHERE user_id = ? AND client_mutation_id = ?
    `).run(state, error?.slice(0, 500) ?? null, Date.now(), userId, clientMutationId)
    this.secureDatabaseFiles()
  }

  async removeExtensionReviewOperation(userId: number, clientMutationId: string): Promise<void> {
    await this.ensureMigrated(userId)
    this.database.prepare(`
      DELETE FROM extension_review_outbox WHERE user_id = ? AND client_mutation_id = ?
    `).run(userId, clientMutationId)
    this.secureDatabaseFiles()
  }

  async getLongArticleDraft(userId: number, sourceRef: string, itemUid?: string): Promise<ArkmeLongArticleDraft | undefined> {
    return await this.operationalState.getLongArticleDraft(userId, sourceRef, itemUid)
  }

  async putLongArticleDraft(userId: number, draft: ArkmeLongArticleDraft): Promise<void> {
    await this.operationalState.putLongArticleDraft(userId, draft)
  }

  async removeLongArticleDraft(userId: number, sourceRef: string, itemUid?: string): Promise<void> {
    await this.operationalState.removeLongArticleDraft(userId, sourceRef, itemUid)
  }

  async getRecordReeditDraft(
    userId: number,
    sourceIdentityKey: string,
    itemUid: string,
  ): Promise<ArkmeRecordReeditDraft | undefined> {
    return await this.operationalState.getRecordReeditDraft(userId, sourceIdentityKey, itemUid)
  }

  async putRecordReeditDraft(
    userId: number,
    draft: Omit<ArkmeRecordReeditDraft, 'draftRevision'>,
    expectedRevision?: number,
  ): Promise<ArkmeRecordReeditDraft> {
    return await this.operationalState.putRecordReeditDraft(userId, draft, expectedRevision)
  }

  async recordReeditFileRefs(userId: number): Promise<string[]> {
    return await this.operationalState.recordReeditFileRefs(userId)
  }

  async listRecordReeditSubmissions(userId: number) {
    return await this.operationalState.listRecordReeditSubmissions(userId)
  }

  async acknowledgeRecordReeditSubmission(userId: number, identity: string, submissionId: string, version: number) {
    return await this.operationalState.acknowledgeRecordReeditSubmission(userId, identity, submissionId, version)
  }

  async discardRecordReeditCandidate(userId: number, sourceIdentityKey: string, itemUid: string, expectedRevision: number) {
    return await this.operationalState.discardRecordReeditCandidate(userId, sourceIdentityKey, itemUid, expectedRevision)
  }

  async putRecordReeditSubmission(userId: number, job: import('./record-reedit-contract.js').ArkmeRecordReeditSubmission, expectedId?: string) {
    return await this.operationalState.putRecordReeditSubmission(userId, job, expectedId)
  }

  async removeRecordReeditDraft(
    userId: number,
    sourceIdentityKey: string,
    itemUid: string,
    expectedRevision: number,
    expectedCandidate?: ArkmeRecordReeditDraft,
  ): Promise<boolean> {
    return await this.operationalState.removeRecordReeditDraft(
      userId, sourceIdentityKey, itemUid, expectedRevision, expectedCandidate,
    )
  }

  async listRecordingImportJobs(userId: number): Promise<RecordingImportJob[]> {
    return await this.operationalState.listRecordingImportJobs(userId)
  }

  async listAllRecordingImportJobs(): Promise<RecordingImportJob[]> {
    return await this.operationalState.listAllRecordingImportJobs()
  }

  async getRecordingImportJob(userId: number, jobId: string): Promise<RecordingImportJob | undefined> {
    return await this.operationalState.getRecordingImportJob(userId, jobId)
  }

  async putRecordingImportJob(userId: number, job: RecordingImportJob): Promise<void> {
    await this.operationalState.putRecordingImportJob(userId, job)
  }

  async admitRecordingImportJob(
    userId: number,
    job: RecordingImportJob,
    unresolvedLimit: number,
    signal?: AbortSignal,
  ): ReturnType<ArkmeStateStore['admitRecordingImportJob']> {
    return await this.operationalState.admitRecordingImportJob(userId, job, unresolvedLimit, signal)
  }

  async replaceRecordingImportJob(
    userId: number,
    job: RecordingImportJob,
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return await this.operationalState.replaceRecordingImportJob(userId, job, expectedRevision, signal)
  }

  async removeRecordingImportJob(userId: number, jobId: string): Promise<void> {
    await this.operationalState.removeRecordingImportJob(userId, jobId)
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

  private recordFromRow(row: RecordRow): ArkmeSelfRecordItem {
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

  private profileFromRow(row: ProfileRow): ArkmeUserProfile {
    return {
      userId: row.user_id,
      displayName: row.display_name,
      nickname: row.nickname,
      avatarRef: row.avatar_ref,
      ...(row.avatar_url == null || row.avatar_url === '' ? {} : { avatarUrl: row.avatar_url }),
      arkmeId: row.arkme_id,
      ...(row.can_update_arkme_id == null ? {} : { canUpdateArkmeId: row.can_update_arkme_id === 1 }),
      accountType: row.account_type,
      createdAt: row.created_at,
      bindings: { apple: row.bind_apple === 1, wechat: row.bind_wechat === 1, google: row.bind_google === 1 },
      contact: {
        ...(row.phone_masked == null || row.phone_masked === '' ? {} : { phoneMasked: row.phone_masked }),
        ...(row.email_masked == null || row.email_masked === '' ? {} : { emailMasked: row.email_masked }),
      },
    }
  }

  private insertPending(userId: number, pending: ArkmePendingWrite): void {
    const now = Date.now()
    const recordDurationMillis = Math.max(0, Math.trunc(pending.recordDurationMillis ?? 0))
    const captureContextJson = pending.captureContext === undefined ? null : JSON.stringify(pending.captureContext)
    this.database.prepare(`
      INSERT INTO record_cache (
        user_id, record_uid, send_at_millis, title, text_content, template_kind,
        status, version, sync_state, attempts, last_error,
        record_duration_millis, capture_context_json, created_at_millis, updated_at_millis
      ) VALUES (?, ?, ?, '', ?, 1, 0, 0, 'pending', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, record_uid) DO UPDATE SET
        send_at_millis = excluded.send_at_millis,
        text_content = excluded.text_content,
        template_kind = 1,
        sync_state = 'pending',
        attempts = excluded.attempts,
        last_error = excluded.last_error,
        record_duration_millis = excluded.record_duration_millis,
        capture_context_json = excluded.capture_context_json,
        updated_at_millis = excluded.updated_at_millis
    `).run(
      userId, pending.recordUid, pending.sendAtMillis, pending.textContent,
      pending.attempts, pending.lastError ?? null, recordDurationMillis, captureContextJson, pending.createdAtMillis, now,
    )
  }

  private pendingCaptureContext(raw: string | null | undefined): ArkmeRecordCaptureContext | undefined {
    if (raw == null || raw === '') return undefined
    try {
      const value = JSON.parse(raw) as unknown
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
      const source = value as Record<string, unknown>
      const clientName = typeof source.clientName === 'string' ? source.clientName.trim().slice(0, 120) : ''
      const networkName = typeof source.networkName === 'string' ? source.networkName.trim().slice(0, 120) : ''
      const electric = typeof source.electric === 'number' && Number.isFinite(source.electric) ? Math.trunc(source.electric) : undefined
      const charge = typeof source.charge === 'number' && Number.isFinite(source.charge) ? Math.trunc(source.charge) : 0
      const result: ArkmeRecordCaptureContext = {
        ...(clientName === '' ? {} : { clientName }),
        ...(networkName === '' ? {} : { networkName }),
        ...(electric === undefined || electric < 0 || electric > 100 ? {} : { electric }),
        ...(charge < 1 || charge > 3 ? {} : { charge }),
      }
      return Object.keys(result).length === 0 ? undefined : result
    } catch {
      return undefined
    }
  }

  private upsertSyncedRecord(userId: number, item: ArkmeSelfRecordItem): void {
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
      const pending = await this.operationalState.listPending(userId)
      for (const item of pending) this.insertPending(userId, item)
      for (const item of pending) await this.operationalState.removePending(userId, item.recordUid)
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

  private readRecentEmojiIds(accountKey: string): string[] {
    const row = this.database.prepare('SELECT emoji_ids FROM recent_emoji WHERE account_key=?').get(accountKey) as { emoji_ids: string } | undefined
    if (!row) return []
    try { return normalizeRecentEmojiIds(JSON.parse(row.emoji_ids)) } catch { return [] }
  }

  async recentEmojiIds(accountKey: string): Promise<string[]> {
    return this.readRecentEmojiIds(accountKey)
  }

  async recordRecentEmoji(accountKey: string, emojiId: string): Promise<string[]> {
    if (!isRecentEmojiId(emojiId)) throw new Error('Invalid recent emoji')
    let ids: string[] = []
    this.transaction(() => {
      ids = normalizeRecentEmojiIds([emojiId, ...this.readRecentEmojiIds(accountKey)])
      this.database.prepare(`INSERT INTO recent_emoji (account_key, emoji_ids) VALUES (?, ?)
        ON CONFLICT(account_key) DO UPDATE SET emoji_ids=excluded.emoji_ids`).run(accountKey, JSON.stringify(ids))
    })
    return ids
  }

  private transaction(work: () => void): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      work()
      this.secureDatabaseFiles()
      this.database.exec('COMMIT')
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
      if (process.platform === 'win32' && this.securedWindowsFiles.has(path)) continue
      try {
        securePrivateFileSync(path)
        if (process.platform === 'win32') this.securedWindowsFiles.add(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }
}
