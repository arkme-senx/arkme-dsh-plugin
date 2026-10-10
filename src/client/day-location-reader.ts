import type { ArkmeCalendarRecordItem, ArkmeCalendarRecordLocation, ArkmeRecordLocationObservation } from '../types.js'
import type { DayActivityQuery } from './calendar-activity-model.js'
import { callArkme } from './api.js'

export interface DayLocationPoint {
  id: string
  recordedAtMillis: number
  location: ArkmeRecordLocationObservation
}
export interface DayLocationsSnapshot {
  points: DayLocationPoint[]
  scanned: number
  failed: number
  complete: boolean
}

export function validDeviceLocation(value: ArkmeRecordLocationObservation | undefined): value is ArkmeRecordLocationObservation {
  return !!value && value.source === 'device' && Number.isFinite(value.latitude) && Number.isFinite(value.longitude)
    && Math.abs(value.latitude) <= 90 && Math.abs(value.longitude) <= 180 && (value.latitude !== 0 || value.longitude !== 0)
}

/** Read all raw owner records for the selected day, independent of timeline grouping/filters. */
export async function readDayLocations(query: Pick<DayActivityQuery, 'bucketDate' | 'timezone'>, signal: AbortSignal,
  progress: (snapshot: DayLocationsSnapshot) => void, read: typeof callArkme = callArkme): Promise<DayLocationsSnapshot> {
  const points = new Map<string, DayLocationPoint>(), seenRecords = new Set<string>(), cursors = new Set<string>()
  let cursor: Record<string, unknown> = {}, failed = 0
  const snapshot = (complete: boolean): DayLocationsSnapshot => ({ points: [...points.values()].sort((a, b) =>
    (a.location.capturedAtMillis ?? a.recordedAtMillis) - (b.location.capturedAtMillis ?? b.recordedAtMillis)), scanned: seenRecords.size, failed, complete })
  for (let pageNumber = 0; pageNumber < 200; pageNumber++) {
    signal.throwIfAborted()
    const page = await read<{ items: Array<{ record_projection: ArkmeCalendarRecordItem }>; has_more: boolean; next_cursor?: Record<string, unknown> }>(
      'calendar.activity', { source: 'record', mode: 'details', body: { bucket_date: query.bucketDate, timezone: query.timezone,
        bucket_scope_kind: 1, view_scope_kind: 1, limit: 50, include_location_summary: true, ...cursor } }, signal,
    )
    if (!Array.isArray(page.items)) throw new Error('当天位置数据不完整，请重试')
    const records = page.items.map(item => item.record_projection).filter(item => item?.recordUid && !seenRecords.has(item.recordUid))
    for (let index = 0; index < records.length; index += 2) {
      await Promise.all(records.slice(index, index + 2).map(async record => {
        seenRecords.add(record.recordUid)
        if (record.protected || record.accessState !== 'available') return
        let location = record.locationObservation
        if (record.locationRef) {
          // Recheck current ownership/visibility, including for coordinates supplied by an earlier index.
          try {
            const detail = await read<ArkmeCalendarRecordLocation>('calendar.record-location', { locationRef: record.locationRef }, signal)
            if (detail.recordUid !== record.recordUid) throw new Error('位置记录不匹配')
            location = detail.access === 'available' ? detail.location : undefined
          } catch (error) {
            signal.throwIfAborted()
            failed++; return
          }
        }
        if (validDeviceLocation(location)) points.set(record.recordUid, { id: record.recordUid, recordedAtMillis: record.sendAtMillis, location })
      }))
      signal.throwIfAborted()
      progress(snapshot(false))
    }
    if (!page.has_more) { const result = snapshot(failed === 0); progress(result); return result }
    const key = JSON.stringify(page.next_cursor)
    if (!key || !page.next_cursor || cursors.has(key)) throw new Error('当天位置分页未推进，请重试')
    cursors.add(key); cursor = page.next_cursor
  }
  throw new Error('当天记录较多，位置尚未加载完整')
}
