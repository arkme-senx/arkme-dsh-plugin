import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash,randomUUID} from 'node:crypto'
import {expect,it} from 'vitest'
import {ArkmeLocalDatabase} from '../../src/local-database.js'
import {ArkmeStateStore} from '../../src/state-store.js'
import {ArkmeService,type ArkmeServiceConfig} from '../../src/arkme-service.js'
import {quoteSourceContent} from '../../src/message-quote.js'
const dir=process.env.CODEX_EXCERPT_CONTRACT_DIR
it.skipIf(!dir)('sends four target kinds through the actual Host owner, Record/Chat HTTP and Mongo, then reads from an independent client',async()=>{
 const ready=JSON.parse(await readFile(join(dir!,'ready.json'),'utf8')),chat=JSON.parse(await readFile(join(dir!,'chat-ready.json'),'utf8')),roots:string[]=[],clients:Array<{service:ArkmeService;db:ArkmeLocalDatabase}>=[],trace:unknown[]=[]
 const make=async(user:number,token:string)=>{
  const root=await mkdtemp(join(tmpdir(),'q01 independent client '));roots.push(root);const db=new ArkmeLocalDatabase(root,new ArkmeStateStore(root));
  const session={userId:user,accessToken:token,refreshToken:token},store={read:async()=>session,write:async()=>{},delete:async()=>{}}
  const config={environment:'test',authBaseUrl:ready.url,recordBaseUrl:ready.url,chatBaseUrl:chat.url,subjectBaseUrl:ready.url,botBaseUrl:ready.url,imBaseUrl:ready.url,webrtcBaseUrl:ready.url,worldBaseUrl:ready.url,relationBaseUrl:ready.url,intelligentBaseUrl:ready.url,audioBaseUrl:ready.url,routePath:'/arkme-self/api',requestTimeoutMs:30000,maxTextLength:20000,fileStateDirectory:root,geetestCaptchaId:'isolated'} as ArkmeServiceConfig
  const service=new ArkmeService(config,store,db,async(input,init)=>{const url=new URL(String(input));if(url.hostname!=='127.0.0.1')throw new Error('Non-loopback request forbidden');const response=await fetch(input,init);const json=await response.clone().json().catch(()=>({}));trace.push({path:url.pathname,status:response.status,code:json.code,message:json.message});return response})
  clients.push({service,db});return service
 }
 const rawPost=async(base:string,path:string,body:unknown,token=ready.token_a)=>{const response=await fetch(base+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});const r=await response.json() as any;expect([0,200],JSON.stringify(r)).toContain(r.code);return r.data}
 try{
  const a=await make(11,ready.token_a),b=await make(11,ready.token_b),recipient=await make(22,ready.token_other),source=(a as any).source
  const original=randomUUID(),originalText='前文 相同 😀 相同 😀 尾文';await (a as any).record.createTextForConversation(original,originalText)
  const start=originalText.lastIndexOf('相同 😀'),quote={version:1 as const,sourceLabel:'私聊',senderName:'作者',sourceAtMillis:1000,text:'相同 😀',source:{kind:'record' as const,owner_user_id:11,record_uid:original},sourceSelection:{projection:'arkme-text-v1' as const,source_digest:createHash('sha256').update(quoteSourceContent({textContent:originalText,textFormat:'plain'})).digest('hex'),start,end:start+5,record_version:1}}
  const prepared=await a.prepareSelectedText({expectedAccountKey:'test:11',quote});expect(prepared).toEqual(quote)
  const commands:any[]=[]
  for(const [kind,owner] of [['send_to_self','self'],['topic','11111111-1111-4111-8111-111111111119'],['private_chat',chat.private],['group_chat',chat.group]] as const){
   const targetSourceRef=await source.sealSourceRef(11,kind,owner,'隔离目标'),command={expectedAccountKey:'test:11',targetSourceRef,recordUid:randomUUID(),relationUid:randomUUID(),sendAtMillis:Date.now(),commentText:kind==='topic'?'我的 #思考':'',quote:prepared};commands.push(command)
   const first=await a.forwardSelectedText(command);expect(first.localState,JSON.stringify(trace)).toBe('synced');const retry=await a.forwardSelectedText(command);expect(retry.itemUid).toBe(first.itemUid)
   if(kind==='send_to_self'||kind==='topic'){
    expect(first.status).toBe(1)
    const read=await b.personalRecordDetail(first.itemUid);expect(read.localSelfQuote).toMatchObject({kind:'forward',quote:{text:quote.text,sourceSelection:quote.sourceSelection},noteText:command.commentText,storage:'cloud'})
   }else{
    if(kind==='group_chat'){const pass=await fetch(chat.url+'/fixture/audit-pass',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rel_uid:command.relationUid})});expect(pass.status,await pass.text()).toBe(200)}
    const detail=await rawPost(chat.url,'/api/v1/chats/records/detail',{chat_session_uid:owner,record_uid:first.itemUid,record_owner_user_id:11,rel_uid:command.relationUid},ready.token_other)
    expect(detail.item.record.payload.content_payload.excerpt).toMatchObject({kind:'forward',source_selection:quote.sourceSelection});expect(detail.item.record.payload.text_content).toContain(quote.text)
   }
  }
  const own=commands[0]!,saved=await b.personalRecordDetail(own.recordUid);expect((await b.excerptOriginal(own.recordUid)).selection).toEqual({start,end:start+5})
  // Editing only the comment is a CAS owner mutation. Replaying create must keep it.
  await rawPost(ready.url,'/api/v1/records/update',{record_uid:own.recordUid,version:1,title:'',text_content:saved.textContent+'\n\n附言\n后来附言',template_kind:1})
  await a.forwardSelectedText(own);expect((await b.personalRecordDetail(own.recordUid)).localSelfQuote?.noteText).toBe('后来附言')
  await expect(a.forwardSelectedText({...own,commentText:'改参'})).rejects.toThrow()
  await expect(recipient.excerptOriginal(own.recordUid)).rejects.toThrow()
  // The original is not an access grant and stale selection is never relocated by text search.
  await rawPost(ready.url,'/api/v1/records/update',{record_uid:original,version:1,title:'',text_content:originalText+'编辑',template_kind:1})
  await expect(b.excerptOriginal(own.recordUid)).rejects.toThrow(/变化/)
  expect((await b.personalRecordDetail(own.recordUid)).localSelfQuote?.quote.text).toBe(quote.text)
  await writeFile(join(dir!,'forward-passed.json'),JSON.stringify({targets:4,independentClients:3,trace}));
 }finally{for(const c of clients){c.service.dispose();c.db.close()}for(const root of roots)await rm(root,{recursive:true,force:true})}
},180000)
