import { useSyncExternalStore } from 'react'
import type { TeamConversation } from '../team-app-contract.js'
import type { TeamConversationGroup } from './team-conversation-directory.js'

export type TeamEntryTarget = { kind: 'folder'; group: TeamConversationGroup } | { kind: 'conversation'; conversation: TeamConversation }
type Removal = { at: number; sequences: Record<string, number> }
type Preference = { pinned: boolean; removal?: Removal }
export type TeamDirectoryPreferences = Readonly<Record<string, Preference>>
const empty: TeamDirectoryPreferences = Object.freeze({})
const prefix = 'arkme.team.directory.preferences.v1:'
export const teamConversationEntryKey = (c: TeamConversation) => JSON.stringify(['conversation', c.side, c.channel.jotmoId, c.key])
export const teamFolderEntryKey = (channelId: string) => JSON.stringify(['folder', channelId])
export const teamEntryKey = (target: TeamEntryTarget) => target.kind === 'folder' ? teamFolderEntryKey(target.group.key) : teamConversationEntryKey(target.conversation)
export const teamEntryConversations = (target: TeamEntryTarget) => target.kind === 'folder' ? target.group.conversations : [target.conversation]
export function teamEntryHidden(preferences: TeamDirectoryPreferences, target: TeamEntryTarget): boolean {
  const removal = preferences[teamEntryKey(target)]?.removal
  if (!removal) return false
  // Metadata, read receipts and pagination are not new messages.
  return !teamEntryConversations(target).some(c => {
    const sequence = removal.sequences[teamConversationEntryKey(c)]
    return sequence !== undefined && c.lastSeq > sequence
  })
}
export const teamEntryPinned = (preferences: TeamDirectoryPreferences, target: TeamEntryTarget) => preferences[teamEntryKey(target)]?.pinned === true

/** Only stable entry identifiers and message watermarks are persisted, never message bodies or signed refs. */
export class TeamDirectoryPreferenceStore {
  private cache = new Map<string, TeamDirectoryPreferences>()
  private listeners = new Set<() => void>()
  constructor(private storage: () => Pick<Storage, 'getItem' | 'setItem'> | undefined) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  invalidate = () => { this.cache.clear(); for (const listener of this.listeners) listener() }
  read = (account: string): TeamDirectoryPreferences => {
    if (!account) return empty
    const cached = this.cache.get(account)
    if (cached) return cached
    const result: Record<string, Preference> = Object.create(null)
    try {
      const raw = JSON.parse(this.storage()?.getItem(prefix + account) ?? '{}')
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const [key, value] of Object.entries(raw)) {
        const item = value as Preference
        if (!item || typeof item.pinned !== 'boolean') continue
        const removal = item.removal
        const sequences = Object.fromEntries(Object.entries(removal?.sequences ?? {}).filter((entry): entry is [string, number] => Number.isSafeInteger(entry[1]) && entry[1] >= 0))
        result[key] = { pinned: item.pinned, ...(removal && Number.isFinite(removal.at) && removal.at > 0 ? { removal: { at: removal.at, sequences } } : {}) }
      }
    } catch { /* Missing/corrupt optional local presentation preferences do not block the directory. */ }
    this.cache.set(account, result); return result
  }
  private write(account: string, value: TeamDirectoryPreferences) {
    if (!account) throw new Error('请先登录')
    const storage = this.storage()
    if (!storage) throw new Error('本机设置暂时无法保存，请重试')
    try { storage.setItem(prefix + account, JSON.stringify(value)) }
    catch { throw new Error('本机设置保存失败，请重试') }
    this.cache.set(account, value); for (const listener of this.listeners) listener()
  }
  pin(account: string, target: TeamEntryTarget, pinned: boolean) {
    this.write(account, { ...this.read(account), [teamEntryKey(target)]: { pinned } })
  }
  remove(account: string, target: TeamEntryTarget, at = Date.now()) {
    const sequences = Object.fromEntries(teamEntryConversations(target).map(c => [teamConversationEntryKey(c), c.lastSeq]))
    this.write(account, { ...this.read(account), [teamEntryKey(target)]: { pinned: false, removal: { at, sequences } } })
  }
  restore(account: string, key: string) {
    const previous = this.read(account)
    if (!previous[key]?.removal) return
    this.write(account, { ...previous, [key]: { pinned: previous[key]!.pinned } })
  }
  /** Unknown visitors may merely be older directory pages. Verify their latest actual message before restoring a folder. */
  async reconcile(account: string, conversations: TeamConversation[], latestMessageAt: (c: TeamConversation) => Promise<number>, signal: AbortSignal) {
    for (const c of conversations) {
      signal.throwIfAborted()
      const conversationKey = teamConversationEntryKey(c)
      for (const key of [conversationKey, ...(c.side === 'team' ? [teamFolderEntryKey(c.channel.jotmoId)] : [])]) {
        const removal = this.read(account)[key]?.removal
        if (!removal) continue
        const before = removal.sequences[conversationKey]
        if (before !== undefined) { if (c.lastSeq > before) this.restore(account, key); continue }
        if (!c.lastSeq) continue
        const actualTime = c.updatedAt > removal.at ? await latestMessageAt(c) : 0
        signal.throwIfAborted()
        if (this.read(account)[key]?.removal !== removal) continue
        if (actualTime > removal.at) this.restore(account, key)
        else this.write(account, { ...this.read(account), [key]: { pinned: false, removal: { ...removal, sequences: { ...removal.sequences, [conversationKey]: c.lastSeq } } } })
      }
    }
  }
}
export const teamDirectoryPreferences = new TeamDirectoryPreferenceStore(() => typeof localStorage === 'undefined' ? undefined : localStorage)
if (typeof window !== 'undefined') window.addEventListener('storage', event => { if (!event.key || event.key.startsWith(prefix)) teamDirectoryPreferences.invalidate() })
export function useTeamDirectoryPreferences(account: string) {
  return useSyncExternalStore(teamDirectoryPreferences.subscribe, () => teamDirectoryPreferences.read(account), () => empty)
}
