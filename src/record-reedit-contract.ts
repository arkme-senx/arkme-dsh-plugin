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

/** Existing identities are looked up in the versioned Record, never supplied by the Browser. */
export interface ArkmeRecordReeditMention {
  originalIndex?: number
  mentionRef?: string
  botRef?: string
  all?: boolean
  displayName: string
  startIndex: number
  length: number
}

export function parseArkmeRecordReeditMentions(value: unknown): ArkmeRecordReeditMention[] {
  if (!Array.isArray(value) || value.length > 100) throw new TypeError('重新编辑 @ 数据无效')
  return value.map(raw => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('重新编辑 @ 数据无效')
    const item = raw as ArkmeRecordReeditMention
    const keys = ['originalIndex', 'mentionRef', 'botRef', 'all'].filter(key => (raw as Record<string, unknown>)[key] !== undefined)
    if (keys.length !== 1 || typeof item.displayName !== 'string' || item.displayName.trim() === ''
      || !Number.isSafeInteger(item.startIndex) || item.startIndex < 0 || !Number.isSafeInteger(item.length) || item.length < 2
      || (item.originalIndex !== undefined && (!Number.isSafeInteger(item.originalIndex) || item.originalIndex < 0))
      || (item.mentionRef !== undefined && (typeof item.mentionRef !== 'string' || item.mentionRef.trim() === ''))
      || (item.botRef !== undefined && (typeof item.botRef !== 'string' || item.botRef.trim() === ''))
      || (item.all !== undefined && item.all !== true)) throw new TypeError('重新编辑 @ 数据无效')
    return { displayName: item.displayName, startIndex: item.startIndex, length: item.length,
      ...(item.originalIndex === undefined ? {} : { originalIndex: item.originalIndex }),
      ...(item.mentionRef === undefined ? {} : { mentionRef: item.mentionRef }),
      ...(item.botRef === undefined ? {} : { botRef: item.botRef }),
      ...(item.all === true ? { all: true } : {}),
    }
  })
}

export interface ArkmeRecordReeditPrepareInput {
  sourceRef: string
  itemUid: string
  newText?: string
  mentions?: ArkmeRecordReeditMention[]
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
  mentions?: ArkmeRecordReeditMention[]
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
  mentions?: ArkmeRecordReeditMention[]
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
    mentions?: ArkmeRecordReeditMention[]
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
