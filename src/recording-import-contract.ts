import { createCipheriv, createDecipheriv, createHash, createHmac } from 'node:crypto'

export const MAX_RECORDING_IMPORT_BYTES = 1024 * 1024 * 1024
export const MAX_RECORDING_IMPORT_DURATION_MILLIS = 10 * 60 * 60 * 1000

export type RecordingImportFileKind = 'wav' | 'mp3' | 'm4a'

export type RecordingImportPhase =
  | 'prepared'
  | 'uploading'
  | 'finalizing'
  | 'accepted'
  | 'failed'
  | 'cancelled'

export interface RecordingImportJob {
  jobId: string
  userId: number
  revision: number
  phase: RecordingImportPhase
  fileName: string
  mimeType: string
  fileSize: number
  durationMillis: number
  sha256: string
  startAtMillis: number
  belongUserId: number
  temporaryPath: string
  uploadedBytes: number
  createdAtMillis: number
  updatedAtMillis: number
  sessionId?: string | undefined
  childId?: string | undefined
  childFinished?: boolean | undefined
  errorCode?: string | undefined
  errorMessage?: string | undefined
  retryable?: boolean | undefined
  failedFromPhase?: Exclude<RecordingImportPhase, 'failed' | 'cancelled' | 'accepted'> | undefined
  uploadCheckpoint?: Record<string, unknown> | undefined
}

export function sameRecordingImportIdentity(
  left: Pick<RecordingImportJob, 'userId' | 'fileName' | 'fileSize' | 'sha256' | 'startAtMillis'>,
  right: Pick<RecordingImportJob, 'userId' | 'fileName' | 'fileSize' | 'sha256' | 'startAtMillis'>,
): boolean {
  return left.userId === right.userId
    && left.fileName === right.fileName
    && left.fileSize === right.fileSize
    && left.sha256 === right.sha256
    && left.startAtMillis === right.startAtMillis
}

export interface PublicRecordingImportJob {
  importRef: string
  revision: number
  phase: RecordingImportPhase
  fileName: string
  fileSize: number
  durationMillis: number
  progress: number
  createdAtMillis: number
  updatedAtMillis: number
  errorCode?: string
  errorMessage?: string
  retryable?: boolean
}

export class RecordingImportContractError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message)
    this.name = 'RecordingImportContractError'
  }
}

const MIME_BY_KIND: Readonly<Record<RecordingImportFileKind, ReadonlySet<string>>> = {
  wav: new Set(['audio/wav', 'audio/x-wav']),
  mp3: new Set(['audio/mpeg', 'audio/mp3']),
  m4a: new Set(['audio/mp4', 'audio/x-m4a', 'audio/m4a']),
}

const GENERIC_RECORDING_MIME_TYPES = new Set(['', 'application/octet-stream'])

const NEXT_PHASES: Readonly<Record<RecordingImportPhase, ReadonlySet<RecordingImportPhase>>> = {
  prepared: new Set(['uploading', 'failed', 'cancelled']),
  uploading: new Set(['finalizing', 'failed', 'cancelled']),
  finalizing: new Set(['accepted', 'failed', 'cancelled']),
  accepted: new Set(),
  failed: new Set(['prepared', 'uploading', 'finalizing', 'cancelled']),
  cancelled: new Set(),
}

export function recordingImportFileKind(input: {
  fileName: string
  mimeType: string
  fileSize: number
  durationMillis: number
}): RecordingImportFileKind {
  if (!Number.isSafeInteger(input.fileSize) || input.fileSize <= 0) {
    throw new RecordingImportContractError('recording-import-size-invalid', '录音文件大小无效')
  }
  if (input.fileSize > MAX_RECORDING_IMPORT_BYTES) {
    throw new RecordingImportContractError('recording-import-size-exceeded', '录音文件不能超过 1 GiB')
  }
  if (!Number.isFinite(input.durationMillis) || input.durationMillis <= 0) {
    throw new RecordingImportContractError('recording-import-duration-invalid', '录音时长无效')
  }
  if (input.durationMillis > MAX_RECORDING_IMPORT_DURATION_MILLIS) {
    throw new RecordingImportContractError('recording-import-duration-exceeded', '录音时长不能超过 10 小时')
  }

  const extension = input.fileName.trim().toLowerCase().match(/\.([^.]+)$/)?.[1]
  if (extension !== 'wav' && extension !== 'mp3' && extension !== 'm4a') {
    throw new RecordingImportContractError('recording-import-format-unsupported', '仅支持 WAV、MP3 和 M4A 录音')
  }
  const mimeType = input.mimeType.trim().toLowerCase()
  if (!GENERIC_RECORDING_MIME_TYPES.has(mimeType) && !MIME_BY_KIND[extension].has(mimeType)) {
    throw new RecordingImportContractError('recording-import-format-mismatch', '录音格式与文件内容不一致')
  }
  return extension
}

