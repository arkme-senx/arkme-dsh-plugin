import {readFile,writeFile,mkdtemp,rm,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash,randomUUID} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {afterEach,expect,it} from 'vitest'
import {TeamCodexService} from '../../src/team-codex-service.js'
import {LocalMessageMarkStore} from '../../src/local-message-marks.js'
import {CodexLegacyMarks} from '../../src/services/codex-legacy-marks.js'
import {quoteSourceContent,type ArkmeMessageQuote} from '../../src/message-quote.js'
import type {ServiceRuntime} from '../../src/services/service.js'
const contract=process.env.CODEX_SHARE_CONTRACT_DIR
const roots:string[]=[],services:TeamCodexService[]=[],databases:DatabaseSync[]=[]
afterEach(async()=>{for(const service of services.splice(0))service.close();for(const db of databases.splice(0))db.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
it.skipIf(!contract)('uses actual Team HTTP+Mongo for two devices, admin-private isolation, CAS cancellation and a restarted legacy import',async()=>{
 const ready=JSON.parse(await readFile(join(contract!,'ready.json'),'utf8')),text='ABCDEFGH'
 const hash=createHash('sha256').update(quoteSourceContent({textContent:text,textFormat:'plain'})).digest('hex')
 const anchor:ArkmeMessageQuote={version:1,projection:'arkme-text-v1',sourceDigest:hash,start:1,end:3,text:'BC',prefix:'A',suffix:'DEFGH'}
 const make=async(actor:number,token:string)=>{
  const root=await mkdtemp(join(tmpdir(),'codex marks device '));roots.push(root);await mkdir(join(root,'codex'))
  const post=async<T>(_owner:number,path:string,body:Record<string,unknown>,signal:AbortSignal):Promise<T>=>{
   const response=await fetch(ready.url+path,{method:'POST',signal,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)})
   const value=await response.json() as any
   if(!response.ok||![0,200].includes(value.code))throw Object.assign(Error(value.message||'Team request failed'),{upstreamStatus:response.status})
   return value.data
  }
  let user=actor
  const owner=new TeamCodexService({directory:join(root,'journal'),codexHome:join(root,'codex'),currentUserId:async()=>user,profile:async()=>{throw Error('marks must not depend on profile')},teams:{} as never,cloud:{post,selectedTeam:async()=>{throw Error('marks must not enable collection')}}})
  services.push(owner)
  const sourceRef=JSON.stringify(['codex',actor,JSON.stringify(['self',ready.source_id,ready.task_id])])
  const ref=(id:string)=>JSON.stringify([sourceRef,id,text])
  return {owner,sourceRef,ref,root,setUser:(v:number)=>{user=v;owner.fence()}}
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
 const db=new DatabaseSync(join(a.root,'private.sqlite'));databases.push(db)
 const store=new LocalMessageMarkStore(db,work=>{db.exec('BEGIN IMMEDIATE');try{work();db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}})
 const oldScope=JSON.stringify(['test',101,'codex',JSON.stringify(['old-team',ready.source_id,ready.task_id])])
 store.change(oldScope,'migration',101,hash,{kind:'add',operationId:'old-local-mark',anchor})
 const session={userId:101,refreshToken:'isolated-a'},runtime={config:{environment:'test'},stateStore:{messageMarks:store},requireSession:async()=>session,accountScopedSession:async()=>session} as unknown as ServiceRuntime
 let lose=true
 const adapter={canonicalMessageTarget:a.owner.canonicalMessageTarget.bind(a.owner),legacyMarkAliases:a.owner.legacyMarkAliases.bind(a.owner),cloudMarks:a.owner.cloudMarks.bind(a.owner),changeCloudMark:async(...args:Parameters<TeamCodexService['changeCloudMark']>)=>{const result=await a.owner.changeCloudMark(...args);if(lose){lose=false;throw Error('lost response after actual Mongo acceptance')}return result}}
 const rows=await a.owner.cloudMarks(a.sourceRef,[a.ref('migration')])
 await new CodexLegacyMarks(runtime,()=>adapter).read(a.sourceRef,rows!)
 const accepted=(await b.owner.cloudMarks(b.sourceRef,[b.ref('migration')]))![0]!.snapshot
 expect(accepted.items).toHaveLength(1)
 await b.owner.changeCloudMark(b.sourceRef,b.ref('migration'),{kind:'remove',operationId:randomUUID(),baseRevision:accepted.revision,annotationId:accepted.items[0]!.id})
 const latest=(await a.owner.cloudMarks(a.sourceRef,[a.ref('migration')]))!
 await new CodexLegacyMarks(runtime,()=>adapter).read(a.sourceRef,latest)
 expect((await b.owner.cloudMarks(b.sourceRef,[b.ref('migration')]))![0]!.snapshot).toMatchObject({revision:2,items:[]})
 expect(store.read(oldScope,'migration',101,hash).items).toHaveLength(1)
 a.setUser(22);await expect(a.owner.cloudMarks(a.sourceRef,[a.ref('legacy')])).rejects.toThrow()
 await writeFile(join(contract!,'done'),'passed')
},90000)
