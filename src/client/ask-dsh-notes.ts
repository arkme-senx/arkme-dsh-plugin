import { formatAskDshNote, attachmentDescription, type AskDshNote } from './ask-dsh-markdown.js'
import type { ArkmeContentBlock, ArkmeMessageSnapshotDetail, ArkmeTimelineItem, ArkmeSourceItem, ArkmeConversationMemberItem, ArkmeUserProfile } from '../types.js'
export interface AskDshNoteReader {
  detail(item: ArkmeTimelineItem, signal: AbortSignal): Promise<ArkmeMessageSnapshotDetail>
  original(block: ArkmeContentBlock, signal: AbortSignal): Promise<Blob>
}
/** Reuse viewer-facing names already loaded for the current conversation. No I/O. */
export function askDshNotesWithLocalNames(items: readonly ArkmeTimelineItem[], source: Pick<ArkmeSourceItem, 'kind' | 'displayName'>,
  members: ReadonlyMap<string, Pick<ArkmeConversationMemberItem, 'displayName'>>, profile?: Pick<ArkmeUserProfile, 'displayName' | 'nickname'>): AskDshNote[] {
  return items.map(item => {
    const member = item.memberRef ? members.get(item.memberRef)?.displayName.trim() : undefined
    const name = item.isMe ? profile?.displayName.trim() || profile?.nickname.trim()
      : item.senderKind === 'bot' ? item.senderName
      : source.kind === 'private_chat' ? source.displayName.trim()
      : member && member !== '群成员' ? member : undefined
    return { ...item, senderName: name || item.senderName, exportSourceName: source.displayName }
  })
}

/** Snapshot only selected records; never expand linked/extension records. */
export async function prepareAskDshNotes(items: readonly ArkmeTimelineItem[], reader: AskDshNoteReader, signal: AbortSignal, progress?: (text: string) => void): Promise<File[]> {
  signal.throwIfAborted()
  if (items.length === 0 || items.length > 100) throw new Error('请选择 1 至 100 条快记')
  const resources = new Map<string, { block: ArkmeContentBlock; name: string }>()
  const names = new Set(['快记摘录.md'])
  const uniqueName = (raw: string) => {
    const name = raw.replace(/[\\/\r\n\x00-\x1f]/g, '_').trim() || '附件'
    const dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : ''
    let result = name, index = 2
    while (names.has(result)) result = `${stem} (${index++})${ext}`
    names.add(result); return result
  }
  // Timeline text is complete; folding is presentation only. Read remotely only
  // when the original attachment projection is missing.
  const controller = new AbortController()
  const readSignal = AbortSignal.any([signal, controller.signal])
  const details: ArkmeMessageSnapshotDetail[] = new Array(items.length)
  let next = 0, completed = 0
  try {
    await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
      while (next < items.length) {
        readSignal.throwIfAborted()
        const index = next++
        const item = items[index]!
        const missingMedia = item.attachmentSnapshotUnavailable || item.mediaUnavailable || item.contentBlocks === undefined
          || item.contentBlocks.some(block => (!block.originalRef && !block.localFileRef)
            || (block.dynamicPhoto?.motion && !block.dynamicPhoto.motion.originalRef && !block.dynamicPhoto.motion.localFileRef))
        if (missingMedia) {
          const remote = await reader.detail(item, readSignal)
          if (remote.itemUid !== item.itemUid) throw new Error('快记详情与选中记录不匹配，请刷新后重试')
          // The selected timeline snapshot owns text/title/time; the fallback only repairs media.
          details[index] = { ...remote, title: item.title, textContent: item.textContent, startAtMillis: item.sendAtMillis }
        } else {
          details[index] = { itemUid: item.itemUid, title: item.title, textContent: item.textContent,
            contentBlocks: item.contentBlocks!, backgroundSound: 'unknown', startAtMillis: item.sendAtMillis }
        }
        readSignal.throwIfAborted()
        progress?.(`正在整理快记 ${++completed} / ${items.length}`)
      }
    }))
  } catch (error) { controller.abort(); throw error }
  const sections: string[] = []
  for (const [index, item] of items.entries()) {
    const detail = details[index]!
    signal.throwIfAborted()
    if (detail.itemUid !== item.itemUid) throw new Error('快记详情与选中记录不匹配，请刷新后重试')
    if (detail.mediaUnavailable || detail.contentBlocks === undefined) throw new Error(`${item.title || '快记'}：完整附件清单暂不可用，请重试`)
    const attachments = (blocks: readonly ArkmeContentBlock[], heading: string): string => {
      const rows: string[] = []
      const add = (block: ArkmeContentBlock, role?: string) => {
        const key = block.fileAssetUid || block.originalRef || block.localFileRef
        if (!key || (!block.originalRef && !block.localFileRef)) throw new Error(`${block.fileName || '附件'}：原始附件不可用`)
        let resource = resources.get(key)
        if (!resource) { resource = { block, name: uniqueName(block.fileName) }; resources.set(key, resource) }
        rows.push(`- ${resource.name}｜${attachmentDescription(block)}${role ? `｜${role}` : ''}`)
        return resource.name
      }
      for (const block of [...blocks].sort((a, b) => a.sortOrder - b.sortOrder)) {
        const name = add(block)
        if (block.dynamicPhoto?.motion) add(block.dynamicPhoto.motion, `动态照片「${name}」的运动视频`)
      }
      return rows.length ? `### ${heading}\n\n${rows.join('\n')}` : ''
    }
    sections.push(formatAskDshNote(item, detail, index, attachments))
  }
  const markdown = sections.join('\n\n---\n\n').replace(/arkme-asset:([A-Za-z0-9_-]+)/g, (ref, id: string) => {
    const resource = resources.get(id)
    return resource ? encodeURIComponent(resource.name) : ref
  })
  const files = [new File([`# 快记摘录\n\n${markdown}\n`], '快记摘录.md', { type: 'text/markdown' })]
  for (const [index, { block, name }] of [...resources.values()].entries()) {
    signal.throwIfAborted(); progress?.(`正在准备原始附件 ${index + 1} / ${resources.size}：${name}`)
    try {
      const blob = await reader.original(block, signal)
      signal.throwIfAborted()
      files.push(new File([blob], name, { type: blob.type || block.mimeType || 'application/octet-stream' }))
    } catch (error) {
      signal.throwIfAborted()
      throw new Error(`${name}：${error instanceof Error ? error.message : '下载失败'}`)
    }
  }
  return files
}
