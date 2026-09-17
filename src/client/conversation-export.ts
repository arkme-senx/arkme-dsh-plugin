import { tr } from './locale.js'
import type {
  ArkmeSourceItem, ArkmeSourceList, ArkmeTimelineCursor, ArkmeTimelineItem, ArkmeTimelinePage,
} from '../types.js'
import { arkmeTopicPathNames } from './source-tree.js'

const MAX_EXPORT_TIMELINE_PAGES = 10_000
const MAX_EXPORT_TOPIC_PAGES = 100

export interface ArkmeConversationExportProgress {
  itemCount: number
  pageCount: number
}

function cursorKey(cursor: ArkmeTimelineCursor): string {
  return JSON.stringify(cursor)
}

export async function collectArkmeConversationExportItems(
  readPage: (cursor?: ArkmeTimelineCursor) => Promise<ArkmeTimelinePage>,
  signal?: AbortSignal,
  onProgress?: (progress: ArkmeConversationExportProgress) => void,
): Promise<ArkmeTimelineItem[]> {
  const byKey = new Map<string, ArkmeTimelineItem>()
  const visitedCursors = new Set<string>()
  let cursor: ArkmeTimelineCursor | undefined
  for (let pageIndex = 0; pageIndex < MAX_EXPORT_TIMELINE_PAGES; pageIndex += 1) {
    signal?.throwIfAborted()
    const page = await readPage(cursor)
    signal?.throwIfAborted()
    for (const item of page.items) {
      const key = item.timelineItemKey?.trim() || `${item.itemUid}:${String(item.sequence ?? item.sendAtMillis)}`
      byKey.set(key, item)
    }
    onProgress?.({ itemCount: byKey.size, pageCount: pageIndex + 1 })
    if (!page.hasMore) break
    if (page.nextCursor === undefined) throw new Error('导出分页信息不完整，请重试')
    const nextKey = cursorKey(page.nextCursor)
    if (visitedCursors.has(nextKey)) throw new Error('导出分页没有继续推进，请重试')
    visitedCursors.add(nextKey)
    cursor = page.nextCursor
    if (pageIndex === MAX_EXPORT_TIMELINE_PAGES - 1) throw new Error('导出内容过多，请分主题后重试')
  }
  return [...byKey.values()].sort((left, right) => left.sendAtMillis - right.sendAtMillis
    || (left.sequence ?? 0) - (right.sequence ?? 0)
    || left.itemUid.localeCompare(right.itemUid))
}

