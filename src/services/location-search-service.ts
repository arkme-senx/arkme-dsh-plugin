import type { LocationQuery, LocationSource, LocationMarkers, LocationRecords } from '../location-search.js'
import { locationSources, validLocation } from '../location-search.js'
import type { ArkmeSearchRecordItem } from '../types.js'
import { ArkmePluginError, ServiceRuntime, objectValue, stringValue } from './service.js'
import { ArkmePrivacyVisibilityService, arkmePrivacyLockedRecord } from './privacy-visibility.js'
import { recordLocationObservation } from '../record-location-observation.js'

const list = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const num = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0
const text = (...values: unknown[]): string => values.map(stringValue).find(value => value.trim() !== '')?.trim() ?? ''
const sourceType = (value: unknown): LocationSource => locationSources.includes(value as LocationSource) ? value as LocationSource : 'quick_note'

/** Same three read-only endpoints as Flutter's static-record-location search. */
export class LocationSearchService {
  constructor(private readonly runtime: ServiceRuntime, private readonly privacy: ArkmePrivacyVisibilityService,
    private readonly records: (items: unknown[], locked: ReadonlySet<string>, signal?: AbortSignal) => Promise<ArkmeSearchRecordItem[]>) {}

  async query(input: LocationQuery, signal?: AbortSignal): Promise<LocationMarkers | LocationRecords> {
    if (!input || !['list', 'viewport', 'cluster'].includes(input.mode)) this.invalid()
    const bounds = input.bounds
    if (bounds && (!validLocation(bounds.swLat, bounds.swLon) || !validLocation(bounds.neLat, bounds.neLon)
      || bounds.swLat >= bounds.neLat || bounds.swLon >= bounds.neLon)) this.invalid()
    if (input.mode !== 'list' && (!bounds || typeof input.zoom !== 'number' || !Number.isFinite(input.zoom) || input.zoom < 1 || input.zoom > 22)) this.invalid()
    if (input.mode === 'cluster' && (!Array.isArray(input.clusterKeys) || input.clusterKeys.length === 0 || input.clusterKeys.length > 80
      || input.clusterKeys.some(key => typeof key !== 'string' || !key.trim() || key.length > 256))) this.invalid()
    if (input.cursor && (!Number.isFinite(input.cursor.sendAt) || input.cursor.sendAt <= 0 || typeof input.cursor.recordUid !== 'string' || !input.cursor.recordUid.trim())) this.invalid()
    if (input.offset !== undefined && (!Number.isInteger(input.offset) || input.offset < 0)) this.invalid()
    const session = await this.runtime.requireSession()
    const locked = await this.privacy.lockedRecordUids(session, signal)
    const body = {
      ...(bounds ? { bounds: { sw_lat: bounds.swLat, sw_lon: bounds.swLon, ne_lat: bounds.neLat, ne_lon: bounds.neLon } } : {}),
      ...(input.mode === 'list' ? { limit: 20, ...(input.cursor ? { cursor_send_at: input.cursor.sendAt, cursor_record_uid: input.cursor.recordUid } : {}) }
        : input.mode === 'viewport' ? { zoom: input.zoom, limit_hint: 80 }
          : { zoom: input.zoom, cluster_keys: input.clusterKeys, limit: 20, offset: input.offset ?? 0 }),
    }
    const suffix = input.mode === 'viewport' ? 'viewport-clusters/query' : input.mode === 'cluster' ? 'clusters/records/query' : 'query'
    const data = await this.runtime.authenticatedPost<Record<string, unknown>>(`/api/v1/records/location/${suffix}`, body, session, signal, { lane: 'interactive-read' })
    if (input.mode === 'viewport') {
      if (!Array.isArray(data.markers)) throw new ArkmePluginError('location-response-invalid', '位置数据格式不完整，请重试', true)
      return { markers: list(data.markers).flatMap(raw => {
        const item = objectValue(raw)
        const key = text(item.cluster_key)
        if (!key || !validLocation(item.center_lat, item.center_lon) || num(item.count) < 1 || arkmePrivacyLockedRecord(item)
          || [item.record_uid, ...list(item.sample_record_uids)].some(uid => locked.has(text(uid)))) return []
        return [{ key, latitude: num(item.center_lat), longitude: num(item.center_lon), count: num(item.count), source: sourceType(item.source_type),
          label: text(item.poi_name, item.location_poi), preview: text(item.preview_text, item.plain_text, item.text_content).slice(0, 180) }]
      }), truncated: data.truncated === true }
    }
    const rawItems = input.mode === 'cluster' ? data.records : data.items
    if (!Array.isArray(rawItems)) throw new ArkmePluginError('location-response-invalid', '位置记录格式不完整，请重试', true)
    const visible = rawItems.map(objectValue).filter(item => validLocation(item.lat, item.lon)
      && !arkmePrivacyLockedRecord(item) && !locked.has(text(item.record_uid, objectValue(item.record_core).record_uid)))
    // The list endpoint returns coordinates and IDs only. As on mobile, enrich
    // the current page from its content owner, with bounded read concurrency.
    const hydrated = new Array<Record<string, unknown> | undefined>(visible.length)
    let index = 0
    await Promise.all(Array.from({ length: Math.min(4, visible.length) }, async () => {
      while (index < visible.length) {
        signal?.throwIfAborted()
        const current = index++, item = visible[current]!
        const owner = item.record_owner_user_id ?? item.owner_user_id ?? objectValue(item.record_core).owner_user_id
        // Received locations must stay on their chat projection. Never read a
        // sender's private record or device-capture context for enrichment.
        if (item.chat_session_uid || (owner !== undefined && String(owner) !== String(session.userId))
          || (text(item.poi_name, item.address) && text(objectValue(item.record_core).text_content, item.preview_text))) {
          hydrated[current] = item; continue
        }
        const uid = text(item.record_uid, objectValue(item.record_core).record_uid)
        try {
          const detail = await this.runtime.authenticatedPost<Record<string, unknown>>('/api/v1/records/detail',
            { record_uid: uid }, session, signal, { lane: 'interactive-read' })
          const core = objectValue(detail.record_core)
          if (text(core.record_uid) !== uid || String(core.owner_user_id) !== String(session.userId)
            || core.status !== 1 || core.content_access_state !== 1 || arkmePrivacyLockedRecord(detail)) continue
          const enriched = { ...item, record_owner_user_id: core.owner_user_id, record_core: core }
          hydrated[current] = enriched
          if (!text(item.poi_name, item.address)) {
            try {
              const context = await this.runtime.authenticatedPost<Record<string, unknown>>('/api/v1/records/location/context/get',
                { record_uid: uid }, session, signal, { lane: 'interactive-read' })
              if (arkmePrivacyLockedRecord(context)) { hydrated[current] = undefined; continue }
              const location = recordLocationObservation(detail, context)
              if ((!context.record_uid || context.record_uid === uid) && location?.label
                && location.latitude === item.lat && location.longitude === item.lon) {
                hydrated[current] = { ...enriched, poi_name: location.label }
              }
            } catch (error) { if (signal?.aborted) throw error }
          }
        } catch (error) {
          if (signal?.aborted) throw error
          if (error instanceof ArkmePluginError && [401, 403, 404].includes(error.upstreamStatus ?? error.httpStatus)) continue
          hydrated[current] = item
        }
      }
    }))
    if ((await this.runtime.requireSession()).userId !== session.userId) {
      throw new ArkmePluginError('location-account-changed', '账号已变化，请重新打开位置', false, 409)
    }
    const originals = hydrated.filter((item): item is Record<string, unknown> => item !== undefined)
    const searchItems = await this.records(originals.map(item => {
      const core = objectValue(item.record_core)
      const chatUid = text(item.chat_session_uid, [3, 4].includes(num(core.origin_kind)) ? core.origin_container_ref : undefined)
      const topicUid = text(item.topic_uid, item.subject_uid)
      const sourceKind = chatUid ? 3 : num(core.origin_kind) === 5 ? 4 : topicUid ? 2 : 1
      const owner = item.record_owner_user_id ?? item.owner_user_id ?? core.owner_user_id
      return { ...item, source_kind: sourceKind, source_uid: chatUid || topicUid || text(core.origin_container_ref),
        route_target_kind: chatUid ? 'chat_timeline' : topicUid ? 'topic' : 'record_detail',
        topic_core: { title: text(item.topic_title) },
        record_core: { ...item, ...core, record_uid: text(item.record_uid, core.record_uid),
          owner_user_id: owner, title: text(core.title, item.title), text_content: text(core.text_content, item.plain_text, item.preview_text, item.text_content),
          content_access_state: arkmePrivacyLockedRecord(item) ? 2 : core.content_access_state ?? item.content_access_state },
      }
    }), locked, signal)
    const items = searchItems.flatMap(record => {
      const item = originals.find(raw => text(raw.record_uid, objectValue(raw.record_core).record_uid) === record.recordUid
        && String(raw.record_owner_user_id ?? raw.owner_user_id ?? objectValue(raw.record_core).owner_user_id ?? '') === String(record.recordOwnerUserId ?? ''))
      if (!item) return []
      const address = text(item.address) || [item.location_city, item.location_county, item.location_road].map(stringValue).filter(Boolean).join(' ')
      return [{ key: `${String(record.recordOwnerUserId ?? '')}:${record.recordUid}`, latitude: num(item.lat), longitude: num(item.lon),
        label: text(item.poi_name, item.location_poi) || address || '未命名地点', address,
        source: item.source_type ? sourceType(item.source_type) : !item.chat_session_uid ? 'quick_note' : String(record.recordOwnerUserId) === String(session.userId) ? 'my_sent' : record.targetSource?.kind === 'group_chat' ? 'received_group' : 'received_private', record }]
    })
    const nextAt = num(data.next_cursor_send_at), nextUid = text(data.next_cursor_record_uid)
    const hasMore = data.has_more === true
    if (hasMore && (input.mode === 'list' ? !nextAt || !nextUid || (nextAt === input.cursor?.sendAt && nextUid === input.cursor.recordUid)
      : !Number.isInteger(data.next_offset) || num(data.next_offset) <= (input.offset ?? 0))) {
      throw new ArkmePluginError('location-cursor-invalid', '位置分页信息不完整，请重试', true)
    }
    return { items, hasMore, nextOffset: num(data.next_offset), truncated: data.truncated === true,
      ...(nextAt && nextUid ? { nextCursor: { sendAt: nextAt, recordUid: nextUid } } : {}) }
  }

  private invalid(): never { throw new ArkmePluginError('location-query-invalid', '位置查询范围无效', false, 400) }
}
