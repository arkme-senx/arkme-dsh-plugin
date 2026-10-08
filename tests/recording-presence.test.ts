import { describe, expect, it, vi } from 'vitest'
import { parseRecordingPresence, recordingPresenceDisplay } from '../src/recording-presence.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { RecordingService } from '../src/services/recording-service.js'

const wire = { recording_id: 'r1', device_id: '42', device_name: '我的手机', client_type: 'mobile', platform: 'ios', recording_mode: 'all_day', state: 'recording', elapsed_ms: 60000, duration_anchor_at: 100000, expires_at: 130000, visible_until: 190000, freshness: 'fresh', started_at: 40000 }
const payload = (item = wire) => ({ items: [item], server_now: 105000, poll_interval_ms: 10000 })
describe('recording presence contract', () => {
  it('advances only fresh capture and freezes at confirmed duration on loss of contact', () => {
    const item = parseRecordingPresence(payload()).items[0]!
    expect(recordingPresenceDisplay(item, 110000)).toEqual({ state: 'recording', elapsedMillis: 70000, visible: true })
    expect(recordingPresenceDisplay(item, 130000)).toEqual({ state: 'stale', elapsedMillis: 60000, visible: true })
    expect(recordingPresenceDisplay(item, 190000).visible).toBe(false)
  })
  it.each(['paused', 'interrupted', 'error'])('does not advance %s capture', state => {
    const item = parseRecordingPresence(payload({ ...wire, state })).items[0]!
    expect(recordingPresenceDisplay(item, 110000).elapsedMillis).toBe(60000)
  })
  it('honors server stale state and explicit stop', () => {
    expect(recordingPresenceDisplay(parseRecordingPresence(payload({ ...wire, freshness: 'stale' })).items[0]!, 110000).state).toBe('stale')
    expect(recordingPresenceDisplay(parseRecordingPresence(payload({ ...wire, state: 'stopped' })).items[0]!, 110000).visible).toBe(false)
  })
  it('rejects malformed snapshots instead of turning them into an empty device list', () => {
    expect(() => parseRecordingPresence({})).toThrow()
    expect(() => parseRecordingPresence(payload({ ...wire, elapsed_ms: -1 }))).toThrow()
    expect(() => parseRecordingPresence(payload({ ...wire, state: 'uploading' }))).toThrow()
    expect(() => parseRecordingPresence({ ...payload(), poll_interval_ms: 0 })).toThrow()
  })
  it('projects only display fields and preserves string device IDs', () => {
    const value = parseRecordingPresence(payload({ ...wire, device_id: '9007199254740993', writer_token: 'secret' } as typeof wire))
    expect(value.items[0]?.deviceId).toBe('9007199254740993')
    expect(JSON.stringify(value)).not.toContain('secret')
  })
  it('queries authenticated live Audio state without cache', async () => {
    const session = { userId: 42 }
    const post = vi.fn().mockResolvedValue(payload())
    const signal = new AbortController().signal
    const result = await RecordingService.prototype.recordingPresence.call({ runtime: { requireSession: async () => session, authenticatedAudioPost: post } } as unknown as RecordingService, signal)
    expect(post).toHaveBeenCalledWith('/api/v1/audio/recording-presence/list', {}, session, signal, { bypassCache: true })
    expect(result.items[0]?.deviceName).toBe('我的手机')
  })
})

it('does not accept a caller-supplied account when dispatching live presence reads', async () => {
  const signal = new AbortController().signal
  const service = { recordingPresence: vi.fn().mockResolvedValue({ items: [] }) }
  await dispatchArkmeHostOperation(service as never, 'recordings.presence', { userId: 999, environment: 'production' }, undefined, undefined, undefined, undefined, signal)
  expect(service.recordingPresence).toHaveBeenCalledWith(signal)
})
