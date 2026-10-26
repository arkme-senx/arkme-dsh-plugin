import type { ArkmeSearchRecordItem } from './types.js'

export type LocationSource = 'quick_note' | 'my_sent' | 'received_private' | 'received_group'
export interface LocationBounds { swLat: number; swLon: number; neLat: number; neLon: number }
/** A viewport with swLon > neLon crosses the date line. Detail bounds never wrap. */
export interface LocationViewport { bounds: LocationBounds; zoom: number }
export interface LocationMarker {
  key: string; latitude: number; longitude: number; count: number
  source: LocationSource; label: string; preview: string
  /** Wide views use disjoint queries. Details must use the producing query/key. */
  clusterQuery?: LocationViewport & { key: string }
}
export interface LocationRecord {
  key: string; latitude: number; longitude: number; label: string; address: string
  source: LocationSource; record: ArkmeSearchRecordItem
}
export interface LocationMarkers { markers: LocationMarker[]; truncated: boolean }
export interface LocationRecords {
  items: LocationRecord[]; hasMore: boolean; nextOffset: number; truncated: boolean
  nextCursor?: { sendAt: number; recordUid: string }
}
export interface LocationQuery {
  mode: 'list' | 'viewport' | 'cluster'
  bounds?: LocationBounds; zoom?: number; clusterKeys?: string[]
  offset?: number; cursor?: { sendAt: number; recordUid: string }
  /** Bound initial reads: one map anchor or a small first page in the record sheet. */
  limit?: number
}
export const worldLocationViewport: LocationViewport = {
  bounds: { swLat: -85, swLon: -180, neLat: 85, neLon: 180 }, zoom: 3,
}
export const locationSources: readonly LocationSource[] = ['quick_note', 'my_sent', 'received_private', 'received_group']
export function validLocation(latitude: unknown, longitude: unknown): boolean {
  return typeof latitude === 'number' && Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && typeof longitude === 'number' && Number.isFinite(longitude) && Math.abs(longitude) <= 180
}

/** The upstream viewport endpoint cannot reliably project a longitude span >180°.
 * Preserve date-line views instead of turning them into an unrelated world query.
 * At most three disjoint parts are needed, with no detail/record hydration. */
export function locationViewportParts({ bounds, zoom }: LocationViewport): LocationViewport[] {
  const ranges = bounds.swLon > bounds.neLon
    ? [[bounds.swLon, 180], [-180, bounds.neLon]] : [[bounds.swLon, bounds.neLon]]
  return ranges.flatMap(([west, east]) => {
    // Zero belongs to the eastern part. The preceding float keeps inclusive
    // upstream bounds disjoint without dropping any representable longitude.
    const parts = east! - west! > 180 ? [[west!, -Number.MIN_VALUE], [0, east!]] : [[west!, east!]]
    return parts.filter(([swLon, neLon]) => swLon! < neLon!).map(([swLon, neLon]) => ({
      bounds: { ...bounds, swLon: swLon!, neLon: neLon! }, zoom,
    }))
  })
}
