import OSS from 'ali-oss'
import {
  RecordingImportContractError,
  type RecordingImportJob,
  type RecordingImportOwnerProgress,
  type RecordingImportOwnerSession,
  type RecordingImportOwnerTaskSnapshot,
  type RecordingImportOwnerGateway,
  type RecordingDirectoryUploadedSession,
} from '../recording-import-contract.js'
import type {
  PublicRecordingImportProgress,
  PublicRecordingImportProgressRow,
  RecordingImportDisplayStatus,
  RecordingImportProgressCode,
  RecordingImportProgressStatus,
} from '../recording-import-shared.js'
import { recordingImportFileNameKey } from '../recording-import-shared.js'
import type { RecordingImportGateway } from '../recording-import-coordinator.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import {
  ArkmePluginError,
  objectValue,
  stringValue,
  type ArkmeRemoteRequestOptions,
  type ServiceRuntime,
} from './service.js'

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
  belongUserId: number | undefined
}

const AUDIO_SESSION_RECOVERY_LIMIT = 500
const AUDIO_IMPORT_DUPLICATE_BATCH_SIZE = 100
const AUDIO_IMPORT_PROGRESS_BATCH_SIZE = 100
const AUDIO_IMPORT_OWNER_PAGE_SIZE = 100
const AUDIO_DIRECTORY_IMPORT_SCAN_LIMIT = 10_000

const IMPORT_PROGRESS_CODES = new Set<RecordingImportProgressCode>([
  'upload',
  'import',
  'voice_recognition',
  'primary_transcript',
  'enhancement_transcript',
])

type AudioOssClientFactory = (options: ConstructorParameters<typeof OSS>[0]) => AudioOssClient

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function optionalIntegerValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

function nonNegativeIntegerValue(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0
}

function wireIntegerValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = Math.trunc(value)
    return Number.isSafeInteger(parsed) ? parsed : 0
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Math.trunc(Number(value))
    if (Number.isSafeInteger(parsed)) return parsed
  }
  return 0
}

function positiveOrZero(value: unknown): number {
  return Math.max(0, wireIntegerValue(value))
}

function importProgressStatus(value: unknown): RecordingImportProgressStatus {
  switch (wireIntegerValue(value)) {
    case 1: return 'pending'
    case 2: return 'processing'
    case 3: return 'completed'
    case 4: return 'partial'
    case 5: return 'failed'
    default: return 'unavailable'
  }
}

function importProgressRow(value: unknown): PublicRecordingImportProgressRow | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const code = stringValue(raw.code).trim() as RecordingImportProgressCode
  if (!IMPORT_PROGRESS_CODES.has(code)) return undefined
  return {
    code,
    status: importProgressStatus(raw.status),
    startedAtMillis: positiveOrZero(raw.started_at_ms),
    endedAtMillis: positiveOrZero(raw.ended_at_ms),
    durationMillis: positiveOrZero(raw.duration_ms),
    provider: stringValue(raw.provider).trim(),
    model: stringValue(raw.model).trim(),
    modelVersion: stringValue(raw.model_version).trim(),
    modelDurationMillis: positiveOrZero(raw.model_duration_ms),
    nextRelation: stringValue(raw.next_relation).trim(),
    relationDurationMillis: positiveOrZero(raw.relation_duration_ms),
  }
}

function importProgress(value: unknown, observedAtMillis: number): PublicRecordingImportProgress | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const rows = (Array.isArray(raw.row_ls) ? raw.row_ls : [])
    .map(importProgressRow)
    .filter((row): row is PublicRecordingImportProgressRow => row !== undefined)
  if (rows.length === 0) return undefined
  return {
    status: importProgressStatus(raw.status),
    totalDurationMillis: positiveOrZero(raw.total_duration_ms),
    serverNowMillis: positiveOrZero(raw.server_now_ms),
    observedAtMillis,
    rows,
  }
}

