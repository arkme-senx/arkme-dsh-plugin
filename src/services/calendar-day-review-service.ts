import { assertDayReviewEnvelope, emptyDayReviewState, parseDayReviewQuery, parseDayReviewResult, parseDayReviewState, reviewKinds, reviewObject, reviewText, type DayReviewQuery } from '../calendar-day-review.js'
import { parseReviewPromptConfig, parseReviewPromptSupport, sameReviewPrompts, type ReviewPromptSupport } from '../calendar-day-review-prompts.js'
import type { ExploreSource } from '../explore-contract.js'
import type { ArkmeCallDetail } from '../types.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type { RecordingService } from './recording-service.js'
import type { RecordService } from './record-service.js'
import type { SourceService } from './source-service.js'
import type { CallHistoryService } from './call-history-service.js'
import type { ArkmePrivacyVisibilityService } from './privacy-visibility.js'
import { ArkmePluginError, ServiceRuntime, objectValue } from './service.js'

export type DayReviewOpenSource = ExploreSource | { kind: 'call'; detail: ArkmeCallDetail }
const base = '/api/v1/day-review'
const unavailable = () => new ArkmePluginError('calendar-review-unavailable', '日历回顾服务尚未接通', false, 501)

/** Provider owns material collection, authorization and durable generation. */
export class CalendarDayReviewService {
  private epoch = 0
  private capabilityCache: { scope: string; until: number; enabled: boolean } | undefined
  private readonly unsubscribe: () => void
  constructor(private readonly runtime: ServiceRuntime,
    private readonly recording: Pick<RecordingService, 'exploreRecordingEvidence'>,
    private readonly records: Pick<RecordService, 'personalRecordDetail'>,
    private readonly sources: Pick<SourceService, 'searchTargetSource'>,
    private readonly calls: Pick<CallHistoryService, 'arrangementCallDetail'>,
    private readonly privacy: Pick<ArkmePrivacyVisibilityService, 'lockedRecordUids'>) {
    this.unsubscribe = runtime.subscribeAccountScope(() => { this.epoch++ })
  }
  async generationSupported(signal?: AbortSignal): Promise<boolean> {
    try {
      const session = await this.runtime.requireSession(), scope = await this.accountScope(), epoch = this.epoch
      if (this.capabilityCache?.scope === scope && this.capabilityCache.until > Date.now()) return this.capabilityCache.enabled
      const capability = await this.capabilities(session, signal)
      if (epoch !== this.epoch) return false
      const enabled = capability !== null && capability.generation_enabled !== false
      this.capabilityCache = { scope, until: Date.now() + 30000, enabled }
      return enabled
    } catch { return false }
  }
  async accountScope() { const session = await this.runtime.requireSession(); return `${this.runtime.config.environment}:${session.userId}` }
  dispose(): void { this.epoch++; this.unsubscribe() }
  private async guard(q: DayReviewQuery, session: ArkmeSessionCredentials, epoch: number, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const current = await this.runtime.requireSession()
    if (epoch !== this.epoch || current.userId !== session.userId || q.accountScope !== `${this.runtime.config.environment}:${current.userId}`) {
      throw new ArkmePluginError('calendar-review-account-changed', '账号已变化，请重新打开日历', false, 409)
    }
  }
  private async context(input: unknown, signal?: AbortSignal) {
    const query = parseDayReviewQuery(input), epoch = this.epoch, session = await this.runtime.requireSession()
    await this.guard(query, session, epoch, signal)
    return { query, epoch, session }
  }
  private body(q: DayReviewQuery) { return { schema_version: 1, scope: 'calendar_day', date: q.bucketDate, time_zone: q.timezone } }
  private request(path: string, body: Record<string, unknown>, session: ArkmeSessionCredentials, signal?: AbortSignal, write = false) {
    return this.runtime.authenticatedAudioPost<unknown>(`${base}/${path}`, body, session, signal,
      { lane: write ? 'write' : 'interactive-read', bypassCache: true, cacheMs: 0 })
  }
  private async capabilities(session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
    let value: unknown
    try { value = await this.request('capabilities', { schema_version: 1, scope: 'calendar_day' }, session, signal) }
    catch (error) {
      if (error instanceof ArkmePluginError && [404, 501].includes(error.upstreamStatus ?? error.httpStatus)) return null
      throw error
    }
    const v = reviewObject(value)
    if (v.supported === false) return null
    if (v.supported !== true || v.schema_version !== 1 || v.scope !== 'calendar_day'
      || v.durable_jobs !== true || v.source_navigation !== true || v.idempotent_create !== true
      || reviewKinds(v.source_kinds).length < 1) throw new ArkmePluginError('calendar-review-contract', '日历回顾服务版本暂不兼容，请更新后重试', false, 409)
    return v
  }
  async state(input: unknown, signal?: AbortSignal) {
    const { query, epoch, session } = await this.context(input, signal)
    const supported = await this.capabilities(session, signal)
    await this.guard(query, session, epoch, signal)
    if (!supported) return emptyDayReviewState()
    const value = await this.request('state', this.body(query), session, signal)
    await this.guard(query, session, epoch, signal)
    return { ...parseDayReviewState(value, query), sourceKinds: reviewKinds(supported.source_kinds), generationEnabled: supported.generation_enabled !== false }
  }
  async prepare(input: unknown, signal?: AbortSignal) {
    const v = reviewObject(input), { query, epoch, session } = await this.context(input, signal)
    const sources = reviewKinds(v.sourceKinds), requestId = reviewText(v.requestId, 100)
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)) throw new Error('生成请求标识无效')
    const promptConfig = v.promptConfig === undefined ? undefined : parseReviewPromptConfig(v.promptConfig)
    const reuseResultId = v.reuseResultId === undefined ? undefined : reviewText(v.reuseResultId)
    const capability = await this.capabilities(session, signal)
    if (!capability || capability.generation_enabled === false) throw unavailable()
    if (sources.some(source => !reviewKinds(capability.source_kinds).includes(source))) throw new Error('当前 Provider 不支持所选来源')
    if ((promptConfig && capability.prompt_config_v1 !== true) || (reuseResultId && capability.snapshot_reuse !== true)) {
      throw new ArkmePluginError('calendar-review-prompt-unsupported', '服务尚不支持自定义提示词或复用资料，未提交生成', false, 409)
    }
    await this.guard(query, session, epoch, signal)
    const outputs = v.kinds === undefined ? ['summary', 'timeline'] : v.kinds
    if (!Array.isArray(outputs) || outputs.length === 0 || new Set(outputs).size !== outputs.length || outputs.some(x => x !== 'summary' && x !== 'timeline')) throw new Error('生成类型无效')
    const routeKey = v.routeKey === undefined ? undefined : reviewText(v.routeKey, 200)
    return { ...query, sourceKinds: sources, requestId, kinds: outputs, ...(routeKey ? { routeKey } : {}), ...(promptConfig ? { promptConfig } : {}), ...(reuseResultId ? { reuseResultId } : {}) }
  }
  async create(input: unknown, signal?: AbortSignal) {
    const prepared = await this.prepare(input, signal)
    const { query, epoch, session } = await this.context(prepared, signal)
    const { sourceKinds: sources, requestId, promptConfig, reuseResultId, kinds, routeKey } = prepared
    const value = await this.request('create', { ...this.body(query), source_kinds: sources, request_id: requestId, outputs: kinds,
      ...(routeKey ? { route_key: routeKey } : {}), ...(promptConfig ? { prompt_config: promptConfig } : {}),
      ...(reuseResultId ? { reuse_result_id: reuseResultId } : {}) }, session, signal, true)
    await this.guard(query, session, epoch, signal)
    const state = parseDayReviewState(value, query)
    if (promptConfig || reuseResultId) {
      const receipt = reviewObject(reviewObject(value).submission)
      if (receipt.request_id !== requestId || (promptConfig && !sameReviewPrompts(parseReviewPromptConfig(receipt.prompt_config), promptConfig))
        || (reuseResultId && receipt.reuse_result_id !== reuseResultId)) throw new Error('生成配置尚未确认，请核对同一次请求')
    }
    if (!state.job && !state.result) throw new Error('生成请求未返回任务，请核对后重试')
    return state
  }
  async prompts(input: unknown, signal?: AbortSignal): Promise<ReviewPromptSupport> {
    const { query, epoch, session } = await this.context(input, signal)
    const capability = await this.capabilities(session, signal)
    await this.guard(query, session, epoch, signal)
    if (!capability || capability.prompt_config_v1 !== true) return { supported: false, snapshotReuse: false }
    const value = reviewObject(await this.request('prompts', this.body(query), session, signal))
    await this.guard(query, session, epoch, signal)
    assertDayReviewEnvelope(value, query)
    const support = parseReviewPromptSupport(value)
    return { ...support, snapshotReuse: support.snapshotReuse && capability.snapshot_reuse === true }
  }
  async result(input: unknown, signal?: AbortSignal) {
    const v = reviewObject(input), { query, epoch, session } = await this.context(input, signal)
    const id = reviewText(v.resultId), value = await this.request('result', { ...this.body(query), result_id: id }, session, signal)
    await this.guard(query, session, epoch, signal)
    const result = parseDayReviewResult(value, query)
    if (result.id !== id) throw new Error('日历回顾版本已变化，请重新选择')
    return result
  }
  async source(input: unknown, signal?: AbortSignal): Promise<DayReviewOpenSource> {
    const v = reviewObject(input), { query, epoch, session } = await this.context(input, signal)
    const resultId = reviewText(v.resultId), sourceRef = reviewText(v.sourceRef, 4096)
    const data = reviewObject(await this.request('source', { ...this.body(query), result_id: resultId, source_ref: sourceRef }, session, signal))
    await this.guard(query, session, epoch, signal)
    assertDayReviewEnvelope(data, query)
    if (data.available !== true || data.result_id !== resultId || data.source_ref !== sourceRef) {
      throw new ArkmePluginError('calendar-review-source-unavailable', '原始内容已删除、已变化或当前不可访问', false, 404)
    }
    // The owner rechecks source membership and access on every open. A citation is not an access grant.
    const owner = reviewObject(data.owner_ref)
    let result: DayReviewOpenSource
    if (owner.provider === 'audio') result = await this.recording.exploreRecordingEvidence(owner, reviewText(data.quote, 10000), signal)
    else if (owner.provider === 'call') result = { kind: 'call', detail: await this.calls.arrangementCallDetail(reviewText(owner.room_id), signal) }
    else if (owner.provider === 'record') {
      const uid = reviewText(owner.record_uid)
      const raw = await this.runtime.authenticatedPost<Record<string, unknown>>('/api/v1/records/detail', { record_uid: uid }, session, signal, { lane: 'interactive-read', bypassCache: true })
      const core = objectValue(raw.record_core)
      if (core.record_uid !== uid || Number(core.content_access_state ?? raw.content_access_state) !== 1 || Number(core.status) !== 1
        || (await this.privacy.lockedRecordUids(session, signal)).has(uid)) throw new ArkmePluginError('calendar-review-source-restricted', '原文已删除或当前无权查看', false, 403)
      if ([3, 4].includes(Number(core.origin_kind))) {
        const source = await this.sources.searchTargetSource(3, reviewText(core.origin_container_ref), '', signal)
        if (!source || !Number.isSafeInteger(core.send_at) || Number(core.send_at) <= 0) throw new Error('原消息暂不可定位')
        result = { kind: 'conversation', source, itemUid: uid, sendAtMillis: Number(core.send_at) }
      } else result = { kind: 'record', item: await this.records.personalRecordDetail(uid, signal) }
    } else if (owner.provider === 'chat') {
      // Non-record-backed chat messages are resolved by the owner before reaching this adapter.
      const source = await this.sources.searchTargetSource(3, reviewText(owner.session_uid), '', signal)
      if (!source || !Number.isSafeInteger(owner.send_at) || Number(owner.send_at) <= 0) throw new Error('原消息暂不可定位')
      result = { kind: 'conversation', source, itemUid: reviewText(owner.message_uid), sendAtMillis: Number(owner.send_at) }
    } else throw new Error('这条来源暂不支持定位')
    await this.guard(query, session, epoch, signal)
    return result
  }
}
