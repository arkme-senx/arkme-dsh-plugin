import { expect, it, vi } from 'vitest'
import { LocalSummaryCache } from '../src/dsh-remote/local-summary-cache.js'
import { DshApiProxyAdapter } from '../src/dsh-remote/api-proxy-adapter.js'

it('shares one 10000-session snapshot across 400 windows and pages, invalidates on changes',async()=>{
 const rows=new Map(Array.from({length:10000},(_,i)=>[String(i),{updatedAt:i,projectionAsOfSeq:i,running:false}]))
 const read=vi.fn(async()=>rows),cache=new LocalSummaryCache(read),signal=new AbortController().signal
 const windows=await Promise.all(Array.from({length:400},()=>cache.get(signal)))
 expect(windows.every(value=>value.size===10000)).toBe(true);expect(read).toHaveBeenCalledOnce()
 for(let i=0;i<400;i++)await cache.get(signal);expect(read).toHaveBeenCalledOnce()
 cache.invalidate();await Promise.all(Array.from({length:8},()=>cache.get(signal)));expect(read).toHaveBeenCalledTimes(2)
})
it('never publishes a stale account or an event-invalidated snapshot',async()=>{
 let release!:(value:Map<string,{updatedAt:number;running:boolean}>)=>void
 const cache=new LocalSummaryCache(()=>new Promise(r=>{release=r})),signal=new AbortController().signal
 const pending=cache.get(signal);cache.clear();release(new Map());await expect(pending).rejects.toThrow('changed')
})
it('uses a bounded fallback TTL and a failed read never poisons future reads',async()=>{
 vi.useFakeTimers();try{
 const read=vi.fn(async()=>new Map()),cache=new LocalSummaryCache(read),signal=new AbortController().signal
 await cache.get(signal);await vi.advanceTimersByTimeAsync(30001);await cache.get(signal);expect(read).toHaveBeenCalledTimes(2)
 cache.invalidate();read.mockRejectedValueOnce(new Error('unavailable'));await expect(cache.get(signal)).rejects.toThrow('unavailable')
 await cache.get(signal);expect(read).toHaveBeenCalledTimes(4)
 }finally{vi.useRealTimers()}
})

it('reads the actual adapter directory once rather than fetching all 10000 entries for every page',async()=>{
 const list=vi.fn(async()=>({rpcId:'r',result:{ok:true as const,value:{items:Array.from({length:10000},(_,i)=>({sessionId:String(i),updatedAt:i,running:false,blank:false}))}}}))
 const adapter=new DshApiProxyAdapter({sessions:{list}}),cache=new LocalSummaryCache(()=>adapter.localHistorySummaries())
 const signal=new AbortController().signal
 await Promise.all(Array.from({length:400},()=>cache.get(signal)));expect(list).toHaveBeenCalledOnce()
})
it('event storms cannot start parallel metadata scans, and cannot publish an old snapshot',async()=>{
 let release!:(value:Map<string,{updatedAt:number;running:boolean}>)=>void
 const read=vi.fn(()=>new Promise<Map<string,{updatedAt:number;running:boolean}>>(r=>{release=r})),cache=new LocalSummaryCache(read),signal=new AbortController().signal
 const calls=[cache.get(signal).catch(e=>e)]
 for(let i=0;i<400;i++){cache.invalidate();calls.push(cache.get(signal).catch(e=>e))}
 expect(read).toHaveBeenCalledOnce();release(new Map());expect((await Promise.all(calls)).every(value=>value instanceof Error)).toBe(true)
})

it('pages a 10000-session upload from one immutable DSH snapshot', async () => {
  const list = vi.fn(async () => ({ rpcId: 'r', result: { ok: true as const, value: {
    items: Array.from({ length: 10000 }, (_, i) => ({ sessionId: String(i), updatedAt: i, running: false, blank: false })),
  } } }))
  const adapter = new DshApiProxyAdapter({ sessions: { list } })
  const workspaceInventory = { items: [], archivedSessionIds: [] }
  const sessionInventory = await adapter.sessionInventory(workspaceInventory)
  let cursor: string | undefined, count = 0
  do {
    const page = await adapter.sessions({ sessionInventory, workspaceInventory, includeUngrouped: true, limit: 50, ...(cursor ? { cursor } : {}) })
    count += page.items.length
    cursor = page.nextCursor
  } while (cursor)
  expect(count).toBe(10000)
  expect(list).toHaveBeenCalledOnce()
})
