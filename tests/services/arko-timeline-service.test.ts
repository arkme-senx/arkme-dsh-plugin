import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach,it,expect,vi } from 'vitest'
import { ArkoTimelineService } from '../../src/services/arko-timeline-service.js'
import { ServiceRuntime,type ArkmeServiceConfig,type StateStore } from '../../src/services/service.js'
import type { SourceService } from '../../src/services/source-service.js'
import type { ArkmeSessionCredentials } from '../../src/keychain-store.js'
const config:ArkmeServiceConfig={environment:'test',authBaseUrl:'https://auth.test',subjectBaseUrl:'https://subject.test',recordBaseUrl:'https://record.test',chatBaseUrl:'https://chat.test',botBaseUrl:'https://bot.test',imBaseUrl:'https://im.test',webrtcBaseUrl:'https://webrtc.test',worldBaseUrl:'https://world.test',relationBaseUrl:'https://relation.test',intelligentBaseUrl:'https://intelligent.test',routePath:'/arkme-self/api',audioBaseUrl:'https://audio.test',requestTimeoutMs:5000,maxTextLength:20000,geetestCaptchaId:'synthetic',interwovenMomentsEnabled:true}
const cleanups:Array<()=>Promise<void>>=[]
afterEach(async()=>{for(const run of cleanups.splice(0))await run()})
const id='r:000000000000000000000001'
const wire={id,kind:'record',record_uid:'source-record',record_owner_user_id:7,occurred_at:1000,summary:'想法摘要',scene:1,content:'完整想法'}
const response=(data:unknown)=>new Response(JSON.stringify({code:200,data}),{headers:{'Content-Type':'application/json'}})
async function setup(handler:(body:any,path:string)=>Promise<Response>){
 const directory=await mkdtemp(join(tmpdir(),'arko-feed-'));let credentials:ArkmeSessionCredentials|undefined={userId:7,accessToken:'synthetic',refreshToken:'refresh'}
 const uniqueCode=vi.fn(async()=>'unique-synthetic-profile')
 const fetch=vi.fn(async(url:unknown,init?:RequestInit)=>handler(JSON.parse(String(init?.body)),String(url)))
 const runtime=new ServiceRuntime({...config,fileStateDirectory:directory},{async read(){return credentials},async write(value){credentials=value},async delete(){credentials=undefined}},{uniqueCode} as StateStore,fetch)
 const source={selfTarget:vi.fn(async()=>({sourceRef:'opaque-self',kind:'send_to_self',displayName:'发给自己'})),cachedChatSource:vi.fn(()=>undefined),sourceItem:vi.fn(),setChatSource:vi.fn(),chatSourceFromBundle:vi.fn(async()=>({sourceRef:'opaque-chat',kind:'private_chat',displayName:'私聊'}))} as unknown as SourceService
 const service=new ArkoTimelineService(runtime,source);cleanups.push(async()=>{runtime.dispose();await rm(directory,{recursive:true,force:true})});return{service,runtime,fetch,uniqueCode}
}
it('projects only opaque account-bound interaction identities and revalidates original access on open',async()=>{
 const {service,fetch,uniqueCode}=await setup(async(body,path)=>response({items:[path.endsWith('/details')?wire:{...wire,content:undefined}],has_more:false,removed_ids:[]}))
 const page=await service.arkoInteractions();expect(page.accountScope).toBe('test:7');expect(JSON.stringify(page)).not.toContain('source-record');expect(JSON.stringify(page)).not.toContain(id);expect(page.items[0]?.summary).toBe('想法摘要');expect(page.items[0]?.suggestion).toBe(false)
 expect(uniqueCode).toHaveBeenCalledTimes(1)
 const target=await service.arkoInteractionOpen(page.items[0]!.interactionRef)
 expect(target.itemUid).toBe('source-record');expect(target.source.kind).toBe('send_to_self');expect(target.thought).toMatchObject({id:id.slice(2),biz:1,content:wire.content})
 expect(fetch.mock.calls.length).toBe(2)
 await expect(service.arkoInteractionOpen(page.items[0]!.interactionRef+'x')).rejects.toMatchObject({code:'arko-interaction-unavailable'})
 expect(fetch.mock.calls.length).toBe(2)
})
it('rejects cross-account refs and cache scopes, and suppresses late account results',async()=>{
 let finish:((response:Response)=>void)|undefined;let deferred=false
 const {service,runtime,fetch}=await setup(async()=>deferred?new Promise(resolve=>{finish=resolve}):response({items:[wire],has_more:false,removed_ids:[]}))
 const page=await service.arkoInteractions();await runtime.writeSession({userId:8,accessToken:'other',refreshToken:'other'})
 await expect(service.arkoInteractionOpen(page.items[0]!.interactionRef)).rejects.toMatchObject({code:'arko-interaction-unavailable'})
 await expect(service.arkoTimelineCache('test:7')).rejects.toMatchObject({code:'arko-interaction-unavailable'})
 expect(fetch).toHaveBeenCalledTimes(1)
 deferred=true;const pending=service.arkoInteractions();await vi.waitFor(()=>expect(finish).toBeDefined());await runtime.writeSession({userId:9,accessToken:'nine',refreshToken:'nine'});finish!(response({items:[wire],has_more:false,removed_ids:[]}));await expect(pending).rejects.toMatchObject({code:'arko-interaction-unavailable'})
})
it('maps explicit revocation to stable keys and does not turn malformed pages or cancelled reads into success',async()=>{
 let mode='page';const {service}=await setup(async body=>mode==='page'?response({items:[wire],has_more:false,removed_ids:[]}):mode==='revoke'?response({items:[],has_more:false,removed_ids:body.ids}):response({items:[],has_more:true,removed_ids:[]}))
 const page=await service.arkoInteractions();mode='revoke';const revoked=await service.arkoInteractions({knownRefs:[page.items[0]!.interactionRef]});expect(revoked.removedKeys).toEqual([page.items[0]!.interactionKey])
 mode='bad';await expect(service.arkoInteractions()).rejects.toMatchObject({code:'arko-interaction-unavailable'})
 await expect(service.arkoInteractions({limit:21})).rejects.toThrow();await expect(service.arkoInteractions({},AbortSignal.abort())).rejects.toThrow()
})

