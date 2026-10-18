import type { ArkmeArkoHistoryItem, ArkmeArkoHistoryPage, ArkmeCalendarBucketDay } from '../types.js'
import { arkmeEmojiPlainText } from './arkme-emoji.js'

export const arkoHistoryKey = (item: ArkmeArkoHistoryItem) => `${item.sessionId}:${item.messageId}`
export function arkoHistoryDate(at: number): string {
  const date = new Date(at)
  if (!Number.isFinite(at) || at <= 0 || Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function sortArkoHistory(items: Iterable<ArkmeArkoHistoryItem>): ArkmeArkoHistoryItem[] {
  return [...items].sort((a, b) => a.createdAtMillis - b.createdAtMillis || a.messageId - b.messageId)
}

/** The service exposes offset pagination only. Stream results, deduplicate and
 * verify the head did not move; never turn a partial/failed read into an export. */
export async function readArkoHistory(
  read: (offset: number, signal: AbortSignal) => Promise<ArkmeArkoHistoryPage>,
  signal: AbortSignal,
  progress: (items: ArkmeArkoHistoryItem[]) => void,
): Promise<ArkmeArkoHistoryItem[]> {
  const items = new Map<string, ArkmeArkoHistoryItem>()
  let offset = 0
  let head: string[] = []
  for (let pageNumber = 0; pageNumber < 1000; pageNumber++) {
    signal.throwIfAborted()
    const page = await read(offset, signal)
    signal.throwIfAborted()
    if (pageNumber === 0) head = page.items.map(arkoHistoryKey)
    for (const item of page.items) items.set(arkoHistoryKey(item), item)
    progress(sortArkoHistory(items.values()))
    if (!page.hasMore && page.nextOffset === undefined) {
      if (pageNumber > 0) {
        const latest = await read(0, signal)
        signal.throwIfAborted()
        if (JSON.stringify(latest.items.map(arkoHistoryKey)) !== JSON.stringify(head)) {
          throw new Error('读取期间对话记录发生变化，请重新读取，避免遗漏消息')
        }
        for (const item of latest.items) items.set(arkoHistoryKey(item), item)
      }
      return sortArkoHistory(items.values())
    }
    if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset! <= offset || page.items.length === 0) {
      throw new Error('历史分页未能继续，当前结果不完整，请重试')
    }
    offset = page.nextOffset!
  }
  throw new Error('历史记录过多，当前结果不完整，需要服务端分页检索支持')
}

export function arkoHistoryDays(items: readonly ArkmeArkoHistoryItem[]): ArkmeCalendarBucketDay[] {
  const days = new Map<string, ArkmeCalendarBucketDay>()
  for (const item of items) {
    const date = arkoHistoryDate(item.createdAtMillis)
    if (!date) continue
    const day = days.get(date) ?? { bucketDate: date, count: 0, protectedCount: 0, hasRecords: true }
    day.count++
    days.set(date, day)
  }
  return [...days.values()].sort((a, b) => a.bucketDate.localeCompare(b.bucketDate))
}

export function searchArkoHistory(items: readonly ArkmeArkoHistoryItem[], query: string) {
  const needle = query.trim().toLocaleLowerCase()
  return needle ? items.filter(item => arkmeEmojiPlainText(item.text).toLocaleLowerCase().includes(needle)).reverse() : []
}

export function exportArkoHistory(items: readonly ArkmeArkoHistoryItem[], name: string, now = new Date()): string {
  const heading = name.replace(/[\r\n]/g, ' ')
  return [`# ${heading} 对话记录`, `导出时间：${now.toLocaleString()} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
    `共 ${items.length} 条消息；保留原文 Markdown。`,
    ...items.map(item => [
      `## ${item.role === 'user' ? '我' : heading} · ${arkoHistoryDate(item.createdAtMillis) ? new Date(item.createdAtMillis).toLocaleString() : '时间未提供'}`,
      `会话 ${item.sessionId} · 消息 ${item.messageId}`,
      arkmeEmojiPlainText(item.text),
    ].join('\n\n')),
  ].join('\n\n') + '\n'
}
