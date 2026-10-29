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

export interface ArkmeRecordExportOptions {
  expectedAccountScope: string
  orderKind: 1 | 2
  /** Creating an export consumes the server's export allowance. */
  confirmed: true
}
export interface ArkmeRecordExportProgress { count: number }
export interface ArkmeRecordExport {
  accountScope: string
  fileRef: string
  fileName: string
  size: number
  expiresAtMillis: number
  count: number
  /** A usable archive is retained even when the final quota acknowledgement is unknown. */
  quotaFinalized: boolean
}
export interface ArkmeRecordExportPort {
  dataExportPreflight(scope: string, signal?: AbortSignal): Promise<ArkmeExportPreflight>
  dataExport(options: ArkmeRecordExportOptions, signal?: AbortSignal, progress?: (value: ArkmeRecordExportProgress) => void): Promise<ArkmeRecordExport>
}
