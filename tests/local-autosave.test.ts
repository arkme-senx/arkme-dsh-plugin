import { afterEach, expect, it, vi } from 'vitest'
import { LocalAutosave } from '../src/client/local-autosave.js'
afterEach(() => vi.useRealTimers())
it('coalesces continuous edits and keeps only the newest revision behind a slow write', async () => {
 vi.useFakeTimers()
 let finish!: () => void
 const write = vi.fn(async (_key: string, _value: string) => { if (write.mock.calls.length === 1) await new Promise<void>(done => {finish = done}) })
 const saves = new LocalAutosave(write)
 for(let i=0;i<200;i++) saves.save('chat','before'+i)
 await vi.advanceTimersByTimeAsync(40)
 expect(write).toHaveBeenCalledExactlyOnceWith('chat','before199')
 for(let i=0;i<200;i++) saves.save('chat','after'+i)
 await vi.advanceTimersByTimeAsync(400)
 expect(write).toHaveBeenCalledTimes(1)
 finish(); await saves.flush()
 expect(write).toHaveBeenCalledTimes(2); expect(write).toHaveBeenLastCalledWith('chat','after199')
 expect(saves.has('chat')).toBe(false); expect(vi.getTimerCount()).toBe(0)
})
it('a send barrier waits only for its own keys and a failed acknowledgement does not drop newer content', async () => {
 let finish!: () => void
 const write=vi.fn(async(key:string,value:string)=>{if(key==='other')await new Promise<void>(done=>{finish=done});if(value==='fail')throw new Error('disk')})
 const saves=new LocalAutosave(write)
 saves.save('other','held',true); saves.save('chat','fail')
 await expect(saves.flush(new Set(['chat']))).rejects.toThrow('尚未保存')
 saves.save('chat','new')
 await saves.flush(new Set(['chat']))
 expect(saves.has('chat')).toBe(false);expect(saves.has('other')).toBe(true)
 finish();await saves.flush()
})
it('bounds concurrent IPC and retains all 1000 pending keys without overflowing native storage', async () => {
 let active=0,max=0
 const saves = new LocalAutosave(async()=>{active++;max=Math.max(max,active);await Promise.resolve();active--})
 for(let i=0;i<1000;i++)saves.save(String(i),'draft')
 expect(()=>saves.save('overflow','draft')).toThrow('上限')
 await saves.flush();expect(max).toBe(32);expect(active).toBe(0)
})
it('retains an unsuccessful save until an explicit retry', async () => {
 const write=vi.fn(async()=>{throw new Error('disk')});const saves=new LocalAutosave(write)
 saves.save('chat',null)
 await expect(saves.flush()).rejects.toThrow('尚未保存');expect(saves.has('chat')).toBe(true)
 await expect(saves.flush()).rejects.toThrow();expect(write).toHaveBeenCalledTimes(1)
 write.mockResolvedValue(undefined);await saves.flush(undefined,true);expect(saves.has('chat')).toBe(false)
})
