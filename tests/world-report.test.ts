import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorldService } from '../src/services/world-service.js'
import { ArkmeStateStore } from '../src/state-store.js'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { ServiceRuntime, type ArkmeServiceConfig } from '../src/services/service.js'
const UID='ccfe56ca-4d7a-4c95-b383-fce1c65a635b', revision='a'.repeat(32)
const runtimes:ServiceRuntime[]=[],databases:ArkmeLocalDatabase[]=[],dirs:string[]=[]
afterEach(async()=>{runtimes.splice(0).forEach(r=>r.dispose());databases.splice(0).forEach(db=>db.close());for(const p of dirs.splice(0))await rm(p,{recursive:true,force:true})})
async function fixture(team=false){
 let userId=42,status=200
 let response:Record<string,unknown>={submitted:true,report_id:1000000000001}
 const directory=await mkdtemp(join(tmpdir(),'world report '));dirs.push(directory)
 const raw:Record<string,unknown>={record_uid:'record-1',content_revision:revision,principal:team?{kind:'team',team_id:123,name:'团队',jotmo_id:'team_123'}:{kind:'person',user_id:7,name:'作者'},text_content:'公开正文',check_status:2,images:[],videos:[],voices:[]}
 const config=Object.fromEntries(['world','auth','subject','record','chat','bot','im','webrtc','relation','intelligent','audio'].map(s=>[s+'BaseUrl','https://'+s+'.test'])) as unknown as ArkmeServiceConfig
 Object.assign(config,{environment:'test',requestTimeoutMs:5000,maxTextLength:20000})
 const writes:{path:string;body:Record<string,unknown>}[]=[]
 const fetcher=vi.fn<typeof fetch>(async(url,init)=>{
  const u=new URL(String(url));if(u.pathname.endsWith('/query'))return Response.json({code:200,data:{items:[raw],has_more:false}})
  if(u.pathname.endsWith('/read'))return Response.json({code:200,data:raw})
  writes.push({path:u.pathname,body:JSON.parse(String(init?.body))})
  return status===200?Response.json({code:200,data:response}):new Response('',{status})
 })
 const sessions={async read(){return {userId,accessToken:'access',refreshToken:'refresh'}},async write(){},async delete(){}}
 let store!:ArkmeStateStore
 const create=()=>{store=new ArkmeStateStore(directory);const database=new ArkmeLocalDatabase(directory,store);databases.push(database);const runtime=new ServiceRuntime(config,sessions,database,fetcher);runtimes.push(runtime);return new WorldService(runtime,{} as never,{} as never,{} as never)}
 const world=create(),target=(await world.listWorldFeed()).items[0]!.recordRef;fetcher.mockClear()
 return {world,target,raw,writes,fetcher,create,get store(){return store},changeAccount(){userId=99},status(n:number){status=n},response(value:Record<string,unknown>){response=value}}
}
const submit=(recordRef:string,reason='问题')=>({action:'submit' as const,confirmed:true as const,recordRef,expectedUserId:42,reportType:6,reason,requestUid:UID})
describe('world public reports',()=>{
 it.each([false,true])('uses one unified owner and explicit public revision (team=%s)',async team=>{
  const f=await fixture(team);expect(await f.world.worldReport(submit(f.target))).toEqual({submitted:true})
  expect(f.writes).toEqual([{path:'/api/v1/world/reports/create',body:{record_uid:'record-1',content_revision:revision,report_type:6,reason:'问题',request_uid:UID}}])
  expect(await f.world.worldReport({action:'pending',recordRef:f.target,expectedUserId:42})).toEqual({submitted:true,pending:{requestUid:UID,reportType:6,reason:'问题'}})
  await f.world.worldReport({action:'acknowledge',recordRef:f.target,expectedUserId:42,requestUid:UID})
  expect(await f.world.worldReport({action:'pending',recordRef:f.target,expectedUserId:42})).toEqual({})
 })
 it('recovers exact frozen payload after response loss, restart and target withdrawal',async()=>{
  const f=await fixture(true);f.status(503)
  await expect(f.world.worldReport(submit(f.target))).rejects.toMatchObject({code:'world-report-unconfirmed'})
  Object.assign(f.raw,{is_public:false,content_revision:'b'.repeat(32)})
  const restarted=f.create(),ref=await restarted.publicationReference('record-1')
  expect(await restarted.worldReport({action:'pending',recordRef:ref,expectedUserId:42})).toEqual({pending:{requestUid:UID,reportType:6,reason:'问题'}})
  f.fetcher.mockClear();f.status(200)
  expect(await restarted.worldReport(submit(ref))).toEqual({submitted:true})
  expect(f.fetcher.mock.calls.map(([u])=>new URL(String(u)).pathname)).toEqual(['/api/v1/world/reports/create'])
  expect(f.writes[0]!.body).toEqual(f.writes[1]!.body)
 })
 it('rejects a changed retry before any network side effect',async()=>{
  const f=await fixture();f.status(503);await expect(f.world.worldReport(submit(f.target))).rejects.toThrow()
  f.fetcher.mockClear();await expect(f.world.worldReport(submit(f.target,'changed'))).rejects.toMatchObject({code:'world-report-pending'});expect(f.fetcher).not.toHaveBeenCalled()
 })
 it('never falls back to the old non-idempotent endpoint',async()=>{
  const f=await fixture();f.status(404);await expect(f.world.worldReport(submit(f.target))).rejects.toMatchObject({code:'world-report-unconfirmed'})
  expect(f.writes.map(w=>w.path)).toEqual(['/api/v1/world/reports/create'])
 })
 it('counts Unicode code points and checks the account before submitting',async()=>{
  const f=await fixture();await expect(f.world.worldReport(submit(f.target,'𠮷'.repeat(501)))).rejects.toMatchObject({code:'world-report-invalid'})
  expect(await f.world.worldReport(submit(f.target,'𠮷'.repeat(500)))).toEqual({submitted:true})
  f.changeAccount();await expect(f.world.worldReport(submit(f.target))).rejects.toMatchObject({code:'world-account-changed'})
 })
 it.each([{record_uid:'other'},{is_public:false},{check_status:1},{check_status:4},{content_revision:'media-version'.repeat(6)},{principal:{kind:'person',user_id:42,name:'自己'}}])('rejects a stale, private or invalid target: %j',async patch=>{
  const f=await fixture();Object.assign(f.raw,patch);await expect(f.world.worldReport(submit(f.target))).rejects.toThrow();expect(f.writes).toHaveLength(0)
 })
 it('retains a confirmed receipt across restart until the caller observes and acknowledges it',async()=>{
  const f=await fixture();await f.world.worldReport(submit(f.target))
  const owner=f.create(),ref=await owner.publicationReference('record-1');f.fetcher.mockClear()
  expect(await owner.worldReport({action:'pending',recordRef:ref,expectedUserId:42})).toMatchObject({submitted:true,pending:{requestUid:UID}})
  expect(await owner.worldReport(submit(ref))).toEqual({submitted:true});expect(f.fetcher).not.toHaveBeenCalled()
  await owner.worldReport({action:'acknowledge',recordRef:ref,expectedUserId:42,requestUid:UID})
  expect(await owner.worldReport({action:'pending',recordRef:ref,expectedUserId:42})).toEqual({})
 })
 it('cannot acknowledge an unknown write to bypass recovery',async()=>{
  const f=await fixture();f.status(503);await expect(f.world.worldReport(submit(f.target))).rejects.toThrow()
  await expect(f.world.worldReport({action:'acknowledge',recordRef:f.target,expectedUserId:42,requestUid:UID})).rejects.toMatchObject({code:'world-report-unconfirmed'})
  expect(await f.world.worldReport({action:'pending',recordRef:f.target,expectedUserId:42})).toHaveProperty('pending')
 })
 it('clears only a definitely rejected request so corrected input can be submitted',async()=>{
  const f=await fixture();f.response({submitted:false,rejected:'target_changed'})
  await expect(f.world.worldReport(submit(f.target))).rejects.toMatchObject({code:'world-report-rejected'})
  expect(await f.world.worldReport({action:'pending',recordRef:f.target,expectedUserId:42})).toEqual({})
  f.response({submitted:true,report_id:1000000000002})
  expect(await f.world.worldReport({...submit(f.target,'修正说明'),requestUid:'corrected_request_0001'})).toEqual({submitted:true})
 })
 it('retains the original request for malformed or contradictory responses',async()=>{
  const f=await fixture();f.response({submitted:true,report_id:1000000000001,rejected:'target_changed'})
  await expect(f.world.worldReport(submit(f.target))).rejects.toMatchObject({code:'world-report-unconfirmed'})
  expect(await f.world.worldReport({action:'pending',recordRef:f.target,expectedUserId:42})).toHaveProperty('pending')
 })
 it('does not return another account’s pending details after a slow store read',async()=>{
  const f=await fixture();f.status(503);await expect(f.world.worldReport(submit(f.target))).rejects.toThrow()
  const read=f.store.worldReportCommand.bind(f.store)
  const spy=vi.spyOn(f.store,'worldReportCommand').mockImplementation(async(...args)=>{const value=await read(...args);f.changeAccount();return value})
  try {
   await expect(f.world.worldReport({action:'pending',recordRef:f.target,expectedUserId:42})).rejects.toMatchObject({code:'world-account-changed'})
  } finally {spy.mockRestore()}
 })

})
