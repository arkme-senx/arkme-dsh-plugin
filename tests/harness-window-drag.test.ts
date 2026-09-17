// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { isHarnessWindowDragPoint, watchHarnessWindowDrag } from '../src/client/harness-window-drag.js'

const bounds = (top = 0, height = 80) => ({ x: 0, y: top, top, left: 0, right: 900, bottom: top + height, width: 900, height, toJSON() {} })
let dispose: (() => void) | undefined
afterEach(() => { dispose?.(); dispose = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers() })
function fixture() {
  const surface = document.createElement('section'); surface.dataset.arkmeVisible = 'true'
  const frame = document.createElement('iframe'); surface.append(frame); document.body.append(surface)
  const doc = frame.contentDocument!
  doc.body.innerHTML = `<div data-slot="conversation.session.header"><header id="header"><div id="blank"></div><button id="button"><span id="icon"></span></button><input id="input"></header></div>
    <div data-phase="hero" id="hero"><div data-composer-seat id="composer"><div id="welcome"></div><textarea></textarea></div></div>
    <section data-sidebar-right-panel="push" data-sidebar-right-open><div data-dockkit-strip="main" role="tablist" id="strip"><div data-dockkit-tab="file" role="tab" id="tab"></div><button id="close"></button></div>
    <div data-files-root="/workspace"><div id="pathbar"><span data-files-path="true">/workspace</span><button data-files-reload></button></div><ul><li id="file">file</li></ul></div></section><div id="body"></div>`
  for (const el of doc.querySelectorAll('*')) vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(bounds())
  vi.spyOn(doc.getElementById('hero')!, 'getBoundingClientRect').mockReturnValue(bounds(0, 700))
  vi.spyOn(doc.getElementById('composer')!, 'getBoundingClientRect').mockReturnValue(bounds(300, 200))
  return { surface, frame, doc, el: (id: string) => doc.getElementById(id)! }
}
it('recognizes only header whitespace, empty hero space above composer, and open right-panel chrome', () => {
  const { doc, el } = fixture()
  for (const id of ['blank', 'strip', 'pathbar']) expect(isHarnessWindowDragPoint(doc, el(id), 200, 30)).toBe(true)
  expect(isHarnessWindowDragPoint(doc, el('hero'), 200, 200)).toBe(true)
  expect(isHarnessWindowDragPoint(doc, el('hero'), 200, 320)).toBe(false)
  for (const id of ['button', 'icon', 'input', 'tab', 'close', 'welcome', 'file', 'body']) expect(isHarnessWindowDragPoint(doc, el(id), 200, 30)).toBe(false)
  el('strip').parentElement!.removeAttribute('data-sidebar-right-open')
  expect(isHarnessWindowDragPoint(doc, el('strip'), 200, 30)).toBe(false)
})
it('leaves text selection and menus alone', () => {
  const { doc, el } = fixture()
  el('blank').textContent = 'selectable'
  vi.spyOn(doc, 'createRange').mockReturnValue({ selectNodeContents() {}, getClientRects: () => [bounds()] } as unknown as Range)
  expect(isHarnessWindowDragPoint(doc, el('blank'), 200, 30)).toBe(false)
  el('blank').textContent = ''
  el('blank').setAttribute('role', 'menu')
  expect(isHarnessWindowDragPoint(doc, el('blank'), 200, 30)).toBe(false)
})
it('ends on release, tab hiding and reload, reattaches once, and does nothing without a bridge', async () => {
  const { doc, frame, surface, el } = fixture()
  const send = vi.fn()
  const capture = vi.fn(); const release = vi.fn()
  doc.documentElement.setPointerCapture = capture
  doc.documentElement.hasPointerCapture = () => true
  doc.documentElement.releasePointerCapture = release
  const emit = (kind: string, target = el('blank'), x = 200) => {
    const event = new frame.contentWindow!.MouseEvent(kind, { bubbles: true, cancelable: true, button: 0, clientX: 200, clientY: 30, screenX: x, screenY: 100 })
    Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } })
    target.dispatchEvent(event)
  }
  dispose = watchHarnessWindowDrag(surface, frame, { send })
  emit('pointerdown'); emit('pointermove', el('blank'), 240); emit('pointerup', el('blank'), 240)
  expect(send.mock.calls.map(c => c[0].kind)).toEqual(['begin', 'move', 'end'])
  expect(capture).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce()
  send.mockClear(); emit('pointerdown'); surface.dataset.arkmeVisible = 'false'; await Promise.resolve()
  expect(send.mock.calls.map(c => c[0].kind)).toEqual(['begin', 'end'])
  send.mockClear(); emit('pointerdown'); expect(send).not.toHaveBeenCalled()
  surface.dataset.arkmeVisible = 'true'; emit('pointerdown'); frame.dispatchEvent(new Event('load'))
  expect(send.mock.calls.map(c => c[0].kind)).toEqual(['begin', 'end'])
  send.mockClear(); emit('pointerdown'); emit('pointerup')
  expect(send.mock.calls.map(c => c[0].kind)).toEqual(['begin', 'end'])
  dispose(); send.mockClear(); emit('pointerdown'); expect(send).not.toHaveBeenCalled()
  dispose = watchHarnessWindowDrag(surface, frame)
  emit('pointerdown'); expect(send).not.toHaveBeenCalled()
})