export async function collectArkmeConversationExportTopics(
  readPage: (cursor?: string) => Promise<ArkmeSourceList>,
  signal?: AbortSignal,
): Promise<ArkmeSourceItem[]> {
  const byKey = new Map<string, ArkmeSourceItem>()
  const visitedCursors = new Set<string>()
  let cursor: string | undefined
  for (let pageIndex = 0; pageIndex < MAX_EXPORT_TOPIC_PAGES; pageIndex += 1) {
    signal?.throwIfAborted()
    const page = await readPage(cursor)
    signal?.throwIfAborted()
    for (const item of page.items) byKey.set(item.topicHierarchyKey ?? item.sourceRef, item)
    if (!page.hasMore) break
    if (page.nextCursor === undefined || page.nextCursor.trim() === '') throw new Error('主题层级分页信息不完整，请重试')
    if (visitedCursors.has(page.nextCursor)) throw new Error('主题层级分页没有继续推进，请重试')
    visitedCursors.add(page.nextCursor)
    cursor = page.nextCursor
    if (pageIndex === MAX_EXPORT_TOPIC_PAGES - 1) throw new Error('主题层级加载未完成，请重试')
  }
  return [...byKey.values()]
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function arkmeConversationExportTimestamp(date: Date): string {
  return `${String(date.getFullYear())}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function localDateTime(date: Date): string {
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function localDate(date: Date): string {
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function localTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function fileSegment(value: string): string {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/gu, ' ').replace(/\s+/gu, ' ').trim().replace(/ /gu, '-') || '未命名'
}

function escapePlainMarkdown(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/([`*_{}\[\]<>#+.!|~-])/gu, '\\$1')
}

function durationLabel(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return tr("未知")
  const rounded = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(rounded / 60)
  const remainder = rounded % 60
  return `${pad(minutes)}:${pad(remainder)}`
}

function topicPathForItem(item: ArkmeTimelineItem, topics: readonly ArkmeSourceItem[]): string {
  const topic = item.selfTopic
  if (topic === undefined) return ''
  const source = topics.find(candidate => candidate.topicHierarchyKey === topic.topicHierarchyKey)
  if (source === undefined) return topic.title?.trim() ?? ''
  return arkmeTopicPathNames(source, topics).join(' / ') || topic.title?.trim() || source.displayName
}

export function arkmeConversationExportScopeLabel(
  source: ArkmeSourceItem,
  topics: readonly ArkmeSourceItem[] = [],
): string {
  if (source.kind === 'send_to_self') return '发给自己 / 全部'
  if (source.kind === 'default_category') return '发给自己 / 未分类'
  if (source.kind === 'topic') {
    const resolved = topics.find(candidate => candidate.topicHierarchyKey !== undefined
      && candidate.topicHierarchyKey === source.topicHierarchyKey) ?? source
    const path = arkmeTopicPathNames(resolved, topics).join(' / ') || source.displayName
    return `发给自己 / ${path}`
  }
  return `${source.kind === 'private_chat' ? tr("私聊") : '群聊'} / ${source.displayName}`
}

export function arkmeConversationExportFileName(
  source: ArkmeSourceItem,
  exportedAt: Date,
  topics: readonly ArkmeSourceItem[] = [],
): string {
  const scope = arkmeConversationExportScopeLabel(source, topics).split(' / ').map(fileSegment).join('-')
  return `${scope}-${arkmeConversationExportTimestamp(exportedAt)}.md`
}

function markdownForItem(item: ArkmeTimelineItem, topics: readonly ArkmeSourceItem[]): string {
  const lines: string[] = [`### ${localTime(new Date(item.sendAtMillis))} · ${escapePlainMarkdown(item.senderName || '未知发送者')}`, '']
  const title = item.title.trim()
  if (title !== '' && title !== item.textContent.trim()) lines.push(`**标题：** ${escapePlainMarkdown(title)}`, '')
  const blocks = [...(item.contentBlocks ?? [])].sort((left, right) => left.sortOrder - right.sortOrder)
  const audio = blocks.filter(block => block.kind === 'audio')
  const text = item.textFormat === 'markdown' ? item.textContent : escapePlainMarkdown(item.textContent)
  if (audio.length > 0) {
    lines.push('- 类型：语音')
    for (const block of audio) {
      const name = block.fileName.trim()
      const fallbackDuration = audio.length === 1 && item.recordDurationMillis !== undefined
        ? item.recordDurationMillis / 1_000
        : undefined
      lines.push(`- 语音${name === '' ? '' : `：${escapePlainMarkdown(name)}`} · 时长：${durationLabel(block.durationSec ?? fallbackDuration)}`)
    }
    lines.push('', '**转写内容：**', '', text.trim() === '' ? '暂无转写内容' : text, '')
  } else if (text.trim() !== '') lines.push(text, '')
  for (const block of blocks.filter(candidate => candidate.kind !== 'audio')) {
    const kind = block.kind === 'image' ? '图片' : block.kind === 'video' ? '视频' : '附件'
    const duration = block.kind === 'video' && block.durationSec !== undefined ? ` · 时长：${durationLabel(block.durationSec)}` : ''
    lines.push(`- ${kind}：${escapePlainMarkdown(block.fileName || '未命名文件')}${duration}`)
  }
  if (item.mediaUnavailable === true) lines.push('- 媒体：部分附件当前不可用')
  const topicPath = topicPathForItem(item, topics)
  if (topicPath !== '') lines.push(`- 主题：${escapePlainMarkdown(topicPath)}`)
  lines.push('', '---', '')
  return lines.join('\n')
}

export function arkmeConversationExportMarkdown(input: {
  source: ArkmeSourceItem
  items: readonly ArkmeTimelineItem[]
  exportedAt: Date
  topics?: readonly ArkmeSourceItem[]
}): string {
  const topics = input.topics ?? []
  const scope = arkmeConversationExportScopeLabel(input.source, topics)
  const lines = [
    `# ${scope}`,
    '',
    `- 导出时间：${localDateTime(input.exportedAt)}`,
    `- 内容数量：${String(input.items.length)}`,
    `- 导出范围：${input.source.kind === 'topic' ? '当前主题及全部子主题' : input.source.kind === 'send_to_self' ? '全部可访问快记' : input.source.kind === 'default_category' ? '未分类快记' : '当前对话全部可访问消息'}`,
    '',
    '---',
    '',
  ]
  let currentDate = ''
  for (const item of input.items) {
    const date = localDate(new Date(item.sendAtMillis))
    if (date !== currentDate) {
      currentDate = date
      lines.push(`## ${date}`, '')
    }
    lines.push(markdownForItem(item, topics))
  }
  if (input.items.length === 0) lines.push('当前范围内没有可导出的内容。', '')
  return `${lines.join('\n').trimEnd()}\n`
}

export function downloadArkmeConversationMarkdown(fileName: string, markdown: string): void {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') throw new Error('当前环境无法下载文件')
  const url = URL.createObjectURL(new Blob(['\uFEFF', markdown], { type: 'text/markdown;charset=utf-8' }))
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.click()
  } finally {
    globalThis.setTimeout(() => { URL.revokeObjectURL(url) }, 0)
  }
}
