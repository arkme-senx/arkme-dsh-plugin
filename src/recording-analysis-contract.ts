import type { ModelBinding } from './model-execution.js'
import type { ArkmeRecordingProjectionKind, ArkmeRecordingSummaryModelConfig, ArkmeRecordingSection, ArkmeRecordingVersion } from './types.js'
export type RecordingAnalysisInput =
  | { action: 'models'; kind: ArkmeRecordingProjectionKind }
  | { action: 'select'; kind: ArkmeRecordingProjectionKind; accountScope: string; routeKey: string }
  | { action: 'generate'; kind: ArkmeRecordingProjectionKind; accountScope: string; routeKey: string; dateStamp: number; binding: ModelBinding; window?: import('./types.js').ArkmeRecordingWindow }
  | { action: 'continue'; kind: ArkmeRecordingProjectionKind; accountScope: string; versionId: string; dateStamp: number }
export type RecordingAnalysisResult = { accountScope: string } & (
  | { config: ArkmeRecordingSummaryModelConfig }
  | { effectiveRouteKey: string }
  | { section: ArkmeRecordingSection<ArkmeRecordingVersion> })
