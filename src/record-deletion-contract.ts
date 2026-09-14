/** A Record lifecycle observation, never a Chat relation, Agent message or topic membership. */
export interface ArkmeRecordDeletionItem { recordUid: string; version: number }
export interface ArkmeRecordDeletionResult {
  items: Array<ArkmeRecordDeletionItem & (
    { result: 'deleted' | 'unknown' | 'not_attempted' }
    | { result: 'rejected'; message: string }
  )>
}
