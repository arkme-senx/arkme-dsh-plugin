// @vitest-environment jsdom
// Live capture indication in the product rail, separate from directory-entry contracts.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { DirectRecordingSnapshot } from '../src/client/recordings/direct-recording-store.js'

const mock = vi.hoisted(() => ({ state: {} as DirectRecordingSnapshot, listeners: new Set<() => void>() }))
vi.mock('../src/client/recordings/direct-recording-store.js', () => ({ directRecordingStore: {
  getSnapshot: () => mock.state,
  subscribe: (listener: () => void) => { mock.listeners.add(listener); return () => mock.listeners.delete(listener) },
} }))
vi.mock('../src/client/api.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/api.js')>(),
  callArkme: vi.fn(async () => ({ profile: null })),
}))
vi.mock('../src/client/arkme-membership.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/arkme-membership.js')>(),
  useMembership: () => ({ state: { status: 'loading' }, refresh: vi.fn() }),
}))
import { ArkmeProductNavigation } from '../src/client/ArkmeProductNavigation.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'

let root: Root, host: HTMLDivElement
let hovered: Element | undefined, windowFocused = true
const nativeMatches = Element.prototype.matches
beforeEach(() => {
  hovered = undefined; windowFocused = true
  vi.spyOn(document, 'hasFocus').mockImplementation(() => windowFocused)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function(this: Element, selector) {
    if (selector === ':hover') return this === hovered
    if (selector === ':focus-visible') return this === document.activeElement
    return nativeMatches.call(this, selector)
  })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mock.state = { accountKey: 'prod:42', phase: 'idle', elapsedMillis: 0, maxMillis: 300000, levels: [], pending: [], message: '', error: '', progress: 0, acceptedRevision: 0, startedAt: 0, volatile: false }
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 42 })
  arkmeUi.showConversations()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); mock.listeners.clear(); vi.useRealTimers(); vi.restoreAllMocks() })
const render = async (props = {}) => { await act(async () => root.render(<ArkmeProductNavigation compact={false} {...props} />)) }
const update = (value: Partial<DirectRecordingSnapshot>) => act(() => { mock.state = { ...mock.state, ...value }; mock.listeners.forEach(fn => fn()) })
const button = () => host.querySelector<HTMLButtonElement>('[data-arkme-home-tour-target="recordings"]')!
const hint = () => document.querySelector<HTMLElement>('[data-arkme-recording-navigation-hint]')
const hover = () => act(() => {
  hovered = button()
  button().dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
  button().dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
})
const keyboardFocus = (element: HTMLElement) => act(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
  element.focus()
})

it('delays icon labels until hover settles and cancels pending hints on leave or scroll', async () => {
  await render(); vi.useFakeTimers()
  const label = () => document.querySelector('[data-arkme-navigation-tooltip]')
  hover(); act(() => vi.advanceTimersByTime(499)); expect(label()).toBeNull()
  act(() => vi.advanceTimersByTime(1))
  expect(label()?.textContent).toBe('录音')
  expect(label()?.parentElement).toBe(document.body)
  expect(button().getAttribute('aria-describedby')).toBe(label()?.id)
  act(() => button().dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })))
  expect(label()).toBeNull()
  hover()
  act(() => document.dispatchEvent(new Event('scroll')))
  act(() => vi.advanceTimersByTime(550)); expect(label()).toBeNull()
  hover()
  await render({ hidden: true })
  act(() => vi.advanceTimersByTime(550)); expect(label()).toBeNull()
})

