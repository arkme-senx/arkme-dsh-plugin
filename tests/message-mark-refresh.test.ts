import { afterEach, expect, it, vi } from 'vitest'
import { startMessageMarkRefresh } from '../src/client/message-mark-refresh.js'
afterEach(() => vi.useRealTimers())
it('coalesces bursts, resets fallback after hints, and keeps one read in flight', async () => {
  vi.useFakeTimers()
  let invalidate!: () => void, release!: () => void
  const stop = vi.fn(), error = vi.fn()
  const read = vi.fn(async () => {})
  const owner = startMessageMarkRefresh({read, visible: () => true, subscribe: listener => { invalidate = listener; return stop }, onError:error})
  await vi.advanceTimersByTimeAsync(0); expect(read).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(14950)
  for (let i=0;i<100;i++) invalidate()
  await vi.advanceTimersByTimeAsync(99); expect(read).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1); expect(read).toHaveBeenCalledTimes(2)
  read.mockImplementationOnce(() => new Promise<void>(resolve => { release=resolve }))
  invalidate(); await vi.advanceTimersByTimeAsync(100); expect(read).toHaveBeenCalledTimes(3)
  for(let i=0;i<100;i++) invalidate()
  await vi.advanceTimersByTimeAsync(1000); expect(read).toHaveBeenCalledTimes(3)
  release(); await vi.advanceTimersByTimeAsync(100); expect(read).toHaveBeenCalledTimes(4)
  owner.dispose(); expect(stop).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(60000); expect(read).toHaveBeenCalledTimes(4);expect(error).not.toHaveBeenCalled()
})
it('gates hidden views, recovers on visibility, and cancels queued work on dispose', async () => {
 vi.useFakeTimers();let visible=false;const read=vi.fn(async()=>{})
 const owner=startMessageMarkRefresh({read, visible:()=>visible,onError:vi.fn()})
 await vi.advanceTimersByTimeAsync(60000);expect(read).not.toHaveBeenCalled()
 visible=true;owner.request(0);await vi.advanceTimersByTimeAsync(0);expect(read).toHaveBeenCalledOnce()
 owner.request();owner.dispose();await vi.advanceTimersByTimeAsync(60000);expect(read).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0)
})
