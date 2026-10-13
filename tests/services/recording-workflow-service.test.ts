import { describe, expect, it, vi } from 'vitest'
import { recordingWorkflowPage, RecordingWorkflowService } from '../../src/services/recording-workflow-service.js'
import { ArkmePluginError, type ServiceRuntime } from '../../src/services/service.js'
import { validRecordingImportBatch } from '../../src/recording-workflow-contract.js'
const notice = { id: 'notice-0001', batch_id: 'batch-0001', stage: 'processing', state: 'completed', file_count: 2, completed_count: 2, failed_count: 0, created_at: 1000, read_at: 0, message: '', days: [{ date: '2026-10-09', summary: { state: 'pending' }, timeline: { state: 'pending' } }] }
const page = { supported: true, items: [notice], total: 60, unread_count: 55, next_cursor: 'next', through_sequence: '60', latest: notice }
function fixture() {
  let session = { userId: 42, refreshToken: 'test-refresh' }
  const post = vi.fn().mockResolvedValue(page)
  const runtime = { config: { environment: 'test' }, requireSession: async () => session, accountScopedSession: async () => session, authenticatedAudioPost: post } as unknown as ServiceRuntime
  return { service: new RecordingWorkflowService(runtime), post, change: () => { session = { userId: 43, refreshToken: 'other' } } }
}
describe('recording import workflow contract', () => {
  it('keeps authoritative totals and recording calendar dates without issuing generation or writes', async () => {
    const f = fixture()
    expect(await f.service.request({ operation: 'query' })).toMatchObject({ supported: true, total: 60, unreadCount: 55, items: [{ days: [{ date: '2026-10-09' }] }] })
    expect(f.post).toHaveBeenCalledOnce()
    expect(f.post.mock.calls[0]![0]).toBe('/api/v1/audio/import-batches/notifications/query')
  })
  it.each([404, 501])('gracefully disables the absent contract (%s) without failing normal uploads', async status => {
    const f = fixture(); f.post.mockRejectedValue(new ArkmePluginError('missing', 'missing', false, status))
    expect(await f.service.request({ operation: 'capabilities' })).toEqual({ supported: false })
    expect(await f.service.request({ operation: 'query' })).toMatchObject({ supported: false, items: [] })
    await expect(f.service.request({ operation: 'read', accountKey: 'test:42', ids: ['notice-0001'] })).rejects.toThrow()
  })
  it.each([401, 403, 500])('does not misreport an auth error or outage (%s) as unsupported', async status => {
    const f = fixture(); f.post.mockRejectedValue(new ArkmePluginError('failure', 'failure', true, status))
    await expect(f.service.request({ operation: 'query' })).rejects.toThrow('failure')
  })
  it('rejects cross-account writes and discards responses arriving after an account change', async () => {
    const f = fixture()
    await expect(f.service.request({ operation: 'read', accountKey: 'test:43', ids: ['notice-0001'] })).rejects.toThrow('账号已变化')
    expect(f.post).not.toHaveBeenCalled()
    f.post.mockImplementation(async () => { f.change(); return page })
    await expect(f.service.request({ operation: 'query' })).rejects.toThrow('账号已变化')
  })
  it('marks all only through the observed sequence, never future notices', async () => {
    const f = fixture(); f.post.mockResolvedValue({ acknowledged: true })
    await f.service.request({ operation: 'read', accountKey: 'test:42', throughSequence: '60' })
    expect(f.post.mock.calls[0]![1]).toEqual({ through_sequence: '60' })
    f.post.mockResolvedValue({})
    await expect(f.service.request({ operation: 'read', accountKey: 'test:42', ids: ['notice-0001'] })).rejects.toThrow('不完整')
  })
  it.each([
    { ...page, unread_count: 61 },
    { ...page, items: [notice, notice] },
    { ...page, items: [{ ...notice, completed_count: 1 }] },
    { ...page, items: [{ ...notice, days: [{ date: '2026-02-30', summary: { state: 'pending' }, timeline: { state: 'pending' } }] }] },
    { ...page, items: [{ ...notice, stage: 'analysis' }] },
    { ...page, items: [{ ...notice, stage: 'analysis', days: [{ date: '2026-10-09', summary: { state: 'completed' }, timeline: { state: 'failed' } }] }] },
  ])('rejects false completion, invalid dates, missing versions and duplicate events', value => {
    expect(() => recordingWorkflowPage(value)).toThrow()
  })
  it('bounds batch membership and freezes a real timezone for day allocation', () => {
    const batch = { batchId: 'batch-0001', itemIndex: 0, itemCount: 2, timeZone: 'Asia/Shanghai' }
    expect(validRecordingImportBatch(batch)).toBe(true)
    expect(validRecordingImportBatch({ ...batch, itemIndex: 2 })).toBe(false)
    expect(validRecordingImportBatch({ ...batch, timeZone: 'invalid-zone' })).toBe(false)
  })
})
