import type { ArkmeContentBlock, ArkmeSourceKind, ArkmeUploadedAsset } from './types.js'
import type { ArkmeTextFormat } from './markdown.js'
import type { ArkmeLocalFile } from './file-transfer-contract.js'

export type ArkmeRecordReeditAttachmentSelection =
  | { fileAssetUid: string; fileRef?: never }
  | { fileRef: string; fileAssetUid?: never }

export class ArkmeRecordReeditDraftConflict extends Error {}

export type ArkmeRecordReeditAttachmentView = (
  | { asset: ArkmeUploadedAsset; localFile?: never }
  | { localFile: ArkmeLocalFile; asset?: never }
) & { selection: ArkmeRecordReeditAttachmentSelection; block?: ArkmeContentBlock; unavailable?: boolean }

/** Only identities are persisted, never browser Files, URLs or host paths. */
export function parseArkmeRecordReeditAttachments(value: unknown): ArkmeRecordReeditAttachmentSelection[] {
  if (!Array.isArray(value) || value.length > 9) throw new TypeError('请选择至多 9 个附件')
  const seen = new Set<string>()
  return value.map(raw => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('附件引用无效')
    const item = raw as Record<string, unknown>
    const asset = item.fileAssetUid
    const file = item.fileRef
    if ((asset === undefined) === (file === undefined)
      || Object.keys(item).some(key => key !== 'fileAssetUid' && key !== 'fileRef')) throw new TypeError('附件必须指定一个资产或本地文件引用')
    const id = asset ?? file
    if (typeof id !== 'string' || id.trim() === '' || id !== id.trim() || id.length > 200
      || (file !== undefined && !/^arkme-file-v1\.[0-9a-f-]{36}$/.test(id))) throw new TypeError('附件引用无效')
    const key = `${asset === undefined ? 'file' : 'asset'}:${id}`
    if (seen.has(key)) throw new TypeError('附件不可重复')
    seen.add(key)
    return asset === undefined ? { fileRef: id } : { fileAssetUid: id }
  })
}

export interface ArkmeRecordReeditPrepareInput {
  sourceRef: string
  itemUid: string
  newText?: string
  newTitle?: string
  attachments?: ArkmeRecordReeditAttachmentSelection[]
  expectedVersion?: number
  expectedDraftRevision?: number
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
  attachmentChanges?: { added: number; removed: number; retained: number; reordered: boolean }
}

export interface ArkmeRecordReeditCommitResult {
  status: 'committed'
  itemUid: string
  version: number
  revisionUid: string
  projectionState: 'pending'
}

/** A local receipt, never a replacement for Record's version or revision. */
export interface ArkmeRecordReeditSubmissionView {
  submissionId: string
  baseVersion: number
  itemUid: string
  state: 'pending' | 'committing' | 'committed' | 'failed' | 'uncertain'
  title: string
  textContent: string
  attachments: ArkmeRecordReeditAttachmentView[]
  voiceFileAssetUid?: string
  voiceBlock?: ArkmeContentBlock
  result?: ArkmeRecordReeditCommitResult
  error?: string
}

/** Host command data; presentation never selects the content to write. */
export interface ArkmeRecordReeditCommand {
  context: ArkmeRecordReeditPreparedContext
  draft: import('./types.js').ArkmeRecordReeditDraft
}

/** Attachment metadata is a display cache; writes use only command.draft selections. */
export interface ArkmeRecordReeditSubmissionCandidate extends ArkmeRecordReeditCommand {
  attachments: ArkmeRecordReeditAttachmentView[]
  voiceFileAssetUid?: string
  voiceBlock?: ArkmeContentBlock
}

/** Host recovery facts are independent of the browser projection. */
export type ArkmeRecordReeditSubmission = ArkmeRecordReeditSubmissionCandidate & { submissionId: string } & (
  | { state: 'pending' | 'failed'; error?: string; result?: never; expectedCommittedFingerprint?: string }
  | { state: 'committing' | 'uncertain'; expectedCommittedFingerprint: string; error?: string; result?: never }
  | { state: 'committed'; result: ArkmeRecordReeditCommitResult; expectedCommittedFingerprint?: string; error?: never }
)

/** Browser-safe editor projection. Owner identity, content fingerprints, and capability internals stay Host-side. */
export interface ArkmeRecordReeditEditorSnapshot {
  sourceRef: string
  itemUid: string
  title: string
  textContent: string
  textFormat?: ArkmeTextFormat
  sendAtMillis: number
  templateKind: number
  displayKind: number
  version: number
  maxTextLength: number
  preservesAttachments: boolean
  attachments: ArkmeRecordReeditAttachmentView[]
  hasVoice: boolean
  voiceBlock?: ArkmeContentBlock
  maxAttachments: number
  draft?: {
    title: string
    textContent: string
    updatedAtMillis: number
    attachments?: ArkmeRecordReeditAttachmentView[]
    baseVersion: number
    draftRevision: number
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
