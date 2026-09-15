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
  it('keeps empty tasks stable across draft renders and source switches', async () => {
    api.call.mockResolvedValue([])
    let tasks: readonly ArkmeFileSendTask[] = []
    function Harness({ source = 'source-1' }: { source?: string }) {
      tasks = useArkmeFileSendTasks(source, 7).tasks
      return null
    }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<Harness />) })
    const empty = tasks
    try {
      await act(async () => { renderer.update(<Harness />) })
      expect(tasks).toBe(empty)
      await act(async () => { renderer.update(<Harness source="source-2" />) })
      expect(tasks).toBe(empty)
    } finally { act(() => renderer.unmount()) }
  })

  it('prevents a shared empty fallback from being contaminated', async () => {
    api.call.mockResolvedValue([])
    let value!: ReturnType<typeof useArkmeFileSendTasks>
    function Harness() { value = useArkmeFileSendTasks('source-1', 7); return null }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<Harness />) })
    try {
      expect(Object.isFrozen(value.tasks)).toBe(true)
      expect(() => (value.tasks as ArkmeFileSendTask[]).push(task('sent'))).toThrow(TypeError)
      expect(value.tasks).toHaveLength(0)
    } finally { act(() => renderer.unmount()) }
  })

  it('accepts a new task and hides old tasks immediately on account or source changes', async () => {
    api.call.mockResolvedValue([])
    let value!: ReturnType<typeof useArkmeFileSendTasks>
    function Harness({ source = 'source-1', user = 7 }: { source?: string; user?: number }) {
      value = useArkmeFileSendTasks(source, user)
      return null
    }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<Harness />) })
    try {
      const empty = value.tasks
      act(() => { value.accept(task('sent')) })
      expect(value.tasks.map(item => item.taskRef)).toEqual(['task-1'])
      act(() => { renderer.update(<Harness user={8} />) })
      expect(value.tasks).toBe(empty)
      act(() => { renderer.update(<Harness source="source-2" user={8} />) })
      expect(value.tasks).toBe(empty)
      act(() => { value.accept(task('sent')) })
      expect(value.tasks).toHaveLength(0)
    } finally { act(() => renderer.unmount()) }
  })

  it('ignores a late response from the previous source', async () => {
    let resolveOld!: (tasks: ArkmeFileSendTask[]) => void
    api.call.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
      .mockResolvedValue([])
    let value!: ReturnType<typeof useArkmeFileSendTasks>
    function Harness({ source }: { source: string }) {
      value = useArkmeFileSendTasks(source, 7)
      return null
    }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<Harness source="source-1" />) })
    try {
      const oldSignal = api.call.mock.calls.at(-1)![2] as AbortSignal
      await act(async () => { renderer.update(<Harness source="source-2" />) })
      expect(oldSignal.aborted).toBe(true)
      const currentEmpty = value.tasks
      await act(async () => { resolveOld([task('sent')]) })
      expect(value.tasks).toBe(currentEmpty)
      expect(value.tasks).toHaveLength(0)
    } finally { act(() => renderer.unmount()) }
  })

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
