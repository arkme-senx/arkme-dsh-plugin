import OSS from 'ali-oss'
import { RecordingImportContractError, type RecordingImportJob } from '../recording-import-contract.js'
import type { RecordingImportGateway } from '../recording-import-coordinator.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import { ArkmePluginError, objectValue, stringValue, type ServiceRuntime } from './service.js'

interface AudioOssClient {
  cancel(): void
  multipartUpload(
    objectPath: string,
    filePath: string,
    options: {
      parallel: number
      partSize: number
      checkpoint: Record<string, unknown> | undefined
      mime: string
      progress: (percentage: number, checkpoint?: Record<string, unknown>) => Promise<void>
    },
  ): Promise<unknown>
}

interface AudioOssCredentials {
  accessKeyId: string
  accessKeySecret: string
  stsToken: string
  expiration: string
}

interface RecoveredAudioSession {
  sessionId: string
  finished: boolean
}

const AUDIO_SESSION_RECOVERY_LIMIT = 500

type AudioOssClientFactory = (options: ConstructorParameters<typeof OSS>[0]) => AudioOssClient

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function remoteFileName(job: RecordingImportJob): string {
  const extension = job.fileName.trim().toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''
  return `arkme_${job.jobId}_0${extension}`
}

export class AudioRecordingImportGateway implements RecordingImportGateway {
  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly createOssClient: AudioOssClientFactory = options => new OSS(options) as unknown as AudioOssClient,
  ) {}

  async ensureSession(job: RecordingImportJob, signal?: AbortSignal): Promise<string> {
    const recovered = await this.recoverSession(job, signal)
    if (recovered !== undefined) return recovered.sessionId

    let session = await this.requireJobSession(job)
    const duplicate = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/check-exist-same-orig',
      { orig_names: [job.fileName] },
      session,
      signal,
    )
    if ((Array.isArray(duplicate.exist_names) ? duplicate.exist_names : [])
      .some(value => stringValue(value) === job.fileName)) {
      throw new RecordingImportContractError('recording-import-duplicate', '已存在同名录音，请更名后重试')
    }
    const timezoneOffsetMillis = -new Date(job.startAtMillis).getTimezoneOffset() * 60_000
    session = await this.requireJobSession(job)
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/new-session',
      {
        source: 2,
        operate_at: job.createdAtMillis,
        orig_name: job.fileName,
        tz_offset: timezoneOffsetMillis,
        start_at: job.startAtMillis,
      },
      session,
      signal,
    )
    return stringValue(data.session_id).trim()
  }

  async createChild(job: RecordingImportJob, signal?: AbortSignal): Promise<string> {
    if (job.sessionId === undefined) throw new ArkmePluginError('recording-import-session-missing', '录音导入缺少 Audio 会话', true)
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/new-child',
      {
        session_id: job.sessionId,
        start_at: 0,
        duration: job.durationMillis,
        file_name: remoteFileName(job),
        source_size: job.fileSize,
      },
      await this.requireJobSession(job),
      signal,
    )
    this.assertOwnerAccepted(data, 'recording-import-create-child-rejected', 'Audio 子任务创建失败')
    return stringValue(data.child_id).trim()
  }

  async upload(
    job: RecordingImportJob,
    onProgress: (uploadedBytes: number, checkpoint?: Record<string, unknown>) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<void> {
    if (job.sessionId === undefined) throw new ArkmePluginError('recording-import-session-missing', '录音导入缺少 Audio 会话', true)
    await this.requireJobSession(job)
    const credentials = await this.audioOssCredentials(job, signal)
    const client = this.createOssClient({
      region: 'oss-cn-hangzhou',
      bucket: this.runtime.config.environment === 'prod' ? 'jotmo-useraudio' : 'jotmo-useraudio-test',
      secure: true,
      accessKeyId: credentials.accessKeyId,
      accessKeySecret: credentials.accessKeySecret,
      stsToken: credentials.stsToken,
      refreshSTSTokenInterval: 5 * 60 * 1000,
      refreshSTSToken: async () => {
        await this.requireJobSession(job)
        const refreshed = await this.audioOssCredentials(job, signal)
        return {
          accessKeyId: refreshed.accessKeyId,
          accessKeySecret: refreshed.accessKeySecret,
          stsToken: refreshed.stsToken,
        }
      },
    })
    if (signal?.aborted === true) {
      try { client.cancel() } catch { /* cancellation remains authoritative */ }
      throw new RecordingImportContractError('recording-import-cancelled', '录音导入已取消')
    }
    let rejectAborted: ((reason: RecordingImportContractError) => void) | undefined
    const aborted = new Promise<never>((_resolve, reject) => { rejectAborted = reject })
    const abort = (): void => {
      try { client.cancel() } catch { /* cancellation remains authoritative */ }
      rejectAborted?.(new RecordingImportContractError('recording-import-cancelled', '录音导入已取消'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const objectPath = `pc_upload/${String(job.userId)}/${job.sessionId}/${remoteFileName(job)}`
      const upload = client.multipartUpload(objectPath, job.sourceHandle, {
        parallel: 1,
        partSize: 5 * 1024 * 1024,
        checkpoint: job.uploadCheckpoint,
        mime: job.mimeType,
        progress: async (percentage, checkpoint) => {
          if (signal?.aborted === true) throw new RecordingImportContractError('recording-import-cancelled', '录音导入已取消')
          const bounded = Math.min(1, Math.max(0, percentage))
          await onProgress(Math.round(job.fileSize * bounded), checkpoint)
        },
      })
      await (signal === undefined ? upload : Promise.race([upload, aborted]))
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }

  async finishChild(job: RecordingImportJob, signal?: AbortSignal): Promise<void> {
    if (job.childId === undefined) throw new ArkmePluginError('recording-import-child-missing', '录音导入缺少 Audio 子任务', true)
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/child-upload-finish',
      { child_id: job.childId, upload_at: Date.now() },
      await this.requireJobSession(job),
      signal,
    )
    this.assertOwnerAccepted(data, 'recording-import-finish-child-rejected', 'Audio 子任务完成确认失败')
  }

  async finishSession(job: RecordingImportJob, signal?: AbortSignal): Promise<void> {
    if (job.sessionId === undefined) throw new ArkmePluginError('recording-import-session-missing', '录音导入缺少 Audio 会话', true)
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/finish-session',
      { session_id: job.sessionId },
      await this.requireJobSession(job),
      signal,
    )
    this.assertOwnerAccepted(data, 'recording-import-finish-session-rejected', 'Audio 会话完成确认失败')
  }

  async deleteSession(job: RecordingImportJob): Promise<void> {
    const recovered = await this.recoverSession(job)
    if (recovered?.finished === true) {
      throw new ArkmePluginError(
        'recording-import-already-accepted',
        'Audio 已接受该录音，请重试任务以刷新状态，不能取消已落库录音',
        true,
        409,
      )
    }
    const sessionId = recovered?.sessionId ?? job.sessionId
    if (sessionId === undefined) return
    await this.runtime.authenticatedAudioPost(
      '/api/v1/audio/del-session',
      { session_id: sessionId },
      await this.requireJobSession(job),
      undefined,
      { lane: 'write', bypassCache: true },
    )
  }

  private async audioOssCredentials(job: RecordingImportJob, signal?: AbortSignal): Promise<AudioOssCredentials> {
    const raw = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/get-sts-token', {}, await this.requireJobSession(job), signal,
      { lane: 'interactive-read', bypassCache: true },
    )
    const credentials = {
      accessKeyId: stringValue(raw.access_key_id).trim(),
      accessKeySecret: stringValue(raw.access_key_secret).trim(),
      stsToken: stringValue(raw.security_token).trim(),
      expiration: stringValue(raw.expiration).trim(),
    }
    if (credentials.accessKeyId === '' || credentials.accessKeySecret === '' || credentials.stsToken === ''
      || credentials.expiration === '' || !Number.isFinite(Date.parse(credentials.expiration))
      || Date.parse(credentials.expiration) <= Date.now()) {
      throw new ArkmePluginError('recording-import-sts-invalid', '录音上传授权无效或已过期', true, 502)
    }
    return credentials
  }

  private async requireJobSession(job: RecordingImportJob): Promise<ArkmeSessionCredentials> {
    const session = await this.runtime.requireSession()
    if (session.userId !== job.userId || job.belongUserId !== job.userId) {
      throw new ArkmePluginError('recording-import-account-mismatch', '登录账号已变化，已停止录音导入', true, 403)
    }
    return session
  }

  private async recoverSession(job: RecordingImportJob, signal?: AbortSignal): Promise<RecoveredAudioSession | undefined> {
    const session = await this.requireJobSession(job)
    const matchesIdentity = (item: Record<string, unknown>): boolean => numberValue(item.source) === 2
        && numberValue(item.start_at) === job.startAtMillis
        && numberValue(item.belong_usr) === job.belongUserId
        && stringValue(item.orig_name) === job.fileName

    if (job.sessionId !== undefined) {
      const recovered = objectValue(await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
        '/api/v1/audio/get-session-by-id',
        { session_id: job.sessionId },
        session,
        signal,
      ))
      if (stringValue(recovered.id).trim() !== job.sessionId || !matchesIdentity(recovered)) {
        throw new RecordingImportContractError(
          'recording-import-session-conflict',
          'Audio 会话检查点与当前任务不一致，已停止操作',
        )
      }
      return { sessionId: job.sessionId, finished: recovered.has_finish_spk === true }
    }

    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/get-session-ls',
      {
        to_stamp: job.startAtMillis + 1,
        limit: AUDIO_SESSION_RECOVERY_LIMIT,
        offset: 0,
        query_new: false,
      },
      session,
      signal,
    )
    const candidates = (Array.isArray(data.session_ls) ? data.session_ls : []).map(objectValue)
    const reachedOlderSession = candidates.some(item => numberValue(item.start_at) < job.startAtMillis)
    if (candidates.length >= AUDIO_SESSION_RECOVERY_LIMIT && !reachedOlderSession) {
      throw new RecordingImportContractError(
        'recording-import-session-recovery-incomplete',
        'Audio 会话恢复范围过大，请稍后重试',
        true,
      )
    }
    const matches = candidates.filter(item => stringValue(item.id).trim() !== ''
      && numberValue(item.operate_at) === job.createdAtMillis
      && matchesIdentity(item))
    if (matches.length > 1) {
      throw new RecordingImportContractError(
        'recording-import-session-ambiguous',
        '检测到多个相同录音会话，已停止自动恢复',
      )
    }
    const recovered = matches[0]
    if (recovered === undefined) return undefined
    return { sessionId: stringValue(recovered.id).trim(), finished: recovered.has_finish_spk === true }
  }

  private assertOwnerAccepted(
    raw: Record<string, unknown>,
    code: string,
    message: string,
  ): void {
    const data = objectValue(raw)
    if (numberValue(data.err_flag) === 0) return
    throw new ArkmePluginError(code, message, false, 409)
  }
}
