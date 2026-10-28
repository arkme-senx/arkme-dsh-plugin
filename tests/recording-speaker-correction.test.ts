import { correctionOwnerResponse } from './fixtures/recording-correction-owner.js'
import { describe, expect, it, vi } from 'vitest'
import { RecordingService, type RecordingServiceDependencies } from '../src/services/recording-service.js'
import { ArkmePluginError, type ServiceRuntime } from '../src/services/service.js'

const date = new Date(2026, 9, 14).getTime()
function fixture(fixtureDate = date) {
  const session = { userId: 42, accessToken: 'test', refreshToken: 'test' }
  const rows: Array<Record<string, unknown>> = [
    { s: 0, e: 1000, n: 1, t: '本人发言' }, { s: 1000, e: 2000, n: 1, t: '手机播放' }, { s: 2000, e: 3000, n: 1, t: '后续发言' },
  ]
  const original = structuredClone(rows)
  const state = { version: 'v1', unsupported: false, failContext: false, badContext: false, failWrite: false, partial: false, readFails: false, applied: false, loseResponse: false }
  const receipts = new Map<string, Record<string, unknown>>()
  const post = vi.fn(async (path: string, body: Record<string, unknown>) => {
    if (path.includes('/recordings/')) {
      if (state.readFails && state.applied) throw new Error('read failed')
      return correctionOwnerResponse(path, body, { session_ls: [{ id: '123456789012345678901234', belong_usr: 42, start_at: fixtureDate, end_at: fixtureDate + 86_400_000, spk_ls: [{ num: 1, spk_id: '345678901234567890123456' }] }], child_ls: [{ id: '234567890123456789012345', session_id: '123456789012345678901234', start_at: 0, asr: rows, doubao_asr: rows }] })
    }
    if (path.endsWith('/get-speaker-ls')) return { spk_ls: [{ id: '345678901234567890123456', nick_name: '周鹏' }] }
    if (path.endsWith('/speaker-corrections/context')) {
      if (state.unsupported) throw new ArkmePluginError('arkme-http-error', 'missing', false, 404)
      if (state.failContext) throw new ArkmePluginError('arkme-http-error', 'offline', true, 503)
      if (state.badContext) return { supported: true }
      return { supported: true, schema_version: 1, version: state.version, max_items: 100, sound_source: 'unknown', excluded_speakers: [], ...(state.applied ? { last_correction: { id: 'correction', can_undo: true } } : {}) }
    }
    if (path.endsWith('/speaker-corrections/result')) return { schema_version: 1, receipt: receipts.get(String(body.idempotency_key)) ?? null }
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
    expect(f.writes()[0]![1]).toMatchObject({ rejected_speaker_id: '345678901234567890123456', detach: true, sound_source: 'playback', items: [{ session_id: '123456789012345678901234', child_id: '234567890123456789012345', item_index: 1, transcript_source: 'system', start_at: 1000, end_at: 2000 }] })
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

  it('keeps the explicit recording timezone day boundary on a DST day', async () => {
    const dateStamp = Date.parse('2026-03-08T05:00:00Z')
    const endStamp = Date.parse('2026-03-09T04:00:00Z')
    const f = fixture(dateStamp)
    const day = await f.service.recordingDay(dateStamp, undefined, { dateStamp, endStamp, timeZone: 'America/New_York', date: '2026-03-08' })
    await f.service.applyRecordingSpeakerCorrection(request(day.transcript.items[0]!.itemRef))
    expect(f.writes()[0]![1]).toMatchObject({ date_stamp: dateStamp, day_end: endStamp })
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
    expect(await f.service.recordingSpeakerRecommendation(result.day!.transcript.items[1]!.itemRef)).toEqual({ groupItemCount: 1 })
    expect(f.post.mock.calls.some(([path]) => path.endsWith('/similar-session-speaker'))).toBe(false)
  })

})


it('reads receipts without performing a missing write, and recovers a lost committed response', async () => {
  const f = fixture(), ref = (await f.service.recordingDay(date)).transcript.items[1]!.itemRef
  const input = request(ref)
  const query = { itemRef: ref, action: 'apply' as const, idempotencyKey: input.idempotencyKey }
  expect(await f.service.recordingSpeakerCorrectionResult(query)).toBeNull()
  expect(f.writes()).toHaveLength(0)
  expect(f.state.applied).toBe(false)
  f.state.loseResponse = true
  await expect(f.service.applyRecordingSpeakerCorrection(input)).rejects.toThrow('response lost')
  const result = await f.service.recordingSpeakerCorrectionResult(query)
  expect(result?.transcript?.items[1]!.speakerLabel).toBe('说话人 8001')
  expect(f.writes()).toHaveLength(1)
  f.session.userId = 43
  await expect(f.service.recordingSpeakerCorrectionResult(query)).rejects.toMatchObject({ code: 'recording-ref-account-mismatch' })
})

it('reads enhanced correction from its own source without inventing a day or a refresh failure', async () => {
  const f = fixture()
  const selected = (await f.service.recordingComparison(date)).doubao.items[1]!
  expect(selected.transcriptSource).toBe('doubao')
  const input = request(selected.itemRef)
  const result = await f.service.applyRecordingSpeakerCorrection(input)
  expect(result.warning).toBeUndefined()
  expect(result.day).toBeUndefined()
  expect(result.transcript?.items[1]!).toMatchObject({ speakerLabel: '说话人 8001', transcriptSource: 'doubao' })
  const restored = await f.service.recordingSpeakerCorrectionResult({ itemRef: selected.itemRef, action: 'apply', idempotencyKey: input.idempotencyKey })
  expect(restored?.warning).toBeUndefined()
  expect(restored?.transcript?.items[1]!.transcriptSource).toBe('doubao')
  const undo = await f.service.undoRecordingSpeakerCorrection({ itemRef: result.transcript!.items[1]!.itemRef, undoRef: result.undoRef!, expectedVersion: 'v2', idempotencyKey: 'enhanced-undo-0001' })
  expect(undo.warning).toBeUndefined()
  expect(undo.transcript?.items[1]!.speakerLabel).toBe('周鹏')
})

it('finds correction neighbors beyond the first transcript page without reading an entire day', async () => {
  const f = fixture()
  f.rows.splice(0, f.rows.length, ...Array.from({ length: 500 }, (_, i) => ({ s: i * 10000, e: i * 10000 + 1000, n: 1, t: `发言${i}` })))
  const result = await f.service.recordingSpeakerCorrectionItems({ dateStamp: date, atMillis: date + 4000000, transcriptSource: 'system' })
  expect(result.items.some(item => item.text === '发言400')).toBe(true)
  expect(result.items).toHaveLength(100)
  const reads = f.post.mock.calls.filter(([path]) => path.endsWith('/recordings/transcript/query'))
  expect(reads.length).toBeGreaterThan(1)
  expect(reads.every(([, body]) => body.start_at === date + 3400000 && body.end_at === date + 4600001)).toBe(true)
})
