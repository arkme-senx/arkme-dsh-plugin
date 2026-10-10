import { expect, it, vi } from 'vitest'
import { RelatedQuickNoteService } from '../src/services/related-quick-note-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../src/services/service.js'

it('shares only the current owner read and cancels only the departing subscriber', async () => {
  const session = {userId:11,accessToken:'test',refreshToken:'test'}
  const pending: Array<(value:Response)=>void> = []
  const signals: AbortSignal[] = []
  const fetchImpl: typeof fetch = async (_input,init) => {
    signals.push(init!.signal!)
    return await new Promise<Response>(resolve=>pending.push(resolve))
  }
  const config = {environment:'test',recordBaseUrl:'https://record.test',authBaseUrl:'https://auth.test',chatBaseUrl:'https://chat.test',audioBaseUrl:'https://audio.test',worldBaseUrl:'https://world.test',relationBaseUrl:'https://relation.test',intelligentBaseUrl:'https://intelligent.test',webrtcBaseUrl:'https://webrtc.test',requestTimeoutMs:5000} as ArkmeServiceConfig
  const runtime = new ServiceRuntime(config,{async read(){return session},async write(){},async delete(){}},{async uniqueCode(){return 'test'}} as StateStore,fetchImpl)
  const owner = new RelatedQuickNoteService(runtime,{} as never,{} as never,{async publicProfileSummariesByUserIds(){return new Map()}} as never,{async lockedRecordUids(){return new Set<string>()}} as never)
  const locator = {viewerUserId:11,sourceRef:'source',sourceOwnerRef:'owner',recordUid:'record',recordOwnerUserId:11,contextType:'record' as const,chatSessionUid:''}
  const response = () => new Response(JSON.stringify({code:0,data:{items:[],recall_mode:'embedding',retryable:false}}),{status:200,headers:{'Content-Type':'application/json'}})
  try {
    const firstAbort = new AbortController()
    const first = owner.list(locator,firstAbort.signal)
    const checked = expect(first).rejects.toBeDefined()
    const second = owner.list(locator,new AbortController().signal)
    await vi.waitFor(()=>expect(pending).toHaveLength(1))
    firstAbort.abort();await checked
    expect(signals[0]!.aborted).toBe(false)
    pending[0]!(response());expect((await second).items).toEqual([])
    const old = owner.list(locator)
    await vi.waitFor(()=>expect(pending).toHaveLength(2))
    runtime.invalidateKey('user:11','record:record')
    const fresh = owner.list(locator)
    await vi.waitFor(()=>expect(pending).toHaveLength(3))
    pending[1]!(response());pending[2]!(response())
    await Promise.all([old,fresh])
  } finally {owner.dispose();runtime.dispose()}
})
