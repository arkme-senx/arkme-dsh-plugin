import { expect, it, vi } from 'vitest'
import { appendThoughtContinuationPage, readThoughtContinuationWindow } from '../src/client/thought-continuation-window.js'
import type { ArkmeThoughtContinuation, ArkmeThoughtContinuationPage } from '../src/thought-continuation.js'
const scope = 'test:11'
const row = (n: number): ArkmeThoughtContinuation => ({ id: String(n), recordUid: 'root', replyRecordUid: `human:${n}`, biz: 2, status: 'ready', content: `reply:${n}`, canRetry: false, createdAtMillis: n + 1 })
const page = (ids: number[], cursor?: string): ArkmeThoughtContinuationPage => ({ accountScope: scope, supported: true, items: ids.map(row), ...(cursor ? { nextCursor: cursor } : {}) })
const signal = () => new AbortController().signal
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const first = async (p: ArkmeThoughtContinuationPage) => readThoughtContinuationWindow({ scope, read: async () => p, signal: signal() })
it('revalidates through the old boundary when new head replies shift the page boundary, without skipping the next overlap', async () => {
  let previous = await first(page(range(1,20), '20'))
  previous = appendThoughtContinuationPage(previous, page(range(21,40), '40'), '20', scope)
  const read = vi.fn(async (cursor?: string) => cursor === undefined ? page([0,...range(1,19)], '19') : cursor === '19' ? page(range(20,39),'39') : page(range(40,59),'59'))
  const refreshed = await readThoughtContinuationWindow({ scope, previous, read, signal: signal() })
  expect(refreshed.items.map(x => x.id)).toEqual(range(0,40).map(String))
  expect(read.mock.calls.map(([cursor]) => cursor)).toEqual([undefined,'19','39'])
  expect(refreshed.nextCursor).toBe('39')
  const more = appendThoughtContinuationPage(refreshed, page(range(40,59),'59'), refreshed.nextCursor!, scope)
  expect(more.items.map(x=>x.id)).toEqual(range(0,59).map(String))
  expect(more.nextCursor).toBe('59')
})
it('keeps an older-reading window after the 60-row cap, including a partial first page', async () => {
  let previous = await first(page(range(1,20),'20'))
  for (const n of [20,40,60]) previous = appendThoughtContinuationPage(previous,page(range(n+1,n+20),String(n+20)),String(n),scope)
  previous = appendThoughtContinuationPage(previous,page([81]),'80',scope)
  expect(previous.items.map(x=>x.id)).toEqual(range(22,81).map(String))
  const read = vi.fn(async (cursor?: string) => cursor==='80' ? page([81]) : page(range(Number(cursor)+1,Number(cursor)+20),String(Number(cursor)+20)))
  const result = await readThoughtContinuationWindow({scope,previous,read,signal:signal()})
  expect(result.items.map(x=>x.id)).toEqual(range(22,81).map(String))
  expect(read.mock.calls.map(([cursor])=>cursor)).toEqual(['20','40','60','80'])
  expect(result.origins.size).toBe(60)
})
it('removes deleted old replies only from a completed fresh window and never restores stale content', async () => {
  let previous=await first(page([1],'next'))
  previous=appendThoughtContinuationPage(previous,page([2]),'next',scope)
  const result=await readThoughtContinuationWindow({scope,previous,read:async()=>page([1]),signal:signal()})
  expect(result.items.map(x=>x.id)).toEqual(['1'])
})
it('rejects late account changes, owner denials, cancellation and repeated cursors', async () => {
  const previous=await first(page([1],'next'))
  await expect(readThoughtContinuationWindow({scope,previous,read:async()=>({...page([1]),accountScope:'test:99'}),signal:signal()})).rejects.toThrow('账号已切换')
  const denied=Object.assign(new Error('denied'),{body:{retryable:false}})
  await expect(readThoughtContinuationWindow({scope,previous,read:async()=>{throw denied},signal:signal()})).rejects.toBe(denied)
  const ctrl=new AbortController()
  await expect(readThoughtContinuationWindow({scope,previous,read:async()=>{ctrl.abort();return page([1])},signal:ctrl.signal})).rejects.toMatchObject({name:'AbortError'})
  const circular = await first(page([9],'same'))
  await expect(readThoughtContinuationWindow({scope,previous:circular,read:async()=>page([1],'same'),signal:signal()})).rejects.toMatchObject({body:{retryable:true}})
})
it('bounds sparse pages and rejects partial refreshes instead of replacing a complete window', async () => {
  const previous=await first(page([99],'start'))
  let n=0
  const read=vi.fn(async()=>page([++n],String(n)))
  await expect(readThoughtContinuationWindow({scope,previous,read,signal:signal()})).rejects.toMatchObject({body:{retryable:true}})
  expect(read).toHaveBeenCalledTimes(4)
})
it('validates a retry seed even in an older window and stops on unsupported capability', async () => {
  let previous=await first(page(range(1,20),'20'))
  for (const n of [20,40,60]) previous=appendThoughtContinuationPage(previous,page(range(n+1,n+20),String(n+20)),String(n),scope)
  const read=vi.fn(async()=>page([1]))
  await expect(readThoughtContinuationWindow({scope,previous,firstPage:{...page([1]),accountScope:'test:99'},read,signal:signal()})).rejects.toThrow('账号已切换')
  const result=await readThoughtContinuationWindow({scope,previous,firstPage:{...page([]),supported:false},read,signal:signal()})
  expect(result.items).toEqual([]);expect(result.supported).toBe(false);expect(read).not.toHaveBeenCalled()
})
