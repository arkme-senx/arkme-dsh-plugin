import { describe, expect, it, vi } from 'vitest'
import { CalendarDayReviewService } from '../src/services/calendar-day-review-service.js'
import { ArkmePluginError, type ServiceRuntime } from '../src/services/service.js'

const query = { accountScope: 'prod:7', bucketDate: '2026-10-15', timezone: 'Asia/Shanghai' }
const envelope = { schema_version: 1, scope: 'calendar_day', date: query.bucketDate, time_zone: query.timezone }
const capability = { supported: true, schema_version: 1, scope: 'calendar_day', durable_jobs: true, source_navigation: true, idempotent_create: true, source_kinds: ['chat', 'location', 'self', 'call', 'audio'] }
const idle = { ...envelope, result: null, job: null, versions: [], has_new_content: false }
function fixture() {
  let userId = 7, change = () => {}
  const post = vi.fn(async (path: string, _body: unknown, _session: unknown, _signal: unknown, _options: unknown): Promise<unknown> => path.endsWith('/capabilities') ? capability : idle)
  const original = vi.fn()
  const runtime = { config: { environment: 'prod' }, requireSession: async () => ({ userId }), authenticatedAudioPost: post, authenticatedPost: original,
    subscribeAccountScope: (fn: () => void) => { change = fn; return () => {} } } as unknown as ServiceRuntime
  const recording = { exploreRecordingEvidence: vi.fn() }, records = { personalRecordDetail: vi.fn() }, sources = { searchTargetSource: vi.fn() }, calls = { arrangementCallDetail: vi.fn() }, privacy = { lockedRecordUids: vi.fn(async () => new Set<string>()) }
  const service = new CalendarDayReviewService(runtime, recording, records, sources, calls, privacy)
  return { service, post, original, recording, records, sources, calls, privacy, change: () => { userId = 8; change() } }
}
describe('calendar review owner adapter', () => {
  it.each([404, 501])('reports explicit HTTP %s capability absence without using recording generation', async status => {
    const f = fixture(); f.post.mockRejectedValue(new ArkmePluginError('upstream', 'absent', false, status))
    expect(await f.service.state(query)).toMatchObject({ supported: false })
    await expect(f.service.create({ ...query, requestId: '00000000-0000-4000-8000-000000000000', sourceKinds: ['audio'] })).rejects.toThrow('尚未接通')
    expect(f.post.mock.calls.every(call => call[0].endsWith('/day-review/capabilities'))).toBe(true)
  })
  it.each([401, 503])('keeps HTTP %s failures visible rather than declaring unsupported', async status => {
    const f = fixture(); f.post.mockRejectedValue(new ArkmePluginError('upstream', 'read failed', false, status))
    await expect(f.service.state(query)).rejects.toThrow('read failed')
  })
  it('requires the full capability contract and scope', async () => {
    const f = fixture(); f.post.mockResolvedValue({ ...capability, source_navigation: false })
    await expect(f.service.state(query)).rejects.toThrow('版本暂不兼容')
    f.post.mockResolvedValueOnce(capability).mockResolvedValueOnce({ ...idle, date: '2026-10-14' })
    await expect(f.service.state(query)).rejects.toThrow('格式不完整')
  })
  it('submits only the source selection and idempotency key, never visible excerpts', async () => {
    const f = fixture(), requestId = '00000000-0000-4000-8000-000000000000'
    f.post.mockResolvedValueOnce(capability).mockResolvedValueOnce({ ...idle, job: { id: 'job', status: 'collecting' } })
    expect(await f.service.create({ ...query, sourceKinds: ['self', 'audio'], requestId, transcripts: 'do not forward' })).toMatchObject({ job: { id: 'job' } })
    expect(f.post).toHaveBeenLastCalledWith('/api/v1/day-review/create', { ...envelope, source_kinds: ['self', 'audio'], outputs: ['summary', 'timeline'], request_id: requestId }, expect.any(Object), undefined, expect.objectContaining({ lane: 'write' }))
  })
  it('blocks account changes before reads and after delayed replies', async () => {
    const f = fixture()
    await expect(f.service.state({ ...query, accountScope: 'prod:8' })).rejects.toThrow('账号已变化')
    expect(f.post).not.toHaveBeenCalled()
    f.post.mockImplementationOnce(async () => { f.change(); return capability })
    await expect(f.service.state(query)).rejects.toThrow('账号已变化')
    expect(f.post).toHaveBeenCalledTimes(1)
  })
  it('binds source opens to result and source identity and does not navigate unavailable sources', async () => {
    const f = fixture()
    f.post.mockResolvedValue({ ...envelope, available: true, result_id: 'other', source_ref: 'ref', owner_ref: { provider: 'audio' } })
    await expect(f.service.source({ ...query, resultId: 'result', sourceRef: 'ref' })).rejects.toThrow('不可访问')
    expect(f.recording.exploreRecordingEvidence).not.toHaveBeenCalled()
  })
  it('uses the precise recording resolver instead of searching for similar transcript text', async () => {
    const f = fixture(), owner = { provider: 'audio', container_id: 'session', child_id: 'child', item_ordinal: 7, transcript_source: 'system', start_at: 1792036800000 }
    f.post.mockResolvedValue({ ...envelope, available: true, result_id: 'result', source_ref: 'ref', owner_ref: owner, quote: '该片段的原始文字' })
    f.recording.exploreRecordingEvidence.mockResolvedValue({ kind: 'recording', dateStamp: 1, focusItemId: 'clip', items: [] })
    expect(await f.service.source({ ...query, resultId: 'result', sourceRef: 'ref' })).toMatchObject({ focusItemId: 'clip' })
    expect(f.recording.exploreRecordingEvidence).toHaveBeenCalledWith(owner, '该片段的原始文字', undefined)
  })
  it('rechecks personal record privacy before opening a citation', async () => {
    const f = fixture()
    f.post.mockResolvedValue({ ...envelope, available: true, result_id: 'result', source_ref: 'ref', owner_ref: { provider: 'record', record_uid: 'note' } })
    f.original.mockResolvedValue({ record_core: { record_uid: 'note', content_access_state: 1, status: 1, origin_kind: 1 } })
    f.privacy.lockedRecordUids.mockResolvedValue(new Set(['note']))
    await expect(f.service.source({ ...query, resultId: 'result', sourceRef: 'ref' })).rejects.toThrow('无权查看')
    expect(f.records.personalRecordDetail).not.toHaveBeenCalled()
  })
})

