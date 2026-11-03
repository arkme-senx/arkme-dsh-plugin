import { useEffect, useState } from 'react'
import { RECORDING_FILE_STORAGE_BATCH_LIMIT, type RecordingFileStorage, type RecordingFileStoragePage } from '../../recording-file-storage.js'
import { callArkme } from '../api.js'
import { arkmeIntlLocale, tr } from '../locale.js'
import { withArkmeReadDeadline } from '../read-deadline.js'
import type { RecordingFile } from './recording-day-files.js'

// Match the existing file list's 1024-based MB conversion. Keep small positive
// files visible instead of rounding them to a misleading zero.
export function recordingMegabytesLabel(bytes: number): string {
  return `${new Intl.NumberFormat(arkmeIntlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(bytes / 1024 / 1024)} MB`
}

export function useRecordingFileStorage(files: readonly RecordingFile[], active: boolean, refreshRevision: string) {
  const [observations, setObservations] = useState<Record<string, RecordingFileStorage>>({})
  const [error, setError] = useState(false)
  const [retryRevision, setRetryRevision] = useState(0)
  const signature = JSON.stringify(files.flatMap(file => 'sessionRef' in file ? [[file.sessionRef, file.status, file.updatedAtMillis]] : []))
  useEffect(() => {
    if (!active) return
    const refs = [...new Set((JSON.parse(signature) as string[][]).map(row => row[0]!))]
    const controller = new AbortController()
    setError(false)
    void (async () => {
      const received: Record<string, RecordingFileStorage> = {}
      let failed = false
      for (let offset = 0; offset < refs.length; offset += RECORDING_FILE_STORAGE_BATCH_LIMIT) {
        const batch = refs.slice(offset, offset + RECORDING_FILE_STORAGE_BATCH_LIMIT)
        try {
          const page = await withArkmeReadDeadline(signal => callArkme<RecordingFileStoragePage>('recordings.files.storage', { sessionRefs: batch }, signal), controller.signal)
          if (page.items.length !== batch.length || new Set(page.items.map(item => item.sessionRef)).size !== batch.length || page.items.some(item => !batch.includes(item.sessionRef) || !Number.isSafeInteger(item.bytes) || item.bytes < 0)) throw new Error('invalid storage response')
          if (controller.signal.aborted) return
          Object.assign(received, Object.fromEntries(page.items.map(item => [item.sessionRef, item])))
        } catch {
          if (controller.signal.aborted) return
          failed = true
        }
      }
      if (controller.signal.aborted) return
      setObservations(previous => ({ ...previous, ...received }))
      setError(failed)
    })()
    return () => controller.abort()
  }, [signature, active, refreshRevision, retryRevision])
  return { observations, error, retry: () => setRetryRevision(value => value + 1) }
}

export function RecordingFileStorageLabel({ value }: { value: RecordingFileStorage | undefined }) {
  if (!value) return null
  return <span tabIndex={0} title={tr('正式音频成功写入时记录的实际存储大小，包含播放包及增强补充音频；不包含原件、处理临时文件和算法对比产物。')}>{tr('云端 {size}', { size: recordingMegabytesLabel(value.bytes) })}</span>
}
