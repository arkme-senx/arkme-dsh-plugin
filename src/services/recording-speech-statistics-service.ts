import { assertSpeechEnvelope, parseSpeechOccurrences, parseSpeechQuery, parseSpeechState, speechEnvelope, speechObject, speechText, unavailableSpeechState, type SpeechMode, type SpeechSource } from '../recording-speech-statistics.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type { RecordingService } from './recording-service.js'
import type { MediaService } from './media-service.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'

/** One account-scoped owner for UI, SDK and granted recording Tools. */
export class RecordingSpeechStatisticsService {
  private epoch = 0
  private readonly unsubscribe: () => void
  constructor(private readonly runtime: ServiceRuntime, private readonly recording: Pick<RecordingService, 'exploreRecordingEvidence'>,
    private readonly media: Pick<MediaService, 'issueSpeechPlaybackMediaRef'>) {
    this.unsubscribe = runtime.subscribeAccountScope(() => { this.epoch++ })
  }
  dispose() { this.epoch++; this.unsubscribe() }
  private async context(input: unknown, signal?: AbortSignal) {
    const q = parseSpeechQuery(input), session = await this.runtime.requireSession(), epoch = this.epoch
    const guard = async () => {
      signal?.throwIfAborted()
      const current = await this.runtime.requireSession()
      if (this.epoch !== epoch || current.userId !== session.userId || q.accountScope !== `${this.runtime.config.environment}:${current.userId}`)
        throw new ArkmePluginError('speech-account-changed', '账号已变化，请重新打开说话统计', false, 409)
    }
    await guard(); return { q, session, guard }
  }
  private request(path: string, body: Record<string, unknown>, session: ArkmeSessionCredentials, signal?: AbortSignal, write = false) {
    return this.runtime.authenticatedAudioPost<unknown>(`/api/v1/speech-statistics/${path}`, body, session, signal,
      { lane: write ? 'write' : 'interactive-read', bypassCache: true, cacheMs: 0 })
  }
  private async supported(session: ArkmeSessionCredentials, signal?: AbortSignal) {
    let value: unknown
    try { value = await this.request('capabilities', { schema_version: 2, scope: 'self_speech_day' }, session, signal) }
    catch (error) {
      if (error instanceof ArkmePluginError && [404, 501].includes(error.upstreamStatus ?? error.httpStatus)) return false
      throw error
    }
    const v = speechObject(value)
    if (v.supported === false) return false
    if (v.supported !== true || v.schema_version !== 2 || v.scope !== 'self_speech_day' || v.audio_verbatim !== true
      || v.self_only !== true || v.source_navigation !== true || v.idempotent_create !== true)
      throw new ArkmePluginError('speech-contract', '说话统计服务版本暂不兼容', false, 409)
    return true
  }
  async capabilities(signal?: AbortSignal): Promise<import('../recording-speech-statistics.js').SpeechCapabilities> {
    const session = await this.runtime.requireSession(), epoch = this.epoch
    const supported = await this.supported(session, signal)
    const current = await this.runtime.requireSession(); signal?.throwIfAborted()
    if (epoch !== this.epoch || current.userId !== session.userId) throw new ArkmePluginError('speech-account-changed', '账号已变化，请重新读取能力', false, 409)
    return { version: 2, accountScope: `${this.runtime.config.environment}:${session.userId}`, supported }
  }
  async state(input: unknown, signal?: AbortSignal) {
    const { q, session, guard } = await this.context(input, signal)
    const supported = await this.supported(session, signal); await guard()
    if (!supported) return unavailableSpeechState()
    const value = await this.request('state', speechEnvelope(q), session, signal); await guard()
    return parseSpeechState(value, q)
  }
  async create(input: unknown, signal?: AbortSignal) {
    const { q, session, guard } = await this.context(input, signal), requestId = speechText(speechObject(input).requestId, 100)
    if (!/^[a-zA-Z0-9-]{16,100}$/.test(requestId)) throw new Error('分析请求标识无效')
    if (!await this.supported(session, signal)) throw new ArkmePluginError('speech-unavailable', '原音说话统计尚未接通', false, 501)
    await guard()
    const value = await this.request('create', { ...speechEnvelope(q), request_id: requestId }, session, signal, true); await guard()
    const state = parseSpeechState(value, q)
    if (speechObject(value).request_id !== requestId || (!state.job && !state.result && !state.stale)) throw new Error('分析提交尚未确认，请核对同一次请求')
    return state
  }
  async occurrences(input: unknown, signal?: AbortSignal) {
    const v = speechObject(input), { q, session, guard } = await this.context(input, signal)
    const resultId = speechText(v.resultId), termKey = speechText(v.termKey), mode = v.mode as SpeechMode
    if (!['habit', 'all'].includes(mode)) throw new Error('统计分类无效')
    const value = await this.request('occurrences', { ...speechEnvelope(q), result_id: resultId, term_key: termKey, mode,
      cursor: v.cursor == null ? null : speechText(v.cursor, 4096), limit: 50 }, session, signal); await guard()
    return parseSpeechOccurrences(value, q, resultId, termKey, mode)
  }
  async source(input: unknown, signal?: AbortSignal): Promise<SpeechSource> {
    const v = speechObject(input), { q, session, guard } = await this.context(input, signal)
    const resultId = speechText(v.resultId), sourceRef = speechText(v.sourceRef, 4096)
    if (v.action !== 'play' && v.action !== 'locate') throw new Error('原音打开方式无效')
    const value = speechObject(await this.request('source', { ...speechEnvelope(q), result_id: resultId, source_ref: sourceRef }, session, signal)); await guard()
    assertSpeechEnvelope(value, q)
    if (value.available !== true || value.self_range !== true || value.result_id !== resultId || value.source_ref !== sourceRef)
      throw new ArkmePluginError('speech-source-unavailable', '原音或人物标记已变化，请更新统计后重试', false, 409)
    const playback = speechObject(value.playback)
    const start = playback.start_at_millis, end = playback.end_at_millis, focusAt = playback.focus_at_millis
    if (typeof start !== 'number' || !Number.isSafeInteger(start) || start < 0 || typeof end !== 'number' || !Number.isSafeInteger(end) || end <= start
      || typeof focusAt !== 'number' || !Number.isSafeInteger(focusAt) || focusAt < start || focusAt >= end || playback.content_type !== 'audio/flac')
      throw new ArkmePluginError('speech-contract', '原音播放范围无效，请更新统计', false, 502)
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: q.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(focusAt)
    if (date !== q.date) throw new ArkmePluginError('speech-source-day-changed', '原音日期与统计不一致，请更新统计', false, 409)
    const playbackRef = await this.media.issueSpeechPlaybackMediaRef(session.userId, sourceRef, speechText(playback.content_path, 8192), signal)
    let target: SpeechSource['target'] = null
    if (v.action === 'locate' && value.target != null) {
      const original = speechObject(value.target), owner = speechObject(original.owner_ref), range = speechObject(original.window)
      const dateStamp = range.dateStamp, endStamp = range.endStamp, originalAt = owner.start_at
      if (typeof dateStamp !== 'number' || !Number.isSafeInteger(dateStamp) || typeof endStamp !== 'number' || !Number.isSafeInteger(endStamp)
        || typeof originalAt !== 'number' || !Number.isSafeInteger(originalAt) || originalAt < dateStamp || originalAt >= endStamp
        || range.timeZone !== q.timezone || range.date !== new Intl.DateTimeFormat('en-CA', { timeZone: q.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(originalAt))
        throw new ArkmePluginError('speech-source-day-changed', '原文日期范围无效，请更新统计', false, 409)
      const window = { dateStamp, endStamp, timeZone: q.timezone, date: speechText(range.date, 10) }
      // Only a real original quote authorizes a transcript target. The corrected
      // word and an empty ASR quote cannot manufacture a Workbench item.
      target = { ...await this.recording.exploreRecordingEvidence(owner, speechText(original.original_quote, 10000), signal, window), window }
    }
    await guard()
    return { playback: { playbackRef, mimeType: 'audio/flac', startOffsetMillis: 0, endOffsetMillis: end - start }, mediaStartAtMillis: start, focusAtMillis: focusAt, target }
  }
}
