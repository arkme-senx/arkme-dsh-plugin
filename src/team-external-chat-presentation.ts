import type { ArkmeContentBlock, ArkmeTimelineItem } from './types.js'
import { projectForwardRecordsPreview } from './forward-records-presentation.js'

const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const rows = (v: unknown): unknown[] => Array.isArray(v) ? v : []
const str = (v: unknown): string => typeof v === 'string' ? v : ''
export type SharedMediaPath = Array<string | number>
export interface SharedAttachment { path: SharedMediaPath; file: Record<string, unknown> }

// Only enumerate media in the sent snapshot. Never reopen a forwarded source
// through its ordinary Chat/Record permission or include linked personal data.
export function sharedAttachments(body: Record<string, unknown>): SharedAttachment[] {
  const out = rows(body.media_display_items).map((file, i) => ({ path: ['media_display_items', i] as SharedMediaPath, file: object(file) }))
  const visit = (payload: Record<string, unknown>, path: SharedMediaPath, depth: number) => {
    if (depth > 4) return
    const nested = object(payload.forward_records)
    if (Object.keys(nested).length) { visit(nested, [...path, 'forward_records'], depth); return }
    if (payload.render_kind !== 'forward_records') return
    rows(payload.items).slice(0, 100).forEach((raw, i) => {
      const item = object(raw), itemPath = [...path, 'items', i]
      rows(item.files).forEach((file, index) => out.push({ path: [...itemPath, 'files', index], file: object(file) }))
      rows(object(item.call_record_snapshot).transcript_segments).forEach((rawSegment, index) => {
        const segment = object(rawSegment)
        if (str(segment.audio_url)) out.push({ path: [...itemPath, 'call_record_snapshot', 'transcript_segments', index, 'audio_url'], file: { download_url: segment.audio_url, mime_type: 'audio/wav', file_name: '通话片段' } })
      })
      if (item.forward_records) visit(object(item.forward_records), [...itemPath, 'forward_records'], depth + 1)
    })
  }
  visit(object(body.content_payload), ['content_payload'], 0)
  return out
}

export function sharedAttachmentAt(body: Record<string, unknown>, path: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(path)) return undefined
  return sharedAttachments(body).find(entry => JSON.stringify(entry.path) === JSON.stringify(path))?.file
}

export function sharedContentBlock(file: Record<string, unknown>, mediaRef: string, index: number): ArkmeContentBlock {
  const mime = str(file.mime_type)
  return {
    mediaRef, kind: mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : 'file',
    fileName: str(file.file_name) || str(file.name), mimeType: mime,
    size: typeof file.size === 'number' ? file.size : 0, sortOrder: index,
    fileAssetUid: `media-${index}`,
  }
}

export function sharedForwardPreview(body: Record<string, unknown>, attachments: SharedAttachment[], blocks: ArkmeContentBlock[], actor: number, time: number): ArkmeTimelineItem['forwardRecords'] {
  const result = projectForwardRecordsPreview(object(body.content_payload), actor, time, {
    forwardContentBlocks: (files, _viewer, options) => files.flatMap((file, fileIndex) => {
      const f = object(file)
      const index = attachments.findIndex(entry => entry.file === file || (str(f.download_url) && str(entry.file.download_url) === str(f.download_url)))
      return index < 0 ? [] : [{...blocks[index]!, ...(options?.longArticle ? {fileAssetUid: `media-${fileIndex}`} : {})}]
    }),
  })
  if (result) for (const item of result.items) delete item.senderUserId
  return result
}
