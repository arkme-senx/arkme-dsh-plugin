import { expect, it } from 'vitest'
import { recordingDayIsEmpty } from '../src/client/recordings/recording-day-empty.js'
import type { ArkmeRecordingDay } from '../src/types.js'
import { projectRecordingDailyMetrics } from '../src/recording-daily-metrics.js'
const empty = (): ArkmeRecordingDay => ({
  dateStamp: 0, totalDurationMillis: 0, coverage: { state: 'ready', intervals: [] },
  transcript: { state: 'empty', items: [], message: '', totalDurationMillis: 0, processingCount: 0,
    dailyMetrics: projectRecordingDailyMetrics({ session_ls: [], child_ls: [] }, [], 1, 0, 86400000) },
  summary: { state: 'empty', items: [], message: '' }, timeline: { state: 'empty', items: [], message: '' },
})
it('only collapses a confirmed empty day', () => {
  expect(recordingDayIsEmpty(empty(), 0, [])).toBe(true)
  expect(recordingDayIsEmpty(undefined, 0, [])).toBe(false)
  expect(recordingDayIsEmpty(empty(), 1, [])).toBe(false)
  expect(recordingDayIsEmpty({ ...empty(), coverage: { state: 'partial', intervals: [] } }, 0, [])).toBe(false)
  expect(recordingDayIsEmpty({ ...empty(), coverage: { state: 'error', intervals: [] } }, 0, [])).toBe(false)
})
it('keeps silent, processing, local, and shared recordings accessible', () => {
  expect(recordingDayIsEmpty(empty(), 0, [{ startAtMillis: 0, endAtMillis: 1000, sourceLabel: '本机', status: 'recording' }])).toBe(false)
  for (const state of ['processing', 'failed', 'error', 'ready'] as const) {
    const day = empty(); day.transcript.state = state
    expect(recordingDayIsEmpty(day, 0, [])).toBe(false)
  }
  for (const field of ['archiveBytes', 'confirmedCount', 'pendingCount', 'unknownCount', 'asrInputDurationMillis', 'textCount'] as const) {
    const day = empty(); day.transcript.dailyMetrics![field] = 1
    expect(recordingDayIsEmpty(day, 0, [])).toBe(false)
  }
  const day = empty(); day.summary.state = 'ready';
  expect(recordingDayIsEmpty(day, 0, [])).toBe(false)
})
