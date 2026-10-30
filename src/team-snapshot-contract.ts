import type { ArkmeMessageSnapshotDetail } from './types.js'

export type TeamCaptureState = 'recorded' | 'not_recorded' | 'disabled' | 'permission_denied' | 'unavailable' | 'failed'
export interface TeamCaptureContext {
  schema_version: 1
  captured_at: number
  client_name?: string
  device_state: TeamCaptureState
  location_state: TeamCaptureState
  automatic_location?: { lat: number; lon: number; captured_at: number; accuracy_meters?: number }
}
export interface TeamRecordMetadata {
  record_started_at?: number
  send_at: number
  capture_context: TeamCaptureContext
}
export interface TeamEditMetadata {
  revision_uid: string
  revision_edit_at: number
  edit_duration_millis?: number
  edit_capture_context: TeamCaptureContext
}
export interface TeamMessageSnapshot {
  captureStates: {device:TeamCaptureState;location:TeamCaptureState}
  schemaVersion: 1
  recorded: boolean
  version: number
  snapshotVersion: number
  detail: ArkmeMessageSnapshotDetail
}
export interface TeamEditReceipt { revisionUid: string; accepted: boolean; acceptedVersion?: number; currentVersion?: number }
export interface TeamPendingEdit {
  messageKey: string
  protocolVersion: 0 | 1
  messageRef: string
  version: number
  content: import('./team-app-contract.js').TeamContent
  revisionUid: string
  metadataRef?: string
}

const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const known = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const time = (value: unknown): value is number => known(value) && value > 0 && value <= 8640000000000000
const states = new Set<TeamCaptureState>(['recorded', 'not_recorded', 'disabled', 'permission_denied', 'unavailable', 'failed'])
function keys(value: Record<string, unknown>, names: string[]): void { if (Object.keys(value).some(key => !names.includes(key))) throw new TypeError('Invalid Team capture fields') }
export function readTeamCaptureContext(raw: unknown): TeamCaptureContext {
  const v = object(raw)
  keys(v, ['schema_version', 'captured_at', 'client_name', 'device_state', 'location_state', 'automatic_location'])
  if (v.schema_version !== 1 || !time(v.captured_at) || !states.has(v.device_state as TeamCaptureState) || !states.has(v.location_state as TeamCaptureState)
    || v.client_name !== undefined && (typeof v.client_name !== 'string' || new TextEncoder().encode(v.client_name).length > 640)
    || (v.device_state === 'recorded') !== (typeof v.client_name === 'string' && v.client_name.trim() !== '')
    || (v.location_state === 'recorded') !== (v.automatic_location !== undefined)) throw new TypeError('Invalid Team capture')
  const location = v.automatic_location === undefined ? undefined : object(v.automatic_location)
  if (location) {
    keys(location, ['lat', 'lon', 'captured_at', 'accuracy_meters'])
    if (typeof location.lat !== 'number' || !Number.isFinite(location.lat) || Math.abs(location.lat) > 90 || typeof location.lon !== 'number' || !Number.isFinite(location.lon) || Math.abs(location.lon) > 180 || !time(location.captured_at)
      || location.accuracy_meters !== undefined && (typeof location.accuracy_meters !== 'number' || !Number.isFinite(location.accuracy_meters) || location.accuracy_meters < 0)) throw new TypeError('Invalid Team location')
  }
  return { schema_version: 1, captured_at: v.captured_at, device_state: v.device_state as TeamCaptureState, location_state: v.location_state as TeamCaptureState,
    ...(typeof v.client_name === 'string' && v.client_name ? { client_name: v.client_name } : {}),
    ...(location ? { automatic_location: { lat: location.lat as number, lon: location.lon as number, captured_at: location.captured_at as number, ...(location.accuracy_meters === undefined ? {} : { accuracy_meters: location.accuracy_meters as number }) } } : {}) }
}
export function readTeamRecordMetadata(raw: unknown): TeamRecordMetadata {
  const v = object(raw); keys(v, ['record_started_at', 'send_at', 'capture_context'])
  if (!time(v.send_at) || v.record_started_at !== undefined && (!time(v.record_started_at) || v.record_started_at > v.send_at)) throw new TypeError('Invalid Team input time')
  return { ...(v.record_started_at === undefined ? {} : { record_started_at: v.record_started_at as number }), send_at: v.send_at, capture_context: readTeamCaptureContext(v.capture_context) }
}
export function readTeamEditMetadata(raw: unknown): TeamEditMetadata {
  const v = object(raw); keys(v, ['revision_uid', 'revision_edit_at', 'edit_duration_millis', 'edit_capture_context'])
  if (typeof v.revision_uid !== 'string' || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(v.revision_uid) || !time(v.revision_edit_at)
    || v.edit_duration_millis !== undefined && (!known(v.edit_duration_millis) || v.edit_duration_millis > v.revision_edit_at)) throw new TypeError('Invalid Team edit time')
  return { revision_uid: v.revision_uid, revision_edit_at: v.revision_edit_at, ...(v.edit_duration_millis === undefined ? {} : { edit_duration_millis: v.edit_duration_millis as number }), edit_capture_context: readTeamCaptureContext(v.edit_capture_context) }
}

