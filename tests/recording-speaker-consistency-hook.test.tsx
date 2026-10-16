import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { useRecordingConsistency } from '../src/client/recordings/use-recording-consistency.js'

const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
describe('consistency read lifecycle', () => {
  let renderer: ReactTestRenderer, current: ReturnType<typeof useRecordingConsistency>
  function View({ refs }: { refs: string[] }) { current = useRecordingConsistency(refs); return null }
  beforeEach(() => { mocks.call.mockReset(); arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 }) })
  afterEach(async () => { await act(async () => renderer?.unmount()) })
  it('batches summaries and stops immediately when capability is unavailable', async () => {
    const refs = Array.from({ length: 152 }, (_, i) => `ref-${i}`)
    mocks.call.mockResolvedValue({ supported: false })
    await act(async () => { renderer = create(<View refs={refs} />); await tick() })
    expect(mocks.call).toHaveBeenCalledTimes(1)
    expect(mocks.call.mock.calls[0]![1].anchorRefs).toHaveLength(100)
    expect(current!.supported).toBe(false)
    mocks.call.mockResolvedValue({ supported: true, groups: [] })
    await act(async () => { current!.reload(); await tick() })
    expect(mocks.call.mock.calls.slice(1).map(call => call[1].anchorRefs.length)).toEqual([100, 52])
  })
  it('aborts a stale scope and ignores its late result', async () => {
    let finish!: (value: unknown) => void
    mocks.call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue({ supported: false })
    await act(async () => { renderer = create(<View refs={['old']} />); await tick() })
    const oldSignal = mocks.call.mock.calls[0]![2]
    await act(async () => { renderer.update(<View refs={['new']} />); await tick() })
    expect(oldSignal.aborted).toBe(true)
    await act(async () => { finish({ supported: true, groups: [{ anchorRef: 'old', score: 100 }] }); await tick() })
    expect(current!.groups).toEqual([])
    expect(current!.supported).toBe(false)
  })
  it('clears account-scoped results on logout without sending another request', async () => {
    mocks.call.mockResolvedValue({ supported: true, groups: [{ anchorRef: 'ref', score: 86 }] })
    await act(async () => { renderer = create(<View refs={['ref']} />); await tick() })
    expect(current!.groups).toHaveLength(1)
    await act(async () => { arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' }); await tick() })
    expect(current!.groups).toEqual([])
    expect(mocks.call).toHaveBeenCalledTimes(1)
  })
})
