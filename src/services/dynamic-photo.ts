import { objectValue, stringValue } from './service.js'

/** Record-owned logical pairing; unrelated videos and background sound never participate. */
export function recordDynamicPhotoGroups(refs: readonly Record<string, unknown>[]) {
  const covers = new Map<string, Record<string, unknown>[]>()
  const motions = new Map<string, Record<string, unknown>[]>()
  for (const ref of refs) {
    if (ref.content_file_role === 4) continue
    const metadata = objectValue(ref.dynamic_photo)
    const uid = stringValue(metadata.logical_uid).trim()
    if (uid === '') continue
    const target = metadata.role === 'cover' && ref.render_role === 1 ? covers
      : metadata.role === 'motion' && ref.render_role === 4 ? motions : undefined
    if (target !== undefined) target.set(uid, [...(target.get(uid) ?? []), ref])
  }
  return [...covers].flatMap(([logicalUid, coverRefs]) => coverRefs.map(cover => ({
    logicalUid,
    cover,
    motion: coverRefs.length === 1 && motions.get(logicalUid)?.length === 1 ? motions.get(logicalUid)![0] : undefined,
  })))
}

export function isRecordDynamicPhotoMotion(ref: Record<string, unknown>): boolean {
  return ref.content_file_role !== 4 && ref.render_role === 4 && objectValue(ref.dynamic_photo).role === 'motion'
}
