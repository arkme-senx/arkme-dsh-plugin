import { ArkmePluginError } from './services/service.js'

/** Private owner identity. Browser/SDK consumers receive an opaque media ref. */
export interface RecordingPlaybackRef {
  child_id: string
  source: 'primary' | 'enhanced'
  ordinal: number
  audio_revision: string
}

/** A transcript location, resolved by Audio when playback is requested. */
export interface RecordingPlaybackLocator {
  child_id: string
  source: 'primary' | 'enhanced'
  ordinal: number
}

export function recordingPlaybackLocator(value: unknown): RecordingPlaybackLocator | undefined {
  if (value === undefined || value === null) return undefined
  const raw = value as Partial<RecordingPlaybackLocator>
  if (typeof raw !== 'object' || Array.isArray(raw)
    || typeof raw.child_id !== 'string' || !/^[a-f0-9]{24}$/.test(raw.child_id) || /^0{24}$/.test(raw.child_id)
    || (raw.source !== 'primary' && raw.source !== 'enhanced')
    || !Number.isSafeInteger(raw.ordinal) || raw.ordinal! < 0 || raw.ordinal! > 2_147_483_647) {
    throw new ArkmePluginError('recording-media-invalid', '录音媒体定位无效，请刷新后重试', false, 502)
  }
  return { child_id: raw.child_id, source: raw.source, ordinal: raw.ordinal! }
}

export function sameRecordingPlaybackLocation(left: RecordingPlaybackLocator, right: RecordingPlaybackLocator): boolean {
  return left.child_id === right.child_id && left.source === right.source && left.ordinal === right.ordinal
}

export function recordingPlaybackRef(value: unknown): RecordingPlaybackRef | undefined {
  if (value === undefined || value === null) return undefined
  const raw = value as Partial<RecordingPlaybackRef>
  if (typeof raw !== 'object' || Array.isArray(raw)
    || typeof raw.child_id !== 'string' || !/^[a-f0-9]{24}$/.test(raw.child_id) || /^0{24}$/.test(raw.child_id)
    || (raw.source !== 'primary' && raw.source !== 'enhanced')
    || !Number.isSafeInteger(raw.ordinal) || raw.ordinal! < 0 || raw.ordinal! > 2_147_483_647
    || typeof raw.audio_revision !== 'string' || !/^[a-f0-9]{64}$/.test(raw.audio_revision)) {
    throw new ArkmePluginError('recording-media-invalid', '录音媒体引用无效，请刷新后重试', false, 502)
  }
  return { child_id: raw.child_id, source: raw.source, ordinal: raw.ordinal!, audio_revision: raw.audio_revision }
}

export function recordingPlaybackPath(ref: RecordingPlaybackRef): string {
  const value = recordingPlaybackRef(ref)!
  return `/api/v1/audio/clips/${value.child_id}/${value.source}/${String(value.ordinal)}/${value.audio_revision}`
}
