import { UnifiedTimelineCache } from '../unified-timeline-cache.js'
import { join } from 'node:path'
import { TimelineTokenCodec } from './timeline-token.js'
import { createHmac } from 'node:crypto'
import { recordOwnerId } from '../record-owner-id.js'
import type { ArkmeTimelinePage } from '../types.js'
import { CHAT_TIMELINE_SOURCES, compareUnifiedTimelineEvents, type ArkmeUnifiedTimelineEvent, type ArkmeUnifiedTimelineQuery, type ArkmeUnifiedTimelineWindow, type ArkmeTimelineSourceStatus } from '../unified-chat-timeline.js'
import type { ChatService } from './chat-service.js'
import type { InterwovenService } from './interwoven-service.js'
import type { SourceService } from './source-service.js'
import { ArkmePluginError, ArkmeUpstreamResponseError, objectValue, stringValue, type ServiceRuntime } from './service.js'

const ROUTE = '/api/v1/chat/timeline/unified'
function invalid(): ArkmePluginError { return new ArkmePluginError('chat-timeline-contract-invalid', '时间线响应不完整，请重试', true, 502) }

export function parseUnifiedTimelineResponse(raw: unknown, sessionUid: string) {
  const data = objectValue(raw)
  if (data.protocol_version !== 1 || data.chat_session_uid !== sessionUid || !Array.isArray(data.timeline_items)
    || data.timeline_items.length > 100 || !Array.isArray(data.sources) || typeof data.complete !== 'boolean'
    || typeof data.has_more !== 'boolean' || typeof data.older_has_more !== 'boolean' || typeof data.newer_has_more !== 'boolean'
    || typeof data.window_token !== 'string' || !data.window_token) throw invalid()
  const sources: ArkmeTimelineSourceStatus[] = data.sources.map(rawSource => {
    const source = objectValue(rawSource)
    if (!CHAT_TIMELINE_SOURCES.includes(source.source as never) || !['ready', 'not_applicable', 'gap'].includes(String(source.status))
      || !Number.isSafeInteger(source.item_count) || Number(source.item_count) < 0) throw invalid()
    return { source: source.source, status: source.status, itemCount: source.item_count } as ArkmeTimelineSourceStatus
  })
  if (sources.length !== CHAT_TIMELINE_SOURCES.length || new Set(sources.map(s => s.source)).size !== CHAT_TIMELINE_SOURCES.length) throw invalid()
  if (data.complete && sources.some(s => s.status === 'gap')) throw invalid()
  for (const [more, key] of [['has_more', 'next_cursor'], ['older_has_more', 'older_cursor'], ['newer_has_more', 'newer_cursor']]) {
    if (data[more!] && !stringValue(data[key!])) throw invalid()
  }
  const ids = new Set<string>()
  const events = data.timeline_items.map(rawEvent => {
    const event = objectValue(rawEvent)
    if (!stringValue(event.event_id) || ids.has(String(event.event_id)) || !CHAT_TIMELINE_SOURCES.includes(event.source as never)
      || !Number.isSafeInteger(event.occurred_at) || Number(event.occurred_at) <= 0
      || !stringValue(event.order_tie) || !['available', 'unavailable'].includes(String(event.content_status))
      || sources.find(s => s.source === event.source)?.status === 'not_applicable') throw invalid()
    ids.add(String(event.event_id))
    return event
  })
  return { data, sources, events }
}

/** One remote structure read shared by UI, SDK and Tools. Content adapters never query structure. */
export class UnifiedChatTimelineService {
  private cache: UnifiedTimelineCache | undefined
  private epoch = 0
  private disposed = false
  private readonly unsubscribe: (() => void) | undefined
  dispose(): void { this.disposed = true; this.epoch++; this.unsubscribe?.(); this.cache?.close(); this.cache = undefined }
  reset(): void { this.epoch++ }
  constructor(private readonly runtime: ServiceRuntime, private readonly source: SourceService,
    private readonly chat: ChatService, private readonly interwoven: InterwovenService) {
    this.unsubscribe = runtime.subscribeAccountScope?.(() => this.reset())
  }

