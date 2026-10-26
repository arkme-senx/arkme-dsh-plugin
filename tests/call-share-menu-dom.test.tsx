// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeCallShareControls } from '../src/client/ArkmeCallShareControls.js'
const api = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({ callArkme: api }))
vi.mock('../src/client/ArkmeAvatar.js', () => ({ ArkmeUserAvatar: () => null }))
let host: HTMLDivElement, root: Root
beforeEach(async () => {
  api.mockReset().mockResolvedValue({ items: [], nextCursor: '' })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<ArkmeCallShareControls callRef="ref" />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const trigger = () => host.querySelector<HTMLButtonElement>('[aria-label="分享"]')!
async function openViewers() {
  await act(async () => trigger().click())
  const action = document.querySelector<HTMLButtonElement>('[role="menuitem"][aria-label="查看记录"]')!
  await act(async () => action.click())
}
it('dismisses the menu and viewer panel with Escape without closing its parent drawer', async () => {
  const parentClose = vi.fn()
  const parentKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) parentClose() }
  document.addEventListener('keydown', parentKey)
  try {
    await act(async () => trigger().click())
    expect(api).not.toHaveBeenCalled()
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger())
    expect(parentClose).not.toHaveBeenCalled()
    await openViewers()
    expect(host.querySelector('[aria-label="外部查看记录"]')).not.toBeNull()
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(host.querySelector('[aria-label="外部查看记录"]')).toBeNull()
    expect(parentClose).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(trigger())
  } finally { document.removeEventListener('keydown', parentKey) }
})
it('retains viewers when interacting inside and closes when clicking outside', async () => {
  await openViewers()
  const panel = host.querySelector('[aria-label="外部查看记录"]')!
  await act(async () => panel.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
  expect(host.querySelector('[aria-label="外部查看记录"]')).toBe(panel)
  await act(async () => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
  expect(host.querySelector('[aria-label="外部查看记录"]')).toBeNull()
  expect(api).toHaveBeenCalledExactlyOnceWith('calls.share.viewers', { callRef: 'ref', cursor: '' }, expect.any(AbortSignal))
})
