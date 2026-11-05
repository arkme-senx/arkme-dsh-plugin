import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { ArrangementService } from '../../src/services/arrangement-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

describe('ArrangementService', () => {
  it('projects an account-bound arrangement reference', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const stateStore = { async uniqueCode() { return 'device-secret' } } as StateStore
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 200, data: {
      list: [{ uid: 'arrangement-1', title: '整理架构', status: 1, reminder_enabled: true }],
      total: 1,
    } }), { status: 200 })) as typeof fetch
    const service = new ArrangementService(new ServiceRuntime(config, sessions, stateStore, fetchImpl))

    const page = await service.listArrangements()
    expect(page.items).toEqual([expect.objectContaining({
      title: '整理架构', status: 'identified', reminderEnabled: true,
      arrangementRef: expect.stringMatching(/^arkme-arrangement-v1\./),
    })])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

it.each([
  [{ description: 'summary', source: { source_items: [{ text: '原始输入', create_at: 100 }] } }, { kind: 'input', items: [{ text: '原始输入', createdAtMillis: 100 }], unavailableCount: 0 }],
  [{ source_text: '旧版原文' }, { kind: 'input', items: [{ text: '旧版原文' }], unavailableCount: 0 }],
  [{ record_uids: ['private-record'], related_records: [{ uid: 'private-record', text_content: '快记原文', create_at: 200 }], source_text: '原始输入' }, { kind: 'input', items: [{ text: '原始输入' }], unavailableCount: 0 }],
  [{ record_uids: ['private-record'] }, { kind: 'quick-note', items: [], unavailableCount: 1 }],
  [{ description: 'only summary' }, { kind: 'none', items: [], unavailableCount: 0 }],
])('preserves creation source without leaking owner identities: %j', async (fields, expected) => {
  const sessions = { async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } }, async write() {}, async delete() {} } as ArkmeSessionStore
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 200, data: { list: [{ uid: 'a', title: 't', status: 1, ...fields }], total: 1 } }), { status: 200 })) as typeof fetch
  const service = new ArrangementService(new ServiceRuntime(config, sessions, { async uniqueCode() { return 'secret' } } as StateStore, fetchImpl))
  const page = await service.listArrangements()
  expect(page.items[0]).toHaveProperty('creationSource', expected)
  expect(JSON.stringify(page)).not.toContain('private-record')
})

function deletedService(respond: (path: string, body: Record<string, unknown>) => unknown) {
  let userId = 42
  const sessions = { async read() { return {userId,accessToken:'access',refreshToken:'refresh'} }, async write(){}, async delete(){} } as ArkmeSessionStore
  const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => new Response(JSON.stringify({code:200,data:respond(String(url),JSON.parse(String(init?.body??'{}')))}))) as typeof fetch
  return { service:new ArrangementService(new ServiceRuntime(config,sessions,{async uniqueCode(){return 'secret'}} as StateStore,fetchImpl)), fetchImpl, switchAccount:()=>{userId=99} }
}
it('reads status 4 separately and returns a read-only opaque deleted projection', async () => {
  const {service,fetchImpl} = deletedService((_path,body) => {
    expect(body).toEqual({status:4,limit:50,offset:10})
    return {list:[{uid:'owner-deleted',status:4,title:'已删除的任务',description:'保留说明',update_at:100}],total:70}
  })
  const page = await service.deletedArrangements({limit:999,offset:10})
  expect(page).toMatchObject({items:[{title:'已删除的任务',description:'保留说明',status:'deleted',arrangementRef:expect.stringMatching(/^arkme-arrangement-v1\./)}],total:70,hasMore:true,nextOffset:11})
  expect(JSON.stringify(page)).not.toContain('owner-deleted')
  expect(fetchImpl).toHaveBeenCalledOnce()
})
it('rejects a server that returned live items for a deleted-only request', async () => {
  const {service} = deletedService(()=>({list:[{uid:'a',status:1,title:'活跃任务'}],total:1}))
  await expect(service.deletedArrangements()).rejects.toMatchObject({code:'arrangement-contract-invalid'})
})
it('checks deleted detail identity and status and keeps references account-bound', async () => {
  const {service,switchAccount,fetchImpl} = deletedService((path,body)=>path.endsWith('/detail')
    ? {uid:body.uid,status:4,title:'删除详情'} : {list:[{uid:'a',status:4,title:'t'}],total:1})
  const ref = (await service.deletedArrangements()).items[0]!.arrangementRef
  await expect(service.deletedArrangementDetail(ref)).resolves.toMatchObject({arrangementRef:ref,status:'deleted',title:'删除详情'})
  switchAccount(); const before = vi.mocked(fetchImpl).mock.calls.length
  await expect(service.deletedArrangementDetail(ref)).rejects.toBeDefined()
  expect(fetchImpl).toHaveBeenCalledTimes(before)
})
it.each([{uid:'other',status:4},{uid:'a',status:2}])('rejects a changed deleted-detail response: %j', async response => {
  const {service} = deletedService(path=>path.endsWith('/detail')?response:{list:[{uid:'a',status:4}],total:1})
  const ref = (await service.deletedArrangements()).items[0]!.arrangementRef
  await expect(service.deletedArrangementDetail(ref)).rejects.toMatchObject({code:'arrangement-contract-invalid'})
})

