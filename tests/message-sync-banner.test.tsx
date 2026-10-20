import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { ArkmeMessageSyncBanner } from '../src/client/ArkmeMessageSyncBanner.js'
import { ArkmeNavigation } from '../src/client/ArkmeVirtualWorkspace.js'
import { arkmeMessageSync } from '../src/client/message-sync-store.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'

let renderer: ReactTestRenderer | undefined
const progress = { accountKey: 'test:7001', cycle: 1, revision: 1, phase: 'syncing' as const, completed: 328, total: 1000, pending: 672, terminal: 0 }
afterEach(() => {
  if (renderer) act(() => renderer!.unmount())
  renderer = undefined
  arkmeMessageSync.activateAccount(undefined, true)
  arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
  arkmeUi.showLogin()
  vi.useRealTimers()
})

it('places the banner below the original full search field and outside the scrollable directory', () => {
  vi.useFakeTimers()
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 7001 })
  arkmeUi.showHarness()
  arkmeMessageSync.activateAccount('test:7001', true)
  arkmeMessageSync.apply(progress)
  vi.advanceTimersByTime(300)
  const dom = new JSDOM(renderToStaticMarkup(<ArkmeNavigation showHarnessEntry embeddedProductShell />))
  try {
    const doc = dom.window.document
    const toolbar = doc.querySelector<HTMLElement>('.arkme-directory-search-toolbar')!
    const search = toolbar.querySelector<HTMLElement>('[data-arkme-directory-search]')!
    const slot = doc.querySelector<HTMLElement>('[data-arkme-message-sync-slot]')!
    const directory = doc.querySelector<HTMLElement>('[data-arkme-home-tour-scroll-container="directory"]')!
    expect(search.textContent).toBe('搜索对话或消息')
    expect(search.style.flex).toBe('1 1 0%')
    expect(toolbar.contains(slot)).toBe(false)
    expect(directory.contains(slot)).toBe(false)
    expect(toolbar.compareDocumentPosition(slot) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(slot.compareDocumentPosition(directory) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(directory.textContent).toContain('DeepSeek Harness')
    expect(doc.querySelector('style')?.textContent).not.toContain('@container')
    expect(toolbar.style.containerType).toBe('')
  } finally { dom.window.close() }
})

it('occupies space only while visible and removes the entire slot after completion or an account change', () => {
  vi.useFakeTimers()
  arkmeMessageSync.activateAccount('test:7001', true)
  act(() => { renderer = create(<ArkmeMessageSyncBanner />) })
  expect(renderer!.toJSON()).toBeNull()
  act(() => { arkmeMessageSync.apply(progress); vi.advanceTimersByTime(299) })
  expect(renderer!.toJSON()).toBeNull()
  act(() => { vi.advanceTimersByTime(1) })
  const status = renderer!.root.findByProps({ role: 'progressbar' })
  expect(status.props['aria-valuenow']).toBe(328)
  expect(renderer!.root.findAllByProps({ 'data-arkme-message-sync-slot': true })).toHaveLength(1)
  expect(renderer!.root.findAllByType('button')).toHaveLength(0)
  act(() => { arkmeMessageSync.apply({ ...progress, revision: 2, phase: 'idle', completed: 1000, pending: 0 }) })
  expect(status.props['aria-valuenow']).toBe(1000)
  act(() => { vi.advanceTimersByTime(349) })
  expect(renderer!.root.findAllByProps({ role: 'progressbar' })).toHaveLength(1)
  act(() => { vi.advanceTimersByTime(1) })
  expect(renderer!.toJSON()).toBeNull()
  act(() => { arkmeMessageSync.apply({ ...progress, cycle: 2, revision: 3 }); vi.advanceTimersByTime(300) })
  expect(renderer!.root.findAllByProps({ role: 'progressbar' })).toHaveLength(1)
  act(() => { arkmeMessageSync.activateAccount('test:7002') })
  expect(renderer!.toJSON()).toBeNull()
})

it('never mounts a slot for a short sync', () => {
  vi.useFakeTimers()
  arkmeMessageSync.activateAccount('test:7001', true)
  act(() => { renderer = create(<ArkmeMessageSyncBanner />) })
  act(() => { arkmeMessageSync.apply(progress); vi.advanceTimersByTime(100) })
  expect(renderer!.toJSON()).toBeNull()
  act(() => {
    arkmeMessageSync.apply({ ...progress, revision: 2, phase: 'idle', completed: 1000, pending: 0 })
    vi.runAllTimers()
  })
  expect(renderer!.toJSON()).toBeNull()
})