export function recordingImportCanonicalMimeType(kind: RecordingImportFileKind): string {
  switch (kind) {
    case 'wav': return 'audio/wav'
    case 'mp3': return 'audio/mpeg'
    case 'm4a': return 'audio/mp4'
  }
}

export function advanceRecordingImportJob(
  current: RecordingImportJob,
  input: {
    expectedRevision: number
    phase: RecordingImportPhase
    nowMillis: number
  } & Partial<Pick<RecordingImportJob,
    'uploadedBytes' | 'sessionId' | 'childId' | 'childFinished' | 'errorCode' | 'errorMessage' | 'retryable'>>,
): RecordingImportJob {
  if (current.revision !== input.expectedRevision) {
    throw new RecordingImportContractError('recording-import-revision-conflict', '任务状态已变化，请刷新后重试', true)
  }
  if (!NEXT_PHASES[current.phase].has(input.phase)) {
    throw new RecordingImportContractError(
      'recording-import-phase-invalid',
      `不允许从 ${current.phase} 进入 ${input.phase}`,
    )
  }
  const { expectedRevision: _expectedRevision, nowMillis, ...updates } = input
  return {
    ...current,
    ...updates,
    revision: current.revision + 1,
    updatedAtMillis: nowMillis,
  }
}

interface RecordingImportRefPayload {
  jobId: string
  userId: number
}

function recordingImportRefKey(signingKey: string): Buffer {
  return createHash('sha256').update(signingKey).update('\0arkme-recording-import-v1').digest()
}

export function sealRecordingImportRef(payload: RecordingImportRefPayload, signingKey: string): string {
  const encoded = JSON.stringify(payload)
  const key = recordingImportRefKey(signingKey)
  const iv = createHmac('sha256', key).update(encoded).digest().subarray(0, 12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(encoded, 'utf8'), cipher.final()])
  return `arkme-recording-import-v1.${iv.toString('base64url')}.${encrypted.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`
}

export function openRecordingImportRef(
  importRef: string,
  currentUserId: number,
  signingKey: string,
): RecordingImportRefPayload {
  try {
    const parts = importRef.split('.')
    if (parts.length !== 4 || parts[0] !== 'arkme-recording-import-v1') throw new Error('invalid shape')
    const decipher = createDecipheriv(
      'aes-256-gcm', recordingImportRefKey(signingKey), Buffer.from(parts[1] ?? '', 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(parts[3] ?? '', 'base64url'))
    const encoded = Buffer.concat([
      decipher.update(Buffer.from(parts[2] ?? '', 'base64url')),
      decipher.final(),
    ]).toString('utf8')
    const payload = JSON.parse(encoded) as Partial<RecordingImportRefPayload>
    if (typeof payload.jobId !== 'string' || !Number.isSafeInteger(payload.userId) || payload.userId! <= 0) {
      throw new Error('invalid payload')
    }
    if (payload.userId !== currentUserId) {
      throw new RecordingImportContractError('recording-import-account-mismatch', '录音导入任务不属于当前账号')
    }
    return { jobId: payload.jobId, userId: payload.userId }
  } catch (error) {
    if (error instanceof RecordingImportContractError) throw error
    throw new RecordingImportContractError('recording-import-ref-invalid', '录音导入任务引用无效')
  }
}

export function toPublicRecordingImportJob(
  job: RecordingImportJob,
  importRef: string,
): PublicRecordingImportJob {
  const progress = job.fileSize <= 0 ? 0 : Math.min(1, Math.max(0, job.uploadedBytes / job.fileSize))
  return {
    importRef,
    revision: job.revision,
    phase: job.phase,
    fileName: job.fileName,
    fileSize: job.fileSize,
    durationMillis: job.durationMillis,
    progress,
    createdAtMillis: job.createdAtMillis,
    updatedAtMillis: job.updatedAtMillis,
    ...(job.errorCode === undefined ? {} : { errorCode: job.errorCode }),
    ...(job.errorMessage === undefined ? {} : { errorMessage: job.errorMessage }),
    ...(job.retryable === undefined ? {} : { retryable: job.retryable }),
  }
}
