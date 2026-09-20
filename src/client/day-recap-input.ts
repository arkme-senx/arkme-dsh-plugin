import { DAY_RECAP_MAX_CHARS, DAY_RECAP_MAX_ITEMS, dayRecapText, type DayRecapInput, type DayRecapResult } from '../day-recap.js'
import { dayActivityLabels, dayActivityTime, dayActivityTitle, type DayActivityEntry, type DayActivityQuery } from './calendar-activity-model.js'

export type DayRecapGenerator = (input: DayRecapInput, signal: AbortSignal) => Promise<DayRecapResult>

/** Explicit allowlist; no object spreading of entries that may contain private source handles. */
export function buildDayRecapInput(query: DayActivityQuery, entries: readonly DayActivityEntry[]) {
  const items: DayRecapInput['items'] = []
  const sources = new Map<string, { activityId: string; title: string }>()
  for (const entry of entries) {
    if (entry.access !== 'available') continue
    if (items.length >= DAY_RECAP_MAX_ITEMS) break
    const id = `a${items.length + 1}`
    const row = { id, time: dayActivityTime(entry.startAtMillis, query.timezone), kind: dayActivityLabels[entry.kind],
      title: dayRecapText(dayActivityTitle(entry), 80), excerpt: dayRecapText(entry.preview, 240),
      scope: dayRecapText(`${entry.statusLabel || ''}；仅活动预览摘录，不代表完整往来`, 100) }
    if (JSON.stringify([...items, row]).length > DAY_RECAP_MAX_CHARS) break
    items.push(row); sources.set(id, { activityId: entry.id, title: dayActivityTitle(entry) })
  }
  const input: DayRecapInput = { accountScope: query.accountScope, bucketDate: query.bucketDate, timezone: query.timezone, consent: true, items }
  // Bind cached text to both evidence identity and scope, not just coincidentally identical previews.
  const key = JSON.stringify([input, query.kind, query.mode, query.includeBackground, [...sources]])
  return { input, key, sources }
}
