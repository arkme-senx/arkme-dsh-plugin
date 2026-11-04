// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TeamGroupIdentityPicker, TeamGroupJoinPanel } from '../src/client/TeamGroupControls.js'
import { AddMembersDrawer } from '../src/client/ArkmeGroupChatControls.js'
import { TeamRepresentationBadge, TeamRepresentationAvatar } from '../src/client/TeamRepresentationBadge.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import {subscribeTeamWorkspaceChanges} from '../src/client/team-messaging-events.js'
import { canChooseTeamGroupIdentity, TEAM_GROUP_PENDING_TEXT, type TeamGroupContext } from '../src/team-group-contract.js'
import type { ArkmeSourceItem, ArkmeTeam } from '../src/types.js'

const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
const selection={teamRef:'sealed-team',membershipKind:'member' as const,membershipRevision:3,groupJoinAt:9}
const teams: Array<ArkmeTeam & {representation:typeof selection}> = [{representation:selection, teamRef: 'sealed-team', jotmoId: 'our_team', name: '即我', currentUserRole: 'member', createdAtMillis: 1, updatedAtMillis: 1 }]
const joinContext={state:'ready',teams:teams.map(team=>({...team,key:'stable-team-key',joined:false,revision:0}))}
const eligible: TeamGroupContext = { state: 'ready', membershipPolicy: 'independent', teams }
const source: ArkmeSourceItem = { kind: 'group_chat', sourceRef: 'group-ref', sourceKey: 'chat:group-id', displayName: '产品反馈群', activeAtMillis: 1, unreadCount: 0 }

it.each([true, false])('reuses the Team marker/link and original pure card compact=%s', async compact => {
  const value = { name: '接待团队', jotmoId: 'team' }
  arkmeAuthStore.setAuth({ status: 'authenticated', userId: 90, environment: 'prod' })
  call.mockResolvedValue({ ...value, contact: { state: 'disabled' }, navigation: { kind: 'none' } })
  const rowClick = vi.fn()
  await mount(<div onClick={rowClick}><TeamRepresentationBadge value={value} compact={compact} /></div>)
  const marker = host.querySelector<HTMLButtonElement>('button[aria-label="查看接待团队团队资料"]')!
  expect(marker.title).toContain('代表接待团队发言')
  expect(marker.textContent).toBe(compact ? '' : '接待团队')
  expect(call).not.toHaveBeenCalled()
  await act(async () => marker.click())
  expect(rowClick).not.toHaveBeenCalled()
  expect(call.mock.calls.map(([op]) => op)).toEqual(['team.app.public-card'])
  expect(call.mock.calls[0]![1]).toEqual({ expectedAccountKey: 'prod:90', jotmoId: 'team' })
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('接待团队')
  arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'prod' })
})
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
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); call.mockReset();localStorage.clear()
  call.mockImplementation(async operation => operation === 'team.app.group.context' ? eligible : operation==='team.app.group.join-context'?joinContext:{state:'pending',accessStatus:'unavailable'})
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('requires an explicit team choice and does not add a personal member or fabricate a joined team', async () => {
  await mount(<TeamGroupJoinPanel accountKey="prod:90" source={source} />)
  expect(document.body.textContent).toContain('产品反馈群')
  expect(document.body.textContent).not.toContain(TEAM_GROUP_PENDING_TEXT)
  expect(button('将团队加入群聊').disabled).toBe(true)
  await act(async () => document.querySelector<HTMLButtonElement>('[role="radio"]')!.click())
  await act(async () => { button('将团队加入群聊').click(); button('将团队加入群聊').click() })
  expect(call.mock.calls.filter(([op]) => op === 'team.app.group.join')).toHaveLength(1)
  expect(call.mock.calls.at(-1)).toEqual(['team.app.group.join', { expectedAccountKey: 'prod:90', sourceRef: 'group-ref', teamRef: 'sealed-team', requestUid: expect.any(String),expectedRevision:0 }, expect.any(AbortSignal)])
  expect(document.body.textContent).toContain('等待群管理员审批')
  expect(button('将团队加入群聊').disabled).toBe(true)
  expect(call.mock.calls.every(([op]) => ['team.app.group.join-context', 'team.app.group.join'].includes(op))).toBe(true)
})