/** Exact canonical Record fields, with no Chat legacy timestamp fallbacks. */
export function decodeTeamMessageSnapshot(raw: unknown, messageRef: string): TeamMessageSnapshot {
  const v = object(raw), c = object(v.capture_context), l = object(c.automatic_location)
  if (v.schema_version !== 1 || !known(v.version) || v.version < 1 || !known(v.snapshot_version) || v.snapshot_version < 1) throw new TypeError('Invalid Team snapshot response')
  const deviceState:TeamCaptureState=states.has(c.device_state as TeamCaptureState)?c.device_state as TeamCaptureState:typeof c.client_name==='string'&&c.client_name?'recorded':'not_recorded'
  const locationState:TeamCaptureState=states.has(c.location_state as TeamCaptureState)?c.location_state as TeamCaptureState:Object.keys(l).length?'recorded':'not_recorded'
  const first = known(v.record_duration_millis), complete = first && v.edit_duration_complete === true && known(v.edit_duration_millis)
  const detail: ArkmeMessageSnapshotDetail = { itemUid: messageRef, textContent: '', backgroundSound: 'unknown', durationState: complete ? 'complete' : first ? 'partial' : 'not-recorded',
    ...(first ? { recordDurationMillis: v.record_duration_millis as number } : {}), ...(known(v.edit_duration_millis) ? { editDurationMillis: v.edit_duration_millis } : {}),
    ...(time(v.record_started_at) ? { startAtMillis: v.record_started_at } : {}), ...(time(v.send_at) ? { completeAtMillis: v.send_at } : {}), ...(time(v.server_synced_at) ? { syncedAtMillis: v.server_synced_at } : {}),
    ...(typeof c.client_name === 'string' && c.client_name ? { captureContext: { clientName: c.client_name } } : {}),
    ...(typeof l.lat === 'number' && typeof l.lon === 'number' && time(l.captured_at) ? { locationCapture: { latitude: l.lat, longitude: l.lon, capturedAtMillis: l.captured_at, ...(typeof l.accuracy_meters === 'number' ? { accuracyMeters: l.accuracy_meters } : {}) } } : {}),
    ...(deviceState==='unavailable'?{captureUnavailable:'发送时设备信息不可用'}:deviceState==='failed'?{captureUnavailable:'发送时设备信息采集失败'}:{})
  }
  return { captureStates:{device:deviceState,location:locationState}, schemaVersion: 1, recorded: v.recorded === true, version: v.version, snapshotVersion: v.snapshot_version, detail }
}

export interface TeamEditCommand { conversationRef: string; messageRef: string; version: number; content: import('./team-app-contract.js').TeamContent; revisionUid: string; metadataRef?: string }
