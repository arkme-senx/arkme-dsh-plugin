import { systemTimelineAnchorCodec, validateSystemTimelineAnchor } from './system-timeline-anchor.js'
import { chatTimelineEventId } from './timeline-event-id.js'
import { recordOwnerId } from '../record-owner-id.js'
import { conversationWordsEnvelope, parseConversationWordsQuery, parseConversationWordParticipants, wordObject, wordText } from '../conversation-word-frequency.js'
import { activityMessageMatches, assertActivityEnvelope, parseActivityMessages, parseActivitySelection, parseConversationActivity, unavailableConversationActivity } from '../conversation-activity.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type { SourceService } from './source-service.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'

/** Independent of text eligibility and AI word analysis; all message kinds count once. */
export class ConversationActivityService {
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
        throw new ArkmePluginError('chat-activity-account-changed', '账号已变化，请重新打开对话分析', false, 409)
    }
    await guard()
    const source = await this.sources.openSourceRef(q.sourceRef, session.userId); await guard()
    if (!['private_chat', 'group_chat'].includes(source.kind) || (source.kind === 'group_chat' && q.sender === 'peer'))
      throw new ArkmePluginError('chat-activity-scope-invalid', '活跃时间仅支持私聊和群聊', false, 400)
    return { q, session, source, guard, body: conversationWordsEnvelope(q, source.ownerRef, 'conversation_activity') }
  }
  private request(path: string, body: Record<string, unknown>, session: ArkmeSessionCredentials, signal?: AbortSignal) {
    return this.runtime.authenticatedChatPost<unknown>(`/api/v1/chats/activity-time/${path}`, body, session, signal,
      { lane: 'interactive-read', cacheMs: 0, bypassCache: true })
  }
  async read(input: unknown, signal?: AbortSignal) {
    const c = await this.context(input, signal)
    let raw: unknown
    try { raw = await this.request('capabilities', { schema_version: 1, scope: 'conversation_activity' }, c.session, signal) }
    catch (e) { await c.guard(); if (e instanceof ArkmePluginError && [404, 501].includes(e.upstreamStatus ?? e.httpStatus)) return unavailableConversationActivity(); throw e }
    await c.guard(); const capability = wordObject(raw)
    if (capability.supported === false) return unavailableConversationActivity()
    if (capability.supported !== true || capability.schema_version !== 1 || capability.scope !== 'conversation_activity'
      || ['full_history', 'all_message_types', 'sender_filter', 'historical_senders', 'source_navigation'].some(k => capability[k] !== true))
      throw new ArkmePluginError('chat-activity-contract', '活跃时间服务版本暂不兼容', false, 409)
    const value = await this.request('query', c.body, c.session, signal); await c.guard()
    return parseConversationActivity(value, c.q, c.source.ownerRef)
  }
  async participants(input: unknown, signal?: AbortSignal) {
    const c = await this.context(input, signal), v = wordObject(input)
    const search = typeof v.search === 'string' && v.search.length <= 200 ? v.search.trim() : ''
    const raw = await this.request('participants', { ...c.body, search, cursor: v.cursor == null ? null : wordText(v.cursor, 4096), limit: 50 }, c.session, signal); await c.guard()
    if (wordObject(raw).search !== search) throw new Error('发言者搜索结果已变化，请重试')
    return parseConversationWordParticipants(raw, c.q, c.source.ownerRef, 'conversation_activity')
  }
  async messages(input: unknown, signal?: AbortSignal) {
    const c = await this.context(input, signal), v = wordObject(input), selection = parseActivitySelection(v), resultId = wordText(v.resultId)
    const raw = await this.request('messages', { ...c.body, result_id: resultId, ...selection, cursor: v.cursor == null ? null : wordText(v.cursor, 4096), limit: 50 }, c.session, signal); await c.guard()
    return parseActivityMessages(raw, c.q, c.source.ownerRef, resultId, selection)
  }
  async source(input: unknown, signal?: AbortSignal) {
    const c = await this.context(input, signal), v = wordObject(input), selection = parseActivitySelection(v), resultId = wordText(v.resultId), sourceRef = wordText(v.messageSourceRef, 4096)
    const raw = wordObject(await this.request('source', { ...c.body, result_id: resultId, source_ref: sourceRef, ...selection }, c.session, signal)); await c.guard()
    assertActivityEnvelope(raw, c.q, c.source.ownerRef)
    const owner = recordOwnerId(raw.record_owner_user_id)
    if (raw.available !== true || raw.result_id !== resultId || raw.source_ref !== sourceRef || raw.hour !== selection.hour || raw.weekday !== selection.weekday
      || typeof raw.send_at !== 'number' || !activityMessageMatches(raw.send_at, c.q, selection))
      throw new ArkmePluginError('chat-activity-source-unavailable', '原消息已变化或不可查看，请刷新统计后重试', false, 409)
    if (raw.timeline_anchor_source !== undefined || raw.timeline_anchor_id !== undefined) {
      const anchor = validateSystemTimelineAnchor(raw.timeline_anchor_source, raw.timeline_anchor_id)
      if (raw.message_uid !== anchor.anchor_id || owner !== 0)
        throw new ArkmePluginError('chat-activity-source-unavailable', '系统通知定位数据不匹配', false, 409)
      const key = await this.runtime.stateStore.uniqueCode(); await c.guard()
      return { messageUid: chatTimelineEventId(key, c.session.userId, this.runtime.config.environment, c.source.ownerRef, anchor.anchor_id), sendAtMillis: raw.send_at,
        systemRef: systemTimelineAnchorCodec(key, this.runtime.config.environment, c.session.userId, c.source.ownerRef).seal(anchor.anchor_source, anchor.anchor_id) }
    }
    if (owner === 0) throw new ArkmePluginError('chat-activity-source-unavailable', '原消息定位数据不完整', false, 409)
    return { messageUid: wordText(raw.message_uid), sendAtMillis: raw.send_at, recordOwnerUserId: owner }
  }
}
