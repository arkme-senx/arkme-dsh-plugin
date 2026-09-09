import { describe, expect, it, vi } from 'vitest'
import { ArkmePluginError, ServiceRuntime } from '../src/services/service.js'
import { RecordingImportContractError, type RecordingImportJob, type RecordingImportSource } from '../src/recording-import-contract.js'
import {
  RecordingImportCoordinator,
  type RecordingImportGateway,
  type RecordingImportStore,
} from '../src/recording-import-coordinator.js'

function job(overrides: Partial<RecordingImportJob> = {}): RecordingImportJob {
  return {
    jobId: 'job-1', userId: 42, revision: 1, phase: 'prepared',
    fileName: 'meeting.m4a', mimeType: 'audio/mp4', fileSize: 1024,
    durationMillis: 60_000, sha256: 'a'.repeat(64), startAtMillis: 1_725_000_000_000,
    belongUserId: 42, sourceHandle: '/private/job-1.upload', uploadedBytes: 0,
    createdAtMillis: 1_725_000_000_100, updatedAtMillis: 1_725_000_000_100,
    ...overrides,
  }
}

function memoryStore(initial: RecordingImportJob): RecordingImportStore & { value: RecordingImportJob } {
  return {
    value: initial,
    async getRecordingImportJob(userId, jobId) {
      return this.value.userId === userId && this.value.jobId === jobId ? { ...this.value } : undefined
    },
    async replaceRecordingImportJob(userId, next, expectedRevision) {
      if (this.value.userId !== userId || this.value.revision !== expectedRevision) return false
      this.value = { ...next }
      return true
    },
  }
}

function gateway(): RecordingImportGateway {
  return {
    ensureSession: vi.fn(async () => 'session-1'),
    createChild: vi.fn(async () => 'child-1'),
    upload: vi.fn(async (_job, onProgress) => {
      await onProgress(512, { uploadId: 'checkpoint-1' })
      await onProgress(1024, { uploadId: 'checkpoint-1' })
    }),
    finishChild: vi.fn(async () => undefined),
    finishSession: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => undefined),
  }
}

function source(): RecordingImportSource {
  return {
    inspect: vi.fn<RecordingImportSource['inspect']>(async () => ({ kind: 'm4a', durationMillis: 60_000 })),
    discard: vi.fn(async () => undefined),
  }
}

