import { describe, expect, it, vi } from 'vitest'
import { ProjectionUpload } from '../src/dsh-remote/projection-upload.js'
import { DshRemoteError } from '../src/dsh-remote/errors.js'
it('isolates retired identities, keeps valid writes, backs off and clears on account change', async () => {
  const uploader = new ProjectionUpload(), signal = new AbortController().signal
  const items = Array.from({ length: 100 }, (_, i) => ({ session_ref: String(i) }))
  const written = new Set<string>(), send = vi.fn(async (batch: typeof items) => {
    for (const item of batch) if (item.session_ref !== '0') written.add(item.session_ref)
    return { accepted_session_refs: batch.filter(item => item.session_ref !== '0').map(item => item.session_ref), rejected_session_refs: batch.filter(item => item.session_ref === '0').map(item => item.session_ref) }
  })
  expect(await uploader.page(items, send, signal)).toEqual({ accepted: 99, rejected: 1 })
  expect(written.size).toBe(99); expect(written.has('0')).toBe(false)
  expect(send.mock.calls.length).toBeLessThan(20)
  send.mockClear()
  for (let i = 0; i < 20; i++) expect(await uploader.page(items, send, signal)).toEqual({ accepted: 99, rejected: 1 })
  expect(send).toHaveBeenCalledTimes(20)
  uploader.clear(); send.mockClear(); await uploader.page(items, send, signal)
  expect(send).toHaveBeenCalledOnce()
})
it('does not split transport/auth failures or cache account cancellation', async () => {
  const uploader = new ProjectionUpload(), abort = new AbortController()
  const send = vi.fn(async () => { throw new DshRemoteError('REMOTE_LOGIN_REQUIRED', 'expired') })
  await expect(uploader.page([{ session_ref: 'a' }, { session_ref: 'b' }], send, abort.signal)).rejects.toThrow('expired')
  expect(send).toHaveBeenCalledOnce()
  abort.abort(); await expect(uploader.page([{ session_ref: 'a' }], send, abort.signal)).rejects.toThrow()
  expect(send).toHaveBeenCalledOnce()
})

it('bounds all-conflict pages to one request and never guesses transient conflict identities', async () => {
 const items = Array.from({length:100},(_,i)=>({session_ref:String(i)})), signal = new AbortController().signal
 for (const count of [1,50,100]) {
  const uploader = new ProjectionUpload(), send = vi.fn(async () => ({accepted_session_refs:items.slice(count).map(i=>i.session_ref),rejected_session_refs:items.slice(0,count).map(i=>i.session_ref)}))
  expect(await uploader.page(items,send,signal)).toEqual({accepted:100-count,rejected:count});expect(send).toHaveBeenCalledOnce()
 }
 const uploader = new ProjectionUpload(), send = vi.fn(async () => {throw new DshRemoteError('REMOTE_PROJECTION_CONFLICT','retry the page')})
 await expect(uploader.page(items,send,signal)).rejects.toThrow('retry the page');expect(send).toHaveBeenCalledOnce()
 const recovered = vi.fn(async () => ({}));expect((await uploader.page(items,recovered,signal)).accepted).toBe(100)
})
it('rejects incomplete, duplicate and invented receipts without caching rejections', async () => {
 const signal = new AbortController().signal, items=[{session_ref:'a'},{session_ref:'b'}]
 for(const receipt of [ {accepted_session_refs:['a'],rejected_session_refs:[]}, {accepted_session_refs:['a'],rejected_session_refs:['a','b']}, {accepted_session_refs:['a'],rejected_session_refs:['unknown']}] ){
  const uploader=new ProjectionUpload();await expect(uploader.page(items,async()=>receipt,signal)).rejects.toThrow('回执不完整')
  expect(await uploader.page(items,async()=>({}),signal)).toEqual({accepted:2,rejected:0})
 }
})


describe('source binding receipts', () => {
  it('accepts only bindings belonging to the acknowledged batch', async () => {
    const upload = new ProjectionUpload(), signal = new AbortController().signal
    const send = async () => ({ accepted_session_refs: ['s'], rejected_session_refs: [], source_bindings: { s: 'a'.repeat(64) } })
    expect(await upload.page([{ session_ref: 's' }], send, signal)).toEqual({ accepted: 1, rejected: 0, sourceBindings: { s: 'a'.repeat(64) } })
    for (const source_bindings of [null, [], { foreign: 'a'.repeat(64) }, { s: 'short' }]) {
      await expect(upload.page([{ session_ref: 's' }], async () => ({ ...await send(), source_bindings }), signal)).rejects.toThrow('来源绑定')
    }
  })
})

