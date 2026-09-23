import { describe, expect, it, vi } from 'vitest'
import { AiPointsService, parseAiPointsAccount, parseAiPointsPage } from '../../src/services/ai-points-service.js'
import { formatAiPoints, nanoCnyToPoints, pointsUnits } from '../../src/ai-points.js'

const raw = () => ({ unit: 'ai_points', points_per_cny: 100, available_points: '101.0000001', reserved_points: '2', granted_points: '100', purchased_points: '1.0000001', observed_at: 1, grants: [{ source: 'membership', available_points: '100', expires_at: 2 }] })
const page = () => ({ unit: 'ai_points', month: '2026-09', charged_points: '0.0000001', next_before_id: '', items: [{ business_code: 'agent', request_uid: 'request-1', model: 'pro', charged_points: '0.0000001', model_points: '0.0000001', services: [] as {code: string; quantity: string; charged_points: string}[], granted_points: '0.0000001', purchased_points: '0', created_at: 1, completed_at: 2, tokens: { cache_hit_input: '1', cache_miss_input: '0', output: '0' } }] })

describe('AI points accounting boundary', () => {
  it('retains one nano-CNY and values beyond JavaScript Number precision', () => {
    expect(pointsUnits('922337203685.4775807')).toBe(9_223_372_036_854_775_807n)
    expect(nanoCnyToPoints('1')).toBe('0.0000001')
    expect(nanoCnyToPoints('1000000000')).toBe('100')
    expect(formatAiPoints('0.0000001')).toBe('< 0.01')
    expect(formatAiPoints('1.9999999')).toBe('1.99')
    expect(formatAiPoints('10000.2')).toBe('10,000.2')
    expect(parseAiPointsAccount(raw(), 'prod:1')).toMatchObject({ availablePoints: '101.0000001', purchasedPoints: '1.0000001' })
  })
  it.each(['-1', '1e2', '0.00000001', ' 1', '01', '922337203685.4775808'])('rejects non-contract precision %s', value => { expect(() => pointsUnits(value)).toThrow() })
  it('rejects inconsistent sources instead of fabricating a usable balance', () => {
    expect(() => parseAiPointsAccount({ ...raw(), granted_points: '99' }, 'prod:1')).toThrow()
    expect(() => parseAiPointsAccount({ ...raw(), grants: [] }, 'prod:1')).toThrow()
    expect(() => parseAiPointsAccount({ ...raw(), unit: 'token' }, 'prod:1')).toThrow()
    expect(() => parseAiPointsAccount({ ...raw(), available_points: 101 }, 'prod:1')).toThrow()
  })
  it('accepts only charged records with a conserved funding split', () => {
    expect(parseAiPointsPage(page(), 'prod:1', '2026-09').items[0]?.chargedPoints).toBe('0.0000001')
    const invalid = page(); invalid.items[0]!.purchased_points = '1'
    expect(() => parseAiPointsPage(invalid, 'prod:1', '2026-09')).toThrow()
    expect(() => parseAiPointsPage(page(), 'prod:1', '2026-10')).toThrow()
  })
  it('requires exact model and search components to sum to the single charge', () => {
    const data = page(), row = data.items[0]!
    data.charged_points = row.charged_points = row.granted_points = '1'
    row.model_points = '0.685'
    row.services = [{ code: 'web_search', quantity: '1', charged_points: '0.315' }]
    expect(parseAiPointsPage(data, 'prod:1', '2026-09').items[0]).toMatchObject({ modelPoints: '0.685', services: [{ code: 'web_search', chargedPoints: '0.315' }] })
    row.services[0]!.charged_points = '0.316'
    expect(() => parseAiPointsPage(data, 'prod:1', '2026-09')).toThrow()
  })
  function fixture() {
    let userId = 1
    const read = vi.fn(async (path: string) => path.endsWith('/points/query') ? raw() : page())
    const service = new AiPointsService({ config: { environment: 'prod' }, requireSession: async () => ({ userId }), authenticatedIntelligentPost: read } as never)
    return { service, read, changeUser: () => { userId = 2 } }
  }
  it('uses the points owner for all reads and forwards cancellation', async () => {
    const f = fixture(), signal = new AbortController().signal
    await f.service.account('prod:1', signal)
    await f.service.consumption({ month: '2026-09' }, 'prod:1', signal)
    expect(f.read.mock.calls.map(call => call[0])).toEqual(['/api/v1/managed-ai/points/query', '/api/v1/managed-ai/points/consumption/query'])
    expect((f.read.mock.calls[0] as unknown[])[3]).toBe(signal)
  })
  it('rejects stale identity before and after reads', async () => {
    const f = fixture()
    await expect(f.service.account('prod:2')).rejects.toMatchObject({ code: 'ai-points-account-changed' })
    expect(f.read).not.toHaveBeenCalled()
    f.read.mockImplementation(async () => { f.changeUser(); return raw() })
    await expect(f.service.account('prod:1')).rejects.toMatchObject({ code: 'ai-points-account-changed' })
  })
  it('does not query a backend for invalid months or cursors', async () => {
    const f = fixture()
    await expect(f.service.consumption({ month: '2026-13' }, 'prod:1')).rejects.toThrow()
    await expect(f.service.consumption({ month: '2026-09', beforeId: '-1' }, 'prod:1')).rejects.toThrow()
    expect(f.read).not.toHaveBeenCalled()
  })
})

it('accepts whole operations exceeding 20 calls but never more than 20 groups',()=>{
  const data=page(); data.items=Array.from({length:21},(_,i)=>({...data.items[0]!,request_uid:`r${i}`,operation_uid:'one-task'}))
  const parsed=parseAiPointsPage(data,'prod:1','2026-09')
  expect(parsed.items).toHaveLength(21); expect(parsed.items[0]?.operationUid).toBe('one-task')
  expect(()=>parseAiPointsPage({...data,items:data.items.map(row=>({...row,operation_uid:''}))},'prod:1','2026-09')).toThrow()
})
