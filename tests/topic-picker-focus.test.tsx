// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ArkmeConfirmDialog } from '../src/client/ArkmeConfirmDialog.js'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('keeps picker keyboard focus inside the modal, closes with Escape, and restores its trigger', async () => {
  const trigger = document.createElement('button')
  const host = document.createElement('div')
  document.body.append(trigger, host)
  trigger.focus()
  const root = createRoot(host)
  const onClose = vi.fn()
  try {
    await act(async () => root.render(<ArkmeConfirmDialog layout="picker" titleId="picker-title" title="指定主题"
      busy={false} onClose={onClose}>
      <input aria-label="搜索主题名" /><button type="button">新建</button>
    </ArkmeConfirmDialog>))
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    const input = dialog.querySelector('input')!
    const last = dialog.querySelector('button')!
    expect(document.activeElement).toBe(dialog)
    expect(dialog.querySelector('footer')).toBeNull()
    act(() => { dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })) })
    expect(document.activeElement).toBe(last)
    act(() => { last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })) })
    expect(document.activeElement).toBe(input)
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(onClose).toHaveBeenCalledOnce()
  } finally {
    await act(async () => root.unmount())
    expect(document.activeElement).toBe(trigger)
    trigger.remove(); host.remove()
  }
})

it('contains Tab while all picker controls are disabled and ignores Escape while busy', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); const onClose = vi.fn()
  try {
    await act(async () => root.render(<ArkmeConfirmDialog layout="picker" titleId="busy-picker" title="指定主题"
      busy onClose={onClose}>
      <input disabled /><button disabled>新建</button>
    </ArkmeConfirmDialog>))
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    act(() => { dialog.dispatchEvent(tab) })
    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(dialog)
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(onClose).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()); host.remove() }
})

it('retains the default confirmation footer and its independent confirm action', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); const onConfirm = vi.fn(); const onClose = vi.fn()
  try {
    await act(async () => root.render(<ArkmeConfirmDialog titleId="confirm-title" title="确认操作"
      description="确认后执行" busy={false} confirmLabel="确认" busyLabel="处理中" onClose={onClose} onConfirm={onConfirm} />))
    const footer = document.querySelector('footer')!
    const buttons = footer.querySelectorAll('button')
    expect(document.activeElement).toBe(buttons[0])
    act(() => { buttons[1]!.click() })
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()); host.remove() }
})
