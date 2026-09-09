// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeMessageContent } from '../src/client/ArkmeRichContent.js'
import { preserveTextTogglePosition } from '../src/client/preserve-text-toggle-position.js'
import { arkmeShouldToggleMessageSelectFromRowClick } from '../src/client/ArkmeSidebar.js'

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(2000)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this === host ? 400 : 2000 })
  host = document.createElement('div'); host.style.overflowY = 'auto'
  host.scrollTo = vi.fn((options: ScrollToOptions) => { host.scrollTop = options.top ?? host.scrollTop })
  document.body.append(host); root = createRoot(host)
})

it('does not compensate again when browser anchoring already preserved the button', () => {
  const button = document.createElement('button'); host.append(button)
  host.scrollTop = 200
  let growth = 0
  vi.spyOn(button, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 300 + growth - host.scrollTop, 40, 20))
  preserveTextTogglePosition(button, () => { growth = 400; host.scrollTop += 400 })
  expect(host.scrollTop).toBe(600)
})

it('still expands without a scroll container', () => {
  host.style.overflowY = 'visible'
  const button = document.createElement('button'); host.append(button)
  const expand = vi.fn()
  preserveTextTogglePosition(button, expand)
  expect(expand).toHaveBeenCalledOnce()
  expect(host.scrollTo).not.toHaveBeenCalled()
})

it('finds the scroll container when expansion creates its first overflow', () => {
  const button = document.createElement('button'); host.append(button)
  let height = 300
  Object.defineProperty(host, 'scrollHeight', { get: () => height })
  vi.spyOn(button, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, height - host.scrollTop, 40, 20))
  preserveTextTogglePosition(button, () => { height = 900 })
  expect(host.scrollTo).toHaveBeenCalledWith({ top: 600, behavior: 'instant' })
})

