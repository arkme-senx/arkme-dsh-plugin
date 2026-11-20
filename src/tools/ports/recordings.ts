import type { ArkmeRecordingSpeakerCorrectionContext, ArkmeRecordingSpeakerCorrectionInput, ArkmeRecordingSpeakerCorrectionUndoInput, ArkmeRecordingSpeakerCorrectionResult, ArkmeRecordingSpeakerCorrectionResultQuery } from '../../types.js'
import type { RecordingEntityPort } from '../../recording-entity-contract.js'
import type { ArkmeRecordingSpeakerCandidate, ArkmeRecordingSpeakerPresence, ArkmeRecordingSpeakerMembers } from '../../types.js'
import type { PublicRecordingImportJob, RecordingFileImportInput } from '../../recording-import-contract.js'
import type { PreparedRecordingDirectory, RecordingDirectoryInput, RecordingDirectoryResult } from '../../recording-directory-import.js'

/** Import commands and scoped speaker/entity reads; no retired transcript/calendar/cursor ports. */
export interface ArkmeRecordingToolPort extends RecordingEntityPort {
  recordingFavorites: import('../../recording-favorite-contract.js').RecordingFavoritePort['recordingFavorites']
 recordingVoiceTriggers(action: 'settings' | 'save' | 'page' | 'detail' | 'decide', input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
  recordingDeliveryPage(input: import('../../recording-delivery.js').RecordingDeliveryQuery, signal?: AbortSignal): Promise<import('../../recording-delivery.js').RecordingDeliveryPage>
  recordingFileStorage(input: { sessionRefs: string[] }, signal?: AbortSignal): Promise<import('../../recording-file-storage.js').RecordingFileStoragePage>
  recordingDeletionPlan(input: import('../../recording-deletion-contract.js').RecordingDeletionRequest, signal?: AbortSignal): ReturnType<import('../../recording-deletion-confirmation.js').RecordingDeletionConfirmations['prepare']>
  recordingTranscriptVersions(dateStamp: number, options?: Pick<import('../../types.js').ArkmeRecordingTranscriptPageOptions, 'window' | 'cursor' | 'source' | 'signal'>): Promise<import('../../types.js').ArkmeRecordingTranscriptVersionPage>
  recordingTranscriptPage(dateStamp: number, options?: import('../../types.js').ArkmeRecordingTranscriptPageOptions): Promise<import('../../types.js').ArkmeRecordingTranscriptPage>
  recordingDeletionStatus(planRef: string, signal?: AbortSignal): ReturnType<import('../../recording-deletion-confirmation.js').RecordingDeletionConfirmations['status']>
  recordingSpeakerEvidenceQuery(query: import('../../recording-evidence-contract.js').RecordingEvidenceQuery, signal?: AbortSignal): Promise<import('../../recording-evidence-contract.js').RecordingEvidenceResult>
  previewRecordingSpeakerCorrection(input: ArkmeRecordingSpeakerCorrectionInput, signal?: AbortSignal): Promise<import('../../types.js').ArkmeRecordingSpeakerCorrectionPreview>
  recordingSpeakerCorrectionItems(query: { dateStamp: number; atMillis: number; transcriptSource: 'system' | 'doubao' }, signal?: AbortSignal): Promise<{ items: import('../../types.js').ArkmeRecordingWorkbenchItem[] }>
  recordingSpeakerCorrectionResult(query: ArkmeRecordingSpeakerCorrectionResultQuery, signal?: AbortSignal): Promise<ArkmeRecordingSpeakerCorrectionResult | null>
  recordingSpeakerCorrectionContext(itemRef: string, signal?: AbortSignal): Promise<ArkmeRecordingSpeakerCorrectionContext>
  applyRecordingSpeakerCorrection(input: ArkmeRecordingSpeakerCorrectionInput, signal?: AbortSignal): Promise<ArkmeRecordingSpeakerCorrectionResult>
  undoRecordingSpeakerCorrection(input: ArkmeRecordingSpeakerCorrectionUndoInput, signal?: AbortSignal): Promise<ArkmeRecordingSpeakerCorrectionResult>
  offlineContext: import('../../offline-context-contract.js').OfflineContextPort['offlineContext']
  recordingStrategies(input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
  recordingAnalysis(input: import('../../recording-analysis-contract.js').RecordingAnalysisInput, signal?: AbortSignal): Promise<import('../../recording-analysis-contract.js').RecordingAnalysisResult>
  recordingWorkflow(input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
  recordingSpeakerOptions(signal?: AbortSignal): Promise<ArkmeRecordingSpeakerCandidate[]>
  recordingSpeakerPresence(signal?: AbortSignal): Promise<ArkmeRecordingSpeakerPresence>
  recordingSpeakerMembers(speakerRef: string, signal?: AbortSignal, expectedVersion?: string): Promise<ArkmeRecordingSpeakerMembers>
  prepareRecordingDirectory(input: RecordingDirectoryInput, signal?: AbortSignal): Promise<PreparedRecordingDirectory>
  importRecordingDirectory(input: RecordingDirectoryInput, prepared: PreparedRecordingDirectory, signal?: AbortSignal): Promise<RecordingDirectoryResult>
  importRecordingFile(input: RecordingFileImportInput, signal?: AbortSignal): Promise<PublicRecordingImportJob>
  importRecordingFiles(inputs: RecordingFileImportInput[], signal?: AbortSignal): Promise<import('../../recording-tool-import.js').RecordingFileBatchResult>
  recordingImportStatus(importRef: string): Promise<PublicRecordingImportJob>
  retryRecordingImport(importRef: string, expectedRevision: number, signal?: AbortSignal): Promise<PublicRecordingImportJob>
}
