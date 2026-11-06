import { describe, expect, it, vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import type { SpeechQuery } from '../src/recording-speech-statistics.js'
const query: SpeechQuery = { accountScope: 'prod:42', date: '2026-11-05', timezone: 'Asia/Shanghai' }
const ok = (value: unknown) => new Response(JSON.stringify({ ok: true, value }))
function fixture() {
  const operations: string[] = [], requests: unknown[] = []
  let accountScope = query.accountScope
  const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
    init?.signal?.throwIfAborted()
    const call = JSON.parse(String(init?.body)); operations.push(call.operation); requests.push(call)
    if (call.operation === 'provider.capabilities') return ok({ contractVersion: 1, features: { recordingSpeechStatistics: 2 } })
    if (call.operation === 'recordings.speech-statistics.capabilities') return ok({ version: 2, supported: true, accountScope })
    return ok({ supported: true, stale: false, result: null, job: { id: 'accepted', stage: 'queued', stale: false, completed: 0, total: 0 } })
  })
  return { sdk: createArkmeSdk({ fetchImpl }), operations, requests, fetchImpl, change: () => { accountScope = 'prod:43' } }
}
describe('public self speech SDK', () => {
  it('discovers v2 and preserves the caller command identity on retries', async () => {
    const f = fixture(), input = { ...query, requestId: 'request-111111111111' }
    await f.sdk.createSpeechStatistics(input); await f.sdk.createSpeechStatistics(input)
    const writes = f.requests.filter((x: any) => x.operation === 'recordings.speech-statistics.create')
    expect(writes).toEqual([{ operation: 'recordings.speech-statistics.create', params: input }, { operation: 'recordings.speech-statistics.create', params: input }])
    expect(f.fetchImpl.mock.calls.every(([, init]) => !Object.keys(init?.headers ?? {}).some(key => key.toLowerCase() === 'origin'))).toBe(true)
  })
  it('fails before business IO for missing capability, account changes and disposal', async () => {
    const old = createArkmeSdk({ fetchImpl: async () => ok({ contractVersion: 1, features: {} }) })
    await expect(old.speechStatisticsState(query)).rejects.toMatchObject({ body: { code: 'CAPABILITY_UNSUPPORTED' } })
    const f = fixture(); f.change()
    await expect(f.sdk.createSpeechStatistics({ ...query, requestId: 'request-111111111111' })).rejects.toMatchObject({ body: { code: 'ACCOUNT_CHANGED' } })
    expect(f.operations).not.toContain('recordings.speech-statistics.create')
    f.sdk.dispose()
    const before = f.operations.length
    await expect(f.sdk.speechStatisticsState(query)).rejects.toThrow()
    expect(f.operations).toHaveLength(before)
  })
})
