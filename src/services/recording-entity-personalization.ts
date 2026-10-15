import type { RecordingEntityAccuracy, RecordingEntityDay, RecordingEntityOccurrenceContext, RecordingEntityRelevance } from '../recording-entity-contract.js'
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
export function entityOccurrenceContext(value: unknown): RecordingEntityOccurrenceContext | undefined {
  if (value === undefined) return undefined
  const raw = objectValue(value)
  if (raw.speaker_label !== undefined && (typeof raw.speaker_label !== 'string' || raw.speaker_label.length > 200)) throw invalid()
  return {
    relevance: entityRelevance(raw.relevance), accuracy: entityAccuracy(raw.accuracy),
    soundSource: choice(raw.sound_source, ['unknown', 'in_person', 'playback']),
    ...(raw.speaker_label ? { speakerLabel: String(raw.speaker_label) } : {}),
  }
}
