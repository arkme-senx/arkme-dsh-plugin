import { afterEach, expect, it, vi } from 'vitest'
import { ArkmeSdk } from '../src/sdk/index.js'
afterEach(()=>vi.useRealTimers())
it('owns one cancellable SDK observation loop and stops after disposal',async()=>{
 vi.useFakeTimers()
 const fetchImpl=vi.fn(async()=>Response.json({ok:true,data:[]}))
 const sdk=new ArkmeSdk({fetchImpl:fetchImpl as typeof fetch})
 const onChange=vi.fn(),onError=vi.fn()
 const dispose=sdk.observeNativeAnnotations(['ref'],onChange,onError)
 await vi.advanceTimersByTimeAsync(0)
 expect(fetchImpl).toHaveBeenCalledTimes(1)
 await vi.advanceTimersByTimeAsync(15000)
 expect(fetchImpl).toHaveBeenCalledTimes(2)
 dispose()
 expect((fetchImpl.mock.calls[1] as unknown as [unknown,RequestInit])[1].signal!.aborted).toBe(true)
 await vi.advanceTimersByTimeAsync(60000)
 expect(fetchImpl).toHaveBeenCalledTimes(2)
 expect(onError).not.toHaveBeenCalled()
})