it('passes encrypted observed revisions for unchanged cache proofs',async()=>{
 let request:any
 const {service}=await setup(async body=>{request=body;return response({items:body.ids?[]:[{...wire,revision:'1:2:1000'}],has_more:false,removed_ids:[]})})
 const first=await service.arkoInteractions()
 await service.arkoInteractions({knownRefs:[first.items[0]!.interactionRef]})
 expect(request).toMatchObject({ids:[id],known_revisions:{[id]:'1:2:1000'}})
 expect(JSON.stringify(first)).not.toContain('1:2:1000')
})
it.each([1,2,4,5,6])('preserves completed chat scene %s and only opens scene 5 as a suggestion',async scene=>{
 const chat={...wire,id:'c:000000000000000000000002',kind:'chat',chat_session_uid:'chat',scene,record_version:1,generation:3,navigation_at:500}
 const {service}=await setup(async(_body,path)=>path.includes('display-snapshots')?response({items:[{session:{chat_session_uid:'chat'}}]}):response({items:[chat],has_more:false,removed_ids:[]}))
 const page=await service.arkoInteractions();const target=await service.arkoInteractionOpen(page.items[0]!.interactionRef)
 expect(page.items[0]!.suggestion).toBe(scene===5);expect(target.suggestion).toBe(scene===5)
 expect(target.thought?.biz).toBe([1,2,6].includes(scene)?2:1)
 expect(target.occurredAtMillis).toBe(1000);expect(target.sourceAtMillis).toBe(500)
})
