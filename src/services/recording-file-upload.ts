import { createHash } from 'node:crypto'
import { open, type FileHandle } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { RecordingImportContractError, type RecordingImportJob } from '../recording-import-contract.js'

// Host-only transport. Neither cloud SDK credentials nor signed URLs become
// Tool/SDK/UI results. Audio remains the sole upload identity and layout owner.
export type RecordingUploadPost = (path: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>
export type RecordingUploadProgress = (bytes: number, checkpoint?: Record<string, unknown>) => Promise<void>
interface UploadLayout { uploadId: string; size: number; partSize: number; partCount: number; uploadedParts: Set<number> }

function invalid(): never {
  throw new RecordingImportContractError('recording-import-upload-invalid', '录音上传响应无效，已停止上传', true)
}
function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw new RecordingImportContractError('recording-import-cancelled', '录音导入已取消')
}
function positive(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 }
function layout(raw: Record<string, unknown>, size: number): UploadLayout {
  if (raw.size !== size || typeof raw.upload_id !== 'string' || raw.upload_id.trim() === '' || raw.upload_id.length > 4096
    || !positive(raw.part_size) || raw.part_size < 5 * 1024 * 1024 || raw.part_size > 5_000_000_000
    || !positive(raw.part_count) || raw.part_count > 10_000 || raw.part_count !== Math.ceil(size / raw.part_size)
    || !Array.isArray(raw.uploaded_parts) || raw.uploaded_parts.length > raw.part_count) invalid()
  const uploadedParts = new Set<number>()
  for (const number of raw.uploaded_parts) {
    if (!positive(number) || number > raw.part_count || uploadedParts.has(number)) invalid()
    uploadedParts.add(number)
  }
  return { uploadId: raw.upload_id, size, partSize: raw.part_size, partCount: raw.part_count, uploadedParts }
}
function checkpoint(job: RecordingImportJob): { uploadId: string; partSize: number } | undefined {
  const raw = job.uploadCheckpoint
  // The retired OSS SDK checkpoint is discarded at this local persistence
  // edge. Existing completed objects are still detected by begin; no legacy
  // provider branch survives in the active transport.
  if (raw === undefined || !Object.hasOwn(raw, 'upload_id')) return undefined
  if (raw.child_id !== job.childId || raw.source_sha256 !== job.sha256 || raw.source_size !== job.fileSize
    || typeof raw.upload_id !== 'string' || raw.upload_id === '' || !positive(raw.part_size)) invalid()
  return { uploadId: raw.upload_id, partSize: raw.part_size }
}
function grant(raw: Record<string, unknown>, size: number, md5: string): { url: URL; headers: Headers } {
  let url: URL
  try { url = new URL(String(raw.url)) } catch { return invalid() }
  if (raw.method !== 'PUT' || url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== ''
    || typeof raw.expires_at !== 'string' || !Number.isFinite(Date.parse(raw.expires_at)) || Date.parse(raw.expires_at) <= Date.now()
    || raw.headers === null || typeof raw.headers !== 'object' || Array.isArray(raw.headers)) invalid()
  const entries = Object.entries(raw.headers)
  if (entries.length > 32) invalid()
  const headers = new Headers()
  for (const [name, value] of entries) {
    if (!/^[A-Za-z0-9-]{1,128}$/u.test(name) || typeof value !== 'string' || /[\r\n\0]/u.test(value)
      || ['authorization', 'cookie', 'proxy-authorization', 'transfer-encoding'].includes(name.toLowerCase())) invalid()
    headers.set(name, value)
  }
  if (headers.get('content-length') !== String(size) || headers.get('content-md5') !== md5
    || (headers.has('host') && headers.get('host') !== url.host)) invalid()
  return { url, headers }
}

async function* partBytes(file: FileHandle, offset: number, size: number, signal: AbortSignal): AsyncGenerator<Buffer> {
  for (let read = 0; read < size;) {
    cancelled(signal)
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, size - read))
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset + read)
    if (bytesRead === 0) throw new RecordingImportContractError('recording-import-source-changed', '录音源文件已变化，请重新导入')
    read += bytesRead
    yield buffer.subarray(0, bytesRead)
  }
}

async function hashPart(file: FileHandle, offset: number, size: number, whole: ReturnType<typeof createHash>, signal?: AbortSignal): Promise<string> {
  const part = createHash('md5')
  const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, size))
  for (let read = 0; read < size;) {
    cancelled(signal)
    const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, size - read), offset + read)
    if (bytesRead === 0) throw new RecordingImportContractError('recording-import-source-changed', '录音源文件已变化，请重新导入')
    const bytes = buffer.subarray(0, bytesRead)
    whole.update(bytes); part.update(bytes); read += bytesRead
  }
  return part.digest('base64')
}

