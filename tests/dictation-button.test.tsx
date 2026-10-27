// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeDictationButton } from '../src/client/ArkmeDictationButton.js'
import type { MicrophoneCaptureOptions } from '../src/client/recordings/direct-recording-capture.js'
import type { RealtimeDictationOptions } from '../src/realtime-dictation-client.js'
const mocks = vi.hoisted(() => ({ capture: vi.fn(), connect: vi.fn(), send: vi.fn(), finish: vi.fn(), dispose: vi.fn(), release: vi.fn(), stop: vi.fn(), auth: { auth: { status: 'authenticated', environment: 'test', userId: 42 } } }))
vi.mock('../src/client/api.js', () => ({ connectRealtimeDictation: mocks.connect }))
vi.mock('../src/client/auth-store.js', () => ({ arkmeAuthStore: { subscribe: () => () => {}, getSnapshot: () => mocks.auth } }))
vi.mock('../src/client/recordings/direct-recording-capture.js', () => ({ captureMicrophone: mocks.capture }))
vi.mock('../src/client/dictation-activity.js', () => ({ acquireDictation: async () => mocks.release }))
let host: HTMLDivElement, root: Root, capture: MicrophoneCaptureOptions, connection: RealtimeDictationOptions
const target = { insert: vi.fn(() => true), replace: vi.fn(() => true), close: vi.fn() }, busy = vi.fn()
const update = (text: string, phase: 'listening' | 'finished' = 'listening') => connection.onUpdate({ version: 1, streamRef: 'ref', phase, text, revision: 1 })
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { queueMicrotask(() => callback(0)); return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  mocks.stop.mockResolvedValue(undefined); target.replace.mockReturnValue(true)
  mocks.capture.mockImplementation(async value => { capture = value; await value.onReady(16000); return { stop: mocks.stop } })
  mocks.connect.mockImplementation(async (_route, options) => { connection = options; return { send: mocks.send, finish: mocks.finish, dispose: mocks.dispose } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function mount(scopeKey = 'one') { await act(async () => root.render(<ArkmeDictationButton scopeKey={scopeKey} getTarget={() => target} onBusyChange={busy} />)) }
it('shows the live waveform, prevents double starts and streams text before stop', async () => {
  await mount(); const mic = host.querySelector<HTMLButtonElement>('button[aria-label="语音输入"]')!
  await act(async () => { mic.click(); mic.click() })
  expect(mocks.capture).toHaveBeenCalledTimes(1); expect(mocks.connect).toHaveBeenCalledTimes(1)
  const visual = host.querySelector<HTMLElement>('[data-arkme-dictation-visual="waveform"]')!
  expect(visual.style.width).toBe('34px'); expect(visual.querySelectorAll('line')).toHaveLength(16)
  await act(async () => { capture.onChunk(new ArrayBuffer(3200), .25); update('你好'); update('你好世界') })
  expect(mocks.send).toHaveBeenCalledTimes(1)
  expect(target.replace.mock.calls.map(call => call[0])).toEqual(['你好', '你好世界'])
  expect(host.textContent).toContain('正在实时听写'); expect(busy).toHaveBeenCalledWith(true)
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="停止听写"]')!.click())
  expect(mocks.stop).toHaveBeenCalled(); expect(mocks.release).toHaveBeenCalledTimes(1)
  expect(busy).toHaveBeenLastCalledWith(true)
  await act(async () => update('你好，世界。', 'finished'))
  expect(busy).toHaveBeenLastCalledWith(false); expect(host.querySelector('[data-arkme-dictation-waveform]')).toBeNull()
})
it('cancels on scope change and ignores late upstream text', async () => {
  await mount(); await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="语音输入"]')!.click())
  await mount('two'); await act(async () => update('不能写入新对话'))
  expect(target.replace).not.toHaveBeenCalled(); expect(connection.signal!.aborted).toBe(true)
})
it('shows microphone permission errors and permits a new stream without altering the draft', async () => {
  mocks.capture.mockRejectedValueOnce(new Error('麦克风权限未获允许'))
  await mount(); await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="语音输入"]')!.click())
  expect(host.textContent).toContain('麦克风权限未获允许'); expect(mocks.connect).not.toHaveBeenCalled()
  expect(target.replace).not.toHaveBeenCalled()
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="语音输入"]')!.click())
  expect(host.querySelector('[data-arkme-dictation="listening"]')).not.toBeNull()
})
it('preserves previously inserted text after disconnect and offers a fresh start without replay', async () => {
  await mount(); await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="语音输入"]')!.click())
  await act(async () => { update('已经写入'); connection.onError(new Error('实时听写连接已断开')) })
  expect(host.textContent).toContain('连接已断开'); expect(target.replace).toHaveBeenCalledExactlyOnceWith('已经写入')
  expect(busy).toHaveBeenLastCalledWith(false)
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="语音输入"]')!.disabled).toBe(false)
})
it('blocks sending while an insertion conflict awaits copy, retry or discard', async () => {
  target.replace.mockReturnValue(false)
  await mount(); await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="语音输入"]')!.click())
  await act(async () => update('还未写入的文字'))
  expect(host.textContent).toContain('输入位置已变化'); expect(host.textContent).toContain('复制识别结果')
  expect(busy).toHaveBeenLastCalledWith(true)
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="关闭听写提示"]')!.click())
  expect(busy).toHaveBeenLastCalledWith(false)
})

it('keeps textarea hypotheses current even before a controlled React render flushes', async () => {
  const { textareaDictationTarget } = await import('../src/client/ArkmeDictationButton.js')
  const input = document.createElement('textarea'); input.value = '原文'; input.setSelectionRange(2, 2); document.body.append(input)
  const write = vi.fn(), target = textareaDictationTarget(input, write)!
  expect(target.replace('你')).toBe(true); expect(target.replace('你好')).toBe(true)
  expect(input.value).toBe('原文你好'); expect(write.mock.calls.map(call => call[0])).toEqual(['原文你', '原文你好'])
  target.close(); input.remove()
})
