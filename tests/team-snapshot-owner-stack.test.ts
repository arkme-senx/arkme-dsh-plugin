// Test-only loopback bridge: real public Team adapter -> real Team/Record owners.
import { readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { it, expect } from 'vitest'
import { TeamAppService } from '../src/services/team-app-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../src/services/service.js'
import type { ArkmeSessionStore } from '../src/keychain-store.js'
import type { TeamOpen, TeamTimeline } from '../src/team-app-contract.js'
import type { TeamMessageSnapshot } from '../src/team-snapshot-contract.js'

it.skipIf(!process.env.T15_OWNER_STACK)('PC and mobile share canonical author facts over the real owner HTTP stack',async()=>{
 const file=process.env.T15_OWNER_STACK!,fixture=JSON.parse(await readFile(file,'utf8'))
 const origin=new URL(fixture.team)
 if(origin.hostname!=='127.0.0.1'||origin.port!=='33811')throw new Error('isolated fixture only')
 const credentials={userId:2,accessToken:fixture.token,refreshToken:'synthetic-test-refresh'}
 let rawConversation='',rawMessage=''
 const gateway:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));if(url.hostname!=='t15.invalid')throw new Error('unexpected gateway')
  const headers=new Headers(init?.headers);headers.set('Authorization',`Bearer ${fixture.token}`)
  const result=await fetch(new URL(url.pathname,origin),{...init,headers})
  if(!result.ok)throw new Error(`fixture ${url.pathname}: ${result.status} ${await result.text()}`)
  const data=await result.clone().json() as {data?:{conversation?:{conversation_uid:string};message_uid?:string}}
  if(data.data?.conversation)rawConversation=data.data.conversation.conversation_uid
  if(url.pathname.endsWith('/send'))rawMessage=data.data?.message_uid??''
  return result
 }
 const config={environment:'test',teamBaseUrl:'https://t15.invalid',requestTimeoutMs:5000,maxTextLength:20000} as ArkmeServiceConfig
 const runtime=new ServiceRuntime(config,{} as ArkmeSessionStore,{uniqueCode:async()=> 't15-cross-client-fixture'} as StateStore,gateway)
 runtime.requireSession=async()=>credentials
 runtime.accountScopedSession=async()=>credentials
 const service=new TeamAppService(runtime,{publicAvatarPresentationsByArkmeIds:async()=>new Map()},{} as never,{privateRemarksByUserIds:async()=>new Map()} as never,{} as never)
 if(process.env.T15_OWNER_PHASE==='verify'){
  const page=await service.execute('team.app.timeline',{conversationRef:fixture.conversationRef}) as TeamTimeline
  const mobile=page.messages.find(m=>m.content?.text_content==='T15 mobile wire')!
  expect(mobile).toBeDefined()
  const mobileFacts=await service.execute('team.app.snapshot.read',{conversationRef:fixture.conversationRef,messageRef:mobile.ref}) as TeamMessageSnapshot
  expect(mobileFacts.detail.recordDurationMillis).toBe(0)
  expect(mobileFacts.detail.captureContext?.clientName).toBe('mobile-private-original')
  const pcFacts=await service.execute('team.app.snapshot.read',{conversationRef:fixture.conversationRef,messageRef:fixture.messageRef}) as TeamMessageSnapshot
  expect(pcFacts.detail.captureContext?.clientName).toBe('pc-private-original')
  expect(pcFacts.detail.editDurationMillis).toBe(125)
  const receipt=await service.execute('team.app.snapshot.receipt',{conversationRef:fixture.conversationRef,messageRef:fixture.messageRef,revisionUid:fixture.mobileEditUid})
  expect(receipt).toMatchObject({accepted:true,acceptedVersion:2})
  fixture.pcVerifiedMobile=true;fixture.pcVerifiedMobileEditReceipt=true
 }else{
  const opened=await service.execute('team.app.open',{publicRef:'a'.repeat(32)}) as TeamOpen
  const conversationRef=opened.conversation!.ref,operationUid=randomUUID(),now=Date.now()-5000
  const metadata={record_started_at:now,send_at:now,capture_context:{schema_version:1,captured_at:now,device_state:'recorded',client_name:'pc-private-original',location_state:'recorded',automatic_location:{lat:0,lon:0,accuracy_meters:0,captured_at:now}}}
  const {metadataRef}=await service.execute('team.app.snapshot.seal',{conversationRef,operationUid,kind:'send',metadata}) as {metadataRef:string}
  const sent=await service.execute('team.app.send',{conversationRef,clientUid:operationUid,metadataRef,content:{template_kind:1,text_content:'T15 PC wire'}}) as {message:{ref:string}}
  expect(rawMessage).not.toBe('')
  Object.assign(fixture,{conversationRef,messageRef:sent.message.ref,conversationUid:rawConversation,messageUid:rawMessage,completedAt:now,pcCreated:true})
 }
 await writeFile(file,JSON.stringify(fixture,null,2)+'\n',{mode:0o600})
},20000)