export async function uploadRecordingFile(
  job: RecordingImportJob,
  post: RecordingUploadPost,
  onProgress: RecordingUploadProgress,
  assertAccount: () => Promise<unknown>,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  cancelled(signal)
  if (job.childId === undefined || !positive(job.fileSize) || !/^[a-f0-9]{64}$/u.test(job.sha256)) invalid()
  await assertAccount()
  const saved = checkpoint(job)
  let raw = saved === undefined
    ? await post('/api/v1/audio/uploads/begin', { child_id: job.childId })
    : await post('/api/v1/audio/uploads/resume', { child_id: job.childId, upload_id: saved.uploadId, part_size: saved.partSize })
  cancelled(signal)
  const restarting = raw.restart_required === true
  if (restarting) raw = await post('/api/v1/audio/uploads/begin', { child_id: job.childId })
  if (raw.uploaded === true) { await assertAccount(); cancelled(signal); await onProgress(job.fileSize); return }
  const upload = layout(raw, job.fileSize)
  if (saved !== undefined && !restarting && (upload.uploadId !== saved.uploadId || upload.partSize !== saved.partSize)) invalid()
  const persisted = { upload_id: upload.uploadId, part_size: upload.partSize, child_id: job.childId, source_sha256: job.sha256, source_size: job.fileSize }
  const request = { child_id: job.childId, upload_id: upload.uploadId, part_size: upload.partSize }
  // Persist the cloud handle before sending bytes, including an empty upload.
  // A crash after the final part therefore still resumes at completion.
  let uploadedBytes = 0
  for (const n of upload.uploadedParts) uploadedBytes += Math.min(upload.partSize, job.fileSize - (n - 1) * upload.partSize)
  await onProgress(Math.min(uploadedBytes, job.fileSize - 1), persisted)
  const file = await open(job.sourceHandle, 'r').catch(() => {
    throw new RecordingImportContractError('recording-import-source-unavailable', '录音源文件不可用，请重新导入')
  })
  try {
    const before = await file.stat()
    if (!before.isFile() || before.size !== job.fileSize) throw new RecordingImportContractError('recording-import-source-changed', '录音源文件已变化，请重新导入')
    const whole = createHash('sha256')
    for (let number = 1; number <= upload.partCount; number += 1) {
      cancelled(signal)
      const offset = (number - 1) * upload.partSize
      const size = Math.min(upload.partSize, job.fileSize - offset)
      const md5 = await hashPart(file, offset, size, whole, signal)
      if (upload.uploadedParts.has(number)) continue
      const signed = grant(await post('/api/v1/audio/uploads/sign-part', { ...request, part_number: number, content_md5: md5 }), size, md5)
      await assertAccount(); cancelled(signal)
      const partSignal = signal === undefined ? AbortSignal.timeout(5 * 60_000) : AbortSignal.any([signal, AbortSignal.timeout(5 * 60_000)])
      const stream = Readable.from(partBytes(file, offset, size, partSignal), { objectMode: false, highWaterMark: 64 * 1024, signal: partSignal })
      try {
        // Node fetch streams a bounded file range. No account credentials or
        // cookies are attached; redirects cannot forward this signed request.
        const options: RequestInit & { duplex: 'half' } = {
          method: 'PUT', headers: signed.headers, body: stream as unknown as BodyInit,
          duplex: 'half', redirect: 'error', credentials: 'omit', signal: partSignal,
        }
        const response = await fetchImpl(signed.url, options)
        await response.body?.cancel()
        if (!response.ok) throw new RecordingImportContractError('recording-import-part-failed', '录音分片上传失败，可从已上传位置重试', true)
      } catch (error) {
        cancelled(signal)
        if (error instanceof RecordingImportContractError) throw error
        // Fetch errors may include a signed URL. Never persist them in the job
        // error message which is visible through Tools, SDK and UI.
        throw new RecordingImportContractError('recording-import-part-failed', '录音分片上传中断，可继续重试', true)
      } finally { stream.destroy() }
      await assertAccount(); cancelled(signal)
      uploadedBytes += size
      await onProgress(Math.min(uploadedBytes, job.fileSize - 1), persisted)
    }
    const after = await file.stat()
    if (whole.digest('hex') !== job.sha256 || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
      throw new RecordingImportContractError('recording-import-source-changed', '录音源文件已变化，请重新导入')
    }
    const completed = await post('/api/v1/audio/uploads/complete', request)
    if (completed.restart_required === true) {
      // Keep the job retryable; the next resume starts a fresh upload after
      // the owner confirms expiry. Do not loop indefinitely in one run.
      throw new RecordingImportContractError('recording-import-upload-expired', '上传记录已过期，请重试', true)
    }
    if (completed.uploaded !== true) invalid()
    await assertAccount(); cancelled(signal)
    await onProgress(job.fileSize, persisted)
  } finally { await file.close() }
}

// Cancellation is distinct from a paused process. Release pending cloud parts
// before the existing owner deletion; a stopped process retains its checkpoint.
export async function abortRecordingFileUpload(job: RecordingImportJob, post: RecordingUploadPost): Promise<void> {
  const saved = checkpoint(job)
  if (saved === undefined || job.childId === undefined) return
  await post('/api/v1/audio/uploads/abort', { child_id: job.childId, upload_id: saved.uploadId })
}
