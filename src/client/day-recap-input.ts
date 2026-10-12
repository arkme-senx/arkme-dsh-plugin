import { DAY_RECAP_MAX_CHARS, DAY_RECAP_MAX_ITEMS, DAY_RECAP_MAX_EXCERPT_CHARS, dayRecapText, type DayRecapInput, type DayRecapResult } from '../day-recap.js'
import type { ArkmeSharedRecordingPreview } from '../types.js'
import { callArkme } from './api.js'
import { dayActivityLabels, dayActivityTime, dayActivityTitle, type DayActivityEntry, type DayActivityQuery } from './calendar-activity-model.js'

export type DayRecapGenerator = (input: DayRecapInput, signal: AbortSignal) => Promise<DayRecapResult>

/** Explicit allowlist; no object spreading of entries that may contain private source handles. */
export function buildDayRecapInput(query: DayActivityQuery, entries: readonly DayActivityEntry[], sharedTexts = new Map<string, string>()) {
  const items: DayRecapInput['items'] = []
  const sources = new Map<string, { activityId: string; title: string }>()
  for (const entry of entries) {
    if (entry.access !== 'available') continue
    if (items.length >= DAY_RECAP_MAX_ITEMS) break
    const id = `a${items.length + 1}`
    const row = { id, time: dayActivityTime(entry.startAtMillis, query.timezone), kind: dayActivityLabels[entry.kind],
      title: dayRecapText(dayActivityTitle(entry), 80), excerpt: dayRecapText(sharedTexts.get(entry.id) || entry.preview, sharedTexts.has(entry.id) ? DAY_RECAP_MAX_EXCERPT_CHARS : 240),
      scope: dayRecapText(entry.sharedRecording
        ? `${entry.sharedRecording.sourceLabel}；${sharedTexts.has(entry.id) ? '共享文字摘录' : '共享摘要'}；文字快照，不推断同场，不代表完整记录`
        : `${entry.statusLabel || ''}；仅活动预览摘录，不代表完整往来`, 100) }
    if (JSON.stringify([...items, row]).length > DAY_RECAP_MAX_CHARS) break
    items.push(row); sources.set(id, { activityId: entry.id, title: dayActivityTitle(entry) })
  }
  const input: DayRecapInput = { accountScope: query.accountScope, bucketDate: query.bucketDate, timezone: query.timezone, consent: true, items }
  // Bind cached text to both evidence identity and scope, not just coincidentally identical previews.
  const key = JSON.stringify([input, query.kind, query.mode, query.includeBackground, [...sources],
    entries.filter(entry => entry.sharedRecording).map(entry => [entry.id, entry.sharedRecording])])
  return { input, key, sources }
}

/** Reauthorize shared evidence before review and again immediately before generation. */
export async function prepareDayRecapInput(query: DayActivityQuery, entries: readonly DayActivityEntry[], signal: AbortSignal, read: typeof callArkme = callArkme) {
  const texts = new Map<string, string>()
  const candidates = entries.filter(entry => entry.access === 'available').slice(0, DAY_RECAP_MAX_ITEMS)
  for (const entry of candidates) {
    if (!entry.sharedRecording) continue
    signal.throwIfAborted()
    if (!entry.sharedRecording.detailRef) throw new Error('共享录音缺少详情入口，请刷新当天内容后重试')
    const detail = await read<ArkmeSharedRecordingPreview>('source.shared-recording-detail', { detailRef: entry.sharedRecording.detailRef }, signal)
    signal.throwIfAborted()
    if (detail.sourceDigest !== entry.sharedRecording.sourceDigest) throw new Error('共享录音来源已变化，请刷新当天内容')
    texts.set(entry.id, detail.transcript || detail.summary)
  }
  return buildDayRecapInput(query, entries, texts)
}
