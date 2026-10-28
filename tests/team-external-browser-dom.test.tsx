// @vitest-environment jsdom
import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
const mock = vi.hoisted(() => ({call: vi.fn()}))
vi.mock('../src/client/api.js', () => ({callArkme: mock.call}))
vi.mock('../src/client/ArkmeRichContent.js', () => ({ArkmeMessageContent: ({item}: any) => <p>{item.textContent}</p>}))
import {TeamExternalChats} from '../src/client/TeamExternalChats.js'
const shares = [
  {key: 'a', ref: 'grant-a', teamKey: 'team', teamRef: 'team-ref', sharerKey: 'person-a', sharerName: '小林', peerName: '客户甲', own: true},
  {key: 'b', ref: 'grant-b', teamKey: 'team', teamRef: 'team-ref', sharerKey: 'person-b', sharerName: '小周', peerName: '客户乙', own: false},
]
const message = (id: number, side = id % 2 ? 'peer' : 'sharer') => ({itemUid: `m-${id}`, senderName: '同名用户', senderSide: side, isMe: false, sendAtMillis: 1700000000000 + id * 1000, status: 1, textContent: `消息 ${id}`, version: 1, contentBlocks: []})
const timeline = (items = [message(3), message(2), message(1)]) => ({items, mediaUrls: {}, hasMore: false, beforeSeq: 1})
let host: HTMLDivElement, root: Root
const close = vi.fn()
const text = () => document.body.textContent ?? ''
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label || node.getAttribute('aria-label') === label)!
const click = async (label: string) => {await act(async () => button(label).click())}
const render = async (teamRef = 'team-ref') => {await act(async () => root.render(<TeamExternalChats teamRef={teamRef} teamKey="stable-team" teamName="设计团队" onClose={close}/>))}
const writes = () => mock.call.mock.calls.filter(([op]) => op.endsWith('.unshare'))
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  mock.call.mockImplementation(async op => op.endsWith('.list') ? {items: shares, hasMore: false} : timeline())
  close.mockReset()
})
afterEach(() => {act(() => root.unmount()); host.remove(); mock.call.mockReset(); vi.useRealTimers(); vi.unstubAllGlobals()})
it('keeps one browser frame for loading and loaded rows without the explanatory interstitial', async () => {
  let finish!: (value: unknown) => void
  mock.call.mockImplementation(() => new Promise(resolve => {finish = resolve}))
  await render()
  const frame = document.querySelector('.arkme-team-external-browser')
  expect(document.querySelector('.arkme-external-skeleton')).not.toBeNull()
  expect(text()).not.toContain('成员主动共享的个人私聊')
  expect(text()).not.toContain('加载中…')
  await act(async () => finish({items: shares, hasMore: false}))
  expect(document.querySelector('.arkme-team-external-browser')).toBe(frame)
  expect(document.querySelector('.arkme-external-skeleton')).toBeNull()
  expect(text()).toContain('小林')
  expect(button('查看与 客户甲 的私聊')).toBeDefined()
  expect(button('取消与 客户乙 的共享')).toBeUndefined()
})
it('uses sender roles, avatars and bubbles for two same-named participants while remaining read-only', async () => {
  await render(); await click('查看与 客户甲 的私聊')
  expect(document.querySelectorAll('.arkme-external-message[data-side="left"]')).toHaveLength(2)
  expect(document.querySelectorAll('.arkme-external-message[data-side="right"]')).toHaveLength(1)
  expect(document.querySelectorAll('.arkme-external-message > .arkme-external-avatar')).toHaveLength(3)
  expect(document.querySelectorAll('.arkme-external-bubble')).toHaveLength(3)
  expect(document.querySelector('[role="log"]')?.textContent).toContain('消息 3')
  expect(document.querySelector('textarea,[contenteditable="true"]')).toBeNull()
  expect(writes()).toHaveLength(0)
  await click('返回共享私聊列表')
  expect(document.querySelector('.arkme-external-workspace')?.getAttribute('data-reading')).toBe('false')
  expect(text()).toContain('客户甲')
})
it('opens a single shared chat directly without an extra selection step', async () => {
  mock.call.mockImplementation(async op => op.endsWith('.list') ? {items: [shares[0]], hasMore: false} : timeline())
  await render()
  expect(document.querySelector('.arkme-external-workspace')?.getAttribute('data-reading')).toBe('true')
  expect(text()).toContain('消息 3')
  await click('返回共享私聊列表')
  expect(document.querySelector('.arkme-external-workspace')?.getAttribute('data-reading')).toBe('false')
})
it('requires an explicit confirmation before revoking a grant', async () => {
  await render(); await click('查看与 客户甲 的私聊')
  await click('取消与 客户甲 的共享')
  expect(writes()).toHaveLength(0)
  expect(text()).toContain('取消共享？')
  await click('确认取消共享')
  expect(writes()).toHaveLength(1)
  expect(writes()[0]).toEqual(['team.app.external.unshare', {shareRef: 'grant-a'}, expect.any(AbortSignal)])
  expect(button('查看与 客户甲 的私聊')).toBeUndefined()
  expect(text()).not.toContain('消息 3')
})
it('keeps the loaded conversation during a transient refresh but clears it on revoked access', async () => {
  vi.useFakeTimers()
  let state = 'ok'
  mock.call.mockImplementation(async op => {
    if (op.endsWith('.list')) return {items: shares, hasMore: false}
    if (state !== 'ok') throw Object.assign(new Error(state), {body: {code: state}})
    return timeline()
  })
  await render(); await click('查看与 客户甲 的私聊')
  state = 'local-network-unavailable'
  await act(async () => {await vi.advanceTimersByTimeAsync(15000)})
  expect(text()).toContain('消息 3')
  expect(text()).toContain('local-network-unavailable')
  state = 'team-external_chat_not_accessible'
  await act(async () => {await vi.advanceTimersByTimeAsync(15000)})
  expect(text()).not.toContain('消息 3')
  expect(text()).toContain('team-external_chat_not_accessible')
})
it('deduplicates history pages and preserves the current messages when loading older messages fails', async () => {
  let fail = true
  mock.call.mockImplementation(async (op, params) => {
    if (op.endsWith('.list')) return {items: shares, hasMore: false}
    if (params.beforeSeq) {
      if (fail) throw Object.assign(new Error('暂时离线'), {body: {code: 'local-network-unavailable'}})
      return {...timeline([message(2), message(1)]), hasMore: false}
    }
    return {...timeline([message(3), message(2)]), hasMore: true, beforeSeq: 2}
  })
  await render(); await click('查看与 客户甲 的私聊'); await click('查看更早消息')
  expect(text()).toContain('消息 3')
  expect(text()).toContain('暂时离线')
  fail = false; await click('重试')
  expect(document.querySelectorAll('[data-message-key]')).toHaveLength(3)
  expect([...document.querySelectorAll('[data-message-key]')].map(node => node.getAttribute('data-message-key'))).toEqual(['m-1', 'm-2', 'm-3'])
})
it('preserves a selected conversation when a sealed team reference rotates', async () => {
  await render(); await click('查看与 客户甲 的私聊')
  const frame = document.querySelector('.arkme-team-external-browser')
  await render('fresh-team-ref')
  expect(document.querySelector('.arkme-team-external-browser')).toBe(frame)
  expect(document.querySelector('.arkme-external-workspace')?.getAttribute('data-reading')).toBe('true')
  expect(text()).toContain('消息 3')
})
it('bounds initial directory loading and offers a retry', async () => {
  vi.useFakeTimers()
  mock.call.mockImplementation(() => new Promise(() => {}))
  await render()
  const signal = mock.call.mock.calls[0]![2] as AbortSignal
  await act(async () => {await vi.advanceTimersByTimeAsync(30000)})
  expect(signal.aborted).toBe(true)
  expect(document.querySelector('.arkme-external-skeleton')).toBeNull()
  expect(text()).toContain('读取超时')
  expect(button('重试').disabled).toBe(false)
})
it('does not resubmit an uncertain revoke and reloads the directory to reconcile it', async () => {
  let revoked = false
  mock.call.mockImplementation(async op => {
    if (op.endsWith('.list')) return {items: revoked ? [shares[1]] : shares, hasMore: false}
    if (op.endsWith('.unshare')) {revoked = true; throw Object.assign(new Error('response lost'), {body: {code: 'local-network-unavailable'}})}
    return timeline()
  })
  await render(); await click('取消与 客户甲 的共享'); await click('确认取消共享')
  expect(writes()).toHaveLength(1)
  expect(text()).toContain('保存结果尚未确认')
  await click('重新加载')
  expect(button('查看与 客户甲 的私聊')).toBeUndefined()
  expect(writes()).toHaveLength(1)
})
