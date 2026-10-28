import { describe, expect, it, vi } from 'vitest'
import { parseRecordingHistory } from '../src/recording-history.js'
import { RecordingService } from '../src/services/recording-service.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
const row = { recording_id: 'a', device_id: '9007199254740993', device_name: '我的电脑', client_type: 'desktop', platform: 'macos', recording_mode: 'manual', state: 'stopped', freshness: 'fresh', started_at: 1000, elapsed_ms: 2000, stopped_at: 3000, last_confirmed_at: 3000, expires_at: 3000, duration_anchor_at: 3000 }
const page = { items: [row], next_cursor: '', has_more: false, server_now: 10000 }
describe('capture history contract', () => {
  it('preserves stopped and expired captures, device identity and confirmed elapsed time', () => {
    const result = parseRecordingHistory({ ...page, items: [row, { ...row, recording_id: 'b', started_at: 4000, state: 'recording', freshness: 'stale', stopped_at: 0 }] })
    expect(result.items.map(item => item.recordingId)).toEqual(['b', 'a'])
    expect(result.items[1]).toMatchObject({ deviceId: '9007199254740993', deviceName: '我的电脑', state: 'stopped', elapsedMillis: 2000 })
    expect(result.items[0]).toMatchObject({ state: 'recording', freshness: 'stale' })
  })
  it('rejects invalid pages and exposes no internal fields', () => {
    expect(() => parseRecordingHistory({ ...page, has_more: true })).toThrow()
    expect(() => parseRecordingHistory({ ...page, items: [{ ...row, elapsed_ms: -1 }] })).toThrow()
    expect(() => parseRecordingHistory({ ...page, items: [{ ...row, stopped_at: undefined }] })).toThrow()
    expect(JSON.stringify(parseRecordingHistory({ ...page, items: [{ ...row, writer_hash: 'secret', runtime_id: 'private' }] }))).not.toContain('secret')
  })
  it('only requests capture history with authenticated identity and an opaque cursor', async () => {
    const session = { userId: 42 }; const signal = new AbortController().signal
    const post = vi.fn().mockResolvedValue(page)
    const service = { assertWorkbenchEnabled: vi.fn(), runtime: { requireSession: async () => session, authenticatedAudioPost: post } }
    const result = await RecordingService.prototype.recordingHistory.call(service as never, { cursor: 'cursor' }, signal)
    expect(result.items).toHaveLength(1)
    expect(post).toHaveBeenCalledWith('/api/v1/audio/recording-presence/history', { cursor: 'cursor', limit: 20 }, session, signal, { bypassCache: true })
  })
  it('rejects oversized cursors before requesting', async () => {
    await expect(RecordingService.prototype.recordingHistory.call({ assertWorkbenchEnabled() {} } as never, { cursor: 'x'.repeat(513) })).rejects.toThrow()
  })
  it('ignores caller-supplied account identity', async () => {
    const service = { recordingHistory: vi.fn(async () => ({ items: [] })) }
    await dispatchArkmeHostOperation(service as never, 'recordings.history', { cursor: 'next', userId: 999 })
    expect(service.recordingHistory).toHaveBeenCalledWith({ cursor: 'next' }, undefined)
  })
})
