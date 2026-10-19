import type { ArkmeRecordingSpeakerCorrectionContext, ArkmeRecordingSpeakerCorrectionInput, ArkmeRecordingSpeakerCorrectionUndoInput, ArkmeRecordingSpeakerCorrectionResult, ArkmeRecordingSpeakerCorrectionResultQuery } from '../../types.js'
import type { RecordingEntityPort } from '../../recording-entity-contract.js'
import type { ArkmeRecordingSpeakerCandidate, ArkmeRecordingSpeakerPresence, ArkmeRecordingSpeakerMembers } from '../../types.js'
import type { PublicRecordingImportJob, RecordingFileImportInput } from '../../recording-import-contract.js'
import type { PreparedRecordingDirectory, RecordingDirectoryInput, RecordingDirectoryResult } from '../../recording-directory-import.js'

/** Import commands and scoped speaker/entity reads; no retired transcript/calendar/cursor ports. */
export interface ArkmeRecordingToolPort extends RecordingEntityPort {
  recordingSpeakerCorrectionItems(query: { dateStamp: number; atMillis: number; transcriptSource: 'system' | 'doubao' }, signal?: AbortSignal): Promise<{ items: import('../../types.js').ArkmeRecordingWorkbenchItem[] }>
  recordingSpeakerCorrectionResult(query: ArkmeRecordingSpeakerCorrectionResultQuery, signal?: AbortSignal): Promise<ArkmeRecordingSpeakerCorrectionResult | null>
  recordingSpeakerCorrectionContext(itemRef: string, signal?: AbortSignal): Promise<ArkmeRecordingSpeakerCorrectionContext>
  applyRecordingSpeakerCorrection(input: ArkmeRecordingSpeakerCorrectionInput, signal?: AbortSignal): Promise<ArkmeRecordingSpeakerCorrectionResult>
  undoRecordingSpeakerCorrection(input: ArkmeRecordingSpeakerCorrectionUndoInput, signal?: AbortSignal): Promise<ArkmeRecordingSpeakerCorrectionResult>
  offlineContext: import('../../offline-context-contract.js').OfflineContextPort['offlineContext']
  recordingWorkflow(input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
  recordingSpeakerOptions(signal?: AbortSignal): Promise<ArkmeRecordingSpeakerCandidate[]>
  recordingSpeakerPresence(signal?: AbortSignal): Promise<ArkmeRecordingSpeakerPresence>
  recordingSpeakerMembers(speakerRef: string, signal?: AbortSignal, expectedVersion?: string): Promise<ArkmeRecordingSpeakerMembers>
  prepareRecordingDirectory(input: RecordingDirectoryInput, signal?: AbortSignal): Promise<PreparedRecordingDirectory>
  importRecordingDirectory(input: RecordingDirectoryInput, prepared: PreparedRecordingDirectory, signal?: AbortSignal): Promise<RecordingDirectoryResult>
  importRecordingFile(input: RecordingFileImportInput, signal?: AbortSignal): Promise<PublicRecordingImportJob>
  recordingImportStatus(importRef: string): Promise<PublicRecordingImportJob>
  retryRecordingImport(importRef: string, expectedRevision: number, signal?: AbortSignal): Promise<PublicRecordingImportJob>
}
