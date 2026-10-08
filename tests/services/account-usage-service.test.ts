import { describe, expect, it, vi } from 'vitest'
import { AccountUsageService, parseRecordingUsage, parseStorageUsage, parseTokenUsage, parseVoiceUsage } from '../../src/services/account-usage-service.js'

describe('account usage contracts', () => {
  it('keeps audio storage separate from call recordings', () => {
    expect(parseStorageUsage({ file_size: 100 }, { used_file_size: 30, breakdown: [
      { file_type: 7, file_size: 10, file_count: 1 }, { file_type: 8, file_size: 20, file_count: 2 },
    ] }, 'prod:11').breakdown).toEqual([
      { category: 'callRecording', bytes: 10, fileCount: 1 }, { category: 'recording', bytes: 20, fileCount: 2 },
    ])
  })

  it('keeps QToken used and remaining separate from monetary balance', () => {
    expect(parseTokenUsage({ used_token: 10, able_token: 90 }, 'prod:11')).toEqual({ accountScope: 'prod:11', used: 10, remaining: 90 })
    expect(parseTokenUsage({ used_token: 0, able_token: 0 }, 'prod:11')).toMatchObject({ used: 0, remaining: 0 })
  })
  it.each([{}, { used_token: 0 }, { used_token: -1, able_token: 5 }, { used_token: '1', able_token: 5 }, { used_token: 1.2, able_token: 5 }, { used_token: 1, able_token: Infinity }, { used_token: Number.MAX_SAFE_INTEGER, able_token: 1 }])('rejects invalid tokens rather than inventing a zero %j', raw => {
    expect(() => parseTokenUsage(raw, 'prod:11')).toThrow()
  })
  it('uses bytes or binary MB using the mobile field precedence', () => {
    expect(parseStorageUsage({ file_size_mb: 100 }, { size: 1024 }, 'prod:11')).toEqual({ accountScope: 'prod:11', totalBytes: 100 * 1024 ** 2, usedBytes: 1024 })
    expect(parseStorageUsage({ file_size: 80, file_size_mb: 100 }, { used_file_size: 90, size: 10 }, 'prod:11')).toMatchObject({ totalBytes: 80, usedBytes: 90 })
    expect(parseStorageUsage({ file_size: 0 }, { size: 0 }, 'prod:11')).toMatchObject({ totalBytes: 0, usedBytes: 0 })
  })
  it('preserves voice seconds and remaining semantics, including zero allowance', () => {
    expect(parseVoiceUsage({ used_sec: 61, able_sec: 119 }, 'prod:11')).toEqual({ accountScope: 'prod:11', usedSeconds: 61, remainingSeconds: 119 })
    expect(parseVoiceUsage({ used_sec: 0, able_sec: 0 }, 'prod:11')).toMatchObject({ usedSeconds: 0, remainingSeconds: 0 })
  })
  it.each([{}, { used_sec: 0 }, { used_sec: -1, able_sec: 5 }, { used_sec: '1', able_sec: 5 }, { used_sec: 1.2, able_sec: 5 }, { used_sec: 1, able_sec: Infinity }, { used_sec: Number.MAX_SAFE_INTEGER, able_sec: 1 }])('rejects invalid voice seconds instead of silently returning zero %j', raw => {
    expect(() => parseVoiceUsage(raw, 'prod:11')).toThrow()
  })
  it('parses recording transcription as a separate monthly benefit with fixed billing rows and pending work', () => {
    expect(parseRecordingUsage({
      month: '2026-09', total_seconds: 432_000, used_seconds: 3, remaining_seconds: 431_997,
      statistics_started_at: 1_790_000_000_000_000,
      breakdown: [
        { recording_kind: 3, speech_duration_ms: 2_001, requested_seconds: 3, deducted_seconds: 2, waived_seconds: 1 },
        { recording_kind: 1, speech_duration_ms: 1_000, requested_seconds: 1, deducted_seconds: 1, waived_seconds: 0 },
        { recording_kind: 2, speech_duration_ms: 0, requested_seconds: 0, deducted_seconds: 0, waived_seconds: 0 },
      ],
    }, { pending_child_count: 4 }, 'prod:11')).toEqual({
      accountScope: 'prod:11', month: '2026-09', totalSeconds: 432_000, usedSeconds: 3,
      remainingSeconds: 431_997, pendingChildCount: 4, statisticsStartedAtMicros: 1_790_000_000_000_000,
      breakdown: [
        { recordingKind: 1, recordingDurationMillis: null, speechDurationMillis: 1_000, requestedSeconds: 1, deductedSeconds: 1, waivedSeconds: 0 },
        { recordingKind: 2, recordingDurationMillis: null, speechDurationMillis: 0, requestedSeconds: 0, deductedSeconds: 0, waivedSeconds: 0 },
        { recordingKind: 3, recordingDurationMillis: null, speechDurationMillis: 2_001, requestedSeconds: 3, deductedSeconds: 2, waivedSeconds: 1 },
      ],
    })
  })
  it('preserves known, unknown and zero monthly recording durations independently from speech', () => {
    const raw = { month: '2026-09', total_seconds: 86400, used_seconds: 0, remaining_seconds: 86400, statistics_started_at: 0,
      breakdown: [60000, null, 0].map((duration, index) => ({ recording_kind: index + 1, recording_duration_ms: duration, speech_duration_ms: 0, requested_seconds: 0, deducted_seconds: 0, waived_seconds: 0 })) }
    expect(parseRecordingUsage(raw, { pending_child_count: 0 }, 'test:11').breakdown.map(row => row.recordingDurationMillis)).toEqual([60000, null, 0])
    raw.breakdown[0]!.recording_duration_ms = -1
    expect(() => parseRecordingUsage(raw, { pending_child_count: 0 }, 'test:11')).toThrow()
  })
  it('preserves unavailable historical quota as null instead of fabricating current entitlement', () => {
    const usage = parseRecordingUsage({
      month: '2026-08', total_seconds: null, used_seconds: 120, remaining_seconds: null,
      statistics_started_at: 1_790_000_000_000_000,
      breakdown: [1, 2, 3].map(recording_kind => ({
        recording_kind, speech_duration_ms: 0,
        requested_seconds: recording_kind === 1 ? 120 : 0,
        deducted_seconds: recording_kind === 1 ? 120 : 0,
        waived_seconds: 0,
      })),
    }, { pending_child_count: 0 }, 'prod:11')
    expect(usage).toMatchObject({ totalSeconds: null, remainingSeconds: null, usedSeconds: 120, pendingChildCount: 0 })
  })
  it('accepts a downgraded current allowance after usage has exceeded the new quota', () => {
    const usage = parseRecordingUsage({
      month: '2026-09', total_seconds: 100, used_seconds: 120, remaining_seconds: 0,
      statistics_started_at: 1,
      breakdown: [1, 2, 3].map(recording_kind => ({
        recording_kind, speech_duration_ms: 0,
        requested_seconds: recording_kind === 2 ? 120 : 0,
        deducted_seconds: recording_kind === 2 ? 120 : 0,
        waived_seconds: 0,
      })),
    }, { pending_child_count: 0 }, 'prod:11')
    expect(usage).toMatchObject({ totalSeconds: 100, usedSeconds: 120, remainingSeconds: 0 })
  })
  it.each([
    [{}, { pending_child_count: 0 }],
    [{ month: '2026-9', total_seconds: 1, used_seconds: 0, remaining_seconds: 1, statistics_started_at: 1, breakdown: [] }, { pending_child_count: 0 }],
    [{ month: '2026-09', total_seconds: 1, used_seconds: 0, remaining_seconds: null, statistics_started_at: 1, breakdown: [] }, { pending_child_count: 0 }],
    [{ month: '2026-09', total_seconds: 1, used_seconds: 0, remaining_seconds: 1, statistics_started_at: 1, breakdown: [] }, { pending_child_count: -1 }],
    [{ month: '2026-09', total_seconds: 1, used_seconds: 0, remaining_seconds: 1, statistics_started_at: 1, breakdown: [1, 2, 2].map(recording_kind => ({ recording_kind, speech_duration_ms: 0, requested_seconds: 0, deducted_seconds: 0, waived_seconds: 0 })) }, { pending_child_count: 0 }],
    [{ month: '2026-09', total_seconds: 10, used_seconds: 1, remaining_seconds: 9, statistics_started_at: 1, breakdown: [1, 2, 3].map(recording_kind => ({ recording_kind, speech_duration_ms: 0, requested_seconds: 0, deducted_seconds: 0, waived_seconds: 0 })) }, { pending_child_count: 0 }],
  ])('rejects malformed recording usage instead of turning unavailable data into zero: %#', (usage, pending) => {
    expect(() => parseRecordingUsage(usage, pending, 'prod:11')).toThrow()
  })
  it.each([[{}, { size: 2 }], [{ file_size_mb: 2 }, {}], [{ file_size: -1 }, { size: 2 }], [{ file_size_mb: Number.MAX_SAFE_INTEGER }, { size: 2 }], [{ file_size: null }, { size: 2 }]])('rejects missing, unsafe or invalid storage fields', (member, usage) => {
    expect(() => parseStorageUsage(member, usage, 'prod:11')).toThrow()
  })
  function fixture() {
    const config = { environment: 'prod' }
    let userId = 11
    const read = vi.fn(async (path: string) => {
      if (path.endsWith('q-token-limited-opt')) return { used_token: 10, able_token: 90 }
      if (path.endsWith('vop-limited-opt')) return { used_sec: 60, able_sec: 120 }
      if (path.endsWith('recording-transcription-usage')) return {
        month: '2026-09', total_seconds: 86_400, used_seconds: 120, remaining_seconds: 86_280,
        statistics_started_at: 1, breakdown: [1, 2, 3].map(recording_kind => ({
          recording_kind, speech_duration_ms: 0,
          requested_seconds: recording_kind === 1 ? 120 : 0,
          deducted_seconds: recording_kind === 1 ? 120 : 0,
          waived_seconds: 0,
        })),
      }
      if (path.endsWith('member')) return { file_size_mb: 100 }
      return { size: 2048 }
    })
    const audioRead = vi.fn(async () => ({ pending_child_count: 2 }))
    const service = new AccountUsageService({ config, requireSession: async () => ({ userId }), authenticatedAuthReadPost: read, authenticatedAudioPost: audioRead } as never)
    return { service, read, audioRead, config, setUser: (id: number) => { userId = id } }
  }
  it('reads monthly VOP separately from Token/storage without debiting or querying recordings', async () => {
    const { service, read } = fixture()
    await expect(service.tokens('prod:11')).resolves.toMatchObject({ used: 10, remaining: 90 })
    await expect(service.storage('prod:11')).resolves.toMatchObject({ usedBytes: 2048 })
    await expect(service.voice('prod:11')).resolves.toMatchObject({ usedSeconds: 60, remainingSeconds: 120 })
    expect(read.mock.calls.map(c => c[0])).toEqual(['/api/v1/premium/get/q-token-limited-opt', '/api/v1/premium/get/member', '/api/v1/premium/get/used-size', '/api/v1/premium/get/vop-limited-opt'])
  })
  it('reads Backend recording entitlement and Audio pending work without consulting VOP', async () => {
    const { service, read, audioRead } = fixture()
    await expect(service.recording('prod:11', '2026-09')).resolves.toMatchObject({
      month: '2026-09', totalSeconds: 86_400, usedSeconds: 120, remainingSeconds: 86_280,
      pendingChildCount: 2,
    })
    expect(read).toHaveBeenCalledWith(
      '/api/v1/premium/get/recording-transcription-usage', { month: '2026-09' },
      expect.objectContaining({ userId: 11 }), undefined,
    )
    expect(audioRead).toHaveBeenCalledWith(
      '/api/v1/audio/recording-billing/pending', {}, expect.objectContaining({ userId: 11 }), undefined,
    )
    expect(read.mock.calls.some(call => String(call[0]).includes('vop-limited-opt'))).toBe(false)
  })
  it('does not turn either recording owner failure into a successful zero snapshot', async () => {
    const f = fixture()
    f.audioRead.mockRejectedValueOnce(new Error('pending unavailable'))
    await expect(f.service.recording('prod:11')).rejects.toThrow('pending unavailable')
    f.read.mockRejectedValueOnce(new Error('usage unavailable'))
    await expect(f.service.recording('prod:11')).rejects.toThrow('usage unavailable')
  })
  it('rejects stale user/environment and empty scopes before fetching', async () => {
    const { service, read } = fixture()
    for (const scope of ['prod:12', 'test:11', '']) {
      await expect(service.tokens(scope)).rejects.toMatchObject({ code: 'account-usage-account-changed' })
      await expect(service.storage(scope)).rejects.toMatchObject({ code: 'account-usage-account-changed' })
      await expect(service.voice(scope)).rejects.toMatchObject({ code: 'account-usage-account-changed' })
      await expect(service.recording(scope)).rejects.toMatchObject({ code: 'account-usage-account-changed' })
    }
    expect(read).not.toHaveBeenCalled()
  })
  it.each(['user', 'environment'])('discards voice results when %s changes during reading', async kind => {
    const f = fixture()
    f.read.mockImplementation(async () => {
      if (kind === 'user') f.setUser(12)
      else f.config.environment = 'test'
      return { used_sec: 60, able_sec: 120 }
    })
    await expect(f.service.voice('prod:11')).rejects.toMatchObject({ code: 'account-usage-account-changed' })
  })
  it.each(['user', 'environment'])('discards results when %s changes during reading', async kind => {
    const f = fixture()
    f.read.mockImplementation(async () => {
      if (kind === 'user') f.setUser(12)
      else f.config.environment = 'test'
      return { used_token: 10, able_token: 90 }
    })
    await expect(f.service.tokens('prod:11')).rejects.toMatchObject({ code: 'account-usage-account-changed' })
  })
  it('preserves Token reading when storage fails', async () => {
    const f = fixture()
    f.read.mockImplementation(async path => {
      if (path.endsWith('q-token-limited-opt')) return { used_token: 10, able_token: 90 }
      throw new Error('offline')
    })
    await expect(f.service.storage('prod:11')).rejects.toThrow('offline')
    await expect(f.service.tokens('prod:11')).resolves.toMatchObject({ remaining: 90 })
  })
})
