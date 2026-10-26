import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {afterEach,expect,it} from 'vitest'
import {ArkmeLocalDatabase} from '../../src/local-database.js'
import {ArkmeStateStore} from '../../src/state-store.js'
import {ServiceRuntime,type ArkmeServiceConfig} from '../../src/services/service.js'
import {RecordService} from '../../src/services/record-service.js'
import {sendSelectedTextSelfNote} from '../../src/services/selected-text-self-note.js'
import {selectedTextNoteWireText} from '../../src/selected-text-note.js'
const dir=process.env.CODEX_EXCERPT_CONTRACT_DIR
const roots:string[]=[],dbs:ArkmeLocalDatabase[]=[]
afterEach(async()=>{for(const db of dbs.splice(0))db.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
it.skipIf(!dir)('uses actual Record HTTP+Mongo from two independent SQLite clients, including legacy metadata attachment and foreign-owner denial',async()=>{
 const trace:unknown[]=[]
 const ready=JSON.parse(await readFile(join(dir!,'ready.json'),'utf8')),uid='c42f0a3c-c438-4b81-9dd9-21605f8f626d',legacy='c42f0a3c-c438-4b81-9dd9-21605f8f626e'
 const config={environment:'test',authBaseUrl:ready.url,recordBaseUrl:ready.url,requestTimeoutMs:30000,maxTextLength:20000} as ArkmeServiceConfig
 const make=async(token:string)=>{
  const root=await mkdtemp(join(tmpdir(),'excerpt real client '));roots.push(root);const store=new ArkmeLocalDatabase(root,new ArkmeStateStore(root));dbs.push(store)
  const session={userId:11,accessToken:token,refreshToken:token},runtime=new ServiceRuntime(config,{read:async()=>session,write:async()=>{},delete:async()=>{}},store,async(input,init)=>{const response=await fetch(input,init);const body=await response.clone().json() as any;trace.push({path:new URL(String(input)).pathname,status:response.status,code:body.code,message:body.message});return response})
  const service=new RecordService(runtime,{hydrateRecordMediaPage:async()=>({displayItemsByRecordUid:new Map(),unavailableRecordUids:new Set()}),richContentBlocks:()=>[],recordMediaUnavailable:()=>false} as never,{} as never)
  return {store,runtime,service}
 }
 const a=await make(ready.token_a),b=await make(ready.token_b)
 const quote={version:1 as const,sourceLabel:'Codex',senderName:'作者',sourceAtMillis:1000,text:'私人原话 😀'}
 const legacyText=selectedTextNoteWireText('旧笔记',quote)
 await a.service.createTextForConversation(legacy,legacyText)
 a.store.selfNoteQuotes!.prepare('test:11',legacy,quote,'旧笔记')
 const legacyCore=(await a.runtime.authenticatedPost<any>('/api/v1/records/detail',{record_uid:legacy})).record_core
 expect({owner:legacyCore?.owner_user_id,status:legacyCore?.status,version:legacyCore?.version,text:legacyCore?.text_content}).toMatchObject({owner:11,status:1,version:1,text:legacyText})
 expect(a.store.selfNoteQuotes!.migrationCandidates('test:11')).toEqual([legacy])
 await a.service.migrateLegacySelfExcerpts()
 expect(a.store.selfNoteQuotes!.project('test:11',legacy,legacyText),JSON.stringify(trace)).toBeUndefined()
 const migrated=await b.service.personalRecordDetail(legacy)
 expect(migrated.localSelfQuote).toMatchObject({storage:'cloud',quote:{text:quote.text},noteText:'旧笔记'})
 const input={expectedAccountKey:'test:11',recordUid:uid,noteText:'自己的 #思考',quote:{...quote,text:quote.text+' #引用不触发标签 @Bot',source:{kind:'record' as const,owner_user_id:11,record_uid:legacy}}}
 const send=async(text:string,user:number,excerpt:any)=>{const result=await a.service.createTextForConversation(uid,text,{expectedUserId:user,excerpt});expect(result.localState,JSON.stringify(trace)).toBe('synced');return {sourceRef:'self',itemUid:result.recordUid,status:result.status,localState:result.localState}}
 await sendSelectedTextSelfNote(a.runtime,input,send)
 await sendSelectedTextSelfNote(a.runtime,input,send)
 const current=await b.service.personalRecordDetail(uid)
 expect(current.localSelfQuote).toMatchObject({quote:{text:input.quote.text},noteText:input.noteText,storage:'cloud'})
 expect(await b.service.excerptNavigationSource(uid)).toEqual({kind:'record',owner_user_id:11,record_uid:legacy})
 const quoteOnly={...input,recordUid:'c42f0a3c-c438-4b81-9dd9-21605f8f626f',noteText:''}
 await sendSelectedTextSelfNote(a.runtime,quoteOnly,async(text,user,excerpt)=>{const result=await a.service.createTextForConversation(quoteOnly.recordUid,text,{expectedUserId:user,excerpt});expect(result.localState,JSON.stringify(trace)).toBe('synced');return {sourceRef:'self',itemUid:result.recordUid,status:result.status,localState:result.localState}},undefined,true)
 expect((await b.service.personalRecordDetail(quoteOnly.recordUid)).localSelfQuote).toMatchObject({noteText:'',quote:{text:input.quote.text}})
 const other=await fetch(ready.url+'/api/v1/records/detail',{method:'POST',headers:{Authorization:'Bearer '+ready.token_other,'Content-Type':'application/json'},body:JSON.stringify({record_uid:uid})})
 const denied=await other.json() as any
 expect(denied.code!==0||denied.data?.record_core?.text_content!==current.textContent).toBe(true)
 const anonymous=await fetch(ready.url+'/api/v1/records/detail',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({record_uid:uid})})
 expect(anonymous.status).toBe(403)
 await writeFile(join(dir!,'done'),'passed')
},90000)