describe('calendar prompt capability and immutable request adapter', () => {
  const config = { baseVersion: 'v1', summary: { instruction: 'summary', chunk: 'chunk', aggregate: 'aggregate' }, timeline: { instruction: 'timeline', chunk: 'chunk', aggregate: 'aggregate' } }
  const enhanced = { ...capability, prompt_config_v1: true, snapshot_reuse: true }
  const request = { ...query, requestId: '00000000-0000-4000-8000-000000000001', sourceKinds: ['audio'], promptConfig: config, reuseResultId: 'result-1' }
  it('does not send custom prompts to a service that could silently ignore them', async () => {
    const f = fixture()
    expect(await f.service.prompts(query)).toEqual({ supported: false, snapshotReuse: false })
    await expect(f.service.create(request)).rejects.toThrow('未提交生成')
    expect(f.post.mock.calls.every(c => c[0].endsWith('/capabilities'))).toBe(true)
  })
  it('loads only owner supplied defaults and rejects mixed account/default responses', async () => {
    const f = fixture()
    f.post.mockResolvedValueOnce(enhanced).mockResolvedValueOnce({ ...envelope, supported: true, snapshot_reuse: true, defaults: { ...config, constraints: 'fixed provenance' } })
    expect(await f.service.prompts(query)).toMatchObject({ supported: true, defaults: { baseVersion: 'v1', constraints: 'fixed provenance' } })
    f.post.mockResolvedValueOnce(enhanced).mockImplementationOnce(async () => { f.change(); return {} })
    await expect(f.service.prompts(query)).rejects.toThrow('账号已变化')
  })
  it('requires acknowledgement of the exact prompt config and material reuse', async () => {
    const f = fixture(), job = { id: 'job', status: 'collecting' }
    f.post.mockResolvedValueOnce(enhanced).mockResolvedValueOnce({ ...idle, job, submission: { request_id: request.requestId, prompt_config: config, reuse_result_id: 'result-1' } })
    expect(await f.service.create(request)).toMatchObject({ job: { id: 'job' } })
    expect(f.post).toHaveBeenLastCalledWith('/api/v1/day-review/create', expect.objectContaining({ prompt_config: config, reuse_result_id: 'result-1' }), expect.any(Object), undefined, expect.any(Object))
    f.post.mockResolvedValueOnce(enhanced).mockResolvedValueOnce({ ...idle, job, submission: { request_id: request.requestId, prompt_config: { ...config, baseVersion: 'different' }, reuse_result_id: 'result-1' } })
    await expect(f.service.create(request)).rejects.toThrow('配置尚未确认')
    f.post.mockResolvedValueOnce(enhanced).mockResolvedValueOnce({ ...idle, job })
    await expect(f.service.create(request)).rejects.toThrow()
  })
  it('rejects invalid custom text before any request', async () => {
    const f = fixture()
    await expect(f.service.create({ ...request, promptConfig: { ...config, summary: { ...config.summary, instruction: '' } } })).rejects.toThrow()
    expect(f.post).not.toHaveBeenCalled()
  })
})