it('preserves the existing message selection capture before the expansion handler', () => {
  const selected = vi.fn()
  const item = Object.freeze({ itemUid: 'select', senderName: '我', isMe: true, sendAtMillis: 1, status: 1, title: '', textContent: '长'.repeat(301) })
  act(() => root.render(<div onClickCapture={event => {
    if (!arkmeShouldToggleMessageSelectFromRowClick(event.target)) return
    event.preventDefault(); event.stopPropagation(); selected()
  }}><ArkmeMessageContent item={item} /></div>))
  const button = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!
  act(() => button.click())
  expect(selected).toHaveBeenCalledOnce()
  expect(button.getAttribute('aria-expanded')).toBe('false')
  expect(host.scrollTo).not.toHaveBeenCalled()
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each([
  { textFormat: 'plain', nested: false }, { textFormat: 'markdown', nested: false },
  { textFormat: 'plain', nested: true }, { textFormat: 'markdown', nested: true },
] as const)('expands $textFormat upwards with nested=$nested, and collapses back to the same position', ({ textFormat, nested }) => {
  act(() => root.render(<div style={nested ? { overflowY: 'auto' } : undefined}><ArkmeMessageContent item={{ itemUid: 'long', senderName: '我', isMe: true, sendAtMillis: 1, status: 1, title: '', textContent: '长'.repeat(301), textFormat }} /></div>))
  const button = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!
  expect(button.getAttribute('aria-expanded')).toBe('false')
  host.scrollTop = 200
  vi.spyOn(button, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0,
    300 + (button.getAttribute('aria-expanded') === 'true' ? 400 : 0) - host.scrollTop, 40, 20))
  const previousBottom = button.getBoundingClientRect().bottom
  act(() => button.click())
  expect(button.getAttribute('aria-expanded')).toBe('true')
  expect(button.getBoundingClientRect().bottom).toBe(previousBottom)
  expect(host.scrollTop).toBe(600)
  expect(host.scrollTo).toHaveBeenCalledWith({ top: 600, behavior: 'instant' })
  act(() => button.click())
  expect(button.getAttribute('aria-expanded')).toBe('false')
  expect(host.scrollTop).toBe(200)
  expect(button.getBoundingClientRect().bottom).toBe(previousBottom)
  expect(host.querySelectorAll('button[aria-expanded]')).toHaveLength(1)
})

it('keeps a single toggle and expansion state when the body format changes', () => {
  const item = { itemUid: 'format', senderName: '我', isMe: true, sendAtMillis: 1, status: 1, title: '', textContent: '长'.repeat(301) }
  act(() => root.render(<ArkmeMessageContent item={{ ...item, textFormat: 'plain' }} />))
  act(() => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click())
  act(() => root.render(<ArkmeMessageContent item={{ ...item, textFormat: 'markdown' }} />))
  expect(host.querySelectorAll('button[aria-expanded]')).toHaveLength(1)
  expect(host.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('true')
  expect(host.querySelector('[data-arkme-text-format="markdown"] button[aria-expanded]')).toBeNull()
  act(() => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click())
  expect(host.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false')
})

it('uses rendered Markdown height rather than plain-text character count', () => {
  const item = { itemUid: 'format', senderName: '我', isMe: true, sendAtMillis: 1, status: 1, title: '', textContent: '# A\n# B\n# C', textFormat: 'markdown' as const }
  act(() => root.render(<ArkmeMessageContent item={item} />))
  expect(host.querySelectorAll('button[aria-expanded]')).toHaveLength(1)
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(100)
  act(() => root.render(<ArkmeMessageContent item={{ ...item, textContent: '短正文' }} />))
  expect(host.querySelector('button[aria-expanded]')).toBeNull()
})


it.each(['plain', 'markdown'] as const)('keeps %s details and explicitly uncollapsed bodies complete', textFormat => {
  const item = Object.freeze({ itemUid: 'detail', senderName: '我', isMe: true, sendAtMillis: 1, status: 1, title: '', textContent: '完整'.repeat(301), textFormat })
  for (const props of [{ presentation: 'detail' as const }, { collapseText: false }]) {
    act(() => root.render(<ArkmeMessageContent item={item} {...props} />))
    expect(host.querySelector('button[aria-expanded]')).toBeNull()
    expect(host.textContent).toContain(item.textContent)
    expect(host.scrollTo).not.toHaveBeenCalled()
  }
})

it('tracks Markdown layout changes without resetting the user expansion choice and cleans up observation', () => {
  let notify: (() => void) | undefined
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { notify = callback }
    observe() {}
    disconnect = disconnect
  })
  let height = 100
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => height)
  const item = { itemUid: 'resize', senderName: '我', isMe: true, sendAtMillis: 1, status: 1, title: '', textContent: '# 标题', textFormat: 'markdown' as const }
  act(() => root.render(<ArkmeMessageContent item={item} />))
  expect(host.querySelector('button[aria-expanded]')).toBeNull()
  act(() => { height = 300; notify!() })
  const button = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!
  expect(button.getAttribute('aria-expanded')).toBe('false')
  act(() => button.click())
  act(() => { height = 100; notify!() })
  expect(host.querySelector('button[aria-expanded]')).toBeNull()
  act(() => { height = 300; notify!() })
  expect(host.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('true')
  act(() => root.render(<ArkmeMessageContent item={{ ...item, textFormat: 'plain' }} />))
  expect(disconnect).toHaveBeenCalledOnce()
})

it('keeps expansion local to its message and leaves immutable business data unchanged', () => {
  const item = Object.freeze({ itemUid: 'one', senderName: '我', isMe: true, sendAtMillis: 1, status: 1, title: '', textContent: '长'.repeat(301) })
  const other = Object.freeze({ ...item, itemUid: 'two' })
  const snapshot = JSON.stringify([item, other])
  act(() => root.render(<>{[item, other].map(row => <ArkmeMessageContent key={row.itemUid} item={row} />)}</>))
  const buttons = host.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')
  act(() => buttons[0]!.click())
  expect(buttons[0]?.getAttribute('aria-expanded')).toBe('true')
  expect(buttons[1]?.getAttribute('aria-expanded')).toBe('false')
  expect(JSON.stringify([item, other])).toBe(snapshot)
})
