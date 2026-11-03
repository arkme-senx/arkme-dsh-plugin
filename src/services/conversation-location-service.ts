import { randomUUID } from 'node:crypto'
import type { ConversationLocationPage, ConversationLocationQuery, ConversationLocationRecord } from '../conversation-location.js'
import type { ArkmeSearchRecordItem, ArkmeSourceItem } from '../types.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import { validLocation } from '../location-search.js'
import { recordOwnerId } from '../record-owner-id.js'
import { ARKME_DSH_INPUT_TOPIC_KIND } from '../topic-policy.js'
import type { ArkmeRecordLocationCapture } from '../types.js'
import { ArkmePrivacyVisibilityService, arkmePrivacyLockedRecord } from './privacy-visibility.js'
import { ArkmePluginError, type ServiceRuntime, objectValue, stringValue } from './service.js'
import { type SourceService, type ArkmeSourceRefPayload } from './source-service.js'
import { readTopicMetadata } from './topic-metadata.js'
import { readTopicRecordPage } from './topic-record-page.js'

const LIMIT = 20
const CURSOR_TTL = 15 * 60_000
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const num = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0
const obj = (value: unknown): Record<string, unknown> => {
  if (typeof value === 'string') { try { return objectValue(JSON.parse(value)) } catch { return {} } }
  return objectValue(value)
}
interface Position { latitude: number; longitude: number; label: string; address: string }
function position(raw: Record<string, unknown>): Position | undefined {
  const latitude = raw.lat ?? raw.latitude, longitude = raw.lon ?? raw.lng ?? raw.longitude
  if (!validLocation(latitude, longitude) || latitude === 0 && longitude === 0) return
  return { latitude: latitude as number, longitude: longitude as number,
    label: stringValue(raw.poi_name ?? raw.poiName ?? raw.name ?? raw.address).slice(0, 240), address: stringValue(raw.address).slice(0, 240) }
}
interface Stream { ref: string; cursor?: { sendAtMillis: number; itemUid: string }; beforeSequence?: number }
interface Continuation { userId: number; origin: string; identity: string; streams: Stream[]; at: number }

/** Scoped history comes from the same authoritative containers as the timeline.
 * Only compact location projections cross the Host boundary. Each call reads one
 * bounded page; the map can progressively display points without blocking input.
 */
export class ConversationLocationService {
  private cursors = new Map<string, Continuation>()
  constructor(private runtime: ServiceRuntime, private source: SourceService, private privacy: ArkmePrivacyVisibilityService,
    private ownSnapshot: (recordUid: string, signal?: AbortSignal) => Promise<{ locationCapture?: ArkmeRecordLocationCapture; locationLabel?: string }>) {}
  private origin() { return JSON.stringify([this.runtime.config?.recordBaseUrl, this.runtime.config?.chatBaseUrl]) }
  private identity(source: ArkmeSourceRefPayload) { return `${source.kind}:${source.ownerRef}` }
  private invalidCursor(): never { throw new ArkmePluginError('conversation-location-cursor-invalid', '位置读取进度已过期，请刷新后重试', true, 409) }

