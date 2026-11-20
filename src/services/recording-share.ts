import type { RecordingFavoriteSegment, RecordingShareAudio } from '../recording-favorite-contract.js'
import { ArkmePluginError, objectValue as obj } from './service.js'

export const invalidRecordingFavorite = () => new ArkmePluginError('recording-favorite-invalid', '录音收藏数据无效，请刷新重试', false, 502)
export function favoriteInteger(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw invalidRecordingFavorite()
  return value
}
export interface RecordingShareMedia {
  issueChatRecordingMediaRef(user: number, path: string): string
  issueAvatarMediaRef?(user: number, url: string): string | undefined
}

/** Project only the approved selection. A URL must equal its owner's exact binary route. */
export function projectRecordingShare(value: unknown, sendAt: number, path: string, user: number, media: RecordingShareMedia): { segments: RecordingFavoriteSegment[]; audio: RecordingShareAudio } {
  const raw = obj(value), audio = obj(raw.recording_audio)
  if (raw.structured_kind !== 1 || !Array.isArray(raw.long_recording_segments) || !raw.long_recording_segments.length || raw.long_recording_segments.length > 150) throw invalidRecordingFavorite()
  let textLength = 0
  const segments = raw.long_recording_segments.map(value => {
    const row = obj(value), start = favoriteInteger(row.start_millis), end = favoriteInteger(row.end_millis)
    if (end <= start || typeof row.text !== 'string' || row.text.length > 100_000 || (textLength += row.text.length) > 512_000) throw invalidRecordingFavorite()
    const speaker = favoriteInteger(row.speaker_number ?? 0)
    const avatar = typeof row.speaker_avatar_url === 'string' ? media.issueAvatarMediaRef?.(user, row.speaker_avatar_url) : undefined
    return { speakerNumber: speaker, speakerName: typeof row.speaker_label === 'string' && row.speaker_label.trim() ? row.speaker_label.slice(0, 200) : `说话人 ${speaker}`,
      textContent: row.text, startMillis: start, endMillis: end,
      occurredAtMillis: favoriteInteger(row.occurred_at ?? sendAt + start, 1), ...(avatar ? { speakerAvatarRef: avatar } : {}) }
  })
  const durationMillis = segments.reduce((n, row) => n + row.endMillis - row.startMillis, 0)
  if (!Number.isSafeInteger(durationMillis) || durationMillis <= 0 || audio.duration_millis !== durationMillis || audio.url !== path) throw invalidRecordingFavorite()
  const clips = audio.clips == null ? [{ url: path, duration_millis: durationMillis }] : audio.clips
  if (!Array.isArray(clips) || !clips.length || clips.length > 150 || (audio.clips != null && clips.length !== segments.length)) throw invalidRecordingFavorite()
  // Validate the entire manifest before issuing any media references.
  const verified = clips.map((value, index) => {
    const clip = obj(value), duration = favoriteInteger(clip.duration_millis, 1)
    const expected = audio.clips == null ? path : `${path}/${index}`
    if (clip.url !== expected || (audio.clips != null && duration !== segments[index]!.endMillis - segments[index]!.startMillis)) throw invalidRecordingFavorite()
    return { path: expected, durationMillis: duration }
  })
  return { segments, audio: { durationMillis, clips: verified.map(clip => ({ mediaRef: media.issueChatRecordingMediaRef(user, clip.path), durationMillis: clip.durationMillis })) } }
}
