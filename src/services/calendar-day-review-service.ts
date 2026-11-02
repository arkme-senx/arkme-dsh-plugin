import { parseDayReviewModels, assertDayReviewEnvelope, emptyDayReviewState, parseDayReviewQuery, parseDayReviewResult, parseDayReviewState, reviewKinds, reviewObject, reviewText, type DayReviewQuery, type DayReviewOriginalEvidence, type DayReviewEvidenceQuery } from '../calendar-day-review.js'
import { parseReviewPromptConfig, parseReviewPromptSupport, sameReviewPrompts, type ReviewPromptSupport } from '../calendar-day-review-prompts.js'
import type { ExploreSource } from '../explore-contract.js'
import type { ArkmeCallDetail, ArkmeRecordingWindow } from '../types.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type { RecordingService } from './recording-service.js'
import type { RecordService } from './record-service.js'
import type { SourceService } from './source-service.js'
import type { CallHistoryService } from './call-history-service.js'
import type { ArkmePrivacyVisibilityService } from './privacy-visibility.js'
import { ArkmePluginError, ArkmeUpstreamResponseError, ServiceRuntime, objectValue } from './service.js'

export type DayReviewOpenSource = ExploreSource | { kind: 'call'; detail: ArkmeCallDetail } | { kind: 'evidence'; evidence: DayReviewOriginalEvidence }
const base = '/api/v1/day-review'
const unavailable = () => new ArkmePluginError('calendar-review-unavailable', '日历回顾服务尚未接通', false, 501)

