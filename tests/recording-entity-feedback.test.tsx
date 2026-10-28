// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
import { useRecordingEntityFeedback } from '../src/client/recordings/use-recording-entity-feedback.js'
let root: Root, host: HTMLDivElement, value: ReturnType<typeof useRecordingEntityFeedback>
const refresh = vi.fn()
function Harness() { value = useRecordingEntityFeedback(refresh); return null }
const tick = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); root = createRoot(host)
  mocks.call.mockReset(); refresh.mockReset()
  await act(async () => root.render(<Harness />))
})
afterEach(() => { act(() => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals() })
it('retries an unknown outcome with the same command, blocks parallel feedback and never optimistically refreshes', async () => {
  mocks.call.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ undoRef: 'undo', undoExpiresAt: Date.now() + 60_000 })
  await act(async () => { value.apply('ref', 'playback'); value.apply('other', 'incorrect'); await tick() })
  expect(mocks.call).toHaveBeenCalledOnce(); expect(refresh).not.toHaveBeenCalled(); expect(value.receipt).toBeUndefined()
  expect(value.retryPending).toBe(true); expect(value.error).toContain('暂未确认')
  await act(async () => { value.apply('other', 'relevant'); value.retry(); await tick() })
  expect(mocks.call).toHaveBeenCalledTimes(2)
  expect(mocks.call.mock.calls[1]!.slice(0, 2)).toEqual(mocks.call.mock.calls[0]!.slice(0, 2))
  expect(refresh).toHaveBeenCalledOnce(); expect(value.retryPending).toBe(false)
})
it('bounds a hung request and retains its id for retry', async () => {
  vi.useFakeTimers(); mocks.call.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue({ undoRef: 'undo', undoExpiresAt: Date.now() + 60_000 })
  await act(async () => { value.apply('ref', 'incorrect'); await tick() })
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
  expect(value.busy).toBe(false); expect(value.error).toContain('暂未确认')
  expect(mocks.call.mock.calls[0]![2].aborted).toBe(true)
  await act(async () => { value.retry(); await tick() })
  expect(mocks.call.mock.calls[1]![1]).toEqual(mocks.call.mock.calls[0]![1])
})
it('allows a fresh operation only after an explicit owner rejection', async () => {
  mocks.call.mockRejectedValueOnce({ body: { code: 'recording-entity-feedback-rejected' } }).mockResolvedValue({ undoRef: 'undo', undoExpiresAt: Date.now() + 60_000 })
  await act(async () => { value.apply('ref', 'incorrect'); await tick() })
  expect(value.retryPending).toBe(false); expect(refresh).toHaveBeenCalledOnce()
  await act(async () => { value.apply('new-ref', 'relevant'); await tick() })
  expect(mocks.call.mock.calls[1]![1].requestId).not.toBe(mocks.call.mock.calls[0]![1].requestId)
})
it('cancels an old account/day view and ignores a late acknowledgment', async () => {
  let resolve!: (value: unknown) => void
  mocks.call.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  await act(async () => { value.apply('old-account-ref', 'playback'); await tick() })
  const signal = mocks.call.mock.calls[0]![2]
  await act(async () => { root.render(<Harness key="new-account-day" />); await tick() })
  expect(signal.aborted).toBe(true)
  await act(async () => { resolve({ undoRef: 'old-undo', undoExpiresAt: Date.now() + 60_000 }); await tick() })
  expect(refresh).not.toHaveBeenCalled(); expect(value.receipt).toBeUndefined()
})
