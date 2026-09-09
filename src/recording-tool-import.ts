import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { recordingImportFileKind, type PublicRecordingImportJob, type RecordingFileImportInput } from './recording-import-contract.js'
import { isRecordingInstantOnOrAfterUnixEpoch } from './recording-time.js'
import type { FileTransfers } from './services/file-transfers.js'
import type { RecordingService } from './services/recording-service.js'
import { ArkmePluginError } from './services/service.js'

/** Adapt an account-authorized file to the existing disposable recording source contract. */
export async function importStagedRecording(
  files: Pick<FileTransfers, 'readLocal'>,
  recording: Pick<RecordingService, 'recordingImportUserId' | 'acceptRecordingImport'>,
  temporaryDirectory: string,
  input: RecordingFileImportInput,
  signal?: AbortSignal,
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
