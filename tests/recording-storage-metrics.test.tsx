import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { projectRecordingStorageMetrics } from '../src/recording-storage-metrics.js'
import { projectRecordingDailyMetrics } from '../src/recording-daily-metrics.js'
import { projectRecordingTotalsBucket } from '../src/recording-total-projection.js'
import { readRecordingTotalsCache, emptyRecordingTotalsCache } from '../src/client/recordings/recording-total-scan.js'
import { RecordingDailyMetrics } from '../src/client/recordings/RecordingDailyMetrics.js'

const day = Date.parse('2026-09-08T00:00:00+08:00'), end = day + 86400000
const session = { id: 's', user_id: 42, belong_usr: 0, start_at: day, end_at: day + 60000 }
const child = { id: 'c', session_id: 's', start_at: 0, duration: 60000, has_asr: true,
  archive_size: 42818849, size: 328291818, source_size: 603859968,
  asr: [{ s: 0, e: 1000, t: '已完成转写' }], asr_input_metrics: { state: 'unavailable', duration_ms: null, spans: null } }
const data = (children = [child], sessions = [session]) => ({ session_ls: sessions, child_ls: children })

it('adds archived speech and playback bytes once, ignoring original size and speaker attribution', () => {
  const result = projectRecordingStorageMetrics(data([child, child]), 42, day, end)
  expect(result).toEqual({ bytes: 371110667, archiveBytes: 42818849, clipBytes: 328291818,
    confirmedCount: 1, pendingCount: 0, unknownCount: 0, state: 'ready' })
  expect(projectRecordingStorageMetrics(data([child], [{ ...session, user_id: 7, belong_usr: 42 }]), 42, day, end).bytes).toBe(0)
  expect(projectRecordingTotalsBucket(data(), 42, day, end).metrics.storage.bytes).toBe(371110667)
})

it('does not hide valid legacy playback clips when no speech archive exists', () => {
  expect(projectRecordingStorageMetrics(data([{ ...child, archive_size: 0 }]), 42, day, end))
    .toMatchObject({ bytes: 328291818, state: 'ready' })
  expect(projectRecordingStorageMetrics(data([{ ...child, archive_size: 0, size: 0 }]), 42, day, end))
    .toMatchObject({ state: 'unavailable', confirmedCount: 0 })
})

it('preserves known components but marks missing, unsafe and incomplete measurements', () => {
  const missing = { ...child, size: undefined }
  expect(projectRecordingStorageMetrics(data([missing as never]), 42, day, end))
    .toMatchObject({ bytes: 42818849, state: 'partial', unknownCount: 1 })
  expect(projectRecordingStorageMetrics(data([{ ...child, archive_size: Number.MAX_SAFE_INTEGER }]), 42, day, end).state).toBe('unavailable')
  expect(projectRecordingStorageMetrics(data([{ ...child, has_asr: false }]), 42, day, end))
    .toMatchObject({ state: 'processing', confirmedCount: 0 })
})

it('does not prorate cross-midnight files but includes each complete file once in all-time storage', () => {
  const response = data([{ ...child, start_at: end - 30000 }])
  expect(projectRecordingStorageMetrics(response, 42, day, end).state).toBe('unavailable')
  expect(projectRecordingStorageMetrics(response, 42, end, end + 86400000).state).toBe('unavailable')
  expect(projectRecordingTotalsBucket(response, 42, day, end).metrics.storage.bytes).toBe(371110667)
  expect(projectRecordingTotalsBucket(response, 42, end, end + 86400000).metrics.storage.bytes).toBe(0)
})

it('explains missing historical input while displaying the corrected recorded storage total', () => {
  const metrics = projectRecordingDailyMetrics(data(), [], 42, day, end)
  expect(metrics).toMatchObject({ asrInputMissingHistoryCount: 1, asrInputState: 'unavailable', asrInputDurationMillis: 0 })
  const html = renderToStaticMarkup(<RecordingDailyMetrics metrics={metrics} />)
  expect(html).toContain('云端录音存储 353.9 MiB（已记录）')
  expect(html).toContain('VAD 人声主档 40.8 MiB')
  expect(html).toContain('转写播放切片 313.1 MiB')
  expect(html).toContain('转写输入时长 历史计量缺失')
  expect(html).not.toContain('转写输入时长 0秒')
  expect(renderToStaticMarkup(<RecordingDailyMetrics metrics={metrics} loading />)).not.toContain('353.9')
})

it('invalidates old archive-only snapshots instead of relabelling them as full storage', () => {
  expect(readRecordingTotalsCache(JSON.stringify({ version: 1, entries: {}, snapshot: { phase: 'complete' } })))
    .toEqual(emptyRecordingTotalsCache())
})
