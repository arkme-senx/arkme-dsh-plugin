// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useConversationScrollFrame } from '../src/client/conversation-scroll-frame.js'

it('coalesces scroll work into one frame and cancels outgoing account/conversation callbacks', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const frames = new Map<number, FrameRequestCallback>(); let id = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const host = document.createElement('div'); const root = createRoot(host)
  const callback = vi.fn()
  function Fixture({ scope, version = 1 }: { scope: string; version?: number }) {
    const onScroll = useConversationScrollFrame(scope, () => callback(scope, version))
    return <div onScroll={onScroll} />
  }
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(frame => frame(0)) }
  try {
    await act(async () => root.render(<Fixture scope="account:a" />))
    for (let n = 0; n < 200; n++) host.firstChild!.dispatchEvent(new Event('scroll'))
    expect(frames.size).toBe(1); expect(callback).not.toHaveBeenCalled()
    await act(async () => root.render(<Fixture scope="account:a" version={2} />))
    flush(); expect(callback.mock.calls).toEqual([['account:a', 2]])
    host.firstChild!.dispatchEvent(new Event('scroll'))
    await act(async () => root.render(<Fixture scope="account:b" />))
    expect(frames.size).toBe(0); flush(); expect(callback).toHaveBeenCalledTimes(1)
    host.firstChild!.dispatchEvent(new Event('scroll'))
    await act(async () => root.unmount())
    expect(frames.size).toBe(0)
  } finally { vi.unstubAllGlobals() }
})
