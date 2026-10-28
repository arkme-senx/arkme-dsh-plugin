import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it, vi } from 'vitest'
import { TeamCodexCloud, type TeamCodexCloudPort } from '../src/team-codex-cloud.js'
import { TeamCodexCloudJournal, validCodexSourceName } from '../src/team-codex-cloud-journal.js'
import type { TeamCodexState, TeamCodexTask } from '../src/team-codex-contract.js'
import { ArkmePluginError } from '../src/services/service.js'

const databases:DatabaseSync[]=[]
afterEach(()=>{for(const db of databases.splice(0)) db.close()})
function fixture() {
  const db = new DatabaseSync(':memory:');databases.push(db)
  let owner=11,now=1000
  const evidence=vi.fn()
  const post=vi.fn<(...args:any[])=>Promise<any>>(async(_owner,path,body)=>{
    if(path.endsWith('list-mine')) return {teams:[{team_id:101,jotmo_id:'arkme_cn'}]}
    if(path.endsWith('/confirm')) return {owner_ref:String(_owner),source_id:body.source_id}
    return {items:[],page:1,has_more:false}
  })
  const port={post,selectedTeam:async()=>({teamRef:'local-team',jotmoId:'arkme_cn'})} as unknown as TeamCodexCloudPort
  let cloud=new TeamCodexCloud(db,port,async()=>owner,()=>now,evidence)
  const sent=()=>post.mock.calls.filter(call=>call[1].endsWith('/confirm'))
  return {db,post,evidence,sent,get cloud(){return cloud},advance:(ms=31000)=>{now+=ms},
    setUser:(value:number)=>{owner=value;cloud.fence()},
    restart:()=>{cloud.fence();cloud=new TeamCodexCloud(db,port,async()=>owner,()=>now,evidence)}}
}

it('requires both source evidence and explicit consent; confirmation contains no task or text',async()=>{
  const f=fixture()
  await f.cloud.confirmSources(11,'local-team',['installation'])
  expect(f.post).not.toHaveBeenCalled()
  await f.cloud.enable(11,'local-team','工作电脑')
  await f.cloud.confirmSources(11,'local-team',[])
  expect(f.sent()).toHaveLength(0)
  await f.cloud.confirmSources(11,'local-team',['installation'])
  const body=f.sent()[0]![2]
  expect(body).toEqual({expected_owner_ref:'11',team_ref:'101',source_id:expect.stringMatching(/^[a-f0-9-]{36}$/),source_name:'工作电脑'})
  expect(f.db.prepare('SELECT count(*) AS n FROM codex_cloud_tasks').get()).toEqual({n:0})
  expect(f.db.prepare('SELECT count(*) AS n FROM codex_cloud_events').get()).toEqual({n:0})
  expect(f.evidence).toHaveBeenCalledExactlyOnceWith(11)
})

it('shares one identity with Sync in either order and keeps the first name',async()=>{
  const f=fixture();await f.cloud.enable(11,'local-team','工作电脑')
  const task={id:'task',installationId:'installation',title:'任务',status:'active',state:'working',eventCount:1,updatedAt:1000,member:{}} as TeamCodexTask
  await f.cloud.confirmSources(11,'local-team',['installation'])
  f.cloud.journal.reconcile(11,'local-team','101',[task],()=>[],'新名字不会覆盖首次名字')
  expect(f.cloud.journal.batch(11,'local-team',new Set(['task']))).toMatchObject({source_id:f.sent()[0]![2].source_id,source_name:'工作电脑'})
  f.cloud.journal.reconcile(11,'local-team','101',[{...task,id:'task2',installationId:'other'}],()=>[],'另一台电脑')
  const existing=f.cloud.journal.mapping(11,'local-team','task2')!
  await f.cloud.confirmSources(11,'local-team',['other'])
  expect(f.sent()[1]![2]).toMatchObject({source_id:existing.sourceId,source_name:'另一台电脑'})
  f.restart();await f.cloud.confirmSources(11,'local-team',['installation','other'])
  expect(f.sent()).toHaveLength(2)
})

it('retries network errors with persistent backoff and the identical UUID after restart',async()=>{
  const f=fixture();await f.cloud.enable(11,'local-team')
  const original=f.post.getMockImplementation()!
  f.post.mockImplementation(async(owner,path,body,...rest)=>path.endsWith('/confirm')?Promise.reject(new Error('offline')):original(owner,path,body,...rest))
  await f.cloud.confirmSources(11,'local-team',['installation'])
  const first=f.sent()[0]![2]
  expect(first.source_name).toBe('本机 Codex')
  f.restart();await f.cloud.confirmSources(11,'local-team',['installation'])
  expect(f.sent()).toHaveLength(1);expect(f.evidence).not.toHaveBeenCalled()
  f.advance();f.post.mockImplementation(original)
  await f.cloud.confirmSources(11,'local-team',['installation'])
  expect(f.sent()[1]![2]).toEqual(first)
  expect(f.evidence).toHaveBeenCalledExactlyOnceWith(11)
})

