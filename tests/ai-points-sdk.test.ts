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
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    const body = JSON.parse(String(init?.body))
    const value = body.operation === 'provider.capabilities' ? { contractVersion: 1, features: { aiPoints: true } }
      : await dispatchArkmeHostOperation(owner as never, body.operation, body.params)
    return new Response(JSON.stringify({ ok: true, value }), { status: 200 })
  } })
  await expect(sdk.aiPointsAccount('prod:7', signal)).resolves.toMatchObject({ availablePoints: '1.0000001' })
  await sdk.aiPointsConsumption('prod:7', { month: '2026-09', beforeId: '123' }, signal)
  await sdk.aiPointsConsumption('prod:7', { month: '2026-09', limit: 100 }, signal)
  expect(calls).toEqual([['prod:7', undefined], [{ month: '2026-09', beforeId: '123' }, 'prod:7', undefined], [{ month: '2026-09', limit: 100 }, 'prod:7', undefined]])
})

it('fails capability discovery explicitly when connected to a provider without points', async () => {
  let reads = 0
  const sdk = createArkmeSdk({ fetchImpl: async () => { reads++; return new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: {} } })) } })
  await expect(sdk.aiPointsAccount('prod:7')).rejects.toThrow('不支持 AI 积分')
  expect(reads).toBe(1)
})

it('forwards aggregate and filtered detail queries through the same Host with cancellation', async () => {
  const calls: unknown[] = [], signal = new AbortController().signal
  const owner = {
    aiPointsStatistics: async (...args: unknown[]) => { calls.push(args); return { buckets: [] } },
    aiPointsConsumptionRange: async (...args: unknown[]) => { calls.push(args); return { items: [] } },
  }
  const sdk = createArkmeSdk({ fetchImpl: async (_input, init) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    const body = JSON.parse(String(init?.body))
    const value = body.operation==='provider.capabilities'?{contractVersion:1,features:{aiPointsStatisticsV1:true}}:await dispatchArkmeHostOperation(owner as never, body.operation, body.params, undefined, undefined, undefined, undefined, signal)
    return new Response(JSON.stringify({ ok: true, value }))
  } })
  const dates = { fromDate: '2026-11-01', untilDate: '2026-11-05', timezone: 'Asia/Shanghai' as const }
  await sdk.aiPointsStatistics('prod:7', { ...dates, grain: 'day' }, signal)
  await sdk.aiPointsConsumptionRange('prod:7', { ...dates, businessCodes: ['arkme', ''], beforeId: '9007199254740993', settledBefore: 1793787390768, limit: 20 }, signal)
  expect(calls).toEqual([
    [{ ...dates, grain: 'day' }, 'prod:7', signal],
    [{ ...dates, businessCodes: ['arkme', ''], beforeId: '9007199254740993', settledBefore: 1793787390768, limit: 20 }, 'prod:7', signal],
  ])
})

it('rejects unsupported statistics providers before any summary/detail request',async()=>{
 const calls:string[]=[];const sdk=createArkmeSdk({fetchImpl:async(_,init)=>{calls.push(JSON.parse(String(init?.body)).operation);return new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{aiPoints:true}}}))}})
 await expect(sdk.aiPointsStatistics('prod:7',{fromDate:'2026-11-01',untilDate:'2026-11-02',timezone:'Asia/Shanghai',grain:'day'})).rejects.toMatchObject({body:{code:'CAPABILITY_UNSUPPORTED'}})
 expect(calls).toEqual(['provider.capabilities']);sdk.dispose()
})
