import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeFileSendTask } from '../src/file-transfer-contract.js'
import { useArkmeFileSendTasks } from '../src/client/file-send-tasks.js'

const api = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: api.call }))

function task(state: ArkmeFileSendTask['state']): ArkmeFileSendTask {
  return {
    sourceRef: 'source-1', recordUid: 'record-1', relationUid: 'relation-1',
    content: { textContent: '附件' }, fileRefs: [], captureContext: {},
    taskRef: 'task-1', createdAtMillis: 1, state, files: [],
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('file send task polling', () => {
  it('stops after the initial read when the source has no active tasks', async () => {
    vi.useFakeTimers()
    api.call.mockResolvedValue([])
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<Probe />); await Promise.resolve() })

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })

    expect(api.call).toHaveBeenCalledOnce()
    renderer.unmount()
  })

  it('polls an active task until it reaches a terminal state and then stops', async () => {
    vi.useFakeTimers()
    api.call.mockResolvedValueOnce([task('uploading')]).mockResolvedValue([task('sent')])
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<Probe />); await Promise.resolve() })

    await act(async () => { await vi.advanceTimersByTimeAsync(750); await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })

    expect(api.call).toHaveBeenCalledTimes(2)
    renderer.unmount()
  })

  it('does not poll an uncertain outcome until the user explicitly reconciles it', async () => {
    vi.useFakeTimers()
    api.call.mockResolvedValue([task('uncertain')])
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<Probe />); await Promise.resolve() })

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })

    expect(api.call).toHaveBeenCalledOnce()
    renderer.unmount()
  })

  it('does not publish a new React snapshot for an unchanged poll result', async () => {
    vi.useFakeTimers()
    const active = task('uploading')
    api.call.mockResolvedValue([active])
    let renders = 0
    const CountingProbe = () => {
      renders += 1
      useArkmeFileSendTasks('source-1', 7)
      return null
    }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<CountingProbe />); await Promise.resolve() })
    const afterInitial = renders

    await act(async () => { await vi.advanceTimersByTimeAsync(750); await Promise.resolve() })

    expect(renders).toBe(afterInitial)
    renderer.unmount()
  })

  it('does not start work while its owning surface is inactive', async () => {
    vi.useFakeTimers()
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<Probe enabled={false} />); await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(api.call).not.toHaveBeenCalled()
    renderer.unmount()
  })

  it('pauses in the background and resumes from the visibility owner', async () => {
    vi.useFakeTimers()
    class VisibilityDocument extends EventTarget {
      visibilityState: 'hidden' | 'visible' = 'hidden'
    }
    const document = new VisibilityDocument()
    vi.stubGlobal('document', document)
    api.call.mockResolvedValue([])
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<Probe />); await Promise.resolve() })
    expect(api.call).not.toHaveBeenCalled()

    document.visibilityState = 'visible'
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve() })

    expect(api.call).toHaveBeenCalledOnce()
    renderer.unmount()
  })
})

function Probe({ enabled = true }: { enabled?: boolean }) {
  const value = useArkmeFileSendTasks('source-1', 7, enabled)
  return <span>{value.tasks.length}</span>
}
