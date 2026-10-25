// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TeamAddMembersDialog } from '../src/client/TeamAddMembersDialog.js'
const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
vi.mock('../src/client/ArkmeAvatar.js', () => ({ ArkmeUserAvatar: ({ label }: { label: string }) => <span role="img" aria-label={label} /> }))
let host: HTMLDivElement, root: Root
const close = vi.fn()
const person = (key: string, extra = {}) => ({ key, candidateRef: `sealed-${key}`, displayName: key, alreadyMember: false, isSelf: false, ...extra })
const page = (items = [person('备注小明'), person('现有成员', { alreadyMember: true })], extra = {}) => ({ items, groups: [], hasMore: false, ...extra })
const mount = async (accountKey = 'prod:90') => act(async () => root.render(<TeamAddMembersDialog accountKey={accountKey} teamRef="team-ref" teamName="即我" onClose={close} />))
function button(label: string) { return [...document.querySelectorAll('button')].find(node => node.textContent === label)! }
function check(label: string) { return document.querySelector<HTMLButtonElement>(`[role="checkbox"][aria-label="${label}"]`)! }
async function search(value: string) { await act(async () => { const input = document.querySelector('input')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }) }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); call.mockReset(); close.mockReset()
  call.mockImplementation(async (op, params) => op === 'team.app.members.add' ? { state: 'backend_pending' }
    : params.source === 'conversations' ? page([person('备注小明')], { groups: [{ sourceRef: 'group-ref', sourceKey: 'group-key', displayName: '同事群', kind: 'group_chat' }] })
      : params.source === 'group' ? page([person('备注小明'), person('新同事')]) : page())
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('keeps selection across sources and group expansion, deduplicates people and disables existing members', async () => {
  await mount(); expect(check('现有成员').disabled).toBe(true)
  await act(async () => check('备注小明').click())
  expect(button('确认添加（1）').disabled).toBe(false)
  await act(async () => button('最近对话与群聊').click())
  expect(check('备注小明').getAttribute('aria-checked')).toBe('true')
  await act(async () => button('同事群').click())
  expect(document.querySelectorAll('[role="checkbox"][aria-checked="true"]')).toHaveLength(2)
  await act(async () => check('新同事').click())
  expect(button('确认添加（2）')).toBeDefined()
  await act(async () => button('确认添加（2）').click())
  expect(call.mock.calls.at(-1)![1]).toMatchObject({ expectedAccountKey: 'prod:90', teamRef: 'team-ref', candidateRefs: ['sealed-备注小明', 'sealed-新同事'] })
  expect(document.body.textContent).toContain('后端接口开发中，开发完成后此功能完整可用。')
  expect(document.body.textContent).toContain('尚未添加成员，已保留本次选择。')
  expect(close).not.toHaveBeenCalled()
  expect(button('确认添加（2）').disabled).toBe(true)
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="取消选择 新同事"]')!.click())
  expect(button('确认添加（1）').disabled).toBe(false)
})

it('searches nicknames/account names and paginates while retaining selected people', async () => {
  vi.useFakeTimers()
  call.mockResolvedValueOnce(page([person('第一位')], { hasMore: true, nextCursor: 'next' }))
    .mockResolvedValueOnce(page([person('后来的人', { nickname: '小明', accountName: 'xiaoming' })]))
  await mount(); await act(async () => check('第一位').click())
  await search('xiaoming')
  await act(async () => { await vi.advanceTimersByTimeAsync(260) })
  expect(check('后来的人')).toBeTruthy(); expect(check('第一位')).toBeNull()
  expect(button('确认添加（1）')).toBeDefined()
  expect(call.mock.calls[1]![1]).toMatchObject({ cursor: 'next', source: 'contacts' })
  await search(''); expect(check('第一位').getAttribute('aria-checked')).toBe('true')
})

it('preserves selection and existing rows on failed page or submission, with explicit retry', async () => {
  call.mockResolvedValueOnce(page([person('第一位')], { hasMore: true, nextCursor: 'next' })).mockRejectedValueOnce(new Error('加载失败'))
  await mount(); await act(async () => check('第一位').click())
  await act(async () => button('加载更多').click())
  expect(check('第一位')).toBeTruthy(); expect(document.querySelector('[role="alert"]')?.textContent).toContain('加载失败')
  call.mockRejectedValueOnce(new Error('权限已变化'))
  await act(async () => button('确认添加（1）').click())
  expect(document.body.textContent).toContain('权限已变化'); expect(button('确认添加（1）').disabled).toBe(false)
  expect(close).not.toHaveBeenCalled()
})

it('cancels stale account reads and resets old selections', async () => {
  let resolve!: (value: unknown) => void
  call.mockReturnValueOnce(new Promise(done => { resolve = done }))
  await mount(); const signal = call.mock.calls[0]![2] as AbortSignal
  await mount('prod:91'); expect(signal.aborted).toBe(true)
  await act(async () => resolve(page([person('旧账号用户')])))
  expect(document.body.textContent).not.toContain('旧账号用户')
  expect(button('确认添加（0）').disabled).toBe(true)
})

it('removes selections that became members during candidate refresh and handles Escape', async () => {
  await mount(); await act(async () => check('备注小明').click())
  call.mockRejectedValueOnce(new Error('已经加入'))
  await act(async () => button('确认添加（1）').click())
  call.mockResolvedValueOnce(page([person('备注小明', { alreadyMember: true })]))
  await act(async () => button('刷新候选列表').click())
  expect(button('确认添加（0）').disabled).toBe(true); expect(check('备注小明').disabled).toBe(true)
  await act(async () => document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(close).toHaveBeenCalledTimes(1)
})