describe('RecordingImportCoordinator', () => {
  it.each(['login-required', 'login-expired'])('resumes the retained upload after %s without recreating owner records', async code => {
    let signedIn = true
    const runtime = new ServiceRuntime({ environment: 'test' } as never, {
      read: async () => signedIn ? { userId: 42, accessToken: 'test', refreshToken: 'test' } : undefined,
    } as never, {} as never)
    const store = memoryStore(job({ phase: 'uploading', sessionId: 'session-1', childId: 'child-1',
      uploadedBytes: 512, uploadCheckpoint: { uploadId: 'checkpoint-1' } }))
    const owner = gateway()
    vi.mocked(owner.upload).mockImplementationOnce(async (_job, progress) => {
      signedIn = false
      if (code === 'login-expired') throw new ArkmePluginError(code, '登录已过期', false, 401)
      await progress(768)
    })
    const input = source()
    const coordinator = new RecordingImportCoordinator(store, owner, input, async () => (await runtime.requireSession()).userId)
    try {
      await expect(coordinator.run(42, 'job-1')).resolves.toMatchObject({
        phase: 'failed', failedFromPhase: 'uploading', errorCode: code, retryable: true,
        sessionId: 'session-1', childId: 'child-1', sourceHandle: '/private/job-1.upload',
        uploadCheckpoint: { uploadId: 'checkpoint-1' },
      })
      expect(input.discard).not.toHaveBeenCalled()
      signedIn = true
      await expect(coordinator.retry(42, 'job-1', store.value.revision - 1)).rejects.toMatchObject({ code: 'recording-import-revision-conflict' })
      await expect(coordinator.retry(77, 'job-1', store.value.revision)).rejects.toMatchObject({ code: 'recording-import-not-found' })
      await expect(coordinator.retry(42, 'job-1', store.value.revision)).resolves.toMatchObject({ phase: 'accepted' })
      expect(owner.ensureSession).not.toHaveBeenCalled()
      expect(owner.createChild).not.toHaveBeenCalled()
      expect(owner.upload).toHaveBeenLastCalledWith(expect.objectContaining({
        sessionId: 'session-1', childId: 'child-1', uploadCheckpoint: { uploadId: 'checkpoint-1' },
      }), expect.any(Function), undefined)
    } finally { runtime.dispose() }
  })

  it('does not turn a permanent business rejection into a recoverable login failure', async () => {
    const store = memoryStore(job())
    const owner = gateway()
    vi.mocked(owner.ensureSession).mockRejectedValue(new ArkmePluginError('account-unavailable', '账号不可用', false, 403))
    const coordinator = new RecordingImportCoordinator(store, owner, source(), async () => 42)
    await expect(coordinator.run(42, 'job-1')).resolves.toMatchObject({ phase: 'failed', retryable: false })
    await expect(coordinator.retry(42, 'job-1', store.value.revision)).rejects.toMatchObject({ code: 'recording-import-retry-forbidden' })
  })

  it('releases only a rejected duplicate source after persisting the failure and preserves its identity', async () => {
    const store = memoryStore(job())
    const owner = gateway()
    vi.mocked(owner.ensureSession).mockRejectedValue(new RecordingImportContractError('recording-import-duplicate', 'duplicate'))
    const input = source()
    vi.mocked(input.discard).mockImplementation(async () => {
      expect(store.value).toMatchObject({ phase: 'failed', sourceHandle: '', sha256: 'a'.repeat(64) })
    })
    await new RecordingImportCoordinator(store, owner, input, async () => 42).run(42, 'job-1')
    expect(input.discard).toHaveBeenCalledWith('/private/job-1.upload')
    expect(owner.deleteSession).not.toHaveBeenCalled()
    expect(store.value).toMatchObject({ failedFromPhase: 'prepared', retryable: false, uploadedBytes: 0 })
  })

  it.each([
    { sessionId: 'owned-session' }, { childId: 'owned-child' }, { uploadedBytes: 1 },
    { uploadCheckpoint: { uploadId: 'checkpoint' } }, { childFinished: true },
  ])('retains the source when a duplicate error coexists with owner evidence: %o', async evidence => {
    const store = memoryStore(job(evidence))
    const owner = gateway()
    const duplicate = new RecordingImportContractError('recording-import-duplicate', 'duplicate')
    vi.mocked(owner.ensureSession).mockRejectedValue(duplicate)
    vi.mocked(owner.createChild).mockRejectedValue(duplicate)
    const input = source()
    await new RecordingImportCoordinator(store, owner, input, async () => 42).run(42, 'job-1')
    expect(store.value).toMatchObject({ phase: 'failed', sourceHandle: '/private/job-1.upload', ...evidence })
    expect(input.discard).not.toHaveBeenCalled()
    expect(owner.deleteSession).not.toHaveBeenCalled()
  })

  it('keeps the failed checkpoint when retry is cancelled during the task read', async () => {
    const store = memoryStore(job({ phase: 'failed', failedFromPhase: 'uploading', retryable: true }))
    const controller = new AbortController()
    const read = store.getRecordingImportJob.bind(store)
    vi.spyOn(store, 'getRecordingImportJob').mockImplementationOnce(async (...args) => {
      const result = await read(...args); controller.abort(); return result
    })
    const owner = gateway()
    const coordinator = new RecordingImportCoordinator(store, owner, source(), async () => 42)
    await expect(coordinator.resumeRetry(42, 'job-1', 1, controller.signal)).rejects.toThrow()
    expect(store.value).toMatchObject({ phase: 'failed', revision: 1 })
    expect(owner.upload).not.toHaveBeenCalled()
  })

  it('reuses owner checkpoints and completes the desktop upload sequence', async () => {
    const store = memoryStore(job())
    const owner = gateway()
    const input = source()
    const coordinator = new RecordingImportCoordinator(store, owner, input, async () => 42, () => 2_000)

    await expect(coordinator.run(42, 'job-1')).resolves.toMatchObject({ phase: 'accepted' })
    expect(owner.ensureSession).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'meeting.m4a' }), undefined)
    expect(owner.createChild).toHaveBeenCalledTimes(1)
    expect(owner.upload).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1', childId: 'child-1' }),
      expect.any(Function),
      undefined,
    )
    expect(owner.finishChild).toHaveBeenCalledWith(expect.objectContaining({ childId: 'child-1' }), undefined)
    expect(owner.finishSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1' }), undefined)
    expect(store.value).toMatchObject({
      phase: 'accepted', uploadedBytes: 1024, revision: 8, sourceHandle: '', sha256: '',
    })
    expect(input.discard).toHaveBeenCalledWith('/private/job-1.upload')
    expect(store.value.sessionId).toBe('session-1')
    expect(store.value.childId).toBe('child-1')
  })

  it('checks the active account again before each remote side effect', async () => {
    const store = memoryStore(job())
    const owner = gateway()
    const users = [42, 77]
    const coordinator = new RecordingImportCoordinator(store, owner, source(), async () => users.shift() ?? 77, () => 2_000)

    await expect(coordinator.run(42, 'job-1')).resolves.toMatchObject({
      phase: 'failed', errorCode: 'recording-import-account-mismatch', retryable: true,
    })
    expect(owner.ensureSession).toHaveBeenCalledTimes(1)
    expect(owner.createChild).not.toHaveBeenCalled()
  })

  it('continues from stored owner ids without creating duplicate sessions or children', async () => {
    const store = memoryStore(job({
      phase: 'failed', failedFromPhase: 'uploading', retryable: true,
      sessionId: 'session-1', childId: 'child-1', uploadedBytes: 512,
    }))
    const owner = gateway()
    const coordinator = new RecordingImportCoordinator(store, owner, source(), async () => 42, () => 2_000)

    await expect(coordinator.retry(42, 'job-1', 1)).resolves.toMatchObject({ phase: 'accepted' })
    expect(owner.ensureSession).not.toHaveBeenCalled()
    expect(owner.createChild).not.toHaveBeenCalled()
    expect(owner.upload).toHaveBeenCalledTimes(1)
  })

  it('replays only the idempotent session finish after its first response becomes unknown', async () => {
    const store = memoryStore(job())
    const owner = gateway()
    let finishSessionCalls = 0
    owner.finishSession = vi.fn(async () => {
      finishSessionCalls += 1
      if (finishSessionCalls === 1) throw new Error('response lost after owner accepted')
    })
    const coordinator = new RecordingImportCoordinator(store, owner, source(), async () => 42, () => 2_000)

    await expect(coordinator.run(42, 'job-1')).resolves.toMatchObject({
      phase: 'failed', failedFromPhase: 'finalizing', retryable: true, childFinished: true,
    })
    await expect(coordinator.retry(42, 'job-1', store.value.revision)).resolves.toMatchObject({ phase: 'accepted' })
    expect(owner.ensureSession).toHaveBeenCalledTimes(1)
    expect(owner.createChild).toHaveBeenCalledTimes(1)
    expect(owner.finishChild).toHaveBeenCalledTimes(1)
    expect(owner.finishSession).toHaveBeenCalledTimes(2)
  })

  it('publishes a resumed retry revision before the background upload continues', async () => {
    const store = memoryStore(job({
      phase: 'failed', failedFromPhase: 'uploading', retryable: true,
      sessionId: 'session-1', childId: 'child-1', uploadedBytes: 512,
    }))
    const owner = gateway()
    const coordinator = new RecordingImportCoordinator(store, owner, source(), async () => 42, () => 2_000)

    await expect(coordinator.resumeRetry(42, 'job-1', 1)).resolves.toMatchObject({
      phase: 'uploading', revision: 2, errorCode: undefined,
    })
    expect(owner.upload).not.toHaveBeenCalled()
  })

  it('aborts the active multipart runner and deletes the incomplete owner session before cancellation', async () => {
    const store = memoryStore(job({ phase: 'uploading', sessionId: 'session-1', childId: 'child-1' }))
    let progress: ((uploadedBytes: number, checkpoint?: Record<string, unknown>) => Promise<void>) | undefined
    let progressAborted = false
    const owner = gateway()
    owner.upload = vi.fn(async (_job, onProgress, signal) => {
      progress = onProgress
      await new Promise<void>((resolve, reject) => {
        signal?.addEventListener('abort', () => { reject(signal.reason) }, { once: true })
      })
      try {
        await onProgress(512, { uploadId: 'checkpoint-1' })
      } catch (error) {
        progressAborted = true
        throw error
      }
    })
    const input = source()
    const coordinator = new RecordingImportCoordinator(store, owner, input, async () => 42, () => 2_000)

    const controller = new AbortController()
    const running = coordinator.run(42, 'job-1', controller.signal)
    while (progress === undefined) await new Promise(resolve => { setTimeout(resolve, 0) })
    controller.abort()
    await expect(running).resolves.toMatchObject({ phase: 'uploading' })
    await expect(coordinator.cancel(42, 'job-1', 1)).resolves.toMatchObject({ phase: 'cancelled' })
    expect(progressAborted).toBe(false)
    expect(owner.deleteSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1' }))
    expect(owner.finishChild).not.toHaveBeenCalled()
    expect(owner.finishSession).not.toHaveBeenCalled()
    expect(input.discard).toHaveBeenCalledWith('/private/job-1.upload')
  })

  it('does not publish cancelled when owner cleanup fails', async () => {
    const store = memoryStore(job({ phase: 'uploading', revision: 4, sessionId: 'session-1', childId: 'child-1' }))
    const owner = gateway()
    owner.deleteSession = vi.fn(async () => { throw new Error('owner unavailable') })
    const coordinator = new RecordingImportCoordinator(store, owner, source(), async () => 42, () => 2_000)

    await expect(coordinator.cancel(42, 'job-1', 4)).rejects.toThrow('owner unavailable')
    expect(store.value.phase).toBe('uploading')
    expect(store.value.sessionId).toBe('session-1')
  })

  it('rejects a stale cancel revision instead of cancelling a newer retry run', async () => {
    const store = memoryStore(job({
      phase: 'uploading', revision: 4, sessionId: 'session-1', childId: 'child-1',
    }))
    const owner = gateway()
    const coordinator = new RecordingImportCoordinator(store, owner, source(), async () => 42, () => 2_000)

    await expect(coordinator.cancel(42, 'job-1', 3)).rejects.toMatchObject({
      code: 'recording-import-revision-conflict',
    })
    expect(owner.deleteSession).not.toHaveBeenCalled()
    expect(store.value.phase).toBe('uploading')
  })

  it('asks the gateway to recover owner state before cancelling a prepared retry', async () => {
    const store = memoryStore(job({ phase: 'failed', failedFromPhase: 'prepared', retryable: true }))
    const owner = gateway()
    const coordinator = new RecordingImportCoordinator(store, owner, source(), async () => 42, () => 2_000)

    await expect(coordinator.cancel(42, 'job-1', 1)).resolves.toMatchObject({ phase: 'cancelled' })
    expect(owner.deleteSession).toHaveBeenCalledTimes(1)
    expect(vi.mocked(owner.deleteSession).mock.calls[0]?.[0].sessionId).toBeUndefined()
  })

  it('does not let best-effort source cleanup reverse an accepted business outcome', async () => {
    const store = memoryStore(job({
      phase: 'finalizing', sessionId: 'session-1', childId: 'child-1', childFinished: true,
    }))
    const owner = gateway()
    const input = source()
    input.discard = vi.fn(async () => { throw new Error('filesystem cleanup failed') })
    const coordinator = new RecordingImportCoordinator(store, owner, input, async () => 42, () => 2_000)

    await expect(coordinator.run(42, 'job-1')).resolves.toMatchObject({ phase: 'accepted' })
    expect(store.value).toMatchObject({ phase: 'accepted', sourceHandle: '' })
  })

  it('does not block cancellation after owner compensation when local cleanup fails', async () => {
    const store = memoryStore(job({ phase: 'uploading', sessionId: 'session-1', childId: 'child-1' }))
    const owner = gateway()
    const input = source()
    input.discard = vi.fn(async () => { throw new Error('filesystem cleanup failed') })
    const coordinator = new RecordingImportCoordinator(store, owner, input, async () => 42, () => 2_000)

    await expect(coordinator.cancel(42, 'job-1', 1)).resolves.toMatchObject({ phase: 'cancelled' })
    expect(owner.deleteSession).toHaveBeenCalledTimes(1)
    expect(store.value).toMatchObject({ phase: 'cancelled', sourceHandle: '' })
  })
})
