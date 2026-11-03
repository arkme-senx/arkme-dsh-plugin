import { describe, expect, it, vi } from 'vitest'
import { RecordingService } from '../src/services/recording-service.js'
import type { ArkmeRecordingDayPart } from '../src/types.js'

describe('independent recording day reads', () => {
  it.each(['transcript', 'coverage', 'metrics', 'summary', 'timeline'] as const)('requests only %s instead of waiting for unrelated parts', async part => {
    const section = { state: 'empty', items: [], message: '' }
    const transcript = { ...section, totalDurationMillis: 123, dateStamp: 1 }
    const calls = {
      transcript: vi.fn(async () => transcript), projection: vi.fn(async () => section),
      coverage: vi.fn(async () => ({ state: 'ready', intervals: [] })), metrics: vi.fn(async () => ({ textCount: 0 })),
    }
    const owner = {
      validateRecordingWindow: vi.fn(), recordingDayStart: () => new Date(2026, 10, 3),
      runtime: { requireSession: async () => ({ userId: 42 }) }, ensureRecordingSession: vi.fn(),
      recordingTranscriptPageWithSession: calls.transcript, recordingProjectionWithSession: calls.projection,
      readOwner: { physicalCoverage: calls.coverage, dayMetrics: calls.metrics },
    }
    const result = await RecordingService.prototype.recordingDayPart.call(owner as never, 1, part)
    const expected = part === 'summary' || part === 'timeline' ? 'projection' : part
    for (const [key, call] of Object.entries(calls)) expect(call).toHaveBeenCalledTimes(key === expected ? 1 : 0)
    expect(Object.keys(result).filter(key => key !== 'dateStamp' && key !== 'totalDurationMillis')).toEqual([part])
  })

  it('rejects an unknown part rather than falling back to a whole-day scan', async () => {
    const owner = { validateRecordingWindow() {}, recordingDayStart: () => new Date(2026, 10, 3), runtime: { requireSession: async () => ({ userId: 42 }) } }
    await expect(RecordingService.prototype.recordingDayPart.call(owner as never, 1, 'unknown' as ArkmeRecordingDayPart)).rejects.toMatchObject({ code: 'recording-day-part-invalid' })
  })
})
