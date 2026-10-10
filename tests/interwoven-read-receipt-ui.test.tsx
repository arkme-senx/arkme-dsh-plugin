// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeInterwovenReadProvider } from '../src/client/ArkmeInterwovenReadReceipt.js'
import { ArkmeInterwovenMentionCard } from '../src/client/interwoven-moments.js'
import { arkmeInterwovenInvalidation } from '../src/client/chat-directory-store.js'
import { connectArkmeLocale } from '../src/client/locale.js'
const { callArkme } = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme }))
const moment = { momentId: 'm', momentRef: 'ref', occurredAtMillis: 1700000000000,
  groupName: '产品群', senderName: '我', senderIsMe: true, summary: '@同事 看看这个', degraded: false }
let root: Root
let container: HTMLDivElement
let observers: { emit: (entries: {isIntersecting: boolean}[]) => void }[]
let locale = 'zh'
let disconnectLocale: () => void
beforeEach(() => {
  vi.useFakeTimers(); callArkme.mockReset(); observers = []
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', class {
    constructor(readonly emit: (entries: {isIntersecting: boolean}[]) => void) { observers.push(this) }
    observe() {} disconnect() {}
  })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  locale = 'zh'; disconnectLocale = connectArkmeLocale({ getLocale: () => ({ active: locale }), subscribe: () => () => {} })
})
afterEach(() => {
  act(() => root.unmount()); container.remove(); disconnectLocale()
  connectArkmeLocale({ getLocale: () => ({ active: 'zh' }), subscribe: () => () => {} })()
  vi.useRealTimers(); vi.unstubAllGlobals()
})
const render = async (scope = 'account:private', senderIsMe = true, onOpen = vi.fn()) => {
  await act(async () => { root.render(<ArkmeInterwovenReadProvider sourceRef="private" scope={scope} enabled>
    <ul><ArkmeInterwovenMentionCard moment={{ ...moment, senderIsMe }} onOpen={onOpen} /></ul>
  </ArkmeInterwovenReadProvider>) })
}
const reveal = async () => { await act(async () => { observers.at(-1)!.emit([{ isIntersecting: true }]); await vi.advanceTimersByTimeAsync(100) }) }
describe('inline group origin receipt UI', () => {
  it('shows unread before the chevron, refreshes to the existing check, and shows an immediate tooltip', async () => {
    callArkme.mockResolvedValue({ items: [{ momentId: 'm', reader: 'peer', status: 'unread' }] })
    const open = vi.fn(); await render('account:private', true, open)
    expect(callArkme).not.toHaveBeenCalled()
    await reveal()
    let badge = container.querySelector('[data-arkme-interwoven-receipt]')!
    expect(badge.getAttribute('aria-label')).toBe('对方尚未阅读群内原消息')
    expect(badge.nextElementSibling?.tagName.toLowerCase()).toBe('svg')
    await act(async () => { badge.closest('button')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('产品群，我：')
    await act(async () => { badge.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1)
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('对方尚未阅读群内原消息')
    await act(async () => { badge.closest('button')!.click() })
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ momentId: 'm' }))
    expect(callArkme.mock.calls.every(([operation]) => operation === 'source.interwoven-read-receipts')).toBe(true)
    callArkme.mockResolvedValue({ items: [{ momentId: 'm', reader: 'peer', status: 'read' }] })
    await act(async () => { arkmeInterwovenInvalidation.invalidate('group-source'); await vi.advanceTimersByTimeAsync(100) })
    badge = container.querySelector('[data-arkme-interwoven-receipt]')!
    expect(badge.getAttribute('data-arkme-interwoven-receipt')).toBe('read')
    expect(badge.querySelector('svg circle')).not.toBeNull()
  })
  it('keeps one hint mounted when the pointer crosses the summary and receipt children', async () => {
    callArkme.mockResolvedValue({ items: [{ momentId: 'm', reader: 'peer', status: 'read' }] })
    await render(); await reveal()
    const badge = container.querySelector('[data-arkme-interwoven-receipt]')!
    const summary = container.querySelector('[data-arkme-interwoven-content]')!
    const over = async (target: Element, relatedTarget: Element | null) => {
      await act(async () => { target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget })) })
    }
    await over(summary, null)
    const hint = document.querySelector('[role="tooltip"]')!
    expect(hint.textContent).toContain('产品群，我：')
    await over(badge, summary)
    expect(document.querySelector('[role="tooltip"]')).toBe(hint)
    expect(hint.textContent).toBe('对方已阅读群内原消息')
    const icon = badge.querySelector('svg')!
    for (let index = 0; index < 10; index++) await over(icon, badge)
    expect(document.querySelector('[role="tooltip"]')).toBe(hint)
    expect(badge.querySelector('svg')).toBe(icon)
    expect(observers).toHaveLength(1)
    await over(summary, badge)
    expect(document.querySelector('[role="tooltip"]')).toBe(hint)
    expect(hint.textContent).toContain('产品群，我：')
    expect(callArkme).toHaveBeenCalledTimes(1)
    expect(badge.getAttribute('data-arkme-interwoven-receipt')).toBe('read')
    await act(async () => { badge.closest('button')!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })) })
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    await act(async () => { (badge as HTMLElement).focus() })
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('对方已阅读群内原消息')
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })
  it('uses my read status for incoming rows, keeps unknown blank, and clears on scope change', async () => {
    callArkme.mockResolvedValue({ items: [{ momentId: 'm', reader: 'self', status: 'read' }] })
    await render('account:private', false); await reveal()
    expect(container.querySelector('[data-arkme-interwoven-receipt]')?.getAttribute('aria-label')).toBe('你已阅读群内原消息')
    callArkme.mockImplementation(() => new Promise(() => {}))
    await render('another-account:private', false)
    const badge = container.querySelector('[data-arkme-interwoven-receipt]')!
    expect(badge.getAttribute('data-arkme-interwoven-receipt')).toBe('unknown')
    expect(badge.children).toHaveLength(0)
  })
  it('does not display a peer receipt on an incoming row and supports English', async () => {
    disconnectLocale(); locale = 'en'; disconnectLocale = connectArkmeLocale({ getLocale: () => ({ active: locale }), subscribe: () => () => {} })
    callArkme.mockResolvedValue({ items: [{ momentId: 'm', reader: 'peer', status: 'read' }] })
    await render('account:private', false); await reveal()
    expect(container.querySelector('[data-arkme-interwoven-receipt]')?.getAttribute('aria-label')).toBe('Read status of the original group message is unavailable')
  })
})
