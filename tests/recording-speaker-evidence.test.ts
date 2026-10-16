import { describe, expect, it, vi } from 'vitest'
import { parseRecordingSpeakerConsistency, parseRecordingSpeakerEvidence } from '../src/recording-speaker-evidence.js'
import { RecordingService, type RecordingServiceDependencies } from '../src/services/recording-service.js'
import { ArkmePluginError, type ServiceRuntime } from '../src/services/service.js'

const input = { itemRefs: ['row-1'], referenceA: ['a'], referenceB: ['b'] }
const response = () => ({ supported: true, schema_version: 1, version: 'v1', model_version: 'model-v1', metric: 'cosine_distance', aggregation: 'mean_reference', state: 'ready',
  items: [{ client_index: 0, status: 'ready', distance_a: 0.31, distance_b: 0.12, effective_speech_ms: 3000 }] })
const consistencyInput = { anchorRefs: ['anchor'], itemRefs: ['row'] }
const consistencyResponse = () => ({ supported: true, schema_version: 1, metric: 'cosine_distance', groups: [{
  client_index: 0, version: 'v1', model_version: 'model-v1', score_definition: 'calibrated-cohesion-v1', reference_method: 'robust-dominant-group',
  state: 'partial', score: 86 as number | null, analyzed_count: 8, total_count: 10, review_count: 2,
  items: [{ client_index: 0, status: 'ready', deviation: .34 as number | null }],
}] })

describe('speaker consistency contract', () => {
  it('preserves a group score and coverage separately from per-segment distance', () => {
    expect(parseRecordingSpeakerConsistency(consistencyResponse(), consistencyInput)).toMatchObject({ supported: true, groups: [{
      anchorRef: 'anchor', score: 86, state: 'partial', analyzedCount: 8, totalCount: 10, reviewCount: 2,
      items: [{ itemRef: 'row', deviation: .34 }],
    }] })
    const raw = consistencyResponse(); raw.groups[0]!.score = 0
    expect(parseRecordingSpeakerConsistency(raw, consistencyInput)).toMatchObject({ groups: [{ score: 0 }] })
    raw.groups[0]!.state = 'insufficient'; raw.groups[0]!.score = null
    raw.groups[0]!.items[0] = { client_index: 0, status: 'insufficient', deviation: null }
    expect(parseRecordingSpeakerConsistency(raw, consistencyInput)).toMatchObject({ groups: [{ score: null, items: [{ deviation: null }] }] })
  })
  it.each(['model', 'definition', 'missing-group', 'duplicate-group', 'coverage', 'false-complete', 'score', 'nan', 'missing-row', 'duplicate-row', 'distance', 'false-certainty'] as const)('rejects %s instead of displaying a reassuring score', kind => {
    const raw = consistencyResponse(), group = raw.groups[0]!
    if (kind === 'model') group.model_version = ''
    if (kind === 'definition') group.score_definition = ''
    if (kind === 'missing-group') raw.groups = []
    if (kind === 'duplicate-group') raw.groups.push(group)
    if (kind === 'coverage') group.analyzed_count = 11
    if (kind === 'false-complete') group.state = 'ready'
    if (kind === 'score') group.score = 101
    if (kind === 'nan') group.score = NaN
    if (kind === 'missing-row') group.items = []
    if (kind === 'duplicate-row') group.items.push(group.items[0]!)
    if (kind === 'distance') group.items[0]!.deviation = 3
    if (kind === 'false-certainty') group.items[0]!.status = 'insufficient'
    expect(() => parseRecordingSpeakerConsistency(raw, consistencyInput)).toThrow('一致性证据')
  })
})

describe('speaker evidence contract', () => {
  it('preserves distances, their model and aggregation without converting to percentages', () => {
    expect(parseRecordingSpeakerEvidence(response(), input)).toEqual({ supported: true, version: 'v1', modelVersion: 'model-v1', metric: 'cosine_distance', aggregation: 'mean_reference', state: 'ready',
      items: [{ itemRef: 'row-1', status: 'ready', distanceA: .31, distanceB: .12, effectiveSpeechMillis: 3000 }] })
    expect(parseRecordingSpeakerEvidence({ supported: false }, input)).toEqual({ supported: false })
  })
  it.each(['missing', 'duplicate', 'unknown-index', 'nan', 'range', 'model', 'metric', 'false-certainty'] as const)('rejects %s evidence', kind => {
    const raw = response()
    if (kind === 'missing') raw.items = []
    if (kind === 'duplicate') raw.items.push(raw.items[0]!)
    if (kind === 'unknown-index') raw.items[0]!.client_index = 1
    if (kind === 'nan') raw.items[0]!.distance_a = NaN
    if (kind === 'range') raw.items[0]!.distance_b = 3
    if (kind === 'model') raw.model_version = ''
    if (kind === 'metric') raw.metric = 'similarity'
    if (kind === 'false-certainty') raw.items[0]!.status = 'insufficient'
    expect(() => parseRecordingSpeakerEvidence(raw, input)).toThrow('证据')
  })
})

