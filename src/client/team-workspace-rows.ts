import type { TeamChannel, TeamConversation } from '../team-app-contract.js'
import type { TeamWorkspaceEntry } from '../team-group-contract.js'
import { teamEntryPinned, type TeamDirectoryPreferences, type TeamEntryTarget } from './team-directory-preferences.js'

/** Both the second column and forwarding use these identity and ordering rules. */
export function teamWorkspaceTarget(row: TeamWorkspaceEntry, channel?: TeamChannel): TeamEntryTarget {
  return row.kind === 'customer' ? { kind: 'conversation', conversation: row.conversation }
    : { kind: 'group', source: row.source, entryKey: row.entryKey, entryRef: row.entryRef, channel }
}

export function mergeTeamWorkspaceRows(input: {
  channel?: TeamChannel | undefined
  rows: readonly TeamWorkspaceEntry[]
  conversations: readonly TeamConversation[]
  opened: readonly TeamConversation[]
  pinRows?: readonly TeamWorkspaceEntry[] | undefined
  hasPage: boolean
  preferences: TeamDirectoryPreferences
  canPresent(target: TeamEntryTarget): boolean
}): TeamWorkspaceEntry[] {
  const customers = (items: readonly TeamConversation[], pinned = false): TeamWorkspaceEntry[] => items
    .filter(c => c.side === 'team' && c.channel.jotmoId === input.channel?.jotmoId
      && (!pinned || teamEntryPinned(input.preferences, { kind: 'conversation', conversation: c })))
    .map(conversation => ({ kind: 'customer', key: conversation.key, activityAt: conversation.updatedAt, conversation }))
  const entries = [...customers(input.opened), ...customers(input.conversations, true), ...(input.pinRows ?? []),
    ...(input.hasPage ? input.rows : customers(input.conversations))]
  return [...new Map(entries.map(row => [row.kind === 'customer' ? `customer:${row.conversation.key}` : `group:${row.source.sourceKey}`, row])).values()]
    .filter(row => input.canPresent(teamWorkspaceTarget(row, input.channel)))
    .sort((a, b) => Number(teamEntryPinned(input.preferences, teamWorkspaceTarget(b, input.channel)))
      - Number(teamEntryPinned(input.preferences, teamWorkspaceTarget(a, input.channel)))
      || b.activityAt - a.activityAt || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
}
