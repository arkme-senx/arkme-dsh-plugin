// @vitest-environment jsdom
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
const localSnapshot = { phase: 'idle', elapsedMillis: 0 }
vi.mock('../src/client/recordings/direct-recording-store.js', () => ({ directRecordingStore: { subscribe: () => () => {}, getSnapshot: () => localSnapshot } }))
import { ArkmeRecordingPresence } from '../src/client/recordings/ArkmeRecordingPresence.js'
import { ArkmeRecordingHistoryDialog } from '../src/client/recordings/ArkmeRecordingHistoryDialog.js'
let root: Root
let host: HTMLDivElement
const item = { recordingId: 'a', startedAt: 1000, elapsedMillis: 62000, deviceName: 'MacBook Pro', platform: 'macos', recordingMode: 'manual', state: 'stopped', freshness: 'fresh', stoppedAt: 63000, lastConfirmedAt: 63000, expiresAt: 63000 }
const button = (label: string) => [...document.querySelectorAll('button')].find(button => button.textContent === label)!
const mount = async (onClose = vi.fn()) => { await act(async () => root.render(<ArkmeRecordingHistoryDialog onClose={onClose} />)); return onClose }
beforeEach(() => {
  call.mockReset(); call.mockResolvedValue({ items: [item], nextCursor: 'next', hasMore: true, serverNow: 100000 })
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
it('renders a modal with processing rows, paginates and deduplicates overlapping sessions', async () => {
  await mount()
  expect(document.querySelector('dialog[open]')).not.toBeNull()
  expect(document.body.textContent).toContain('MacBook Pro')
  expect(document.body.textContent).toContain('00:01:02')
  expect(document.body.textContent).toContain('长录音')
  expect(document.body.textContent).not.toContain('文件录音')
  expect(document.querySelectorAll('th')).toHaveLength(5)
  expect(document.body.textContent).toContain('已停止')
  call.mockResolvedValue({ items: [item, { ...item, recordingId: 'b', deviceName: 'CDY AN90', state: 'recording', freshness: 'stale', stoppedAt: 0 }], nextCursor: '', hasMore: false, serverNow: 100000 })
  await act(async () => button('加载更多').click())
  expect(call.mock.calls[1]?.[1]).toMatchObject({ cursor: 'next' })
  expect(document.querySelectorAll('tbody tr')).toHaveLength(2)
  expect(document.body.textContent).toContain('状态待确认')
  expect(button('加载更多')).toBeUndefined()
})
it('shows an error then supports retry and an empty result', async () => {
  call.mockRejectedValueOnce(new Error('offline'))
  await mount()
  expect(document.body.textContent).toContain('录音记录加载失败')
  call.mockResolvedValue({ items: [], nextCursor: '', hasMore: false, serverNow: 100000 })
  await act(async () => button('重试').click())
  expect(document.body.textContent).toContain('暂无录音记录')
})
it('closes through Escape cancellation or close button and aborts late requests on unmount', async () => {
  call.mockImplementation(() => new Promise(() => {}))
  const onClose = await mount()
  await act(async () => document.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })))
  expect(onClose).toHaveBeenCalledOnce()
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="关闭录音记录"]')!.click())
  expect(onClose).toHaveBeenCalledTimes(2)
  const signal = call.mock.calls[0]?.[2] as AbortSignal
  await act(async () => root.render(null))
  expect(signal.aborted).toBe(true)
  expect(document.querySelector('dialog')).toBeNull()
})

it('opens from the title action and closes immediately on account change', async () => {
  call.mockImplementation(async (operation: string) => operation === 'recordings.presence'
    ? { items: [], serverNow: Date.now(), pollIntervalMillis: 10000 }
    : { items: [item], nextCursor: '', hasMore: false, serverNow: 100000 })
  await act(async () => root.render(<ArkmeRecordingPresence accountKey="test:42" active />))
  await act(async () => button('录音记录').click())
  expect(document.body.textContent).toContain('MacBook Pro')
  await act(async () => root.render(<ArkmeRecordingPresence accountKey="test:43" active />))
  expect(document.querySelector('dialog')).toBeNull()
  expect(document.body.textContent).not.toContain('MacBook Pro')
})
