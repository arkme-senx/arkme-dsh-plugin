// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: (...args: unknown[]) => mocks.call(...args) }))
import { WorldSubscribeButton, WorldSubscriptionManager, WorldSubscriberNoticeActions } from '../src/client/WorldSubscriptions.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
let host: HTMLDivElement, root: Root
const click = async (text: string) => { await act(async () => { const button = [...document.querySelectorAll('button')].find(b => b.textContent === text || b.getAttribute('aria-label') === text); expect(button, text).toBeDefined(); button!.click() }) }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 8 })
  mocks.call.mockReset().mockResolvedValue({ subscribed: false })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => { root.unmount(); arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' }) }); host.remove(); vi.unstubAllGlobals() })
it('retries the same uncertain subscribe command and exposes cancellation in the subscribed menu', async () => {
  let tries = 0
  mocks.call.mockImplementation(async (_op, p) => { if (p.action === 'state') return { subscribed: false }; if (++tries === 1) throw new Error('结果未知'); return { subscribed: p.active } })
  await act(async () => root.render(<WorldSubscribeButton target={{ kind: 'person', userId: 9 }} />))
  await click('＋订阅'); expect(host.textContent).toContain('结果未知')
  await click('重试')
  const sets = mocks.call.mock.calls.filter(c => c[1].action === 'set')
  expect(sets).toHaveLength(2); expect(sets[0]![1].requestUid).toBe(sets[1]![1].requestUid)
  await click('已订阅 ▾'); await click('取消订阅')
  expect(host.textContent).toContain('＋订阅')
  expect(mocks.call.mock.calls.filter(c => c[1].action === 'set').at(-1)![1].active).toBe(false)
})
it('hides self subscription and discards a stale account response', async () => {
  await act(async () => root.render(<WorldSubscribeButton target={{ kind: 'person', userId: 8 }} />))
  expect(host.textContent).toBe(''); expect(mocks.call).not.toHaveBeenCalled()
  let resolve!: (v: unknown) => void
  mocks.call.mockImplementation(() => new Promise(r => { resolve = r }))
  await act(async () => root.render(<WorldSubscribeButton target={{ kind: 'person', userId: 9 }} />))
  await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 10 }); resolve({ subscribed: true }) })
  expect(host.textContent).not.toContain('已订阅')
})
it('shows only managed team scopes and requests incoming data for the selected team', async () => {
  mocks.call.mockImplementation(async (op, p) => op === 'team.app.teams' ? [
    { teamRef: 'ordinary', jotmoId: 'ordinary', name: '普通成员团队', currentUserRole: 'member' },
    { teamRef: 'managed', jotmoId: 'managed', name: '管理团队', currentUserRole: 'admin' },
  ] : { items: [], hasMore: false })
  await act(async () => root.render(<WorldSubscriptionManager account="test:8" onClose={() => {}} />))
  await click('订阅我的')
  const select = document.querySelector<HTMLSelectElement>('select')!
  expect(select.textContent).toContain('管理团队'); expect(select.textContent).not.toContain('普通成员团队')
  await act(async () => { select.value = 'managed'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(mocks.call.mock.calls.filter(c => c[1].action === 'query').at(-1)![1].incoming).toEqual({ kind: 'team', teamRef: 'managed' })
})
it('does not fall back to personal contact for an unavailable team notice', async () => {
  await act(async () => root.render(<WorldSubscriberNoticeActions account="test:8" notice={{ id: 'notice', kind: 'subscriber', subject: { kind: 'team', id: '1', name: '团队暂不可用', available: false }, actor: { userId: 9, name: '用户' }, at: 100, unread: true, readRef: 'receipt', scopeKey: 'team:1', sequence: 1 }} />))
  expect(host.textContent).toBe('团队暂不可用'); expect(host.querySelector('button')).toBeNull(); expect(mocks.call).not.toHaveBeenCalled()
})

it('opens a personal subscriber list directly from its notification and avoids per-row state reads', async () => {
  mocks.call.mockImplementation(async (op, p) => op === 'team.app.teams' ? [] : p.action === 'query' ? { items: [], hasMore: false } : { subscribed: true })
  await act(async () => root.render(<WorldSubscriberNoticeActions account="test:8" notice={{ id: 'notice', kind: 'subscriber', subject: { kind: 'person', id: '8', name: '我', available: true, userId: 8 }, actor: { userId: 9, name: '用户' }, at: 100, unread: true, readRef: 'receipt', scopeKey: 'person:8', sequence: 1 }} />))
  await click('订阅者名单')
  expect(mocks.call.mock.calls.find(c => c[1]?.action === 'query')?.[1].incoming).toEqual({ kind: 'self' })
  await act(async () => root.render(<WorldSubscribeButton target={{ kind: 'person', id: '9', userId: 9, name: '用户', available: true }} initialSubscribed />))
  expect(host.textContent).toContain('已订阅')
  expect(mocks.call.mock.calls.filter(c => c[1]?.action === 'state')).toHaveLength(0)
})