it('shows icon names on keyboard focus and dismisses them on Escape, activation and unmount', async () => {
  await render()
  const label = () => document.querySelector('[data-arkme-navigation-tooltip]')
  keyboardFocus(button()); expect(label()?.textContent).toBe('录音')
  act(() => button().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(label()).toBeNull()
  act(() => button().blur()); keyboardFocus(button())
  act(() => button().click()); expect(label()).toBeNull()
  expect(arkmeUi.getViewSnapshot().mode).toBe('recordings')
  act(() => button().blur()); keyboardFocus(button())
  expect(label()).not.toBeNull()
  await act(async () => root.render(null)); expect(label()).toBeNull()
})

it('keeps the membership label visible and additional account details in the tooltip', async () => {
  await render()
  const brand = host.querySelector<HTMLElement>('[data-arkme-owned="product-brand"]')!
  const profile = host.querySelector<HTMLButtonElement>('[aria-label="个人资料"]')!
  expect(brand.textContent).not.toContain('v3.0.0')
  expect(profile.querySelector('.arkme-member-label')).not.toBeNull()
  keyboardFocus(brand)
  expect(document.querySelector('[data-arkme-navigation-tooltip]')?.textContent).toContain('即我 v')
  keyboardFocus(profile)
  expect(document.querySelector('[data-arkme-navigation-tooltip]')?.textContent).toContain('个人资料')
})

it('does not open from restored focus or a synthetic mouse entry after returning to the window', async () => {
  await render(); vi.useFakeTimers()
  const label = () => document.querySelector('[data-arkme-navigation-tooltip]')
  act(() => button().focus()); expect(label()).toBeNull()
  hover(); act(() => vi.advanceTimersByTime(100))
  act(() => { windowFocused = false; window.dispatchEvent(new Event('blur')) })
  act(() => vi.advanceTimersByTime(600)); expect(label()).toBeNull()
  act(() => { windowFocused = true; window.dispatchEvent(new Event('focus')); button().blur(); button().focus() })
  act(() => button().dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
  act(() => vi.advanceTimersByTime(600)); expect(label()).toBeNull()
  hover(); act(() => vi.advanceTimersByTime(500)); expect(label()?.textContent).toBe('录音')
})

it('rechecks actual hover at the deadline even when mouseleave was missed', async () => {
  await render(); vi.useFakeTimers()
  hover(); act(() => vi.advanceTimersByTime(400)); hovered = undefined
  act(() => vi.advanceTimersByTime(100))
  expect(document.querySelector('[data-arkme-navigation-tooltip]')).toBeNull()
  hover()
  act(() => document.body.dispatchEvent(new MouseEvent('pointermove', { bubbles: true })))
  act(() => vi.advanceTimersByTime(600))
  expect(document.querySelector('[data-arkme-navigation-tooltip]')).toBeNull()
})

it('consumes keyboard intent once and expires it before a later unrelated focus restoration', async () => {
  await render(); vi.useFakeTimers()
  const label = () => document.querySelector('[data-arkme-navigation-tooltip]')
  keyboardFocus(button()); expect(label()).not.toBeNull()
  act(() => button().blur()); act(() => button().focus()); expect(label()).toBeNull()
  act(() => button().blur())
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', {key:'Tab',bubbles:true})))
  act(() => vi.advanceTimersByTime(1001)); act(() => button().focus()); expect(label()).toBeNull()
})

it.each(['blur', 'focus', 'visibilitychange', 'pointercancel', 'pointerleave'])('clears visible and pending hints on %s', async kind => {
  await render(); vi.useFakeTimers()
  for (const visible of [false, true]) {
    hover(); if (visible) act(() => vi.advanceTimersByTime(500))
    act(() => (['blur','focus'].includes(kind) ? window : document).dispatchEvent(new Event(kind)))
    act(() => vi.advanceTimersByTime(600))
    expect(document.querySelector('[data-arkme-navigation-tooltip]')).toBeNull()
  }
})

it('dismisses the active recording hint when switching away and does not reopen on restored focus', async () => {
  update({ phase: 'recording' }); await render(); hover(); expect(hint()).not.toBeNull()
  act(() => window.dispatchEvent(new Event('blur'))); expect(hint()).toBeNull()
  act(() => { window.dispatchEvent(new Event('focus')); button().focus() }); expect(hint()).toBeNull()
  hover(); expect(hint()).not.toBeNull()
})

it('keeps the existing rail size and shows a red dot plus accessible recording status only while capturing', async () => {
  await render({ hosted: true })
  const size = [button().style.minHeight, button().style.padding]
  expect(button().textContent).toBe('')
  expect(button().getAttribute('aria-label')).toBe('录音')
  update({ phase: 'recording', elapsedMillis: 123000 })
  expect(button().getAttribute('aria-label')).toContain('本机正在录音')
  expect(button().querySelector('[data-arkme-recording-indicator]')).not.toBeNull()
  expect(button().querySelectorAll('[data-arkme-recording-breath]')).toHaveLength(2)
  expect(host.querySelectorAll('[data-arkme-recording-breath="surface"]')).toHaveLength(1)
  expect(button().getAttribute('aria-label')).toContain('本机正在录音')
  expect([button().style.minHeight, button().style.padding]).toEqual(size)
  for (const phase of ['saving', 'uploading', 'idle', 'starting'] as const) {
    update({ phase })
    expect(button().getAttribute('aria-label')).toBe('录音')
    expect(button().hasAttribute('data-arkme-navigation-recording')).toBe(false)
    expect(host.querySelector('[data-arkme-recording-breath]')).toBeNull()
  }
})

it('retains the indicator across routes and clicking still opens recordings without stopping capture', async () => {
  update({ phase: 'recording' }); await render()
  for (const change of [() => arkmeUi.showContacts(), () => arkmeUi.showCalls(), () => arkmeUi.showHarness(), () => arkmeUi.showConversations()]) {
    act(change); expect(button().getAttribute('aria-label')).toContain('本机正在录音')
  }
  act(() => button().click())
  expect(arkmeUi.getViewSnapshot().mode).toBe('recordings')
  expect(mock.state.phase).toBe('recording')
})

it('shows a live elapsed hint on hover, portals outside the rail, and dismisses immediately on leave', async () => {
  update({ phase: 'recording', elapsedMillis: 123000 }); await render(); hover()
  expect(hint()?.parentElement).toBe(document.body)
  expect(hint()?.textContent).toContain('本机正在录音00:02:03')
  expect(hint()?.querySelector('[data-arkme-recording-breath="dot"]')).not.toBeNull()
  expect(button().getAttribute('aria-describedby')).toBe(hint()?.id)
  update({ elapsedMillis: 124000 }); expect(hint()?.textContent).toContain('00:02:04')
  act(() => button().dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })))
  expect(hint()).toBeNull()
})

