import {readFile,writeFile,mkdtemp,rm,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash,randomUUID} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {afterEach,expect,it} from 'vitest'
import {TeamCodexService} from '../../src/team-codex-service.js'
import {quoteSourceContent,normalizeQuoteText,type ArkmeMessageQuote} from '../../src/message-quote.js'
import {codexPromptPresentation,codexPromptDisplayText} from '../../src/team-codex-prompt-text.js'
import {codexSelectionSnapshot,codexEventKey} from '../../src/client/redesign/contacts/codex-message-actions.js'
import type {TeamCodexTask,TeamCodexEvent} from '../../src/team-codex-contract.js'
const contract=process.env.CODEX_SHARE_CONTRACT_DIR
const roots:string[]=[],services:TeamCodexService[]=[],databases:DatabaseSync[]=[]
afterEach(async()=>{for(const service of services.splice(0))service.close();for(const db of databases.splice(0))db.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
it.skipIf(!contract)('uses actual Team HTTP+Mongo for two devices, admin-private isolation, CAS cancellation and replay after an unobserved write result',async()=>{
 const ready=JSON.parse(await readFile(join(contract!,'ready.json'),'utf8')),text='ABCDEFGH'
 const hash=createHash('sha256').update(quoteSourceContent({textContent:text,textFormat:'plain'})).digest('hex')
 const anchor:ArkmeMessageQuote={version:1,projection:'arkme-text-v1',sourceDigest:hash,start:1,end:3,text:'BC',prefix:'A',suffix:'DEFGH'}
 const make=async(actor:number,token:string)=>{
  const root=await mkdtemp(join(tmpdir(),'codex marks device '));roots.push(root);await mkdir(join(root,'codex'))
  const post=async<T>(_owner:number,path:string,body:Record<string,unknown>,signal:AbortSignal):Promise<T>=>{
   const response=await fetch(ready.url+path,{method:'POST',signal,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)})
   const raw=await response.text()
   let value:any
   try{value=JSON.parse(raw)}catch{throw Error(`${path}: non-JSON HTTP ${response.status}`)}
   if(!response.ok||![0,200].includes(value.code))throw Object.assign(Error(value.message||'Team request failed'),{upstreamStatus:response.status})
   return value.data
  }
  let user=actor
  const owner=new TeamCodexService({directory:join(root,'journal'),codexHome:join(root,'codex'),currentUserId:async()=>user,profile:async()=>{throw Error('marks must not depend on profile')},teams:{} as never,cloud:{post,selectedTeam:async()=>{throw Error('marks must not enable collection')}}})
  services.push(owner)
  const sourceRef=JSON.stringify(['codex',actor,JSON.stringify(['self',ready.source_id,ready.task_id])])
  const ref=(id:string)=>JSON.stringify([sourceRef,id,text])
  return {owner,sourceRef,ref,root,post,setUser:(v:number)=>{user=v;owner.fence()}}
 }
 const a=await make(101,ready.token_a),b=await make(101,ready.token_b),admin=await make(22,ready.token_member),foreign=await make(303,ready.token_foreign)
 const initial=(await a.owner.cloudMarks(a.sourceRef,[a.ref('legacy')]))![0]!.snapshot
 expect(initial).toMatchObject({revision:0,items:[]})
 const first=await a.owner.changeCloudMark(a.sourceRef,a.ref('legacy'),{kind:'add',operationId:randomUUID(),baseRevision:0,anchor})
 expect(first?.revision).toBe(1)
 expect((await b.owner.cloudMarks(b.sourceRef,[b.ref('legacy')]))![0]!.snapshot.items).toHaveLength(1)
 expect((await admin.owner.cloudMarks(admin.sourceRef,[admin.ref('legacy')]))![0]!.snapshot.items).toEqual([])
 await expect(foreign.owner.cloudMarks(foreign.sourceRef,[foreign.ref('legacy')])).rejects.toThrow()
 await b.owner.changeCloudMark(b.sourceRef,b.ref('legacy'),{kind:'remove',operationId:randomUUID(),baseRevision:1,annotationId:first!.items[0]!.id})
 const stale=await a.owner.changeCloudMark(a.sourceRef,a.ref('legacy'),{kind:'add',operationId:randomUUID(),baseRevision:0,anchor})
 expect(stale).toMatchObject({revision:2,items:[]});expect(stale?.syncNotice).toBeTruthy()
 const operation={kind:'add' as const,operationId:randomUUID(),baseRevision:0,anchor}
 // The caller loses the first response, then another device removes the mark.
 await a.owner.changeCloudMark(a.sourceRef,a.ref('migration'),operation)
 const accepted=(await b.owner.cloudMarks(b.sourceRef,[b.ref('migration')]))![0]!.snapshot
 expect(accepted.items).toHaveLength(1)
 await b.owner.changeCloudMark(b.sourceRef,b.ref('migration'),{kind:'remove',operationId:randomUUID(),baseRevision:accepted.revision,annotationId:accepted.items[0]!.id})
 await a.owner.changeCloudMark(a.sourceRef,a.ref('migration'),operation)
 expect((await b.owner.cloudMarks(b.sourceRef,[b.ref('migration')]))![0]!.snapshot).toMatchObject({revision:2,items:[]})
 // Structured event reads and plain sharing/anchors must describe the same user prose.
 const vectors=JSON.parse(await readFile(new URL('../fixtures/codex-response-annotations-v1.json',import.meta.url),'utf8'))
 const input:TeamCodexEvent={eventId:'annotated-prompt',version:1,sequence:4,turnId:'annotation-turn',kind:'UserPromptSubmit',at:400,text:vectors[0].input,truncated:false}
 expect(codexPromptPresentation(input.text).responseAnnotations?.annotations).toHaveLength(1)
 const shown=codexPromptDisplayText(input.text),canonical=normalizeQuoteText(shown)
 const detail=await a.post<{text:string}>(101,'/api/v1/team-codex/events/detail',{source_id:ready.source_id,task_id:ready.task_id,event_id:input.eventId},AbortSignal.timeout(5000))
 expect(detail.text).toBe(shown)
 const annotatedTask={id:ready.task_id,title:'annotation contract',member:{displayName:'owner'},cloud:{sourceId:ready.source_id,taskId:ready.task_id,ownerRef:'101',remote:true}} as TeamCodexTask
 const snapshot=codexSelectionSnapshot('contract',annotatedTask,[input],new Set([codexEventKey(input)]))
 expect((await a.owner.prepareExport('contract',ready.task_id,ready.source_id,snapshot)).messages[0]!.text).toBe(shown)
 await expect(admin.owner.prepareExport('contract',ready.task_id,ready.source_id,snapshot)).rejects.toThrow()
 const annotationDigest=createHash('sha256').update(quoteSourceContent({textContent:canonical,textFormat:'plain'})).digest('hex')
 const noteAnchor:ArkmeMessageQuote={version:1,projection:'arkme-text-v1',sourceDigest:annotationDigest,start:0,end:6,text:canonical.slice(0,6),prefix:'',suffix:canonical.slice(6,38)}
 const annotatedRef=(sourceRef:string)=>JSON.stringify([sourceRef,'annotated-prompt',canonical])
 const marked=await a.owner.changeCloudMark(a.sourceRef,annotatedRef(a.sourceRef),{kind:'add',operationId:randomUUID(),baseRevision:0,anchor:noteAnchor})
 expect(marked?.items).toHaveLength(1)
 expect((await b.owner.cloudMarks(b.sourceRef,[annotatedRef(b.sourceRef)]))![0]!.snapshot.items).toHaveLength(1)
 expect((await admin.owner.cloudMarks(admin.sourceRef,[annotatedRef(admin.sourceRef)]))![0]!.snapshot.items).toEqual([])
 const steering:TeamCodexEvent={...input,eventId:'steering-input',at:401,text:'追加图片说明',messageSequence:5}
 const steeringDetail=await a.post<{text:string;version:number;at:number}>(101,'/api/v1/team-codex/events/detail',{source_id:ready.source_id,task_id:ready.task_id,event_id:steering.eventId},AbortSignal.timeout(5000))
 expect(steeringDetail).toMatchObject({text:'追加图片说明',version:1,at:401})
 const steeringSnapshot=codexSelectionSnapshot('contract',annotatedTask,[steering],new Set([codexEventKey(steering)]))
 const verified=await a.owner.prepareExport('contract',ready.task_id,ready.source_id,steeringSnapshot)
 expect(verified.messages[0]).toMatchObject({text:'追加图片说明',role:'user',createdAtMillis:401})
 await expect(admin.owner.prepareExport('contract',ready.task_id,ready.source_id,steeringSnapshot)).rejects.toThrow()
 const skill:TeamCodexEvent={...input,eventId:'skill-input',turnId:'skill-input',sequence:5,at:500,text:'[$demo-skill](/workspace/skills/demo-skill/SKILL.md) 继续检查'}
 const skillText=codexPromptDisplayText(skill.text),skillCanonical=normalizeQuoteText(skillText)
 expect(skillText).toBe('demo-skill 继续检查')
 const skillDetail=await a.post<{text:string}>(101,'/api/v1/team-codex/events/detail',{source_id:ready.source_id,task_id:ready.task_id,event_id:skill.eventId},AbortSignal.timeout(5000))
 expect(skillDetail.text).toBe(skillText)
 const skillSnapshot=codexSelectionSnapshot('contract',annotatedTask,[skill],new Set([codexEventKey(skill)]))
 expect((await a.owner.prepareExport('contract',ready.task_id,ready.source_id,skillSnapshot)).messages[0]!.text).toBe(skillText)
 const skillDigest=createHash('sha256').update(quoteSourceContent({textContent:skillCanonical,textFormat:'plain'})).digest('hex')
 const skillAnchor:ArkmeMessageQuote={version:1,projection:'arkme-text-v1',sourceDigest:skillDigest,start:0,end:4,text:'demo',prefix:'',suffix:skillCanonical.slice(4,36)}
 const skillRef=(ref:string)=>JSON.stringify([ref,'skill-input',skillCanonical])
 expect((await a.owner.changeCloudMark(a.sourceRef,skillRef(a.sourceRef),{kind:'add',operationId:randomUUID(),baseRevision:0,anchor:skillAnchor}))?.items).toHaveLength(1)
 expect((await b.owner.cloudMarks(b.sourceRef,[skillRef(b.sourceRef)]))![0]!.snapshot.items).toHaveLength(1)
 expect((await admin.owner.cloudMarks(admin.sourceRef,[skillRef(admin.sourceRef)]))![0]!.snapshot.items).toEqual([])
 for(const id of ['page-context','skill-context']){
  const hiddenDetail=await a.post<{text:string}>(101,'/api/v1/team-codex/events/detail',{source_id:ready.source_id,task_id:ready.task_id,event_id:id},AbortSignal.timeout(5000))
  expect(hiddenDetail.text).toBe('')
  const forged={...skillSnapshot,messages:[{...skillSnapshot.messages[0]!,key:id,text:'Instructions are not user prose.'}]}
  await expect(a.owner.prepareExport('contract',ready.task_id,ready.source_id,forged)).rejects.toThrow()
 }
 a.setUser(22);await expect(a.owner.cloudMarks(a.sourceRef,[a.ref('legacy')])).rejects.toThrow()
 await writeFile(join(contract!,'done'),'passed')
},90000)
