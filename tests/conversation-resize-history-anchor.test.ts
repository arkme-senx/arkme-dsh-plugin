// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { observeConversationResize } from '../src/client/conversation-resize-anchor.js'

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals() })

function fixture() {
  let resize = () => {}
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe() {}
    disconnect() {}
  })
  const body = document.createElement('div'), content = document.createElement('ul'), row = document.createElement('li')
  row.dataset.arkmeConversationRow = 'message:saved'
  body.append(content); content.append(row); document.body.append(body)
  let height = 5000, rowTop = 900
  Object.defineProperties(body, { scrollHeight: { get: () => height }, clientHeight: { value: 600 } })
  body.scrollTop = 1000
  body.getBoundingClientRect = () => ({ top: 100, bottom: 700, height: 600 }) as DOMRect
  content.getBoundingClientRect = () => ({ height }) as DOMRect
  row.getBoundingClientRect = () => ({ top: 100 + rowTop - body.scrollTop, bottom: 250 + rowTop - body.scrollTop, height: 150 }) as DOMRect
  const owner = observeConversationResize(body, undefined, content)
  owner.commit(false)
  return { body, content, row, owner, resize: () => resize(),
    shift(delta: number) { height += delta; rowTop += delta } }
}

it.each([false, true])('preserves restored history through deferred virtual height changes (scroll first: %s)', scrollFirst => {
  const f = fixture()
  try {
    for (const delta of [240, -180]) {
      const before = f.row.getBoundingClientRect().top
      f.shift(delta)
      if (scrollFirst) f.body.dispatchEvent(new Event('scroll'))
      f.resize()
      expect(f.row.getBoundingClientRect().top).toBe(before)
      f.resize()
      expect(f.row.getBoundingClientRect().top).toBe(before)
    }
  } finally { f.owner() }
})

it('does not double-correct native anchoring, and respects subsequent user scrolling', () => {
  const f = fixture()
  try {
    f.shift(240); f.body.scrollTop += 240; f.body.dispatchEvent(new Event('scroll')); f.resize()
    expect(f.body.scrollTop).toBe(1240)
    f.body.scrollTop += 30; f.body.dispatchEvent(new Event('scroll'))
    f.shift(100); f.resize()
    expect(f.body.scrollTop).toBe(1370)
  } finally { f.owner() }
})

it('rebases to explicit timeline navigation and releases detached anchors', () => {
  const f = fixture()
  try {
    f.shift(1000); f.body.scrollTop = 1950; f.owner.commit(false)
    f.shift(120); f.resize()
    expect(f.body.scrollTop).toBe(2070)
    f.row.remove(); f.shift(100); f.resize()
    expect(f.body.scrollTop).toBe(2070)
    f.owner.commit(true)
    expect(f.body.scrollTop).toBe(f.body.scrollHeight - 600)
  } finally { f.owner() }
})