/** One account-scoped owner for UI, SDK and tools. */
export class CalendarDayReviewService {
  private epoch = 0
  private readonly unsubscribe: () => void
  constructor(private readonly runtime: ServiceRuntime,
    private readonly recording: Pick<RecordingService, 'exploreRecordingEvidence'>,
    private readonly records: Pick<RecordService, 'personalRecordDetail'>,
    private readonly sources: Pick<SourceService, 'searchTargetSource'>,
    private readonly calls: Pick<CallHistoryService, 'arrangementCallDetail'>,
    private readonly privacy: Pick<ArkmePrivacyVisibilityService, 'lockedRecordUids'>) {
    this.unsubscribe = runtime.subscribeAccountScope(() => { this.epoch++ })
  }
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
  async confirmationAccount(input: unknown, signal?: AbortSignal): Promise<string> {
    const { query, epoch } = await this.context(input, signal)
    return `${query.accountScope}:${epoch}`
  }
  private body(q: DayReviewQuery) { return { schema_version: 1, scope: 'calendar_day', date: q.bucketDate, time_zone: q.timezone } }
  private request(path: string, body: Record<string, unknown>, session: ArkmeSessionCredentials, signal?: AbortSignal, write = false) {
    return this.runtime.authenticatedIntelligentPost<unknown>(`${base}/${path}`, body, session, signal,
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
      || v.resume !== true || v.freshness_v1 !== true || v.durable_jobs !== true || v.source_navigation !== true || v.idempotent_create !== true
      || reviewKinds(v.source_kinds).length !== 5) throw new ArkmePluginError('calendar-review-contract', '日历回顾服务版本暂不兼容，请更新后重试', false, 409)
    return v
  }
  async state(input: unknown, signal?: AbortSignal) {
    const { query, epoch, session } = await this.context(input, signal)
    const supported = await this.capabilities(session, signal)
    await this.guard(query, session, epoch, signal)
    if (!supported) return emptyDayReviewState()
    const value = await this.request('state', this.body(query), session, signal)
    await this.guard(query, session, epoch, signal)
    const state = parseDayReviewState(value, query)
    const pending = await this.pending(query)
    if (pending) state.pendingRequestId = reviewText(pending.requestId)
    await this.guard(query, session, epoch, signal)
    return state
  }
  private day(q: DayReviewQuery) { return JSON.stringify([q.bucketDate, q.timezone]) }
  private storage() {
    const store = this.runtime.stateStore
    if (!store?.readDayReviewPending || !store.prepareDayReview || !store.acknowledgeDayReview) throw new ArkmePluginError('calendar-review-storage', '日回顾提交恢复存储不可用，未创建任务', false, 503)
    return { read: store.readDayReviewPending.bind(store), prepare: store.prepareDayReview.bind(store), acknowledge: store.acknowledgeDayReview.bind(store) }
  }
  private async pending(q: DayReviewQuery): Promise<Record<string, unknown> | undefined> {
    const value = await this.storage().read(q.accountScope, this.day(q))
    if (value === undefined) return undefined
    const pending = reviewObject(value), old = parseDayReviewQuery(pending)
    if (JSON.stringify(old) !== JSON.stringify(q)) throw new Error('提交恢复记录的账号或日期不匹配')
    return pending
  }
  async create(input: unknown, signal?: AbortSignal) {
    const v = reviewObject(input), { query, epoch, session } = await this.context(input, signal)
    const sources = reviewKinds(v.sourceKinds), requestId = reviewText(v.requestId, 100)
    if (!/^[a-zA-Z0-9-]{16,100}$/.test(requestId)) throw new Error('生成请求标识无效')
    const promptConfig = v.promptConfig === undefined ? undefined : parseReviewPromptConfig(v.promptConfig)
    const modelCode = v.modelCode === undefined ? undefined : reviewText(v.modelCode, 100)
    const reuseResultId = v.reuseResultId === undefined ? undefined : reviewText(v.reuseResultId)
    const request = { ...query, sourceKinds: sources, requestId, ...(modelCode ? { modelCode } : {}), ...(promptConfig ? { promptConfig } : {}), ...(reuseResultId ? { reuseResultId } : {}) }
    const pending = await this.pending(query)
    if (!pending) {
      const capability = await this.capabilities(session, signal)
      if (!capability) throw unavailable()
      if (modelCode && capability.model_selection_v1 !== true) throw new ArkmePluginError('calendar-review-model-unsupported', '服务尚不支持自选模型，未提交生成', false, 409)
      if ((promptConfig && capability.prompt_config_v1 !== true) || (reuseResultId && capability.snapshot_reuse !== true)) throw new ArkmePluginError('calendar-review-prompt-unsupported', '服务尚不支持自定义提示词或复用资料，未提交生成', false, 409)
    }
    await this.guard(query, session, epoch, signal)
    await this.storage().prepare(query.accountScope, this.day(query), request)
    await this.guard(query, session, epoch, signal)
    let value: unknown
    try {
      value = await this.request('create', { ...this.body(query), source_kinds: sources, request_id: requestId, outputs: ['summary', 'timeline'], ...(modelCode ? { model_code: modelCode } : {}), ...(promptConfig ? { prompt_config: promptConfig } : {}), ...(reuseResultId ? { reuse_result_id: reuseResultId } : {}) }, session, signal, true)
    } catch (error) {
      // A definite domain rejection is not a lost acknowledgement. Unknown
      // transport/settlement outcomes keep the immutable request for reconciliation.
      const rejection = error instanceof ArkmeUpstreamResponseError ? String(objectValue(error.responseData).review_error) : ''
      if (['model_unavailable', 'invalid_request', 'day_busy', 'request_conflict', 'source_changed', 'source_revoked', 'not_found', 'material_too_large'].includes(rejection)) {
        await this.storage().acknowledge(query.accountScope, this.day(query), requestId)
        throw new ArkmePluginError('calendar-review-not-accepted', rejection === 'model_unavailable' ? '所选模型暂不可用，本次生成未受理，请稍后重试' : rejection === 'material_too_large' ? '提示词过长，本次生成未受理，请缩短提示词后重试' : '本次生成未受理，请检查日期、资料权限或进行中的任务后重试', false, 409)
      }
      throw error
    }
    await this.guard(query, session, epoch, signal)
    const state = parseDayReviewState(value, query), receipt = reviewObject(reviewObject(value).submission)
    if (receipt.request_id !== requestId || typeof receipt.job_id !== 'string'
      || JSON.stringify(reviewKinds(receipt.source_kinds)) !== JSON.stringify(sources)
      || JSON.stringify(receipt.outputs) !== JSON.stringify(['summary', 'timeline'])
      || (promptConfig && !sameReviewPrompts(parseReviewPromptConfig(receipt.prompt_config), promptConfig))
      || (receipt.model_code ?? '') !== (modelCode ?? '')
      || (receipt.reuse_result_id ?? '') !== (reuseResultId ?? '')
      || (state.job && state.job.id !== receipt.job_id) || (state.result && state.result.id !== receipt.job_id)) throw new Error('生成配置尚未确认，请核对同一次请求')
    parseReviewPromptConfig(receipt.prompt_config)
    await this.storage().acknowledge(query.accountScope, this.day(query), requestId)
    return state
  }
  async reconcile(input: unknown, signal?: AbortSignal) {
    const { query } = await this.context(input, signal), pending = await this.pending(query)
    if (!pending) return this.state(query, signal)
    return this.create(pending, signal)
  }
  async resume(input: unknown, signal?: AbortSignal) {
    const v = reviewObject(input), { query, session, epoch } = await this.context(input, signal), jobId = reviewText(v.jobId)
    const value = reviewObject(await this.request('resume', { ...this.body(query), job_id: jobId }, session, signal, true))
    await this.guard(query, session, epoch, signal); assertDayReviewEnvelope(value, query)
    if (value.job_id !== jobId || !['queued', 'running', 'succeeded'].includes(String(value.status))) throw new Error('恢复任务尚未确认，请检查当天任务状态')
    return this.state(query, signal)
  }
  async evidence(input: DayReviewEvidenceQuery, signal?: AbortSignal): Promise<DayReviewOriginalEvidence> {
    const { query, session, epoch } = await this.context(input, signal)
    const v = reviewObject(await this.request('evidence', { ...this.body(query), result_id: reviewText(input.resultId), source_ref: reviewText(input.sourceRef, 4096) }, session, signal))
    await this.guard(query, session, epoch, signal); assertDayReviewEnvelope(v, query)
    if (v.ref !== input.sourceRef || v.result_id !== input.resultId) throw new Error('来源引用不匹配')
    const time = (value: unknown) => value === null ? null : typeof value === 'number' && Number.isSafeInteger(value) ? value : (() => { throw new Error('来源时间无效') })()
    return { ref: input.sourceRef, resultId: input.resultId, kind: reviewKinds([v.kind])[0]!, subtype: reviewText(v.subtype), label: reviewText(v.label), text: reviewText(v.text, 32 * 1024 * 1024), startAtMillis: time(v.start_at), endAtMillis: time(v.end_at) }
  }
  async models(input: unknown, signal?: AbortSignal) {
    const { query, epoch, session } = await this.context(input, signal)
    const capability = await this.capabilities(session, signal)
    await this.guard(query, session, epoch, signal)
    if (!capability || capability.model_selection_v1 !== true) throw new ArkmePluginError('calendar-review-model-unsupported', '服务尚不支持自选模型，请更新服务后重试', false, 409)
    const value = await this.request('models', this.body(query), session, signal)
    await this.guard(query, session, epoch, signal)
    return parseDayReviewModels(value, query)
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
    const material = reviewObject(data.owner_ref), owner = reviewObject(material.locator)
    let result: DayReviewOpenSource
    if (material.kind === 'audio') result = await this.recording.exploreRecordingEvidence({ container_id: owner.session_id, child_id: owner.child_id, item_ordinal: owner.item_index, transcript_source: owner.transcript_source, start_at: owner.start_at }, reviewText(owner.quote, 10000), signal, reviewObject(material.window) as unknown as ArkmeRecordingWindow)
    else if (material.kind === 'call' && material.subtype === 'trtc') result = { kind: 'call', detail: await this.calls.arrangementCallDetail(reviewText(owner.id), signal, { ...(typeof material.start_at === 'number' ? { startMillis: material.start_at } : {}), quote: reviewText(material.text, 32 * 1024 * 1024) }) }
    else if (material.kind === 'call') result = { kind: 'evidence', evidence: await this.evidence({ ...query, resultId, sourceRef }, signal) }
    else if (['self', 'location'].includes(String(material.kind))) {
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
    } else if (material.kind === 'chat') {
      // Non-record-backed chat messages are resolved by the owner before reaching this adapter.
      const source = await this.sources.searchTargetSource(3, reviewText(owner.chat_session_uid), '', signal)
      if (!source || !Number.isSafeInteger(material.start_at) || Number(material.start_at) <= 0) throw new Error('原消息暂不可定位')
      result = { kind: 'conversation', source, itemUid: reviewText(owner.relation_uid), sendAtMillis: Number(material.start_at) }
    } else throw new Error('这条来源暂不支持定位')
    await this.guard(query, session, epoch, signal)
    return result
  }
}
