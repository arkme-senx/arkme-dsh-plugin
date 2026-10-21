// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TeamReceiptDetails } from '../src/client/TeamReadReceipts.js'
import { TeamConversationMessage } from '../src/client/TeamConversationMessage.js'
import type { TeamMessage, TeamReceipts } from '../src/team-app-contract.js'
import { emptyTeamReceipt, type TeamReceiptState, type TeamReceiptStore } from '../src/client/team-read-receipts.js'

vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
const message: TeamMessage = { ref: 'ref', key: 'message', seq: 1, revision: 1, side: 'external', sender: { nickname: '外部联系人' }, own: false,
  state: 'published', createdAt: 1, canEdit: false, canDelete: false, version: 1, contentStatus: 'available', media: [],
  content: { text_content: '消息正文', template_kind: 1 } }
const receipts = (read: number, total = 3): TeamReceipts => ({ hasMore: false, senderExcluded: true,
  members: Array.from({ length: total }, (_, i) => ({ key: String(i), nickname: `成员${i}`, read: i < read })) })
let root: Root, host: HTMLDivElement, state: TeamReceiptState, observer: IntersectionObserverCallback
const listeners = new Set<() => void>(), onReceipts = vi.fn(), onDetail = vi.fn(), unwatch = vi.fn(), watch = vi.fn(() => unwatch)
const store = { subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  get: () => state, watch } as unknown as TeamReceiptStore
async function update(next: TeamReceiptState) { await act(async () => { state = next; for (const listener of listeners) listener() }) }
async function render(overrides: Partial<TeamMessage> = {}, showReceipts = true) {
  await act(async () => root.render(<TeamConversationMessage message={{ ...message, ...overrides }} avatar={<span />} writable showReceipts={showReceipts}
    receiptStore={store} busy={false} onEdit={() => {}} onReceipts={onReceipts} onDetail={onDetail} onError={() => {}} />))
}
const indicator = () => host.querySelector('[data-arkme-read-receipt-indicator]')
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: IntersectionObserverCallback) { observer = callback } observe() {} disconnect() {} })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  state = emptyTeamReceipt; listeners.clear(); vi.clearAllMocks()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

it.each([[0, 'unread', ''], [2, 'partial-read', '2'], [3, 'all-read', '']] as const)('places %s team readers beside the incoming bubble using group receipt states', async (read, expected, count) => {
  state = { value: receipts(read), loading: false, at: 1 }; await render()
  const bubble = host.querySelector('.arkme-timed-bubble')!, control = bubble.nextElementSibling!, button = control.querySelector('button')!
  expect(control.hasAttribute('data-arkme-read-receipt')).toBe(true)
  expect((bubble.parentElement as HTMLElement).style.alignItems).toBe('flex-end')
  expect(indicator()?.getAttribute('data-arkme-read-receipt-indicator')).toBe(expected)
  expect(indicator()?.textContent).toBe(count)
  expect(button.style.padding).toBe('0px 0px 0px 6px')
  expect(button.getAttribute('aria-label')).toContain(`团队已读 ${read}/3`)
  expect(host.querySelector('.team-receipt-badge')).toBeNull()
  await act(async () => button.click())
  expect(onReceipts).toHaveBeenCalledWith(button)
  expect(onDetail).not.toHaveBeenCalled()
})

it('preserves the same bubble and accessory as visible receipts load and refresh', async () => {
  await render(); const bubble = host.querySelector('.arkme-timed-bubble'), control = bubble!.nextElementSibling
  expect(indicator()?.getAttribute('data-arkme-read-receipt-indicator')).toBe('placeholder')
  observer([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver)
  expect(watch).toHaveBeenCalledWith(expect.objectContaining({ key: message.key }))
  await update({ value: receipts(2), loading: false, at: 1 })
  await update({ value: receipts(3), loading: false, at: 2 })
  expect(host.querySelector('.arkme-timed-bubble')).toBe(bubble)
  expect(bubble!.nextElementSibling).toBe(control)
  expect(indicator()?.getAttribute('data-arkme-read-receipt-indicator')).toBe('all-read')
  observer([{ isIntersecting: false }] as IntersectionObserverEntry[], {} as IntersectionObserver)
  expect(unwatch).toHaveBeenCalledOnce()
})

it.each([
  { ...receipts(3), hasMore: true },
  { ...receipts(3), senderExcluded: false },
  { ...receipts(3), members: [{ key: '1' }] },
  receipts(0, 0),
])('does not show an all-read tick for incomplete or empty recipient data', async value => {
  state = { value, loading: false, at: 1 }; await render()
  expect(indicator()?.getAttribute('data-arkme-read-receipt-indicator')).toBe('placeholder')
})

it('keeps failure inspectable and preserves known counts during a failed refresh', async () => {
  state = { error: '网络失败', loading: false, at: 1 }; await render()
  expect(indicator()?.getAttribute('data-arkme-read-receipt-indicator')).toBe('error')
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="查看阅读状态：阅读状态待更新"]')!.click())
  expect(onReceipts).toHaveBeenCalledOnce()
  await update({ ...state, value: receipts(2) })
  expect(indicator()?.getAttribute('data-arkme-read-receipt-indicator')).toBe('partial-read')
  expect(indicator()?.textContent).toBe('2')
})

