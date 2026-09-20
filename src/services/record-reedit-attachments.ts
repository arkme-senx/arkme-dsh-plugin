import {
  parseArkmeRecordReeditAttachments,
  type ArkmeRecordReeditAttachmentSelection,
} from '../record-reedit-contract.js'
import type { ArkmeUploadedAsset } from '../types.js'
import type { ArkmeLocalFile } from '../file-transfer-contract.js'
import { ArkmePluginError, objectValue, stringValue } from './service.js'

/** File infrastructure stays behind this port; editing never creates a send task. */
export interface ArkmeRecordReeditFiles {
  files(): Promise<ArkmeLocalFile[]>
  readLocal(fileRef: string): Promise<{ file: ArkmeLocalFile }>
  uploadRefs(fileRefs: readonly string[]): Promise<ArkmeUploadedAsset[]>
  withReferences<T>(fileRefs: readonly string[], userId: number, persist: () => Promise<T>): Promise<T>
}

const invalid = () => new ArkmePluginError('record-reedit-attachment-invalid', '附件引用无效或不属于这条快记，请重新读取后选择', false, 409)
const refs = (payload: Record<string, unknown> | undefined): Record<string, unknown>[] =>
  Array.isArray(payload?.media_refs) ? payload.media_refs.map(objectValue) : []

export function recordReeditIsBackgroundSound(ref: Record<string, unknown>): boolean {
  return ref.content_file_role === 4
}

/** A Live Photo is one editable item with its original companion resources. */
export function recordReeditMediaGroups(payload: Record<string, unknown> | undefined) {
  const media = refs(payload).filter(ref => !recordReeditIsBackgroundSound(ref))
    .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
  return media.filter(ref => ref.render_role !== 4 && ref.render_role !== 2).map(primary => {
    const logicalUid = stringValue(objectValue(primary.dynamic_photo).logical_uid)
    return {
      fileAssetUid: stringValue(primary.file_asset_uid),
      primary,
      refs: [primary, ...media.filter(ref => ref !== primary && ref.render_role === 4
        && logicalUid !== '' && stringValue(objectValue(ref.dynamic_photo).logical_uid) === logicalUid)],
    }
  })
}

export function recordReeditAttachmentSelection(
  value: unknown,
  payload: Record<string, unknown> | undefined,
): ArkmeRecordReeditAttachmentSelection[] {
  let selection: ArkmeRecordReeditAttachmentSelection[]
  try { selection = parseArkmeRecordReeditAttachments(value) } catch { throw invalid() }
  const groups = recordReeditMediaGroups(payload)
  const supported = new Set(groups.map(group => group.fileAssetUid))
  if (selection.some(item => item.fileAssetUid !== undefined && !supported.has(item.fileAssetUid))) throw invalid()
  // Unknown/unpaired auxiliary resources cannot be silently thrown away.
  const grouped = new Set(groups.flatMap(group => group.refs))
  if (refs(payload).some(ref => !recordReeditIsBackgroundSound(ref) && ref.render_role === 4 && !groups.some(group => group.refs.some(item => item.file_asset_uid === ref.file_asset_uid)))) throw invalid()
  if (groups.some(group => group.fileAssetUid === '') || grouped.size !== groups.reduce((sum, group) => sum + group.refs.length, 0)) throw invalid()
  return selection
}

export function recordReeditAttachmentChanges(payload: Record<string, unknown> | undefined, selection: readonly ArkmeRecordReeditAttachmentSelection[]) {
  const old = recordReeditMediaGroups(payload).map(group => group.fileAssetUid)
  const kept = selection.flatMap(item => item.fileAssetUid === undefined ? [] : [item.fileAssetUid])
  return {
    added: selection.length - kept.length,
    removed: old.filter(uid => !kept.includes(uid)).length,
    retained: kept.length,
    reordered: old.filter(uid => kept.includes(uid)).join('\0') !== kept.join('\0'),
  }
}

export function recordReeditWithAttachments(
  payload: Record<string, unknown> | undefined,
  selection: readonly ArkmeRecordReeditAttachmentSelection[],
  uploads: ReadonlyMap<string, ArkmeUploadedAsset>,
): { templateKind: number; contentPayload: Record<string, unknown> } {
  const groups = recordReeditMediaGroups(payload)
  const output = structuredClone(payload ?? { schema_version: 1, text_state: 1 })
  const media = selection.flatMap(item => {
    if (item.fileAssetUid !== undefined) {
      const group = groups.find(value => value.fileAssetUid === item.fileAssetUid)
      if (group === undefined) throw invalid()
      return group.refs.map(ref => structuredClone(ref))
    }
    const asset = uploads.get(item.fileRef)
    if (asset === undefined || asset.fileAssetUid.trim() === '') throw invalid()
    return [{ file_asset_uid: asset.fileAssetUid, render_role: 1, file_name: asset.fileName } as Record<string, unknown>]
  })
  const background = refs(output).filter(recordReeditIsBackgroundSound)
  // Covers are not ordinary editable attachments.
  media.push(...refs(payload).filter(ref => ref.render_role === 2 && !recordReeditIsBackgroundSound(ref)).map(ref => structuredClone(ref)))
  if (new Set(media.map(ref => ref.file_asset_uid)).size !== media.length
    || media.some(ref => background.some(sound => sound.file_asset_uid === ref.file_asset_uid))) {
    throw new ArkmePluginError('record-reedit-attachment-invalid', '部分附件内容重复，请保留一份后重试；草稿已保留', false, 409)
  }
  const hasVoice = stringValue(objectValue(output.voice).source_file_asset_uid) !== ''
  // The voice-only payload forbids media_refs, including retained ambient audio.
  const templateKind = hasVoice ? (media.length + background.length > 0 ? 4 : 3) : (media.length > 0 ? 2 : 1)
  // Record allows repeated references within the same role; retain every ambient occurrence.
  output.media_refs = [...media, ...background].map((ref, sortOrder) => ({ ...ref, sort_order: sortOrder }))
  output.payload_kind = templateKind
  return { templateKind, contentPayload: output }
}