function ownerDisplayStatus(values: readonly number[]): RecordingImportOwnerProgress['displayStatus'] {
  const statuses = values.filter(value => Number.isSafeInteger(value) && value >= 1 && value <= 6)
  if (statuses.length === 0) return undefined
  const active = statuses.filter(value => value <= 4)
  if (active.length > 0) {
    switch (Math.min(...active)) {
      case 1: return 'speaker-waiting'
      case 2: return 'speaker-recognizing'
      case 3: return 'transcript-waiting'
      case 4: return 'transcribing'
    }
  }
  const completedCount = statuses.filter(value => value === 5).length
  const failedCount = statuses.filter(value => value === 6).length
  if (completedCount > 0 && failedCount > 0) return 'partial'
  if (failedCount > 0) return 'failed'
  if (completedCount > 0) return 'completed'
  return undefined
}

function ownerSession(value: unknown, viewerUserId: number): RecordingImportOwnerSession | undefined {
  const owner = objectValue(value)
  const sessionId = stringValue(owner.id).trim()
  const rawStartAtMillis = optionalIntegerValue(owner.start_at)
  if (optionalIntegerValue(owner.source) !== 2 || sessionId === ''
    || rawStartAtMillis === undefined || rawStartAtMillis < 0) return undefined
  const startAtMillis = rawStartAtMillis
  const durationMillis = optionalIntegerValue(owner.duration)
  const explicitEndAtMillis = owner.end_at === undefined ? 0 : optionalIntegerValue(owner.end_at)
  if (durationMillis === undefined || durationMillis < 0 || explicitEndAtMillis === undefined
    || explicitEndAtMillis < 0) return undefined
  const inferredEndAtMillis = startAtMillis + durationMillis
  if (!Number.isSafeInteger(inferredEndAtMillis)) return undefined
  return {
    sessionId,
    ownership: numberValue(owner.belong_usr) === viewerUserId ? 'self' : 'other',
    fileName: stringValue(owner.orig_name).trim(),
    fileSize: nonNegativeIntegerValue(owner.source_size),
    parsedSize: nonNegativeIntegerValue(owner.size),
    durationMillis,
    startAtMillis,
    endAtMillis: explicitEndAtMillis > startAtMillis ? explicitEndAtMillis : inferredEndAtMillis,
    createdAtMillis: nonNegativeIntegerValue(owner.create_at),
    updatedAtMillis: nonNegativeIntegerValue(owner.update_at),
    hasFinishedUpload: owner.has_finish_spk === true,
  }
}

function remoteFileName(job: RecordingImportJob): string {
  const extension = job.fileName.trim().toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''
  return `arkme_${job.jobId}_0${extension}`
}

export class AudioRecordingImportGateway implements RecordingImportGateway, RecordingImportOwnerGateway {
  constructor(
    private readonly runtime: ServiceRuntime,
    private readonly createOssClient: AudioOssClientFactory = options => new OSS(options) as unknown as AudioOssClient,
  ) {}

  async findExistingFileNames(input: {
    viewerUserId: number
    fileNames: readonly string[]
    signal?: AbortSignal
  }): Promise<string[]> {
    const existing: string[] = []
    for (let offset = 0; offset < input.fileNames.length; offset += AUDIO_IMPORT_DUPLICATE_BATCH_SIZE) {
      const batch = input.fileNames.slice(offset, offset + AUDIO_IMPORT_DUPLICATE_BATCH_SIZE)
      const requestedNames = new Set(batch.map(recordingImportFileNameKey))
      const data = await this.authenticatedOwnerPost<unknown>(
        input.viewerUserId,
        '/api/v1/audio/check-exist-same-orig',
        { orig_names: batch },
        input.signal,
      )
      const names = objectValue(data).exist_names
      if (!Array.isArray(names) || names.some(value => typeof value !== 'string'
        || value.trim() === '' || !requestedNames.has(recordingImportFileNameKey(value)))) {
        throw new RecordingImportContractError(
          'recording-import-duplicate-response-invalid', 'Audio 同名录音核对结果无效，请稍后重试', true,
        )
      }
      existing.push(...names.map(value => value.trim()))
    }
    return existing
  }

