// @vitest-environment jsdom
import { JSDOM } from 'jsdom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { DeepSeekHarnessSurface } from '../src/client/DeepSeekHarnessSurface.js'
import { HARNESS_DOCUMENT_STARTED } from '../src/harness-embed-contract.js'
import { HARNESS_NATIVE_OPEN } from '../src/client/harness-native-navigation.js'

vi.mock('../src/client/harness-window-drag.js', () => ({ watchHarnessWindowDrag: () => () => {} }))
vi.mock('../src/client/harness-surface-viewport.js', () => ({ watchHarnessSurfaceViewport: () => () => {} }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const cleanup: Array<() => void> = []
afterEach(() => { cleanup.splice(0).reverse().forEach(fn => fn()); vi.restoreAllMocks(); vi.useRealTimers(); document.body.replaceChildren() })

function fixture() {
  vi.useFakeTimers()
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  const render = (accountId = 11) => act(() => root.render(<DeepSeekHarnessSurface accountId={accountId} accountScope={`test:${accountId}`} />))
  cleanup.push(() => act(() => root.unmount()))
  render()
  return { render, frame: document.querySelector('iframe')!, surface: document.querySelector('[data-arkme-owned="deepseek-harness-surface"]')! }
}

function start(frame: HTMLIFrameElement, html: string) {
  const native = new JSDOM(html, { url: `${location.origin}/arkme-self/harness-frame?arkme-harness-embed=1` })
  cleanup.unshift(() => native.window.close())
  vi.spyOn(frame, 'contentDocument', 'get').mockReturnValue(native.window.document)
  act(() => { window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: location.origin, data: { type: HARNESS_DOCUMENT_STARTED } })) })
  return native.window.document
}

it('shows immediate feedback and reveals actual native UI without waiting for iframe load', async () => {
  const { frame, surface } = fixture()
  expect(surface.textContent).toContain('正在加载对话')
  const native = start(frame, '<div id="root">Loading plugins…</div>')
  expect(frame.style.visibility).toBe('inherit')
  expect(surface.getAttribute('data-arkme-boot-feedback')).toBe('loading')
  await act(async () => { native.querySelector('#root')!.innerHTML = '<main data-arkme-session-frame><textarea>未发送草稿</textarea></main>' })
  expect(surface.hasAttribute('data-arkme-boot-feedback')).toBe(false)
  expect(surface.querySelector('[data-arkme-harness-boot]')).toBeNull()
  expect(document.querySelector('iframe')).toBe(frame)
  expect(vi.getTimerCount()).toBe(0)
})

it('offers a bounded manual retry while preserving the selected conversation', () => {
  const { frame, surface } = fixture()
  act(() => document.dispatchEvent(new CustomEvent(HARNESS_NATIVE_OPEN, { detail: { accountId: '11', accountScope: 'test:11', runtimeRef: '', sessionRef: 'retained-session' } })))
  act(() => vi.advanceTimersByTime(15_000))
  expect(surface.textContent).toContain('对话加载较慢')
  expect(document.querySelector('iframe')).toBe(frame)
  act(() => surface.querySelector<HTMLButtonElement>('[data-arkme-harness-boot] button')!.click())
  expect(document.querySelector('iframe')).not.toBe(frame)
  expect(surface.getAttribute('data-arkme-open-session')).toBe('retained-session')
  expect(surface.textContent).toContain('正在加载对话')
})

it('does not cover a usable native editor if optional layout markers change', () => {
  const { frame, surface } = fixture()
  start(frame, '<main><div role="textbox" contenteditable="true">Native editor</div></main>')
  expect(surface.querySelector('[data-arkme-harness-boot]')).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
})

it('shows an explicit document error, and late content from a previous account cannot finish the new one', async () => {
  const { frame, surface, render } = fixture()
  const native = start(frame, '<p role="alert">DeepSeek Harness unavailable</p>')
  expect(surface.textContent).toContain('对话加载失败')
  render(42)
  await act(async () => { native.body.innerHTML = '<main data-arkme-session-frame>旧账号消息</main>' })
  expect(document.querySelector('[data-arkme-account-id="42"]')?.textContent).toContain('正在加载对话')
  expect(document.querySelector('iframe')).not.toBe(frame)
  expect(document.body.textContent).not.toContain('旧账号消息')
})
