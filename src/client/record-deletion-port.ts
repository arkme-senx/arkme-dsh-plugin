import type { ArkmeRecordDeletionResult } from '../record-deletion-contract.js'
import { callArkme } from './api.js'
import { arkmeUi } from './ui-controller.js'
export interface RecordDeletionClientPort {
  delete(sourceRef: string, deletionRefs: readonly string[], signal: AbortSignal): Promise<ArkmeRecordDeletionResult>
}
export const recordDeletionClientPort: RecordDeletionClientPort = {
  async delete(sourceRef, deletionRefs, signal) {
    try { return await callArkme<ArkmeRecordDeletionResult>('source.record-delete', { sourceRef, deletionRefs }, signal) } finally {
      // A lost response may still have changed owner facts. Invalidate readers; never replay a write.
      arkmeUi.recordChanged()
      arkmeUi.chatChanged()
    }
  },
}
