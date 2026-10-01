// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CodexDispatchEntry } from '../src/client/redesign/contacts/CodexDispatchEntry.js'

let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  act(() => root.render(<CodexDispatchEntry scopeKey="account/team/source/task" mode="local"/>))
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
it('a pointer click opens the guide and does not make a request', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  const input = host.querySelector('textarea')!
  input.focus()
  act(() => input.click())
  expect(dialog()).not.toBeNull()
  expect(dialog()!.contains(document.activeElement)).toBe(true)
  expect(input.readOnly).toBe(true)
  act(() => dialog()!.querySelector('button')!.click())
  expect(dialog()).toBeNull()
  expect(document.activeElement).toBe(input)
  expect(fetch).not.toHaveBeenCalled()
})
it('the add-to-queue button opens setup, and Tab stays within the dialog', () => {
  act(() => host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click())
  const buttons = dialog()!.querySelectorAll('button'), first = buttons[0]!, last = buttons[buttons.length - 1]!
  act(() => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })))
  expect(document.activeElement).toBe(last)
  act(() => last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
  expect(document.activeElement).toBe(first)
  act(() => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(dialog()).toBeNull()
})
it('task changes close the portal and switching to a colleague removes the input', () => {
  act(() => host.querySelector('textarea')!.click())
  act(() => root.render(<CodexDispatchEntry scopeKey="account/team/source/other" mode="readonly"/>))
  expect(dialog()).toBeNull()
  expect(host.querySelector('textarea')).toBeNull()
  expect(host.textContent).toContain('不开放操作对方电脑')
})