it('recovers a restored source once in background and reuses its binding on later heartbeats', async()=>{
 const upload=new ProjectionUpload(),scope=new AbortController(),items=[{session_ref:'restored'}],binding='b'.repeat(64)
 const send=vi.fn(async(batch:Array<{session_ref:string,recovery_proof?:unknown}>)=>batch[0]?.recovery_proof ? {accepted_session_refs:['restored'],rejected_session_refs:[],source_bindings:{restored:binding},source_recovery_version:1} : {accepted_session_refs:[],rejected_session_refs:['restored'],source_recovery_version:1})
 const read=vi.fn(async()=>({version:1 as const,messages:{['a'.repeat(64)]:1},sequence:['a'.repeat(64)]})),recovered=vi.fn(async()=>{}),failed=vi.fn()
 const recovery={signal:scope.signal,read,recovered,failed}
 expect(await upload.page(items,send,scope.signal,recovery)).toEqual({accepted:0,rejected:1})
 await vi.waitFor(()=>expect(recovered).toHaveBeenCalledWith({restored:binding}))
 expect(send).toHaveBeenCalledTimes(2);expect(read).toHaveBeenCalledOnce();expect(failed).not.toHaveBeenCalled()
 send.mockImplementation(async()=>({accepted_session_refs:['restored'],rejected_session_refs:[],source_bindings:{restored:binding},source_recovery_version:1}))
 for(let i=0;i<100;i++)expect((await upload.page(items,send,scope.signal,recovery)).accepted).toBe(1)
 expect(read).toHaveBeenCalledOnce()
})
it('bounds failed recovery for 100 rejected identities and cancels it on account change',async()=>{
 const upload=new ProjectionUpload(),scope=new AbortController(),items=Array.from({length:100},(_,i)=>({session_ref:String(i)}))
 let release!:()=>void
 const read=vi.fn(async()=>{await new Promise<void>(resolve=>{release=resolve});return {version:1 as const,messages:{},sequence:['a'.repeat(64)]}})
 const recovered=vi.fn(async()=>{}),failed=vi.fn(),send=vi.fn(async()=>({accepted_session_refs:[],rejected_session_refs:items.map(i=>i.session_ref),source_recovery_version:1}))
 const recovery={signal:scope.signal,read,recovered,failed}
 await upload.page(items,send,scope.signal,recovery)
 for(let i=0;i<100;i++)await upload.page(items,send,scope.signal,recovery)
 expect(read).toHaveBeenCalledOnce();expect(send).toHaveBeenCalledOnce()
 scope.abort();upload.clear();release();await new Promise(resolve=>setTimeout(resolve,0))
 expect(recovered).not.toHaveBeenCalled();expect(send).toHaveBeenCalledOnce();expect(failed).not.toHaveBeenCalled()
})

it('recovers a lost recovery ACK after restart without re-reading history or publishing another identity', async () => {
  const signal = new AbortController().signal, items = [{ session_ref: 'restored' }], binding = 'c'.repeat(64)
  let admitted = false
  const send = vi.fn(async (batch: Array<{session_ref: string; recovery_proof?: unknown}>) => {
    if (batch[0]?.recovery_proof) { admitted = true; throw new Error('response lost after server commit') }
    return admitted
      ? { accepted_session_refs: ['restored'], rejected_session_refs: [], source_bindings: { restored: binding }, source_recovery_version: 1 }
      : { accepted_session_refs: [], rejected_session_refs: ['restored'], source_recovery_version: 1 }
  })
  const read = vi.fn(async () => ({ version: 1 as const, messages: {['a'.repeat(64)]: 1}, sequence: ['a'.repeat(64)] }))
  const recovered = vi.fn(async () => {}), failed = vi.fn()
  await new ProjectionUpload().page(items, send, signal, { signal, read, recovered, failed })
  await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce())
  expect(admitted).toBe(true)
  expect(recovered).not.toHaveBeenCalled()
  const restarted = new ProjectionUpload()
  for (let i = 0; i < 100; i++) {
    expect(await restarted.page(items, send, signal, { signal, read, recovered, failed })).toEqual({ accepted: 1, rejected: 0, sourceBindings: { restored: binding } })
  }
  expect(read).toHaveBeenCalledOnce()
  expect(send.mock.calls.filter(([batch]) => batch.some(item => item.recovery_proof))).toHaveLength(1)
})
