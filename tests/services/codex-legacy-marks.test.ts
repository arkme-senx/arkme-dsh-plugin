import {createHash} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {afterEach,expect,it,vi} from 'vitest'
import {LocalMessageMarkStore} from '../../src/local-message-marks.js'
import {CodexLegacyMarks} from '../../src/services/codex-legacy-marks.js'
import type {ServiceRuntime} from '../../src/services/service.js'
import type {MessageUnderlineChange,MessageUnderlineSnapshot} from '../../src/message-annotations.js'
import {quoteSourceContent,type ArkmeMessageQuote} from '../../src/message-quote.js'
const databases:DatabaseSync[]=[]
afterEach(()=>{for(const db of databases.splice(0))db.close()})
const text='ABCDEFGH',hash=createHash('sha256').update(quoteSourceContent({textContent:text,textFormat:'plain'})).digest('hex')
const anchor=(start=1):ArkmeMessageQuote=>({version:1,projection:'arkme-text-v1',sourceDigest:hash,start,end:start+2,text:text.slice(start,start+2),prefix:text.slice(0,start),suffix:text.slice(start+2)})
const target={source_id:'source',task_id:'cloud-task',event_id:'event'}
function fixture(){
 const db=new DatabaseSync(':memory:');databases.push(db)
 const store=new LocalMessageMarkStore(db,work=>{db.exec('BEGIN IMMEDIATE');try{work();db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}})
 const session={userId:11,refreshToken:'test'},runtime={config:{environment:'test'},stateStore:{messageMarks:store},requireSession:async()=>session,accountScopedSession:vi.fn(async()=>session)} as unknown as ServiceRuntime
 const sourceRef=JSON.stringify(['codex',11,JSON.stringify(['self','source','local-task'])]),ref=JSON.stringify([sourceRef,'event',text])
 let snapshot:MessageUnderlineSnapshot={revision:0,accessible:true,items:[]},last:{id:string;base:number}|undefined
 const change=vi.fn(async(_source:string,_ref:string,operation:MessageUnderlineChange)=>{
  if(last?.id===operation.operationId&&last.base===operation.baseRevision)return structuredClone(snapshot)
  if(operation.baseRevision!==snapshot.revision)return {...structuredClone(snapshot),syncNotice:'conflict'}
  if(operation.kind!=='add')throw Error('migration must only add frozen marks')
  snapshot={...snapshot,revision:snapshot.revision+1,items:[...snapshot.items,{id:'server:'+operation.operationId,mine:true,actorId:11,actorName:'你',anchor:operation.anchor,state:'available'}]}
  last={id:operation.operationId,base:operation.baseRevision!};return structuredClone(snapshot)
 })
 const owner={canonicalMessageTarget:async()=>target,legacyMarkAliases:async()=>({tasks:['local-task','cloud-task'],messages:['old-event','event']}),cloudMarks:async()=>[{actionRef:ref,snapshot:structuredClone(snapshot)}],changeCloudMark:change}
 const add=(team='old-team',start=1)=>{
  const scope=JSON.stringify(['test',11,'codex',JSON.stringify([team,'local','local-task'])])
  store.change(scope,'old-event',11,hash,{kind:'add',operationId:'old-'+start,anchor:anchor(start)})
  return scope
 }
 const migration=()=>new CodexLegacyMarks(runtime,()=>owner)
 return {db,store,runtime,sourceRef,ref,change,add,migration,read:(worker:CodexLegacyMarks)=>worker.read(sourceRef,[{actionRef:ref,snapshot:structuredClone(snapshot)}]),
  current:()=>snapshot,cancel:()=>{snapshot={revision:snapshot.revision+1,accessible:true,items:[]};last=undefined},manual:()=>{snapshot={revision:1,accessible:true,items:[]}}}
}
it('imports exact old scope aliases and retires only the confirmed local data',async()=>{
 const f=fixture(),scope=f.add();await f.read(f.migration())
 expect(f.current().items).toHaveLength(1);expect(f.change.mock.calls[0]?.[2]).toMatchObject({baseRevision:0,kind:'add',anchor:anchor()})
 expect(f.store.read(scope,'old-event',11,hash).items).toEqual([])
 await f.read(f.migration());expect(f.change).toHaveBeenCalledTimes(1)
})
it('continues different historical scope cohorts only from the exact number of its own confirmed operations',async()=>{
 const f=fixture();f.add('team',1);f.add('self',4)
 await f.read(f.migration())
 expect(f.current().items).toHaveLength(2)
 expect(f.change.mock.calls.map(call=>call[2].baseRevision)).toEqual([0,1])
})
it('keeps a frozen base across a lost receipt and refuses revival after another device cancels it',async()=>{
 const f=fixture(),scope=f.add(),original=f.change.getMockImplementation()!
 f.change.mockImplementationOnce(async(...args)=>{await original(...args);throw Error('lost response')})
 await f.read(f.migration());expect(f.current().revision).toBe(1)
 const sent=f.change.mock.calls[0]![2]
 f.cancel();await f.read(f.migration())
 expect(f.current().items).toEqual([])
 expect(f.change.mock.calls[1]![2]).toEqual(sent)
 const before=f.change.mock.calls.length;await f.read(f.migration())
 expect(f.change).toHaveBeenCalledTimes(before)
 expect(f.store.read(scope,'old-event',11,hash).items).toHaveLength(1)
})
it('does not overwrite an existing non-pristine cloud state and background sync needs no opened detail',async()=>{
 const f=fixture(),scope=f.add();f.manual()
 const result=await f.read(f.migration());expect(f.change).not.toHaveBeenCalled();expect(result[0]!.snapshot.syncNotice).toContain('原数据仍保留')
 expect(f.store.read(scope,'old-event',11,hash).items).toHaveLength(1)
 const g=fixture();g.add();await g.migration().sync();expect(g.current().items).toHaveLength(1)
})
it('does not upload after the account binding changes',async()=>{
 const f=fixture();f.add();vi.mocked(f.runtime.accountScopedSession).mockResolvedValue(undefined)
 await f.read(f.migration());expect(f.change).not.toHaveBeenCalled()
})
