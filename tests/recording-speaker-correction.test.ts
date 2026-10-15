import { describe, expect, it, vi } from 'vitest'
import { RecordingService, type RecordingServiceDependencies } from '../src/services/recording-service.js'
import { ArkmePluginError, type ServiceRuntime } from '../src/services/service.js'

const date = new Date(2026, 9, 14).getTime()
function fixture() {
  const session = { userId: 42, accessToken: 'test', refreshToken: 'test' }
  const rows: Array<Record<string, unknown>> = [
    { s: 0, e: 1000, n: 1, t: '本人发言' }, { s: 1000, e: 2000, n: 1, t: '手机播放' }, { s: 2000, e: 3000, n: 1, t: '后续发言' },
  ]
  const original = structuredClone(rows)
  const state = { version: 'v1', unsupported: false, failContext: false, badContext: false, failWrite: false, partial: false, readFails: false, applied: false, loseResponse: false }
  const receipts = new Map<string, Record<string, unknown>>()
  const post = vi.fn(async (path: string, body: Record<string, unknown>) => {
    if (path.endsWith('/one-day-trans')) {
      if (state.readFails && state.applied) throw new Error('read failed')
      return { session_ls: [{ id: 'session', belong_usr: 42, start_at: date, end_at: date + 86_400_000, spk_ls: [{ num: 1, spk_id: 'person' }] }], child_ls: [{ id: 'child', session_id: 'session', start_at: 0, asr: rows }] }
    }
    if (path.endsWith('/get-speaker-ls')) return { spk_ls: [{ id: 'person', nick_name: '周鹏' }] }
    if (path.endsWith('/speaker-corrections/context')) {
      if (state.unsupported) throw new ArkmePluginError('arkme-http-error', 'missing', false, 404)
      if (state.failContext) throw new ArkmePluginError('arkme-http-error', 'offline', true, 503)
      if (state.badContext) return { supported: true }
      return { supported: true, schema_version: 1, version: state.version, max_items: 100, sound_source: 'unknown', excluded_speakers: [], ...(state.applied ? { last_correction: { id: 'correction', can_undo: true } } : {}) }
    }
    if (path.endsWith('/speaker-corrections/apply')) {
      if (state.unsupported) throw new ArkmePluginError('arkme-http-error', 'missing', false, 404)
      if (state.failWrite) throw new Error('connection lost')
      const saved = receipts.get(String(body.idempotency_key))
      if (saved) return saved
      if (body.expected_version !== state.version) throw new ArkmePluginError('conflict', 'changed', false, 409)
      const anchor = body.item as { item_index: number; start_at: number; end_at: number }
      if (rows[anchor.item_index]!.s !== anchor.start_at || rows[anchor.item_index]!.e !== anchor.end_at) throw new ArkmePluginError('conflict', 'changed', false, 409)
      const targets = body.items as Array<{ item_index: number }>
      for (const target of targets) {
        const row = rows[target.item_index]!
        if (body.rejected_speaker_id || body.detach) Object.assign(row, { q: '', speaker_identity_source: 'system', effective_spk_id: '', speaker_partition_id: `split-${target.item_index}`, speaker_display_number: 8000 + target.item_index })
        if (body.sound_source) row.sound_source = body.sound_source
      }
      state.applied = true; state.version = 'v2'
      const receipt = { schema_version: 1, state: 'applied', correction_id: 'correction', can_undo: true, version: state.version, affected_count: state.partial ? 0 : targets.length }
      receipts.set(String(body.idempotency_key), receipt)
      if (state.loseResponse) { state.loseResponse = false; throw new Error('response lost after commit') }
      return receipt
    }
    if (path.endsWith('/speaker-corrections/undo')) {
      rows.splice(0, rows.length, ...structuredClone(original)); state.version = 'v3'; state.applied = false
      return { schema_version: 1, state: 'undone', version: state.version, affected_count: 1 }
    }
    return {}
  })
  const runtime = { subscribeAccountScope: () => () => {}, config: { environment: 'test', maxTextLength: 20000 }, requireSession: async () => session,
    authenticatedAudioPost: post, stateStore: { uniqueCode: async () => 'test-key' } } as unknown as ServiceRuntime
  const service = new RecordingService(runtime, {} as RecordingServiceDependencies)
  const writes = () => post.mock.calls.filter(([path]) => /speaker-corrections\/(apply|undo)$/.test(path))
  return { service, state, rows, session, post, writes }
}
const request = (itemRef: string) => ({ itemRef, itemRefs: [itemRef], rejectCurrent: true, detach: true, expectedVersion: 'v1', idempotencyKey: 'correction-request-001' })

