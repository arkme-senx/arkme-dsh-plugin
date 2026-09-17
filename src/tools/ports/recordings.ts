import type { ArkmeRecordingSpeakerCandidate, ArkmeRecordingSpeakerPresence, ArkmeRecordingSpeakerMembers } from '../../types.js'
import type { PublicRecordingImportJob, RecordingFileImportInput } from '../../recording-import-contract.js'
import type { PreparedRecordingDirectory, RecordingDirectoryInput, RecordingDirectoryResult } from '../../recording-directory-import.js'

/** Local recording import commands; no retired transcript/calendar/cursor ports. */
export interface ArkmeRecordingToolPort {
  recordingSpeakerOptions(signal?: AbortSignal): Promise<ArkmeRecordingSpeakerCandidate[]>
  recordingSpeakerPresence(signal?: AbortSignal): Promise<ArkmeRecordingSpeakerPresence>
  recordingSpeakerMembers(speakerRef: string, signal?: AbortSignal, expectedVersion?: string): Promise<ArkmeRecordingSpeakerMembers>
  prepareRecordingDirectory(input: RecordingDirectoryInput, signal?: AbortSignal): Promise<PreparedRecordingDirectory>
  importRecordingDirectory(input: RecordingDirectoryInput, prepared: PreparedRecordingDirectory, signal?: AbortSignal): Promise<RecordingDirectoryResult>
  importRecordingFile(input: RecordingFileImportInput, signal?: AbortSignal): Promise<PublicRecordingImportJob>
  recordingImportStatus(importRef: string): Promise<PublicRecordingImportJob>
  retryRecordingImport(importRef: string, expectedRevision: number, signal?: AbortSignal): Promise<PublicRecordingImportJob>
}
