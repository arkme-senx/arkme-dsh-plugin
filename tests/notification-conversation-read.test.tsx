// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn(), recordingRead: vi.fn(), officialRead: vi.fn(), world: vi.fn(), recordings: [] as any[] }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call, ArkmeClientError: class extends Error {} }))
vi.mock('../src/client/recording-notification-store.js', () => ({
  useRecordingNotifications: () => ({ items: mocks.recordings, total: mocks.recordings.length, unreadCount: 1, ready: true }),
  recordingNotifications: { read: mocks.recordingRead },
}))
vi.mock('../src/client/official-notification-store.js', () => ({
  useOfficialNotifications: () => ({ items: [{ id: 'official-one', title: '公告', summary: '公告内容', publishedAtMillis: 100, readAtMillis: 0 }], summary: { total: 1, unreadCount: 1 }, ready: true }),
  officialNotifications: { read: mocks.officialRead },
}))
vi.mock('../src/client/world-notification-reader.js', () => ({ readWorldNotifications: async () => [], readWorldReactionNotifications: mocks.world }))
import { arkmeUi } from '../src/client/ui-controller.js'
import { ArkmeNotificationCenter, arkmeNotificationStore } from '../src/client/ArkmeNotificationCenter.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { ArkmeNotificationPreview } from '../src/client/ArkmeNotificationPreview.js'
import { arkmeVisibleReadIntentAllowed } from '../src/client/read-intent-visibility.js'
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
  mocks.world.mockReset().mockResolvedValue([])
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

it('previews real notification cards and categories without read receipts, then resumes ordinary visible-read behavior', async () => {
  const close = vi.fn(), open = vi.fn()
  await act(async () => root.render(<ArkmeNotificationPreview onClose={close} onOpen={open} />))
  await tick()
  const dialog = document.querySelector<HTMLElement>('[aria-label="通知预览"]')!
  expect(dialog.textContent).toContain('录音处理完成')
  expect(dialog.textContent).toContain('公告内容')
  expect(arkmeVisibleReadIntentAllowed()).toBe(false)
  expect(mocks.recordingRead).not.toHaveBeenCalled()
  expect(mocks.officialRead).not.toHaveBeenCalled()
  await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="通知类型"]')!.click())
  await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(button => button.textContent === '官方')!.click())
  await tick()
  expect(dialog.querySelector('[role="list"]')?.textContent).not.toContain('录音处理完成')
  expect(mocks.officialRead).not.toHaveBeenCalled()
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
  expect(mocks.recordingRead).not.toHaveBeenCalled()
  expect(mocks.call.mock.calls.filter(([op]) => /mark-read|mark-viewed|notifications-read/.test(op))).toHaveLength(0)
  await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(close).toHaveBeenCalledOnce(); expect(open).not.toHaveBeenCalled()
  await act(async () => dialog.querySelector<HTMLButtonElement>('footer button')!.click())
  expect(open).toHaveBeenCalledOnce()
  await act(async () => root.render(<ArkmeNotificationCenter />)); await tick()
  expect(arkmeVisibleReadIntentAllowed()).toBe(true)
  expect(mocks.recordingRead).toHaveBeenCalledOnce()
})

const worldNotice = { id: 'same', revision: 1, actorUserId: 8, unread: true, target: { id: 'world-target', worldRecordRef: 'reaction-context' }, recordRef: 'public-navigation', selections: [{ key: 'like', expression: { text: '赞' }, at: 1000 }] }
it('shows World reactions in the existing list, ACKs only their owner, and opens the public thread', async () => {
  mocks.world.mockResolvedValue([worldNotice])
  const open = vi.spyOn(arkmeUi, 'showWorldInteraction').mockImplementation(() => {})
  await act(async () => root.render(<ArkmeNotificationCenter />)); await tick()
  expect(container.textContent).toContain('收到世界表态')
  expect(mocks.call).toHaveBeenCalledWith('world.reactions', { action: 'notifications-read', accountKey: 'test:742', items: [{ id: 'same', revision: 1 }] }, expect.any(AbortSignal))
  expect(mocks.call.mock.calls.some(([op,p]) => op === 'reactions' && p?.action === 'notifications-read')).toBe(false)
  const row = container.querySelector<HTMLElement>('[data-notification-id="world-reaction:same:1"]')!
  await act(async () => row.querySelector<HTMLButtonElement>('.arkme-notification-link')!.click())
  expect(open).toHaveBeenCalledExactlyOnceWith('public-navigation')
  expect(mocks.call.mock.calls.some(([op]) => op === 'source.timeline-around')).toBe(false)
})
it('keeps failed World receipts unread and prevents a concurrent pre-ACK refresh from restoring unread', async () => {
  mocks.world.mockResolvedValue([worldNotice])
  await act(async () => { await arkmeNotificationStore.refresh('test:742') })
  mocks.call.mockRejectedValueOnce(Error('offline'))
  await expect(arkmeNotificationStore.markWorldReactionsRead([worldNotice], 'test:742', new AbortController().signal)).rejects.toThrow('offline')
  expect(arkmeNotificationStore.getSnapshot().worldReactionItems[0]?.unread).toBe(true)
  let finish!: (rows: any[]) => void
  mocks.world.mockImplementationOnce(() => new Promise(done => { finish = done }))
  const refreshing = arkmeNotificationStore.refresh('test:742')
  await arkmeNotificationStore.markWorldReactionsRead([worldNotice], 'test:742', new AbortController().signal)
  finish([worldNotice, { ...worldNotice, id: 'new', revision: 2 }]); await refreshing
  expect(arkmeNotificationStore.getSnapshot().worldReactionItems[0]?.unread).toBe(false)
  expect(arkmeNotificationStore.getSnapshot().worldReactionItems[1]?.unread).toBe(true)
})
it('discards a late prior-account World inbox response and does not acknowledge the old account', async () => {
  let finish!: (rows: any[]) => void
  mocks.world.mockImplementationOnce(() => new Promise(done => { finish = done }))
  const old = arkmeNotificationStore.refresh('test:742')
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 743 })
  await arkmeNotificationStore.refresh('test:743')
  finish([worldNotice]); await old
  expect(arkmeNotificationStore.getSnapshot().worldReactionItems).toEqual([])
  const before = mocks.call.mock.calls.length
  await arkmeNotificationStore.markWorldReactionsRead([worldNotice], 'test:742', new AbortController().signal)
  expect(mocks.call).toHaveBeenCalledTimes(before)
})
