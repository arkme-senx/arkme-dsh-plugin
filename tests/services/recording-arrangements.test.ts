import { describe, expect, it, vi } from 'vitest'
import { ArrangementService } from '../../src/services/arrangement-service.js'
import { ArkmePluginError, ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { recordingSourceLocalDate } from '../../src/arrangement-recording-source.js'

const dateStamp = Date.UTC(2026, 9, 8, 16), tzOffsetMillis = 8 * 3_600_000
const query = { dateStamp, tzOffsetMillis }
const source = { kind: 'daily-summary', date_stamp: dateStamp, tz_offset: tzOffsetMillis, summary_id: 'summary-oct-9' }
const row = { uid: 'private-arrangement', title: '安排', status: 2, source_type: 5, recording_source: source, create_at: Date.UTC(2026, 9, 13), due_at: Date.UTC(2026, 10, 2) }
function setup(data: unknown, failure?: ArkmePluginError) {
  const sessions = { read: async () => ({ userId: 42, accessToken: 'test', refreshToken: 'test' }) } as ArkmeSessionStore
  const runtime = new ServiceRuntime({ environment: 'test' } as ArkmeServiceConfig, sessions, { uniqueCode: async () => 'test-secret' } as StateStore, vi.fn())
  const post = vi.spyOn(runtime, 'authenticatedIntelligentPost').mockImplementation(async () => { if (failure) throw failure; return data as never })
  return { service: new ArrangementService(runtime), post }
}
function page(overrides: object = {}) {
  return { contract_version: 1, date_stamp: dateStamp, tz_offset: tzOffsetMillis, state: 'ready', total: 1, list: [row], snapshot_version: 'snapshot-1', ...overrides }
}

describe('recording-derived arrangement read contract', () => {
  it('counts by source date with account-owned references, not create/due time', async () => {
    const { service, post } = setup(page())
    const result = await service.recordingDayArrangements(query)
    expect(result).toMatchObject({ state: 'ready', total: 1, hasMore: false, items: [{ status: 'following', recordingSource: { state: 'ready', dateStamp, tzOffsetMillis, summaryVersionId: 'summary-oct-9' } }] })
    expect(JSON.stringify(result)).not.toContain('private-arrangement')
    expect(post.mock.calls[0]?.slice(0, 2)).toEqual(['/api/v1/arrangements/recording-day', { date_stamp: dateStamp, tz_offset: tzOffsetMillis, limit: 20, offset: 0 }])
    expect(post.mock.calls[0]?.[4]).toMatchObject({ bypassCache: true })
  })
  it.each([404, 405, 501])('does not turn an unsupported endpoint (%s) into zero', async status => {
    const { service } = setup(null, new ArkmePluginError('upstream', 'unavailable', false, status, { upstreamStatus: status }))
    await expect(service.recordingDayArrangements(query)).resolves.toEqual({ state: 'unavailable', total: null, items: [], hasMore: false })
  })
  it('propagates auth and transient errors instead of declaring unavailable', async () => {
    const failure = new ArkmePluginError('auth', 'expired', false, 401, { upstreamStatus: 401 })
    await expect(setup(null, failure).service.recordingDayArrangements(query)).rejects.toBe(failure)
  })
  it.each([
    { contract_version: undefined }, { date_stamp: dateStamp + 86_400_000 }, { tz_offset: 0 },
    { list: [{ ...row, recording_source: undefined }] }, { list: [{ ...row, source_type: 6 }] },
    { list: [{ ...row, recording_source: { ...source, date_stamp: dateStamp + 86_400_000 } }] },
    { total: 0 }, { list: [] }, { snapshot_version: '' }, { state: 'unknown' },
    { list: [row, row], total: 2 },
  ])('rejects ambiguous or unfiltered data: %j', async override => {
    await expect(setup(page(override)).service.recordingDayArrangements(query)).rejects.toMatchObject({ code: 'arrangement-contract-invalid' })
  })
  it('distinguishes a confirmed zero from incomplete history', async () => {
    await expect(setup(page({ total: 0, list: [] })).service.recordingDayArrangements(query)).resolves.toMatchObject({ state: 'ready', total: 0 })
    await expect(setup(page({ total: 0, list: [], state: 'partial' })).service.recordingDayArrangements(query)).resolves.toMatchObject({ state: 'partial', total: 0 })
  })
  it('requires a stable snapshot for subsequent bounded pages', async () => {
    const { service } = setup(page({ total: 3 }))
    await expect(service.recordingDayArrangements(query)).resolves.toMatchObject({ hasMore: true, nextOffset: 1, snapshotVersion: 'snapshot-1' })
    await expect(service.recordingDayArrangements({ ...query, offset: 1 })).rejects.toMatchObject({ code: 'arrangement-read-invalid' })
    await expect(service.recordingDayArrangements({ ...query, offset: 1, snapshotVersion: 'wrong' })).rejects.toMatchObject({ code: 'arrangement-contract-invalid' })
    await expect(service.recordingDayArrangements({ ...query, offset: 1, snapshotVersion: 'snapshot-1' })).resolves.toMatchObject({ nextOffset: 2 })
  })
  it('never infers historical provenance from the extraction timestamp or UID', async () => {
    const { service } = setup({ total: 1, list: [{ ...row, recording_source: undefined, source_items: [{ text: '历史片段', create_at: dateStamp }] }] })
    const result = await service.listArrangements()
    expect(result.items[0]?.recordingSource).toEqual({ kind: 'daily-summary', state: 'unavailable' })
  })
  it('does not attach recording links to unrelated sources', async () => {
    const result = await setup({ total: 1, list: [{ ...row, source_type: 6 }] }).service.listArrangements()
    expect(result.items[0]?.recordingSource).toBeUndefined()
  })
  it.each([{ dateStamp: dateStamp + 1 }, { tzOffsetMillis: 8 }, { tzOffsetMillis: NaN }, { limit: NaN }])('rejects invalid day/pagination: %j', async overrides => {
    const { service, post } = setup(page())
    await expect(service.recordingDayArrangements({ ...query, ...overrides })).rejects.toMatchObject({ code: 'arrangement-read-invalid' })
    expect(post).not.toHaveBeenCalled()
  })
  it('keeps the source calendar date when the viewer is in a different time zone', () => {
    const date = recordingSourceLocalDate({ kind: 'daily-summary', state: 'ready', dateStamp, tzOffsetMillis })
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2026, 9, 9, 0])
  })
})
