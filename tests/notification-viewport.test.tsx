// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useNotificationScroll, useNotificationVisibleRead } from '../src/client/use-notification-viewport.js'
import { suspendArkmeVisibleReadIntent } from '../src/client/read-intent-visibility.js'

type Item = { id: string; atMillis: number }
let root: Root, container: HTMLDivElement
let items: Item[]
const acknowledge = vi.fn(async (_items: readonly Item[], _signal: AbortSignal) => {})
function Harness({ enabled = true, scope = 'test:1', scroll = false }: { enabled?: boolean; scope?: string; scroll?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const state = useNotificationScroll(ref, scroll ? items : [], scope)
  useNotificationVisibleRead(ref, items, enabled, acknowledge, scope)
  return <><div ref={ref} data-viewport="" onScroll={state.onScroll}>
    <div>{items.map(item => <div key={item.id} data-notification-id={item.id}>{item.id}</div>)}</div>
  </div>{state.newMessages > 0 && <button onClick={state.toLatest}>新消息</button>}</>
}
const render = async (props: Parameters<typeof Harness>[0] = {}) => { await act(async () => root.render(<Harness {...props} />)) }
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(300) }) }
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  items = Array.from({ length: 8 }, (_, i) => ({ id: `item-${i}`, atMillis: i * 1000 }))
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const list = container.querySelector<HTMLElement>('[data-viewport]')
    const index = items.findIndex(item => item.id === this.dataset.notificationId)
    const top = this.hasAttribute('data-viewport') ? 0 : index * 100 - (list?.scrollTop ?? 0)
    const height = this.hasAttribute('data-viewport') ? 200 : 100
    return { x: 0, y: top, top, bottom: top + height, left: 0, right: 600, width: 600, height, toJSON: () => ({}) }
  })
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => items.length * 100)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200)
  // Match the browser's clamping of scrollTop at the bottom.
  const positions = new WeakMap<HTMLElement, number>()
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', { configurable: true,
    get() { return positions.get(this) ?? 0 },
    set(value: number) { positions.set(this, Math.max(0, Math.min(value, items.length * 100 - 200))) },
  })
  acknowledge.mockClear()
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
})
it('automatically acknowledges only visible message bodies, without clicks', async () => {
  await render({ scroll: true }); await tick()
  expect(acknowledge).toHaveBeenCalledTimes(1)
  expect(acknowledge.mock.calls[0]![0].map(item => item.id)).toEqual(['item-6', 'item-7'])
})
it('does not acknowledge a hidden tab, an unfocused window, an open filter or an overlay', async () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
  await render({ scroll: true }); await tick(); expect(acknowledge).not.toHaveBeenCalled()
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  vi.mocked(document.hasFocus).mockReturnValue(false)
  document.dispatchEvent(new Event('visibilitychange')); await tick(); expect(acknowledge).not.toHaveBeenCalled()
  vi.mocked(document.hasFocus).mockReturnValue(true)
  await render({ enabled: false }); await tick(); expect(acknowledge).not.toHaveBeenCalled()
  const release = suspendArkmeVisibleReadIntent()
  await render(); await tick(); expect(acknowledge).not.toHaveBeenCalled()
  release(); await tick(); expect(acknowledge).toHaveBeenCalledTimes(1)
})
it('cancels old visibility work when the account or category changes', async () => {
  await render(); await tick()
  const oldSignal = acknowledge.mock.calls[0]![1]
  await render({ scope: 'test:2:recording' })
  expect(oldSignal.aborted).toBe(true)
  acknowledge.mockClear(); await tick()
  expect(acknowledge).toHaveBeenCalledTimes(1)
  expect(acknowledge.mock.calls[0]![1].aborted).toBe(false)
})
it('keeps the history anchor when older messages load and offers new messages without jumping', async () => {
  await render({ scroll: true })
  const list = container.querySelector<HTMLElement>('[data-viewport]')!
  expect(list.scrollTop).toBe(600)
  await act(async () => { list.scrollTop = 200; list.dispatchEvent(new Event('scroll')) })
  items = [{ id: 'older', atMillis: -1000 }, ...items]
  await render({ scroll: true })
  expect(list.scrollTop).toBe(300)
  expect(container.querySelector('button')).toBeNull()
  items = [...items, { id: 'new', atMillis: 9000 }]
  await render({ scroll: true })
  expect(list.scrollTop).toBe(300)
  expect(container.querySelector('button')?.textContent).toBe('新消息')
  await act(async () => container.querySelector('button')!.click())
  expect(list.scrollTop).toBe(800)
  expect(container.querySelector('button')).toBeNull()
})
