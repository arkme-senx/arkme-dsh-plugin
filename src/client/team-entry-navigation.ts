import { arkmeAuthStore } from './auth-store.js'
import { teamDirectoryPreferences, type TeamEntryTarget } from './team-directory-preferences.js'
import { openTeamMessages, type TeamMessageIntent } from './team-messaging-events.js'
import { callArkme } from './api.js'
import { groupTeamConversations } from './team-conversation-directory.js'
import type { TeamChannel, TeamConversation, TeamOpen, TeamPage } from '../team-app-contract.js'

type PublicIntent = Extract<TeamMessageIntent, { kind: 'link' | 'official' }>
type Opening = { account: string; controller: AbortController; promise: Promise<TeamOpen>; settled: boolean }
// Share the existing open RPC with the panel for this explicit navigation only.
// A plain mount still performs a read and never creates a restore command.
const openings = new WeakMap<TeamMessageIntent, Opening>()
function currentAccount(): string {
  const auth = arkmeAuthStore.getSnapshot().auth
  return auth?.status === 'authenticated' && auth.userId !== undefined ? `${auth.environment}:${auth.userId}` : ''
}
async function readOpen(account: string, intent: PublicIntent, signal: AbortSignal): Promise<TeamOpen> {
  const publicRef = intent.kind === 'official'
    ? (await callArkme<TeamChannel>('team.app.official', { expectedAccountKey: account }, signal)).publicRef : intent.publicRef
  signal.throwIfAborted()
  return callArkme<TeamOpen>('team.app.open', { publicRef, expectedAccountKey: account }, signal)
}
async function folderTarget(account: string, teamRef: string, signal: AbortSignal): Promise<TeamEntryTarget | undefined> {
  const page = await callArkme<TeamPage<TeamConversation>>('team.app.conversations', { teamRef, side: 'team', limit: 1, expectedAccountKey: account }, signal)
  const group = groupTeamConversations(page.items.filter(c => c.lastSeq > 0))[0]
  return group ? { kind: 'folder', group } : undefined
}
function prepareRestore(account: string, intent: TeamMessageIntent): void {
  if (intent.kind === 'inbox') return
  const controller = new AbortController()
  const stop = arkmeAuthStore.subscribe(() => { if (currentAccount() !== account) controller.abort() })
  let opened: Promise<TeamOpen> | undefined
  if (intent.kind === 'link' || intent.kind === 'official') {
    const opening: Opening = { account, controller, promise: readOpen(account, intent, controller.signal), settled: false }
    openings.set(intent, opening)
    // Mark settled before the panel redirects a member link to its inbox. That
    // redirect's effect cleanup must not cancel the already confirmed opening.
    opened = opening.promise = opening.promise.finally(() => { opening.settled = true })
    void opened.catch(() => {})
  }
  void teamDirectoryPreferences.restoreNavigation(account, async () => {
    if (intent.kind === 'conversation') return { kind: 'conversation', conversation: intent.conversation }
    if (intent.kind === 'team') return folderTarget(account, intent.teamRef, controller.signal)
    // Open errors belong to the existing panel error/retry UI, not to a second
    // preference error. No successful open means no optional restoration.
    const value = await opened!.catch(() => undefined)
    if (!value || controller.signal.aborted) return undefined
    if (value.conversation) return { kind: 'conversation', conversation: value.conversation }
    if (value.openInbox) return folderTarget(account, value.channel.teamRef, controller.signal)
    return undefined
  }, controller.signal).catch(() => {}).finally(stop)
}

/** Explicit user navigation; mounting, previewing and empty opens never restore. */
export function openTeamEntryMessages(intent: TeamMessageIntent, expectedAccountKey?: string): void {
  const account = currentAccount()
  if (expectedAccountKey !== undefined && account !== expectedAccountKey) return
  const navigation = { ...intent }
  if (account) prepareRestore(account, navigation)
  openTeamMessages(navigation)
}

/** Use the same opening result and preserve the panel's existing cancellation. */
export function loadTeamEntryOpen(account: string, intent: PublicIntent, signal: AbortSignal): Promise<TeamOpen> {
  const opening = openings.get(intent)
  if (!opening || opening.account !== account) return readOpen(account, intent, signal)
  openings.delete(intent)
  const cancel = () => { if (!opening.settled) opening.controller.abort() }
  if (signal.aborted) cancel()
  else signal.addEventListener('abort', cancel, { once: true })
  return opening.promise.finally(() => signal.removeEventListener('abort', cancel))
}

/** Only the existing retry button creates a fresh explicit opening intent. */
export function retryTeamEntryOpen(account: string, intent: TeamMessageIntent): void {
  if (account === currentAccount() && (intent.kind === 'link' || intent.kind === 'official')) prepareRestore(account, intent)
}
