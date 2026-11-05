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
  rangeExportV2?: { chainVersion: number; savedAtMillis: number }
}

export interface ArkmeExportSelection {
  mode: 'all' | 'dates' | 'incremental'
  startDate?: string
  endDate?: string
  timeZone: string
  includeAttachments: boolean
}
export interface ArkmeRangeExportPreview {
  accountScope: string
  supported: boolean
  canExport: boolean
  folderSupported?: boolean
  localReplica?: boolean
  localSnapshotOnly?: boolean
  /** Local counts are exact for the saved replica; pending changes are not counted until written. */
  countsPending?: boolean
  baselineRequired: boolean
  message: string
  previewUid?: string
  selectionFingerprint?: string
  recordCount: number
  imageCount: number
  voiceCount: number
  newCount: number
  updatedCount: number
  removedCount: number
  chainVersion: number
  savedAtMillis: number
}

export interface ArkmeRecordExportOptions {
  expectedAccountScope: string
  orderKind: 1 | 2
  /** Required confirmation; only cloud all/date exports consume the existing allowance. */
  confirmed: true
  selection?: ArkmeExportSelection
  previewUid?: string
  destinationRef?: string
}
export interface ArkmeRecordExportProgress { count: number }
export interface ArkmeRecordExport {
  accountScope: string
  kind?: 'directory'
  directoryRef?: string
  savedAtMillis?: number
  fileRef: string
  fileName: string
  size: number
  expiresAtMillis: number
  count: number
  /** A usable archive is retained even when the final quota acknowledgement is unknown. */
  quotaFinalized: boolean
  savedConfirmationRef?: string
  rangeMode?: ArkmeExportSelection['mode']
  removedCount?: number
}
export interface ArkmeRecordExportPort {
  dataExportPreflight(scope: string, signal?: AbortSignal): Promise<ArkmeExportPreflight>
  dataExport(options: ArkmeRecordExportOptions, signal?: AbortSignal, progress?: (value: ArkmeRecordExportProgress) => void): Promise<ArkmeRecordExport>
}
