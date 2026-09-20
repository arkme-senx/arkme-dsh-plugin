// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ContactRemarkDialog } from '../src/client/redesign/contacts/ContactRemarkDialog.js'

let host: HTMLDivElement
let trigger: HTMLButtonElement
let root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); trigger = document.createElement('button')
  document.body.append(trigger, host); trigger.focus(); root = createRoot(host)
})
afterEach(() => { act(() => { root.unmount() }); host.remove(); trigger.remove(); vi.unstubAllGlobals() })
const profile = { contactRef: 'ref', displayName: '小满', nickname: '小满', remark: '同事' }

it('focuses the input, wraps keyboard focus, supports Escape and restores the trigger', async () => {
  const onClose = vi.fn()
  act(() => { root.render(<ContactRemarkDialog profile={profile} saveRemark={async () => profile} onClose={onClose} onSaved={() => {}} />) })
  const input = document.querySelector('input')!
  expect(document.activeElement).toBe(input)
  expect(input.selectionStart).toBe(0); expect(input.selectionEnd).toBe(2)
  const buttons = document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')
  const first = buttons[0]!; const last = buttons[buttons.length - 1]!
  first.focus(); act(() => { first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })) })
  expect(document.activeElement).toBe(last)
  act(() => { last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })) })
  expect(document.activeElement).toBe(first)
  act(() => { first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
  expect(onClose).toHaveBeenCalledOnce()
  act(() => { root.render(null) })
  expect(document.activeElement).toBe(trigger)
})

it('retains keyboard focus inside the busy dialog and ignores IME confirmation Enter', async () => {
  let finish!: (value: typeof profile) => void
  const save = vi.fn(() => new Promise<typeof profile>(resolve => { finish = resolve }))
  const onClose = vi.fn()
  act(() => { root.render(<ContactRemarkDialog profile={profile} saveRemark={save} onClose={onClose} onSaved={() => {}} />) })
  const input = document.querySelector('input')!
  const ime = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })
  act(() => { input.dispatchEvent(ime) })
  expect(ime.defaultPrevented).toBe(true)
  expect(save).not.toHaveBeenCalled()
  const confirm = document.querySelector<HTMLButtonElement>('button[type=submit]')!
  confirm.focus()
  act(() => { confirm.click() })
  expect(document.activeElement).toBe(input)
  expect(input.disabled).toBe(false)
  expect(input.readOnly).toBe(true)
  const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
  act(() => { input.dispatchEvent(tab) })
  expect(tab.defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(input)
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(onClose).not.toHaveBeenCalled()
  await act(async () => { finish(profile) })
})