it('supports keyboard focus, Escape and click dismissal without announcing the timer every second', async () => {
  update({ phase: 'recording' }); await render()
  keyboardFocus(button()); expect(hint()).not.toBeNull()
  expect(hint()?.hasAttribute('aria-live')).toBe(false)
  act(() => button().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(hint()).toBeNull()
  hover(); act(() => button().click()); expect(hint()).toBeNull()
})

it('never leaks a recording indicator or tooltip into another account or environment', async () => {
  update({ phase: 'recording' }); await render(); hover(); expect(hint()).not.toBeNull()
  await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 43 }) })
  expect(button().getAttribute('aria-label')).toBe('录音'); expect(hint()).toBeNull()
  update({ accountKey: 'test:43' }); expect(button().getAttribute('aria-label')).toBe('录音')
})

it('hides the indicator and tooltip for locked or hidden navigation', async () => {
  update({ phase: 'recording' }); await render(); hover()
  await render({ hidden: true }); expect(hint()).toBeNull(); expect(button().getAttribute('aria-label')).toBe('录音')
  await render({ locked: true }); hover(); expect(hint()).toBeNull(); expect(button().getAttribute('aria-label')).toBe('录音')
})

it('removes a visible hint immediately when capture stops, even while the file is uploading', async () => {
  update({ phase: 'recording' }); await render(); hover(); expect(hint()).not.toBeNull()
  update({ phase: 'saving' }); expect(hint()).toBeNull()
  update({ phase: 'uploading' }); hover(); expect(hint()).toBeNull()
})

it('clamps the hover hint inside narrow and short windows without adding a navigation row', async () => {
  update({ phase: 'recording' }); await render({ compact: true })
  vi.spyOn(button(), 'getBoundingClientRect').mockReturnValue({ left: 280, right: 310, top: 140, bottom: 180 } as DOMRect)
  const width = window.innerWidth, height = window.innerHeight
  Object.defineProperty(window, 'innerWidth', { value: 320, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 200, configurable: true })
  try {
    hover()
    expect(Number.parseFloat(hint()!.style.left) + Number.parseFloat(hint()!.style.width)).toBeLessThanOrEqual(312)
    expect(Number.parseFloat(hint()!.style.top)).toBeLessThanOrEqual(106)
    expect(button().style.height).toBe('42px')
  } finally {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: height, configurable: true })
  }
})