  async findDirectoryImportSessions(input: {
    viewerUserId: number
    fileNames: readonly string[]
    fromMillis: number
    toMillis: number
    signal?: AbortSignal
  }): Promise<RecordingDirectoryUploadedSession[]> {
    const names = new Set(input.fileNames.map(recordingImportFileNameKey).filter(Boolean))
    if (names.size === 0) return []
    const matches: RecordingDirectoryUploadedSession[] = []
    const seenSessionIds = new Set<string>()
    let offset = 0
    let previousStartAtMillis = input.toMillis
    while (offset < AUDIO_DIRECTORY_IMPORT_SCAN_LIMIT) {
      const data = await this.authenticatedOwnerPost<unknown>(
        input.viewerUserId,
        '/api/v1/audio/get-session-ls',
        { to_stamp: input.toMillis, limit: AUDIO_IMPORT_OWNER_PAGE_SIZE, offset, query_new: false },
        input.signal,
      )
      const rawSessions = objectValue(data).session_ls
      if (!Array.isArray(rawSessions) || rawSessions.length > AUDIO_IMPORT_OWNER_PAGE_SIZE) {
        throw new RecordingImportContractError(
          'recording-import-directory-response-invalid', 'Audio 录音核对列表无效，请稍后重试', true,
        )
      }
      let reachedOlderSession = false
      let newSessionCount = 0
      for (const raw of rawSessions) {
        const row = objectValue(raw)
        const sessionId = stringValue(row.id).trim()
        const startAtMillis = optionalIntegerValue(row.start_at)
        if (sessionId === '' || startAtMillis === undefined || startAtMillis < 0
          || startAtMillis >= input.toMillis || startAtMillis > previousStartAtMillis) {
          throw new RecordingImportContractError(
            'recording-import-directory-response-invalid', 'Audio 录音核对列表无效，请稍后重试', true,
          )
        }
        previousStartAtMillis = startAtMillis
        const alreadySeen = seenSessionIds.has(sessionId)
        seenSessionIds.add(sessionId)
        if (!alreadySeen) newSessionCount += 1
        // Audio's unscoped list is ordered by start_at descending with an exclusive to_stamp.
        if (startAtMillis < input.fromMillis) {
          reachedOlderSession = true
          continue
        }
        if (!names.has(recordingImportFileNameKey(stringValue(row.orig_name)))
          || optionalIntegerValue(row.source) !== 2) continue
        const session = ownerSession(row, input.viewerUserId)
        const belongUserId = optionalIntegerValue(row.belong_usr)
        if (session === undefined || belongUserId === undefined || belongUserId < 0) {
          throw new RecordingImportContractError(
            'recording-import-session-invalid', 'Audio 会话数据无效，无法完成目录录音核对', true,
          )
        }
        if (!alreadySeen) matches.push({
          sessionId: session.sessionId, fileName: session.fileName, fileSize: session.fileSize,
          startAtMillis: session.startAtMillis, durationMillis: session.durationMillis,
          belongUserId, hasFinishedUpload: session.hasFinishedUpload,
        })
      }
      if (rawSessions.length > 0 && newSessionCount === 0) {
        throw new RecordingImportContractError(
          'recording-import-directory-scan-stalled', 'Audio 录音核对分页未推进，请稍后重试', true,
        )
      }
      if (reachedOlderSession || rawSessions.length < AUDIO_IMPORT_OWNER_PAGE_SIZE) return matches
      offset += rawSessions.length
    }
    throw new RecordingImportContractError(
      'recording-import-directory-scan-limit', '录音核对范围过大，请缩小目录范围后重试', true,
    )
  }

