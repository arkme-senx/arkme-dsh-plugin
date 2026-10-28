import { beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mock.call }))
beforeEach(()=>{vi.resetModules();mock.call.mockReset()})
const item=(n:number)=>({arrangementRef:`ref-${n}`,status:'identified' as const,title:`title-${n}`,description:'',reminderEnabled:false,reminderState:'',createdAtMillis:0,updatedAtMillis:0})
it('bounds pages, isolates accounts and persists the captured scope', async()=>{
 mock.call.mockResolvedValue({pages:{}})
 const cache=await import('../src/client/arrangement-board-cache.js')
 cache.saveArrangementBoardCache('test:42',{identified:{items:Array.from({length:80},(_,i)=>item(i)),total:100,hasMore:true}})
 expect(cache.readArrangementBoardMemory('test:42').identified?.items).toHaveLength(50)
 expect(cache.readArrangementBoardMemory('prod:42')).toEqual({})
 expect(cache.readArrangementBoardMemory('test:43')).toEqual({})
 await vi.waitFor(()=>expect(mock.call).toHaveBeenCalled())
 expect(mock.call.mock.calls[0]?.[1]).toMatchObject({accountScope:'test:42',pages:{identified:{nextOffset:50,hasMore:true}}})
})
it('late disk reads do not replace more recent in-memory writes', async()=>{
 let disk!: (value: unknown)=>void
 mock.call.mockImplementation((_op,p)=>p.pages?Promise.resolve({pages:p.pages}):new Promise(done=>{disk=done}))
 const cache=await import('../src/client/arrangement-board-cache.js')
 const loading=cache.loadArrangementBoardCache('test:42',new AbortController().signal)
 cache.saveArrangementBoardCache('test:42',{identified:{items:[item(2)],total:1,hasMore:false}})
 disk({pages:{identified:{items:[item(1)],total:1,hasMore:false}}})
 await loading
 expect(cache.readArrangementBoardMemory('test:42').identified?.items[0]?.title).toBe('title-2')
})
it('storage errors and cancellation leave optional cache unavailable', async()=>{
 mock.call.mockRejectedValue(Error('unavailable'))
 const cache=await import('../src/client/arrangement-board-cache.js')
 expect(await cache.loadArrangementBoardCache('test:42',new AbortController().signal)).toEqual({})
 cache.saveArrangementBoardCache('test:42',{identified:{items:[],total:0,hasMore:false}})
 await vi.waitFor(()=>expect(mock.call).toHaveBeenCalledTimes(2))
 expect(cache.readArrangementBoardMemory('test:42').identified?.items).toEqual([])
})
