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
 let unknownRecordUid=''
 const make=async(user:number,token:string)=>{
  const root=await mkdtemp(join(tmpdir(),'q01 independent client '));roots.push(root);const db=new ArkmeLocalDatabase(root,new ArkmeStateStore(root));
  const session={userId:user,accessToken:token,refreshToken:token},store={read:async()=>session,write:async()=>{},delete:async()=>{}}
  const config={environment:'test',authBaseUrl:ready.url,recordBaseUrl:ready.url,chatBaseUrl:chat.url,subjectBaseUrl:ready.url,botBaseUrl:ready.url,imBaseUrl:ready.url,webrtcBaseUrl:ready.url,worldBaseUrl:ready.url,relationBaseUrl:ready.url,intelligentBaseUrl:ready.url,audioBaseUrl:ready.url,routePath:'/arkme-self/api',requestTimeoutMs:30000,maxTextLength:20000,fileStateDirectory:root,geetestCaptchaId:'isolated'} as ArkmeServiceConfig
  const service=new ArkmeService(config,store,db,async(input,init)=>{const url=new URL(String(input));if(url.hostname!=='127.0.0.1')throw new Error('Non-loopback request forbidden');const response=await fetch(input,init);const json=await response.clone().json().catch(()=>({}));trace.push({path:url.pathname,status:response.status,code:json.code,message:json.message});if(unknownRecordUid&&url.pathname==='/api/v1/records/create'&&JSON.parse(String(init?.body)).record_uid===unknownRecordUid&&json.code===0)throw new TypeError('fixture lost accepted response');return response})
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
   if(kind==='send_to_self'){
    unknownRecordUid=command.recordUid
    await expect(a.forwardSelectedText(command)).rejects.toMatchObject({code:'selected-text-unconfirmed'})
    unknownRecordUid=''
    const requests=trace.length
    await expect(a.forwardSelectedText({...command,sendAtMillis:command.sendAtMillis+1})).rejects.toMatchObject({code:'record-intent-conflict'})
    expect(trace).toHaveLength(requests)
   }
   const first=await a.forwardSelectedText(command);expect(first.localState,JSON.stringify(trace)).toBe('synced');const retry=await a.forwardSelectedText(command);expect(retry.itemUid).toBe(first.itemUid)
   if(kind==='send_to_self'){
    const retrySourceRef=await (b as any).source.sealSourceRef(11,kind,owner,'隔离目标')
    const retryCommand={...command,targetSourceRef:retrySourceRef}
    await expect(b.forwardSelectedText({...retryCommand,sendAtMillis:command.sendAtMillis+1})).rejects.toMatchObject({code:'arkme-code-40001'})
    expect((await b.forwardSelectedText(retryCommand)).itemUid).toBe(first.itemUid)
   }
   if(kind==='send_to_self'||kind==='topic'){
    expect(first.status).toBe(1)
    const read=await b.personalRecordDetail(first.itemUid);expect(read.localSelfQuote).toMatchObject({kind:'forward',quote:{text:quote.text,sourceSelection:quote.sourceSelection},noteText:command.commentText,storage:'cloud'})
   }else{
    if(kind==='group_chat'){const pass=await fetch(chat.url+'/fixture/audit-pass',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rel_uid:command.relationUid})});expect(pass.status,await pass.text()).toBe(200)}
    const detail=await rawPost(chat.url,'/api/v1/chats/records/detail',{chat_session_uid:owner,record_uid:first.itemUid,record_owner_user_id:11,rel_uid:command.relationUid},ready.token_other)
    expect(detail.item.record.payload.content_payload.excerpt).toMatchObject({kind:'forward',source_selection:quote.sourceSelection});expect(detail.item.record.payload.text_content).toContain(quote.text)
   }
  }
  // A recipient must authorize the saved chat occurrence independently of the source.
  const recipientSource=await (recipient as any).source.sealSourceRef(22,'private_chat',chat.private,'隔离私聊')
  const occurrence=async(command:any)=>{
    const owner=(recipient as any).chat
    const key=await (recipient as any).runtime.stateStore.uniqueCode()
    const action=owner.sealMessageActionRef(owner.messageActionRefPayload({sourceKind:'chat_relation',userId:22,sourceOwnerRef:chat.private,chatSessionUid:chat.private,relationUid:command.relationUid,recordOwnerUserId:11,recordUid:command.recordUid,senderUserId:11,senderName:'作者',title:'',textContent:'',sendAtMillis:command.sendAtMillis,templateKind:1,displayKind:0}),key)
    return {sourceRef:recipientSource,messageActionRef:action}
  }
  const firstChat=commands[2]!,privateItem=await rawPost(chat.url,'/api/v1/chats/records/detail',{chat_session_uid:chat.private,record_uid:firstChat.recordUid,record_owner_user_id:11,rel_uid:firstChat.relationUid},ready.token_other)
  await expect(recipient.excerptOriginal(firstChat.recordUid,undefined,await occurrence(firstChat))).rejects.toThrow(/失效|无权/)
  const originalBody=privateItem.item.record.payload.text_content as string,sourceStart=originalBody.indexOf(quote.text)
  const sharedQuote={...quote,source:{kind:'record' as const,owner_user_id:11,record_uid:firstChat.recordUid,chat_session_uid:chat.private,relation_uid:firstChat.relationUid},sourceSelection:{...quote.sourceSelection,source_digest:createHash('sha256').update(quoteSourceContent({textContent:originalBody,textFormat:'plain'})).digest('hex'),start:sourceStart,end:sourceStart+quote.text.length}}
  const sharedCommand={...firstChat,recordUid:randomUUID(),relationUid:randomUUID(),sendAtMillis:Date.now(),quote:sharedQuote}
  await a.forwardSelectedText(sharedCommand)
  const sharedOccurrence=await occurrence(sharedCommand)
  expect((await recipient.excerptOriginal(sharedCommand.recordUid,undefined,sharedOccurrence)).selection).toEqual({start:sourceStart,end:sourceStart+quote.text.length})
  await expect(recipient.excerptOriginal(original,undefined,sharedOccurrence)).rejects.toThrow(/身份不匹配/)
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
  await writeFile(join(dir!,'mobile-fixtures.json'),JSON.stringify({sharedCommand,privateCommand:firstChat,staleCommand:own}));
  await writeFile(join(dir!,'forward-passed.json'),JSON.stringify({targets:4,independentClients:3,recipientOccurrence:true,sharedOriginal:true,pendingIntentConflict:true,trace}));
 }finally{for(const c of clients){c.service.dispose();c.db.close()}for(const root of roots)await rm(root,{recursive:true,force:true})}
},180000)