it('refreshes the existing workspace owner after a confirmed admission without waiting for SSE',async()=>{
 const changed=vi.fn(),stop=subscribeTeamWorkspaceChanges(changed)
 call.mockImplementation(async operation=>operation==='team.app.group.join-context'?joinContext:{state:'joined',accessStatus:'available'})
 try {
  await mount(<TeamGroupJoinPanel accountKey="prod:90" source={source}/>)
  await act(async()=>document.querySelector<HTMLButtonElement>('[role="radio"]')!.click())
  await click('将团队加入群聊')
  expect(changed).toHaveBeenCalledOnce()
  expect(changed).toHaveBeenCalledWith('prod:90',undefined)
 }finally{stop()}
})

it('retains the join request UID on uncertain failure, and clears an in-flight request when leaving', async () => {
  call.mockImplementation(async operation => operation === 'team.app.group.join-context' ? joinContext : Promise.reject(new Error('网络断开')))
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
  call.mockResolvedValue({ state: 'ready', teams: [] })
  await click('重试'); expect(document.body.textContent).toContain('你尚未加入团队')
  expect(button('将团队加入群聊').disabled).toBe(true)
})

it('selects an actual team without joining or consuming a personal draft',async()=>{
 const onSelect=vi.fn()
 await mount(<><textarea defaultValue="个人草稿"/><TeamGroupIdentityPicker accountKey="prod:90" sourceRef="group-ref" onSelect={onSelect}/></>)
 await click('我')
 const choice=document.querySelector<HTMLButtonElement>('[data-role-action="team:our_team"]')!
 expect(choice.querySelector('[aria-label="我的头像"]')).not.toBeNull()
 await act(async()=>choice.click())
 expect(onSelect).toHaveBeenCalledWith({team:teams[0],selection})
 expect(document.querySelector('textarea')?.value).toBe('个人草稿')
 expect(call.mock.calls.every(([op])=>op==='team.app.group.context')).toBe(true)
})

it('ignores stale identity responses after a group or account switch', async () => {
  const old = deferred(); call.mockReturnValueOnce(old.promise)
  await mount(<TeamGroupIdentityPicker key="old" accountKey="prod:90" sourceRef="old-group" />)
  const signal = call.mock.calls.at(-1)![2] as AbortSignal
  await mount(<TeamGroupIdentityPicker key="new" accountKey="prod:91" sourceRef="new-group" />)
  expect(signal.aborted).toBe(true)
  await act(async () => old.resolve({ state: 'backend_pending', teams }))
  expect(document.body.textContent).not.toContain('即我')
})

it('integrates the team tab into add-members without submitting retained personal or Bot selections', async () => {
  const onAdded = vi.fn(), onClose = vi.fn()
  call.mockImplementation(async operation => operation === 'group.member-candidates' ? { items: [{ candidateRef: 'person-ref', displayName: '联系人甲', relation: 'contact' }], groups: [], groupCandidates: [], mode: 'direct_add', strangerCount: 0 }
    : operation === 'group.bots' ? { items: [] } : operation==='team.app.group.join-context'?joinContext:{state:'pending',accessStatus:'unavailable'})
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
  ['no team', { ...eligible, teams: [] }],
  ['internal roster', { ...eligible, membershipPolicy: 'team_roster' }],
] as Array<[string, TeamGroupContext]>)('shows no identity selector for %s', async (_name, context) => {
  call.mockResolvedValue(context)
  await mount(<TeamGroupIdentityPicker accountKey="prod:90" sourceRef="group-ref" />)
  expect(host.textContent).toBe('')
  expect(call).toHaveBeenCalledTimes(1)
})

it('does not require team group membership or a ready team-send API to offer candidates', () => {
  expect(canChooseTeamGroupIdentity(undefined)).toBe(false)
  expect(canChooseTeamGroupIdentity(eligible)).toBe(true)
  expect(canChooseTeamGroupIdentity({ ...eligible, teams: [] })).toBe(false)
  expect(canChooseTeamGroupIdentity({ ...eligible, membershipPolicy: 'team_roster' })).toBe(false)
})

it('hides the menu after membership is removed on refresh, without polling', async () => {
  await mount(<TeamGroupIdentityPicker accountKey="prod:90" sourceRef="group-ref" />)
  await click('我')
  call.mockResolvedValue({ ...eligible, teams: [] })
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(document.querySelector('[aria-label="选择发言角色"]')).toBeNull()
  expect(host.textContent).toBe('')
  expect(call).toHaveBeenCalledTimes(3)
})

