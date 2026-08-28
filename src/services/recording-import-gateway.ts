import OSS from 'ali-oss'
import type { RecordingImportJob } from '../recording-import-contract.js'
import type { RecordingImportGateway } from '../recording-import-coordinator.js'
import { ArkmePluginError, objectValue, stringValue, type ServiceRuntime } from './service.js'

interface AudioOssClient {
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

type AudioOssClientFactory = (options: ConstructorParameters<typeof OSS>[0]) => AudioOssClient

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export class AudioRecordingImportGateway implements RecordingImportGateway {
  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly createOssClient: AudioOssClientFactory = options => new OSS(options) as unknown as AudioOssClient,
  ) {}

  async checkDuplicateName(fileName: string): Promise<boolean> {
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/check-exist-same-orig',
      { orig_names: [fileName] },
      await this.runtime.requireSession(),
    )
    return (Array.isArray(data.exist_names) ? data.exist_names : [])
      .some(value => stringValue(value) === fileName)
  }

  async createSession(job: RecordingImportJob): Promise<string> {
    const timezoneOffsetMillis = -new Date(job.startAtMillis).getTimezoneOffset() * 60_000
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/new-session',
      {
        source: 2,
        operate_at: job.createdAtMillis,
        orig_name: job.fileName,
        tz_offset: timezoneOffsetMillis,
        start_at: job.startAtMillis,
        belong_usr: job.belongUserId,
      },
      await this.runtime.requireSession(),
    )
    return stringValue(data.session_id).trim()
  }

  async createChild(job: RecordingImportJob, remoteFileName: string): Promise<string> {
    if (job.sessionId === undefined) throw new ArkmePluginError('recording-import-session-missing', '录音导入缺少 Audio 会话', true)
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/new-child',
      {
        session_id: job.sessionId,
        start_at: 0,
        duration: job.durationMillis,
        file_name: remoteFileName,
        source_size: job.fileSize,
      },
      await this.runtime.requireSession(),
    )
    this.assertOwnerAccepted(data, 'recording-import-create-child-rejected', 'Audio 子任务创建失败')
    return stringValue(data.child_id).trim()
  }

  async uploadObject(
    job: RecordingImportJob,
    objectPath: string,
    onProgress: (uploadedBytes: number, checkpoint?: Record<string, unknown>) => Promise<void>,
  ): Promise<void> {
    const session = await this.runtime.requireSession()
    const credentials = await this.audioOssCredentials()
    const client = this.createOssClient({
      region: 'oss-cn-hangzhou',
      bucket: this.runtime.config.environment === 'prod' ? 'jotmo-useraudio' : 'jotmo-useraudio-test',
      secure: true,
      accessKeyId: credentials.accessKeyId,
      accessKeySecret: credentials.accessKeySecret,
      stsToken: credentials.stsToken,
      refreshSTSTokenInterval: 5 * 60 * 1000,
      refreshSTSToken: async () => {
        const current = await this.runtime.requireSession()
        if (current.userId !== session.userId) {
          throw new ArkmePluginError('recording-import-account-mismatch', '登录账号已变化，已停止录音导入', false, 403)
        }
        const refreshed = await this.audioOssCredentials()
        return {
          accessKeyId: refreshed.accessKeyId,
          accessKeySecret: refreshed.accessKeySecret,
          stsToken: refreshed.stsToken,
        }
      },
    })
    await client.multipartUpload(objectPath, job.temporaryPath, {
      parallel: 1,
      partSize: 5 * 1024 * 1024,
      checkpoint: job.uploadCheckpoint,
      mime: job.mimeType,
      progress: async (percentage, checkpoint) => {
        const bounded = Math.min(1, Math.max(0, percentage))
        await onProgress(Math.round(job.fileSize * bounded), checkpoint)
      },
    })
  }

  async finishChild(job: RecordingImportJob): Promise<void> {
    if (job.childId === undefined) throw new ArkmePluginError('recording-import-child-missing', '录音导入缺少 Audio 子任务', true)
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/child-upload-finish',
      { child_id: job.childId, upload_at: Date.now() },
      await this.runtime.requireSession(),
    )
    this.assertOwnerAccepted(data, 'recording-import-finish-child-rejected', 'Audio 子任务完成确认失败')
  }

  async finishSession(job: RecordingImportJob): Promise<void> {
    if (job.sessionId === undefined) throw new ArkmePluginError('recording-import-session-missing', '录音导入缺少 Audio 会话', true)
    const data = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/finish-session',
      { session_id: job.sessionId },
      await this.runtime.requireSession(),
    )
    this.assertOwnerAccepted(data, 'recording-import-finish-session-rejected', 'Audio 会话完成确认失败')
  }

  private async audioOssCredentials(): Promise<AudioOssCredentials> {
    const raw = await this.runtime.authenticatedAudioPost<Record<string, unknown>>(
      '/api/v1/audio/get-sts-token', {}, await this.runtime.requireSession(), undefined,
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
