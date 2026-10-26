import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeamCodexCloudJournal } from '../src/team-codex-cloud-journal.js'
import { TeamCodexQueueCloud, type CodexQueueBatch } from '../src/team-codex-queue-cloud.js'
import { codexCloudQueueWire, parseCodexCloudQueue, supportsCodexCloudQueue } from '../src/team-codex-queue-wire.js'
import { TeamCodexCloud, type TeamCodexCloudPort } from '../src/team-codex-cloud.js'
import { ArkmePluginError } from '../src/services/service.js'
import type { TeamCodexQueueSnapshot, TeamCodexTask, TeamCodexState } from '../src/team-codex-contract.js'

const databases:DatabaseSync[]=[]
const db=()=>{const value=new DatabaseSync(':memory:');databases.push(value);return value}
afterEach(()=>databases.splice(0).forEach(value=>value.close()))
const member={userRef:'self',displayName:'本人',role:'member' as const,joinedAtMillis:1,identityState:'ready' as const}
const snapshot=(texts=['需求甲','需求乙'],version=1,checkedAt=10000):TeamCodexQueueSnapshot=>({version,checkedAt,changedAt:checkedAt,sourceAt:checkedAt,
  availability:'ready',reason:'none',items:texts.map((text,index)=>({id:`request-${index}`,text,createdAt:1000,delivery:'queue',state:'queued',paused:false,attachmentCount:0,truncated:false}))})
const task=(queue=snapshot()):TeamCodexTask=>({id:'local-task',installationId:'local-device',title:'开发任务',status:'active',state:'working',updatedAt:1000,eventCount:0,member,queue})
const cap={capabilities:{codex_queue_snapshot:{version:1,visibility:'owner'}}}
const ack=(batch:CodexQueueBatch)=>({owner_ref:batch.expected_owner_ref,queue_results:batch.tasks.filter(task=>task.queue_snapshot||task.queue_heartbeat).map(task=>({task_id:task.task_id,
  version:(task.queue_snapshot??task.queue_heartbeat)!.version,observed_at:(task.queue_snapshot??task.queue_heartbeat)!.observed_at,status:'saved'}))})
function fixture() {
  const database=db(),journal=new TeamCodexCloudJournal(database),queues=new TeamCodexQueueCloud(database,journal)
  const reconcile=(q=snapshot())=>{journal.reconcile(11,'team','101',[task(q)],()=>[]);queues.reconcile(11,'team',[task(q)])}
  const batch=()=>queues.batch(11,'team',new Set(['local-task']))!
  reconcile()
  return {database,journal,queues,reconcile,batch}
}

describe('owner-only queue wire contract',()=>{
  it('requires explicit owner-only capability, validates shapes and whitelists fields',()=>{
    expect(supportsCodexCloudQueue(cap)).toBe(true)
    for(const value of [{},{capabilities:{codex_queue_snapshot:true}},{capabilities:{codex_queue_snapshot:{version:1,visibility:'team'}}}])expect(supportsCodexCloudQueue(value)).toBe(false)
    const wire=codexCloudQueueWire(snapshot())
    expect(parseCodexCloudQueue({...wire,secret:'not part of the contract'})).toEqual(snapshot())
    for(const change of [{version:0},{visibility:'team'},{observed_at:1},{items:[wire.items[0],wire.items[0]]},{items:[{...wire.items[0],text:'😀'.repeat(1025)}]},{items:[{...wire.items[0],state:'invented'}]}])expect(parseCodexCloudQueue({...wire,...change})).toBeUndefined()
  })
})

