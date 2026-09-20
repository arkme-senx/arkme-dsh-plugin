// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeQuickAddButton } from '../src/client/ArkmeQuickAdd.js'

let root: Root
let host: HTMLDivElement

const flush = async () => { await act(async () => { await Promise.resolve() }) }
const trigger = () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
const menu = () => document.querySelector('[role="menu"]')

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
})

const render = async () => {
  await act(async () => {
    root.render(<ArkmeQuickAddButton onContactAdd={vi.fn()} onSourceCreated={vi.fn()} />)
  })
  await flush()
}

/** React derives onPointerEnter from pointerover/pointerout delegation. */
const hover = async (type: 'pointerover' | 'pointerout' = 'pointerover', pointerType?: string) => {
  await act(async () => {
    const event = new MouseEvent(type, { bubbles: true })
    if (pointerType !== undefined) Object.defineProperty(event, 'pointerType', { value: pointerType })
    trigger().dispatchEvent(event)
  })
  await flush()
}

it('opens the quick-add menu on hover instead of waiting for a click', async () => {
  await render()
  expect(menu()).toBeNull()
  await hover('pointerover')
  expect(menu()).not.toBeNull()
  expect(trigger().getAttribute('aria-expanded')).toBe('true')
})

it('does not open on a touch pointer, which keeps the click affordance', async () => {
  await render()
  await hover('pointerover', 'touch')
  expect(menu()).toBeNull()
  await act(async () => { trigger().click() })
  await flush()
  expect(menu()).not.toBeNull()
})

it('keeps a hover-opened menu open when the pointer clicks the trigger', async () => {
  await render()
  await hover('pointerover')
  expect(menu()).not.toBeNull()
  // A real pointer click reports detail >= 1 and must not toggle the hover menu
  // closed again; only a keyboard activation (detail 0) toggles.
  await act(async () => { trigger().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })) })
  await flush()
  expect(menu()).not.toBeNull()
  await act(async () => { trigger().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })) })
  await flush()
  expect(menu()).toBeNull()
})

it('closes the hover-opened menu once the pointer leaves the trigger and menu', async () => {
  await render()
  await hover('pointerover')
  expect(menu()).not.toBeNull()
  await act(async () => {
    document.body.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 500, clientY: 500 }))
  })
  await flush()
  expect(menu()).toBeNull()
})

it('closes the quick-add menu on an outside pointerdown in the host document', async () => {
  await render()
  await act(async () => { trigger().click() })
  await flush()
  expect(menu()).not.toBeNull()

  await act(async () => {
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
  })
  await flush()
  expect(menu()).toBeNull()
})

it('closes the quick-add menu on a pointerdown inside a same-origin embedded document', async () => {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  await render()
  await act(async () => { trigger().click() })
  await flush()
  expect(menu()).not.toBeNull()

  await act(async () => {
    frame.contentDocument!.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
  })
  await flush()
  expect(menu()).toBeNull()
  frame.remove()
})

it('closes the quick-add menu even when the outside target stops pointerdown propagation', async () => {
  // The native menu dismisses from a bubble-phase listener, so one intermediate
  // stopPropagation() used to disable outside dismissal for the whole surface.
  const blocker = document.createElement('div')
  blocker.addEventListener('pointerdown', event => { event.stopPropagation() })
  const inner = document.createElement('span')
  blocker.append(inner)
  document.body.append(blocker)

  await render()
  await act(async () => { trigger().click() })
  await flush()
  expect(menu()).not.toBeNull()

  await act(async () => {
    inner.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
  })
  // The unblocked fallback closes on the next task, after the bubble listener
  // had its chance to cancel it.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  await flush()
  expect(menu()).toBeNull()
  blocker.remove()
})
