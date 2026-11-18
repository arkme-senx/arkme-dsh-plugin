import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,expect,it,vi} from 'vitest'
import {ArkmeLocalDatabase} from '../../src/local-database.js'
import {ArkmeStateStore} from '../../src/state-store.js'
import {ServiceRuntime,type ArkmeServiceConfig} from '../../src/services/service.js'
import {RecordService} from '../../src/services/record-service.js'
import {sendSelectedTextSelfNote} from '../../src/services/selected-text-self-note.js'
import {sendSelectedTextForward} from '../../src/services/selected-text-forward.js'
const dirs:string[]=[], databases:ArkmeLocalDatabase[]=[]
afterEach(async()=>{for(const db of databases.splice(0))db.close();for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true})})
const uid='c42f0a3c-c438-4b81-9dd9-21605f8f626d'
const config={environment:'test',authBaseUrl:'https://auth.test',recordBaseUrl:'https://record.test',requestTimeoutMs:1000,maxTextLength:20000} as ArkmeServiceConfig
it('recovers the single frozen text/excerpt after restart, preserves global tag offsets and isolates another account',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'codex-excerpt-outbox-'));dirs.push(directory)
 const session={userId:11,accessToken:'test',refreshToken:'test-session'}
 const sessions={read:async()=>session,write:async()=>{},delete:async()=>{}}
 const bodies:{path:string;body:any}[]=[];let offline=true
 const fetchImpl=vi.fn<typeof fetch>(async(input,init)=>{
  const body=JSON.parse(String(init?.body));bodies.push({path:String(input),body})
  if(offline)throw TypeError('offline')
  return new Response(JSON.stringify({code:0,data:{record_uid:uid,status:1,semantic_version:1}}))
 })
 const make=(store:ArkmeLocalDatabase)=>new RecordService(new ServiceRuntime(config,sessions,store,fetchImpl),{richContentBlocks:()=>[],recordMediaUnavailable:()=>false} as never,{} as never)
 const firstStore=new ArkmeLocalDatabase(directory,new ArkmeStateStore(directory));databases.push(firstStore);const first=make(firstStore)
 const input={expectedAccountKey:'test:11',recordUid:uid,noteText:'😀 自己 #笔记',quote:{version:1 as const,sourceLabel:'Codex',senderName:'作者',sourceAtMillis:1,text:'引用 #不应建标签 😀'}}
 await expect(sendSelectedTextSelfNote((first as any).runtime,input,async(text,user,excerpt)=>{
  const result=await first.createTextForConversation(uid,text,{expectedUserId:user,excerpt})
  return {sourceRef:'self',itemUid:result.recordUid,status:result.status,localState:result.localState}
 })).rejects.toMatchObject({code:'self-note-unconfirmed'})
 firstStore.close();databases.splice(databases.indexOf(firstStore),1)
 const reopened=new ArkmeLocalDatabase(directory,new ArkmeStateStore(directory));databases.push(reopened)
 const pending=(await reopened.listPending(11))[0]!
 expect(pending.excerpt).toBeDefined();expect(await reopened.listPending(22)).toEqual([])
 expect((await reopened.listPending(11))).toHaveLength(1)
 const second=make(reopened)
 await expect(second.createText(uid,pending.textContent+'不同意图',{excerpt:pending.excerpt})).rejects.toMatchObject({code:'record-intent-conflict'})
 offline=false;await second.retryPending(uid)
 const creates=bodies.filter(v=>v.path.endsWith('/records/create'))
 expect(creates).toHaveLength(2);expect(creates[0]!.body).toEqual(creates[1]!.body)
 const tags=bodies.find(v=>v.path.endsWith('/records/tags/set'))!.body.tags
 expect(tags).toEqual([{tag_text:'笔记',start_index:pending.textContent.indexOf('#笔记'),length:3}])
 expect(creates[1]!.body.content_payload.hash_tags).toEqual([{tag:'笔记',start_index:pending.textContent.indexOf('#笔记'),length:3}])
 expect(await reopened.listPending(11)).toEqual([])
 const item=second.recordItem({record_core:{record_uid:uid,text_content:pending.textContent,status:1,content_payload:{excerpt:pending.excerpt}}},11)!
 expect(second.recordTimelineItem(item).localSelfQuote).toMatchObject({storage:'cloud',noteText:input.noteText,quote:{text:input.quote.text}})
})

it('rejects a changed send time after an accepted self forward has left the outbox', async () => {
 const directory = await mkdtemp(join(tmpdir(), 'codex-excerpt-receipt-'))
 dirs.push(directory)
 const store = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
 databases.push(store)
 const session = {userId: 11, accessToken: 'test', refreshToken: 'test-session'}
 const sessions = {read: async () => session, write: async () => {}, delete: async () => {}}
 const acceptedAt = 1000
 let acceptedBody: Record<string, unknown> | undefined
 const reply = (code: number, data: unknown) => new Response(JSON.stringify({code, data}))
 const fetchImpl: typeof fetch = async (url, init) => {
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>
  if (String(url).endsWith('/records/detail')) {
   return reply(0, {record_core: {...acceptedBody, owner_user_id: 11, status: 1, content_access_state: 1}})
  }
  if (body.send_at !== acceptedAt) return reply(40001, null)
  acceptedBody = body
  return reply(0, {record_uid: uid, status: 1})
 }
 const runtime = new ServiceRuntime(config, sessions, store, fetchImpl)
 const service = new RecordService(runtime, {} as never, {} as never)
 const forward = (sendAtMillis: number) => sendSelectedTextForward(runtime, {
  expectedAccountKey: 'test:11', recordUid: uid, relationUid: uid, sendAtMillis, commentText: '',
  quote: {version: 1, sourceLabel: '私聊', senderName: '作者', sourceAtMillis: 1, text: '独立摘录'},
 }, {kind: 'send_to_self', ownerRef: 'self'}, async (text, userId, excerpt) => {
  const result = await service.createTextForConversation(uid, text, {expectedUserId: userId, excerpt, sendAtMillis})
  return {sourceRef: 'self', itemUid: result.recordUid, status: result.status, localState: result.localState}
 })
 await expect(forward(acceptedAt)).resolves.toMatchObject({itemUid: uid, localState: 'synced'})
 expect(await store.listPending(11)).toEqual([])
 await expect(forward(acceptedAt + 1)).rejects.toThrow()
 expect(await store.listPending(11)).toEqual([])
 expect((await store.cachedSnapshot(11)).items).toMatchObject([{recordUid: uid, sendAtMillis: acceptedAt, status: 1}])
 await expect(forward(acceptedAt)).resolves.toMatchObject({itemUid: uid, localState: 'synced'})
})
