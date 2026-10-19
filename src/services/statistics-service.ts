import type { StatisticsDetail, StatisticsKeyword, StatisticsPoint, StatisticsQuery, StatisticsRecordPage } from '../statistics-contract.js'
import { ArkmePluginError, objectValue, ServiceRuntime } from './service.js'
import { arkmePrivacyLockedRecord, type ArkmePrivacyVisibilityService } from './privacy-visibility.js'

const number = (v: unknown): number | null => (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') && Number.isFinite(Number(v)) ? Number(v) : null
const count = (v: unknown) => { const n = number(v); return n !== null && n >= 0 ? n : null }
const text = (v: unknown) => typeof v === 'string' ? v : ''
const invalid = () => new ArkmePluginError('statistics-response-invalid', '统计数据格式暂不兼容，请稍后重试', false, 502)

export function parseStatisticsDetail(value: unknown): StatisticsDetail {
  const v = objectValue(value)
  if (count(v.record_count) === null) throw invalid()
  const other = count(v.other_words), cjk = count(v.cjk_chars)
  return { firstRecordAt: count(v.first_record_at), days: count(v.days), recordMin: count(v.record_min), recordCount: count(v.record_count),
    wordsCount: count(v.words_count) ?? (other !== null && cjk !== null ? other + cjk : null), subjectCount: count(v.subject_count),
    searchCount: count(v.search_count), viewCount: count(v.view_count), shareCount: count(v.share_count),
    recordMinIncr: number(v.record_min_incr), recordCountIncr: number(v.record_count_incr), wordsCountIncr: number(v.words_count_incr), keywords: null }
}
export function parseStatisticsKeywords(value: unknown, range?: Pick<StatisticsQuery, 'fromStamp' | 'timezoneOffsetMinutes'>): StatisticsKeyword[] | null {
  const v = objectValue(value)
  let raw = v.keywords
  if (raw === undefined) {
    if (range && range.fromStamp > 0) {
      // A legacy summary is all-time. Only its matching duration belongs to this month.
      const date = new Date(range.fromStamp + range.timezoneOffsetMinutes * 60_000)
      const duration = Array.isArray(v.durations) ? v.durations.find(item => {
        const d = objectValue(item)
        return number(d.year) === date.getUTCFullYear() && number(d.month) === date.getUTCMonth() + 1
      }) : undefined
      raw = objectValue(duration).items
    } else raw = v.summary
  }
  const items = Array.isArray(raw) ? raw : objectValue(raw).items
  if (!Array.isArray(items)) return null
  const integer = (value: unknown) => { const n = count(value); return n !== null && Number.isSafeInteger(n) ? n : null }
  return items.map(item => {
    const k = objectValue(item)
    return { text: text(k.text ?? k.keyword ?? k.key).trim(), occurrenceCount: integer(k.occurrence_count ?? k.count), recordCount: integer(k.record_count) }
  }).filter(k => k.text).sort((a, b) => (b.occurrenceCount ?? -1) - (a.occurrenceCount ?? -1) || a.text.localeCompare(b.text))
}
export function parseStatisticsActive(value: unknown): StatisticsPoint[] {
  const v = objectValue(value), result: StatisticsPoint[] = []
  if (!Object.keys(v).some(k => /^w[1-7]$/.test(k))) throw invalid()
  for (let day = 1; day <= 7; day++) {
    const rows = v[`w${day}`]
    if (rows === undefined || rows === null) continue
    if (!Array.isArray(rows)) throw invalid()
    for (const row of rows) {
      const r = objectValue(row), stamp = count(r.stamp), costSec = count(r.cost_sec)
      if (stamp === null || stamp <= 0 || costSec === null) throw invalid()
      result.push({ weekday: day, stamp, costSec })
    }
  }
  return result
}

export class StatisticsService {
  constructor(private readonly runtime: ServiceRuntime, private readonly privacy: Pick<ArkmePrivacyVisibilityService, 'lockedRecordUids'>) {}
  async read(kind: 'detail' | 'active' | 'long', input: unknown, signal?: AbortSignal): Promise<StatisticsDetail | StatisticsPoint[] | StatisticsRecordPage> {
    const q = objectValue(input), session = await this.runtime.requireSession()
    const guard = async () => { signal?.throwIfAborted(); const current = await this.runtime.requireSession()
      if (current.userId !== session.userId || q.accountScope !== `${this.runtime.config.environment}:${current.userId}`)
        throw new ArkmePluginError('statistics-account-changed', '账号已变化，请重新打开统计', false, 409)
    }
    await guard()
    const from = count(q.fromStamp), to = count(q.toStamp), offset = number(q.timezoneOffsetMinutes)
    if (from === null || to === null || to < from || to > Date.now() + 60_000 || offset === null || Math.abs(offset) > 840
      || (from > 0 && to - from > 32 * 86400_000)) throw new ArkmePluginError('statistics-range-invalid', '统计时间范围无效', false, 400)
    const body: Record<string, unknown> = { from_stamp: from, to_stamp: to, timezone_offset_minutes: offset, hide_record_pri_lock: true }
    if (kind === 'detail' && from > 0) {
      const previous = count(q.previousFromStamp), previousEnd = count(q.previousToStamp)
      if (previous !== null && previousEnd !== null && previous < from && previousEnd === from - 1 && previousEnd - previous <= 32 * 86400_000) {
        body.pre_from_stamp = previous; body.pre_to_stamp = previousEnd
      }
    }
    const pageOffset = count(q.offset) ?? 0, limit = 20
    if (kind === 'long') { if (!Number.isSafeInteger(pageOffset)) throw invalid(); body.offset = pageOffset; body.limit = limit }
    const suffix = kind === 'active' ? 'active-time' : kind === 'long' ? 'long-time-list' : 'detail'
    const raw = await this.runtime.authenticatedPost<unknown>(`/api/v1/records/analytics/${suffix}`, body, session, signal, { lane: 'interactive-read', cacheMs: 0 })
    await guard()
    if (kind === 'active') return parseStatisticsActive(raw)
    if (kind === 'detail') {
      const result = parseStatisticsDetail(raw)
      // The new mobile contract only exposes keywords when supplied by the owner.
      // Never reuse an all-time cloud under a selected month's label.
      result.keywords = parseStatisticsKeywords(raw, { fromStamp: from, timezoneOffsetMinutes: offset })
      return result
    }
    const v = objectValue(raw)
    if (!Array.isArray(v.items)) throw invalid()
    const locked = await this.privacy.lockedRecordUids(session, signal)
    await guard()
    const items = v.items.flatMap(item => {
      const row = objectValue(item), record = objectValue(row.record), uid = text(record.record_uid)
      if (!uid || locked.has(uid) || arkmePrivacyLockedRecord(record) || arkmePrivacyLockedRecord(row)) return []
      const duration = count(row.cost_sec), stamp = count(record.send_at)
      if (duration === null || stamp === null) throw invalid()
      return [{ uid, title: text(record.title), text: text(record.text_content), sendAt: stamp, costSec: duration }]
    })
    return { items, nextOffset: v.items.length >= limit ? pageOffset + v.items.length : null }
  }
}