describe('speaker correction owner adapter', () => {
  it('excludes only the selected fragment, projects its new identity/source, and supports a bound undo', async () => {
    const f = fixture(), day = await f.service.recordingDay(date), item = day.transcript.items[1]!
    const result = await f.service.applyRecordingSpeakerCorrection({ ...request(item.itemRef), soundSource: 'playback' })
    expect(f.writes()[0]![1]).toMatchObject({ rejected_speaker_id: 'person', detach: true, sound_source: 'playback', items: [{ session_id: 'session', child_id: 'child', item_index: 1, transcript_source: 'system', start_at: 1000, end_at: 2000 }] })
    expect(result.day!.transcript.items.map(row => row.speakerLabel)).toEqual(['周鹏', '说话人 8001', '周鹏'])
    expect(result.day!.transcript.items[1]!.soundSource).toBe('playback')
    expect(result.day!.transcript.items[1]!.speakerKey).not.toBe(result.day!.transcript.items[0]!.speakerKey)
    const fresh = await f.service.recordingDay(date)
    expect(fresh.transcript.items[1]!.soundSource).toBe('playback')
    const context = await f.service.recordingSpeakerCorrectionContext(fresh.transcript.items[1]!.itemRef)
    expect(context.supported && context.undoRef).toBeTruthy()
    const undo = await f.service.undoRecordingSpeakerCorrection({ itemRef: fresh.transcript.items[1]!.itemRef, undoRef: result.undoRef!, expectedVersion: 'v2', idempotencyKey: 'correction-undo-001' })
    expect(undo.day!.transcript.items[1]!.speakerLabel).toBe('周鹏')
    expect(undo.day!.transcript.items[1]!.soundSource).toBeUndefined()
  })

  it('keeps source changes independent of person identity', async () => {
    const f = fixture(), day = await f.service.recordingDay(date)
    const input = request(day.transcript.items[0]!.itemRef)
    const result = await f.service.applyRecordingSpeakerCorrection({ ...input, rejectCurrent: undefined, detach: false, soundSource: 'playback' })
    expect(result.day!.transcript.items[0]!.speakerLabel).toBe('周鹏')
    expect(result.day!.transcript.items[0]!.soundSource).toBe('playback')
    expect(f.writes()[0]![1]).not.toHaveProperty('rejected_speaker_id')
  })

  it('distinguishes unavailable capability from network errors and malformed contracts', async () => {
    const f = fixture(), ref = (await f.service.recordingDay(date)).transcript.items[0]!.itemRef
    f.state.unsupported = true
    expect(await f.service.recordingSpeakerCorrectionContext(ref)).toEqual({ supported: false })
    await expect(f.service.applyRecordingSpeakerCorrection(request(ref))).rejects.toMatchObject({ httpStatus: 404 })
    f.state.unsupported = false; f.state.failContext = true
    await expect(f.service.recordingSpeakerCorrectionContext(ref)).rejects.toThrow('offline')
    f.state.failContext = false; f.state.badContext = true
    await expect(f.service.recordingSpeakerCorrectionContext(ref)).rejects.toMatchObject({ code: 'recording-correction-contract-invalid' })
    expect(f.writes()).toHaveLength(1)
  })

  it.each(['account', 'version', 'range', 'duplicate', 'count', 'missing-anchor', 'empty'] as const)('rejects invalid %s without committing', async kind => {
    const f = fixture(), day = await f.service.recordingDay(date), input = request(day.transcript.items[0]!.itemRef)
    if (kind === 'account') f.session.userId = 43
    if (kind === 'version') input.expectedVersion = 'old'
    if (kind === 'range') f.rows[0]!.e = 999
    if (kind === 'duplicate') input.itemRefs.push(input.itemRef)
    if (kind === 'count') input.itemRefs = Array(101).fill(input.itemRef)
    if (kind === 'missing-anchor') input.itemRefs = [day.transcript.items[1]!.itemRef]
    if (kind === 'empty') { input.rejectCurrent = false; input.detach = false }
    await expect(f.service.applyRecordingSpeakerCorrection(input)).rejects.toThrow()
    expect(f.writes()).toHaveLength(['version', 'range'].includes(kind) ? 1 : 0)
    expect(f.state.applied).toBe(false)
  })

  it('does not use a receipt to undo another fragment', async () => {
    const f = fixture(), day = await f.service.recordingDay(date)
    const result = await f.service.applyRecordingSpeakerCorrection(request(day.transcript.items[1]!.itemRef))
    await expect(f.service.undoRecordingSpeakerCorrection({ itemRef: day.transcript.items[0]!.itemRef, undoRef: result.undoRef!, expectedVersion: 'v2', idempotencyKey: 'correction-undo-001' })).rejects.toMatchObject({ code: 'recording-correction-undo-invalid' })
    expect(f.writes()).toHaveLength(1)
  })

  it('exposes a definite owner conflict without labelling it a lost response', async () => {
    const f = fixture(), ref = (await f.service.recordingDay(date)).transcript.items[0]!.itemRef
    await expect(f.service.applyRecordingSpeakerCorrection({ ...request(ref), expectedVersion: 'stale' }))
      .rejects.toMatchObject({ code: 'recording-correction-rejected', message: '片段或纠错信息已变化，请重新打开录音后核对。', retryable: false })
    expect(f.state.applied).toBe(false)
  })

  it.each(['failWrite', 'partial'] as const)('does not claim success or repeat uncertain writes: %s', async kind => {
    const f = fixture(), ref = (await f.service.recordingDay(date)).transcript.items[0]!.itemRef
    f.state[kind] = true
    await expect(f.service.applyRecordingSpeakerCorrection(request(ref))).rejects.toThrow()
    expect(f.writes()).toHaveLength(1)
  })

  it('retains the successful receipt when the following day read fails', async () => {
    const f = fixture(), ref = (await f.service.recordingDay(date)).transcript.items[0]!.itemRef
    f.state.readFails = true
    const result = await f.service.applyRecordingSpeakerCorrection(request(ref))
    expect(result.day).toBeUndefined()
    expect(result.warning).toContain('已保存')
    expect(result.undoRef).toBeTruthy()
    expect(f.writes()).toHaveLength(1)
  })
  it('replays the exact request after a committed response is lost without a stale-context precheck', async () => {
    const f = fixture(), day = await f.service.recordingDay(date)
    const input = request(day.transcript.items[1]!.itemRef)
    f.state.loseResponse = true
    await expect(f.service.applyRecordingSpeakerCorrection(input)).rejects.toThrow('response lost')
    expect(f.state.version).toBe('v2')
    const result = await f.service.applyRecordingSpeakerCorrection(input)
    expect(result.affectedCount).toBe(1)
    expect(result.day!.transcript.items[1]!.speakerLabel).toBe('说话人 8001')
    expect(f.writes()[0]![1]).toEqual(f.writes()[1]![1])
  })
  it('does not recommend the old group for a detached interval', async () => {
    const f = fixture(), day = await f.service.recordingDay(date)
    const result = await f.service.applyRecordingSpeakerCorrection(request(day.transcript.items[1]!.itemRef))
    expect(await f.service.recordingSpeakerRecommendation(result.day!.transcript.items[1]!.itemRef)).toEqual({})
    expect(f.post.mock.calls.some(([path]) => path.endsWith('/similar-session-speaker'))).toBe(false)
  })

})