it('rejects recognition settings requests for a stale account before cloud IO', async () => {
  const {service,fetchImpl} = deletedService(() => ({}))
  await expect(service.recognitionRequest('settings/get','test:99',{})).rejects.toMatchObject({code:'arrangement-account-changed'})
  expect(fetchImpl).not.toHaveBeenCalled()
})
it('discards recognition configuration returned after an account switch', async () => {
  let runtime:ReturnType<typeof deletedService>
  runtime=deletedService(() => {runtime.switchAccount();return {contract_version:1,sources:[],models:[],revision:'r'}})
  await expect(runtime.service.recognitionRequest('settings/get','test:42',{})).rejects.toMatchObject({code:'arrangement-account-changed'})
})
it('saves the Team model through the authenticated host and uses the server readback', async () => {
  const {service,fetchImpl}=deletedService((path,body)=>{
    expect(path).toBe('https://intelligent.test/api/v1/arrangements/recognition/settings/set')
    expect(body).toEqual({source:'team',route_key:'dashscope/qwen3.8-flash'})
    return {contract_version:1,revision:'saved-team-policy',sources:[{source:'team',label:'团队对话',personal_route_key:'dashscope/qwen3.8-flash',effective_route_key:'dashscope/qwen3.8-flash',inherited:false,prompts:[],rules:[],pipeline:[]}],models:[]}
  })
  await expect(service.recognitionRequest('settings/set','test:42',{source:'team',routeKey:'dashscope/qwen3.8-flash'})).resolves.toMatchObject({accountScope:'test:42',revision:'saved-team-policy',sources:[{source:'team',effective_route_key:'dashscope/qwen3.8-flash'}]})
  expect(fetchImpl).toHaveBeenCalledOnce()
})
it.each(['unknown','constructor','__proto__','toString'])('rejects unsupported recognition source %s before cloud IO', async source => {
  const {service,fetchImpl}=deletedService(()=>({}))
  await expect(service.recognitionRequest('settings/set','test:42',{source,routeKey:'dashscope/qwen-flash'})).rejects.toMatchObject({code:'invalid-params'})
  expect(fetchImpl).not.toHaveBeenCalled()
})
it('does not project internal owner IDs from a recognition trace',async () => {
  const {service}=deletedService(path => path.endsWith('/list') ? {list:[{uid:'secret-owner',status:1}],total:1} : {state:'ready',trace:{id:'trace',route_key:'dashscope/qwen-flash',rules:[],pipeline:[],record_uids:['private-record'],outcomes:[{uid:'secret-owner',title:'title',description:'',due_at:0}]}})
  const ref=(await service.listArrangements()).items[0]!.arrangementRef
  const result=await service.recognitionRequest('trace','test:42',{arrangementRef:ref})
  expect(JSON.stringify(result)).not.toContain('secret-owner');expect(JSON.stringify(result)).not.toContain('private-record')
})