  async listOwnerTasks(input: {
    viewerUserId: number
    scope: 'active' | 'completed'
    toMillis: number
    limit: number
    offset: number
    signal?: AbortSignal
  }): Promise<{ tasks: RecordingImportOwnerTaskSnapshot[]; total?: number; hasMore: boolean }> {
    const offset = Math.max(0, Math.trunc(input.offset))
    const limit = Math.max(0, Math.trunc(input.limit))
    if (limit === 0) return { tasks: [], hasMore: false }
    const scoped: RecordingImportOwnerTaskSnapshot[] = []
    const targetCount = offset + limit + 1
    let remoteOffset = 0
    let exhausted = false
    while (scoped.length < targetCount) {
      const data = await this.authenticatedOwnerPost<Record<string, unknown>>(
        input.viewerUserId,
        '/api/v1/audio/get-session-ls',
        {
          to_stamp: Math.trunc(input.toMillis),
          limit: AUDIO_IMPORT_OWNER_PAGE_SIZE,
          offset: remoteOffset,
          query_new: false,
          task_scope: input.scope,
        },
        input.signal,
      )
      const rawSessions = Array.isArray(data.session_ls) ? data.session_ls : []
      const ownerSessions = rawSessions
        .map(raw => ({ raw: objectValue(raw), session: ownerSession(raw, input.viewerUserId) }))
        .filter((owner): owner is { raw: Record<string, unknown>; session: RecordingImportOwnerSession } =>
          owner.session !== undefined)
      const ownerSnapshots = ownerSessions.map(({ raw, session: owner }) => {
        if (typeof raw.has_done_child !== 'boolean') {
          throw new RecordingImportContractError(
            'recording-import-owner-completion-unavailable',
            'Audio 暂未返回录音处理终态，请稍后重试',
            true,
          )
        }
        const processingCompleted = raw.has_done_child
        if ((input.scope === 'completed') !== processingCompleted) {
          throw new RecordingImportContractError(
            'recording-import-owner-scope-invalid',
            'Audio 返回的录音任务范围无效，请稍后重试',
            true,
          )
        }
        return { session: owner, processingCompleted }
      })
      const sealed = ownerSnapshots.filter(task => task.session.hasFinishedUpload)
      let progress = new Map<string, RecordingImportOwnerProgress>()
      if (sealed.length > 0) {
        try {
          progress = await this.loadOwnerProgressForSession(
            input.viewerUserId,
            sealed.map(task => task.session.sessionId),
            input.signal,
          )
        } catch (error) {
          if (input.signal?.aborted === true || this.isAccountMismatch(error)) throw error
          /* Processing details are optional enrichment; owner task scope remains authoritative. */
        }
      }
      for (const task of ownerSnapshots) {
        const ownerProgress = progress.get(task.session.sessionId)
        scoped.push({
          ...task,
          ...(ownerProgress === undefined ? {} : { progress: ownerProgress }),
        })
      }
      remoteOffset += rawSessions.length
      if (rawSessions.length < AUDIO_IMPORT_OWNER_PAGE_SIZE) {
        exhausted = true
        break
      }
    }
    return {
      tasks: scoped.slice(offset, offset + limit),
      ...(exhausted ? { total: scoped.length } : {}),
      hasMore: scoped.length > offset + limit || !exhausted,
    }
  }

  async loadOwnerSession(input: {
    viewerUserId: number
    sessionId: string
    signal?: AbortSignal
  }): Promise<RecordingImportOwnerSession> {
    const normalized = input.sessionId.trim()
    if (normalized === '') {
      throw new RecordingImportContractError('recording-import-session-invalid', 'Audio 会话引用无效')
    }
    const data = await this.authenticatedOwnerPost<Record<string, unknown>>(
      input.viewerUserId,
      '/api/v1/audio/get-session-by-id',
      { session_id: normalized },
      input.signal,
    )
    const owner = ownerSession(data, input.viewerUserId)
    if (owner === undefined || owner.sessionId !== normalized) {
      throw new RecordingImportContractError('recording-import-session-invalid', 'Audio 会话数据无效', true)
    }
    return owner
  }

