import {
  MAX_RECORDING_IMPORT_BYTES,
  MAX_RECORDING_IMPORT_DURATION_MILLIS,
  type PublicRecordingImportJob,
  type RecordingImportPhase,
} from './recording-import-shared.js'

export { MAX_RECORDING_IMPORT_BYTES, MAX_RECORDING_IMPORT_DURATION_MILLIS }
export type { PublicRecordingImportJob, RecordingImportPhase }

export type RecordingImportFileKind = 'wav' | 'mp3' | 'm4a'

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
  sourceHandle: string
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

export type RecordingImportAdmission =
  | { kind: 'inserted'; job: RecordingImportJob }
  | { kind: 'existing'; job: RecordingImportJob }
  | { kind: 'duplicate-file-name' }
  | { kind: 'limit' }

export interface RecordingImportSource {
  inspect(
    sourceHandle: string,
    metadata: { fileName: string; mimeType: string; fileSize: number },
  ): Promise<{ kind: RecordingImportFileKind; durationMillis: number }>
  discard(sourceHandle: string): Promise<void>
}

export function sameRecordingImportIdentity(
  left: Pick<RecordingImportJob, 'userId' | 'fileName' | 'fileSize' | 'sha256' | 'startAtMillis' | 'belongUserId'>,
  right: Pick<RecordingImportJob, 'userId' | 'fileName' | 'fileSize' | 'sha256' | 'startAtMillis' | 'belongUserId'>,
): boolean {
  return left.userId === right.userId
    && left.fileName === right.fileName
    && left.fileSize === right.fileSize
    && left.sha256 === right.sha256
    && left.startAtMillis === right.startAtMillis
    && left.belongUserId === right.belongUserId
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

export function toPublicRecordingImportJob(
  job: RecordingImportJob,
  importRef: string,
): PublicRecordingImportJob {
  const progress = job.fileSize <= 0 ? 0 : Math.min(1, Math.max(0, job.uploadedBytes / job.fileSize))
  return {
    importRef,
    revision: job.revision,
    phase: job.phase,
    ownership: job.belongUserId === job.userId ? 'self' : 'other',
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
