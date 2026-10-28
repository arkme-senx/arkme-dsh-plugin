import { arkmeAuthStore } from './auth-store.js'
import { teamDirectoryPreferences } from './team-directory-preferences.js'
import { openTeamMessages, type TeamMessageIntent } from './team-messaging-events.js'

/** Explicit user navigation to an existing entry; mounting and empty opens never write preferences. */
export function openTeamEntryMessages(intent: TeamMessageIntent): void {
  const auth = arkmeAuthStore.getSnapshot().auth
  if (auth?.status === 'authenticated' && auth.userId !== undefined) {
    const account = `${auth.environment}:${auth.userId}`
    const pending = intent.kind === 'conversation' && intent.conversation.lastSeq > 0
      ? teamDirectoryPreferences.restoreTarget(account, { kind: 'conversation', conversation: intent.conversation }, true)
      : intent.kind === 'team' ? teamDirectoryPreferences.restoreReference(account, { kind: 'folder', ref: intent.teamRef }) : undefined
    void pending?.catch(() => {})
  }
  openTeamMessages(intent)
}
