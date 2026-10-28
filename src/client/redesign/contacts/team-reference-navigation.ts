import type { ArkmeTeam, ArkmeTeamMember, ArkmeTeamMemberPage, ArkmeTeamResolution } from '../../../types.js'
import { callArkme } from '../../api.js'
import { teamText as tr } from '../../team-messaging-i18n.js'

// App and OpenAPI references have different owners. Join by the unique public
// account ID through existing authorized queries, never by a display name.
export async function appTeamReference(reference: string, signal: AbortSignal): Promise<string> {
  if (!reference.startsWith('team_v1_')) return reference
  const page = await callArkme<ArkmeTeamMemberPage>('team.members.list', { teamRef: reference, limit: 1 }, signal)
  const teams = await callArkme<ArkmeTeam[]>('team.app.teams', {}, signal)
  signal.throwIfAborted()
  const matches = teams.filter(team => team.jotmoId === page.team.jotmoId)
  if (matches.length !== 1) throw new Error(tr('团队身份已变化，请重新打开团队'))
  return matches[0]!.teamRef
}

export async function codexTeamContext(team: ArkmeTeam, member: ArkmeTeamMember | undefined, signal: AbortSignal): Promise<{ team: ArkmeTeam; member?: string }> {
  const resolved = await callArkme<ArkmeTeamResolution[]>('team.resolve', { items: [{ itemId: 'navigation', query: team.jotmoId, limit: 10 }] }, signal)
  signal.throwIfAborted()
  const matches = resolved[0]?.candidates.filter(candidate => candidate.jotmoId === team.jotmoId) ?? []
  if (matches.length !== 1) throw new Error(tr('团队身份已变化，请重新打开团队'))
  const target = matches[0]!
  if (!member) return { team: target }
  if (!member.jotmoId) throw new Error(tr('身份信息暂不可用'))
  const cursors = new Set<string>(), members = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await callArkme<ArkmeTeamMemberPage>('team.members.list', { teamRef: target.teamRef, limit: 50, ...(cursor ? { pageCursor: cursor } : {}) }, signal)
    signal.throwIfAborted()
    if (page.team.teamRef !== target.teamRef) throw new Error(tr('团队身份已变化，请重新打开团队'))
    for (const candidate of page.items) if (candidate.jotmoId === member.jotmoId) members.add(candidate.userRef)
    if (page.hasMore && (!page.nextPageCursor || cursors.has(page.nextPageCursor))) throw new Error(tr('团队列表未完整加载，请重试'))
    cursor = page.hasMore ? page.nextPageCursor : undefined
    if (cursor) cursors.add(cursor)
  } while (cursor)
  if (members.size !== 1) throw new Error(tr('身份信息暂不可用'))
  return { team: target, member: [...members][0]! }
}
