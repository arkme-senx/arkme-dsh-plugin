import { describe, it, expect, vi } from 'vitest'
import { parseStatisticsActive, parseStatisticsDetail, parseStatisticsKeywords, StatisticsService } from '../src/services/statistics-service.js'
import { statisticsDuration, statisticsQuery } from '../src/statistics-contract.js'
import type { ServiceRuntime } from '../src/services/service.js'
const input = { accountScope: 'prod:7', fromStamp: 0, toStamp: Date.now(), timezoneOffsetMinutes: 480 }
function fixture() {
  let userId = 7
  const post = vi.fn().mockResolvedValue({ record_count: 0 })
  const runtime = { config: { environment: 'prod' }, requireSession: async () => ({ userId }), authenticatedPost: post } as unknown as ServiceRuntime
  const privacy = { lockedRecordUids: vi.fn().mockResolvedValue(new Set(['locked'])) }
  return { post, service: new StatisticsService(runtime, privacy), switchAccount: () => { userId = 8 } }
}
describe('statistics owner contract', () => {
  it('keeps absent values distinct from zero and accepts a real zero word count', () => {
    expect(parseStatisticsDetail({ record_count: 0, words_count: 0, other_words: 9, cjk_chars: 10 })).toMatchObject({ recordCount: 0, wordsCount: 0, days: null, keywords: null })
    expect(parseStatisticsDetail({ record_count: 1, other_words: 2, cjk_chars: 3 }).wordsCount).toBe(5)
    expect(() => parseStatisticsDetail({})).toThrow('格式')
  })
  it('distinguishes missing keyword support from an empty result', () => {
    expect(parseStatisticsKeywords({})).toBeNull()
    expect(parseStatisticsKeywords({ summary: [] })).toEqual([])
    expect(parseStatisticsKeywords({ summary: [{ text: '项目', record_count: 0 }] })).toEqual([{ text: '项目', occurrenceCount: null, recordCount: 0 }])
  })
  it('keeps frequency, record count, and extraction weight distinct', () => {
    expect(parseStatisticsKeywords({ keywords: [{ text: '低频', occurrence_count: 2, record_count: 1, weight: 999 }, { text: '高频', count: 5, record_count: 2 }, { text: '未知', weight: 12 }] }))
      .toEqual([{ text: '高频', occurrenceCount: 5, recordCount: 2 }, { text: '低频', occurrenceCount: 2, recordCount: 1 }, { text: '未知', occurrenceCount: null, recordCount: null }])
    expect(parseStatisticsKeywords({ keywords: [{ text: '零', count: 0 }, { text: '无效', count: -1.5 }] }))
      .toEqual([{ text: '零', occurrenceCount: 0, recordCount: null }, { text: '无效', occurrenceCount: null, recordCount: null }])
  })
  it('selects legacy monthly items using the requested timezone, never the global summary', () => {
    const month = { fromStamp: Date.UTC(2026, 7, 31, 16), timezoneOffsetMinutes: 480 }
    const raw = { summary: [{ text: '全局', count: 100 }], durations: [{ year: 2026, month: 9, items: [{ text: '九月', count: 3 }] }] }
    expect(parseStatisticsKeywords(raw, month)).toEqual([{ text: '九月', occurrenceCount: 3, recordCount: null }])
    expect(parseStatisticsKeywords(raw, { ...month, fromStamp: Date.UTC(2026, 8, 30, 16) })).toBeNull()
    expect(parseStatisticsKeywords({ summary: raw.summary }, month)).toBeNull()
    expect(parseStatisticsKeywords({ ...raw, keywords: [] }, month)).toEqual([])
  })
  it('applies the month boundary in the real detail adapter', async () => {
    const f = fixture()
    f.post.mockResolvedValue({ record_count: 1, summary: [{ text: '全年', count: 1000 }] })
    const month = statisticsQuery('prod:7', '2024-03')
    await expect(f.service.read('detail', month)).resolves.toMatchObject({ keywords: null })
  })
  it('rejects malformed active-time rows instead of displaying an empty chart', () => {
    expect(parseStatisticsActive({ w1: [], w7: [] })).toEqual([])
    expect(parseStatisticsActive({ w2: [{ stamp: 1700000000000, cost_sec: 80 }] })).toEqual([{ weekday: 2, stamp: 1700000000000, costSec: 80 }])
    expect(() => parseStatisticsActive({ w2: [{ stamp: 2, cost_sec: 'bad' }] })).toThrow()
  })
  it('always requests private-lock filtering and record service read lane', async () => {
    const f = fixture(); await f.service.read('detail', input)
    expect(f.post).toHaveBeenCalledWith('/api/v1/records/analytics/detail', expect.objectContaining({ hide_record_pri_lock: true, timezone_offset_minutes: 480 }), expect.anything(), undefined, { lane: 'interactive-read', cacheMs: 0 })
  })
  it('rejects cross-account input before network access and stale response after switch', async () => {
    const f = fixture()
    await expect(f.service.read('detail', { ...input, accountScope: 'prod:8' })).rejects.toThrow('账号已变化')
    expect(f.post).not.toHaveBeenCalled()
    f.post.mockImplementationOnce(async () => { f.switchAccount(); return { record_count: 1 } })
    await expect(f.service.read('detail', input)).rejects.toThrow('账号已变化')
  })
  it('preserves transport failures', async () => {
    const f = fixture(); f.post.mockRejectedValueOnce(new Error('offline'))
    await expect(f.service.read('detail', input)).rejects.toThrow('offline')
  })
  it('filters protected records without breaking the server pagination offset', async () => {
    const f = fixture()
    f.post.mockResolvedValue({ items: Array.from({ length: 20 }, (_, i) => ({ cost_sec: 20, record: { record_uid: i ? `r${i}` : 'locked', send_at: 1700000000000, text_content: 'text' } })) })
    const result = await f.service.read('long', input)
    expect(result).toMatchObject({ nextOffset: 20 }); expect((result as { items: unknown[] }).items).toHaveLength(19)
  })
  it('rejects malformed range and pagination before submitting', async () => {
    const f = fixture()
    await expect(f.service.read('detail', { ...input, fromStamp: -1 })).rejects.toThrow('范围')
    await expect(f.service.read('long', { ...input, offset: 0.5 })).rejects.toThrow()
    expect(f.post).not.toHaveBeenCalled()
  })
})
describe('statistics periods', () => {
  it('uses local month boundaries, leap February and the previous month', () => {
    const q = statisticsQuery('prod:7', '2024-03', new Date(2024, 3, 1))
    expect(new Date(q.previousFromStamp!).getDate()).toBe(1)
    expect(new Date(q.previousToStamp!).getDate()).toBe(29)
    expect(new Date(q.toStamp).getMonth()).toBe(2)
    expect(() => statisticsQuery('prod:7', '2024-13')).toThrow()
  })
  it('does not turn missing durations into zero', () => {
    expect(statisticsDuration(null)).toBe('—')
    expect(statisticsDuration(0)).toBe('0 秒')
    expect(statisticsDuration(3660)).toBe('1 小时 1 分')
  })
})
