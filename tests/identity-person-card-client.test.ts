import { describe, expect, it, vi } from 'vitest'
import { IdentityPersonCardClient } from '../src/client/identity-person-card-client.js'
import type { IdentityShareCard } from '../src/identity-share-contract.js'
const scope = 'prod:7', url = 'https://jiwo.cc/linshare'
const card: Extract<IdentityShareCard, {kind:'person'}> = { kind:'person',url,userId:8,displayName:'小林',accountName:'linshare',isSelf:false }
function deferred<T>() { let resolve!: (value:T)=>void; let reject!: (error:unknown)=>void; const promise = new Promise<T>((a,b)=>{resolve=a;reject=b}); return {promise,resolve,reject} }

describe('person-card snapshots shared by previews and open dialogs', () => {
  it('joins the preview read, retains it while the dialog is open, and reuses the result on repeated clicks', async () => {
    const pending=deferred<typeof card>(), read=vi.fn((_scope:string,_url:string,_signal:AbortSignal)=>pending.promise)
    const client=new IdentityPersonCardClient(read);client.setScope(scope)
    const preview=client.acquire(scope,url), dialog=client.acquire(scope,url)
    await Promise.resolve();expect(read).toHaveBeenCalledOnce()
    preview.release();expect(read.mock.calls[0]![2].aborted).toBe(false)
    pending.resolve(card);await dialog.promise;dialog.release()
    expect(client.snapshot(scope,url)?.card).toBe(card)
    const reopened=client.acquire(scope,url);await expect(reopened.promise).resolves.toBe(card);reopened.release()
    expect(read).toHaveBeenCalledOnce()
  })
  it('keeps a stale snapshot available while revalidating, then publishes the fresh identity', async () => {
    let now=0;const pending=deferred<typeof card>()
    const read=vi.fn(async()=>card).mockImplementationOnce(async()=>card).mockImplementationOnce(()=>pending.promise)
    const client=new IdentityPersonCardClient(read,()=>now);client.setScope(scope)
    const first=client.acquire(scope,url);await first.promise;first.release();now=61_000
    const refresh=client.acquire(scope,url)
    expect(client.snapshot(scope,url)?.card.displayName).toBe('小林')
    pending.resolve({...card,displayName:'新的公开昵称'});await refresh.promise;refresh.release()
    expect(client.snapshot(scope,url)?.card.displayName).toBe('新的公开昵称')
    now+=601_000;expect(client.snapshot(scope,url)).toBeUndefined()
  })
  it('forces an explicit refresh even when the snapshot is fresh', async () => {
    const read=vi.fn(async()=>card), client=new IdentityPersonCardClient(read);client.setScope(scope)
    for(const force of [false,true]){const request=client.acquire(scope,url,force);await request.promise;request.release()}
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('normalizes supported host aliases while keeping handles and accounts distinct', async () => {
    const read=vi.fn(async()=>card),client=new IdentityPersonCardClient(read);client.setScope(scope)
    const request=client.acquire(scope,'https://app.jiwo.cc/shijie/linshare');await request.promise;request.release()
    expect(client.snapshot(scope,url)?.card).toBe(card)
    expect(client.snapshot('prod:99',url)).toBeUndefined()
    await expect(client.acquire(scope,'https://jotmo-app.senguo.me/linshare').promise).rejects.toThrow()
    expect(read).toHaveBeenCalledOnce()
  })
  it('revokes old account jobs and ignores late native results', async () => {
    const pending=deferred<typeof card>(),read=vi.fn((_scope:string,_url:string,_signal:AbortSignal)=>pending.promise)
    const client=new IdentityPersonCardClient(read);client.setScope(scope)
    const request=client.acquire(scope,url);const result=request.promise.catch(error=>error)
    await Promise.resolve();client.setScope('prod:99');pending.resolve(card);await result
    expect(read.mock.calls[0]![2].aborted).toBe(true)
    expect(client.snapshot(scope,url)).toBeUndefined();expect(client.snapshot('prod:99',url)).toBeUndefined()
  })
  it('aborts only when the last reader leaves', async () => {
    const pending=deferred<typeof card>(),read=vi.fn((_scope:string,_url:string,_signal:AbortSignal)=>pending.promise)
    const client=new IdentityPersonCardClient(read);client.setScope(scope)
    const first=client.acquire(scope,url),second=client.acquire(scope,url),result=first.promise.catch(error=>error)
    await Promise.resolve();first.release();expect(read.mock.calls[0]![2].aborted).toBe(false)
    second.release();expect(read.mock.calls[0]![2].aborted).toBe(true)
    pending.resolve(card);await result;expect(client.snapshot(scope,url)).toBeUndefined()
  })
  it('does not let an older in-flight refresh restore a card after a contact action invalidates it', async () => {
    const pending=deferred<typeof card>(),read=vi.fn(async()=>card).mockImplementationOnce(async()=>card).mockImplementationOnce(()=>pending.promise)
    const client=new IdentityPersonCardClient(read);client.setScope(scope)
    const first=client.acquire(scope,url);await first.promise;first.release()
    const refresh=client.acquire(scope,url,true),result=refresh.promise.catch(error=>error)
    await Promise.resolve();client.invalidate(scope,url);pending.resolve(card);await result
    expect(client.snapshot(scope,url)).toBeUndefined()
  })
  it('does not promote a mismatched response or retain a definitively unavailable cached identity', async () => {
    const read=vi.fn(async()=>card),client=new IdentityPersonCardClient(read);client.setScope(scope)
    const first=client.acquire(scope,url);await first.promise;first.release()
    read.mockRejectedValueOnce(Object.assign(new Error('已失效'),{body:{code:'identity-share-person-unavailable'}}))
    const refresh=client.acquire(scope,url,true);await expect(refresh.promise).rejects.toThrow('已失效');refresh.release()
    expect(client.snapshot(scope,url)).toBeUndefined()
    read.mockResolvedValueOnce({...card,accountName:'different'})
    const bad=client.acquire(scope,url);await expect(bad.promise).rejects.toThrow('响应不一致');bad.release()
    expect(client.snapshot(scope,url)).toBeUndefined()
  })
})
