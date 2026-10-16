import { expect, it, vi } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { offlineContextTools } from '../src/tools/business/recordings/offline-context.js'

it('uses capability discovery and the same Host contract', async () => {
  const calls: unknown[] = []
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body)); calls.push(body)
    return new Response(JSON.stringify({ ok: true, value: body.operation === 'provider.capabilities' ? { contractVersion: 1, features: { offlineContextV1: true } } : [] }), { headers: { 'Content-Type': 'application/json' } })
  } })
  expect(await sdk.offlineContext({ operation: 'pending' })).toEqual([])
  expect(calls).toContainEqual({ operation: 'offline-context', params: { operation: 'pending' } })

})
it('rejects an unsupported provider before a mutation and separates Tool grants', async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: {} } }), { headers: { 'Content-Type': 'application/json' } }))
  const sdk = createArkmeSdk({ fetchImpl })
  await expect(sdk.offlineContext({ operation: 'pending' })).rejects.toThrow()
  expect(fetchImpl).toHaveBeenCalledOnce()
  expect(offlineContextTools.map(t => t.meta)).toMatchObject([{ effect: 'read' }, { effect: 'write', grant: 'explicit-user-write' }])

})
