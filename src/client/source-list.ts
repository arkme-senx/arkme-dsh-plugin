import type { ArkmeSourceItem } from '../types.js'

export type ArkmeSourceSort = 'default' | 'latest' | 'most'

const nameCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

function finiteValue(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 0
}

function compareNames(left: ArkmeSourceItem, right: ArkmeSourceItem): number {
  return nameCollator.compare(left.displayName, right.displayName)
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
