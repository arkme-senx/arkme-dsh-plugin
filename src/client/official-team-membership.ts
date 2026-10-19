import type { TeamConversation, TeamOfficialMembership } from '../team-app-contract.js'
import { callArkme } from './api.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { subscribeTeamMessageChanges } from './team-messaging-events.js'
import { teamEntryHidden, type TeamDirectoryPreferences } from './team-directory-preferences.js'

export interface OfficialMembershipSnapshot {
  state: 'pending' | 'ready' | 'unavailable'
  value?: TeamOfficialMembership
}
const empty: OfficialMembershipSnapshot = Object.freeze({ state: 'pending' })
const listeners = new Set<() => void>()
let account = '', snapshot = empty, refreshCurrent: (() => Promise<void>) | undefined
export const subscribeOfficialTeamMembership = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const readOfficialTeamMembership = (key: string): OfficialMembershipSnapshot => key === account ? snapshot : empty
export const refreshOfficialTeamMembership = (key: string): Promise<void> => key === account ? refreshCurrent?.() ?? Promise.resolve() : Promise.resolve()
const emit = () => { for (const listener of listeners) listener() }

/** This optional read must neither delay conversations nor clear known status on transient failure. */
export function startOfficialTeamMembership(key: string): () => void {
  const controller = new AbortController()
  let running = false, again = false
  account = key; snapshot = empty; emit()
  const refresh = async () => {
    if (controller.signal.aborted || account !== key) return
    if (running) { again = true; return }
    running = true
    try {
      const value = await withArkmeReadDeadline(signal => callArkme<TeamOfficialMembership>('team.app.official.membership', {
        expectedAccountKey: key,
      }, signal), controller.signal)
      if (!value || typeof value.jotmoId !== 'string' || !value.jotmoId.trim() || typeof value.isMember !== 'boolean') throw new Error('Invalid official membership')
      if (!controller.signal.aborted && account === key && !again) { snapshot = { state: 'ready', value }; emit() }
    } catch {
      // Only an initial failure needs a fallback; later failures retain the last confirmed result.
      if (!controller.signal.aborted && account === key && !again && !snapshot.value) { snapshot = { state: 'unavailable' }; emit() }
    } finally {
      running = false
      if (again && !controller.signal.aborted) { again = false; void refresh() }
    }
  }
  refreshCurrent = refresh
  const stop = subscribeTeamMessageChanges(changed => { if (changed === key) void refresh() })
  const resume = () => { void refresh() }
  const browserWindow = typeof window === 'undefined' ? undefined : window
  const browserDocument = typeof document === 'undefined' ? undefined : document
  const visible = () => { if (browserDocument?.visibilityState === 'visible') resume() }
  const timer = browserDocument ? setInterval(visible, 60_000) : undefined
  browserWindow?.addEventListener('focus', resume); browserWindow?.addEventListener('online', resume)
  browserDocument?.addEventListener('visibilitychange', visible)
  void refresh()
  return () => {
    controller.abort(); stop(); clearInterval(timer)
    browserWindow?.removeEventListener('focus', resume); browserWindow?.removeEventListener('online', resume)
    browserDocument?.removeEventListener('visibilitychange', visible)
    if (refreshCurrent === refresh) { account = ''; snapshot = empty; refreshCurrent = undefined; emit() }
  }
}

export function shouldShowOfficialContact(
  membership: OfficialMembershipSnapshot,
  conversations: readonly TeamConversation[],
  preferences: TeamDirectoryPreferences,
): boolean {
  // Do not flash a redundant shortcut while initial membership is still loading.
  if (membership.state === 'pending' || membership.value?.isMember) return false
  const officialId = membership.value?.jotmoId
  return !conversations.some(c => c.side === 'external' && c.channel.jotmoId === officialId
    && !teamEntryHidden(preferences, { kind: 'conversation', conversation: c }))
}
