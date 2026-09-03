import { describe, expect, it, vi } from 'vitest'
import type { RecordingImportJob, RecordingImportSource } from '../src/recording-import-contract.js'
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
    inspect: vi.fn(async () => ({ kind: 'm4a', durationMillis: 60_000 })),
    discard: vi.fn(async () => undefined),
  }
}

describe('RecordingImportCoordinator', () => {
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
