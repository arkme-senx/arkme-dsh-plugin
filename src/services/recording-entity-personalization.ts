import type { RecordingEntityAccuracy, RecordingEntityDay, RecordingEntityOccurrenceContext, RecordingEntityParticipation, RecordingEntityRelevance } from '../recording-entity-contract.js'
import { ArkmePluginError, objectValue } from './service.js'

const invalid = () => new ArkmePluginError('recording-entities-invalid', '实体来源信息无效，请刷新重试', true, 502)
function choice<T extends string>(value: unknown, values: readonly T[]): T {
  if (!values.includes(value as T)) throw invalid()
  return value as T
}
export function entityPersonalization(value: unknown): RecordingEntityDay['personalization'] {
  const raw = objectValue(value)
  // Older owners and future contracts keep the existing full list usable.
  if (raw.contract_version !== 1) return undefined
  if (!Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0 || typeof raw.feedback_supported !== 'boolean') throw invalid()
  return { revision: Number(raw.revision), feedbackSupported: raw.feedback_supported }
}
export function entityRelevance(value: unknown): RecordingEntityRelevance {
  return choice(value, ['self', 'conversation', 'concerned', 'other', 'background', 'unknown'])
}
export function entityAccuracy(value: unknown): RecordingEntityAccuracy {
  return choice(value, ['unverified', 'needs_confirmation', 'confirmed'])
}
export function entityOccurrenceContext(value: unknown, participantKey?: string): RecordingEntityOccurrenceContext | undefined {
  if (value === undefined) return undefined
  const raw = objectValue(value)
  if (raw.speaker_label !== undefined && (typeof raw.speaker_label !== 'string' || raw.speaker_label.length > 200)) throw invalid()
  return {
    relevance: entityRelevance(raw.relevance), accuracy: entityAccuracy(raw.accuracy),
    soundSource: choice(raw.sound_source, ['unknown', 'in_person', 'playback']),
    ...(raw.speaker_label ? { speakerLabel: String(raw.speaker_label) } : {}),
    ...(participantKey ? { participantKey } : {}),
  }
}

export async function entityParticipation(value: unknown, total: number, key: (id: string) => Promise<string>): Promise<RecordingEntityParticipation | undefined> {
  if (value === undefined) return undefined
  const raw = objectValue(value)
  if (raw.contract_version !== 1) return undefined
  const count = (value: unknown) => {
    if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > total) throw invalid()
    return Number(value)
  }
  if (!Array.isArray(raw.participants) || raw.participants.length > 5000) throw invalid()
  const seen = new Set<string>()
  let selfCount = 0
  const participants = await Promise.all(raw.participants.map(async value => {
    const p = objectValue(value)
    if (typeof p.speaker_key !== 'string' || !p.speaker_key || p.speaker_key.length > 1024 || seen.has(p.speaker_key)
      || typeof p.speaker_label !== 'string' || !p.speaker_label.trim() || p.speaker_label.length > 200 || typeof p.is_self !== 'boolean') throw invalid()
    seen.add(p.speaker_key)
    if (p.is_self && ++selfCount > 1) throw invalid()
    const occurrenceCount = count(p.occurrence_count), playbackCount = count(p.playback_count)
    if (!occurrenceCount || playbackCount > occurrenceCount) throw invalid()
    return { key: await key(p.speaker_key), label: p.speaker_label, isSelf: p.is_self, occurrenceCount, playbackCount }
  }))
  const unattributedCount = count(raw.unattributed_count)
  if (participants.reduce((sum, p) => sum + p.occurrenceCount, unattributedCount) !== total) throw invalid()
  return { participants, unattributedCount, conversationCount: count(raw.conversation_count), meaningfulCount: count(raw.meaningful_count) }
}
