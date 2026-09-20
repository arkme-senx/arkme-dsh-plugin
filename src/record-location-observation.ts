import type { ArkmeRecordLocationObservation } from './types.js'

function object(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') { try { return object(JSON.parse(value)) } catch { return {} } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function text(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim() !== '')?.trim().slice(0, 240)
}
function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Only the owner's explicit device-capture fact is evidence of where a device was.
 * Never inspect content_payload/location_mentions, rich place cards, or forwarded records.
 * A contextual address can enrich a proven fact but cannot create one or change its coordinates.
 */
export function recordLocationObservation(raw: unknown, context?: unknown): ArkmeRecordLocationObservation | undefined {
  const root = object(raw), core = object(root.record_core ?? root.recordCore ?? root.record ?? root)
  const envelope = object(context), detail = object(envelope.data ?? envelope)
  const fact = object(root.location ?? core.location)
  const contextFact = object(detail.location)
  const location = Object.keys(fact).length ? fact : contextFact
  if (location.source_kind !== 1 && location.source_kind !== '1') return undefined
  const latitude = finite(location.lat ?? location.latitude), longitude = finite(location.lon ?? location.longitude)
  if (latitude === undefined || longitude === undefined || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
    || latitude === 0 && longitude === 0) return undefined
  // Do not borrow place labels from a different location fact (e.g. a selected POI).
  const contextMatches = !Object.keys(contextFact).length || (
    (contextFact.source_kind === 1 || contextFact.source_kind === '1')
    && finite(contextFact.lat ?? contextFact.latitude) === latitude && finite(contextFact.lon ?? contextFact.longitude) === longitude)
  const position = object(contextMatches ? detail.position_detail ?? detail.positionDetail
    ?? root.position_detail ?? core.position_detail : root.position_detail ?? core.position_detail)
  const area = [text(position.city), text(position.county), text(position.road), text(position.poi)].filter(Boolean).join('')
  const label = text(location.poi_name, location.poiName, location.address, area, position.address)
  const captured = finite(location.captured_at ?? location.capturedAt)
  const timestamp = captured !== undefined && captured > 0 ? captured < 100_000_000_000 ? captured * 1000 : captured : undefined
  const capturedAtMillis = timestamp !== undefined && Number.isSafeInteger(timestamp) && timestamp <= 8_640_000_000_000_000 ? timestamp : undefined
  const extra = { ...object(root.record_extra), ...object(core.record_extra), ...object(root.extra), ...object(core.extra) }
  const capture = object(root.capture_context ?? core.capture_context ?? extra.capture_context)
  const deviceLabel = text(capture.client_name, capture.clientName)
  const accuracy = finite(location.accuracy_meters ?? location.accuracyMeters ?? location.accuracy)
  return { source: 'device', latitude, longitude,
    ...(label ? { label } : {}), ...(capturedAtMillis === undefined ? {} : { capturedAtMillis }),
    ...(deviceLabel ? { deviceLabel } : {}), ...(accuracy !== undefined && accuracy >= 0 ? { accuracyMeters: accuracy } : {}) }
}
