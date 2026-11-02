import { recordOwnerId, type RecordOwnerId } from '../record-owner-id.js'
import { createHash } from 'node:crypto'
import { ArkmePluginError, ArkmeUpstreamResponseError } from './service.js'
import type { StateStore } from './service.js'
import type { TeamEntryReference, TeamEntryPreferencePage, TeamEntryPreferenceSnapshot, TeamEntryAction } from '../team-entry-preference-contract.js'

type WireEntry = { entry_kind: 'team_folder' | 'team_conversation'; team_id: RecordOwnerId; conversation_uid?: string; side?: 'team' | 'external' }
type WireSnapshot = { entry: WireEntry; accessible: boolean; pinned: boolean; dismissed: boolean; version: number; activity_seq: number }
type WireCommand = { operation_id: string; changes: { entry: WireEntry; action: TeamEntryAction; expected_version: number }[] }
type Saved = { snapshots: Record<string, WireSnapshot>; pending: Record<string, WireCommand> }
type Post = (path: string, body?: Record<string, unknown>, read?: boolean) => Promise<Record<string, unknown>>
type References = { open(kind: string, ref: unknown, actor: number): Promise<Record<string, unknown>>; seal(kind: string, value: Record<string, unknown>, actor: number): Promise<string> }
const object = (x: unknown): Record<string, unknown> => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {}
const text = (x: unknown) => typeof x === 'string' ? x : ''
const integer = (x: unknown) => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0
const invalid = () => new ArkmePluginError('team-entry-invalid', '团队入口参数无效，请重新打开', false, 400)
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function teamEntryCloudKey(actor: number, kind: 'folder' | 'conversation', id: string | number, side = ''): string {
  return createHash('sha256').update(JSON.stringify(['team-entry', actor, kind, String(id), side])).digest('hex')
}
const key = (actor: number, e: WireEntry) => teamEntryCloudKey(actor, e.entry_kind === 'team_folder' ? 'folder' : 'conversation', e.entry_kind === 'team_folder' ? e.team_id : e.conversation_uid!, e.side)
function wireEntry(raw: unknown): WireEntry {
  const e = object(raw)
  if (e.entry_kind === 'team_folder' && recordOwnerId(e.team_id) !== 0 && !e.conversation_uid && !e.side) return { entry_kind: 'team_folder', team_id: recordOwnerId(e.team_id) }
  if (e.entry_kind === 'team_conversation' && uuid.test(text(e.conversation_uid)) && ['team', 'external'].includes(text(e.side)) && (e.team_id === undefined || e.team_id === 0 || recordOwnerId(e.team_id) !== 0)) return { entry_kind: 'team_conversation', team_id: recordOwnerId(e.team_id), conversation_uid: text(e.conversation_uid), side: e.side as 'team' | 'external' }
  throw invalid()
}
function wireSnapshot(raw: unknown): WireSnapshot {
  const s = object(raw), entry = wireEntry(s.entry)
  if (typeof s.accessible !== 'boolean' || typeof s.pinned !== 'boolean' || typeof s.dismissed !== 'boolean' || !integer(s.version) || !integer(s.activity_seq)) throw new ArkmePluginError('team-entry-incomplete', '入口偏好返回不完整，请重新核对', true, 502)
  return { entry, accessible: s.accessible, pinned: s.pinned, dismissed: s.dismissed, version: Number(s.version), activity_seq: Number(s.activity_seq) }
}

