import { EncryptedReferenceCodec } from '../encrypted-reference.js'
import type { WorldPublishOrigin, WorldPublishSourceDraft } from '../world-publish-source.js'
import type { WorldSuggestion, WorldSuggestionJob, WorldSuggestionsRequest, WorldSuggestionsState } from '../world-suggestions-contract.js'
import { ArkmePluginError, ArkmeUpstreamResponseError, objectValue as obj, type ServiceRuntime } from './service.js'

const invalid = () => new ArkmePluginError('world-suggestion-invalid', '分享建议已变化或账号已切换，请重新打开', false, 409)
const unavailable = () => new ArkmePluginError('world-suggestion-unavailable', '分享建议服务尚未就绪，请稍后重试', true, 503)
const text = (v: unknown, max: number) => { if (typeof v !== 'string' || v.length > max) throw invalid(); return v }
const count = (v: unknown, max = 5000) => { if (!Number.isSafeInteger(v) || Number(v) < 0 || Number(v) > max) throw invalid(); return Number(v) }
const jobID = (v: unknown) => { const s = text(v, 128); if (!/^world-suggestions:[A-Za-z0-9_-]+$/.test(s)) throw invalid(); return s }
const candidateID = (v: unknown) => { const s = text(v, 64); if (!/^[a-f0-9]{64}$/.test(s)) throw invalid(); return s }
interface Ports {
  selfSource(signal?: AbortSignal): Promise<string>
  source(sourceRef: string, uid: string, signal?: AbortSignal): Promise<WorldPublishSourceDraft>
}

