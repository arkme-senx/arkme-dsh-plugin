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
  vi.useRealTimers()
  vi.restoreAllMocks()
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

const move = async (x: number, y: number) => {
  await act(async () => {
    document.body.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }))
  })
}
const advance = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms) }) }
const setRects = () => {
  vi.spyOn(trigger(), 'getBoundingClientRect').mockReturnValue(new DOMRect(200, 24, 40, 40))
  vi.spyOn(menu()!, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 68, 220, 160))
}

it('closes after 250ms outside without restarting the timer on every move', async () => {
  await render()
  await hover('pointerover')
  vi.useFakeTimers()
  await move(500, 500)
  await advance(200)
  expect(menu()).not.toBeNull()
  await move(510, 510)
  await advance(50)
  expect(menu()).toBeNull()
})

it('keeps the vertical crossing gap open even if the pointer pauses there', async () => {
  await render()
  await hover()
  setRects()
  vi.useFakeTimers()
  for (const [x, y] of [[220, 60], [220, 66], [80, 90]]) {
    await move(x!, y!)
    await advance(500)
    expect(menu()).not.toBeNull()
  }
})

it.each([[220, 44], [80, 90], [220, 66]])('cancels closing when re-entering the trigger, menu or gap (%s,%s)', async (x, y) => {
  await render()
  await hover()
  setRects()
  vi.useFakeTimers()
  await move(245, 66)
  await advance(200)
  await move(x, y)
  await advance(500)
  expect(menu()).not.toBeNull()
})

it.each(['Escape', 'outside', 'select'])('dismisses immediately on %s and cancels the old timer before reopening', async reason => {
  await render()
  await hover()
  vi.useFakeTimers()
  await move(500, 500)
  await advance(100)
  await act(async () => {
    if (reason === 'Escape') trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    else if (reason === 'outside') document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    else document.querySelector<HTMLButtonElement>('[role="menuitem"][aria-label="添加联系人"]')!.click()
  })
  expect(menu()).toBeNull()
  await hover()
  await advance(500)
  expect(menu()).not.toBeNull()
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
