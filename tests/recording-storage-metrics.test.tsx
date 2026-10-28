import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { projectRecordingDailyMetrics } from '../src/recording-daily-metrics.js'
import { readRecordingTotalsCache, emptyRecordingTotalsCache } from '../src/client/recordings/recording-total-scan.js'
import { RecordingDailyMetrics } from '../src/client/recordings/RecordingDailyMetrics.js'

// Asset accounting (legacy clips, packed speech, originals, midnight and
// uploader ownership) belongs to Audio's recording_storage_metrics_test.go.
// UI tests consume its semantic contract rather than copying that algorithm.
it('explains missing historical input while displaying the corrected recorded storage total', () => {
  const metrics = projectRecordingDailyMetrics({ bytes: 371110667, archive_bytes: 42818849, clip_bytes: 328291818, confirmed_count: 1, pending_count: 0, unknown_count: 0 }, [], { duration_ms: 0, confirmed_count: 0, pending_count: 0, unknown_count: 1, estimated_count: 0, missing_history_count: 1 })
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