it.each(['TEAM_FORBIDDEN','ACCOUNT_OR_DESTINATION_MISMATCH','INVALID_PARAMETER'])('stops %s retries across restart until explicit reauthorization',async code=>{
  const f=fixture();await f.cloud.enable(11,'local-team')
  const original=f.post.getMockImplementation()!
  f.post.mockImplementation(async(owner,path,body,...rest)=>path.endsWith('/confirm')?Promise.reject(new ArkmePluginError(code,'blocked',false,403)):original(owner,path,body,...rest))
  await f.cloud.confirmSources(11,'local-team',['installation'])
  f.advance(3600000);f.restart();await f.cloud.confirmSources(11,'local-team',['installation'])
  expect(f.sent()).toHaveLength(1);expect(f.evidence).not.toHaveBeenCalled()
  f.post.mockImplementation(original);await f.cloud.enable(11,'local-team')
  await f.cloud.confirmSources(11,'local-team',['installation'])
  expect(f.sent()[1]![2].source_id).toBe(f.sent()[0]![2].source_id)
})

it.each(['owner','source','malformed'])('does not accept a %s mismatch or invalid confirmation',async kind=>{
  const f=fixture();await f.cloud.enable(11,'local-team')
  f.post.mockImplementation(async(_owner,_path,body)=>kind==='malformed'?{}:{owner_ref:kind==='owner'?'22':'11',source_id:kind==='source'?'22222222-2222-4222-8222-222222222222':body.source_id})
  await f.cloud.confirmSources(11,'local-team',['installation'])
  expect(f.evidence).not.toHaveBeenCalled()
  expect(f.db.prepare('SELECT confirmed_at FROM codex_cloud_source_confirmations').get()).toEqual({confirmed_at:0})
})

it('deduplicates concurrent confirmation and drops account-switch responses before persisting',async()=>{
  const f=fixture();await f.cloud.enable(11,'local-team')
  let resolve!:(data:unknown)=>void
  f.post.mockImplementation(()=>new Promise(done=>{resolve=done}))
  const first=f.cloud.confirmSources(11,'local-team',['installation']),rejected=expect(first).rejects.toThrow()
  await vi.waitFor(()=>expect(f.sent()).toHaveLength(1))
  await f.cloud.confirmSources(11,'local-team',['installation'])
  expect(f.sent()).toHaveLength(1)
  f.setUser(22);f.setUser(11)
  resolve({owner_ref:'11',source_id:f.sent()[0]![2].source_id});await rejected
  expect(f.evidence).not.toHaveBeenCalled()
  expect(f.db.prepare('SELECT count(*) AS n FROM codex_cloud_source_confirmations').get()).toEqual({n:0})
})

it('stops metadata confirmation immediately when upload consent is revoked',async()=>{
  const f=fixture();await f.cloud.enable(11,'local-team')
  f.cloud.disable(11,'local-team');f.post.mockClear()
  await f.cloud.confirmSources(11,'local-team',['installation'])
  expect(f.post).not.toHaveBeenCalled()
})

it('keeps natural own-task reads as evidence but not colleague or malformed rows',async()=>{
  const f=fixture(),original=f.post.getMockImplementation()!
  const row={task_id:'22222222-2222-4222-8222-222222222222',source_id:'11111111-1111-4111-8111-111111111111',owner_ref:'22',team_ref:'101',event_count:0,latest_at:1000}
  const state:TeamCodexState={self:null,tasks:[],installations:[],localOnly:true}
  f.post.mockImplementation(async(owner,path,body,...rest)=>path.endsWith('/tasks/list')?{items:[row],page:1,has_more:false}:original(owner,path,body,...rest))
  await f.cloud.state(11,'local-team',state);expect(f.evidence).not.toHaveBeenCalled()
  row.owner_ref='11'
  await f.cloud.state(11,'local-team',state);expect(f.evidence).toHaveBeenCalledExactlyOnceWith(11)
  f.evidence.mockClear();row.source_id='bad'
  await f.cloud.state(11,'local-team',state);expect(f.evidence).not.toHaveBeenCalled()
})

it('separates bindings by owner and destination without changing old names or IDs',()=>{
  const f=fixture(),journal=new TeamCodexCloudJournal(f.db)
  const a=journal.source(11,'team-a','101','installation','原名称')
  expect(journal.source(11,'team-a','101','installation','修改名')).toEqual(a)
  expect(journal.source(22,'team-a','101','installation').id).not.toBe(a.id)
  expect(journal.source(11,'team-b','102','installation').id).not.toBe(a.id)
  expect(()=>journal.source(11,'team-a','102','installation')).toThrow('ACCOUNT_OR_DESTINATION_MISMATCH')
})

it.each(['','   ','a'.repeat(129),'中'.repeat(43),'name\nnext','bad\u0000','\ud800'])('rejects invalid UTF-8 source alias %j',async name=>{
  const f=fixture()
  expect(validCodexSourceName(name)).toBe(false)
  await expect(f.cloud.enable(11,'local-team',name)).rejects.toThrow('来源名称')
  expect(f.post).not.toHaveBeenCalled()
})

it('accepts a Unicode alias within the byte limit',async()=>{
  const f=fixture(),name='我的电脑 🐱'
  await f.cloud.enable(11,'local-team',name);await f.cloud.confirmSources(11,'local-team',['installation'])
  expect(f.sent()[0]![2].source_name).toBe(name)
})
