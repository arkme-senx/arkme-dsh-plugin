import type { PublicRecordingImportJob, RecordingFileImportInput } from '../../recording-import-contract.js'
import type { PreparedRecordingDirectory, RecordingDirectoryInput, RecordingDirectoryResult } from '../../recording-directory-import.js'
import type {
  ArkmeRecordingCalendarMonth,
  ArkmeRecordingCursorPayload,
  ArkmeRecordingProjectionKind,
  ArkmeRecordingSection,
  ArkmeRecordingTranscriptSection,
  ArkmeRecordingVersion,
} from '../../types.js'

export interface ArkmeRecordingToolPort {
  prepareRecordingDirectory(input: RecordingDirectoryInput, signal?: AbortSignal): Promise<PreparedRecordingDirectory>
  importRecordingDirectory(input: RecordingDirectoryInput, prepared: PreparedRecordingDirectory, signal?: AbortSignal): Promise<RecordingDirectoryResult>
  importRecordingFile(input: RecordingFileImportInput, signal?: AbortSignal): Promise<PublicRecordingImportJob>
  recordingImportStatus(importRef: string): Promise<PublicRecordingImportJob>
  retryRecordingImport(importRef: string, expectedRevision: number, signal?: AbortSignal): Promise<PublicRecordingImportJob>
  recordingCalendar(
    fromStamp: number,
    toStamp: number,
    signal?: AbortSignal,
  ): Promise<ArkmeRecordingCalendarMonth>
  recordingTranscript(
    dateStamp: number,
    signal?: AbortSignal,
  ): Promise<ArkmeRecordingTranscriptSection>
  recordingProjection(
    dateStamp: number,
    kind: ArkmeRecordingProjectionKind,
    signal?: AbortSignal,
  ): Promise<ArkmeRecordingSection<ArkmeRecordingVersion>>
  sealRecordingCursor(payload: ArkmeRecordingCursorPayload): Promise<string>
  openRecordingCursor(cursor: string): Promise<ArkmeRecordingCursorPayload>
}
