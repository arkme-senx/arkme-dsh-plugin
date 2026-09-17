// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { watchFrameMenuDismissal } from '../src/client/frame-menu-dismissal.js'

afterEach(() => document.body.replaceChildren())
function frame(parent = document) {
  const node = parent.createElement('iframe'); parent.body.append(node)
  return node
}

it('observes nested frame clicks without swallowing their original action, and removes all listeners on close', () => {
  const first = frame(); const nested = frame(first.contentDocument!)
  const child = nested.contentDocument!
  const button = child.createElement('button'); child.body.append(button)
  const outside = vi.fn(); const action = vi.fn()
  button.addEventListener('pointerdown', action)
  button.addEventListener('pointerdown', event => event.stopPropagation())
  const stop = watchFrameMenuDismissal(document, outside, vi.fn())
  const event = new child.defaultView!.MouseEvent('pointerdown', { bubbles: true, cancelable: true })
  button.dispatchEvent(event)
  expect(outside).toHaveBeenCalledOnce(); expect(action).toHaveBeenCalledOnce(); expect(event.defaultPrevented).toBe(false)
  document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
  expect(outside).toHaveBeenCalledOnce() // The existing parent handler remains responsible for its own document.
  stop(); button.dispatchEvent(new child.defaultView!.MouseEvent('pointerdown', { bubbles: true }))
  expect(outside).toHaveBeenCalledOnce(); expect(action).toHaveBeenCalledTimes(2)
})

it('attaches to inserted/reloaded frames and detaches removed documents', async () => {
  const outside = vi.fn(); const stop = watchFrameMenuDismissal(document, outside, vi.fn())
  const node = frame(); await Promise.resolve()
  const original = node.contentDocument!
  original.dispatchEvent(new MouseEvent('pointerdown'))
  expect(outside).toHaveBeenCalledOnce()
  const replacement = document.implementation.createHTMLDocument('reload')
  Object.defineProperty(node, 'contentDocument', { configurable: true, value: replacement })
  node.dispatchEvent(new Event('load'))
  original.dispatchEvent(new MouseEvent('pointerdown'))
  expect(outside).toHaveBeenCalledOnce()
  replacement.dispatchEvent(new MouseEvent('pointerdown'))
  expect(outside).toHaveBeenCalledTimes(2)
  node.remove(); await Promise.resolve()
  replacement.dispatchEvent(new MouseEvent('pointerdown'))
  expect(outside).toHaveBeenCalledTimes(2)
  stop()
})

it('lets the active menu consume Escape before underlying frame shortcuts', () => {
  const child = frame().contentDocument!
  const innerShortcut = vi.fn(); child.body.addEventListener('keydown', innerShortcut)
  const dismiss = vi.fn()
  const stop = watchFrameMenuDismissal(document, vi.fn(), event => {
    if (event.key !== 'Escape') return
    event.preventDefault(); event.stopPropagation(); dismiss()
  })
  const escape = new child.defaultView!.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  child.body.dispatchEvent(escape)
  expect(dismiss).toHaveBeenCalledOnce(); expect(innerShortcut).not.toHaveBeenCalled(); expect(escape.defaultPrevented).toBe(true)
  child.body.dispatchEvent(new child.defaultView!.KeyboardEvent('keydown', { key: 'a', bubbles: true }))
  expect(innerShortcut).toHaveBeenCalledOnce()
  stop()
})
