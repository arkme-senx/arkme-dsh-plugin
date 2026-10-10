import { TimelineCacheWorker, type TimelineCachePort, type TimelineCacheCommand } from '../timeline-cache-port.js'
import { reconcileUnifiedTimeline } from '../unified-timeline-reconcile.js'
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
  private cache: TimelineCachePort | undefined
  private epoch = 0
  private disposed = false
  private readonly knownSources = new Map<string, { scope: string; userId: number; revision: number }>()
  private readonly pendingInvalidations = new Map<string, TimelineCacheCommand>()
  private invalidating: Promise<void> | undefined
  private readonly unsubscribe: (() => void) | undefined
  dispose(): void { this.disposed = true; this.epoch++; this.knownSources.clear(); this.pendingInvalidations.clear(); this.unsubscribe?.(); this.cache?.close(); this.cache = undefined }
  reset(): void { this.epoch++; this.knownSources.clear() }
  constructor(private readonly runtime: ServiceRuntime, private readonly source: SourceService,
    private readonly chat: ChatService, private readonly interwoven: InterwovenService,
    private readonly createCache: (directory: string) => TimelineCachePort = directory => new TimelineCacheWorker(directory)) {
    this.unsubscribe = runtime.subscribeAccountScope?.(() => this.reset())
  }

  private storage(): TimelineCachePort | undefined {
    if (!this.cache && !this.disposed && this.runtime.config.fileStateDirectory) {
      try { this.cache = this.createCache(join(this.runtime.config.fileStateDirectory, 'timeline')) } catch { /* Network remains available. */ }
    }
    return this.cache
  }

  async invalidate(sourceKey: string, timelineItemKey?: string, terminal = false): Promise<void> {
    if (this.disposed) return
    const known = this.knownSources.get(sourceKey)
    if (known) {
      known.revision++
      this.runtime.invalidateKey?.(this.runtime.requestScope(known.userId), 'unified-timeline:')
    }
    const key = JSON.stringify([sourceKey, timelineItemKey ?? '', terminal])
    if (!this.pendingInvalidations.has(key) && this.pendingInvalidations.size >= 512) {
      // Never serve potentially revoked data when a bounded hint backlog overflows.
      this.pendingInvalidations.clear(); this.storage()?.close()
      return
    }
    this.pendingInvalidations.set(key, { ...(known ? { kind: 'invalidate' as const, scope: known.scope } : { kind: 'invalidate-source' as const, sourceKey }),
      ...(timelineItemKey ? { timelineItemKey } : {}), terminal })
    // A sessions delta can contain hundreds of sources. Coalesce duplicate hints
    // and drain sequentially instead of overflowing the shared Worker admission queue.
    this.invalidating ??= Promise.resolve().then(async () => {
      try {
        while (this.pendingInvalidations.size && !this.disposed) {
          const [id, command] = this.pendingInvalidations.entries().next().value!
          this.pendingInvalidations.delete(id)
          await this.storage()?.call(command)
        }
      } catch { this.pendingInvalidations.clear(); this.cache?.close() }
      finally { this.invalidating = undefined }
    })
    await this.invalidating
  }

  async read(sourceRef: string, query: ArkmeUnifiedTimelineQuery = {}, signal?: AbortSignal): Promise<ArkmeTimelinePage> {
    if (!query || typeof query !== 'object' || Array.isArray(query)) throw new ArkmePluginError('chat-timeline-query-invalid', '时间线读取参数无效', false)
    const operation = (shared: AbortSignal) => this.readOwned(sourceRef, query,
      AbortSignal.any([shared, AbortSignal.timeout(Math.min(this.runtime.config.requestTimeoutMs ?? 30000, 30000))]))
    return this.runtime.runCompositeOwnerRead
      ? await this.runtime.runCompositeOwnerRead('chat.timeline.window', { sourceRef, query }, operation, signal)
      : await operation(signal ?? new AbortController().signal)
  }

  private async readOwned(sourceRef: string, query: ArkmeUnifiedTimelineQuery, signal: AbortSignal): Promise<ArkmeTimelinePage> {
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
      || query.anchorId !== undefined && (!query.cacheOnly || typeof query.anchorId !== 'string' || !query.anchorId || query.anchorId.length > 1024)
      || query.reconcile !== undefined && typeof query.reconcile !== 'boolean'
      || query.reconcile && (mode !== 'refresh' || query.cacheOnly || query.cursor !== undefined || !query.windowTokens?.length)
      || query.newerCursor !== undefined && (!query.reconcile || typeof query.newerCursor !== 'string' || !query.newerCursor || query.newerCursor.length > 32768)
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
    const scope = JSON.stringify([this.runtime.config.environment, session.userId, source.ownerRef])
    const sourceItem = await this.source.sourceItem(source)
    const sourceKey = sourceItem.sourceKey ?? sourceRef
    const state = this.knownSources.get(sourceKey) ?? { scope, userId: session.userId, revision: 0 }
    this.knownSources.delete(sourceKey); this.knownSources.set(sourceKey, state)
    while (this.knownSources.size > 512) this.knownSources.delete(this.knownSources.keys().next().value!)
    const revision = state.revision
    const requestKey = createHmac('sha256', key).update('projection:5\0').update(JSON.stringify({ ...query, cacheOnly: undefined, anchorId: undefined })).digest('hex')
    const invalidating = this.invalidating
    if (invalidating) await new Promise<void>((resolve, reject) => {
      const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason) }
      signal.addEventListener('abort', abort, { once: true })
      invalidating.then(() => { signal.removeEventListener('abort', abort); resolve() }, error => {
        signal.removeEventListener('abort', abort); reject(error)
      })
      if (signal.aborted) abort()
    })
    const cache = this.storage()
    const assertCurrent = async () => {
      signal.throwIfAborted()
      if (this.disposed || this.epoch !== epoch || state.revision !== revision || (await this.runtime.requireSession()).userId !== session.userId) throw new ArkmePluginError('chat-timeline-stale', '账号或会话状态已变化，请重试', true, 409)
    }
    if (query.cacheOnly) {
      let cached: ArkmeTimelinePage | undefined
      try { cached = await cache?.call<ArkmeTimelinePage | undefined>({ kind: 'read', scope, request: requestKey,
        ...(query.anchorId ? { anchorId: query.anchorId.replace(/^(message|moment|notice|external|world-public):/, '') } : {}),
        latest: mode === 'initial' && !query.anchorId }) } catch { /* Unavailable storage is a cache miss, not authoritative empty history. */ }
      if (!cached) throw new ArkmePluginError('chat-timeline-cache-miss', '没有已确认的本地时间线', false, 404)
      await assertCurrent()
      return { ...cached, source: sourceItem }
    }
    let ticket: number | undefined
    try { ticket = await cache?.call<number>({ kind: 'reserve' }) } catch { /* Explicit unavailable persistence below. */ }
    await assertCurrent()
    const readPage = async (pageQuery: ArkmeUnifiedTimelineQuery): Promise<ArkmeTimelinePage> => {
    const mode = pageQuery.mode ?? 'initial'
    const body = { chat_session_uid: source.ownerRef, mode, limit: pageQuery.limit ?? 40,
      ...(pageQuery.cursor ? { cursor: codec.open(pageQuery.cursor, mode) } : {}),
      ...(pageQuery.windowTokens ? { window_tokens: pageQuery.windowTokens.map(token => codec.open(token, 'window')) } : {}),
      ...(mode === 'around' ? { record_uid: pageQuery.itemUid, record_owner_user_id: recordOwnerId(pageQuery.recordOwnerUserId) } : {}) }
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
        const owner = recordOwnerId(relation.record_owner_user_id)
        projected.push({ ...order, kind: 'message', item: { ...item, timelineEventId: order.eventId, sendAtMillis: order.occurredAtMillis,
          ...(owner ? { recordOwnerUserId: owner } : {}) } })
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
    return result
    }
    let result = query.reconcile ? await reconcileUnifiedTimeline(query, readPage, signal) : await readPage(query)
    await assertCurrent()
    // Standalone refresh pages do not constitute a durable completed window.
    const durable = mode !== 'refresh' || query.reconcile === true
    let committed = false
    if (durable && ticket !== undefined) {
      let accepted: boolean | undefined
      try { accepted = await cache!.call<boolean>({ kind: 'write', scope, request: requestKey, page: result,
        options: { ticket, latest: (mode === 'initial' || query.reconcile === true && !!query.newerCursor) && !result.unified!.newerHasMore,
          ...(query.reconcile ? { refreshTokens: query.windowTokens! } : {}) } }) } catch { /* The previous committed window survives. */ }
      if (accepted === false) throw new ArkmePluginError('chat-timeline-stale', '会话已有更新，请重试', true, 409)
      committed = accepted === true
    }
    if (committed) {
      // Publish exactly the committed canonical projection, including a newer version
      // already written by another window. A failed readback is not a persisted success.
      try {
        const persisted = await cache!.call<ArkmeTimelinePage | undefined>({ kind: 'read', scope, request: requestKey })
        if (persisted) result = persisted
        else committed = false
      }
      catch { committed = false }
    }
    await assertCurrent()
    return { ...result, cache: { origin: 'network', persistence: !durable ? 'deferred' : committed ? 'committed' : 'unavailable',
      ...(committed ? { revision: result.cache?.revision ?? ticket! } : {}), stale: result.cache?.stale === true || !result.unified!.complete } }
  }
}
