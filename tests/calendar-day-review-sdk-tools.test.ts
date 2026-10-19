import { expect, it, vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { createArkmeCoreToolDefinitions, arkmeToolCatalog } from '../src/tools/index.js'
const query = { accountScope: 'prod:7', bucketDate: '2026-10-15', timezone: 'Asia/Shanghai' }
it('SDK and Tools route through the same Host owner and preserve cancellation', async () => {
 const result = { supported: true, job: null, result: null, freshness: 'unknown', versions: [] }
 const owner = { dayReviewState: vi.fn(async () => result), resumeDayReview: vi.fn(async () => result) }
 const signal = new AbortController().signal
 const sdk = createArkmeSdk({ fetchImpl: async (_, init) => {
  expect(init?.signal).toBe(signal)
  const body = JSON.parse(String(init?.body))
  const value = body.operation === 'provider.capabilities' ? { contractVersion: 1, features: { calendarDayReview: true } } : await dispatchArkmeHostOperation(owner as never, body.operation, body.params, undefined, undefined, undefined, undefined, signal)
  return new Response(JSON.stringify({ ok: true, value }))
 } })
 expect(await sdk.dayReviewState(query, signal)).toEqual(result)
 const tools = createArkmeCoreToolDefinitions(owner as never)
 const read = tools.find(t => t.name === 'arkme_day_review_read')!
 expect(await read.execute({ account_scope: query.accountScope, date: query.bucketDate, timezone: query.timezone, action: 'state' }, { signal } as never)).toContain('unknown')
 expect(owner.dayReviewState.mock.calls).toEqual([[query, signal], [query, signal]])
 await expect(read.execute({ account_scope: query.accountScope, date: query.bucketDate, timezone: query.timezone, action: 'create' } as never, { signal } as never)).rejects.toThrow()
 expect(arkmeToolCatalog.modules.find(t => t.meta.toolName === 'arkme_day_review_generate')?.meta).toMatchObject({ effect: 'write', grant: 'explicit-user-write' })
})
it('rejects unsupported providers before dispatching a billable operation', async () => {
 const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: {} } })))
 const sdk = createArkmeSdk({ fetchImpl })
 await expect(sdk.createDayReview({ ...query, sourceKinds: ['self'], requestId: '00000000-0000-4000-8000-000000000000' })).rejects.toThrow('不支持')
 expect(fetchImpl).toHaveBeenCalledTimes(1)
})
