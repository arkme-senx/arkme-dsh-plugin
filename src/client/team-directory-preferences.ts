import { useEffect, useSyncExternalStore } from 'react'
import { localDirectoryPreferences } from './local-directory-preferences.js'
import { callArkme } from './api.js'
import type { TeamAppOperation, TeamChannel, TeamConversation } from '../team-app-contract.js'
import type { TeamEntryAction, TeamEntryReference, TeamEntryPreferencePage, TeamEntryPreferenceSnapshot } from '../team-entry-preference-contract.js'
import type { TeamConversationGroup } from './team-conversation-directory.js'

export type TeamEntryTarget = { kind: 'folder'; group: TeamConversationGroup } | { kind: 'conversation'; conversation: TeamConversation }
type Preference = { pinned: boolean; dismissed: boolean }
export type TeamDirectoryPreferences = Readonly<Record<string, Preference>>
const empty: TeamDirectoryPreferences = Object.freeze({})
export const teamConversationEntryKey = (c: TeamConversation) => c.entryKey ?? JSON.stringify(['conversation', c.side, c.channel.jotmoId, c.key])
export const teamFolderEntryKey = (channel: TeamChannel | string) => typeof channel === 'string' ? JSON.stringify(['folder', channel]) : channel.entryKey ?? JSON.stringify(['folder', channel.jotmoId])
export const teamEntryKey = (target: TeamEntryTarget) => target.kind === 'folder' ? teamFolderEntryKey(target.group.channel) : teamConversationEntryKey(target.conversation)
export const teamEntryConversations = (target: TeamEntryTarget) => target.kind === 'folder' ? target.group.conversations : [target.conversation]
export const teamEntryHidden = (preferences: TeamDirectoryPreferences, target: TeamEntryTarget) => preferences[teamEntryKey(target)]?.dismissed === true
export const teamEntryPinned = (preferences: TeamDirectoryPreferences, target: TeamEntryTarget) => preferences[teamEntryKey(target)]?.pinned === true
type Transport = (operation: TeamAppOperation, params: Record<string, unknown>, signal?: AbortSignal) => Promise<TeamEntryPreferencePage>
type State = { saved: Map<string, TeamEntryPreferenceSnapshot>; aliases: Map<string, string>; optimistic: Map<string, { token: number; value: Preference }>; view: TeamDirectoryPreferences; queue: Promise<unknown>; loading?: Promise<void> | undefined; loaded: boolean; error: string; notice: string }

