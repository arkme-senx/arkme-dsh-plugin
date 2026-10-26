// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TeamInternalGroupDialog } from '../src/client/TeamInternalGroupDialog.js'
import { TEAM_GROUP_PENDING_TEXT } from '../src/team-group-contract.js'
import type { ArkmeSourceItem } from '../src/types.js'

const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
const team = { teamRef: 'sealed-team', jotmoId: 'our_team', name: '即我', currentUserRole: 'owner', createdAtMillis: 1, updatedAtMillis: 1 }
const source: ArkmeSourceItem = { kind: 'group_chat', sourceRef: 'group-ref', displayName: '产品群', activeAtMillis: 1, unreadCount: 0 }
let host: HTMLDivElement, root: Root
const mount = async (element: React.ReactNode) => act(async () => root.render(element))
function button(label: string) { const found = [...document.querySelectorAll('button')].find(node => node.textContent === label); if (!found) throw new Error(label); return found }
const click = async (label: string) => act(async () => button(label).click())
const create = () => <TeamInternalGroupDialog accountKey="prod:90" target={{ mode: 'create', teamJotmoId: 'our_team' }} onClose={vi.fn()} />
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  call.mockReset().mockImplementation(async op => op === 'team.app.teams' ? [team] : { state: 'backend_pending' })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('prepares creation without faking a group or membership sync and prevents repeat clicks', async () => {
  await mount(create())
  expect(document.querySelector<HTMLInputElement>('input')!.value).toBe('即我内部群')
  expect(document.body.textContent).toContain(TEAM_GROUP_PENDING_TEXT)
  await act(async () => { button('检查创建条件').click(); button('检查创建条件').click() })
  expect(call.mock.calls.filter(([op]) => op === 'team.app.internal-group.prepare')).toHaveLength(1)
  expect(call.mock.calls.at(-1)).toEqual(['team.app.internal-group.prepare', {
    expectedAccountKey: 'prod:90', teamRef: 'sealed-team', requestUid: expect.any(String), mode: 'create', name: '即我内部群',
  }, expect.any(AbortSignal)])
  expect(document.body.textContent).toContain('尚未创建群聊')
  expect(button('检查创建条件').disabled).toBe(true)
  expect(document.querySelector('[role="dialog"]')!.contains(document.activeElement)).toBe(true)
  expect(call.mock.calls.every(([op]) => ['team.app.teams', 'team.app.internal-group.prepare'].includes(op))).toBe(true)
})

it('requests a linking preview, never removes existing group members or announces linked', async () => {
  await mount(<TeamInternalGroupDialog accountKey="prod:90" target={{ mode: 'link', source }} onClose={vi.fn()} />)
  expect(document.body.textContent).toContain('需新增、移出的成员和历史消息可见范围')
  await click('查看关联影响')
  expect(call.mock.calls.at(-1)![1]).toMatchObject({ mode: 'link', sourceRef: 'group-ref', teamRef: 'sealed-team' })
  expect(document.body.textContent).toContain('尚未关联团队，原群成员和历史消息保持不变')
})

it('does not let an ordinary member create a roster binding', async () => {
  call.mockResolvedValue([{ ...team, currentUserRole: 'member' }])
  await mount(create())
  expect(document.body.textContent).toContain('仅团队所有者或管理员')
  expect(button('检查创建条件').disabled).toBe(true)
  expect(call).toHaveBeenCalledTimes(1)
})

it('keeps network failures distinct from no team and allows retry', async () => {
  call.mockRejectedValueOnce(new Error('团队加载失败'))
  await mount(create())
  expect(document.body.textContent).not.toContain('你尚未加入团队')
  expect(button('检查创建条件').disabled).toBe(true)
  await click('重试')
  expect(document.querySelector<HTMLInputElement>('input')!.value).toBe('即我内部群')
})

it('rejects an unexpected ready result and preserves the request uid for retry', async () => {
  call.mockImplementation(async op => op === 'team.app.teams' ? [team] : { state: 'ready' })
  await mount(create()); await click('检查创建条件'); await click('检查创建条件')
  const requests = call.mock.calls.filter(([op]) => op === 'team.app.internal-group.prepare')
  expect(requests[0]![1].requestUid).toBe(requests[1]![1].requestUid)
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('状态返回异常')
  expect(document.body.textContent).not.toContain('尚未创建群聊')
})

it('aborts an in-flight preparation on account change and ignores its late response', async () => {
  let resolve!: (value: unknown) => void
  call.mockImplementation(async op => op === 'team.app.teams' ? [team] : new Promise(done => { resolve = done }))
  await mount(create()); await click('检查创建条件')
  const signal = call.mock.calls.at(-1)![2] as AbortSignal
  call.mockResolvedValue([])
  await mount(<TeamInternalGroupDialog accountKey="prod:91" target={{ mode: 'link', source }} onClose={vi.fn()} />)
  expect(signal.aborted).toBe(true)
  await act(async () => resolve({ state: 'backend_pending' }))
  expect(document.body.textContent).toContain('你尚未加入团队')
  expect(document.body.textContent).not.toContain('尚未创建群聊')
})

it('keeps Escape working after disabling the checked footer button', async () => {
  const close = vi.fn()
  await mount(<TeamInternalGroupDialog accountKey="prod:90" target={{ mode: 'create', teamJotmoId: 'our_team' }} onClose={close} />)
  await click('检查创建条件')
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(close).toHaveBeenCalledTimes(1)
})
