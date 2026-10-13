import type { ArkmeSearchRecordItem } from './types.js'

export type LocationSource = 'quick_note' | 'my_sent' | 'received_private' | 'received_group'
export interface LocationBounds { swLat: number; swLon: number; neLat: number; neLon: number }
export interface LocationViewport { bounds: LocationBounds; zoom: number }
export interface LocationMarker {
  key: string; latitude: number; longitude: number; count: number
  source: LocationSource; label: string; preview: string
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
}
export const worldLocationViewport: LocationViewport = {
  bounds: { swLat: -85, swLon: -180, neLat: 85, neLon: 180 }, zoom: 3,
}
export const locationSources: readonly LocationSource[] = ['quick_note', 'my_sent', 'received_private', 'received_group']
export function validLocation(latitude: unknown, longitude: unknown): boolean {
  return typeof latitude === 'number' && Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && typeof longitude === 'number' && Number.isFinite(longitude) && Math.abs(longitude) <= 180
}
