import { MAX_RECORDING_IMPORT_BYTES, RecordingImportContractError, sameRecordingImportIdentity,
  type RecordingImportIdentity, type RecordingDirectoryCandidate, type RecordingDirectorySnapshot,
  type RecordingDirectorySource, type RecordingDirectoryEntry, type RecordingDirectorySelection,
  type PublicRecordingImportJob } from './recording-import-contract.js'
import { recordingImportFileNameKey } from './recording-import-shared.js'

export interface RecordingDirectoryInput {
  directoryPath: string
  recursive: boolean
  ownership: 'self' | 'other'
  startTimes?: Array<{ relativePath: string; startAtMillis: number }>
}
interface PreparedRecordingDirectoryEntry extends RecordingDirectoryEntry {
  startAtMillis: number | undefined
}
export interface PreparedRecordingDirectory {
  expectedUserId: number
  scan: Omit<RecordingDirectorySelection, 'files'> & { files: PreparedRecordingDirectoryEntry[] }
  preview: RecordingDirectoryPreviewItem[]
}
export type RecordingDirectoryOutcome = 'uploaded' | 'matched_uploaded' | 'in_progress' | 'failed' | 'cancelled' | 'conflict' | 'time_required' | 'invalid'
export interface RecordingDirectoryItem {
  relativePath: string
  outcome: RecordingDirectoryOutcome
  importRef?: string
  revision?: number
  errorCode?: string
  message?: string
}
export type RecordingDirectoryPreviewItem = Omit<RecordingDirectoryItem, 'outcome'> & {
  outcome: 'pending_upload' | 'pending_resume' | 'matched_uploaded' | 'conflict' | 'time_required' | 'invalid'
}
export interface RecordingDirectoryResult {
  total: number
  skipped: number
  remaining: number
  counts: Record<RecordingDirectoryOutcome, number>
  items: RecordingDirectoryItem[]
  stopped?: 'cancelled' | 'account_changed' | 'authentication_required' | 'account_unavailable' | 'capacity' | 'owner_unavailable'
}
interface DirectoryRecordingOwner {
  recordingImportUserId(): Promise<number>
  recordingDirectorySnapshot(candidates: readonly RecordingDirectoryCandidate[], expectedUserId: number, signal?: AbortSignal): Promise<RecordingDirectorySnapshot>
  acceptRecordingImport(sourceHandle: string, metadata: Omit<RecordingImportIdentity, 'userId'> & { mimeType: string }, expectedUserId: number, signal?: AbortSignal): Promise<PublicRecordingImportJob>
  retryRecordingImport(importRef: string, expectedRevision: number, signal?: AbortSignal): Promise<PublicRecordingImportJob>
  waitRecordingImport(importRef: string, signal?: AbortSignal): Promise<PublicRecordingImportJob>
}

