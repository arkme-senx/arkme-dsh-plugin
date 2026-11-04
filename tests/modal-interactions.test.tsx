// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ArkmeCloseButton } from '../src/client/ArkmeCloseButton.js'
import { installModalInteractions } from '../src/client/modal-interactions.js'
import { JSDOM } from 'jsdom'

vi.mock('../src/client/modal-interactions.css?inline', async () => {
  const { readFileSync } = await import('node:fs')
  return { default: readFileSync('src/client/modal-interactions.css', 'utf8') }
})

let root: Root | undefined
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  document.body.replaceChildren()
  document.head.querySelectorAll('[data-plugin-css]').forEach(node => node.remove())
  vi.unstubAllGlobals()
})

it('keeps the entire close target interactive without changing the owners event path', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
  const close = vi.fn(), parent = vi.fn(), submit = vi.fn()
  let button: HTMLButtonElement | null = null
  await act(async () => root!.render(<form onSubmit={event => { event.preventDefault(); submit() }} onClick={parent}>
    <ArkmeCloseButton ref={node => { button = node }} aria-label="关闭长文" style={{ position: 'absolute', right: 12, width: 12, height: 12 }} onClick={close} />
  </form>))
  const target = host.querySelector('button')!
  expect(button).toBe(target)
  expect(target.type).toBe('button')
  expect(target.getAttribute('aria-label')).toBe('关闭长文')
  expect(target.style.width).toBe('36px')
  expect(target.style.height).toBe('36px')
  expect(target.style.right).toBe('12px')
  // The glyph itself can be the event target; it must use the same owner path.
  await act(async () => target.querySelector('path')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  expect(close).toHaveBeenCalledTimes(1)
  expect(parent).toHaveBeenCalledTimes(1)
  expect(submit).not.toHaveBeenCalled()
  await act(async () => root!.render(<ArkmeCloseButton disabled onClick={close} />))
  await act(async () => host.querySelector('button')!.click())
  expect(close).toHaveBeenCalledTimes(1)
  await act(async () => root!.render(<ArkmeCloseButton style={{ display: 'none' }} onClick={close} />))
  expect(host.querySelector('button')!.style.display).toBe('none')
})

it('installs native drag exclusions independently for the main and embedded documents', () => {
  const embedded = new JSDOM('<!doctype html><html><head></head><body></body></html>')
  const stop = installModalInteractions(), stopFrame = installModalInteractions(embedded.window.document)
  const repeated = installModalInteractions()
  const style = document.head.querySelector('style[data-plugin-css]')!
  expect(document.head.querySelectorAll('style[data-plugin-css]')).toHaveLength(1)
  expect(style.textContent).toContain('[role="alertdialog"]')
  expect(style.textContent).toContain('-webkit-app-region: no-drag !important')
  expect(style.textContent).toContain('[data-arkme-window-drag-region]')
  expect(style.textContent).toContain('#arkme-mac-window-drag-region')
  expect(embedded.window.document.head.querySelector('style')?.textContent).toBe(style.textContent)
  repeated(); expect(style.isConnected).toBe(true)
  stopFrame(); expect(embedded.window.document.head.querySelector('style')).toBeNull()
  stop(); expect(style.isConnected).toBe(false)
  embedded.window.close()
})
