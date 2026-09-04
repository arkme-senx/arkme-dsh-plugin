import type { ArkmeSessionCredentials } from './keychain-store.js'
import type { ArkmeRecordingTranscriptSource } from './types.js'

export const RECORDING_FORWARD_MAX_SEGMENTS = 150
export const RECORDING_FORWARD_MAX_TARGETS = 5

export interface RecordingForwardInput {
  itemRefs: string[]
  targetSourceRef: string
  requestId: string
  recordUid: string
  sendAtMillis: number
  commentText?: string
  commentRecordUid?: string
}

export interface RecordingForwardSelection {
  sessionId: string
  segments: Array<{ childId: string; asrItemIndex: number; transcriptSource: ArkmeRecordingTranscriptSource }>
}

export interface RecordingForwardReceipt {
  recordUid: string
  warningText?: string
}

export interface RecordingForwardGateway {
  supportsRecordTargets(session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<boolean>
  forward(selection: RecordingForwardSelection, input: RecordingForwardInput, session: ArkmeSessionCredentials, signal?: AbortSignal): Promise<RecordingForwardReceipt>
}