it('keeps outgoing external-contact state separate and never exposes team readers to external viewers', async () => {
  state = { value: { ...receipts(3), visitorRead: true }, loading: false, at: 1 }
  await render({ side: 'team', own: true })
  expect(host.querySelector('[aria-label="查看阅读状态：对方已读 · 团队已读 3/3"]')).not.toBeNull()
  expect(indicator()?.textContent).toBe('3')
  await render({}, false)
  expect(host.querySelector('.team-receipt-badge')).toBeNull()
  expect(indicator()).toBeNull()
  await render({ own: true, recipientRead: false }, false)
  expect(indicator()?.getAttribute('data-arkme-read-receipt-indicator')).toBe('unread')
  expect(host.textContent).not.toContain('团队已读')
})


it.each([false, true])('keeps the outgoing circle left of the bubble and colors it by visitor read=%s', async visitorRead => {
  state = { value: { ...receipts(2), visitorRead }, loading: false, at: 1 }
  await render({ side: 'team', own: true })
  const bubble = host.querySelector('.arkme-timed-bubble')!, control = bubble.previousElementSibling!
  expect(control.hasAttribute('data-arkme-read-receipt')).toBe(true)
  expect(bubble.nextElementSibling).toBeNull()
  expect(indicator()?.getAttribute('data-arkme-read-receipt-indicator')).toBe('count')
  expect(indicator()?.getAttribute('data-arkme-read-receipt-tone')).toBe(visitorRead ? 'info' : 'neutral')
  expect(indicator()?.textContent).toBe('2')
  expect(indicator()?.querySelector('path')).toBeNull()
  await act(async () => control.querySelector<HTMLButtonElement>('button')!.click())
  expect(onReceipts).toHaveBeenCalledWith(control.querySelector('button'))
})

it('retains a numeric ring for zero and all team readers, independent of visitor state', async () => {
  state = { value: { ...receipts(0), visitorRead: true }, loading: false, at: 1 }
  await render({ side: 'team', own: true })
  const bubble = host.querySelector('.arkme-timed-bubble'), control = bubble!.previousElementSibling
  expect(indicator()?.textContent).toBe('0')
  await update({ value: { ...receipts(3), visitorRead: false }, loading: false, at: 2 })
  expect(indicator()?.textContent).toBe('3')
  expect(indicator()?.getAttribute('data-arkme-read-receipt-tone')).toBe('neutral')
  expect(host.querySelector('.arkme-timed-bubble')).toBe(bubble)
  expect(bubble!.previousElementSibling).toBe(control)
  await render({ side: 'team', own: false })
  expect(host.querySelector('.arkme-timed-bubble')!.nextElementSibling?.hasAttribute('data-arkme-read-receipt')).toBe(true)
})

it.each([
  receipts(3),
  { ...receipts(3), visitorRead: true, hasMore: true },
  { ...receipts(3), visitorRead: true, senderExcluded: false },
])('keeps unknown visitor or team count as a placeholder, not an unread circle', async value => {
  state = { value, loading: false, at: 1 }
  await render({ side: 'team', own: true })
  expect(indicator()?.getAttribute('data-arkme-read-receipt-indicator')).toBe('placeholder')
  expect(indicator()?.textContent).toBe('')
})

it('orders readers by their latest time, dims unread members with a dot, and keeps unknown explicit', async () => {
  const today = new Date(); today.setHours(14, 12, 0, 0)
  const value: TeamReceipts = { hasMore: false, senderExcluded: true, visitorRead: false, members: [
    { key: 'u', nickname: '未读甲', read: false },
    { key: 'a', nickname: '早读乙', read: true, readAt: today.getTime() - 60_000 },
    { key: 'b', nickname: '晚读丙', read: true, readAt: today.getTime() },
    { key: 'c', nickname: '待同步丁' },
    { key: 'd', nickname: '已读无时间戊', read: true },
  ] }
  const sourceOrder = value.members.map(m => m.key)
  await act(async () => root.render(<TeamReceiptDetails message={{ ...message, side: 'team' }}
    visitor={{ nickname: '外部访客' }} state={{ value, loading: false, at: 1 }}
    onRetry={() => {}} onMore={() => {}} renderAvatar={() => <span />} />))
  expect(host.querySelector('[aria-label="阅读状态筛选"]')).toBeNull()
  expect(host.textContent).toContain('外部联系人')
  const text = host.textContent!
  expect(text.indexOf('晚读丙')).toBeLessThan(text.indexOf('早读乙'))
  expect(text.indexOf('早读乙')).toBeLessThan(text.indexOf('已读无时间戊'))
  expect(text.indexOf('已读无时间戊')).toBeLessThan(text.indexOf('未读甲'))
  expect(text).toContain('14:12')
  expect(text).toContain('14:11')
  expect(text).toContain('状态待同步')
  expect(value.members.map(m => m.key)).toEqual(sourceOrder)
  const dots = host.querySelectorAll('[aria-label="未读"]')
  expect(dots).toHaveLength(2)
  for (const dot of dots) expect((dot.previousElementSibling as HTMLElement).style.opacity).toBe('0.5')
  expect(host.querySelectorAll('.team-receipt-heading')).toHaveLength(2)
})
