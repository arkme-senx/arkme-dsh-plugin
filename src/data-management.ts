export interface ArkmeDeletedRecord {
  recordUid: string
  version: number
  title: string
  text: string
  sendAtMillis: number
  /** Verified recovery deadline; the service checks this again before restoring. */
  recoverableUntilMillis?: number
}
export interface ArkmeDeletedRecordPage {
  accountScope: string
  items: ArkmeDeletedRecord[]
  /** The mobile contract only exposes the most recent 50; never call this a total. */
  mayHaveMore: boolean
  /** Rows whose lifecycle could not be verified are never offered for recovery. */
  unverifiedCount?: number
}
export interface ArkmeExportPreflight {
  accountScope: string
  canExport: boolean
  recordCount: number
  voiceCount: number
  imageCount: number
  message: string
  latestAtMillis: number
}