describe('durable queue outbox and independent ACK',()=>{
  it('persists identity and versions across reopen, does not ACK from chat results',()=>{
    const f=fixture(),first=f.batch()
    expect(new TeamCodexQueueCloud(f.database,f.journal).batch(11,'team',new Set(['local-task']))).toEqual(first)
    expect(first.tasks[0]!.events).toEqual([])
    expect(f.queues.acknowledge(first,{owner_ref:'11',task_results:[{task_id:first.tasks[0]!.task_id,status:'saved',version:1}]})).toBe(false)
    expect(f.batch()).toEqual(first)
    f.queues.acknowledge(first,ack(first));expect(f.batch()).toBeUndefined()
    f.reconcile(snapshot(['改过了'],99,11000))
    expect(f.batch().tasks[0]!.queue_snapshot).toMatchObject({version:2,items:[{text:'改过了'}]})
    f.queues.acknowledge(first,ack(first))
    expect(f.batch().tasks[0]!.queue_snapshot?.version).toBe(2)
  })
  it('uploads reorder/removal and explicit empty snapshots without waiting for a chat event',()=>{
    const f=fixture(),first=f.batch();f.queues.acknowledge(first,ack(first))
    const reordered=snapshot();reordered.items.reverse();f.reconcile(reordered)
    const second=f.batch();expect(second.tasks[0]!.queue_snapshot?.items.map(i=>i.text)).toEqual(['需求乙','需求甲'])
    f.queues.acknowledge(second,ack(second));f.reconcile(snapshot([],3,12000))
    expect(f.batch().tasks[0]!.queue_snapshot).toMatchObject({version:3,items:[]})
  })
  it('keeps same-text requests separate and clips sanitized text by actual UTF-8 bytes',()=>{
    const f=fixture();f.reconcile(snapshot(['相同','相同','Bearer very-secret '+ '😀'.repeat(2000)]))
    const items=f.batch().tasks[0]!.queue_snapshot!.items
    expect(new Set(items.map(i=>i.request_id)).size).toBe(3)
    expect(JSON.stringify(items)).not.toContain('very-secret')
    expect(Buffer.byteLength(items[2]!.text)).toBeLessThanOrEqual(4096)
    expect(items[2]!.truncated).toBe(true);expect(items[2]!.text).not.toContain('\ufffd')
  })
  it('rejects missing, duplicate, foreign and mismatched ACKs',()=>{
    const f=fixture(),first=f.batch(),result=ack(first)
    expect(()=>f.queues.acknowledge(first,{...result,owner_ref:'22'})).toThrow('ACCOUNT_OR_DESTINATION_MISMATCH')
    expect(f.queues.acknowledge(first,{...result,queue_results:[...result.queue_results,...result.queue_results]})).toBe(false)
    expect(f.queues.acknowledge(first,{...result,queue_results:[{...result.queue_results[0],version:8}]})).toBe(false)
    expect(f.batch()).toEqual(first)
  })
  it('bounds escaped JSON bytes without losing the queue count or order',()=>{
    const f=fixture();f.reconcile(snapshot(Array.from({length:200},(_,i)=>`${i}:`+'\u0001'.repeat(4090))))
    const batch=f.batch(),items=batch.tasks[0]!.queue_snapshot!.items
    expect(items).toHaveLength(200)
    expect(Buffer.byteLength(JSON.stringify(batch))).toBeLessThanOrEqual(1_048_576)
    expect(items.every((item,i)=>item.truncated&&item.text.startsWith(`${i}:`))).toBe(true)
  })
  it('sends only a heartbeat for unchanged observations at most once per minute, requests full resend after server loss',()=>{
    const f=fixture(),first=f.batch();f.queues.acknowledge(first,ack(first))
    f.reconcile({...snapshot(),checkedAt:69000});expect(f.batch()).toBeUndefined()
    f.reconcile({...snapshot(),checkedAt:70000});const beat=f.batch()
    expect(beat.tasks[0]!.queue_snapshot).toBeUndefined()
    expect(beat.tasks[0]!.queue_heartbeat).toEqual({version:1,observed_at:70000})
    const response=ack(beat);response.queue_results[0]!.status='snapshot_required'
    f.queues.acknowledge(beat,response)
    const retry=f.batch();expect(retry.tasks[0]!.queue_snapshot).toMatchObject({version:1,observed_at:70000})
    f.queues.acknowledge(retry,ack(retry));expect(f.batch()).toBeUndefined()
  })
  it('fences by account, team and eligibility and clears pending content when local record is deleted',()=>{
    const f=fixture()
    expect(f.queues.batch(22,'team',new Set(['local-task']))).toBeUndefined()
    expect(f.queues.batch(11,'other-team',new Set(['local-task']))).toBeUndefined()
    expect(f.queues.batch(11,'team',new Set())).toBeUndefined()
    f.journal.forget(11,'team','local-task')
    expect(f.database.prepare('SELECT count(*) n FROM codex_cloud_queue_outbox').get()).toEqual({n:0})
  })
  it('blocks permanent conflicts without replacing server state',()=>{
    const f=fixture(),first=f.batch(),response=ack(first);response.queue_results[0]!.status='conflict'
    f.queues.acknowledge(first,response);f.reconcile(snapshot(['new'],2,11000));expect(f.batch()).toBeUndefined()
  })
})

