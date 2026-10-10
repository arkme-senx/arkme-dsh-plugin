// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeQuickAddButton } from '../src/client/ArkmeQuickAdd.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'

vi.mock('../src/client/api.js', () => ({
  ArkmeClientError: class extends Error {},
  callArkme: vi.fn(async (operation: string) => {
    if (operation === 'calls.history.list') return { items: [], recentContacts: [], hasMore: false }
    if (operation === 'sources.list') return { items: [{ sourceRef: 'peer', peerUserId: 7, kind: 'private_chat', displayName: '测试联系人', unreadCount: 0 }], hasMore: false }
    if (operation === 'chat.official-author.profile') return { displayName: '即我作者', userId: 8 }
    throw new Error(`Unexpected call: ${operation}`)
  }),
}))

let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  host.style.cssText = 'width:120px;overflow:hidden'
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(document.querySelector('[data-arkme-call-launcher]')).toBeNull()
  host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})

it('opens the shared call picker above the page, traps focus, and returns without navigation', async () => {
  const previousUi = arkmeUi.getSnapshot()
  await act(async () => root.render(<ArkmeQuickAddButton onContactAdd={vi.fn()} onSourceCreated={vi.fn()} />))
  const trigger = host.querySelector('button')!
  await act(async () => trigger.click())
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(node => node.textContent?.includes('发起通话'))!
  await act(async () => item.click())
  const launcher = document.querySelector<HTMLElement>('[data-arkme-call-launcher]')!
  expect(launcher.parentElement).toBe(document.body)
  expect(launcher.style.position).toBe('fixed')
  expect(launcher.style.inset).toBe('0')
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(document.querySelector('[data-arkme-call-surface]')).toBeNull()
  expect(document.activeElement?.getAttribute('aria-label')).toBe('搜索私聊联系人')
  const dialog = launcher.querySelector('[role="dialog"]')!
  const controls = [...dialog.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)')]
  const first = controls[0]!, last = controls.at(-1)!
  last.focus()
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
  expect(document.activeElement).toBe(first)
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })))
  expect(document.activeElement).toBe(last)
  const escapedToChat = vi.fn()
  document.addEventListener('keydown', escapedToChat)
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  document.removeEventListener('keydown', escapedToChat)
  expect(escapedToChat).not.toHaveBeenCalled()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  expect(arkmeUi.getSnapshot()).toBe(previousUi)
})

it('keeps nested call-type and invitation navigation within the launcher, including Escape', async () => {
  await act(async () => root.render(<ArkmeQuickAddButton onContactAdd={vi.fn()} onSourceCreated={vi.fn()} />))
  const trigger = host.querySelector('button')!
  await act(async () => trigger.click())
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(node => node.textContent?.includes('发起通话'))!.click())
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="选择测试联系人通话方式"]')!.click())
  expect(document.querySelector('[aria-label="选择和测试联系人的通话方式"]')).not.toBeNull()
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(document.querySelector('[aria-label="选择和测试联系人的通话方式"]')).toBeNull()
  expect(document.activeElement?.getAttribute('aria-label')).toBe('搜索私聊联系人')
  await act(async () => document.querySelector<HTMLButtonElement>('.arkme-call-picker-invite')!.click())
  expect(document.querySelector('[aria-label="返回联系人选择"]')).not.toBeNull()
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="返回联系人选择"]')!.click())
  expect(document.querySelector('[aria-label="选择通话联系人"]')).not.toBeNull()
  await act(async () => document.querySelector<HTMLButtonElement>('.arkme-call-picker-invite')!.click())
  const escapedToChat = vi.fn()
  document.addEventListener('keydown', escapedToChat)
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  document.removeEventListener('keydown', escapedToChat)
  expect(escapedToChat).not.toHaveBeenCalled()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it('dismisses the launcher when the account logs out', async () => {
  await act(async () => root.render(<ArkmeQuickAddButton onContactAdd={vi.fn()} onSourceCreated={vi.fn()} />))
  await act(async () => host.querySelector('button')!.click())
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(node => node.textContent?.includes('发起通话'))!.click())
  expect(document.querySelector('[data-arkme-call-launcher]')).not.toBeNull()
  await act(async () => arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'prod' }))
  expect(document.querySelector('[data-arkme-call-launcher]')).toBeNull()
})

it('escapes the narrow directory, repositions on resize, and accepts real pointer events on its items', async () => {
  const contact = vi.fn()
  await act(async () => root.render(<ArkmeQuickAddButton onContactAdd={contact} onSourceCreated={vi.fn()} />))
  const trigger = host.querySelector('button')!
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(218)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(128)
  const rect = vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(new DOMRect(140, 24, 40, 40))
  await act(async () => trigger.click())
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!
  expect(menu).not.toBeNull()
  expect(host.contains(menu)).toBe(false)
  expect(menu.parentElement).toBe(document.body)
  expect(menu.style.left).toBe('12px')
  expect(menu.style.top).toBe('68px')
  rect.mockReturnValue(new DOMRect(300, 24, 40, 40))
  await act(async () => window.dispatchEvent(new Event('resize')))
  expect(menu.style.left).toBe('122px')
  const item = menu.querySelector<HTMLButtonElement>('[role="menuitem"]')!
  await act(async () => item.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
  expect(document.querySelector('[role="menu"]')).toBe(menu)
  await act(async () => item.click())
  expect(contact).toHaveBeenCalledOnce()
  expect(document.querySelector('[role="menu"]')).toBeNull()
})

it('closes on outside pointer and Escape, returning keyboard focus to the add icon', async () => {
  await act(async () => root.render(<ArkmeQuickAddButton onContactAdd={vi.fn()} onSourceCreated={vi.fn()} />))
  const trigger = host.querySelector('button')!
  await act(async () => trigger.click())
  await act(async () => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
  expect(document.querySelector('[role="menu"]')).toBeNull()
  await act(async () => trigger.click())
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})
