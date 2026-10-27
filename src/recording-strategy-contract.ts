/** Algorithm identity is separate from the formal/enhanced transcript source. */
export const RECORDING_STRATEGIES = [
  { id: 'baseline-sd-asr/20261026', name: '默认版' },
  { id: 'system-sd-asr/v1', name: '测试版v1' },
] as const
export type RecordingStrategy = typeof RECORDING_STRATEGIES[number]['id']
export function recordingStrategy(value: unknown): RecordingStrategy {
  if (value === undefined || value === '' || value === 'system-sd-asr/v1') return 'system-sd-asr/v1'
  if (value === 'baseline-sd-asr/20261026') return value
  throw new Error('不支持的录音处理策略')
}
export interface RecordingStrategySources {
  items: Array<{ sourceRef: string; fileName: string; startAtMillis: number }>
  nextCursor?: string
}
export interface RecordingStrategyRecordings {
  items: Array<{ sessionRef: string; startAtMillis: number; endAtMillis: number }>
  nextCursor?: string
}
export interface RecordingStrategyOptions {
  strategies: Array<{ id: RecordingStrategy; name: string }>
  officialStrategy: RecordingStrategy
  officialComplete: boolean
  officialFailed: boolean
  expiresAtMillis: number
  canStart: boolean
  results: Array<{ strategy: RecordingStrategy; complete: boolean; failed: boolean }>
}
export interface RecordingStrategyPage {
  items: Array<{ itemRef: string; startAtMillis: number; endAtMillis: number; speaker: number; text: string }>
  nextCursor?: string
  complete: boolean
  failed: boolean
}
export type RecordingStrategyRequest =
  | { action: 'catalog' }
  | { action: 'recordings'; startAtMillis: number; endAtMillis: number; cursor?: string }
  | { action: 'preference'; expectedUserId?: number }
  | { action: 'preference-set'; strategy: RecordingStrategy; expectedUserId?: number }
  | { action: 'sources'; sessionRef: string; cursor?: string }
  | { action: 'sources'; importRef: string; cursor?: string }
  | { action: 'options'; sourceRef: string }
  | { action: 'page'; sourceRef: string; strategy: RecordingStrategy; cursor?: string }
  | { action: 'playback'; itemRef: string }
  | { action: 'start'; sourceRef: string; strategy: RecordingStrategy }

export type RecordingStrategyResponse<T extends RecordingStrategyRequest> =
  T['action'] extends 'recordings' ? RecordingStrategyRecordings :
  T['action'] extends 'preference' | 'preference-set' ? RecordingProcessingPreference :
  T['action'] extends 'catalog' ? Array<{ id: RecordingStrategy; name: string }> :
  T['action'] extends 'sources' ? RecordingStrategySources :
  T['action'] extends 'options' ? RecordingStrategyOptions :
  T['action'] extends 'page' ? RecordingStrategyPage :
  T['action'] extends 'playback' ? import('./types.js').ArkmeRecordingPlayback : { accepted: boolean }

export interface RecordingProcessingPreference { userId: number; strategy: RecordingStrategy }
