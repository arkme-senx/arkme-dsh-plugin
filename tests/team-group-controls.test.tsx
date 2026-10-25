// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TeamGroupIdentityPicker, TeamGroupJoinPanel } from '../src/client/TeamGroupControls.js'
import { AddMembersDrawer } from '../src/client/ArkmeGroupChatControls.js'
import { canChooseTeamGroupIdentity, TEAM_GROUP_PENDING_TEXT, type TeamGroupSpeakingEligibility } from '../src/team-group-contract.js'
import type { ArkmeSourceItem } from '../src/types.js'

const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
const teams = [{ teamRef: 'sealed-team', jotmoId: 'our_team', name: '即我', currentUserRole: 'member', createdAtMillis: 1, updatedAtMillis: 1 }]
const eligible: TeamGroupSpeakingEligibility = { state: 'ready', membershipPolicy: 'independent', personalCanSend: true, teams: [{ jotmoId: 'our_team', membershipState: 'active', canSend: true }] }
const source: ArkmeSourceItem = { kind: 'group_chat', sourceRef: 'group-ref', sourceKey: 'chat:group-id', displayName: '产品反馈群', activeAtMillis: 1, unreadCount: 0 }
let host: HTMLDivElement, root: Root
const mount = async (element: React.ReactNode) => act(async () => root.render(element))
function button(text: string) {
  const found = [...document.querySelectorAll('button')].find(node => node.textContent === text)
  if (!found) throw new Error(`Missing button: ${text}`)
  return found
}
const click = async (label: string) => act(async () => button(label).click())
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); call.mockReset()
  call.mockImplementation(async operation => operation === 'team.app.group.context' ? { state: 'backend_pending', teams } : { state: 'backend_pending' })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('requires an explicit team choice and does not add a personal member or fabricate a joined team', async () => {
  await mount(<TeamGroupJoinPanel accountKey="prod:90" source={source} />)
  expect(document.body.textContent).toContain('产品反馈群')
  expect(document.body.textContent).toContain(TEAM_GROUP_PENDING_TEXT)
  expect(button('将团队加入群聊').disabled).toBe(true)
  await act(async () => document.querySelector<HTMLButtonElement>('[role="radio"]')!.click())
  await act(async () => { button('将团队加入群聊').click(); button('将团队加入群聊').click() })
  expect(call.mock.calls.filter(([op]) => op === 'team.app.group.join')).toHaveLength(1)
  expect(call.mock.calls.at(-1)).toEqual(['team.app.group.join', { expectedAccountKey: 'prod:90', sourceRef: 'group-ref', teamRef: 'sealed-team', requestUid: expect.any(String) }, expect.any(AbortSignal)])
  expect(document.body.textContent).toContain('尚未将团队加入群聊')
  expect(button('将团队加入群聊').disabled).toBe(true)
  expect(call.mock.calls.every(([op]) => ['team.app.group.context', 'team.app.group.join'].includes(op))).toBe(true)
})

it('retains the join request UID on uncertain failure, and clears an in-flight request when leaving', async () => {
  call.mockImplementation(async operation => operation === 'team.app.group.context' ? { state: 'backend_pending', teams } : Promise.reject(new Error('网络断开')))
  await mount(<TeamGroupJoinPanel accountKey="prod:90" source={source} />)
  await act(async () => document.querySelector<HTMLButtonElement>('[role="radio"]')!.click())
  await click('将团队加入群聊'); await click('将团队加入群聊')
  const joins = call.mock.calls.filter(([op]) => op === 'team.app.group.join')
  expect(joins).toHaveLength(2); expect(joins[0]![1].requestUid).toBe(joins[1]![1].requestUid)
  const wait = deferred(); call.mockReturnValue(wait.promise)
  await click('将团队加入群聊'); const signal = call.mock.calls.at(-1)![2] as AbortSignal
  await mount(<div>离开</div>); expect(signal.aborted).toBe(true)
  await act(async () => wait.resolve({ state: 'backend_pending' }))
  expect(host.textContent).toBe('离开')
})

it('distinguishes no membership from a failed team read, with a retry', async () => {
  call.mockRejectedValueOnce(new Error('团队读取失败'))
  await mount(<TeamGroupJoinPanel accountKey="prod:90" source={source} />)
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('团队读取失败')
  expect(document.body.textContent).not.toContain('你尚未加入团队')
  call.mockResolvedValue({ state: 'backend_pending', teams: [] })
  await click('重试'); expect(document.body.textContent).toContain('你尚未加入团队')
  expect(button('将团队加入群聊').disabled).toBe(true)
})