  async page(query: ConversationLocationQuery, signal?: AbortSignal): Promise<ConversationLocationPage> {
    if (!query || typeof query.sourceRef !== 'string' || !query.sourceRef.trim()
      || query.cursor !== undefined && (typeof query.cursor !== 'string' || query.cursor.length > 100)) this.invalidCursor()
    const session = await this.runtime.requireSession(), origin = this.origin()
    const root = await this.source.openSourceRef(query.sourceRef, session.userId)
    const identity = this.identity(root), now = Date.now()
    for (const [key, value] of this.cursors) if (now - value.at >= CURSOR_TTL) this.cursors.delete(key)
    let streams: Stream[]
    if (query.cursor) {
      const saved = this.cursors.get(query.cursor)
      if (!saved || saved.userId !== session.userId || saved.origin !== origin || saved.identity !== identity) this.invalidCursor()
      streams = saved.streams.map(stream => ({ ...stream }))
    } else if (root.kind === 'topic') {
      const metadata = await readTopicMetadata(this.runtime, session, root.ownerRef, signal)
      if (metadata.privacyState === 2) throw new ArkmePluginError('topic-privacy-locked', '隐私锁主题不能查看位置', false, 403)
      streams = metadata.topicKind === ARKME_DSH_INPUT_TOPIC_KIND ? [] : (await this.source.topicSubtreeSources(query.sourceRef, signal)).map(item => ({ ref: item.sourceRef }))
    } else streams = [{ ref: query.sourceRef }]
    // Recheck the root on continuation too; a retained cursor grants no access.
    if (query.cursor && root.kind === 'topic' && (await readTopicMetadata(this.runtime, session, root.ownerRef, signal)).privacyState === 2) {
      throw new ArkmePluginError('topic-privacy-locked', '隐私锁主题不能查看位置', false, 403)
    }
    const locked = await this.privacy.lockedRecordUids(session, signal)
    const source = await this.source.sourceItem(root)
    const stream = streams[0]
    if (!stream) return { items: [], scanned: 0, hasMore: false }
    const current = await this.source.openSourceRef(stream.ref, session.userId)
    const chat = root.kind === 'private_chat' || root.kind === 'group_chat'
    let rows: unknown[], hasMore: boolean, next: Stream | undefined
    if (chat) {
      const data = await this.runtime.authenticatedChatPost<Record<string, unknown>>('/api/v1/chat/timeline/page', {
        chat_session_uid: root.ownerRef, before_seq: stream.beforeSequence ?? 0, limit: LIMIT,
      }, session, signal, { lane: 'interactive-read' })
      if (!Array.isArray(data.items)) throw new ArkmePluginError('conversation-location-page-invalid', '聊天位置数据不完整，请重试', true, 502)
      rows = data.items; hasMore = data.has_more === true
      const before = num(data.next_before_seq)
      if (hasMore && (!Number.isSafeInteger(before) || before <= 0 || stream.beforeSequence !== undefined && before >= stream.beforeSequence)) this.invalidCursor()
      next = { ref: stream.ref, beforeSequence: before }
    } else if (current.kind === 'topic') {
      const page = await readTopicRecordPage(this.runtime, session, current.ownerRef, { limit: LIMIT, ...(stream.cursor ? { cursor: stream.cursor } : {}), ...(signal ? { signal } : {}) })
      rows = page.privacyState === 2 ? [] : page.records
      hasMore = page.privacyState !== 2 && page.hasMore
      next = { ref: stream.ref, ...(page.nextCursor?.sendAtMillis !== undefined && page.nextCursor.itemUid ? { cursor: { sendAtMillis: page.nextCursor.sendAtMillis, itemUid: page.nextCursor.itemUid } } : {}) }
    } else {
      const data = await this.runtime.authenticatedPost<Record<string, unknown>>(current.kind === 'send_to_self' ? '/api/v1/home/feed/query' : '/api/v1/records/uncategorized/query', {
        limit: LIMIT, ...(current.kind === 'send_to_self' ? { source_kinds: [1, 2] } : {}),
        ...(stream.cursor ? { cursor_send_at: stream.cursor.sendAtMillis, cursor_record_uid: stream.cursor.itemUid } : {}),
      }, session, signal, { lane: 'interactive-read' })
      if (!Array.isArray(data.items)) throw new ArkmePluginError('conversation-location-page-invalid', '发给自己位置数据不完整，请重试', true, 502)
      rows = data.items; hasMore = data.has_more === true
      const sendAt = num(data.next_cursor_send_at), uid = stringValue(data.next_cursor_record_uid)
      if (hasMore && (!sendAt || !uid || stream.cursor && (sendAt > stream.cursor.sendAtMillis || sendAt === stream.cursor.sendAtMillis && uid >= stream.cursor.itemUid))) this.invalidCursor()
      next = { ref: stream.ref, cursor: { sendAtMillis: sendAt, itemUid: uid } }
    }
    const result = new Array<ConversationLocationRecord[]>(rows.length)
    let index = 0
    await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
      while (index < rows.length) {
        signal?.throwIfAborted()
        const offset = index++
        result[offset] = await this.locations(rows[offset], source, root, session, locked, signal)
      }
    }))
    signal?.throwIfAborted()
    if ((await this.runtime.requireSession()).userId !== session.userId || this.origin() !== origin) {
      throw new ArkmePluginError('location-account-changed', '账号已变化，请重新打开位置', false, 409)
    }
    const remaining = hasMore && next ? [next, ...streams.slice(1)] : streams.slice(1)
    if (!remaining.length) return { items: result.flat(), scanned: rows.length, hasMore: false }
    const cursor = randomUUID()
    this.cursors.set(cursor, { userId: session.userId, origin, identity, streams: remaining, at: now })
    while (this.cursors.size > 500) this.cursors.delete(this.cursors.keys().next().value!)
    return { items: result.flat(), scanned: rows.length, hasMore: true, nextCursor: cursor }
  }

  private async locations(value: unknown, source: ArkmeSourceItem, root: ArkmeSourceRefPayload,
    session: ArkmeSessionCredentials, locked: ReadonlySet<string>, signal?: AbortSignal): Promise<ConversationLocationRecord[]> {
    const raw = obj(value), relation = obj(raw.relation), mounted = obj(raw.record)
    const core = { ...obj(raw.record_core ?? raw.record ?? raw), ...obj(mounted.payload) }
    const uid = stringValue(core.record_uid ?? relation.record_uid ?? raw.record_uid), owner = recordOwnerId(relation.record_owner_user_id ?? core.owner_user_id ?? raw.record_owner_user_id ?? raw.owner_user_id)
    const chat = root.kind === 'private_chat' || root.kind === 'group_chat'
    const owned = owner === session.userId
    const mine = chat ? recordOwnerId(relation.sender_user_id ?? raw.sender_user_id ?? owner) === session.userId : owned
    if (!uid || !owner || !chat && !owned || locked.has(uid) && owned
      || arkmePrivacyLockedRecord({ ...raw, record_core: core })
      || mounted.status !== undefined && mounted.status !== 1
      || core.status !== undefined && core.status !== 1 || core.content_access_state !== undefined && core.content_access_state !== 1) return []
    if (relation.status !== undefined && relation.status !== 1) return []
    const payload = { ...obj(core.payload), ...obj(core.content_payload), ...obj(raw.content_payload) }
    const record: ArkmeSearchRecordItem = { recordUid: uid, recordOwnerUserId: owner,
      sourceKind: chat ? 3 : root.kind === 'topic' ? 2 : 1, sourceUid: root.ownerRef,
      routeTargetKind: chat ? 'chat_timeline' : 'record_detail', targetSource: source, sourceTitle: source.displayName,
      sendAtMillis: num(chat ? relation.attach_at ?? raw.attach_at ?? core.send_at : core.send_at ?? raw.send_at),
      title: stringValue(core.title).slice(0, 240), textContent: '', snippet: stringValue(core.text_content ?? payload.text_content).slice(0, 500), media: [], files: [] }
    const sourceType = !chat ? 'quick_note' : mine ? 'my_sent' : root.kind === 'group_chat' ? 'received_group' : 'received_private'
    const key = `${owner}:${uid}:${chat ? stringValue(relation.relation_uid ?? relation.rel_uid) || num(relation.sequence ?? relation.seq ?? raw.sequence) : ''}`
    const items: ConversationLocationRecord[] = []
    const add = (point: Position, kind: 'snapshot' | 'message', suffix: string) => items.push({ ...point,
      key: `${key}:${suffix}`, source: sourceType, locationKind: kind, record,
      label: point.label || point.address || '未命名地点' })
    list(payload.location_mentions).forEach((value, index) => { const point = position(obj(value)); if (point) add(point, 'message', `message:${index}`) })
    // Received rows are limited to the chat's explicitly shared content. Never
    // call a sender's personal record/context endpoint to populate this map.
    if (!mine || !owned) return items
    const capture = obj(core.capture_context ?? obj(core.extra).capture_context)
    if (capture.schema_version === 1 && (core.has_manual_edit === false || core.version === 1)) {
      if (capture.location_state === 'not_recorded') return items
      if (capture.location_state === 'recorded') {
        const point = position(obj(capture.automatic_location))
        if (point) { add(point, 'snapshot', 'snapshot'); return items }
      }
    }
    let snapshot: Awaited<ReturnType<typeof this.ownSnapshot>>
    try {
      snapshot = await this.ownSnapshot(uid, signal)
    } catch (error) {
      signal?.throwIfAborted()
      if (error instanceof ArkmePluginError && [403, 404].includes(error.upstreamStatus ?? error.httpStatus)) return []
      throw error
    }
    const point = snapshot.locationCapture && position({ ...snapshot.locationCapture, poi_name: snapshot.locationLabel })
    if (point) add(point, 'snapshot', 'snapshot')
    return items
  }
}
