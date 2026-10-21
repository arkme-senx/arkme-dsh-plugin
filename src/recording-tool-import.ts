import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { recordingImportFileKind, type PublicRecordingImportJob, type RecordingFileImportInput } from './recording-import-contract.js'
import { isRecordingInstantOnOrAfterUnixEpoch } from './recording-time.js'
import type { FileTransfers } from './services/file-transfers.js'
import type { RecordingService } from './services/recording-service.js'
import { ArkmePluginError } from './services/service.js'
import { recordingToolMemberKey, type RecordingToolBatchMember, type RecordingToolBatchPlanner } from './recording-tool-batch.js'
import { recordingImportFileNameKey } from './recording-import-shared.js'
import { LocalRecordingImportSource } from './recording-import-probe.js'

/** Adapt an account-authorized file to the existing disposable recording source contract. */
export async function importStagedRecording(
  files: Pick<FileTransfers, 'readLocal'>,
  recording: Pick<RecordingService, 'recordingImportUserId' | 'acceptRecordingImport'>,
  temporaryDirectory: string,
  input: RecordingFileImportInput,
  signal?: AbortSignal,
  member?: RecordingToolBatchMember,
  expectedAccount?: number,
): Promise<PublicRecordingImportJob> {
  signal?.throwIfAborted()
  if (!Number.isSafeInteger(input.startAtMillis)
    || !isRecordingInstantOnOrAfterUnixEpoch(input.startAtMillis) || input.startAtMillis > Date.now()) {
    throw new ArkmePluginError('recording-import-start-invalid', '录音开始时间无效', false)
  }
  if (input.ownership !== 'self' && input.ownership !== 'other') {
    throw new ArkmePluginError('recording-import-owner-invalid', '录音数据归属无效', false)
  }
  const expectedUserId = await recording.recordingImportUserId()
  if (expectedAccount !== undefined && expectedUserId !== expectedAccount) throw new ArkmePluginError('recording-import-account-mismatch', '账号已切换，导入已停止', false, 409)
  const { path, file } = await files.readLocal(input.fileRef)
  const assertAccount = async () => {
    signal?.throwIfAborted()
    if (await recording.recordingImportUserId() !== expectedUserId) {
      throw new ArkmePluginError('recording-import-account-mismatch', '账号已切换，录音导入已停止', true, 409)
    }
    signal?.throwIfAborted()
  }
  await assertAccount()
  recordingImportFileKind({ fileName: file.fileName, mimeType: file.mimeType, fileSize: file.size, durationMillis: 1 })
  const temporaryPath = join(temporaryDirectory, `${randomUUID()}.upload`)
  let accepted = false
  try {
    await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 })
    const target = await open(temporaryPath, 'wx', 0o600)
    const hash = createHash('sha256')
    let copied = 0
    try {
      for await (const chunk of createReadStream(path, { signal })) {
        signal?.throwIfAborted()
        copied += chunk.length
        if (copied > file.size) throw new ArkmePluginError('recording-import-size-mismatch', '录音文件大小已变化，请重新添加', false)
        hash.update(chunk)
        await target.writeFile(chunk)
      }
    } finally { await target.close() }
    if (copied !== file.size) throw new ArkmePluginError('recording-import-size-mismatch', '录音文件不完整，请重新添加', false)
    await assertAccount()
    const job = await recording.acceptRecordingImport(temporaryPath, {
      fileName: file.fileName,
      mimeType: file.mimeType,
      fileSize: copied,
      sha256: hash.digest('hex'),
      startAtMillis: input.startAtMillis,
      belongUserId: input.ownership === 'self' ? expectedUserId : 0,
      recordingKind: 3,
      ...member,
    }, expectedUserId, signal)
    accepted = true
    return job
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error
      && typeof error.code === 'string' && /^(?:E[A-Z]+|ERR_)/.test(error.code)) {
      throw new ArkmePluginError('recording-import-local-file-failed', '本地录音文件读取失败，请重新添加或重试', true, 500)
    }
    throw error
  } finally {
    // Once admitted, only the coordinator may discard the copy; the original belongs to FileTransfers.
    if (!accepted) await unlink(temporaryPath).catch(() => undefined)
  }
}

export interface RecordingFileBatchResult {
  supported: boolean
  batchIds: string[]
  remaining: number
  items: Array<{ fileRef: string; job?: PublicRecordingImportJob; outcome?: 'matched_uploaded'; errorCode?: string }>
}

