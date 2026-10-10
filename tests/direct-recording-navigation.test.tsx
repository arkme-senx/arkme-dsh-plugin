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
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mock.state = { accountKey: 'prod:42', phase: 'idle', elapsedMillis: 0, maxMillis: 300000, levels: [], pending: [], message: '', error: '', progress: 0, acceptedRevision: 0, startedAt: 0, volatile: false }
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 42 })
  arkmeUi.showConversations()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); mock.listeners.clear() })
const render = async (props = {}) => { await act(async () => root.render(<ArkmeProductNavigation compact={false} {...props} />)) }
const update = (value: Partial<DirectRecordingSnapshot>) => act(() => { mock.state = { ...mock.state, ...value }; mock.listeners.forEach(fn => fn()) })
const button = () => host.querySelector<HTMLButtonElement>('[data-arkme-home-tour-target="recordings"]')!
const hint = () => document.querySelector<HTMLElement>('[data-arkme-recording-navigation-hint]')
const hover = () => act(() => { button().dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })

it('keeps the existing rail size and shows a red dot plus recording label only while capturing', async () => {
  await render({ hosted: true })
  const size = [button().style.minHeight, button().style.padding]
  expect(button().textContent).toBe('录音')
  update({ phase: 'recording', elapsedMillis: 123000 })
  expect(button().textContent).toBe('录音中')
  expect(button().querySelector('[data-arkme-recording-indicator]')).not.toBeNull()
  expect(button().querySelectorAll('[data-arkme-recording-breath]')).toHaveLength(2)
  expect(host.querySelectorAll('[data-arkme-recording-breath="surface"]')).toHaveLength(1)
  expect(button().getAttribute('aria-label')).toContain('本机正在录音')
  expect([button().style.minHeight, button().style.padding]).toEqual(size)
  for (const phase of ['saving', 'uploading', 'idle', 'starting'] as const) {
    update({ phase })
    expect(button().textContent).toBe('录音')
    expect(button().hasAttribute('data-arkme-navigation-recording')).toBe(false)
    expect(host.querySelector('[data-arkme-recording-breath]')).toBeNull()
  }
})

it('retains the indicator across routes and clicking still opens recordings without stopping capture', async () => {
  update({ phase: 'recording' }); await render()
  for (const change of [() => arkmeUi.showContacts(), () => arkmeUi.showCalls(), () => arkmeUi.showHarness(), () => arkmeUi.showConversations()]) {
    act(change); expect(button().textContent).toBe('录音中')
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
  act(() => button().focus()); expect(hint()).not.toBeNull()
  expect(hint()?.hasAttribute('aria-live')).toBe(false)
  act(() => button().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(hint()).toBeNull()
  hover(); act(() => button().click()); expect(hint()).toBeNull()
})

it('never leaks a recording indicator or tooltip into another account or environment', async () => {
  update({ phase: 'recording' }); await render(); hover(); expect(hint()).not.toBeNull()
  await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 43 }) })
  expect(button().textContent).toBe('录音'); expect(hint()).toBeNull()
  update({ accountKey: 'test:43' }); expect(button().textContent).toBe('录音')
})

it('hides the indicator and tooltip for locked or hidden navigation', async () => {
  update({ phase: 'recording' }); await render(); hover()
  await render({ hidden: true }); expect(hint()).toBeNull(); expect(button().textContent).toBe('录音')
  await render({ locked: true }); hover(); expect(hint()).toBeNull(); expect(button().textContent).toBe('录音')
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
