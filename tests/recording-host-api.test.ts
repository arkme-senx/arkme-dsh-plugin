import { describe, expect, it, vi } from 'vitest'
import type { ArkmeService } from '../src/arkme-service.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'

describe('recording UI-only host operations', () => {
  it('dispatches calendar, day, and explicit Doubao backfill operations', async () => {
    const recordingCalendar = vi.fn(async () => ({ fromStamp: 10, toStamp: 20, days: [] }))
    const recordingDay = vi.fn(async () => ({ dateStamp: 10, totalDurationMillis: 0 }))
    const startRecordingDoubaoBackfill = vi.fn(async () => ({
      queuedChildCount: 1, inFlightChildCount: 0, missingAudioChildCount: 0,
    }))
    const service = {
      recordingCalendar, recordingDay, startRecordingDoubaoBackfill,
    } as unknown as ArkmeService

    await expect(dispatchArkmeHostOperation(service, 'recordings.calendar', {
      fromStamp: 10,
      toStamp: 20,
    })).resolves.toMatchObject({ fromStamp: 10, toStamp: 20 })
    await expect(dispatchArkmeHostOperation(service, 'recordings.day', { dateStamp: 10 }))
      .resolves.toMatchObject({ dateStamp: 10 })
    await expect(dispatchArkmeHostOperation(service, 'recordings.doubao.start', { dateStamp: 10 }))
      .resolves.toMatchObject({ queuedChildCount: 1 })

    expect(recordingCalendar).toHaveBeenCalledWith(10, 20)
    expect(recordingDay).toHaveBeenCalledWith(10)
    expect(startRecordingDoubaoBackfill).toHaveBeenCalledWith(10)
  })
})
