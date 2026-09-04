import type { ArkmeSourceKind } from './types.js'

export interface ArkmeRecordReeditPrepareInput {
  sourceRef: string
  itemUid: string
  newText?: string
  newTitle?: string
}

/** Host-only confirmation context. It is never returned as Tool-visible output. */
export interface ArkmeRecordReeditPreparedContext {
  expectedUserId: number
  sourceRef: string
  sourceIdentityKey: string
  sourceKind: ArkmeSourceKind
  sourceDisplayName: string
  itemUid: string
  draftRevision: number
  baseVersion: number
  baseContentFingerprint: string
  oldTitle: string
  oldTextPreview: string
  newTitle: string
  newTextPreview: string
  sendAtMillis: number
  preservesAttachments: boolean
}

export interface ArkmeRecordReeditCommitResult {
  status: 'committed'
  itemUid: string
  version: number
  revisionUid: string
  projectionState: 'pending'
}

/** Browser-safe editor projection. Owner identity, content fingerprints, and capability internals stay Host-side. */
export interface ArkmeRecordReeditEditorSnapshot {
  sourceRef: string
  itemUid: string
  title: string
  textContent: string
  sendAtMillis: number
  templateKind: number
  displayKind: number
  version: number
  maxTextLength: number
  preservesAttachments: boolean
  draft?: {
    title: string
    textContent: string
    updatedAtMillis: number
  }
}

export interface ArkmeRecordReeditDiscardPreparedContext {
  expectedUserId: number
  sourceRef: string
  sourceIdentityKey: string
  sourceDisplayName: string
  itemUid: string
  draftRevision: number
  textPreview: string
}

export interface ArkmeRecordReeditDiscardResult {
  status: 'discarded'
  itemUid: string
}
