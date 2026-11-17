import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeFileSendTask } from '../src/file-transfer-contract.js'
import { useArkmeFileSendTasks, wakeArkmeFileTask } from '../src/client/file-send-tasks.js'
import { fileSendPolicy, resetFileSendPolicy } from '../src/client/file-send-admission.js'
import { ArkmeClientError } from '../src/client/api.js'

const api = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({
  ...(await original<typeof import('../src/client/api.js')>()), callArkme: api.call,
}))

function task(state: ArkmeFileSendTask['state']): ArkmeFileSendTask {
  return {
    sourceRef: 'source-1', recordUid: 'record-1', relationUid: 'relation-1',
    content: { textContent: '附件' }, fileRefs: [], captureContext: {},
    taskRef: 'task-1', createdAtMillis: 1, state, files: [],
  }
}

afterEach(() => {
  resetFileSendPolicy(undefined)
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('shares a capability probe, times out stalled reads and retries without falling back', async () => {
  vi.useFakeTimers()
  const policy = { version: 1, textMessagesVersion: 1, admissionRecoveryVersion: 1 }
  api.call.mockReset().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(policy)
  const first = fileSendPolicy('test:7')
  expect(fileSendPolicy('test:7')).toBe(first)
  const timedOut = expect(first).rejects.toThrow('读取超时')
  await vi.advanceTimersByTimeAsync(30_000)
  await timedOut
  await expect(fileSendPolicy('test:7')).resolves.toBe(policy)
  await expect(fileSendPolicy('test:7')).resolves.toBe(policy)
  expect(api.call).toHaveBeenCalledTimes(2)
  resetFileSendPolicy('test:8')
  await expect(fileSendPolicy('test:8')).resolves.toBe(policy)
  expect(api.call).toHaveBeenCalledTimes(3)
})

it.each(['operation-unknown', 'file-flow-unavailable'])('keeps the legacy send path for an explicit %s capability response', async code => {
  api.call.mockReset().mockRejectedValue(new ArkmeClientError({ code, message: '不支持本地发送', retryable: false }))
  await expect(fileSendPolicy('test:7')).resolves.toBeUndefined()
  await expect(fileSendPolicy('test:7')).resolves.toBeUndefined()
  expect(api.call).toHaveBeenCalledTimes(1)
})

describe('file send task polling', () => {
  it('applies persisted event receipts without admission or completion queries and releases recovery timers', async () => {
    vi.useFakeTimers()
    api.call.mockReset().mockResolvedValue([])
    let value!: ReturnType<typeof useArkmeFileSendTasks>
    function Harness() { value = useArkmeFileSendTasks('source-1', 7); return null }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<Harness />) })
    try {
      const queued = { ...task('queued'), revision: 1 }
      await act(async () => { value.accept(queued) })
      expect(api.call).toHaveBeenCalledOnce()
      await act(async () => { wakeArkmeFileTask(7, queued.taskRef, { ...queued, state: 'sent', revision: 3 }) })
      expect(value.tasks[0]).toMatchObject({ state: 'sent', revision: 3 })
      await vi.advanceTimersByTimeAsync(5000)
      expect(api.call).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    } finally { act(() => renderer.unmount()) }
  })

  it('retains a receipt delivered before admission returns and ignores an older in-flight snapshot', async () => {
    vi.useFakeTimers()
    let finish!: (tasks: ArkmeFileSendTask[]) => void
    api.call.mockReset().mockImplementation(() => new Promise(resolve => { finish = resolve }))
    let value!: ReturnType<typeof useArkmeFileSendTasks>
    function Harness() { value = useArkmeFileSendTasks('source-1', 7); return null }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<Harness />) })
    try {
      const queued = { ...task('queued'), revision: 1 }
      await act(async () => { wakeArkmeFileTask(8, queued.taskRef, { ...queued, state: 'sent', revision: 99 }) })
      expect(value.tasks).toHaveLength(0)
      await act(async () => { wakeArkmeFileTask(7, queued.taskRef, { ...queued, state: 'sent', revision: 3 }) })
      await act(async () => { value.accept(queued); finish([{ ...queued, state: 'sending', revision: 2 }]) })
      expect(value.tasks[0]).toMatchObject({ state: 'sent', revision: 3 })
      expect(value.activeTaskKeys.has(queued.taskRef)).toBe(true)
      await vi.advanceTimersByTimeAsync(5000)
      expect(api.call).toHaveBeenCalledOnce()
    } finally { act(() => renderer.unmount()) }
  })

  it('recovers a stuck read through the existing deadline without accepting its late snapshot', async () => {
    vi.useFakeTimers()
    let late!: (tasks: ArkmeFileSendTask[]) => void
    api.call.mockReset().mockImplementationOnce(() => new Promise(resolve => { late = resolve }))
      .mockResolvedValue([task('sent')])
    let value!: ReturnType<typeof useArkmeFileSendTasks>
    function Harness() { value = useArkmeFileSendTasks('source-1', 7); return null }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<Harness />) })
    try {
      const signal = api.call.mock.calls[0]![2] as AbortSignal
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
      expect(signal.aborted).toBe(true)
      await act(async () => { await vi.advanceTimersByTimeAsync(750) })
      expect(api.call).toHaveBeenCalledTimes(2)
      expect(value.tasks[0]?.state).toBe('sent')
      await act(async () => { late([task('sending')]) })
      expect(value.tasks[0]?.state).toBe('sent')
    } finally { act(() => renderer.unmount()) }
    expect(vi.getTimerCount()).toBe(0)
  })
  it('retains burst admissions across an older in-flight snapshot without restarting the owner', async () => {
    vi.useFakeTimers()
    let finish!: (tasks: ArkmeFileSendTask[]) => void
    const first = task('queued'), second = { ...first, taskRef: 'task-2', recordUid: 'record-2' }
    api.call.mockReset().mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      .mockResolvedValue([{ ...first, state: 'sent' }, { ...second, state: 'sent' }])
    let value!: ReturnType<typeof useArkmeFileSendTasks>
    function Harness() { value = useArkmeFileSendTasks('source-1', 7); return null }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<Harness />) })
    try {
      const initialSignal = api.call.mock.calls[0]![2] as AbortSignal
      await act(async () => { value.accept(first); value.accept(second); wakeArkmeFileTask(7, 'task-1') })
      expect(initialSignal.aborted).toBe(false)
      expect(api.call).toHaveBeenCalledOnce()
      expect(value.tasks.map(task => task.taskRef)).toEqual(['task-1', 'task-2'])
      await act(async () => { finish([]) })
      expect(api.call).toHaveBeenCalledTimes(2)
      expect(value.tasks.map(task => task.state)).toEqual(['sent', 'sent'])
      await vi.advanceTimersByTimeAsync(10_000)
      expect(api.call).toHaveBeenCalledTimes(2)
    } finally { act(() => renderer.unmount()) }
    expect(vi.getTimerCount()).toBe(0)
  })

  it('replaces a stalled delta on explicit recovery and coalesces repeated refreshes', async () => {
    vi.useFakeTimers()
    let finish!: (tasks: ArkmeFileSendTask[]) => void
    api.call.mockReset().mockResolvedValueOnce([task('sending')])
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      .mockResolvedValue([task('sent')])
    let value!: ReturnType<typeof useArkmeFileSendTasks>
    function Harness() { value = useArkmeFileSendTasks('source-1', 7); return null }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<Harness />) })
    try {
      await act(async () => { wakeArkmeFileTask(7, 'task-1') })
      const signal = api.call.mock.calls[1]![2] as AbortSignal
      await act(async () => { value.refresh(); value.refresh() })
      expect(api.call).toHaveBeenCalledTimes(3)
      expect(signal.aborted).toBe(true)
      await act(async () => { finish([task('sending')]) })
      expect(api.call).toHaveBeenCalledTimes(3)
      expect(api.call.mock.calls[2]![1]).toEqual({ sourceRef: 'source-1' })
      expect(value.tasks[0]?.state).toBe('sent')
    } finally { act(() => renderer.unmount()) }
  })
  it.each(['sending', 'sent'] as const)('coalesces in-flight completion hints when the pending response is %s and cleans up', async pendingState => {
    vi.useFakeTimers()
    let finish!: (tasks: ArkmeFileSendTask[]) => void
    api.call.mockReset().mockResolvedValueOnce([task('sending')])
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      .mockResolvedValue([task('sent')])
    let value!: ReturnType<typeof useArkmeFileSendTasks>
    function Harness() { value = useArkmeFileSendTasks('source-1', 7); return null }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<Harness />) })
    await act(async () => { wakeArkmeFileTask(7, 'task-1') })
    await act(async () => { for (let index = 0; index < 20; index++) wakeArkmeFileTask(7, 'task-1') })
    expect(api.call).toHaveBeenCalledTimes(2)
    await act(async () => { finish([task(pendingState)]) })
    const expectedCalls = pendingState === 'sent' ? 2 : 3
    expect(api.call).toHaveBeenCalledTimes(expectedCalls)
    expect(value.tasks[0]?.state).toBe('sent')
    act(() => renderer.unmount())
    wakeArkmeFileTask(7, 'task-1')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(api.call).toHaveBeenCalledTimes(expectedCalls)
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each([true, false])('settles text promptly with a notification=%s and retains bounded polling recovery', async notify => {
    vi.useFakeTimers()
    let state: ArkmeFileSendTask['state'] = 'sending'
    api.call.mockReset().mockImplementation(async () => [task(state)])
    let value!: ReturnType<typeof useArkmeFileSendTasks>
    function Harness() { value = useArkmeFileSendTasks('source-1', 7); return null }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<Harness />) })
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(120) })
      state = 'sent'
      if (notify) {
        await act(async () => { wakeArkmeFileTask(7, 'task-1') })
        expect(value.tasks[0]?.state).toBe('sent')
      } else {
        expect(value.tasks[0]?.state).toBe('sending')
        await act(async () => { await vi.advanceTimersByTimeAsync(630) })
        expect(value.tasks[0]?.state).toBe('sent')
      }
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
      expect(api.call).toHaveBeenCalledTimes(2)
      expect(vi.getTimerCount()).toBe(0)
    } finally { act(() => renderer.unmount()) }
  })
  it('distinguishes restored sent receipts from active sends without extra polling or cross-scope retention', async () => {
    vi.useFakeTimers()
    const old = { ...task('sent'), taskRef: 'old' }
    const uploading = { ...task('uploading'), taskRef: 'new' }
    api.call.mockResolvedValueOnce([old, uploading]).mockResolvedValue([old, { ...uploading, state: 'sent' }])
    let value!: ReturnType<typeof useArkmeFileSendTasks>
    function Harness({ source = 'source-1' }: { source?: string }) { value = useArkmeFileSendTasks(source, 7); return null }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<Harness />) })
    try {
      expect([...value.activeTaskKeys]).toEqual(['new'])
      await act(async () => { await vi.advanceTimersByTimeAsync(750) })
      expect([...value.activeTaskKeys]).toEqual(['new'])
      await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
      expect(api.call).toHaveBeenCalledTimes(2)
      api.call.mockResolvedValue([])
      act(() => { renderer.update(<Harness source="source-2" />) })
      expect(value.activeTaskKeys.size).toBe(0)
    } finally { act(() => renderer.unmount()) }
  })

  it('reads the active task immediately on a matching Host hint and stops polling after settlement', async () => {
    vi.useFakeTimers()
    api.call.mockResolvedValueOnce([task('uploading')]).mockResolvedValue([task('sent')])
    let value!: ReturnType<typeof useArkmeFileSendTasks>
    function Harness() { value = useArkmeFileSendTasks('source-1', 7); return null }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<Harness />) })
    try {
      await act(async () => { wakeArkmeFileTask(8, 'task-1') })
      expect(api.call).toHaveBeenCalledTimes(1)
      await act(async () => { wakeArkmeFileTask(7, 'task-1') })
      expect(value.tasks[0]?.state).toBe('sent')
      await act(async () => { wakeArkmeFileTask(7, 'task-1'); wakeArkmeFileTask(7, 'task-1') })
      await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
      expect(api.call).toHaveBeenCalledTimes(2)
    } finally { act(() => renderer.unmount()) }
  })

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
