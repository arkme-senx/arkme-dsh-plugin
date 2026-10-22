// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmePersistentSidebar } from '../src/client/ArkmePersistentShell.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'

vi.mock('../src/client/ArkmeProductNavigation.js', () => ({ ArkmeProductNavigation: () => <nav /> }))
vi.mock('../src/client/ArkmeVirtualWorkspace.js', () => ({ ArkmeNavigation: () => <div>Conversation directory</div> }))
vi.mock('../src/client/redesign/contacts/ContactDirectorySurface.js', () => ({ ContactDirectorySurface: () => null }))
vi.mock('../src/client/api.js', () => ({ callArkme: async () => ({ items: [] }) }))
let host: HTMLDivElement, root: Root, width: number
let observeResize: () => void
const key = 'dsh-arkme:persistent-directory-width:v2'
const props = {
  collapsed: true, width: 56,
  useSessions: (selector: (state: unknown) => unknown) => selector({ ids: [], byId: {} }),
  renderSlot: () => null, closeDetails: () => undefined, collapseSidebar: () => undefined,
} as never
const sidebar = () => host.querySelector<HTMLElement>('[data-arkme-owned="persistent-sidebar"]')!
async function resize(value: number) { await act(async () => { width = value; observeResize() }) }
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { observeResize = callback }
    observe() {} disconnect() {}
  })
  window.localStorage.clear()
  window.localStorage.setItem(key, '364')
  width = 1200
  host = document.createElement('div'); host.dataset.slot = 'root'
  host.style.display = 'contents'
  const frame = document.createElement('div'); frame.dataset.rightbarCollapsed = 'true'
  frame.getBoundingClientRect = () => ({ width } as DOMRect)
  host.append(frame)
  document.body.append(host); root = createRoot(frame)
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 10001 })
  arkmeUi.showArko()
  await act(async () => root.render(<ArkmePersistentSidebar {...props} />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove(); window.localStorage.clear(); vi.unstubAllGlobals()
})
it('uses the real container width and restores the saved width without persisting auto shrink', async () => {
  expect(sidebar().dataset.arkmeDirectoryWidth).toBe('364')
  await resize(1023)
  expect(sidebar().dataset.arkmeDirectoryWidth).toBe('364')
  await resize(800)
  expect(sidebar().dataset.arkmeDirectoryWidth).toBe('256')
  expect(window.localStorage.getItem(key)).toBe('364')
  await resize(700)
  expect(sidebar().dataset.arkmeConversationMobileView).toBe('content')
  expect(host.querySelector('[role="separator"]')).toBeNull()
  await act(async () => arkmeUi.showConversationDirectory())
  expect(sidebar().dataset.arkmeConversationMobileView).toBe('directory')
  await act(async () => arkmeUi.recordChanged())
  expect(sidebar().dataset.arkmeConversationMobileView).toBe('directory')
  await act(async () => arkmeUi.showArko())
  expect(sidebar().dataset.arkmeConversationMobileView).toBe('content')
  await resize(1200)
  expect(sidebar().dataset.arkmeConversationMobileView).toBeUndefined()
  expect(sidebar().dataset.arkmeDirectoryWidth).toBe('364')
})
it('persists deliberate keyboard resizing even below the host collapse breakpoint', async () => {
  await resize(1000)
  const separator = host.querySelector<HTMLElement>('[role="separator"]')!
  await act(async () => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
  expect(window.localStorage.getItem(key)).toBe('348')
  await resize(800)
  expect(sidebar().dataset.arkmeDirectoryWidth).toBe('256')
  await resize(1100)
  expect(sidebar().dataset.arkmeDirectoryWidth).toBe('348')
})

it('does not replace the saved wider preference when a resize key cannot move the divider', async () => {
  await resize(800)
  const separator = host.querySelector<HTMLElement>('[role="separator"]')!
  await act(async () => separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
  expect(window.localStorage.getItem(key)).toBe('364')
  await resize(1200)
  expect(sidebar().dataset.arkmeDirectoryWidth).toBe('364')
})