/** A filename instant is a recording fact; filesystem timestamps are only freshness guards. */
export function recordingDirectoryStartTime(fileName: string): number | undefined {
  const match = /(?:^|\D)(20\d{2})(\d{2})(\d{2})[_\-. ]?(\d{2})(\d{2})(\d{2})(?:\D|$)/.exec(fileName)
  if (match === null) return undefined
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [number, number, number, number, number, number]
  const date = new Date(year, month - 1, day, hour, minute, second)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day
    || date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second) return undefined
  for (const delta of [-86_400_000, 86_400_000]) {
    const offset = new Date(date.getTime() + delta).getTimezoneOffset()
    if (offset === date.getTimezoneOffset()) continue
    const alternative = new Date(date.getTime() + (offset - date.getTimezoneOffset()) * 60_000)
    if (alternative.getFullYear() === year && alternative.getMonth() === month - 1 && alternative.getDate() === day
      && alternative.getHours() === hour && alternative.getMinutes() === minute && alternative.getSeconds() === second) return undefined
  }
  return date.getTime()
}
function validStart(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= Date.now()
}
function validateInput(input: RecordingDirectoryInput): Map<string, number> {
  if (typeof input.directoryPath !== 'string' || input.directoryPath.trim() === ''
    || typeof input.recursive !== 'boolean' || !['self', 'other'].includes(input.ownership)) {
    throw new RecordingImportContractError('recording-directory-input-invalid', '请提供录音目录、递归范围和录音归属')
  }
  const times = new Map<string, number>()
  for (const row of input.startTimes ?? []) {
    if (typeof row.relativePath !== 'string' || row.relativePath === '' || times.has(row.relativePath) || !validStart(row.startAtMillis)) {
      throw new RecordingImportContractError('recording-directory-time-invalid', '逐文件录音时间必须有效且不能重复')
    }
    times.set(row.relativePath, row.startAtMillis)
  }
  return times
}
async function assertAccount(owner: Pick<DirectoryRecordingOwner, 'recordingImportUserId'>, expectedUserId: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  if (await owner.recordingImportUserId() !== expectedUserId) {
    throw new RecordingImportContractError('recording-import-account-mismatch', '账号已切换，请重新发起目录导入')
  }
  signal?.throwIfAborted()
}
export async function prepareRecordingDirectory(
  owner: Pick<DirectoryRecordingOwner, 'recordingImportUserId' | 'recordingDirectorySnapshot'>, source: RecordingDirectorySource, input: RecordingDirectoryInput, signal?: AbortSignal,
): Promise<PreparedRecordingDirectory> {
  const times = validateInput(input)
  const expectedUserId = await owner.recordingImportUserId()
  const scan = await source.scan(input.directoryPath, input.recursive, signal)
  if ([...times.keys()].some(path => !scan.files.some(file => file.relativePath === path))) {
    throw new RecordingImportContractError('recording-directory-time-target-invalid', '指定录音时间的文件不在本次目录扫描中')
  }
  await assertAccount(owner, expectedUserId, signal)
  const candidates = scan.files.map(file => ({ ...file, startAtMillis: times.get(file.relativePath) ?? recordingDirectoryStartTime(file.fileName) }))
  const snapshot = await owner.recordingDirectorySnapshot(candidates.filter(file => validStart(file.startAtMillis))
    .map(file => ({ fileName: file.fileName, startAtMillis: file.startAtMillis! })), expectedUserId, signal)
  const names = nameCounts(scan)
  const preview: RecordingDirectoryPreviewItem[] = []
  for (const file of candidates) {
    try {
      await assertAccount(owner, expectedUserId, signal)
      preview.push(await previewFile(source, file, file.startAtMillis, input.ownership === 'self' ? expectedUserId : 0, snapshot, names, signal))
    } catch (error) {
      if (signal?.aborted || accountStopReason(errorCode(error)) !== undefined) throw error
      preview.push({ relativePath: file.relativePath, outcome: 'invalid', errorCode: errorCode(error) })
    }
  }
  await assertAccount(owner, expectedUserId, signal)
  return { expectedUserId, scan: { ...scan, files: candidates }, preview }
}
function nameCounts(scan: RecordingDirectorySelection): Map<string, number> {
  const counts = new Map<string, number>()
  for (const file of scan.files) {
    const key = recordingImportFileNameKey(file.fileName)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function matchesUploadedRecording(
  snapshot: RecordingDirectorySnapshot,
  file: Pick<PublicRecordingImportJob, 'fileName' | 'fileSize' | 'startAtMillis' | 'durationMillis'> & { belongUserId: number },
): boolean {
  const key = recordingImportFileNameKey(file.fileName)
  const matches = snapshot.owner.filter(value => recordingImportFileNameKey(value.fileName) === key)
  return snapshot.existingFileNames.some(name => recordingImportFileNameKey(name) === key)
    && matches.length === 1 && matches[0]!.hasFinishedUpload
    && matches[0]!.startAtMillis === file.startAtMillis && matches[0]!.fileSize === file.fileSize
    && matches[0]!.durationMillis === file.durationMillis && matches[0]!.belongUserId === file.belongUserId
    && file.startAtMillis + file.durationMillis <= Date.now()
}

async function previewFile(
  source: RecordingDirectorySource, file: RecordingDirectoryEntry, startAtMillis: number | undefined,
  belongUserId: number, snapshot: RecordingDirectorySnapshot, names: Map<string, number>, signal?: AbortSignal,
): Promise<RecordingDirectoryPreviewItem> {
  const item = { relativePath: file.relativePath }
  const key = recordingImportFileNameKey(file.fileName)
  if (names.get(key)! > 1) return { ...item, outcome: 'conflict' }
  if (!validStart(startAtMillis)) return { ...item, outcome: 'time_required' }
  if (!Number.isSafeInteger(file.fileSize) || file.fileSize <= 0 || file.fileSize > MAX_RECORDING_IMPORT_BYTES) {
    return { ...item, outcome: 'invalid', errorCode: 'recording-import-size-invalid' }
  }
  if (snapshot.local.some(value => recordingImportFileNameKey(value.identity.fileName) === key)) return { ...item, outcome: 'pending_resume' }
  if (!snapshot.existingFileNames.some(name => recordingImportFileNameKey(name) === key)) return { ...item, outcome: 'pending_upload' }
  const matches = snapshot.owner.filter(value => recordingImportFileNameKey(value.fileName) === key)
  if (matches.length !== 1 || !matches[0]!.hasFinishedUpload || matches[0]!.startAtMillis !== startAtMillis
    || matches[0]!.fileSize !== file.fileSize || matches[0]!.belongUserId !== belongUserId) return { ...item, outcome: 'conflict' }
  const probe = await source.probe(file, signal)
  return { ...item, outcome: matchesUploadedRecording(snapshot, {
    ...file, startAtMillis, durationMillis: probe.durationMillis, belongUserId,
  }) ? 'matched_uploaded' : 'conflict' }
}

function errorCode(error: unknown): string {
  return error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code : 'recording-directory-file-failed'
}
function accountStopReason(code: string | undefined): RecordingDirectoryResult['stopped'] {
  if (code === 'recording-import-account-mismatch') return 'account_changed'
  if (code === 'login-required' || code === 'login-expired') return 'authentication_required'
  if (code === 'account-unavailable') return 'account_unavailable'
  return undefined
}

export async function importRecordingDirectory(
  owner: DirectoryRecordingOwner, source: RecordingDirectorySource, input: RecordingDirectoryInput,
  prepared: PreparedRecordingDirectory, signal?: AbortSignal,
): Promise<RecordingDirectoryResult> {
  validateInput(input)
  await assertAccount(owner, prepared.expectedUserId, signal)
  const { scan } = prepared
  const belongUserId = input.ownership === 'self' ? prepared.expectedUserId : 0
  const result: RecordingDirectoryResult = {
    total: scan.files.length, skipped: scan.skipped, remaining: scan.files.length,
    counts: { uploaded: 0, matched_uploaded: 0, in_progress: 0, failed: 0, cancelled: 0, conflict: 0, time_required: 0, invalid: 0 }, items: [],
  }
  const namedCount = nameCounts(scan)
  const approved = new Map(prepared.preview.map(item => [item.relativePath, item]))
  for (const file of scan.files) {
    let sourceHandle: string | undefined
    let admitted: PublicRecordingImportJob | undefined
    let item: RecordingDirectoryItem = { relativePath: file.relativePath, outcome: 'invalid' }
    try {
      await assertAccount(owner, prepared.expectedUserId, signal)
      const key = recordingImportFileNameKey(file.fileName)
      const planned = approved.get(file.relativePath)
      if (planned === undefined) throw new RecordingImportContractError('recording-directory-plan-invalid', '文件不在已确认清单内')
      if (planned.outcome !== 'pending_upload' && planned.outcome !== 'pending_resume') {
        item = { ...planned, outcome: planned.outcome }
      } else if (namedCount.get(key)! > 1) {
        item = { ...item, outcome: 'conflict', message: '目录内有同名录音，请先区分文件名' }
      } else if (!validStart(file.startAtMillis)) {
        item = { ...item, outcome: 'time_required', message: '无法从文件名确定录音时间，请提供该文件的真实开始时间' }
      } else {
        let beforeCopy: RecordingDirectorySnapshot
        try {
          beforeCopy = await owner.recordingDirectorySnapshot(
            [{ fileName: file.fileName, startAtMillis: file.startAtMillis }], prepared.expectedUserId, signal,
          )
        } catch (error) {
          if (signal?.aborted || accountStopReason(errorCode(error)) !== undefined) throw error
          result.stopped = 'owner_unavailable'
          break
        }
        const current = await previewFile(source, file, file.startAtMillis, belongUserId, beforeCopy, namedCount, signal)
        await assertAccount(owner, prepared.expectedUserId, signal)
        if (current.outcome !== 'pending_upload' && current.outcome !== 'pending_resume') {
          item = { ...current, outcome: current.outcome }
        } else {
          const copied = await source.stage(file, signal)
          sourceHandle = copied.sourceHandle
          const metadata = { fileName: file.fileName, fileSize: file.fileSize, mimeType: copied.mimeType, sha256: copied.sha256,
            startAtMillis: file.startAtMillis, belongUserId }
          await assertAccount(owner, prepared.expectedUserId, signal)
          let snapshot: RecordingDirectorySnapshot
          try {
            snapshot = await owner.recordingDirectorySnapshot(
              [{ fileName: file.fileName, startAtMillis: file.startAtMillis }], prepared.expectedUserId, signal,
            )
          } catch (error) {
            if (signal?.aborted || accountStopReason(errorCode(error)) !== undefined) throw error
            result.stopped = 'owner_unavailable'
            break
          }
          const existingNames = new Set(snapshot.existingFileNames.map(recordingImportFileNameKey))
          const local = snapshot.local.filter(value => recordingImportFileNameKey(value.identity.fileName) === key)
          const exact = local.find(value => sameRecordingImportIdentity(value.identity, { ...metadata, userId: prepared.expectedUserId }))
          if (local.length > 0) {
            if (exact === undefined) item = { ...item, outcome: 'conflict', message: '同名本地任务与该录音不一致' }
            else if (exact.task.phase === 'failed' && exact.task.retryable) {
              admitted = await owner.retryRecordingImport(exact.task.importRef, exact.task.revision, signal)
            } else if (exact.task.phase === 'failed') {
              item = { ...item, outcome: 'failed', importRef: exact.task.importRef, revision: exact.task.revision }
            } else admitted = exact.task
          } else if (existingNames.has(key)) {
            const probe = await source.inspect(sourceHandle, metadata)
            await assertAccount(owner, prepared.expectedUserId, signal)
            if (file.startAtMillis + probe.durationMillis > Date.now()) {
              throw new RecordingImportContractError('recording-import-end-invalid', '录音结束时间不能晚于当前时间')
            }
            const uploaded = matchesUploadedRecording(snapshot, {
              ...metadata, durationMillis: probe.durationMillis,
            })
            item = { ...item, outcome: uploaded ? 'matched_uploaded' : 'conflict',
              message: uploaded ? '已有元数据匹配且上传已收尾的录音' : '已有同名录音，但无法确认与该文件匹配且上传完成' }
          } else {
            admitted = await owner.acceptRecordingImport(sourceHandle, metadata, prepared.expectedUserId, signal)
            sourceHandle = undefined // The existing coordinator owns the admitted copy.
          }
          if (admitted !== undefined) {
            item = { ...item, outcome: 'in_progress', importRef: admitted.importRef, revision: admitted.revision }
            const completed = await owner.waitRecordingImport(admitted.importRef, signal)
            item = { ...item, outcome: completed.phase === 'accepted' ? 'uploaded'
              : completed.phase === 'failed' ? 'failed' : completed.phase === 'cancelled' ? 'cancelled' : 'in_progress', revision: completed.revision }
            const stopped = accountStopReason(completed.errorCode)
            if (completed.phase === 'failed' && stopped !== undefined) result.stopped = stopped
            if (completed.phase === 'failed' && completed.errorCode === 'recording-import-duplicate' && completed.retryable === false) {
              try {
                const latest = await owner.recordingDirectorySnapshot(
                  [{ fileName: file.fileName, startAtMillis: file.startAtMillis }], prepared.expectedUserId, signal,
                )
                await assertAccount(owner, prepared.expectedUserId, signal)
                const hasPending = latest.local.some(value => recordingImportFileNameKey(value.identity.fileName) === key)
                item = { relativePath: file.relativePath,
                  outcome: !hasPending && matchesUploadedRecording(latest, { ...completed, belongUserId }) ? 'matched_uploaded' : 'conflict' }
              } catch (error) {
                result.stopped = signal?.aborted ? 'cancelled' : accountStopReason(errorCode(error)) ?? 'owner_unavailable'
              }
            }
          }
        }
      }
    } catch (error) {
      const code = errorCode(error)
      const accountStopped = accountStopReason(code)
      if (signal?.aborted || accountStopped !== undefined) {
        result.stopped = signal?.aborted ? 'cancelled' : accountStopped!
        if (admitted === undefined) break
        item = { ...item, outcome: 'in_progress', importRef: admitted.importRef, revision: admitted.revision }
      } else if (code === 'recording-import-pending-limit') {
        result.stopped = 'capacity'
        break
      } else item = { ...item, outcome: admitted === undefined ? 'invalid' : 'in_progress',
        ...(admitted === undefined ? {} : { importRef: admitted.importRef, revision: admitted.revision }),
        errorCode: code, message: '该文件处理失败，可检查文件或原任务后重试目录导入' }
    } finally {
      if (sourceHandle !== undefined) await source.discard(sourceHandle).catch(() => undefined)
    }
    result.items.push(item)
    result.counts[item.outcome] += 1
    result.remaining -= 1
    if (result.stopped !== undefined) break
  }
  return result
}
