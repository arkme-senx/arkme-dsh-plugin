// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { ArkmePointsConsumption } from '../src/client/ArkmePointsConsumption.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
let root: Root, host: HTMLDivElement
const row = { businessCode: 'agent', requestUid: 'one', model: 'DeepSeek Pro', chargedPoints: '0.0000001', modelPoints: '0.0000001', services: [] as { code: string; quantity: string; chargedPoints: string }[], grantedPoints: '0.0000001', purchasedPoints: '0', createdAt: 1790000000000, completedAt: 1790000001000, tokens: { cacheHitInput: '1', cacheMissInput: '2', output: '3' } }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  mocks.call.mockReset().mockImplementation(async (_op, params) => ({ accountScope: params.expectedAccountScope, unit: 'ai_points', month: params.month, chargedPoints: '0.0000001', items: [row], nextBeforeId: '' }))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
const render = async (scope = 'prod:1') => { await act(async () => root.render(<ArkmePointsConsumption scope={scope} revision={0} />)) }
it('shows a non-zero tiny charge without exposing Token diagnostics or exact precision', async () => {
  await render()
  expect(host.textContent).toContain('< 0.01 积分')
  expect(host.querySelector('details')?.open).toBe(false)
  expect(host.querySelector('summary')?.textContent).not.toContain('Token')
  expect(host.textContent).not.toMatch(/Token|缓存|精确消费|0\.0000001/)
  expect(host.querySelector('.arkme-points-call')?.textContent).toContain('< 0.01 积分')
  expect(host.textContent).not.toContain('实体提取'); expect(host.textContent).not.toContain('阿森有想法')
  expect(mocks.call.mock.calls[0]?.[0]).toBe('account.points.consumption')
})
it('keeps model and search costs inside the same expanded charge', async () => {
  mocks.call.mockImplementation(async (_op, params) => ({ accountScope: 'prod:1', unit: 'ai_points', month: params.month, chargedPoints: '1', items: [{ ...row, chargedPoints: '1', modelPoints: '0.685', services: [{ code: 'web_search', quantity: '1', chargedPoints: '0.315' }] }], nextBeforeId: '' }))
  await render()
  expect(host.querySelectorAll('details')).toHaveLength(1)
  expect(host.querySelector('summary')?.textContent).not.toContain('联网搜索')
  expect(host.querySelector('details')?.textContent).toContain('模型调用 0.68 积分')
  expect(host.querySelector('details')?.textContent).toContain('联网搜索 0.31 积分')
})
it('preserves existing rows on a failed next page and retries the same cursor', async () => {
  mocks.call.mockImplementation(async (_op, params) => {
    if (params.beforeId) throw new Error('offline')
    return { accountScope: 'prod:1', unit: 'ai_points', month: params.month, chargedPoints: '1', items: [row], nextBeforeId: '10' }
  })
  await render(); await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
  expect(host.querySelectorAll('details')).toHaveLength(1); expect(host.textContent).toContain('已有明细已保留')
  mocks.call.mockImplementation(async (_op, params) => ({ accountScope: 'prod:1', unit: 'ai_points', month: params.month, chargedPoints: '1', items: [{ ...row, businessCode: 'agent', requestUid: 'two' }], nextBeforeId: '' }))
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
  expect(mocks.call.mock.calls.at(-1)?.[1].beforeId).toBe('10')
  expect(host.querySelectorAll('details')).toHaveLength(2)
})
it('cancels a pending account read and ignores its late result', async () => {
  let release: (value: unknown) => void = () => {}, firstSignal: AbortSignal | undefined
  mocks.call.mockImplementation((_op, _params, signal) => { firstSignal = signal; return new Promise(resolve => { release = resolve }) })
  await render()
  mocks.call.mockImplementation(async (_op, params) => ({ accountScope: 'prod:2', unit: 'ai_points', month: params.month, chargedPoints: '0', items: [], nextBeforeId: '' }))
  await render('prod:2'); expect(firstSignal?.aborted).toBe(true)
  await act(async () => release({ accountScope: 'prod:1', month: '2026-09', chargedPoints: '1', items: [row], nextBeforeId: '' }))
  expect(host.textContent).toContain('暂无积分消费'); expect(host.textContent).not.toContain('DeepSeek Pro')
})

it('shows one task total and retains individual point charges in the expandable row',async()=>{
 mocks.call.mockImplementation(async (_op,params)=>({accountScope:'prod:1',unit:'ai_points',month:params.month,chargedPoints:'0.0000002',nextBeforeId:'',items:[{...row,operationUid:'run'},{...row,requestUid:'two',operationUid:'run'}]}))
 await render()
 expect(host.querySelectorAll('details')).toHaveLength(1)
 expect(host.querySelector('summary')?.textContent).not.toContain('次调用')
 expect(host.querySelectorAll('.arkme-points-call')).toHaveLength(2)
 expect(host.querySelector('summary')?.textContent).not.toContain('Token')
 expect(host.querySelectorAll('details small')).toHaveLength(3)
})
