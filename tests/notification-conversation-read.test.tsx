// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn(), recordingRead: vi.fn(), officialRead: vi.fn(), recordings: [] as any[] }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call, ArkmeClientError: class extends Error {} }))
vi.mock('../src/client/recording-notification-store.js', () => ({
  useRecordingNotifications: () => ({ items: mocks.recordings, total: mocks.recordings.length, unreadCount: 1, ready: true }),
  recordingNotifications: { read: mocks.recordingRead },
}))
vi.mock('../src/client/official-notification-store.js', () => ({
  useOfficialNotifications: () => ({ items: [{ id: 'official-one', title: '公告', summary: '公告内容', publishedAtMillis: 100, readAtMillis: 0 }], summary: { total: 1, unreadCount: 1 }, ready: true }),
  officialNotifications: { read: mocks.officialRead },
}))
vi.mock('../src/client/world-notification-reader.js', () => ({ readWorldNotifications: async () => [] }))
import { ArkmeNotificationCenter } from '../src/client/ArkmeNotificationCenter.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
let container: HTMLDivElement, root: Root
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(300) }) }
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const hidden = this.dataset.notificationId === 'official:official-one'
    const top = hidden ? -300 : 0
    return { top, bottom: top + 200, left: 0, right: 600, width: 600, height: 200, x: 0, y: top, toJSON: () => ({}) }
  })
  mocks.recordings = [{ id: 'recording-one', sequence: '60', batchId: 'batch-one', stage: 'processing', state: 'completed', fileCount: 2, completedCount: 2, failedCount: 0, atMillis: 1000, readAtMillis: 0, message: '', days: [] }]
  mocks.recordingRead.mockReset().mockResolvedValue(undefined)
  mocks.officialRead.mockReset().mockResolvedValue(undefined)
  mocks.call.mockReset().mockResolvedValue({ items: [], unreadCount: 0, total: 0, seenThroughSequence: 0 })
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 742 })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => {
  await act(async () => { root.unmount(); arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' }) })
  container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
})
it('acknowledges the displayed recording revision once, leaves offscreen official notices alone, and accepts a later revision', async () => {
  await act(async () => root.render(<ArkmeNotificationCenter />)); await tick()
  expect(mocks.recordingRead).toHaveBeenCalledExactlyOnceWith('test:742', [expect.objectContaining({ id: 'recording-one', sequence: '60' })])
  expect(mocks.officialRead).not.toHaveBeenCalled()
  expect(container.textContent).not.toContain('全部已读')
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
  expect(mocks.recordingRead).toHaveBeenCalledTimes(1)
  mocks.recordings = [{ ...mocks.recordings[0], sequence: '61', message: '新整理结果' }]
  await act(async () => root.render(<ArkmeNotificationCenter />)); await tick()
  expect(mocks.recordingRead).toHaveBeenLastCalledWith('test:742', [expect.objectContaining({ sequence: '61' })])
  expect(mocks.recordingRead).toHaveBeenCalledTimes(2)
})
it('retries a failed automatic receipt while keeping its message visible', async () => {
  mocks.recordingRead.mockRejectedValueOnce(new Error('offline'))
  await act(async () => root.render(<ArkmeNotificationCenter />)); await tick()
  expect(container.textContent).toContain('录音处理完成')
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
  expect(mocks.recordingRead).toHaveBeenCalledTimes(2)
  expect(container.textContent).toContain('录音处理完成')
})
it('filters from the header without exposing unread controls', async () => {
  await act(async () => root.render(<ArkmeNotificationCenter />))
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click())
  const option = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')).find(button => button.textContent === '官方')!
  await act(async () => option.click()); await tick()
  expect(container.querySelector('[role="list"]')?.textContent).toContain('公告内容')
  expect(container.querySelector('[role="list"]')?.textContent).not.toContain('录音处理完成')
  expect(mocks.recordingRead).not.toHaveBeenCalled()
  expect(container.querySelector('[aria-label="未读"]')).toBeNull()
})
