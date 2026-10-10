// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { startEmbeddedHarnessSession } from '../src/client/harness-new-session.js'
import { HARNESS_ACTIVITY_ATTRIBUTE } from '../src/client/harness-activity.js'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

function fixture(label = '新建会话') {
  const surface = document.createElement('section')
  surface.dataset.arkmeOwned = 'deepseek-harness-surface'
  surface.dataset.arkmeAccountId = '42'
  surface.dataset.arkmeVisible = 'false'
  const iframe = document.createElement('iframe'); surface.append(iframe); document.body.append(surface)
  const native = iframe.contentDocument!
  native.body.innerHTML = `<textarea>其他编辑器草稿</textarea><div data-slot="sidebar"><button aria-label="${label}">New</button></div><div data-composer-card><textarea>保留草稿</textarea></div>`
  return { surface, native, button: native.querySelector('button')!, input: native.querySelector<HTMLTextAreaElement>('[data-composer-card] textarea')! }
}

it.each(['新建会话', 'New session'])('activates the scoped native %s action once, reveals the surface and focuses only its composer', label => {
  const { surface, native, button, input } = fixture(label)
  const order: string[] = []
  button.onclick = () => { order.push('native') }
  let frame: FrameRequestCallback = () => {}
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(fn => { frame = fn; return 1 })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  vi.spyOn(input, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  startEmbeddedHarnessSession(() => { order.push('activate'); surface.dataset.arkmeVisible = 'true' })
  frame(0)
  expect(order).toEqual(['native', 'activate'])
  expect(native.activeElement).toBe(input)
  expect(input.value).toBe('保留草稿')
})

it('leaves navigation and existing drafts alone when the native action is unavailable', () => {
  const { surface, button, input } = fixture()
  const activate = vi.fn()
  button.disabled = true
  expect(() => startEmbeddedHarnessSession(activate)).toThrow('DSH 尚未准备好')
  button.disabled = false; surface.removeAttribute('data-arkme-account-id')
  expect(() => startEmbeddedHarnessSession(activate)).toThrow('DSH 尚未准备好')
  expect(activate).not.toHaveBeenCalled(); expect(input.value).toBe('保留草稿')
})

it('supports the modern native contenteditable composer', () => {
  const { surface, native, input } = fixture()
  const editor = native.createElement('div')
  editor.setAttribute('contenteditable', 'true'); editor.setAttribute('role', 'textbox'); editor.tabIndex = 0
  input.replaceWith(editor)
  let frame: FrameRequestCallback = () => {}
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(fn => { frame = fn; return 1 })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  vi.spyOn(editor, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  startEmbeddedHarnessSession(() => { surface.dataset.arkmeVisible = 'true' })
  frame(0)
  expect(native.activeElement).toBe(editor)
})

it('waits for asynchronous native selection before focusing, instead of focusing the old conversation', async () => {
  const { surface, native, input } = fixture()
  surface.dataset.arkmeAccountScope = 'prod:42'
  const select = (id: string, title: string) => surface.setAttribute(HARNESS_ACTIVITY_ATTRIBUTE, JSON.stringify({ scope: 'prod:42', current: { id, title }, running: [], unread: [], pending: [] }))
  select('old', '已有会话')
  let frame: FrameRequestCallback = () => {}
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(fn => { frame = fn; return 1 })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  vi.spyOn(input, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  startEmbeddedHarnessSession(() => { surface.dataset.arkmeVisible = 'true' })
  frame(0); expect(native.activeElement).not.toBe(input)
  select('new', '新会话'); await Promise.resolve(); frame(1)
  expect(native.activeElement).toBe(input)
})