/** One Host owner for UI/Tool/SDK, with stable wire commands persisted before network effects. */
export class TeamEntryPreferenceService {
  private queues = new Map<string, Promise<unknown>>()
  private legacy = new Map<string, { entry: WireEntry; key: string }>()
  constructor(private storage: StateStore, private refs: References) {}
  register(actor: number, entry: WireEntry, legacyKey: string) {
    this.legacy.set(`${actor}:${key(actor, entry)}`, { entry, key: legacyKey })
    while (this.legacy.size > 10_000) this.legacy.delete(this.legacy.keys().next().value!)
  }
  private async resolve(raw: unknown, actor: number): Promise<WireEntry> {
    const e = object(raw)
    if (e.kind !== 'folder' && e.kind !== 'conversation' || !text(e.ref)) throw invalid()
    const v = await this.refs.open(e.kind === 'folder' ? 'team' : 'conversation', e.ref, actor)
    return wireEntry(e.kind === 'folder' ? { entry_kind: 'team_folder', team_id: v.team_id } : { entry_kind: 'team_conversation', conversation_uid: v.conversation_uid, side: v.side })
  }
  private async present(actor: number, s: WireSnapshot): Promise<TeamEntryPreferenceSnapshot> {
    const e = s.entry, kind = e.entry_kind === 'team_folder' ? 'folder' : 'conversation'
    const ref = await this.refs.seal(kind === 'folder' ? 'team' : 'conversation', kind === 'folder' ? { team_id: e.team_id } : { conversation_uid: e.conversation_uid, side: e.side }, actor)
    return { key: key(actor, e), target: { kind, ref }, accessible: s.accessible, pinned: s.pinned, dismissed: s.dismissed, version: s.version, activitySeq: s.activity_seq }
  }
  execute(operation: string, p: Record<string, unknown>, actor: number, environment: string, post: Post): Promise<TeamEntryPreferencePage> {
    const account = `${environment}:${actor}`
    const run = (this.queues.get(account) ?? Promise.resolve()).catch(() => {}).then(() => this.run(operation, p, actor, account, post))
    this.queues.set(account, run)
    void run.finally(() => { if (this.queues.get(account) === run) this.queues.delete(account) }).catch(() => {})
    return run
  }
  private async run(operation: string, p: Record<string, unknown>, actor: number, account: string, post: Post): Promise<TeamEntryPreferencePage> {
    const storage = this.storage.teamEntryPreferenceState?.bind(this.storage)
    if (!storage) throw new ArkmePluginError('team-entry-storage-unavailable', '入口同步存储暂不可用', true, 503)
    const raw = object(await storage(account)), saved: Saved = { snapshots: {}, pending: {} }
    for (const [id, v] of Object.entries(object(raw.snapshots))) { try { const s = wireSnapshot(v); if (id === key(actor, s.entry)) saved.snapshots[id] = s } catch { /* Disposable invalid cache never becomes a write. */ } }
    for (const [id, v] of Object.entries(object(raw.pending))) {
      const command = object(v)
      if (!uuid.test(id) || id !== command.operation_id || !Array.isArray(command.changes) || command.changes.length < 1 || command.changes.length > 2) throw invalid()
      const changes = command.changes.map(raw => {
        const v = object(raw)
        if (!['pin', 'unpin', 'dismiss', 'restore'].includes(text(v.action)) || !integer(v.expected_version)) throw invalid()
        return { entry: wireEntry(v.entry), action: v.action as TeamEntryAction, expected_version: Number(v.expected_version) }
      })
      saved.pending[id] = { operation_id: id, changes }
    }
    const persist = () => {
      // Disposable read projections are bounded independently of the frozen command.
      const ids = Object.keys(saved.snapshots)
      for (let i = 0; i < ids.length - 4000; i++) delete saved.snapshots[ids[i]!]
      return storage(account, saved)
    }
    if (operation.endsWith('.cached')) return { schemaVersion: 1, items: await Promise.all(Object.values(saved.snapshots).map(s => this.present(actor, s))), hasMore: false, ...(Object.keys(saved.pending).length ? { syncError: '有入口设置尚未确认同步，可联网后核对。' } : {}) }
    const accept = (rows: unknown) => {
      if (!Array.isArray(rows)) throw invalid()
      for (const raw of rows) {
        const s = wireSnapshot(raw), id = key(actor, s.entry), old = saved.snapshots[id]
        if (!s.accessible || !old || s.version >= old.version && s.activity_seq >= old.activity_seq) saved.snapshots[id] = s
      }
    }
    const send = async (command: WireCommand) => {
      try {
        const data = await post('entry-preferences/change', command as unknown as Record<string, unknown>)
        if (data.schema_version !== 1) throw invalid()
        accept(data.items); delete saved.pending[command.operation_id]; await persist(); return data
      } catch (error) {
        if (error instanceof ArkmeUpstreamResponseError) {
          const data = object(error.responseData), reason = text(data.reason)
          if (reason === 'entry_preference_version_conflict') { accept(object(data.current).items); delete saved.pending[command.operation_id]; await persist() }
          if (['not_accessible', 'invalid_request', 'idempotency_conflict'].includes(reason)) { delete saved.pending[command.operation_id]; await persist() }
        }
        throw error
      }
    }
    // A response loss must replay the original command before accepting another write.
    for (const command of Object.values(saved.pending)) await send(command)
    if (operation.endsWith('.change')) {
      if (!uuid.test(text(p.operationId)) || !Array.isArray(p.changes) || p.changes.length < 1 || p.changes.length > 2) throw invalid()
      const changes = await Promise.all(p.changes.map(async raw => {
        const v = object(raw)
        if (!['pin', 'unpin', 'dismiss', 'restore'].includes(text(v.action)) || !integer(v.expectedVersion)) throw invalid()
        return { entry: await this.resolve(v.target, actor), action: v.action as TeamEntryAction, expected_version: Number(v.expectedVersion) }
      }))
      const command: WireCommand = { operation_id: text(p.operationId), changes }
      saved.pending[command.operation_id] = command; await persist()
      const data = await send(command)
      return { schemaVersion: 1, items: await Promise.all((data.items as unknown[]).map(raw => this.present(actor, wireSnapshot(raw)))), hasMore: false }
    }
    const entries = operation.endsWith('.query')
      ? Array.isArray(p.entries) && p.entries.length > 0 && p.entries.length <= 100 ? await Promise.all(p.entries.map(e => this.resolve(e, actor))) : (() => { throw invalid() })()
      : undefined
    let data = await post(entries ? 'entry-preferences/query' : 'entry-preferences/list', entries ? { entries } : { cursor: p.cursor ? text((await this.refs.open('entry-cursor', p.cursor, actor)).cursor) : '', limit: 100 }, true)
    if (data.schema_version !== 1 || !Array.isArray(data.items)) throw new ArkmePluginError('team-entry-unsupported', '服务端尚不支持团队入口跨端同步', false, 409)
    let migrationNotice = ''
    if (entries && this.storage.localDirectoryPreferences) {
      const old = await this.storage.localDirectoryPreferences(account), imports: Record<string, unknown>[] = []
      for (const raw of data.items) {
        const s = wireSnapshot(raw), mapping = this.legacy.get(`${actor}:${key(actor, s.entry)}`)
        const local = mapping && old[`team:${mapping.key}`]
        if (!local || !s.accessible || s.version !== 0) continue
        const legacySequence = mapping && local.removal?.sequences[mapping.key]
        if (s.entry.entry_kind === 'team_folder' && local.removal) migrationNotice = '旧文件夹移除记录无法确认历史新消息，已保留为可见，可重新移除。'
        imports.push({ entry: s.entry, pinned: local.pinned, ...(s.entry.entry_kind === 'team_conversation' && Number.isSafeInteger(legacySequence) && Number(legacySequence) <= s.activity_seq ? { dismissed_through: legacySequence } : {}) })
      }
      if (imports.length) { await post('entry-preferences/import', { items: imports }); data = await post('entry-preferences/query', { entries }, true) }
    }
    accept(data.items); await persist()
    return { schemaVersion: 1, items: await Promise.all((data.items as unknown[]).map(raw => this.present(actor, wireSnapshot(raw)))), hasMore: data.has_more === true, ...(text(data.next_cursor) ? { nextCursor: await this.refs.seal('entry-cursor', { cursor: text(data.next_cursor) }, actor) } : {}), ...(migrationNotice ? { migrationNotice } : {}) }
  }
}