/** One explicit multi-file request is one frozen batch, never one batch per file. */
export async function importStagedRecordingBatch(
  files: Pick<FileTransfers, 'readLocal'>,
  recording: Pick<RecordingService, 'recordingImportUserId' | 'acceptRecordingImport' | 'recordingImportReceipt' | 'recordingDirectorySnapshot'>,
  temporaryDirectory: string, inputs: RecordingFileImportInput[], planner: RecordingToolBatchPlanner, signal?: AbortSignal,
): Promise<RecordingFileBatchResult> {
  if (!inputs.length || inputs.length > 10_000 || new Set(inputs.map(row => row.fileRef)).size !== inputs.length) {
    throw new ArkmePluginError('recording-import-input-invalid', '请选择一到一万个不重复的录音文件', false)
  }
  const userId = await recording.recordingImportUserId()
  const candidates: Array<{ key: string; isNew: boolean }> = []
  const locals: Array<Awaited<ReturnType<FileTransfers['readLocal']>>> = []
  for (const input of inputs) {
    signal?.throwIfAborted()
    if (!Number.isSafeInteger(input.startAtMillis) || !isRecordingInstantOnOrAfterUnixEpoch(input.startAtMillis)
      || input.startAtMillis > Date.now() || !['self', 'other'].includes(input.ownership)) {
      throw new ArkmePluginError('recording-import-input-invalid', '请提供真实录音开始时间和有效归属', false)
    }
    const local = await files.readLocal(input.fileRef), { file } = local
    locals.push(local)
    recordingImportFileKind({ fileName: file.fileName, mimeType: file.mimeType, fileSize: file.size, durationMillis: 1 })
    candidates.push({ key: recordingToolMemberKey(['staged', input.fileRef, file.fileName, file.size, input.startAtMillis, input.ownership]), isNew: true })
  }
  const snapshot = await recording.recordingDirectorySnapshot(inputs.map((row, i) => ({ fileName: locals[i]!.file.fileName,
    startAtMillis: row.startAtMillis })), userId, signal)
  const existing = new Map<number, RecordingFileBatchResult['items'][number]>()
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]!, { file, path } = locals[i]!, key = recordingImportFileNameKey(file.fileName)
    const local = snapshot.local.filter(row => recordingImportFileNameKey(row.identity.fileName) === key)
    const repeatedName = locals.some((other, j) => j !== i && recordingImportFileNameKey(other.file.fileName) === key)
    if (repeatedName) existing.set(i, { fileRef: input.fileRef, errorCode: 'recording-import-file-name-conflict' })
    else if (local.length) {
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(path, { signal })) hash.update(chunk)
      const sha256 = hash.digest('hex')
      const match = local.find(row => row.identity.fileName === file.fileName && row.identity.sha256 === sha256
        && row.identity.fileSize === file.size && row.identity.startAtMillis === input.startAtMillis
        && row.identity.belongUserId === (input.ownership === 'self' ? userId : 0))
      existing.set(i, match ? { fileRef: input.fileRef, job: match.task }
        : { fileRef: input.fileRef, errorCode: 'recording-import-file-name-conflict' })
    } else if (snapshot.existingFileNames.some(name => recordingImportFileNameKey(name) === key)) {
      const matches = snapshot.owner.filter(row => recordingImportFileNameKey(row.fileName) === key)
      const probe = await new LocalRecordingImportSource().inspect(path, { fileName: file.fileName, mimeType: file.mimeType, fileSize: file.size })
      const match = matches.length === 1 && matches[0]!.hasFinishedUpload && matches[0]!.fileSize === file.size
        && matches[0]!.startAtMillis === input.startAtMillis && matches[0]!.durationMillis === probe.durationMillis
        && matches[0]!.belongUserId === (input.ownership === 'self' ? userId : 0)
      existing.set(i, { fileRef: input.fileRef, ...(match ? { outcome: 'matched_uploaded' as const } : { errorCode: 'recording-import-file-name-conflict' }) })
    }
    if (existing.has(i)) candidates[i]!.isNew = false
  }
  const plan = await planner(userId, candidates, signal)
  const result: RecordingFileBatchResult = { supported: plan.supported,
    batchIds: [...new Set(Object.values(plan.members).map(member => member.batch.batchId))], remaining: inputs.length, items: [] }
  for (let i = 0; i < inputs.length; i++) {
    signal?.throwIfAborted()
    if (await recording.recordingImportUserId() !== userId) throw new ArkmePluginError('recording-import-account-mismatch', '账号已切换，导入已停止', false, 409)
    const input = inputs[i]!, member = plan.members[candidates[i]!.key]
    if (existing.has(i)) {
      result.items.push(existing.get(i)!)
      result.remaining--
      continue
    }
    try {
      const receipt = member ? await recording.recordingImportReceipt(member.clientTaskId, userId) : null
      const job = receipt ?? await importStagedRecording(files, recording, temporaryDirectory, input, signal, member, userId)
      result.items.push({ fileRef: input.fileRef, job })
    } catch (error) {
      if (signal?.aborted) throw error
      const code = error instanceof ArkmePluginError ? error.code : 'recording-import-file-failed'
      if (['recording-import-account-mismatch', 'login-required', 'login-expired', 'account-unavailable'].includes(code)) throw error
      result.items.push({ fileRef: input.fileRef, errorCode: code })
    }
    result.remaining--
  }
  result.batchIds = [...new Set([...result.batchIds, ...result.items.flatMap(item => item.job?.batch ? [item.job.batch.batchId] : [])])]
  return result
}
