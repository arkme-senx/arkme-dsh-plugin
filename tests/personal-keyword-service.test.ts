import { expect, it, vi } from 'vitest'
import { PersonalKeywordService } from '../src/services/personal-keyword-service.js'
import type { ServiceRuntime } from '../src/services/service.js'
const q = { accountScope: 'test:7', fromStamp: 0, toStamp: 100, timezoneOffsetMinutes: 480 }
const summary = { status: 'ready', snapshot_id: 's', algorithm_version: 'v1', source_scope: 'personal_records_body', effective_range: [0, 100], coverage: { complete: true, records: 1, candidate_limit: 50, returned: 1 }, items: [{ keyword_id: 'k', text: '工作', occurrence_count: 3, record_count: 1 }] }
function fixture() {
 let userId = 7
 const post = vi.fn(async () => summary as unknown)
 const runtime = { config: { environment: 'test' }, requireSession: async () => ({ userId }), authenticatedPost: post } as unknown as ServiceRuntime
 return { service: new PersonalKeywordService(runtime), post, change: () => { userId = 8 } }
}
it('reads exact counts and snapshot-bound sources without page/search fallbacks', async () => {
 const f = fixture()
 expect(await f.service.read(q, false)).toMatchObject({ keywords: [{ snapshotId: 's', keywordId: 'k', occurrenceCount: 3, recordCount: 1 }] })
 f.post.mockResolvedValue({ snapshot_id: 's', keyword_id: 'k', items: [{ record_uid: 'r', text_content: '工作工作工作', send_at: 1, occurrence_count: 3 }], total: 1, next_cursor: null })
 expect(await f.service.read({ ...q, snapshotId: 's', keywordId: 'k' }, true)).toMatchObject({ total: 1, hasMore: false, items: [{ recordUid: 'r', occurrenceCount: 3 }] })
 expect(f.post.mock.calls).toHaveLength(2)
})
it('rejects account/range/partial mismatches and late responses after sign-in changes', async () => {
 const f = fixture()
 await expect(f.service.read({ ...q, accountScope: 'test:8' }, false)).rejects.toThrow('账号已变化')
 f.post.mockResolvedValue({ ...summary, effective_range: [1, 100] }); await expect(f.service.read(q, false)).rejects.toThrow('不完整')
 f.post.mockResolvedValue({ ...summary, coverage: { ...summary.coverage, complete: false } }); await expect(f.service.read(q, false)).rejects.toThrow('不完整')
 f.post.mockImplementation(async () => { f.change(); return summary }); await expect(f.service.read(q, false)).rejects.toThrow('账号已变化')
})
