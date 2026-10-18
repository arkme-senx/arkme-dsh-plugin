import type { ArkmeTimelineItem } from '../types.js'

export function arkmeMessageCopyText(item: ArkmeTimelineItem): string {
  const title = item.title.trim()
  const text = item.textFormat === 'markdown' ? item.textContent : item.textContent.trim()
  if (title !== '' && text !== '') return `${title}\n${text}`
  if (text !== '') return text
  if (title !== '') return title
  if (item.forwardRecords !== undefined) return item.forwardRecords.title
  if (item.sharedRecording !== undefined) return `${item.sharedRecording.title}\n${item.sharedRecording.summary}`.trim()
  if ((item.contentBlocks?.length ?? 0) > 0) return '非文本内容'
  return ''
}