it('loads group identities only on open and keeps the personal identity after selecting a pending team', async () => {
  await mount(<><textarea defaultValue="个人草稿" /><TeamGroupIdentityPicker eligibility={eligible} accountKey="prod:90" sourceRef="group-ref" /></>)
  expect(call).not.toHaveBeenCalled()
  expect(document.querySelector('[aria-label="群聊发言身份：我"]')?.textContent).toBe('我')
  await click('我'); expect(call).toHaveBeenCalledTimes(1)
  const teamChoice = document.querySelector<HTMLButtonElement>('[data-role-action="team:our_team"]')!
  expect(teamChoice.textContent).toBe('我 · 即我团队代表团队发言')
  expect(teamChoice.querySelector('[aria-label="我的头像"]')).not.toBeNull()
  expect(teamChoice.querySelector('[aria-label="即我团队身份"]')).not.toBeNull()
  expect(teamChoice.querySelector('.arkme-team-name-avatar')).toBeNull()
  await act(async () => document.querySelector<HTMLButtonElement>('[data-role-action="team:our_team"]')!.click())
  expect(document.body.textContent).toContain('尚未切换，仍以个人身份发送')
  expect(document.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('个人草稿')
  expect(document.querySelector('[data-role-action="personal"]')?.getAttribute('aria-pressed')).toBe('true')
  expect(document.querySelector('[data-role-action="team:our_team"]')?.getAttribute('aria-pressed')).toBe('false')
  expect(call.mock.calls.map(([op]) => op)).toEqual(['team.app.group.context'])
  await act(async () => document.querySelector('[aria-label="选择发言角色"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(document.querySelector('[aria-label="选择发言角色"]')).toBeNull()
})

it('ignores stale identity responses after a group or account switch', async () => {
  const old = deferred(); call.mockReturnValueOnce(old.promise)
  await mount(<TeamGroupIdentityPicker eligibility={eligible} key="old" accountKey="prod:90" sourceRef="old-group" />)
  await click('我'); const signal = call.mock.calls.at(-1)![2] as AbortSignal
  await mount(<TeamGroupIdentityPicker eligibility={eligible} key="new" accountKey="prod:91" sourceRef="new-group" />)
  expect(signal.aborted).toBe(true)
  await act(async () => old.resolve({ state: 'backend_pending', teams }))
  expect(document.body.textContent).not.toContain('即我')
})

it('integrates the team tab into add-members without submitting retained personal or Bot selections', async () => {
  const onAdded = vi.fn(), onClose = vi.fn()
  call.mockImplementation(async operation => operation === 'group.member-candidates' ? { items: [{ candidateRef: 'person-ref', displayName: '联系人甲', relation: 'contact' }], groups: [], groupCandidates: [], mode: 'direct_add', strangerCount: 0 }
    : operation === 'group.bots' ? { items: [] } : { state: 'backend_pending', teams })
  await mount(<AddMembersDrawer accountScope="prod:90" source={source} open onAdded={onAdded} onClose={onClose} onError={vi.fn()} />)
  expect(document.querySelectorAll('[role="tab"]')).toHaveLength(3)
  await click('联系人甲'); expect(button('确认添加（1）').disabled).toBe(false)
  await click('Bot'); expect(document.body.textContent).toContain('当前没有可添加到本群的 Bot')
  await click('团队'); expect(document.querySelector('[aria-label="添加团队成员"]')).not.toBeNull()
  await act(async () => document.querySelector<HTMLButtonElement>('[role="radio"]')!.click())
  await click('将团队加入群聊')
  expect(onAdded).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled()
  expect(call.mock.calls.some(([op]) => ['group.members.add', 'group.bot.add'].includes(op))).toBe(false)
  await click('联系人'); expect(button('确认添加（1）').disabled).toBe(false)
})


it.each([
  ['unknown', undefined],
  ['pending', { ...eligible, state: 'backend_pending' }],
  ['internal roster', { ...eligible, membershipPolicy: 'team_roster' }],
  ['personal only', { ...eligible, teams: [] }],
  ['team only', { ...eligible, personalCanSend: false }],
  ['pending membership', { ...eligible, teams: [{ ...eligible.teams[0]!, membershipState: 'pending' }] }],
  ['removed membership', { ...eligible, teams: [{ ...eligible.teams[0]!, membershipState: 'removed' }] }],
  ['no delegation', { ...eligible, teams: [{ ...eligible.teams[0]!, canSend: false }] }],
] as Array<[string, TeamGroupSpeakingEligibility | undefined]>)('shows no identity selector or extra requests for %s', async (_name, eligibility) => {
  await mount(<TeamGroupIdentityPicker accountKey="prod:90" sourceRef="group-ref" {...(eligibility ? { eligibility } : {})} />)
  expect(host.textContent).toBe('')
  expect(call).not.toHaveBeenCalled()
})

it('counts only distinct authorized teams and hides an open selector when permission is revoked', async () => {
  expect(canChooseTeamGroupIdentity({ ...eligible, personalCanSend: false, teams: [...eligible.teams, ...eligible.teams] })).toBe(false)
  expect(canChooseTeamGroupIdentity({ ...eligible, personalCanSend: false, teams: [...eligible.teams, { ...eligible.teams[0]!, jotmoId: 'second' }] })).toBe(true)
  await mount(<TeamGroupIdentityPicker eligibility={eligible} accountKey="prod:90" sourceRef="group-ref" />)
  await click('我')
  await mount(<TeamGroupIdentityPicker eligibility={{ ...eligible, teams: [] }} accountKey="prod:90" sourceRef="group-ref" />)
  expect(document.querySelector('[aria-label="选择发言角色"]')).toBeNull()
  expect(host.textContent).toBe('')
})
