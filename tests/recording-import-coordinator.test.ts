import { describe, expect, it, vi } from 'vitest'
import type { RecordingImportJob } from '../src/recording-import-contract.js'
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
    belongUserId: 42, temporaryPath: '/private/job-1.upload', uploadedBytes: 0,
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
    checkDuplicateName: vi.fn(async () => false),
    createSession: vi.fn(async () => 'session-1'),
    createChild: vi.fn(async () => 'child-1'),
    uploadObject: vi.fn(async (_job, _objectPath, onProgress) => {
      await onProgress(512, { uploadId: 'checkpoint-1' })
      await onProgress(1024, { uploadId: 'checkpoint-1' })
    }),
    finishChild: vi.fn(async () => undefined),
    finishSession: vi.fn(async () => undefined),
  }
}

describe('RecordingImportCoordinator', () => {
  it('reuses owner checkpoints and completes the desktop upload sequence', async () => {
    const store = memoryStore(job())
    const owner = gateway()
    const coordinator = new RecordingImportCoordinator(store, owner, async () => 42, () => 2_000)

    await expect(coordinator.run(42, 'job-1')).resolves.toMatchObject({ phase: 'accepted' })
    expect(owner.checkDuplicateName).toHaveBeenCalledWith('meeting.m4a')
    expect(owner.createSession).toHaveBeenCalledTimes(1)
    expect(owner.createChild).toHaveBeenCalledTimes(1)
    expect(owner.uploadObject).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1', childId: 'child-1' }),
      'pc_upload/42/session-1/arkme_job-1_0.m4a',
      expect.any(Function),
    )
    expect(owner.finishChild).toHaveBeenCalledWith(expect.objectContaining({ childId: 'child-1' }))
    expect(owner.finishSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1' }))
    expect(store.value).toMatchObject({
      phase: 'accepted', uploadedBytes: 1024, revision: 9, temporaryPath: '', sha256: '',
    })
    expect(store.value.sessionId).toBeUndefined()
    expect(store.value.childId).toBeUndefined()
  })

  it('checks the active account again before each remote side effect', async () => {
    const store = memoryStore(job())
    const owner = gateway()
    const users = [42, 77]
    const coordinator = new RecordingImportCoordinator(store, owner, async () => users.shift() ?? 77, () => 2_000)

    await expect(coordinator.run(42, 'job-1')).resolves.toMatchObject({
      phase: 'failed', errorCode: 'recording-import-account-mismatch', retryable: false,
    })
    expect(owner.checkDuplicateName).toHaveBeenCalledTimes(1)
    expect(owner.createSession).not.toHaveBeenCalled()
  })

  it('continues from stored owner ids without creating duplicate sessions or children', async () => {
    const store = memoryStore(job({
      phase: 'failed', failedFromPhase: 'uploading', retryable: true,
      sessionId: 'session-1', childId: 'child-1', uploadedBytes: 512,
    }))
    const owner = gateway()
    const coordinator = new RecordingImportCoordinator(store, owner, async () => 42, () => 2_000)

    await expect(coordinator.retry(42, 'job-1', 1)).resolves.toMatchObject({ phase: 'accepted' })
    expect(owner.checkDuplicateName).not.toHaveBeenCalled()
    expect(owner.createSession).not.toHaveBeenCalled()
    expect(owner.createChild).not.toHaveBeenCalled()
    expect(owner.uploadObject).toHaveBeenCalledTimes(1)
  })

  it('replays only the idempotent session finish after its first response becomes unknown', async () => {
    const store = memoryStore(job())
    const owner = gateway()
    let finishSessionCalls = 0
    owner.finishSession = vi.fn(async () => {
      finishSessionCalls += 1
      if (finishSessionCalls === 1) throw new Error('response lost after owner accepted')
    })
    const coordinator = new RecordingImportCoordinator(store, owner, async () => 42, () => 2_000)

    await expect(coordinator.run(42, 'job-1')).resolves.toMatchObject({
      phase: 'failed', failedFromPhase: 'finalizing', retryable: true, childFinished: true,
    })
    await expect(coordinator.retry(42, 'job-1', store.value.revision)).resolves.toMatchObject({ phase: 'accepted' })
    expect(owner.createSession).toHaveBeenCalledTimes(1)
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
    const coordinator = new RecordingImportCoordinator(store, owner, async () => 42, () => 2_000)

    await expect(coordinator.resumeRetry(42, 'job-1', 1)).resolves.toMatchObject({
      phase: 'uploading', revision: 2, errorCode: undefined,
    })
    expect(owner.uploadObject).not.toHaveBeenCalled()
  })

  it('aborts the active multipart runner at its next progress boundary after cancellation', async () => {
    const store = memoryStore(job({ phase: 'uploading', sessionId: 'session-1', childId: 'child-1' }))
    let progress: ((uploadedBytes: number, checkpoint?: Record<string, unknown>) => Promise<void>) | undefined
    let progressAborted = false
    const owner = gateway()
    owner.uploadObject = vi.fn(async (_job, _objectPath, onProgress) => {
      progress = onProgress
      await new Promise(resolve => { setTimeout(resolve, 0) })
      try {
        await onProgress(512, { uploadId: 'checkpoint-1' })
      } catch (error) {
        progressAborted = true
        throw error
      }
    })
    const coordinator = new RecordingImportCoordinator(store, owner, async () => 42, () => 2_000)

    const running = coordinator.run(42, 'job-1')
    while (progress === undefined) await new Promise(resolve => { setTimeout(resolve, 0) })
    await expect(coordinator.cancel(42, 'job-1', 1)).resolves.toMatchObject({ phase: 'cancelled' })
    await expect(running).resolves.toMatchObject({ phase: 'cancelled' })
    expect(progressAborted).toBe(true)
    expect(owner.finishChild).not.toHaveBeenCalled()
    expect(owner.finishSession).not.toHaveBeenCalled()
  })
})
