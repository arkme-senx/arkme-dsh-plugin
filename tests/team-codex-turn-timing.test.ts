import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { TeamCodexTurnTimingReader, TeamCodexTurnTimingStore } from '../src/team-codex-turn-timing.js'
import { codexTurnTiming } from '../src/team-codex-timing.js'
import type { TeamCodexEvent } from '../src/team-codex-contract.js'

const roots:string[]=[],dbs:DatabaseSync[]=[]
afterEach(()=>{for(const db of dbs.splice(0))db.close();for(const path of roots.splice(0))rmSync(path,{recursive:true,force:true})})
const session='session_123',start=1792748662,turn='turn_123'
const line=(type:string,payload:object,at=start)=>JSON.stringify({timestamp:new Date(at*1000).toISOString(),type,payload})+'\n'
const started=(id=turn)=>line('event_msg',{type:'task_started',turn_id:id,root_turn_id:id,started_at:start})
const finished=(id=turn,type='task_complete')=>line('event_msg',{type,turn_id:id,root_turn_id:id,started_at:start,completed_at:start+128,duration_ms:128012},start+128)
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'codex-duration-'));roots.push(root)
  const home=join(root,'codex');mkdirSync(home);mkdirSync(join(home,'sessions'))
  const path=join(home,'sessions','bound.jsonl')
  writeFileSync(path,line('session_meta',{id:session})+started())
  const db=new DatabaseSync(join(home,'state_5.sqlite'));dbs.push(db)
  db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,rollout_path TEXT)')
  db.prepare('INSERT INTO threads VALUES(?,?)').run(session,path)
  const source={sessionId:session,homeKey:createHash('sha256').update(realpathSync(home)).digest('hex')}
  const reader=new TeamCodexTurnTimingReader(home,()=> (start+200)*1000)
  return {root,home,path,db,source,reader,read:()=>reader.read(source,[turn])}
}
describe('bounded native Codex turn timing',()=>{
  it('reads true lifecycle duration, observes append, and ignores message/transport timestamps',async()=>{
    const f=fixture(),before=readFileSync(f.path)
    expect((await f.read()).get(turn)).toMatchObject({state:'working',startedAt:start*1000})
    expect(readFileSync(f.path)).toEqual(before)
    appendFileSync(f.path,finished())
    expect((await f.read()).get(turn)).toEqual({state:'finished',startedAt:start*1000,completedAt:(start+128)*1000,durationMs:128012,observedAt:(start+128)*1000})
    expect(await f.reader.read(f.source,['unrelated'])).toEqual(new Map())
  })
  it('handles interruption and does not borrow a subagent clock',async()=>{
    const f=fixture()
    appendFileSync(f.path,finished(turn,'turn_aborted')+line('event_msg',{type:'task_complete',turn_id:'child',root_turn_id:turn,started_at:start,completed_at:start+1,duration_ms:1000},start+129))
    expect((await f.read()).get(turn)?.state).toBe('interrupted')
    expect((await f.reader.read(f.source,['child'])).size).toBe(0)
  })
  it('ignores partial JSON until the append is complete, including Unicode',async()=>{
    const f=fixture(),record=finished().replace('"type":"task_complete"','"note":"汉字","type":"task_complete"')
    appendFileSync(f.path,record.slice(0,-3))
    expect((await f.read()).get(turn)?.state).toBe('working')
    appendFileSync(f.path,record.slice(-3))
    expect((await f.read()).get(turn)?.durationMs).toBe(128012)
  })
  it('reads recent events behind a large tool result and incrementally backfills older turns',async()=>{
    const f=fixture()
    appendFileSync(f.path,finished()+line('response_item',{type:'function_call_output',output:'x'.repeat(12*1024*1024)})+started('recent')+finished('recent'))
    expect((await f.reader.read(f.source,['recent'])).get('recent')?.durationMs).toBe(128012)
    let result=await f.read()
    for(let i=0;i<5&&!result.has(turn);i++)result=await f.read()
    expect(result.get(turn)?.state).toBe('finished')
  })
  it('validates configuration root, exact session, and file boundaries',async()=>{
    const f=fixture()
    expect((await f.reader.read({...f.source,homeKey:'wrong'},[turn])).size).toBe(0)
    writeFileSync(f.path,line('session_meta',{id:'other'})+finished())
    expect((await f.read()).size).toBe(0)
    const outside=join(f.root,'outside.jsonl');writeFileSync(outside,line('session_meta',{id:session})+finished())
    f.db.prepare('UPDATE threads SET rollout_path=?').run(outside)
    expect((await f.read()).size).toBe(0)
    rmSync(f.path);symlinkSync(outside,f.path);f.db.prepare('UPDATE threads SET rollout_path=?').run(f.path)
    expect((await f.read()).size).toBe(0)
  })
  it('persists completed time across reader restart/source removal, with task/account isolation',async()=>{
    const f=fixture();appendFileSync(f.path,finished())
    const journal=new DatabaseSync(join(f.root,'journal.sqlite'));dbs.push(journal)
    const event:TeamCodexEvent={sequence:1,turnId:'cloud_hash',kind:'Stop',text:'answer',at:1,truncated:false}
    const source={...f.source,turns:new Map([['cloud_hash',turn]])}
    const store=new TeamCodexTurnTimingStore(journal,f.home,()=> (start+200)*1000)
    expect(store.project('owner1/task1',source,[event],await store.read(source,[event]))[0]?.timing?.durationMs).toBe(128012)
    rmSync(f.path)
    const restarted=new TeamCodexTurnTimingStore(journal,f.home)
    expect(restarted.project('owner1/task1',source,[event],await restarted.read(source,[event]))[0]?.timing?.durationMs).toBe(128012)
    expect(restarted.project('owner2/task1',source,[event],new Map())[0]?.timing).toBeUndefined()
    expect(restarted.project('owner1/task2',source,[event],new Map())[0]?.timing).toBeUndefined()
  })
  it('rejects invalid and mismatched terminal clocks instead of estimating from messages',()=>{
    expect(codexTurnTiming({state:'finished',startedAt:1,completedAt:1000,durationMs:9000,observedAt:1000})).toBeUndefined()
    expect(codexTurnTiming({state:'working',startedAt:1000,observedAt:999})).toBeUndefined()
    expect(codexTurnTiming({state:'finished',startedAt:1,completedAt:2,durationMs:-1,observedAt:3})).toBeUndefined()
  })
  it('freezes cached working time when a source goes offline and never starts an offline-only clock',async()=>{
    const f=fixture(),journal=new DatabaseSync(join(f.root,'cache.sqlite'));dbs.push(journal)
    const store=new TeamCodexTurnTimingStore(journal,f.home,()=> (start+200)*1000)
    const event:TeamCodexEvent={sequence:1,turnId:turn,kind:'UserPromptSubmit',text:'prompt',at:1,truncated:false}
    const fresh=await store.read(f.source,[event])
    expect(store.project('offline',{...f.source,live:false},[event],fresh)[0]?.timing).toBeUndefined()
    const verified=store.project('owner',{...f.source,live:true},[event],fresh)[0]!.timing!
    const later=new Map([[turn,{...verified,observedAt:verified.observedAt+60000}]])
    expect(store.project('owner',{...f.source,live:false},[event],later)[0]?.timing).toEqual({...verified,live:false})
  })
})
