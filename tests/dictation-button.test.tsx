// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeDictationButton } from '../src/client/ArkmeDictationButton.js'
import type { MicrophoneCaptureOptions } from '../src/client/recordings/direct-recording-capture.js'
const mocks = vi.hoisted(() => ({ capture: vi.fn(), call: vi.fn(), release: vi.fn(), stop: vi.fn(), auth: { auth: { status: 'authenticated', environment: 'test', userId: 42 } } }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/auth-store.js', () => ({ arkmeAuthStore: { subscribe: () => () => {}, getSnapshot: () => mocks.auth } }))
vi.mock('../src/client/recordings/direct-recording-capture.js', () => ({ captureMicrophone: mocks.capture }))
vi.mock('../src/client/dictation-activity.js', () => ({ acquireDictation: async () => mocks.release }))
let host: HTMLDivElement, root: Root, options: MicrophoneCaptureOptions
const target = { insert: vi.fn(() => true), close: vi.fn() }, busy = vi.fn()
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks()
  mocks.stop.mockResolvedValue(undefined)
  mocks.capture.mockImplementation(async value => { options = value; await options.onReady(16000); return { stop: mocks.stop } })
  mocks.call.mockResolvedValue({ text: '识别文字' })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function mount(scopeKey = 'one') { await act(async () => root.render(<ArkmeDictationButton scopeKey={scopeKey} getTarget={() => target} onBusyChange={busy} />)) }
it('shows listening immediately, prevents double starts, and releases the microphone after stop', async () => {
  await mount(); const mic = host.querySelector<HTMLButtonElement>('button[aria-label="语音输入"]')!
  await act(async () => { mic.click(); mic.click() })
  expect(mocks.capture).toHaveBeenCalledTimes(1)
  expect(host.querySelector('button[aria-label="停止听写"]')).not.toBeNull()
  expect(busy).toHaveBeenCalledWith(true)
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="停止听写"]')!.click())
  expect(mocks.stop).toHaveBeenCalled(); expect(mocks.release).toHaveBeenCalled(); expect(busy).toHaveBeenLastCalledWith(false)
  expect(host.querySelector('button[aria-label="语音输入"]')).not.toBeNull()
})
it('updates only its original editor, cancels on scope change, and ignores the late result', async () => {
  await mount(); await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="语音输入"]')!.click())
  let finish!: (value: { text: string }) => void
  mocks.call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await act(async () => { for (let i = 0; i < 80; i++) options.onChunk(new ArrayBuffer(3200), .2) })
  await mount('two'); await act(async () => finish({ text: '不能写入新对话' }))
  expect(target.insert).not.toHaveBeenCalled(); expect(mocks.call.mock.calls[0]![2].aborted).toBe(true)
  expect(host.getAttribute('data-arkme-dictation')).not.toBe('listening')
})
it('displays a microphone permission failure and allows retry without changing editor text', async () => {
  mocks.capture.mockRejectedValueOnce(new Error('麦克风权限未获允许'))
  await mount(); await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="语音输入"]')!.click())
  expect(host.textContent).toContain('麦克风权限未获允许'); expect(mocks.release).toHaveBeenCalled()
  expect(target.insert).not.toHaveBeenCalled()
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="语音输入"]')!.click())
  expect(host.querySelector('[data-arkme-dictation="listening"]')).not.toBeNull()
})
it('keeps sending blocked while a failed phrase awaits retry or explicit discard', async () => {
  mocks.call.mockRejectedValueOnce(new Error('语音识别启动失败（HTTP 500）'))
  await mount(); await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="语音输入"]')!.click())
  await act(async () => { for (let i = 0; i < 80; i++) options.onChunk(new ArrayBuffer(3200), .2) })
  expect(host.textContent).toContain('HTTP 500')
  expect(busy).toHaveBeenLastCalledWith(true)
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="语音输入"]')!.disabled).toBe(true)
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="关闭听写提示"]')!.click())
  expect(busy).toHaveBeenLastCalledWith(false)
  expect(target.insert).not.toHaveBeenCalled()
})