function fixture() {
  const date = new Date(2026, 9, 14).getTime()
  const session = { userId: 42, accessToken: 'test', refreshToken: 'test' }
  const state = { unavailable: false, fail: false, invalid: false, switchAccount: false }
  const post = vi.fn(async (path: string, body: Record<string, unknown>) => {
    if (path.endsWith('/one-day-trans')) return { session_ls: [{ id: 'session', belong_usr: 42, start_at: date, end_at: date + 86400000, spk_ls: [{ num: 1, spk_id: 'person' }] }],
      child_ls: [{ id: 'child', session_id: 'session', start_at: 0, asr: [{ s: 0, e: 4000, n: 1, t: '甲' }, { s: 5000, e: 9000, n: 1, t: '乙' }] }] }
    if (path.endsWith('/get-speaker-ls')) return { spk_ls: [{ id: 'person', nick_name: '周鹏' }] }
    if (path.includes('/speaker-evidence/')) {
      if (state.unavailable) throw new ArkmePluginError('missing', 'missing', false, 404)
      if (state.fail) throw new ArkmePluginError('network', 'offline', true, 503)
      if (state.switchAccount) session.userId = 43
      if (state.invalid) return { supported: true }
      if (path.endsWith('/consistency')) return { ...consistencyResponse(), groups: (body.groups as Array<{ client_index: number }>).map(group => ({
        ...consistencyResponse().groups[0], client_index: group.client_index,
        items: (body.items as Array<{ client_index: number }>).map(row => ({ client_index: row.client_index, status: 'ready', deviation: .34 })),
      })) }
      return { ...response(), items: (body.items as Array<{ client_index: number }>).map(row => ({ ...response().items[0], client_index: row.client_index })) }
    }
    return {}
  })
  const runtime = { subscribeAccountScope: () => () => {}, config: { environment: 'test', maxTextLength: 20000 }, requireSession: async () => ({ ...session }),
    authenticatedAudioPost: post, stateStore: { uniqueCode: async () => 'test-key' } } as unknown as ServiceRuntime
  return { service: new RecordingService(runtime, {} as RecordingServiceDependencies), state, post, date, session }
}

describe('interval evidence adapter', () => {
  it('sends exact interval locators and returns scores bound to requested opaque references', async () => {
    const f = fixture(), rows = (await f.service.recordingDay(f.date)).transcript.items
    const request = { itemRefs: [rows[1]!.itemRef], referenceA: [rows[0]!.itemRef], referenceB: [rows[1]!.itemRef] }
    const result = await f.service.recordingSpeakerEvidence(request)
    const call = f.post.mock.calls.find(([path]) => path.endsWith('/speaker-evidence/compare'))!
    expect(call[1]).toMatchObject({ items: [{ client_index: 0, session_id: 'session', child_id: 'child', item_index: 1, start_at: 5000, end_at: 9000 }], reference_a: [{ item_index: 0, start_at: 0, end_at: 4000 }] })
    expect(result.supported && result.items[0]!.itemRef).toBe(rows[1]!.itemRef)
  })
  it.each(['unavailable', 'fail', 'invalid', 'switchAccount'] as const)('handles %s without fabricating evidence', async kind => {
    const f = fixture(), rows = (await f.service.recordingDay(f.date)).transcript.items
    f.state[kind] = true
    const promise = f.service.recordingSpeakerEvidence({ itemRefs: [rows[1]!.itemRef], referenceA: [rows[0]!.itemRef], referenceB: [rows[1]!.itemRef] })
    if (kind === 'unavailable') expect(await promise).toEqual({ supported: false })
    else await expect(promise).rejects.toThrow()
  })
  it('rejects shared A/B references and oversized pages before evidence requests', async () => {
    const f = fixture(), row = (await f.service.recordingDay(f.date)).transcript.items[0]!
    await expect(f.service.recordingSpeakerEvidence({ itemRefs: [row.itemRef], referenceA: [row.itemRef], referenceB: [row.itemRef] })).rejects.toThrow()
    await expect(f.service.recordingSpeakerEvidence({ itemRefs: Array(51).fill(row.itemRef), referenceA: [row.itemRef], referenceB: [] })).rejects.toThrow()
    expect(f.post.mock.calls.filter(([path]) => path.endsWith('/speaker-evidence/compare'))).toHaveLength(0)
  })
})

describe('group consistency adapter', () => {
  it('uses precise anchors for full groups without limiting coverage to the requested page', async () => {
    const f = fixture(), rows = (await f.service.recordingDay(f.date)).transcript.items
    const result = await f.service.recordingSpeakerConsistency({ anchorRefs: [rows[0]!.itemRef], itemRefs: [rows[1]!.itemRef] })
    const call = f.post.mock.calls.find(([path]) => path.endsWith('/speaker-evidence/consistency'))!
    expect(call[1]).toMatchObject({ groups: [{ client_index: 0, session_id: 'session', child_id: 'child', item_index: 0, start_at: 0, end_at: 4000 }], items: [{ client_index: 0, item_index: 1, start_at: 5000, end_at: 9000 }] })
    expect(result).toMatchObject({ groups: [{ anchorRef: rows[0]!.itemRef, totalCount: 10, items: [{ itemRef: rows[1]!.itemRef }] }] })
  })
  it.each(['unavailable', 'fail', 'invalid', 'switchAccount'] as const)('handles %s without turning missing data into a low score', async kind => {
    const f = fixture(), rows = (await f.service.recordingDay(f.date)).transcript.items
    f.state[kind] = true
    const promise = f.service.recordingSpeakerConsistency({ anchorRefs: [rows[0]!.itemRef], itemRefs: [] })
    if (kind === 'unavailable') expect(await promise).toEqual({ supported: false })
    else await expect(promise).rejects.toThrow()
  })
  it('rejects multi-group deviation requests and oversized summary batches before sending', async () => {
    const f = fixture(), rows = (await f.service.recordingDay(f.date)).transcript.items
    await expect(f.service.recordingSpeakerConsistency({ anchorRefs: rows.map(row => row.itemRef), itemRefs: [rows[0]!.itemRef] })).rejects.toThrow()
    await expect(f.service.recordingSpeakerConsistency({ anchorRefs: Array(101).fill(rows[0]!.itemRef), itemRefs: [] })).rejects.toThrow()
    expect(f.post.mock.calls.filter(([path]) => path.endsWith('/speaker-evidence/consistency'))).toHaveLength(0)
  })
})