it('projects occurrence candidates without exposing owner UIDs and binds decisions to opaque references',async()=>{
 let sent:Record<string,unknown>|undefined
 const {service}=deletedService((path,body)=>{
  if(path.endsWith('reviews/list'))return {state:'ready',items:[{id:'pending',kind:'automatic',state:'pending',created_at:100,source:'audio',reason:'需确认',candidate:{title:'接小安',description:'接送',due_at:1000},peers:[{uid:'secret-peer',title:'已有接送',status:3,version:123}],comparisons:[{uid:'secret-peer',relation:'same',confidence:.99,same_event:true,same_people:true,same_occurrence:true,time_conflict:false,place_conflict:false,reason:'同次接送'}]}]}
  sent=body;return {state:'applied',item:{uid:'secret-peer',title:'已有接送',status:3}}
 })
 const page=await service.occurrenceRequest('reviews/list','test:42',{})
 expect(JSON.stringify(page)).not.toContain('secret-peer')
 const peer=page.items![0]!.peers[0]!
 await service.occurrenceRequest('reviews/decide','test:42',{reviewId:'pending',action:'merge',targetRef:peer.arrangementRef,targetVersion:123})
 expect(sent).toEqual({id:'pending',action:'merge',target_uid:'secret-peer',target_version:123})
})
it('rejects occurrence writes from a stale account and duplicate history selections before cloud IO',async()=>{
 const {service,fetchImpl}=deletedService(()=>({}))
 await expect(service.occurrenceRequest('reviews/decide','test:99',{reviewId:'r',action:'ignore'})).rejects.toMatchObject({code:'arrangement-account-changed'})
 expect(fetchImpl).not.toHaveBeenCalled()
})
it('follows archived arrangement references to the same-account master with cycle protection',async()=>{
 const {service}=deletedService((path,body)=>path.endsWith('/list')?{list:[{uid:'old-owner',status:1}],total:1}:body.uid==='old-owner'?{uid:'old-owner',status:5,merged_into_uid:'master-owner'}:{uid:'master-owner',title:'主安排',status:3})
 const old=(await service.listArrangements()).items[0]!
 const master=await service.arrangementDetail(old.arrangementRef)
 expect(master.title).toBe('主安排');expect(master.status).toBe('completed');expect(master.arrangementRef).not.toBe(old.arrangementRef)
 expect(master.resolvedFromRef).toBe(old.arrangementRef)
 expect(JSON.stringify(master)).not.toContain('old-owner')
 expect(JSON.stringify(master)).not.toContain('master-owner')
})
it('accepts only a server-attested archived reference resolution',async()=>{
 const {service}=deletedService(path=>path.endsWith('/list')?{list:[{uid:'old',status:1}],total:1}:{uid:'master',resolved_from_uid:'old',title:'保留主项',status:3})
 const old=(await service.listArrangements()).items[0]!
 await expect(service.arrangementDetail(old.arrangementRef)).resolves.toMatchObject({title:'保留主项',status:'completed',resolvedFromRef:old.arrangementRef})
})

it.each([undefined, 'unrelated'])('rejects an unattested detail identity change (%s)', async resolvedFrom => {
 const {service}=deletedService(path=>path.endsWith('/list')?{list:[{uid:'old',status:1}],total:1}:{uid:'master',resolved_from_uid:resolvedFrom,title:'不应显示',status:3})
 const old=(await service.listArrangements()).items[0]!
 await expect(service.arrangementDetail(old.arrangementRef)).rejects.toMatchObject({code:'arrangement-contract-invalid'})
})
it('does not mark an unchanged detail identity as redirected', async () => {
 const {service}=deletedService((path,body)=>path.endsWith('/list')?{list:[{uid:'same',status:1}],total:1}:{uid:body.uid,title:'同一安排',status:1})
 const item=(await service.listArrangements()).items[0]!
 expect(await service.arrangementDetail(item.arrangementRef)).not.toHaveProperty('resolvedFromRef')
})
it('rejects a cyclic merge chain without returning a redirected detail', async () => {
 const {service}=deletedService((path,body)=>path.endsWith('/list')?{list:[{uid:'old',status:1}],total:1}:{uid:body.uid,status:5,merged_into_uid:body.uid==='old'?'master':'old'})
 const old=(await service.listArrangements()).items[0]!
 await expect(service.arrangementDetail(old.arrangementRef)).rejects.toMatchObject({code:'arrangement-contract-invalid'})
})

