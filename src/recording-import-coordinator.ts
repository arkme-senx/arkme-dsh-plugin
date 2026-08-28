import { unlink } from 'node:fs/promises'
import {
  RecordingImportContractError,
  advanceRecordingImportJob,
  type RecordingImportJob,
  type RecordingImportPhase,
} from './recording-import-contract.js'

export interface RecordingImportStore {
  getRecordingImportJob(userId: number, jobId: string): Promise<RecordingImportJob | undefined>
  replaceRecordingImportJob(userId: number, job: RecordingImportJob, expectedRevision: number): Promise<boolean>
}

export interface RecordingImportGateway {
  checkDuplicateName(fileName: string): Promise<boolean>
  createSession(job: RecordingImportJob): Promise<string>
  createChild(job: RecordingImportJob, remoteFileName: string): Promise<string>
  uploadObject(
    job: RecordingImportJob,
    objectPath: string,
    onProgress: (uploadedBytes: number, checkpoint?: Record<string, unknown>) => Promise<void>,
  ): Promise<void>
  finishChild(job: RecordingImportJob): Promise<void>
  finishSession(job: RecordingImportJob): Promise<void>
}

function errorDetail(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof RecordingImportContractError) {
    return { code: error.code, message: error.message, retryable: error.retryable }
  }
  if (error !== null && typeof error === 'object') {
    const source = error as { code?: unknown; message?: unknown; retryable?: unknown }
    if (typeof source.code === 'string' && typeof source.message === 'string') {
      return { code: source.code, message: source.message, retryable: source.retryable === true }
    }
  }
  return {
    code: 'recording-import-owner-failed',
    message: error instanceof Error && error.message.trim() !== '' ? error.message : '录音导入失败',
    retryable: true,
  }
}

function remoteFileName(job: RecordingImportJob): string {
  const extension = job.fileName.trim().toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''
  return `arkme_${job.jobId}_0${extension}`
}

export class RecordingImportCoordinator {
  constructor(
    private readonly store: RecordingImportStore,
    private readonly gateway: RecordingImportGateway,
    private readonly activeUserId: () => Promise<number>,
    private readonly nowMillis: () => number = Date.now,
  ) {}

  async run(userId: number, jobId: string): Promise<RecordingImportJob> {
    let job = await this.requiredJob(userId, jobId)
    try {
      if (job.phase === 'prepared') job = await this.prepareOwnerUpload(job)
      if (job.phase === 'uploading') job = await this.upload(job)
      if (job.phase === 'finalizing') job = await this.finalize(job)
      if (job.phase === 'processing') {
        const temporaryPath = job.temporaryPath
        job = await this.transition(job, 'accepted', {
          temporaryPath: '', sha256: '', sessionId: undefined, childId: undefined,
          childFinished: undefined, uploadCheckpoint: undefined,
        })
        await unlink(temporaryPath).catch(() => undefined)
      }
      return job
    } catch (error) {
      const current = await this.requiredJob(userId, jobId)
      if (current.phase === 'accepted' || current.phase === 'cancelled' || current.phase === 'failed') return current
      const detail = errorDetail(error)
      return await this.transition(current, 'failed', {
        failedFromPhase: current.phase,
        errorCode: detail.code,
        errorMessage: detail.message,
        retryable: detail.retryable,
      })
    }
  }

  async retry(userId: number, jobId: string, expectedRevision: number): Promise<RecordingImportJob> {
    const resumed = await this.resumeRetry(userId, jobId, expectedRevision)
    return await this.run(userId, resumed.jobId)
  }

  async resumeRetry(userId: number, jobId: string, expectedRevision: number): Promise<RecordingImportJob> {
    const failed = await this.requiredJob(userId, jobId)
    if (failed.revision !== expectedRevision) {
      throw new RecordingImportContractError('recording-import-revision-conflict', '任务状态已变化，请刷新后重试', true)
    }
    if (failed.phase !== 'failed' || failed.retryable !== true || failed.failedFromPhase === undefined) {
      throw new RecordingImportContractError('recording-import-retry-forbidden', '当前录音导入任务不可重试')
    }
    return await this.transition(failed, failed.failedFromPhase, {
      errorCode: undefined,
      errorMessage: undefined,
      retryable: undefined,
      failedFromPhase: undefined,
    })
  }

  async cancel(userId: number, jobId: string, expectedRevision: number): Promise<RecordingImportJob> {
    const job = await this.requiredJob(userId, jobId)
    if (job.revision !== expectedRevision) {
      throw new RecordingImportContractError('recording-import-revision-conflict', '任务状态已变化，请刷新后重试', true)
    }
    if (!['receiving', 'validating', 'prepared', 'uploading', 'failed'].includes(job.phase)) {
      throw new RecordingImportContractError('recording-import-cancel-forbidden', '当前阶段不能取消导入')
    }
    const temporaryPath = job.temporaryPath
    const cancelled = await this.transition(job, 'cancelled', {
      temporaryPath: '', sha256: '', sessionId: undefined, childId: undefined,
      childFinished: undefined, uploadCheckpoint: undefined,
    })
    await unlink(temporaryPath).catch(() => undefined)
    return cancelled
  }