describe('last-known cloud queue cache',()=>{
  it('persists only validated fields and isolates account/source/task/team',()=>{
    const f=fixture(),wire=codexCloudQueueWire(snapshot())
    const read=f.queues.read(11,'team','source','task',{...wire,secret:'must not store'},10000)
    expect(read).toEqual(snapshot())
    expect(JSON.stringify(f.database.prepare('SELECT payload FROM codex_cloud_queue_cache').all())).not.toContain('must not store')
    const reopened=new TeamCodexQueueCloud(f.database,f.journal)
    expect(reopened.read(11,'team','source','task',undefined,10000)).toMatchObject({availability:'stale',items:snapshot().items})
    for(const [owner,team,source,task] of [[22,'team','source','task'],[11,'other','source','task'],[11,'team','other','task'],[11,'team','source','other']] as const)expect(reopened.read(owner,team,source,task,undefined,10000)).toBeUndefined()
  })
  it('does not let missing, malformed, partial, regressed or future payloads erase known requests',()=>{
    const f=fixture(),read=(value:unknown)=>f.queues.read(11,'team','source','task',value,20000)
    read(codexCloudQueueWire(snapshot()))
    for(const value of [undefined,{items:[]},codexCloudQueueWire(snapshot([],2,200000))])expect(read(value)?.items).toHaveLength(2)
    const partial=codexCloudQueueWire({...snapshot(['new'],2,12000),availability:'partial'})
    expect(read(partial)).toMatchObject({availability:'partial',version:2,items:[{text:'new'},{text:'需求乙'}]})
    expect(read(codexCloudQueueWire(snapshot([],1)))).toMatchObject({version:2,items:[{text:'new'},{text:'需求乙'}]})
    expect(read(codexCloudQueueWire(snapshot([],3,13000)))).toMatchObject({version:3,availability:'ready',items:[]})
    expect(read(partial)?.items).toEqual([])
  })
  it('rejects conflicting same-version ready snapshots, allowing only freshness changes',()=>{
    const f=fixture(),read=(q:TeamCodexQueueSnapshot)=>f.queues.read(11,'team','source','task',codexCloudQueueWire(q),20000)
    read(snapshot())
    expect(read(snapshot([],1,11000))).toMatchObject({availability:'stale',items:snapshot().items})
    expect(read({...snapshot(),checkedAt:12000})?.checkedAt).toBe(12000)
  })
})

function cloudFixture(supported=true) {
  let now=10000,user=11,capability=supported
  const stored=new Map<string,Record<string,unknown>>()
  const post=vi.fn(async(_owner:number,path:string,body:Record<string,unknown>):Promise<unknown>=>{
    if(path.endsWith('list-mine'))return {teams:[{team_id:101,jotmo_id:'arkme_cn'}]}
    if(path.endsWith('connection/status'))return {owner_ref:String(user),has_connected_codex:true,first_connected_at:1,...(capability?cap:{})}
    if(path.endsWith('/sync')) {
      const batch=body as CodexQueueBatch
      for(const task of batch.tasks) {
        const previous=stored.get(task.task_id)
        stored.set(task.task_id,{...previous,...task,source_id:batch.source_id,team_ref:batch.team_ref,owner_ref:'11',latest_at:1000,event_count:0,state:'in_progress',
          ...(task.queue_heartbeat && previous?.queue_snapshot ? {queue_snapshot:{...(previous.queue_snapshot as object),observed_at:task.queue_heartbeat.observed_at}}:{})})
      }
      return {...ack(batch),task_results:batch.tasks.map(task=>({task_id:task.task_id,version:task.version,status:'saved'})),event_results:[]}
    }
    if(path.endsWith('tasks/list'))return {items:[...stored.values()],page:body.page,has_more:false,...(capability?cap:{})}
    throw new Error(path)
  })
  const port={post,selectedTeam:async()=>({teamRef:'team',jotmoId:'arkme_cn'})} as unknown as TeamCodexCloudPort
  const cloud=new TeamCodexCloud(db(),port,async()=>user,()=>now)
  const reader=new TeamCodexCloud(db(),port,async()=>user,()=>now)
  const empty:TeamCodexState={localOnly:true,self:member,tasks:[],installations:[]}
  return {cloud,reader,post,stored,empty,advance:(ms:number)=>now+=ms,setCapability:(v:boolean)=>capability=v,setUser:(v:number)=>{user=v;cloud.fence();reader.fence()}}
}

