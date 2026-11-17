import { expect, it, vi } from 'vitest'
import { recordingZonedWindow } from '../src/recording-time.js'
import { RecordingService, type RecordingServiceDependencies } from '../src/services/recording-service.js'
import type { ServiceRuntime } from '../src/services/service.js'

it('rechecks an owned day threshold and deduplicates a cross-day recording before any write', async () => {
  const timeZone = 'Asia/Shanghai'
  const dates = ['2026-10-14', '2026-10-15']
  const date = recordingZonedWindow(dates[0]!, timeZone)
  const id = '100000000000000000000001'
  const otherId = '100000000000000000000002'
  const startAt = date.endStamp - 30_000
  const endAt = date.endStamp + 30_000
  const aboveBytes = 419430400
  let dayBytes = aboveBytes
  const post = vi.fn(async (path: string, body: Record<string, unknown>) => {
    const fact = { status: 'available', start_at: startAt, end_at: endAt, owner_version: 7, capture_state: 'complete' }
    if (path.endsWith('/recordings/query')) return { items: [
      { ...fact, recording_uid: id, uploader_user_id: 42 },
      { ...fact, recording_uid: otherId, uploader_user_id: 43, memory_owner_user_id: 42 },
    ], has_more: false }
    if (path.endsWith('/transcript/query')) {
      expect(body.recording_uid).toBe(id)
      return { status: 'available', recording_uid: id, revision: 'a'.repeat(64), start_at: startAt,
        coverage: { ready_count: 1, processing_count: 0, failed_count: 0, silent_count: 0, candidate_count: 0 },
        speakers: [], utterances: [], has_more: false,
        storage: { bytes: dayBytes, archive_bytes: dayBytes, clip_bytes: 0, confirmed_count: 1, pending_count: 0, unknown_count: 0 } }
    }
    if (path.endsWith('/files/storage')) {
      expect(body.session_ids).toEqual([id])
      return { items: [{ session_id: id, bytes: 900_000_000, checked_at: Date.now() }] }
    }
    if (path.endsWith('/get-session-by-id')) return { id, user_id: 42, has_finish_spk: true, start_at: startAt, orig_name: '跨日.WAV' }
    throw new Error(`Unexpected recording request ${path}`)
  })
  const runtime = {
    config: { environment: 'test' },
    requireSession: async () => ({ userId: 42 }),
    authenticatedAudioPost: post,
    subscribeAccountScope: () => () => undefined,
    stateStore: { uniqueCode: async () => 'test-key', listRecordingImportJobs: async () => [] },
  } as unknown as ServiceRuntime
  const instance = new RecordingService(runtime, {} as RecordingServiceDependencies)
  expect((await instance.recordingDeletionSelection({ dates, aboveBytes }, timeZone)).files).toEqual([])
  dayBytes++
  const selection = await instance.recordingDeletionSelection({ dates, aboveBytes }, timeZone)
  expect(selection.days).toEqual(dates.map(date => ({ date, bytes: aboveBytes + 1, selected: true })))
  expect(selection.files).toEqual([{ sessionId: id, ownerVersion: 7, startAt, endAt, bytes: 900_000_000, fileName: '跨日.WAV' }])
  expect(post.mock.calls.filter(([path]) => path.endsWith('/files/storage'))).toHaveLength(1)
  expect(post.mock.calls.every(([path]) => !path.includes('/del-session'))).toBe(true)
})
