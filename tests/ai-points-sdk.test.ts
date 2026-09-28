import { expect, it } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'

it('shares the Host owner and account scope across SDK point queries and supports cancellation', async () => {
  const calls: unknown[] = [], signal = new AbortController().signal
  const owner = {
    aiPointsAccount: async (...args: unknown[]) => { calls.push(args); return { unit: 'ai_points', accountScope: 'prod:7', availablePoints: '1.0000001' } },
    aiPointsConsumption: async (...args: unknown[]) => { calls.push(args); return { unit: 'ai_points', items: [], nextBeforeId: '' } },
  }
  const sdk = createArkmeSdk({ fetchImpl: async (_input, init) => {
    expect(init?.signal).toBe(signal)
    const body = JSON.parse(String(init?.body))
    const value = body.operation === 'provider.capabilities' ? { contractVersion: 1, features: { aiPoints: true } }
      : await dispatchArkmeHostOperation(owner as never, body.operation, body.params)
    return new Response(JSON.stringify({ ok: true, value }), { status: 200 })
  } })
  await expect(sdk.aiPointsAccount('prod:7', signal)).resolves.toMatchObject({ availablePoints: '1.0000001' })
  await sdk.aiPointsConsumption('prod:7', { month: '2026-09', beforeId: '123' }, signal)
  expect(calls).toEqual([['prod:7', undefined], [{ month: '2026-09', beforeId: '123' }, 'prod:7', undefined]])
})

it('fails capability discovery explicitly when connected to a provider without points', async () => {
  let reads = 0
  const sdk = createArkmeSdk({ fetchImpl: async () => { reads++; return new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: {} } })) } })
  await expect(sdk.aiPointsAccount('prod:7')).rejects.toThrow('不支持 AI 积分')
  expect(reads).toBe(1)
})
