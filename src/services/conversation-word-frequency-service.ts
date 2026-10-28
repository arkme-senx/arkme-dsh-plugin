import { recordOwnerId } from '../record-owner-id.js'
import { assertConversationWordsEnvelope, conversationWordsEnvelope, parseConversationWordMessages, parseConversationWordParticipants, parseConversationWordsQuery, parseConversationWordsState, unavailableConversationWords, wordObject, wordText } from '../conversation-word-frequency.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type { SourceService } from './source-service.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'

/** Proposed Chat-owner adapter. Never scan the current UI timeline or individual profiles. */
export class ConversationWordFrequencyService {
  private epoch = 0
  private readonly unsubscribe: () => void
  constructor(private readonly runtime: ServiceRuntime, private readonly sources: Pick<SourceService, 'openSourceRef'>) {
    this.unsubscribe = runtime.subscribeAccountScope(() => { this.epoch++ })
  }
  dispose() { this.epoch++; this.unsubscribe() }
  private async context(input: unknown, signal?: AbortSignal) {
    const q = parseConversationWordsQuery(input), session = await this.runtime.requireSession(), epoch = this.epoch
    const guard = async () => {
      signal?.throwIfAborted(); const current = await this.runtime.requireSession()
      if (epoch !== this.epoch || current.userId !== session.userId || q.accountScope !== `${this.runtime.config.environment}:${current.userId}`)
        throw new ArkmePluginError('chat-words-account-changed', '账号已变化，请重新打开对话词频', false, 409)
    }
    await guard()
    const source = await this.sources.openSourceRef(q.sourceRef, session.userId); await guard()
    if (!['private_chat', 'group_chat'].includes(source.kind) || (source.kind === 'group_chat' && q.sender === 'peer'))
      throw new ArkmePluginError('chat-words-scope-invalid', '词频范围不是有效的私聊或群聊', false, 400)
    return { q, session, source, guard, body: conversationWordsEnvelope(q, source.ownerRef) }
  }
  private request(path: string, body: Record<string, unknown>, session: ArkmeSessionCredentials, signal?: AbortSignal, write = false) {
    return this.runtime.authenticatedChatPost<unknown>(`/api/v1/chats/word-frequency/${path}`, body, session, signal,
      { lane: write ? 'write' : 'interactive-read', cacheMs: 0, bypassCache: true })
  }
  private async supported(session: ArkmeSessionCredentials, signal?: AbortSignal) {
    let value: unknown
    try { value = await this.request('capabilities', { schema_version: 1, scope: 'conversation_words' }, session, signal) }
    catch (e) { if (e instanceof ArkmePluginError && [404, 501].includes(e.upstreamStatus ?? e.httpStatus)) return false; throw e }
    const v = wordObject(value)
    if (v.supported === false) return false
    if (v.supported !== true || v.schema_version !== 1 || v.scope !== 'conversation_words' || v.full_history !== true
      || v.historical_senders !== true || v.sender_filter !== true || v.source_navigation !== true || v.idempotent_create !== true)
      throw new ArkmePluginError('chat-words-contract', '对话词频服务版本暂不兼容', false, 409)
    return true
  }
  async state(input: unknown, signal?: AbortSignal) {
    const c = await this.context(input, signal), supported = await this.supported(c.session, signal); await c.guard()
    if (!supported) return unavailableConversationWords()
    const value = await this.request('state', c.body, c.session, signal); await c.guard()
    return parseConversationWordsState(value, c.q, c.source.ownerRef)
  }
  async create(input: unknown, signal?: AbortSignal) {
    const c = await this.context(input, signal), requestId = wordText(wordObject(input).requestId, 100)
    if (!/^[a-zA-Z0-9-]{16,100}$/.test(requestId)) throw new Error('词频分析请求标识无效')
    if (!await this.supported(c.session, signal)) throw new ArkmePluginError('chat-words-unavailable', '对话词频服务尚未接通', false, 501)
    await c.guard()
    const value = await this.request('create', { ...c.body, request_id: requestId }, c.session, signal, true); await c.guard()
    const state = parseConversationWordsState(value, c.q, c.source.ownerRef)
    if (wordObject(value).request_id !== requestId || (!state.job && !state.result)) throw new Error('分析提交尚未确认，请核对同一次请求')
    return state
  }
  async participants(input: unknown, signal?: AbortSignal) {
    const c = await this.context(input, signal), v = wordObject(input)
    const search = typeof v.search === 'string' && v.search.length <= 200 ? v.search.trim() : ''
    const value = await this.request('participants', { ...c.body, search, cursor: v.cursor == null ? null : wordText(v.cursor, 4096), limit: 50 }, c.session, signal); await c.guard()
    const response = wordObject(value)
    if (response.search !== search) throw new Error('发言者搜索结果已变化，请重试')
    return parseConversationWordParticipants(value, c.q, c.source.ownerRef)
  }
  async messages(input: unknown, signal?: AbortSignal) {
    const c = await this.context(input, signal), v = wordObject(input), resultId = wordText(v.resultId), wordKey = wordText(v.wordKey)
    const value = await this.request('messages', { ...c.body, result_id: resultId, word_key: wordKey,
      cursor: v.cursor == null ? null : wordText(v.cursor, 4096), limit: 50 }, c.session, signal); await c.guard()
    return parseConversationWordMessages(value, c.q, c.source.ownerRef, resultId, wordKey)
  }
  async source(input: unknown, signal?: AbortSignal) {
    const c = await this.context(input, signal), v = wordObject(input), resultId = wordText(v.resultId), sourceRef = wordText(v.messageSourceRef, 4096)
    const data = wordObject(await this.request('source', { ...c.body, result_id: resultId, source_ref: sourceRef }, c.session, signal)); await c.guard()
    assertConversationWordsEnvelope(data, c.q, c.source.ownerRef)
    const owner = recordOwnerId(data.record_owner_user_id)
    if (owner === 0 || data.available !== true || data.result_id !== resultId || data.source_ref !== sourceRef || typeof data.send_at !== 'number' || !Number.isSafeInteger(data.send_at) || data.send_at <= 0)
      throw new ArkmePluginError('chat-words-source-unavailable', '原消息已变化或不可查看，请更新词频后重试', false, 409)
    return { messageUid: wordText(data.message_uid), sendAtMillis: data.send_at, recordOwnerUserId: owner }
  }
}
