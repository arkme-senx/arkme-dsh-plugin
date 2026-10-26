import type { PersonalKeywordSummary, PersonalKeywordRecords } from '../analytics-contract.js'
import { ArkmePluginError, objectValue, type ServiceRuntime } from './service.js'
const invalid = () => new ArkmePluginError('keywords-contract', '关键词数据不完整，请刷新统计后重试', false, 409)
const integer = (v: unknown) => { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw invalid(); return v }
const text = (v: unknown) => { if (typeof v !== 'string' || !v || v.length > 4096) throw invalid(); return v }
export class PersonalKeywordService {
  constructor(private readonly runtime: ServiceRuntime) {}
  async read(input: unknown, sources: boolean, signal?: AbortSignal): Promise<PersonalKeywordSummary | PersonalKeywordRecords> {
    const q = objectValue(input), session = await this.runtime.requireSession()
    const guard = async () => {
      signal?.throwIfAborted()
      const current = await this.runtime.requireSession()
      if (current.userId !== session.userId || q.accountScope !== `${this.runtime.config.environment}:${current.userId}`) throw new ArkmePluginError('keywords-account-changed', '账号已变化，请重新打开统计', false, 409)
    }
    await guard()
    const from = integer(q.fromStamp), to = integer(q.toStamp), zone = q.timezoneOffsetMinutes
    if (to < from || to > Date.now() + 60_000 || typeof zone !== 'number' || !Number.isInteger(zone) || Math.abs(zone) > 840 || from > 0 && to - from > 32 * 86400_000) throw invalid()
    const body = { from_stamp: from, to_stamp: to, timezone_offset_minutes: zone, hide_record_pri_lock: true,
      ...(sources ? { snapshot_id: text(q.snapshotId), keyword_id: text(q.keywordId), cursor: q.cursor === undefined ? '' : text(q.cursor), limit: 50 } : {}) }
    let raw: unknown
    try {
      raw = await this.runtime.authenticatedPost<unknown>(`/api/v1/records/analytics/${sources ? 'keyword-records' : 'keywords'}`, body, session, signal, { lane: 'interactive-read', cacheMs: 0, bypassCache: true })
    } catch (error) {
      await guard()
      if (!sources && error instanceof ArkmePluginError && [404, 501].includes(error.upstreamStatus ?? error.httpStatus)) return { keywords: null, snapshotId: null, algorithmVersion: null, coverage: null }
      throw error
    }
    await guard(); const v = objectValue(raw)
    if (!Array.isArray(v.items)) throw invalid()
    if (sources) {
      if (v.snapshot_id !== q.snapshotId || v.keyword_id !== q.keywordId || v.items.length > 50) throw invalid()
      const items = v.items.map(value => { const row = objectValue(value)
        return { recordUid: text(row.record_uid), title: '', textContent: typeof row.text_content === 'string' ? row.text_content : '', sendAtMillis: integer(row.send_at), occurrenceCount: integer(row.occurrence_count) }
      })
      const total = integer(v.total), cursor = v.next_cursor === null ? undefined : text(v.next_cursor)
      if (total < items.length || new Set(items.map(i => i.recordUid)).size !== items.length) throw invalid()
      return { items, total, hasMore: cursor !== undefined, ...(cursor === undefined ? {} : { nextCursor: cursor }) }
    }
    if (v.status !== 'ready' || v.source_scope !== 'personal_records_body' || !Array.isArray(v.effective_range) || v.effective_range[0] !== from || v.effective_range[1] !== to) throw invalid()
    const snapshotId = text(v.snapshot_id), c = objectValue(v.coverage)
    if (c.complete !== true || v.items.length > 50) throw invalid()
    const keywords = v.items.map(value => { const row = objectValue(value), occurrenceCount = integer(row.occurrence_count), recordCount = integer(row.record_count)
      if (recordCount > occurrenceCount || occurrenceCount === 0) throw invalid()
      return { keywordId: text(row.keyword_id), snapshotId, text: text(row.text), occurrenceCount, recordCount }
    })
    return { keywords, snapshotId, algorithmVersion: text(v.algorithm_version), coverage: { complete: true, records: integer(c.records), candidateLimit: integer(c.candidate_limit), returned: integer(c.returned) } }
  }
}