it('retains an explicitly selected identity when membership refresh fails',async()=>{
 call.mockRejectedValue(new Error('temporarily unavailable'));const onSelect=vi.fn()
 await mount(<TeamGroupIdentityPicker accountKey="prod:90" sourceRef="group-ref" value={{team:teams[0]!,selection}} onSelect={onSelect}/>)
 expect(document.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!.title).toContain('即我');expect(onSelect).not.toHaveBeenCalled()
 await click('我');await act(async()=>document.querySelector<HTMLButtonElement>('[data-role-action="personal"]')!.click())
 expect(onSelect).toHaveBeenCalledWith(undefined)
})

it('preserves the original compact self trigger and team menu wording after a real selection', async () => {
  await mount(<TeamGroupIdentityPicker accountKey="prod:90" sourceRef="group-ref" selfName="真实姓名" value={{team:teams[0]!,selection}} onSelect={vi.fn()} />)
  const trigger=document.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!
  expect(trigger.textContent).toBe('我')
  expect(trigger.title).toContain('即我')
  expect(trigger.title).toContain('代表团队发言')
  await act(async()=>trigger.click())
  expect(document.querySelector('[data-role-action="team:our_team"]')?.textContent).toContain('我 · 即我团队')
  expect(document.querySelector('[data-role-action="team:our_team"]')?.textContent).not.toContain('真实姓名')
})
it('preserves the explicit retry action without clearing a frozen selected identity', async () => {
  call.mockRejectedValue(new Error('读取失败'))
  const onSelect=vi.fn()
  await mount(<TeamGroupIdentityPicker accountKey="prod:90" sourceRef="group-ref" value={{team:teams[0]!,selection}} onSelect={onSelect}/>)
  expect(button('重试')).toBeDefined()
  call.mockResolvedValue(eligible)
  await click('重试')
  expect(onSelect).not.toHaveBeenCalled()
  expect(document.querySelector('[role="status"]')).toBeNull()
  expect(document.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!.textContent).toBe('我')
})

it('decorates the existing avatar with one corner marker and keeps personal avatars unchanged', async () => {
  await mount(<TeamRepresentationAvatar value={{name:'团队',jotmoId:'team'}}><span data-personal-avatar>作者</span></TeamRepresentationAvatar>)
  expect(host.querySelector('[data-personal-avatar]')?.textContent).toBe('作者')
  expect(host.querySelectorAll('[data-arkme-team-representation="marker"]')).toHaveLength(1)
  expect(host.querySelector('[data-arkme-team-representation="label"]')).toBeNull()
  await mount(<TeamRepresentationAvatar><span data-personal-avatar>作者</span></TeamRepresentationAvatar>)
  expect(host.querySelector('[data-personal-avatar]')?.textContent).toBe('作者')
  expect(host.querySelector('[data-arkme-team-representation]')).toBeNull()
})

it('Team marker keyboard activation does not also select its enclosing extension row', async () => {
  const onRowKeyDown = vi.fn()
  await mount(<div onKeyDown={onRowKeyDown}><TeamRepresentationBadge value={{name:'团队',jotmoId:'team'}} compact /></div>)
  const marker = host.querySelector('button')!
  for (const key of ['Enter',' ']) await act(async () => marker.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true})))
  expect(onRowKeyDown).not.toHaveBeenCalled()
  await act(async () => marker.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
  expect(onRowKeyDown).toHaveBeenCalledTimes(1)
})

it('restores the same join intent after the panel closes, source refs rotate and the server has not yet found the receipt',async()=>{
  call.mockImplementation(async operation=>operation==='team.app.group.join-context'?joinContext:operation==='team.app.group.status'?{state:'not_found',accessStatus:'unavailable'}:Promise.reject(new Error('response lost')))
  const stable={...source,sourceKey:'stable-group-key'}
  await mount(<TeamGroupJoinPanel accountKey="prod:90" source={stable}/>)
  await act(async()=>document.querySelector<HTMLButtonElement>('[role="radio"]')!.click())
  await click('将团队加入群聊')
  const first=call.mock.calls.find(([op])=>op==='team.app.group.join')![1]
  await mount(<div>closed</div>)
  await mount(<TeamGroupJoinPanel accountKey="prod:90" source={{...stable,sourceRef:'rotated-ref'}}/>)
  expect(document.body.textContent).toContain('此前的入群申请已保留')
  await click('核对此前申请');await click('将团队加入群聊')
  const last=call.mock.calls.filter(([op])=>op==='team.app.group.join').at(-1)![1]
  expect(last).toMatchObject({requestUid:first.requestUid,expectedRevision:first.expectedRevision,sourceRef:'rotated-ref'})
})
