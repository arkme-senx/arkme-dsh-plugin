import { describe, it, expect, vi } from 'vitest'
import { DataManagementService, parseDeletedRecords } from '../../src/services/data-management-service.js'

const now = Date.now()
const core = { record_uid: 'record1', version: 3, title: '标题', text_content: '文字', send_at: 12345, update_at: now, status: 2 }
function fixture() {
  let userId = 11
  const post = vi.fn(async (path: string): Promise<unknown> => {
    if (path.endsWith('/list')) return { items: [{ record_core: core }] }
    if (path.endsWith('/recover')) return { record_core: core }
    if (path.endsWith('/latest')) return { latest_at: 0 }
    return { can_export: false, record_count: 10, total_voice_count: 2, total_image_count: 1, quota_message: '今天已导出' }
  })
  const config = { environment: 'prod' }
  const service = new DataManagementService({ config, requireSession: async () => ({ userId }), authenticatedPost: post } as never)
  return { service, post, config, setUser: (id: number) => { userId = id } }
}
describe('data management contracts', () => {
  it('normalizes Flutter record envelopes without implying 50 is a total', () => {
    expect(parseDeletedRecords({ items: [{ record_core: core }] }, 'prod:11')).toMatchObject({ items: [{ recordUid: 'record1', version: 3, text: '文字' }], mayHaveMore: false })
    expect(parseDeletedRecords({ records: Array.from({ length: 50 }, () => core) }, 'prod:11').mayHaveMore).toBe(true)
    expect(parseDeletedRecords({ list: [{ record: core }], has_more: true }, 'prod:11').mayHaveMore).toBe(true)
    expect(parseDeletedRecords({ items: [] }, 'prod:11').items).toEqual([])
  })
  it.each([{}, { items: [{}] }, { items: [{ ...core, version: -1 }] }, { items: [{ ...core, send_at: '123' }] }])('rejects malformed lists rather than showing an empty recycle bin', raw => {
    expect(() => parseDeletedRecords(raw, 'prod:11')).toThrow()
  })
  it('browsing only reads, excludes privacy-locked content and never starts an export/purge', async () => {
    const { service, post } = fixture()
    await expect(service.deleted('prod:11')).resolves.toMatchObject({ accountScope: 'prod:11' })
    await expect(service.exportPreflight('prod:11')).resolves.toMatchObject({ canExport: false, recordCount: 10, message: '今天已导出' })
    expect(post.mock.calls.map(call => call[0])).toEqual(['/api/v1/records/deleted/list', '/api/v1/records/export/session/preflight', '/api/v1/records/export/session/latest'])
    expect(post).toHaveBeenCalledWith('/api/v1/records/export/session/preflight', { order_kind: 1, hide_record_privacy_lock: true }, { userId: 11 }, undefined, { lane: 'interactive-read' })
  })
  it('restores only the explicitly confirmed uid/version', async () => {
    const { service, post } = fixture()
    await expect(service.recover('prod:11', 'record1', 3)).resolves.toMatchObject({ recordUid: 'record1' })
    expect(post).toHaveBeenCalledWith('/api/v1/records/recover', { record_uid: 'record1', version: 3 }, { userId: 11 })
    await expect(service.recover('prod:11', 'record1', 0)).rejects.toThrow()
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls.map(call => call[0])).toEqual(['/api/v1/records/deleted/list', '/api/v1/records/recover'])
  })
  it('refuses cross-account reads and writes before any request', async () => {
    const { service, post } = fixture()
    await expect(service.deleted('prod:12')).rejects.toThrow('账号已切换')
    await expect(service.exportPreflight('test:11')).rejects.toThrow('账号已切换')
    await expect(service.recover('prod:12', 'record1', 3)).rejects.toThrow('账号已切换')
    expect(post).not.toHaveBeenCalled()
  })
  it('discards late reads after switching accounts', async () => {
    const f = fixture()
    f.post.mockImplementation(async () => { f.setUser(12); return { items: [core] } })
    await expect(f.service.deleted('prod:11')).rejects.toThrow('账号已切换')
  })
  it('discards late export reads after switching environments', async () => {
    const f = fixture()
    f.post.mockImplementation(async () => { f.config.environment = 'test'; return {} })
    await expect(f.service.exportPreflight('prod:11')).rejects.toThrow('账号已切换')
  })
  it.each([null, {}, { can_export: true, record_count: -1 }])('rejects incomplete export statistics', async raw => {
    const f = fixture()
    f.post.mockResolvedValue(raw)
    await expect(f.service.exportPreflight('prod:11')).rejects.toMatchObject({ code: 'data-management-contract-invalid' })
  })
  it('does not report a different recovered record as success', async () => {
    const f = fixture()
    f.post.mockImplementation(async path => path.endsWith('/list') ? { items: [{ record_core: core }] } : { record_core: { ...core, record_uid: 'other' } })
    await expect(f.service.recover('prod:11', 'record1', 3)).rejects.toMatchObject({ code: 'data-management-contract-invalid' })
  })
  it('never treats active, restored or purged records as recoverable', () => {
    const statuses = [1, 2, 4, 'active', 'restored', 'purged', 'deleted']
    const result = parseDeletedRecords({ items: statuses.map((status, i) => ({ record_core: { ...core, record_uid: `record${i}`, status } })) }, 'prod:11', now)
    expect(result.items.map(item => item.recordUid)).toEqual(['record1', 'record6'])
    expect(result.unverifiedCount).toBe(0)
  })
  it('hides unknown lifecycle and deadline without misreporting a verified empty bin', () => {
    const items: unknown[] = [undefined, 3, '2', 'unknown'].map(status => ({ record_core: { ...core, status } }))
    items.push({ record_core: { ...core, update_at: 0, send_at: 0 } })
    const result = parseDeletedRecords({ items }, 'prod:11', now)
    expect(result.items).toEqual([])
    expect(result.unverifiedCount).toBe(5)
  })
  it('uses the explicit deadline, excludes expired rows and keeps pagination based on the raw page', () => {
    const items = [
      { record_core: core, will_real_delete_after: now },
      { record_core: { ...core, update_at: now - 31 * 86400000 } },
      { record_core: { ...core, record_uid: 'valid', send_at: undefined }, send_at: 12345, will_real_delete_after: now + 86400000 },
      ...Array.from({ length: 47 }, () => ({ record_core: { ...core, status: 1 } })),
    ]
    const result = parseDeletedRecords({ items }, 'prod:11', now)
    expect(result.items.map(item => item.recordUid)).toEqual(['valid'])
    expect(result.items[0]?.recoverableUntilMillis).toBe(now + 86400000)
    expect(result.items[0]?.sendAtMillis).toBe(12345)
    expect(result.mayHaveMore).toBe(true)
  })
  it.each([
    { ...core, status: 1 }, { ...core, status: undefined },
    { ...core, version: 4 }, { ...core, update_at: now - 31 * 86400000 },
  ])('refuses recovery after state, version or retention changes', async changed => {
    const f = fixture(); f.post.mockResolvedValue({ items: [{ record_core: changed }] })
    await expect(f.service.recover('prod:11', 'record1', 3)).rejects.toMatchObject({ code: 'data-management-record-changed' })
    expect(f.post.mock.calls.map(call => call[0])).toEqual(['/api/v1/records/deleted/list'])
  })
})
