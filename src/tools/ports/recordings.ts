import type {
  ArkmeRecordingCalendarMonth,
  ArkmeRecordingCursorPayload,
  ArkmeRecordingDoubaoBackfillResult,
  ArkmeRecordingProjectionKind,
  ArkmeRecordingSection,
  ArkmeRecordingTranscriptSection,
  ArkmeRecordingVersion,
} from '../../types.js'

export interface ArkmeRecordingToolPort {
  recordingCalendar(
    fromStamp: number,
    toStamp: number,
    signal?: AbortSignal,
  ): Promise<ArkmeRecordingCalendarMonth>
  recordingTranscript(
    dateStamp: number,
    signal?: AbortSignal,
    source?: 'system' | 'doubao',
  ): Promise<ArkmeRecordingTranscriptSection>
  startRecordingDoubaoBackfill(
    dateStamp: number,
    signal?: AbortSignal,
  ): Promise<ArkmeRecordingDoubaoBackfillResult>
  recordingProjection(
    dateStamp: number,
    kind: ArkmeRecordingProjectionKind,
    signal?: AbortSignal,
  ): Promise<ArkmeRecordingSection<ArkmeRecordingVersion>>
  sealRecordingCursor(payload: ArkmeRecordingCursorPayload): Promise<string>
  openRecordingCursor(cursor: string): Promise<ArkmeRecordingCursorPayload>
}
