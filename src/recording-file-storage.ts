/** Formal retained audio only: uploaded originals, computation inputs and
 * independent algorithm comparisons are outside this contract. */
export interface RecordingFileStorage {
  sessionRef: string
  bytes: number
  checkedAtMillis: number
}

export interface RecordingFileStoragePage { items: RecordingFileStorage[] }
export const RECORDING_FILE_STORAGE_BATCH_LIMIT = 20

export function recordingStorageSessionRefs(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > RECORDING_FILE_STORAGE_BATCH_LIMIT
    || value.some(ref => typeof ref !== 'string' || ref.trim() === '' || ref.length > 4096)
    || new Set(value).size !== value.length) throw new Error('录音存储查询参数无效')
  return value as string[]
}
