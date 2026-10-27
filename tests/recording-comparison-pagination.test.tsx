// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: api.call }))
import { RecordingComparisonPane } from '../src/client/recordings/RecordingComparisonView.js'
import { RecordingStrategyComparison } from '../src/client/recordings/RecordingStrategyComparison.js'
let root: Root | undefined
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.querySelectorAll('[data-transcript-time]').length * 100 })
})
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); api.call.mockReset() })
async function render(ui: React.ReactNode) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root!.render(ui)) }
const options = { strategies: [{ id: 'system-sd-asr/v1', name: '测试版v1' }], officialStrategy: 'system-sd-asr/v1', officialComplete: true, officialFailed: false, canStart: false, expiresAtMillis: 0, results: [] }
const item = (n: number) => ({ itemRef: String(n), startAtMillis: n * 1000, endAtMillis: n * 1000 + 500, speaker: 0, text: `发言${n}` })
function sourceRead(_op: string, input: any) {
  if (input.action === 'sources') return { items: [{ sourceRef: 'source', fileName: 'audio.wav', startAtMillis: 0 }] }
  if (input.action === 'options') return options
}
it('automatically traverses sparse and empty storage parts, then continues near the bottom without duplicate rows', async () => {
  api.call.mockImplementation(async (op, input) => {
    if (input.action !== 'page') return sourceRead(op, input)
    if (!input.cursor) return { items: [item(1), item(2)], nextCursor: 'empty', complete: false }
    if (input.cursor === 'empty') return { items: [], nextCursor: 'second', complete: false }
    if (input.cursor === 'second') return { items: Array.from({ length: 10 }, (_, i) => item(i + 3)), nextCursor: 'last', complete: false }
    return { items: [item(13)], complete: true }
  })
  await render(<RecordingStrategyComparison sessionRef="session" fileName="audio.wav" mediaPath="/media" onClose={() => {}} />)
  expect(api.call.mock.calls.filter(([, p]) => p.action === 'page').map(([, p]) => p.cursor)).toEqual([undefined, 'empty', 'second'])
  const pane = document.querySelector('[data-transcript-time]')!.parentElement!
  pane.scrollTop = 400
  await act(async () => { pane.dispatchEvent(new Event('scroll')); pane.dispatchEvent(new Event('scroll')) })
  expect(document.querySelectorAll('[data-transcript-time]')).toHaveLength(13)
  expect(api.call.mock.calls.filter(([, p]) => p.action === 'page')).toHaveLength(4)
  expect(document.body.textContent).not.toContain('加载更多')
})
it('retains visible content after a page error and retries only on user action', async () => {
  let fail = true
  api.call.mockImplementation(async (op, input) => {
    if (input.action !== 'page') return sourceRead(op, input)
    if (!input.cursor) return { items: [item(1)], nextCursor: 'next', complete: false }
    if (fail) throw new Error('网络暂时不可用')
    return { items: [item(2)], complete: true }
  })
  await render(<RecordingStrategyComparison sessionRef="session" fileName="audio.wav" mediaPath="/media" onClose={() => {}} />)
  expect(document.body.textContent).toContain('发言1')
  expect(document.body.textContent).toContain('网络暂时不可用')
  expect(api.call.mock.calls.filter(([, p]) => p.action === 'page')).toHaveLength(2)
  fail = false
  await act(async () => Array.from(document.querySelectorAll('button')).find(b => b.textContent === '重试')!.click())
  expect(document.querySelectorAll('[data-transcript-time]')).toHaveLength(2)
  expect(document.body.textContent).not.toContain('网络暂时不可用')
})
it('does not spin on an unchanged pending cursor and resumes when the owner advances it', async () => {
  const next = vi.fn(async () => {})
  const view = (cursor: string) => <RecordingComparisonPane pagination={{ cursor, loading: false, error: '', next }}>正文</RecordingComparisonPane>
  await render(view('one'))
  await act(async () => root!.render(view('one')))
  expect(next).toHaveBeenCalledOnce()
  await act(async () => root!.render(view('two')))
  expect(next).toHaveBeenCalledTimes(2)
})
it('fills newly available viewport space and disconnects the resize observer on close', async () => {
  let resize!: () => void
  const disconnect = vi.fn(), next = vi.fn(async () => {})
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback } observe() {} disconnect = disconnect })
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1500)
  await render(<RecordingComparisonPane pagination={{ cursor: 'next', loading: false, error: '', next }}>正文</RecordingComparisonPane>)
  expect(next).not.toHaveBeenCalled()
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(1300)
  await act(async () => resize())
  expect(next).toHaveBeenCalledOnce()
  await act(async () => root!.unmount()); root = undefined
  expect(disconnect).toHaveBeenCalledOnce(); vi.unstubAllGlobals()
})