/** Server snapshots decide visibility. Browser memory only projects pending explicit user commands. */
export class TeamDirectoryPreferenceStore {
  private states = new Map<string, State>()
  private listeners = new Set<() => void>()
  private token = 0
  constructor(private transport: Transport, private operationId = () => crypto.randomUUID()) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private state(account: string) {
    let state = this.states.get(account)
    if (!state) { state = { saved: new Map(), aliases: new Map(), optimistic: new Map(), view: empty, queue: Promise.resolve(), loaded: false, error: '', notice: '' }; this.states.set(account, state) }
    return state
  }
  read = (account: string): TeamDirectoryPreferences => account ? this.state(account).view : empty
  canPresent(account: string, conversation: TeamConversation): boolean {
    const state = this.state(account)
    const allowed = (key: string) => state.saved.get(state.aliases.get(key) ?? key)?.accessible !== false
    return allowed(teamConversationEntryKey(conversation)) &&
      (conversation.side === 'external' || allowed(teamFolderEntryKey(conversation.channel)))
  }
  error = (account: string) => account ? (this.state(account).error || this.state(account).notice) : ''
  acknowledgeNotice(account: string) { const state = this.state(account); state.notice = ''; this.publish(state) }
  private publish(state: State) {
    const view: Record<string, Preference> = {}
    for (const [key, item] of state.saved) view[key] = { pinned: item.accessible && item.pinned, dismissed: item.accessible && item.dismissed }
    for (const [alias, key] of state.aliases) if (view[key]) view[alias] = view[key]!
    for (const [key, item] of state.optimistic) view[key] = item.value
    state.view = view; for (const listener of this.listeners) listener()
  }
  private accept(state: State, page: TeamEntryPreferencePage, aliases: string[] = []) {
    if (page.schemaVersion !== 1) throw new Error('服务端尚不支持团队入口同步')
    page.items.forEach((item, index) => {
      const old = state.saved.get(item.key)
      // Compare complete snapshots; never combine a newer preference with an older activity watermark.
      if (!item.accessible || !old || item.version >= old.version && item.activitySeq >= old.activitySeq) state.saved.set(item.key, item)
      if (aliases[index]) { state.aliases.set(aliases[index]!, item.key) }
    })
    state.error = page.syncError ?? ''; if (page.migrationNotice) state.notice = page.migrationNotice; this.publish(state)
  }
  hydrate(account: string, force = false): Promise<void> {
    if (!account) return Promise.resolve()
    const state = this.state(account)
    if (state.loading) return state.loading
    if (state.loaded && !force) return Promise.resolve()
    const run = state.queue.catch(() => {}).then(async () => {
      if (!state.loaded) this.accept(state, await this.transport('team.app.entries.cached', { expectedAccountKey: account }))
      let cursor: string | undefined
      const seen = new Set<string>()
      do {
        const page = await this.transport('team.app.entries.list', { expectedAccountKey: account, ...(cursor ? { cursor } : {}) })
        this.accept(state, page)
        if (page.hasMore && (!page.nextCursor || seen.has(page.nextCursor))) throw new Error('入口偏好分页异常')
        cursor = page.hasMore ? page.nextCursor : undefined
        if (cursor) seen.add(cursor)
      } while (cursor)
      state.loaded = true
    })
    state.loading = run.catch(error => { state.error = '入口设置同步未确认，可重试；仍可正常打开和发送消息。'; this.publish(state); throw error }).finally(() => { state.loading = undefined })
    state.queue = state.loading; return state.loading
  }
  private remember(target: TeamEntryTarget) {
    const key = teamEntryKey(target), ref: TeamEntryReference = target.kind === 'folder' ? { kind: 'folder', ref: target.group.channel.teamRef } : { kind: 'conversation', ref: target.conversation.ref }
    return { key, ref }
  }
  pin(account: string, target: TeamEntryTarget, pinned: boolean) { return this.change(account, [target], pinned ? 'pin' : 'unpin') }
  remove(account: string, target: TeamEntryTarget) { return this.change(account, [target], 'dismiss') }
  restoreTarget(account: string, target: TeamEntryTarget, publishedOnly = false): Promise<void> {
    // Existing conversation sequences include historical publications. A folder's
    // new activity counter may legitimately still be zero for that history.
    if (publishedOnly && (target.kind === 'folder' ? target.group.latest.lastSeq : target.conversation.lastSeq) <= 0) return Promise.resolve()
    const entries = [this.remember(target)]
    if (target.kind === 'conversation' && target.conversation.side === 'team') {
      const channel = target.conversation.channel, key = teamFolderEntryKey(channel), ref: TeamEntryReference = { kind: 'folder', ref: channel.teamRef }
      entries.push({ key, ref })
    }
    return this.command(account, entries, 'restore')
  }
  private change(account: string, targets: TeamEntryTarget[], action: TeamEntryAction) {
    return this.command(account, targets.map(t => this.remember(t)), action)
  }
  private command(account: string, entries: { key: string; ref: TeamEntryReference }[], action: TeamEntryAction): Promise<void> {
    if (!account) return Promise.reject(new Error('请先登录'))
    const state = this.state(account), token = ++this.token
    for (const { key } of entries) {
      const old = state.view[key] ?? { pinned: false, dismissed: false }
      state.optimistic.set(key, { token, value: action === 'pin' ? { pinned: true, dismissed: false } : action === 'unpin' ? { ...old, pinned: false } : action === 'dismiss' ? { pinned: false, dismissed: true } : { ...old, dismissed: false } })
    }
    this.publish(state)
    const run = state.queue.catch(() => {}).then(async () => {
      const params = { entries: entries.map(e => e.ref), expectedAccountKey: account }
      try {
        // Recheck before a new explicit command. The Host replays any persisted response-loss command first.
        this.accept(state, await this.transport('team.app.entries.query', params), entries.map(e => e.key))
        const chosen = action === 'restore' ? entries.filter(e => state.saved.get(state.aliases.get(e.key) ?? e.key)?.dismissed) : entries
        if (!chosen.length) return
        const changes = chosen.map(e => ({ target: e.ref, action, expectedVersion: state.saved.get(state.aliases.get(e.key) ?? e.key)?.version ?? 0 }))
        this.accept(state, await this.transport('team.app.entries.change', { operationId: this.operationId(), changes, expectedAccountKey: account }))
      } catch (error) {
        try { this.accept(state, await this.transport('team.app.entries.query', params), entries.map(e => e.key)) } catch { /* Durable Host command remains frozen for reconnect. */ }
        state.error = '入口设置同步未确认，请重试'
        throw error
      } finally {
        for (const { key } of entries) if (state.optimistic.get(key)?.token === token) state.optimistic.delete(key)
        this.publish(state)
      }
    })
    state.queue = run; return run
  }
  async reconcile(account: string, conversations: TeamConversation[], signal: AbortSignal): Promise<void> {
    const state = this.state(account), entries = new Map<string, TeamEntryReference>()
    for (const c of conversations) {
      entries.set(teamConversationEntryKey(c), { kind: 'conversation', ref: c.ref })
      if (c.side === 'team') entries.set(teamFolderEntryKey(c.channel), { kind: 'folder', ref: c.channel.teamRef })
    }
    const rows = [...entries]
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100)
      const page = await this.transport('team.app.entries.query', { entries: batch.map(e => e[1]), expectedAccountKey: account }, signal)
      signal.throwIfAborted(); this.accept(state, page, batch.map(e => e[0]))
    }
  }
  missingPins(account: string, conversations: TeamConversation[]): TeamEntryReference[] {
    const present = new Set(conversations.flatMap(c => [teamConversationEntryKey(c), ...(c.side === 'team' ? [teamFolderEntryKey(c.channel)] : [])]))
    return [...this.state(account).saved.values()].filter(s => s.accessible && s.pinned && !s.dismissed && !present.has(s.key)).map(s => s.target)
  }
}
export const teamDirectoryPreferences = new TeamDirectoryPreferenceStore((operation, params, signal) => callArkme(operation, params, signal))
export function useTeamDirectoryPreferences(account: string) {
  useEffect(() => { if (account) void localDirectoryPreferences.hydrate(account).catch(() => {}).then(() => teamDirectoryPreferences.hydrate(account)).catch(() => {}) }, [account])
  return useSyncExternalStore(teamDirectoryPreferences.subscribe, () => teamDirectoryPreferences.read(account), () => empty)
}
export function useTeamDirectoryPreferenceError(account: string) {
  return useSyncExternalStore(teamDirectoryPreferences.subscribe, () => teamDirectoryPreferences.error(account), () => '')
}
