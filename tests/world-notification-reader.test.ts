import { expect, it, vi } from 'vitest'
import { readWorldNotifications } from '../src/client/world-notification-reader.js'
import type { callArkme } from '../src/client/api.js'

it('preserves the complete existing list with bounded ledger pages and deduplicates page overlap', async () => {
 const first={interactionRef:'one',unavailable:false}, hidden={interactionRef:'withdrawn',unavailable:true}
 const read=vi.fn().mockResolvedValueOnce({items:[first],hasMore:true,nextCursor:'older'}).mockResolvedValueOnce({items:[first,hidden],hasMore:false})
 expect(await readWorldNotifications(new AbortController().signal,read as typeof callArkme)).toEqual([first,hidden])
 expect(read).toHaveBeenNthCalledWith(1,'world.comment-notifications',{limit:50},expect.any(AbortSignal),{priority:'background'})
 expect(read).toHaveBeenNthCalledWith(2,'world.comment-notifications',{limit:50,cursor:'older'},expect.any(AbortSignal),{priority:'background'})
})
it('rejects incomplete reads, repeated cursors, oversized pages and cancelled requests', async () => {
 await expect(readWorldNotifications(new AbortController().signal, vi.fn().mockRejectedValue(Error('offline')) as typeof callArkme)).rejects.toThrow('offline')
 const stuck=vi.fn().mockResolvedValue({items:[],hasMore:true,nextCursor:'same'})
 await expect(readWorldNotifications(new AbortController().signal,stuck as typeof callArkme)).rejects.toThrow('分页');expect(stuck).toHaveBeenCalledTimes(2)
 await expect(readWorldNotifications(new AbortController().signal,vi.fn().mockResolvedValue({items:Array(51).fill({}),hasMore:false}) as typeof callArkme)).rejects.toThrow('返回异常')
 const c=new AbortController();c.abort();const read=vi.fn();await expect(readWorldNotifications(c.signal,read)).rejects.toThrow();expect(read).not.toHaveBeenCalled()
})
it('stops after the finite history budget instead of returning a silent partial list', async()=>{
 let i=0;const read=vi.fn(async()=>({items:[],hasMore:true,nextCursor:String(++i)}))
 await expect(readWorldNotifications(new AbortController().signal,read as typeof callArkme)).rejects.toThrow('暂未加载完整');expect(read).toHaveBeenCalledTimes(100)
})
