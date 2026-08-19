import { describe, expect, it, vi } from 'vitest'
import { ArkmeExtensionInstallTasks } from '../../src/extensions/install-tasks.js'

describe('extension install task coordinator', () => {
  it('keeps install execution in Host and exposes byte progress to the owning session', async () => {
    const agent = { id: 'session-1' }
    const apply = vi.fn(async (input: {
      onProgress?: (progress: { phase: 'downloading'; downloadedBytes: number; totalBytes: number }) => void
    }) => {
      input.onProgress?.({ phase: 'downloading', downloadedBytes: 4, totalBytes: 10 })
      await Promise.resolve()
      return {
        extension_id: 'ext-1', version: '1.0.0', state: 'active', installed: true as const,
        active: true, approval_required: false, restart_required: false, message: '已激活',
      }
    })
    const tasks = new ArkmeExtensionInstallTasks(
      { apply } as never,
      { get: sessionId => sessionId === 'session-1' ? agent : undefined },
    )

    const started = tasks.start({ extensionId: 'ext-1', sessionId: 'session-1' })
    await vi.waitFor(() => { expect(tasks.status(started.taskId, 'session-1').done).toBe(true) })

    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ agent, extensionId: 'ext-1' }))
    expect(tasks.status(started.taskId, 'session-1')).toMatchObject({
      phase: 'active', done: true, downloadedBytes: 4, totalBytes: 10,
      result: { installed: true, active: true, approvalRequired: false, restartRequired: false },
    })
    expect(() => tasks.status(started.taskId, 'session-2')).toThrow('不属于当前会话')
    tasks.dispose()
  })

  it('rejects an install when the selected DSH Agent is not live', () => {
    const tasks = new ArkmeExtensionInstallTasks({} as never, { get: () => undefined })
    expect(() => tasks.start({ extensionId: 'ext-1', sessionId: 'missing' })).toThrow('当前 DSH 会话不可用')
    tasks.dispose()
  })

  it('pauses an active download and resumes it as a fresh verified attempt', async () => {
    let attempt = 0
    const apply = vi.fn((input: {
      signal: AbortSignal
      onProgress?: (progress: { phase: 'downloading'; downloadedBytes: number; totalBytes: number }) => void
    }) => {
      attempt += 1
      input.onProgress?.({ phase: 'downloading', downloadedBytes: 5, totalBytes: 10 })
      if (attempt === 2) return Promise.resolve({
        extension_id: 'ext-1', version: '1.0.0', state: 'active', installed: true as const,
        active: true, approval_required: false, restart_required: false, message: '已激活',
      })
      return new Promise((_resolve, reject) => {
        input.signal.addEventListener('abort', () => {
          const error = new Error('aborted'); error.name = 'AbortError'; reject(error)
        }, { once: true })
      })
    })
    const tasks = new ArkmeExtensionInstallTasks(
      { apply } as never,
      { get: () => ({ id: 'session-1' }) },
    )
    const started = tasks.start({ extensionId: 'ext-1', sessionId: 'session-1' })
    expect(tasks.pause(started.taskId, 'session-1')).toMatchObject({ phase: 'paused', done: false })
    expect(tasks.resume(started.taskId, 'session-1')).toMatchObject({ phase: 'downloading', done: false })
    await vi.waitFor(() => { expect(tasks.status(started.taskId, 'session-1').phase).toBe('active') })
    expect(apply).toHaveBeenCalledTimes(2)
    tasks.dispose()
  })

  it('delegates uninstall with the exact live Agent', async () => {
    const agent = { id: 'session-1' }
    const uninstall = vi.fn(async () => ({ extension_id: 'ext-1', installed: false, active: false }))
    const restartProfileChange = vi.fn(async () => ({ restarting: true as const }))
    const tasks = new ArkmeExtensionInstallTasks({ uninstall, restartProfileChange } as never, { get: () => agent })
    await expect(tasks.uninstall({ extensionId: 'ext-1', sessionId: 'session-1' }))
      .resolves.toMatchObject({ installed: false })
    expect(uninstall).toHaveBeenCalledWith({ agent, extensionId: 'ext-1' })
    await expect(tasks.restart('ext-1')).resolves.toEqual({ restarting: true })
    expect(restartProfileChange).toHaveBeenCalledWith('ext-1')
    tasks.dispose()
  })
})
