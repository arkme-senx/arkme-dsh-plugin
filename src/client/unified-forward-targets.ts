import type { ArkmeSourceItem } from '../types.js'
import type { TeamChannel, TeamConversation } from '../team-app-contract.js'
import type { TeamWorkspaceFolder } from '../team-group-contract.js'
import { arkmeSourceAllowsUserWrite } from '../topic-policy.js'
import { arkmeSourceIdentityKey } from './source-identity.js'
import { mergeTeamDirectoryRows, type TeamConversationGroup } from './team-conversation-directory.js'
import { teamEntryHidden, teamEntryPinned, type TeamDirectoryPreferences } from './team-directory-preferences.js'

export type ForwardTarget = { kind: 'source'; source: ArkmeSourceItem; workspace?: TeamChannel } | { kind: 'team'; conversation: TeamConversation }
export type ForwardTargetRow = { kind: 'target'; target: ForwardTarget; pinned: boolean; activeAtMillis: number }
  | { kind: 'folder'; group: TeamConversationGroup; pinned: boolean; activeAtMillis: number }

export function forwardTargetKey(target: ForwardTarget): string {
  return target.kind === 'team' ? `team:${target.conversation.key}`
    : target.source.kind === 'send_to_self' || target.source.kind === 'default_category' ? 'self'
      : `${target.source.kind}:${arkmeSourceIdentityKey(target.source)}`
}
export function forwardTargetName(target: ForwardTarget): string {
  return target.kind === 'source' ? target.workspace ? `${target.workspace.name} · ${target.source.displayName}` : target.source.displayName : target.conversation.side === 'team'
    ? `${target.conversation.channel.name} · ${target.conversation.visitor?.nickname || '外部用户'}` : target.conversation.channel.name
}
export function forwardTargetSubtitle(target: ForwardTarget): string {
  return target.kind === 'team' ? (target.conversation.preview?.summary ?? target.conversation.preview?.text) || (target.conversation.side === 'team' ? '团队接待' : '我联系的团队')
    : target.source.latestPreview || (target.source.kind === 'group_chat' ? '群聊' : target.source.kind === 'private_chat' ? '私聊' : target.source.kind === 'topic' ? '主题' : '默认分类')
}
export function forwardTeamChildren(group: TeamConversationGroup, preferences: TeamDirectoryPreferences): ForwardTargetRow[] {
  return group.conversations.filter(conversation => !teamEntryHidden(preferences, { kind: 'conversation', conversation }))
    .map(conversation => ({ kind: 'target' as const, target: { kind: 'team' as const, conversation },
      pinned: teamEntryPinned(preferences, { kind: 'conversation', conversation }), activeAtMillis: conversation.updatedAt }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.activeAtMillis - a.activeAtMillis)
}

/** Use the same merge as the second column; target authority remains with its owner. */
export function projectUnifiedForwardTargets(ordinary: readonly { source: ArkmeSourceItem; pinned: boolean; activeAtMillis: number }[],
  teams: readonly TeamConversation[], preferences: TeamDirectoryPreferences, complete: boolean, workspaceFolders: readonly TeamWorkspaceFolder[] = []): ForwardTargetRow[] {
  const sources = ordinary.filter(row => arkmeSourceAllowsUserWrite(row.source))
    .map(row => ({ ...row, kind: 'source' as const }))
  return mergeTeamDirectoryRows(sources, [...teams], complete, preferences, workspaceFolders).map(row => row.kind === 'team-folder'
    ? { kind: 'folder', group: row.group, pinned: row.pinned, activeAtMillis: row.activeAtMillis }
    : { kind: 'target', target: row.kind === 'team' ? { kind: 'team', conversation: row.conversation }
      : { kind: 'source', source: row.source }, pinned: row.pinned, activeAtMillis: row.activeAtMillis })
}

export function searchForwardRows(rows: readonly ForwardTargetRow[], keyword: string, preferences: TeamDirectoryPreferences, children: (group: TeamConversationGroup) => ForwardTargetRow[] = group => forwardTeamChildren(group, preferences)): ForwardTargetRow[] {
  const query = keyword.trim().toLocaleLowerCase()
  if (!query) return [...rows]
  const matches = (target: ForwardTarget) => `${forwardTargetName(target)} ${forwardTargetSubtitle(target)}`.toLocaleLowerCase().includes(query)
  return rows.flatMap(row => {
    if (row.kind === 'target') return matches(row.target) ? [row] : []
    const found = children(row.group).filter(child => child.kind === 'target' && matches(child.target))
    return found.length ? found : row.group.channel.name.toLocaleLowerCase().includes(query) ? [row] : []
  })
}
