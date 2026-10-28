import { describe, expect, it, vi } from 'vitest'
import type { ArkmeTeam, ArkmeTeamMember } from '../src/types.js'
const call = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
import { appTeamReference, codexTeamContext } from '../src/client/redesign/contacts/team-reference-navigation.js'

const app = { teamRef: 'team-app-team.encrypted', jotmoId: 'team_unique', name: '重复名称' } as ArkmeTeam
const codex = { ...app, teamRef: `team_v1_${'a'.repeat(32)}` }
const member = { userRef: 'team-app-member.encrypted', jotmoId: 'user_unique', displayName: '重复昵称' } as ArkmeTeamMember
describe('navigation between existing Team owners', () => {
  it('returns to the App team by its public ID, never by its name', async () => {
    call.mockImplementation(async operation => operation === 'team.members.list'
      ? { team: codex } : [{ ...app, teamRef: 'wrong', jotmoId: 'other' }, app])
    expect(await appTeamReference(codex.teamRef, new AbortController().signal)).toBe(app.teamRef)
  })
  it('finds a later-page member using the existing OpenAPI pagination', async () => {
    call.mockImplementation(async (operation, params) => operation === 'team.resolve'
      ? [{ candidates: [codex, { ...codex, jotmoId: 'other' }] }]
      : params.pageCursor
        ? { team: codex, items: [{ ...member, userRef: 'usr_v1_target' }], hasMore: false }
        : { team: codex, items: [{ ...member, jotmoId: 'other', userRef: 'wrong' }], hasMore: true, nextPageCursor: 'page-2' })
    expect(await codexTeamContext(app, member, new AbortController().signal)).toEqual({ team: codex, member: 'usr_v1_target' })
  })
  it('does not navigate on a late response after account/route disposal', async () => {
    const controller = new AbortController()
    call.mockImplementation(async () => { controller.abort(); return [{ candidates: [codex] }] })
    await expect(codexTeamContext(app, undefined, controller.signal)).rejects.toThrow()
  })
  it('refuses incomplete or revoked membership instead of opening all member conversations', async () => {
    call.mockImplementation(async operation => operation === 'team.resolve'
      ? [{ candidates: [codex] }] : { team: codex, items: [], hasMore: false })
    await expect(codexTeamContext(app, member, new AbortController().signal)).rejects.toThrow('身份信息暂不可用')
    await expect(codexTeamContext(app, { ...member, jotmoId: '' }, new AbortController().signal)).rejects.toThrow('身份信息暂不可用')
  })
})
