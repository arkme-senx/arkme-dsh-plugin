// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorldPublicationBadge, WorldPublicationActions } from '../src/client/WorldPublicationControls.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { worldPublications } from '../src/client/world-publications.js'
import { MessageQuoteThreadsProvider, MessageQuoteThreadTimestamp, MessageWorldPublicationBadge, useMessageQuoteThreads } from '../src/client/MessageQuoteThreads.js'
import type { ArkmeTimelineItem } from '../src/types.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: (...args: unknown[]) => mocks.call(...args) }))
let host: HTMLDivElement, root: Root
const target = { source: { sourceRef: 'self', messageActionRef: 'action', itemUid: 'note' } }
const publication = {
  key: 'stable-publication',
  ref: 'sealed',
  kind: 'person',
  label: '个人世界',
  requested: true,
  pending: false,
  canUnpublish: true,
}
const click = async (label: string) =>
  act(async () => {
    const b = [...document.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === label || b.textContent === label,
    )
    expect(b, `missing ${label}`).toBeDefined()
    b!.click()
  })
const settle = async () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 35))
  })
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 8 })
  mocks.call.mockReset()
  mocks.call.mockImplementation(async (_op, p) =>
    p.action === 'sources'
      ? { items: [{ itemUid: 'note', publications: [publication] }] }
      : { completed: true, pending: false },
  )
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  worldPublications.invalidate()
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})
it('uses one state for the block badge and detail menu; keeps original state on failure and retries the same command', async () => {
  let active = true
  mocks.call.mockImplementation(async (_op, p) => {
    if (p.action === 'sources') return { items: [{ itemUid: 'note', publications: active ? [publication] : [] }] }
    if (mocks.call.mock.calls.filter((c) => c[1].action === 'unpublish').length === 1) throw new Error('结果未知')
    active = false
    return { completed: true, pending: false }
  })
  await act(async () =>
    root.render(
      <>
        <WorldPublicationBadge target={target} />
        <WorldPublicationActions target={target} />
      </>,
    ),
  )
  await settle()
  expect(document.querySelector('[data-world-publication-badge]')).not.toBeNull()
  expect(mocks.call.mock.calls.filter((c) => c[1].action === 'sources')).toHaveLength(1)
  await click('公开发布管理')
  await click('取消公开发布')
  expect(document.body.textContent).toContain('原消息保留，内容将从世界中取消公开。')
  await click('确认取消公开')
  expect(document.body.textContent).toContain('结果未知')
  expect(document.querySelector('[data-world-publication-badge]')).not.toBeNull()
  await click('重试取消公开')
  await settle()
  expect(document.querySelector('[data-world-publication-badge]')).toBeNull()
  const writes = mocks.call.mock.calls.filter((c) => c[1].action === 'unpublish')
  expect(writes).toHaveLength(2)
  expect(writes[0]![1]).toEqual(writes[1]![1])
})
it('does not cancel when the confirmation is dismissed and hides the previous account badge immediately', async () => {
  await act(async () =>
    root.render(
      <>
        <WorldPublicationBadge target={target} />
        <WorldPublicationActions target={target} />
      </>,
    ),
  )
  await settle()
  await click('公开发布管理')
  await click('取消公开发布')
  await click('返回')
  expect(mocks.call.mock.calls.filter((c) => c[1].action === 'unpublish')).toHaveLength(0)
  await act(async () => arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 9 }))
  expect(document.querySelector('[data-world-publication-badge]')).toBeNull()
})

it('keeps an ordinary message clock in the compact layout before and after its public corner badge arrives', async () => {
  const item: ArkmeTimelineItem = { itemUid: 'note', status: 1, isMe: true, title: '', textContent: '两台电脑够用了', sendAtMillis: 1793862060000, messageActionRef: 'action' }
  const render = (record: ArkmeTimelineItem) => <div className="arkme-timed-bubble">
    <MessageWorldPublicationBadge item={record} sourceRef="self"/>
    <div data-arkme-message-content="message"><p data-arkme-plain-text>{record.textContent}</p></div>
    <MessageQuoteThreadTimestamp item={record}/>
  </div>
  await act(async () => root.render(render(item)))
  const bubble = host.querySelector<HTMLElement>('.arkme-timed-bubble')!
  const clock = bubble.querySelector('time')!
  // No empty span can turn the inline clock back into a separate footer row.
  expect(clock.parentElement).toBe(bubble)
  await settle()
  const badge = bubble.querySelector<HTMLElement>('[data-world-publication-corner]')!
  expect(badge).not.toBeNull()
  expect(badge.style.position).toBe('absolute')
  expect(badge.style.pointerEvents).toBe('none')
  expect(badge.querySelector('svg')?.getAttribute('width')).toBe('9')
  expect(badge.nextElementSibling?.getAttribute('data-arkme-message-content')).toBe('message')
  expect(clock.parentElement).toBe(bubble)
  expect(mocks.call.mock.calls.every(call => call[1].action === 'sources')).toBe(true)
  await act(async () => arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 9 }))
  expect(bubble.querySelector('[data-world-publication-corner]')).toBeNull()
  expect(clock.parentElement).toBe(bubble)
})

it('reserves the measured comment metadata width and releases it when the message is removed', async () => {
  const item: ArkmeTimelineItem = { itemUid: 'note', status: 1, isMe: true, title: '', textContent: '消息正文', sendAtMillis: 1793862060000 }
  let resize = () => {}, disconnected = false
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe() {}
    disconnect() { disconnected = true }
  })
  function Summary() {
    const { store } = useMessageQuoteThreads()
    useEffect(() => { store?.acceptContext(item, { parentRecordUid: 'note', extensionCount: 12345, extensions: [] }) }, [store])
    return null
  }
  await act(async () => root.render(<MessageQuoteThreadsProvider scope="test:8" chat={false} items={[item]} onOpenComments={() => {}}>
    <Summary/><div className="arkme-timed-bubble"><div data-arkme-message-content="message"><p data-arkme-plain-text>消息正文</p></div><MessageQuoteThreadTimestamp item={item}/></div>
  </MessageQuoteThreadsProvider>))
  const bubble = host.querySelector<HTMLElement>('.arkme-timed-bubble')!
  const group = bubble.querySelector<HTMLElement>('[data-arkme-message-time-group]')!
  expect(group.textContent).toContain('12345')
  vi.spyOn(group, 'getBoundingClientRect').mockReturnValue({ width: 115.5 } as DOMRect)
  await act(async () => resize())
  expect(bubble.style.getPropertyValue('--arkme-message-time-space')).toBe('124px')
  await act(async () => root.render(null))
  expect(disconnected).toBe(true)
  expect(bubble.style.getPropertyValue('--arkme-message-time-space')).toBe('')
})
