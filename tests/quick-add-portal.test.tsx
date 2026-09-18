// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeQuickAddButton } from '../src/client/ArkmeQuickAdd.js'

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
  host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()
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