  private async loadOwnerProgressForSession(
    viewerUserId: number,
    sessionIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<Map<string, RecordingImportOwnerProgress>> {
    const normalized = [...new Set(sessionIds.map(value => value.trim()).filter(value => value !== ''))]
    if (normalized.length === 0) return new Map()
    const result = new Map<string, RecordingImportOwnerProgress>()
    for (let offset = 0; offset < normalized.length; offset += AUDIO_IMPORT_PROGRESS_BATCH_SIZE) {
      const batch = normalized.slice(offset, offset + AUDIO_IMPORT_PROGRESS_BATCH_SIZE)
      const data = await this.authenticatedOwnerPost<Record<string, unknown>>(
        viewerUserId,
        '/api/v1/audio/get-session-deal-status',
        { session_ids: batch },
        signal,
      )
      const observedAtMillis = Date.now()
      for (const raw of Array.isArray(data.item_ls) ? data.item_ls : []) {
        const owner = objectValue(raw)
        const sessionId = stringValue(owner.session_id).trim()
        if (sessionId === '' || !batch.includes(sessionId)) continue
        const statusListAvailable = Array.isArray(owner.child_status_ls)
        const rawStatuses = statusListAvailable ? owner.child_status_ls as unknown[] : []
        const parsedStatuses = rawStatuses.map(child => wireIntegerValue(objectValue(child).status))
        const statusesValid = statusListAvailable && parsedStatuses.every(
          status => status >= 1 && status <= 6,
        )
        const displayStatus = statusesValid ? ownerDisplayStatus(parsedStatuses) : 'unavailable'
        const progress = importProgress(owner.import_progress, observedAtMillis)
        result.set(sessionId, {
          ...(displayStatus === undefined ? {} : { displayStatus }),
          ...(progress === undefined ? {} : { importProgress: progress }),
        })
      }
    }
    return result
  }

  async updateOwnerSessionStart(input: {
    viewerUserId: number
    sessionId: string
    startAtMillis: number
    signal?: AbortSignal
  }): Promise<void> {
    await this.authenticatedOwnerPost(
      input.viewerUserId,
      '/api/v1/audio/modify-session-start',
      {
        session_id: input.sessionId.trim(),
        start_at: Math.trunc(input.startAtMillis),
        tz_offset: -new Date(input.startAtMillis).getTimezoneOffset() * 60_000,
      },
      input.signal,
      { lane: 'write', bypassCache: true },
    )
  }

  async updateOwnerSessionOwnership(input: {
    viewerUserId: number
    sessionId: string
    belongUserId: number
    signal?: AbortSignal
  }): Promise<void> {
    if (input.belongUserId !== 0 && input.belongUserId !== input.viewerUserId) {
      throw new ArkmePluginError('recording-import-owner-invalid', '录音数据归属无效', false)
    }
    await this.authenticatedOwnerPost(
      input.viewerUserId,
      '/api/v1/audio/modify-session-belong-usr',
      { session_id: input.sessionId.trim(), belong_usr: input.belongUserId },
      input.signal,
      { lane: 'write', bypassCache: true },
    )
  }

  async deleteOwnerSession(input: {
    viewerUserId: number
    sessionId: string
    signal?: AbortSignal
  }): Promise<void> {
    await this.authenticatedOwnerPost(
      input.viewerUserId,
      '/api/v1/audio/del-session',
      { session_id: input.sessionId.trim() },
      input.signal,
      { lane: 'write', bypassCache: true },
    )
  }

  async ensureSession(job: RecordingImportJob, signal?: AbortSignal): Promise<string> {
    const recovered = await this.recoverSession(job, signal)
    if (recovered !== undefined) return recovered.sessionId

    const existingNames = await this.findExistingFileNames({
      viewerUserId: job.userId, fileNames: [job.fileName], ...(signal === undefined ? {} : { signal }),
    })
    if (existingNames.length > 0) {
      throw new RecordingImportContractError('recording-import-duplicate', '已存在同名录音，请更名后重试')
    }
    const timezoneOffsetMillis = -new Date(job.startAtMillis).getTimezoneOffset() * 60_000
    const session = await this.requireJobSession(job)
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
    const sessionId = stringValue(data.session_id).trim()
    if (sessionId !== '') {
      await this.ensureSessionOwnership(job, {
        sessionId,
        finished: false,
        belongUserId: job.userId,
      }, session, signal)
    }
    return sessionId
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
    const recovered = await this.recoverSession(job, undefined, false)
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
    return await this.requireViewerSession(job.userId)
  }

  private async requireViewerSession(viewerUserId: number): Promise<ArkmeSessionCredentials> {
    const session = await this.runtime.requireSession()
    if (session.userId !== viewerUserId) {
      throw new ArkmePluginError('recording-import-account-mismatch', '登录账号已变化，已停止录音导入', true, 403)
    }
    return session
  }

  private async authenticatedOwnerPost<T>(
    viewerUserId: number,
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
    options: ArkmeRemoteRequestOptions = {},
  ): Promise<T> {
    return await this.runtime.authenticatedAudioPost<T>(
      path,
      body,
      await this.requireViewerSession(viewerUserId),
      signal,
      options,
    )
  }

  private isAccountMismatch(error: unknown): boolean {
    return error instanceof ArkmePluginError && error.code === 'recording-import-account-mismatch'
  }

  private async recoverSession(
    job: RecordingImportJob,
    signal?: AbortSignal,
    normalizeOwnership = true,
  ): Promise<RecoveredAudioSession | undefined> {
    const session = await this.requireJobSession(job)
    const matchesIdentity = (item: Record<string, unknown>): boolean => numberValue(item.source) === 2
        && numberValue(item.start_at) === job.startAtMillis
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
      const result = {
        sessionId: job.sessionId,
        finished: recovered.has_finish_spk === true,
        belongUserId: optionalIntegerValue(recovered.belong_usr),
      }
      if (normalizeOwnership) await this.ensureSessionOwnership(job, result, session, signal)
      return result
    }

    const data = await this.runtime.authenticatedAudioPost<unknown>(
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
    const rawSessions = objectValue(data).session_ls
    if (!Array.isArray(rawSessions) || rawSessions.length > AUDIO_SESSION_RECOVERY_LIMIT) {
      throw new RecordingImportContractError(
        'recording-import-session-recovery-invalid', 'Audio 会话恢复列表无效，请稍后重试', true,
      )
    }
    const candidates = rawSessions.map(objectValue)
    if (candidates.some(item => stringValue(item.id).trim() === ''
      || optionalIntegerValue(item.start_at) === undefined || numberValue(item.start_at) < 0
      || numberValue(item.start_at) > job.startAtMillis)) {
      throw new RecordingImportContractError(
        'recording-import-session-recovery-invalid', 'Audio 会话恢复列表无效，请稍后重试', true,
      )
    }
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
    const result = {
      sessionId: stringValue(recovered.id).trim(),
      finished: recovered.has_finish_spk === true,
      belongUserId: optionalIntegerValue(recovered.belong_usr),
    }
    if (normalizeOwnership) await this.ensureSessionOwnership(job, result, session, signal)
    return result
  }

  private async ensureSessionOwnership(
    job: RecordingImportJob,
    recovered: RecoveredAudioSession,
    session: ArkmeSessionCredentials,
    signal?: AbortSignal,
  ): Promise<void> {
    if (recovered.belongUserId === job.belongUserId) return
    if (job.belongUserId !== 0 || recovered.belongUserId !== job.userId) {
      throw new RecordingImportContractError(
        'recording-import-session-ownership-conflict',
        'Audio 会话归属与当前任务不一致，已停止操作',
      )
    }
    await this.runtime.authenticatedAudioPost(
      '/api/v1/audio/modify-session-belong-usr',
      { session_id: recovered.sessionId, belong_usr: 0 },
      session,
      signal,
    )
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
