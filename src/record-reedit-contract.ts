import type { ArkmeContentBlock, ArkmeSourceKind, ArkmeUploadedAsset, ArkmeRecordCaptureContext, ArkmeRecordLocationCapture } from './types.js'
import type { ArkmeTextFormat } from './markdown.js'
import type { ArkmeLocalFile } from './file-transfer-contract.js'

export type ArkmeRecordReeditAttachmentSelection =
  | { fileAssetUid: string; fileRef?: never }
  | { fileRef: string; fileAssetUid?: never }

export class ArkmeRecordReeditDraftConflict extends Error {}

export interface ArkmeRecordReeditCapture {
  completedAtMillis: number
  startedAtMillis?: number
  durationMillis?: number
  captureContext: ArkmeRecordCaptureContext
  location?: ArkmeRecordLocationCapture
  backgroundSound?: { fileRefs: string[]; amplitudes: number[] }
}

export function parseArkmeRecordReeditCapture(raw: unknown): ArkmeRecordReeditCapture {
  const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const value = object(raw)
  const validTime = (time: unknown): time is number => typeof time === 'number' && Number.isSafeInteger(time) && time > 0 && time < 8640000000000000
  if (!validTime(value.completedAtMillis) || value.startedAtMillis !== undefined && (!validTime(value.startedAtMillis) || value.startedAtMillis > value.completedAtMillis)
    || value.durationMillis !== undefined && (typeof value.durationMillis !== 'number' || !Number.isSafeInteger(value.durationMillis) || value.durationMillis < 0 || value.durationMillis > 31 * 86400000)) throw new TypeError('编辑快照时间无效')
  const source = object(value.captureContext)
  const captureContext: ArkmeRecordCaptureContext = {}
  for (const key of ['clientName', 'networkName'] as const) if (typeof source[key] === 'string') captureContext[key] = source[key].trim().slice(0, 120)
  if (typeof source.electric === 'number' && Number.isFinite(source.electric) && source.electric >= 0 && source.electric <= 100) captureContext.electric = Math.trunc(source.electric)
  if ([0, 1, 2, 3].includes(source.charge as number)) captureContext.charge = source.charge as number
  let backgroundSound: ArkmeRecordReeditCapture['backgroundSound']
  if (value.backgroundSound !== undefined) {
    const sound = object(value.backgroundSound)
    if (!Array.isArray(sound.fileRefs) || !sound.fileRefs.length || sound.fileRefs.length > 20
      || sound.fileRefs.some(ref => typeof ref !== 'string' || !/^arkme-file-v1\.[0-9a-f-]{36}$/.test(ref))
      || new Set(sound.fileRefs).size !== sound.fileRefs.length || !Array.isArray(sound.amplitudes) || sound.amplitudes.length > 4096
      || sound.amplitudes.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1)) throw new TypeError('编辑背景音快照无效')
    backgroundSound = { fileRefs: [...sound.fileRefs] as string[], amplitudes: [...sound.amplitudes] as number[] }
  }
  let location: ArkmeRecordLocationCapture | undefined
  if (value.location !== undefined) {
    const point = object(value.location)
    if (typeof point.latitude !== 'number' || !Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90
      || typeof point.longitude !== 'number' || !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180 || !validTime(point.capturedAtMillis)) throw new TypeError('编辑位置快照无效')
    location = { latitude: point.latitude, longitude: point.longitude, capturedAtMillis: point.capturedAtMillis }
    for (const key of ['accuracyMeters', 'altitudeMeters', 'speedMetersPerSecond'] as const) if (typeof point[key] === 'number' && Number.isFinite(point[key])) location[key] = point[key]
  }
  return { completedAtMillis: value.completedAtMillis, captureContext,
    ...(value.startedAtMillis === undefined ? {} : { startedAtMillis: value.startedAtMillis as number }),
    ...(value.durationMillis === undefined ? {} : { durationMillis: value.durationMillis as number }),
    ...(backgroundSound === undefined ? {} : { backgroundSound }), ...(location === undefined ? {} : { location }) }
}

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
  capture?: ArkmeRecordReeditCapture
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
  revisionUid?: string
  editorSnapshot?: { avatar?: string; nickname?: string }
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
