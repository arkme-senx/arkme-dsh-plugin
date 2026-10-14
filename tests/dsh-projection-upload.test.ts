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
