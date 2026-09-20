import { describe, expect, it, vi } from 'vitest'
import { AccountUsageDetailsService, parseTokenPage, parseTokenSummary } from '../../src/services/account-usage-details-service.js'
import { parseStorageUsage } from '../../src/services/account-usage-service.js'

const tokens = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, cached_tokens: 4, cache_miss_tokens: 6, cache_creation_input_tokens: 0 }
const usage = { complete: 1, partial: 0, unavailable: 0, invalid: 0 }
const summary = { month_key: '2026-09', timezone: 'Asia/Shanghai', available_months: ['2026-08', '2026-09'], window_start_ms: 1, window_end_ms: 2, available_from_ms: 1, call_count: 1, tokens, usage }
const operation = { operation_uid: 'operation-1', biz_code: 12, display_name: '记录摘要', occurred_at_ms: 1, call_count: 1, models: ['model-1'], cache_status: 3, tokens, usage }
const query = { monthKey: '2026-09', timezone: 'Asia/Shanghai' }
function fixture() {
  let userId = 11
  const config = { environment: 'prod' }
  const read = vi.fn(async (path: string): Promise<unknown> => path.endsWith('/summary') ? summary : { items: [operation], next_cursor: '' })
  const service = new AccountUsageDetailsService({ config, requireSession: async () => ({ userId }), authenticatedIntelligentPost: read } as never)
  return { service, read, config, setUser: (id: number) => { userId = id } }
}
describe('model usage read contracts', () => {
  it('parses authoritative monthly facts without changing the allowance or exposing raw internal fields', () => {
    expect(parseTokenSummary(summary, 'prod:11')).toMatchObject({ monthKey: '2026-09', availableMonths: ['2026-09', '2026-08'], partialUsage: false, tokens: { totalTokens: 30 } })
    const page = parseTokenPage({ items: [{ ...operation, request_name: 'internal', prompt: 'private' }], next_cursor: 'opaque' }, 'prod:11', 'operations')
    expect(page).toMatchObject({ items: [{ displayName: '记录摘要', callCount: 1 }], nextCursor: 'opaque' })
    expect(JSON.stringify(page)).not.toMatch(/internal|private|request_name/)
  })
  it('keeps incomplete and unknown cache states explicit instead of claiming complete usage', () => {
    const value = parseTokenPage<any>({ items: [{ occurred_at_ms: 1, model: '', usage_status: 2, cache_status: 98, tokens }], next_cursor: '' }, 'prod:11', 'calls')
    expect(value.items[0]).toMatchObject({ usageStatus: 2, cacheStatus: 1 })
    expect(parseTokenSummary({ ...summary, usage: undefined }, 'prod:11').partialUsage).toBe(true)
    expect(parseTokenSummary({ ...summary, usage: { ...usage, unavailable: 1 } }, 'prod:11').partialUsage).toBe(true)
  })
  it.each([{}, { ...summary, tokens: {} }, { ...summary, tokens: { ...tokens, total_tokens: -1 } }, { ...summary, call_count: '1' }, { ...summary, timezone: 'invalid-zone' }, { ...summary, available_months: ['2026-13'] }])('rejects invalid results instead of displaying fabricated zeros', raw => {
    expect(() => parseTokenSummary(raw, 'prod:11')).toThrow()
  })
  it.each([{ items: null, next_cursor: '' }, { items: [operation] }, { items: [{ ...operation, operation_uid: '' }], next_cursor: '' }])('rejects malformed pages', raw => {
    expect(() => parseTokenPage(raw, 'prod:11', 'operations')).toThrow()
  })
  it('only reads current-user endpoints with bounded pages and an abort signal', async () => {
    const f = fixture(), signal = new AbortController().signal
    await f.service.summary('prod:11', query, signal)
    await f.service.operations('prod:11', { ...query, cursor: 'opaque' }, signal)
    f.read.mockResolvedValue({ items: [], next_cursor: '' })
    await f.service.calls('prod:11', { ...query, operationUid: 'operation-1', bizCode: 12 }, signal)
    expect(f.read.mock.calls.map(call => call[0])).toEqual(['/api/v1/llm-usage/me/summary', '/api/v1/llm-usage/me/operations', '/api/v1/llm-usage/me/calls'])
    expect(f.read).toHaveBeenNthCalledWith(2, '/api/v1/llm-usage/me/operations', { month_key: '2026-09', timezone: 'Asia/Shanghai', cursor: 'opaque', limit: 20 }, { userId: 11 }, signal, { lane: 'interactive-read' })
    expect(f.read).toHaveBeenNthCalledWith(3, '/api/v1/llm-usage/me/calls', { month_key: '2026-09', timezone: 'Asia/Shanghai', cursor: '', limit: 20, operation_uid: 'operation-1', biz_code: 12 }, { userId: 11 }, signal, { lane: 'interactive-read' })
  })
  it('refuses cross-account requests before network access', async () => {
    const f = fixture()
    for (const scope of ['prod:12', 'test:11', '']) await expect(f.service.summary(scope, query)).rejects.toMatchObject({ code: 'account-usage-account-changed' })
    expect(f.read).not.toHaveBeenCalled()
  })
  it.each(['user', 'environment'])('rejects responses after the %s changed', async kind => {
    const f = fixture()
    f.read.mockImplementation(async () => { if (kind === 'user') f.setUser(12); else f.config.environment = 'test'; return summary })
    await expect(f.service.summary('prod:11', query)).rejects.toMatchObject({ code: 'account-usage-account-changed' })
  })
  it.each([{ ...query, monthKey: '2026-99' }, { ...query, timezone: 'bad-zone' }, { ...query, monthKey: 'x'.repeat(80) }])('rejects invalid month/timezone before requesting', async invalid => {
    const f = fixture(); await expect(f.service.summary('prod:11', invalid)).rejects.toThrow(); expect(f.read).not.toHaveBeenCalled()
  })
  it('rejects invalid operation identities and a mismatching response month', async () => {
    const f = fixture()
    await expect(f.service.calls('prod:11', { ...query, operationUid: '', bizCode: 1 })).rejects.toThrow()
    await expect(f.service.calls('prod:11', { ...query, operationUid: 'op', bizCode: -1 })).rejects.toThrow()
    expect(f.read).not.toHaveBeenCalled()
    await expect(f.service.summary('prod:11', { ...query, monthKey: '2026-08' })).rejects.toThrow()
  })
})
describe('mobile storage composition parity', () => {
  const row = (file_type: number, file_size: number, file_count = 1) => ({ file_type, file_size, file_count })
  it('groups six categories, combines unknown types and reconciles with the total', () => {
    const raw = { size: 100, breakdown: [row(1, 10), row(3, 20), row(5, 10), row(6, 30), row(7, 10), row(0, 10), row(99, 10)] }
    expect(parseStorageUsage({ file_size: 200 }, raw, 'prod:11').breakdown).toEqual([
      { category: 'image', bytes: 10, fileCount: 1 }, { category: 'video', bytes: 20, fileCount: 1 },
      { category: 'file', bytes: 30, fileCount: 1 }, { category: 'backgroundVoice', bytes: 10, fileCount: 1 },
      { category: 'callRecording', bytes: 10, fileCount: 1 }, { category: 'other', bytes: 20, fileCount: 2 },
    ])
  })
  it.each([undefined, [], [row(1, 9)], [row(1, -10)], [row(1, 10, -1)], [null]])('does not invent a breakdown from missing, invalid or inconsistent data', breakdown => {
    const result = parseStorageUsage({ file_size: 100 }, { size: 10, breakdown }, 'prod:11')
    expect(result.usedBytes).toBe(10); expect(result.breakdown).toBeUndefined()
  })
  it('allows verified empty storage and camel-case aliases', () => {
    expect(parseStorageUsage({ file_size: 100 }, { size: 0, breakdown: [] }, 'prod:11').breakdown).toEqual([])
    expect(parseStorageUsage({ file_size: 100 }, { size: 10, breakdown: [{ fileType: 1, fileSize: 10, fileCount: 1 }] }, 'prod:11').breakdown?.[0]?.bytes).toBe(10)
  })
})