  private async prepareOwnerUpload(initial: RecordingImportJob): Promise<RecordingImportJob> {
    let job = initial
    if (job.sessionId === undefined) {
      await this.assertActiveAccount(job.userId)
      if (await this.gateway.checkDuplicateName(job.fileName)) {
        throw new RecordingImportContractError('recording-import-duplicate', '已存在同名录音，请更名后重试')
      }
      await this.assertActiveAccount(job.userId)
      const sessionId = (await this.gateway.createSession(job)).trim()
      if (sessionId === '') throw new RecordingImportContractError('recording-import-session-invalid', 'Audio 会话创建响应无效', true)
      job = await this.checkpoint(job, { sessionId })
    }
    if (job.childId === undefined) {
      await this.assertActiveAccount(job.userId)
      const childId = (await this.gateway.createChild(job, remoteFileName(job))).trim()
      if (childId === '') throw new RecordingImportContractError('recording-import-child-invalid', 'Audio 子任务创建响应无效', true)
      job = await this.checkpoint(job, { childId })
    }
    return await this.transition(job, 'uploading')
  }

  private async upload(initial: RecordingImportJob): Promise<RecordingImportJob> {
    let job = initial
    await this.assertActiveAccount(job.userId)
    if (job.sessionId === undefined || job.childId === undefined) {
      throw new RecordingImportContractError('recording-import-checkpoint-missing', '录音导入缺少 owner 检查点', true)
    }
    const objectPath = `pc_upload/${String(job.userId)}/${job.sessionId}/${remoteFileName(job)}`
    await this.gateway.uploadObject(job, objectPath, async (uploadedBytes, uploadCheckpoint) => {
      await this.assertActiveAccount(job.userId)
      if (uploadedBytes >= job.fileSize) return
      const current = await this.requiredJob(job.userId, job.jobId)
      if (current.phase === 'cancelled') {
        throw new RecordingImportContractError('recording-import-cancelled', '录音导入已取消')
      }
      if (current.phase !== 'uploading') {
        throw new RecordingImportContractError('recording-import-runner-stale', '录音导入任务状态已变化', true)
      }
      job = await this.checkpoint(current, {
        uploadedBytes: Math.max(current.uploadedBytes, Math.min(current.fileSize, Math.trunc(uploadedBytes))),
        ...(uploadCheckpoint === undefined ? {} : { uploadCheckpoint }),
      })
    })
    job = await this.requiredJob(job.userId, job.jobId)
    return await this.transition(job, 'finalizing', { uploadedBytes: job.fileSize })
  }

  private async finalize(initial: RecordingImportJob): Promise<RecordingImportJob> {
    let job = initial
    if (job.childFinished !== true) {
      await this.assertActiveAccount(job.userId)
      await this.gateway.finishChild(job)
      job = await this.checkpoint(job, { childFinished: true })
    }
    await this.assertActiveAccount(job.userId)
    await this.gateway.finishSession(job)
    return await this.transition(job, 'processing')
  }

  private async assertActiveAccount(expectedUserId: number): Promise<void> {
    if (await this.activeUserId() !== expectedUserId) {
      throw new RecordingImportContractError('recording-import-account-mismatch', '登录账号已变化，已停止录音导入')
    }
  }

  private async requiredJob(userId: number, jobId: string): Promise<RecordingImportJob> {
    const job = await this.store.getRecordingImportJob(userId, jobId)
    if (job === undefined) throw new RecordingImportContractError('recording-import-not-found', '录音导入任务不存在')
    return job
  }

  private async checkpoint(
    job: RecordingImportJob,
    updates: Partial<RecordingImportJob>,
  ): Promise<RecordingImportJob> {
    const next = { ...job, ...updates, revision: job.revision + 1, updatedAtMillis: this.nowMillis() }
    if (!await this.store.replaceRecordingImportJob(job.userId, next, job.revision)) {
      throw new RecordingImportContractError('recording-import-revision-conflict', '任务状态已变化，请刷新后重试', true)
    }
    return next
  }

  private async transition(
    job: RecordingImportJob,
    phase: RecordingImportPhase,
    updates: Partial<RecordingImportJob> = {},
  ): Promise<RecordingImportJob> {
    const next = advanceRecordingImportJob(job, {
      expectedRevision: job.revision,
      phase,
      nowMillis: this.nowMillis(),
      ...updates,
    })
    if (!await this.store.replaceRecordingImportJob(job.userId, next, job.revision)) {
      throw new RecordingImportContractError('recording-import-revision-conflict', '任务状态已变化，请刷新后重试', true)
    }
    return next
  }
}
