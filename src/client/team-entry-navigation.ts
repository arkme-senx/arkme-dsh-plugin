import { arkmeAuthStore } from './auth-store.js'
import { teamDirectoryPreferences } from './team-directory-preferences.js'
import { openTeamMessages, type TeamMessageIntent } from './team-messaging-events.js'
import { callArkme } from './api.js'
import { groupTeamConversations } from './team-conversation-directory.js'
import type { TeamConversation, TeamPage } from '../team-app-contract.js'

/** Explicit user navigation to an existing entry; mounting and empty opens never write preferences. */
export function openTeamEntryMessages(intent: TeamMessageIntent): void {
  const auth = arkmeAuthStore.getSnapshot().auth
  if (auth?.status === 'authenticated' && auth.userId !== undefined) {
    const account = `${auth.environment}:${auth.userId}`
    const pending = intent.kind === 'conversation' && intent.conversation.lastSeq > 0
      ? teamDirectoryPreferences.restoreTarget(account, { kind: 'conversation', conversation: intent.conversation }, true)
      : intent.kind === 'team' ? callArkme<TeamPage<TeamConversation>>('team.app.conversations', { teamRef: intent.teamRef, side: 'team', limit: 1, expectedAccountKey: account })
          .then(page => {
            const group = groupTeamConversations(page.items.filter(c => c.lastSeq > 0))[0]
            if (group) return teamDirectoryPreferences.restoreTarget(account, { kind: 'folder', group }, true)
          }) : undefined
    void pending?.catch(() => {})
  }
  openTeamMessages(intent)
}