/** Private analysis owner shared by UI, Tools and SDK; publication stays in World. */
export class WorldSuggestionsService {
  private readonly codec: EncryptedReferenceCodec
  private epoch = 0
  private readonly unsubscribe: () => void
  constructor(private readonly runtime: ServiceRuntime, private readonly ports: Ports) {
    this.codec = new EncryptedReferenceCodec(() => runtime.stateStore.uniqueCode(), invalid)
    this.unsubscribe = runtime.subscribeAccountScope(() => { this.epoch++ })
  }
  dispose() { this.epoch++; this.unsubscribe() }
  private async context(account: string, signal?: AbortSignal) {
    const epoch = this.epoch, session = await this.runtime.requireSession()
    const guard = async () => {
      signal?.throwIfAborted()
      const current = await this.runtime.requireSession()
      if (epoch !== this.epoch || current.userId !== session.userId || account !== `${this.runtime.config.environment}:${current.userId}`) throw invalid()
    }
    await guard()
    const post = async (path: string, body: Record<string, unknown>, write = false) => {
      await guard()
      let result: unknown
      try { result = await this.runtime.authenticatedIntelligentPost(`/api/v1/world-suggestions/${path}`, body, session, signal, { lane: write ? 'write' : 'interactive-read', bypassCache: true, cacheMs: 0, requestTimeoutMs: 18_000 }) }
      catch (e) { if (e instanceof ArkmePluginError && [404, 501, 503].includes(e.upstreamStatus ?? e.httpStatus)) throw unavailable(); throw e }
      await guard(); return obj(result)
    }
    return { guard, post }
  }
  private seal(account: string, job: string, key?: string) { return this.codec.seal('world-suggestion', { account, job, ...(key ? { key } : {}) }) }
  private async open(account: string, ref: string, candidate: boolean) {
    const v = await this.codec.open('world-suggestion', ref)
    if (v.account !== account) throw invalid()
    return { job: jobID(v.job), key: candidate ? candidateID(v.key) : undefined }
  }
  private async job(account: string, raw: unknown): Promise<WorldSuggestionJob> {
    const j = obj(raw), status = String(j.status)
    if (!['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(status)) throw invalid()
    return { ref: await this.seal(account, jobID(j.id)), requestId: text(obj(j.request).request_id, 128), status: status as WorldSuggestionJob['status'], phase: text(j.phase, 40), scanned: count(j.scanned), processed: count(j.processed, 500), matched: count(j.matched, 500), modelName: text(obj(j.model).name, 256), createdAtMillis: count(j.created_at, Number.MAX_SAFE_INTEGER), ...(j.failure ? { failure: text(j.failure, 100) } : {}) }
  }
  async execute(input: WorldSuggestionsRequest, signal?: AbortSignal): Promise<unknown> {
    if (!input || typeof input.accountKey !== 'string') throw invalid()
    const account = input.accountKey, { guard, post } = await this.context(account, signal)
    let result: unknown
    if (input.action === 'capabilities') {
      let v: Record<string, unknown>
      try { v = await post('capabilities', {}) } catch (e) { if (e instanceof ArkmePluginError && e.code === 'world-suggestion-unavailable') return { version: 1, supported: false }; throw e }
      if (v.schema_version !== 1 || typeof v.supported !== 'boolean' || v.supported && (v.durable_jobs !== true || v.source_recheck !== true || v.idempotent_create !== true || v.unified_models !== true)) throw invalid()
      result = { version: 1, supported: v.supported }
    } else if (input.action === 'models') {
      const v = await post('models', {})
      if (!Array.isArray(v.items) || v.items.length > 103) throw invalid()
      result = { items: v.items.map(raw => { const m = obj(raw); if (!['official', 'user-api'].includes(String(m.source))) throw invalid(); return { route: text(m.route, 256), name: text(m.name, 256), source: m.source === 'user-api' ? 'account' : 'official' } }) }
    } else if (input.action === 'state') {
      const v = await post('state', { include_items: input.includeItems === true })
      if (!Array.isArray(v.items) || v.items.length > 50) throw invalid()
      const items: WorldSuggestion[] = []
      for (const raw of v.items) {
        const c = obj(raw), key = candidateID(c.id)
        items.push({ key, ref: await this.seal(account, jobID(v.result_id), key), title: text(c.title, 512), preview: text(c.preview, 1000), reason: text(c.reason, 1200), occurredAtMillis: count(c.occurred_at, Number.MAX_SAFE_INTEGER) })
      }
      result = { supported: true, candidateCount: count(v.candidate_count, 50), items, unavailableCount: count(v.unavailable_count, 50), ...(v.job ? { job: await this.job(account, v.job) } : {}) } satisfies WorldSuggestionsState
    } else if (input.action === 'create') {
      if (input.confirmed !== true || ![7, 30, 90, 365].includes(input.days) || typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId) || input.modelRoute !== undefined && (typeof input.modelRoute !== 'string' || input.modelRoute.length > 256)) throw invalid()
      let receipt: Record<string, unknown>
      try { receipt = await post('create', { confirmed: true, request_id: input.requestId, days: input.days, ...(input.modelRoute ? { model_route: input.modelRoute } : {}) }, true) }
      catch (e) {
        const rejection = e instanceof ArkmeUpstreamResponseError ? obj(e.responseData).sharing_error : ''
        if (['invalid_request', 'analysis_busy', 'request_conflict', 'model_unavailable'].includes(String(rejection))) throw new ArkmePluginError('world-suggestion-not-accepted', rejection === 'model_unavailable' ? '所选模型暂不可用，本次未受理，请调整模型后重试' : '本次分析未受理，请刷新任务状态后重试', false, 409)
        throw e
      }
      result = await this.job(account, receipt)
    } else if (input.action === 'cancel' || input.action === 'hide') {
      if (input.confirmed !== true) throw invalid()
      const v = await this.open(account, input.action === 'cancel' ? input.jobRef : input.ref, input.action === 'hide')
      const receipt = await post(input.action, { confirmed: true, job_id: v.job, ...(v.key ? { candidate_id: v.key } : {}) }, true)
      if (receipt[input.action === 'hide' ? 'hidden' : 'cancelled'] !== true) throw invalid()
      result = { completed: true }
    } else if (input.action === 'prepare') {
      const origin: WorldPublishOrigin = { kind: 'suggestion', sourceRef: input.ref, itemUid: (await this.open(account, input.ref, true)).key! }
      const source = await this.resolve(account, origin, signal)
      result = { origin, draft: { ...source, sourceRef: origin.sourceRef, itemUid: origin.itemUid } }
    } else throw invalid()
    await guard(); return result
  }
  /** Internal source locator never escapes in the public prepared draft. */
  async resolve(account: string, origin: WorldPublishOrigin, signal?: AbortSignal): Promise<WorldPublishSourceDraft> {
    if (origin.kind !== 'suggestion') throw invalid()
    const { guard, post } = await this.context(account, signal), v = await this.open(account, origin.sourceRef, true)
    if (origin.itemUid !== v.key) throw invalid()
    const candidate = obj(await post('source', { job_id: v.job, candidate_id: v.key })), identity = obj(candidate.source)
    if (candidate.id !== v.key || !Number.isSafeInteger(identity.version) || Number(identity.version) <= 0) throw invalid()
    const uid = text(identity.record_uid, 128), sourceRef = await this.ports.selfSource(signal)
    await guard()
    const draft = await this.ports.source(sourceRef, uid, signal)
    await guard()
    if (draft.itemUid !== uid || draft.version !== identity.version) throw invalid()
    return draft
  }
}
