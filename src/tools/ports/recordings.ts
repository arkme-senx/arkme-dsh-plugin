import type { RecordingEntityPort } from '../../recording-entity-contract.js'
import type { ArkmeRecordingSpeakerCandidate, ArkmeRecordingSpeakerPresence, ArkmeRecordingSpeakerMembers } from '../../types.js'
import type { PublicRecordingImportJob, RecordingFileImportInput } from '../../recording-import-contract.js'
import type { PreparedRecordingDirectory, RecordingDirectoryInput, RecordingDirectoryResult } from '../../recording-directory-import.js'

/** Import commands and scoped speaker/entity reads; no retired transcript/calendar/cursor ports. */
export interface ArkmeRecordingToolPort extends RecordingEntityPort {
  recordingSpeakerOptions(signal?: AbortSignal): Promise<ArkmeRecordingSpeakerCandidate[]>
  recordingSpeakerPresence(signal?: AbortSignal): Promise<ArkmeRecordingSpeakerPresence>
  recordingSpeakerMembers(speakerRef: string, signal?: AbortSignal, expectedVersion?: string): Promise<ArkmeRecordingSpeakerMembers>
  prepareRecordingDirectory(input: RecordingDirectoryInput, signal?: AbortSignal): Promise<PreparedRecordingDirectory>
  importRecordingDirectory(input: RecordingDirectoryInput, prepared: PreparedRecordingDirectory, signal?: AbortSignal): Promise<RecordingDirectoryResult>
  importRecordingFile(input: RecordingFileImportInput, signal?: AbortSignal): Promise<PublicRecordingImportJob>
  recordingImportStatus(importRef: string): Promise<PublicRecordingImportJob>
  retryRecordingImport(importRef: string, expectedRevision: number, signal?: AbortSignal): Promise<PublicRecordingImportJob>
}
