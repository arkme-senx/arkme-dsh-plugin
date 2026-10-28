import { RecordingImportContractError } from '../recording-import-contract.js'

// Match Flutter's bounded exponential backoff, with up to 30% jitter.
export const RECORDING_UPLOAD_RETRY_DELAYS = [1_000, 2_000, 4_000, 8_000, 16_000] as const
export const RECORDING_UPLOAD_REQUEST_TIMEOUT = 5 * 60 * 1_000

const transientStatuses = new Set([408, 429, 500, 502, 503, 504])
const transientNames = new Set(['ResponseTimeoutError', 'ConnectionTimeoutError', 'SocketAssignTimeoutError'])
const transientCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND', 'ENETUNREACH', 'EHOSTUNREACH'])

export function isRetryableRecordingUploadError(error: unknown): boolean {
  if (error === null || typeof error !== 'object' || error instanceof RecordingImportContractError) return false
  const { status, name, code } = error as { status?: unknown; name?: unknown; code?: unknown }
  if (name === 'cancel' || name === 'abort' || name === 'AbortError') return false
  // An OSS application error (credentials, missing upload, etc.) must not be
  // mistaken for a transport failure merely because the SDK reports status -1.
  if (typeof status === 'number' && status >= 400) return transientStatuses.has(status)
  if (typeof code === 'string' && code !== '' && transientCodes.has(code)) return true
  // ali-oss 6.x replaces the original socket errno with the urllib error name.
  if ((status === -1 || status === -2) && code === name &&
      typeof name === 'string' && (transientNames.has(name) || name === 'RequestError' || name === 'ResponseError')) return true
  if (typeof code === 'string' && code !== '') return false
  return typeof name === 'string' && transientNames.has(name)
}

export function throwIfRecordingUploadAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw new RecordingImportContractError('recording-import-cancelled', '录音导入已取消')
}

export function waitForRecordingUploadRetry(delay: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(new RecordingImportContractError('recording-import-cancelled', '录音导入已取消'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, Math.round(delay * (1 + Math.random() * 0.3)))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted === true) abort()
  })
}