  async read(sourceRef: string, query: ArkmeUnifiedTimelineQuery = {}, signal?: AbortSignal): Promise<ArkmeTimelinePage> {
    if (!query || typeof query !== 'object') throw new ArkmePluginError('chat-timeline-query-invalid', '时间线读取参数无效', false)
    const epoch = this.epoch
    const session = await this.runtime.requireSession()
    const source = await this.source.openSourceRef(sourceRef, session.userId)
    signal?.throwIfAborted()
    if (this.disposed || this.epoch !== epoch) throw new ArkmePluginError('chat-timeline-stale', '账号状态已变化', false, 409)
    if (source.kind !== 'private_chat' && source.kind !== 'group_chat') throw new ArkmePluginError('chat-timeline-source-invalid', '仅私聊和群聊支持统一时间线', false)
    const mode = query.mode ?? 'initial'
    if (!['initial', 'older', 'newer', 'around', 'refresh'].includes(mode)
      || query.cacheOnly !== undefined && typeof query.cacheOnly !== 'boolean'
      || query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100)
      || query.windowTokens !== undefined && (!Array.isArray(query.windowTokens) || query.windowTokens.length > 500
        || query.windowTokens.some(token => typeof token !== 'string' || !token || token.length > 32768))
      || query.cursor !== undefined && (typeof query.cursor !== 'string' || !query.cursor || query.cursor.length > 32768)
      || ['older', 'newer'].includes(mode) && !query.cursor
      || mode === 'refresh' && !query.cursor && !query.windowTokens?.length
      || mode === 'around' && (typeof query.itemUid !== 'string' || !query.itemUid.trim() || !recordOwnerId(query.recordOwnerUserId))) {
      throw new ArkmePluginError('chat-timeline-query-invalid', '时间线读取参数无效', false)
    }
    const key = await this.runtime.stateStore.uniqueCode()
    if (this.disposed || this.epoch !== epoch) throw new ArkmePluginError('chat-timeline-stale', '账号状态已变化', false, 409)
    const codec = new TimelineTokenCodec(key, JSON.stringify([this.runtime.config.environment, session.userId, source.ownerRef]))
    const body = { chat_session_uid: source.ownerRef, mode, limit: query.limit ?? 40,
      ...(query.cursor ? { cursor: codec.open(query.cursor, mode) } : {}),
      ...(query.windowTokens ? { window_tokens: query.windowTokens.map(token => codec.open(token, 'window')) } : {}),
      ...(mode === 'around' ? { record_uid: query.itemUid, record_owner_user_id: recordOwnerId(query.recordOwnerUserId) } : {}) }
    const scope = JSON.stringify([this.runtime.config.environment, session.userId, source.ownerRef])
    const requestKey = createHmac('sha256', key).update('projection:4\0').update(JSON.stringify(body)).digest('hex')
    if (!this.cache && this.runtime.config.fileStateDirectory) {
      try { this.cache = new UnifiedTimelineCache(join(this.runtime.config.fileStateDirectory, 'timeline')) } catch { /* Cache availability never gates the authoritative network read. */ }
    }
    if (query.cacheOnly) {
      const cached = this.cache?.read(scope, requestKey)
      if (!cached) throw new ArkmePluginError('chat-timeline-cache-miss', '没有已确认的本地时间线', false, 404)
      signal?.throwIfAborted()
      if (this.disposed || this.epoch !== epoch) throw new ArkmePluginError('chat-timeline-stale', '账号状态已变化', false, 409)
      return { ...cached, source: await this.source.sourceItem(source) }
    }
    let raw: unknown
    try {
      raw = await this.runtime.authenticatedChatPost(ROUTE, body, session, signal, {
        lane: 'interactive-read', key: `unified-timeline:${JSON.stringify(body)}`, cancelWhenUnobserved: true,
      })
    } catch (error) {
      if (error instanceof ArkmeUpstreamResponseError && error.code === 'arkme-code-2002'
        && objectValue(error.responseData).reason === 'chat_timeline_window_invalid') {
        throw new ArkmePluginError('chat-timeline-window-invalid', '当前时间线窗口需要重新加载', false, 409)
      }
      throw error
    }
    const { data, sources, events } = parseUnifiedTimelineResponse(raw, source.ownerRef)
    const eventId = (value: string) => `chat-event:${createHmac('sha256', key).update(JSON.stringify([session.userId, this.runtime.config.environment, source.ownerRef, value])).digest('base64url')}`
    const native = events.filter(event => event.source === 'messages' && event.content_status === 'available')
    const messages = await this.chat.projectChatTimelineItems(native.map(event => event.payload), source, session, signal)
    const messageByRelation = new Map(messages.map(item => [item.timelineItemKey, item]))
    const groups = events.filter(event => event.source === 'interwoven' && event.content_status === 'available')
    const moments = groups.length ? (await this.interwoven.projectUnifiedGroups({ groups: groups.map(e => e.payload), prepared_at: data.prepared_at }, source, session, 0, signal)).moments : []
    const momentById = new Map(moments.map(moment => [moment.momentId, moment]))
    const joins = events.filter(event => event.source === 'group_metadata' && event.kind === 'member_join' && event.content_status === 'available')
    const joinPresentations = joins.length
      ? await this.chat.projectUnifiedMemberJoins(joins.map(event => ({ ...objectValue(event.payload), join_at: event.occurred_at })), source, session, signal) : []
    const joinByEvent = new Map(joins.map((event, index) => [event.event_id, joinPresentations[index]!]))
    const projected: ArkmeUnifiedTimelineEvent[] = []
    for (const event of events) {
      signal?.throwIfAborted()
      const payload = objectValue(event.payload)
      const order = { eventId: eventId(String(event.event_id)), source: event.source as ArkmeTimelineSourceStatus['source'],
        occurredAtMillis: Number(event.occurred_at), orderTie: String(event.order_tie),
        contentStatus: event.content_status as 'available' | 'unavailable', windowToken: codec.seal(String(data.window_token), 'window') }
      if (order.contentStatus === 'unavailable') {
        const relation = objectValue(payload.relation)
        const uid = stringValue(relation.record_uid)
        if (event.source === 'messages' && uid) {
          projected.push({ ...order, kind: 'message', item: {
            itemUid: uid, timelineEventId: order.eventId,
            timelineItemKey: await this.source.chatTimelineItemKey(session.userId, source.ownerRef, stringValue(relation.rel_uid)),
            senderName: '', isMe: false, sendAtMillis: order.occurredAtMillis, title: '', textContent: '内容暂时不可用',
            status: 0, quickNoteDetailsSupported: false,
            ...(Number.isSafeInteger(relation.seq) ? { sequence: Number(relation.seq) } : {}),
          } })
        } else projected.push({ ...order, kind: 'notice', text: '内容暂时不可用' })
      } else if (event.source === 'messages') {
        const relation = objectValue(payload.relation)
        const item = messageByRelation.get(await this.source.chatTimelineItemKey(session.userId, source.ownerRef, stringValue(relation.rel_uid)))
        if (!item) throw invalid()
        projected.push({ ...order, kind: 'message', item: { ...item, timelineEventId: order.eventId, sendAtMillis: order.occurredAtMillis } })
      } else if (event.source === 'interwoven') {
        const preview = Array.isArray(payload.group_preview_items) ? objectValue(payload.group_preview_items[0]) : {}
        const moment = momentById.get(await this.interwoven.interwovenStableMomentId(stringValue(preview.moment_id)))
        if (!moment) throw invalid()
        projected.push({ ...order, kind: 'moment', item: moment })
      } else if (event.source === 'member_left') {
        const id = stringValue(payload.event_id)
        if (!id || payload.chat_session_uid !== source.ownerRef || payload.event_type !== 'left') throw invalid()
        projected.push({ ...order, kind: 'member-event', item: { eventId: id, type: 'left', occurredAtMillis: order.occurredAtMillis,
          displayName: stringValue(payload.display_name_snapshot) || '群成员' } })
      } else if (event.source === 'group_metadata') {
        const join = joinByEvent.get(event.event_id)
        if (join) { projected.push({ ...order, kind: 'member-join', item: join }); continue }
        projected.push({ ...order, kind: 'notice', text: event.kind === 'group_invite' ? '群聊已创建'
          : '群成员加入了群聊' })
      } else if (event.source === 'ai_polish') {
        const actor = stringValue(payload.actor_display_name_snapshot)
        const rule = stringValue(payload.rule_name) || stringValue(payload.rule_text)
        projected.push({ ...order, kind: 'notice', text: `${actor}${payload.notice_kind === 1 ? '开启了' : '修改了'} AI 润色：${rule}` })
      } else if (event.source === 'world_public') {
        const recordUid = stringValue(payload.record_uid)
        if (!recordUid) throw invalid()
        const worldCodec = new TimelineTokenCodec(key, JSON.stringify([this.runtime.config.environment, session.userId]))
        projected.push({ ...order, kind: 'world-public', recordRef: worldCodec.seal(recordUid, 'world-record'),
          authorName: stringValue(payload.nick_name) || source.displayName || '对方' })
      } else {
        projected.push({ ...order, kind: 'external', title: event.source === 'world_public' ? '公开快记' : '微信导入',
          text: (stringValue(payload.text_content) || stringValue(payload.content) || stringValue(payload.headline)).slice(0, 20000) })
      }
    }
    signal?.throwIfAborted()
    const unified: ArkmeUnifiedTimelineWindow = { protocolVersion: 1, events: projected.sort(compareUnifiedTimelineEvents), sources,
      complete: data.complete as boolean, windowTokens: [codec.seal(String(data.window_token), 'window')],
      ...(stringValue(data.older_cursor) ? { olderCursor: codec.seal(String(data.older_cursor), 'older') } : {}),
      ...(stringValue(data.newer_cursor) ? { newerCursor: codec.seal(String(data.newer_cursor), 'newer') } : {}),
      ...(stringValue(data.next_cursor) ? { nextCursor: codec.seal(String(data.next_cursor), mode === 'initial' || mode === 'around' ? 'older' : mode) } : {}),
      olderHasMore: data.older_has_more as boolean, newerHasMore: data.newer_has_more as boolean, hasMore: data.has_more as boolean }
    const result: ArkmeTimelinePage = { source: await this.source.sourceItem(source), items: projected.flatMap(event => event.kind === 'message' ? [event.item] : []),
      unified, hasMore: unified.hasMore, ...(unified.nextCursor ? { nextCursor: { unified: { mode: mode === 'initial' || mode === 'around' ? 'older' : mode, cursor: unified.nextCursor } } } : {}) }
    signal?.throwIfAborted()
    if (this.disposed || this.epoch !== epoch || (await this.runtime.requireSession()).userId !== session.userId) throw new ArkmePluginError('chat-timeline-stale', '账号或会话状态已变化', false, 409)
    try { this.cache?.write(scope, requestKey, result) } catch { /* Keep the last committed cache; this network result is still authoritative. */ }
    return result
  }
}