describe('two-device cloud queue integration with a contract fixture',()=>{
  it('shows queued count/order on a reader without a local installation, then reflects edits and clearing',async()=>{
    const f=cloudFixture();await f.cloud.enable(11,'team')
    await f.cloud.sync(11,'team',[task()],()=>[])
    let result=await f.reader.state(11,'team',f.empty)
    expect(result.tasks[0]).toMatchObject({queueCloud:'ready',cloud:{remote:true},queue:{items:[{text:'需求甲'},{text:'需求乙'}]}})
    expect(f.post.mock.calls.filter(c=>c[1].endsWith('/sync'))).toHaveLength(2)
    f.advance(1000);await f.cloud.sync(11,'team',[task(snapshot(['改过'],2,11000))],()=>[])
    result=await f.reader.state(11,'team',f.empty);expect(result.tasks[0]!.queue?.items.map(i=>i.text)).toEqual(['改过'])
    f.advance(1000);await f.cloud.sync(11,'team',[task(snapshot([],3,12000))],()=>[])
    result=await f.reader.state(11,'team',f.empty);expect(result.tasks[0]!.queue?.items).toEqual([])
  })
  it('never sends queue fields to an unsupported backend and caches capability discovery',async()=>{
    const f=cloudFixture(false);await f.cloud.enable(11,'team')
    for(let i=0;i<4;i++){f.advance(5000);await f.cloud.sync(11,'team',[task()],()=>[])}
    expect(JSON.stringify(f.post.mock.calls.filter(c=>c[1].endsWith('/sync')))).not.toContain('queue_')
    expect(f.post.mock.calls.filter(c=>c[1].endsWith('connection/status'))).toHaveLength(1)
    expect((await f.reader.state(11,'team',f.empty)).tasks[0]?.queueCloud).toBe('unsupported')
    f.setCapability(true);f.advance(300001);await f.cloud.sync(11,'team',[task()],()=>[])
    expect((await f.reader.state(11,'team',f.empty)).tasks[0]?.queue?.items).toHaveLength(2)
  })
  it('retains stale queue after network failure and missing snapshot, but removes it after permission loss or account switch',async()=>{
    const f=cloudFixture();await f.cloud.enable(11,'team');await f.cloud.sync(11,'team',[task()],()=>[])
    const initial=await f.reader.state(11,'team',f.empty),original=f.post.getMockImplementation()!
    f.post.mockImplementation(async(owner,path,body)=>{if(path.endsWith('tasks/list'))throw new Error('offline');return original(owner,path,body)})
    expect((await f.reader.state(11,'team',f.empty)).tasks[0]?.queue).toMatchObject({availability:'stale',items:initial.tasks[0]!.queue!.items})
    f.post.mockImplementation(original)
    for(const row of f.stored.values())delete row.queue_snapshot
    expect((await f.reader.state(11,'team',f.empty)).tasks[0]?.queue?.availability).toBe('stale')
    f.post.mockImplementation(async()=>{throw new ArkmePluginError('TEAM_FORBIDDEN','revoked',false,403)})
    expect((await f.reader.state(11,'team',f.empty)).tasks).toEqual([])
    f.setUser(22);expect((await f.reader.state(22,'team',f.empty)).tasks).toEqual([])
  })
  it('never exposes another member queue even if the server incorrectly includes one',async()=>{
    const f=cloudFixture();await f.cloud.enable(11,'team');await f.cloud.sync(11,'team',[task()],()=>[])
    for(const row of f.stored.values())row.owner_ref='22'
    const result=await f.reader.state(11,'team',f.empty)
    expect(result.tasks[0]?.queueCloud).toBe('private');expect(result.tasks[0]?.queue).toBeUndefined()
  })
  it('backs off queue failures without suppressing subsequent ordinary task uploads',async()=>{
    const f=cloudFixture(),original=f.post.getMockImplementation()!
    f.post.mockImplementation(async(owner,path,body)=>{
      if(path.endsWith('/sync')&&(body as CodexQueueBatch).tasks.some(task=>task.queue_snapshot))throw new Error('queue endpoint failure')
      return original(owner,path,body)
    })
    await f.cloud.enable(11,'team');await f.cloud.sync(11,'team',[task()],()=>[])
    await f.cloud.sync(11,'team',[{...task(),title:'新的标题'}],()=>[])
    const uploads=f.post.mock.calls.filter(c=>c[1].endsWith('/sync'))
    expect(uploads).toHaveLength(3)
    expect((uploads[2]![2] as CodexQueueBatch).tasks[0]!.task_title).toBe('新的标题')
  })
})
