import type { ArkmeSourceItem } from '../types.js'

export type ArkmeSourceSort = 'default' | 'latest' | 'most'

const nameCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

function finiteValue(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 0
}

function compareNames(left: ArkmeSourceItem, right: ArkmeSourceItem): number {
  return nameCollator.compare(left.displayName, right.displayName)
}

/** The left "发给自己" entry owns the aggregate and every personal subview beneath it. */
export function isArkmeSelfWorkspaceSource(source: ArkmeSourceItem | undefined): boolean {
  return source === undefined || source.kind === 'send_to_self'
    || source.kind === 'default_category' || source.kind === 'topic'
}

/** Only real chats own rows in the left conversation directory. */
export function isArkmeChatDirectorySource(source: ArkmeSourceItem): boolean {
  return source.kind === 'private_chat' || source.kind === 'group_chat'
}

/** The aggregate is a timeline target, not a category row inside the directory popover. */
export function arkmeSelfDirectorySources(sources: readonly ArkmeSourceItem[]): ArkmeSourceItem[] {
  return sources.filter(source => source.kind !== 'send_to_self')
}

/** Sort a flat source snapshot without mutating the provider-owned order. */
export function sortArkmeSources(
  sources: readonly ArkmeSourceItem[],
  sort: ArkmeSourceSort,
): ArkmeSourceItem[] {
  if (sort === 'default') return [...sources]
  return sources.map((source, index) => ({ source, index })).sort((left, right) => {
    let compared = 0
    if (sort === 'latest') {
      compared = finiteValue(right.source.activeAtMillis) - finiteValue(left.source.activeAtMillis)
    } else if (sort === 'most') {
      compared = finiteValue(right.source.recordCount) - finiteValue(left.source.recordCount)
      if (compared === 0) {
        compared = finiteValue(right.source.activeAtMillis) - finiteValue(left.source.activeAtMillis)
      }
    }
    if (compared !== 0) return compared
    compared = compareNames(left.source, right.source)
    return compared !== 0 ? compared : left.index - right.index
  }).map(item => item.source)
}

export function arkmeSourceTimeLabel(value: number, nowMillis = Date.now()): string {
  if (!Number.isFinite(value) || value <= 0) return ''
  const date = new Date(value)
  const now = new Date(nowMillis)
  if (Number.isNaN(date.getTime()) || Number.isNaN(now.getTime())) return ''
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  if (day === today) {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(date)
  }
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime()
  if (day === yesterday) {
    const time = new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(date)
    return `昨天 ${time}`
  }
  const sixDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime()
  if (day >= sixDaysAgo && day < today) {
    return new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date)
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

export function arkmeSendToSelfDirectoryPresentation(
  source: ArkmeSourceItem | undefined,
  nowMillis = Date.now(),
): { preview: string; time: string } {
  return {
    preview: source?.latestPreview?.trim() || '全部个人消息',
    time: arkmeSourceTimeLabel(source?.activeAtMillis ?? 0, nowMillis),
  }
}