function restoreService(result: Record<string,unknown> | (() => Record<string,unknown>), failWrite = false) {
 return deletedService((path,body) => {
  if (path.endsWith('/list')) return {list:[{uid:'deleted-owner',status:4}],total:1}
  if (path.endsWith('/detail')) return {uid:'deleted-owner',status:4,version:10,restore:{contract_version:1,expected_version:10,target_status:3,historical_fallback:false}}
  if (path.endsWith('/restore') && failWrite) throw Error('lost response')
  expect(body.uid).toBe('deleted-owner'); expect(body.request_id).toBe('restore-once')
  return typeof result === 'function' ? result() : result
 })
}
const restoredResponse = () => ({state:'completed',operation:{uid:'deleted-owner',request_id:'restore-once',expected_version:10,applied_version:20,target_status:3},item:{uid:'deleted-owner',version:20,status:3,title:'restored',reminder_enabled:false,reminder_state:'disabled'}})
it('projects restoration capability and sends the provider-owned identity',async()=>{
 const {service,fetchImpl}=restoreService(restoredResponse())
 const ref=(await service.deletedArrangements()).items[0]!.arrangementRef
 expect((await service.deletedArrangementDetail(ref)).restore).toEqual({expectedVersion:10,targetStatus:'completed',historicalFallback:false})
 const result=await service.restoreArrangement({arrangementRef:ref,requestId:'restore-once',expectedVersion:10})
 expect(result).toMatchObject({state:'completed',item:{arrangementRef:ref,status:'completed',reminderEnabled:false}})
 expect(JSON.stringify(result)).not.toContain('deleted-owner')
 expect(JSON.parse(String(vi.mocked(fetchImpl).mock.calls.at(-1)![1]?.body))).toEqual({uid:'deleted-owner',request_id:'restore-once',expected_version:10})
})
it('reconciles a lost write response by receipt without resubmitting the write',async()=>{
 const {service,fetchImpl}=restoreService(restoredResponse(),true)
 const ref=(await service.deletedArrangements()).items[0]!.arrangementRef
 expect((await service.restoreArrangement({arrangementRef:ref,requestId:'restore-once',expectedVersion:10})).state).toBe('completed')
 const paths=vi.mocked(fetchImpl).mock.calls.map(c=>String(c[0]))
 expect(paths.filter(p=>p.endsWith('/restore'))).toHaveLength(1)
 expect(paths.filter(p=>p.endsWith('/restore/result'))).toHaveLength(1)
})
it.each([
 {...restoredResponse(),item:{...restoredResponse().item,uid:'other-owner'}},
 {...restoredResponse(),item:{...restoredResponse().item,reminder_enabled:true}},
 {...restoredResponse(),operation:{...restoredResponse().operation,expected_version:9}},
 {...restoredResponse(),operation:{...restoredResponse().operation,request_id:'other-request'}},
])('does not claim success for a mismatched restoration receipt',async response=>{
 const {service}=restoreService(response)
 const ref=(await service.deletedArrangements()).items[0]!.arrangementRef
 expect(await service.restoreArrangement({arrangementRef:ref,requestId:'restore-once',expectedVersion:10})).toEqual({state:'unknown'})
})
it('queries an uncertain operation without writing and respects later mutations',async()=>{
 const {service,fetchImpl}=restoreService({...restoredResponse(),state:'superseded'})
 const ref=(await service.deletedArrangements()).items[0]!.arrangementRef
 expect(await service.restoreArrangement({arrangementRef:ref,requestId:'restore-once',expectedVersion:10},true)).toEqual({state:'superseded'})
 expect(vi.mocked(fetchImpl).mock.calls.some(c=>String(c[0]).endsWith('/restore'))).toBe(false)
})
it('discards restoration responses when the account changes',async()=>{
 let fixture: ReturnType<typeof restoreService>
 fixture=restoreService(()=>{fixture.switchAccount();return restoredResponse()})
 const ref=(await fixture.service.deletedArrangements()).items[0]!.arrangementRef
 await expect(fixture.service.restoreArrangement({arrangementRef:ref,requestId:'restore-once',expectedVersion:10})).rejects.toMatchObject({code:'arrangement-account-changed'})
})
