import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { TeamCodexService } from '../src/team-codex-service.js'
import { TeamCodexCloudJournal } from '../src/team-codex-cloud-journal.js'
import type { TeamCodexTask } from '../src/team-codex-contract.js'
const roots:string[]=[], services:TeamCodexService[]=[]
afterEach(()=>{services.splice(0).forEach(s=>s.close());roots.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true}))})

async function fixture(){
  const root=mkdtempSync(join(tmpdir(),'codex-recovery-'));roots.push(root)
  const source=join(root,'old'),target=join(root,'desktop'),rollout=join(root,'one-session.jsonl'),audit=join(root,'audit'),session='session_allowed_123'
  const installation='11111111-1111-1111-1111-111111111111',task='22222222-2222-2222-2222-222222222222',now=Date.now()-10000
  for(const directory of [source,target]){
    const service=new TeamCodexService({directory,codexHome:join(root,'codex'),currentUserId:async()=>11,profile:async()=>({} as never),teams:{listMembers:async()=>({} as never)}})
    services.push(service)
    const db=new DatabaseSync(join(directory,'journal.sqlite'));new TeamCodexCloudJournal(db)
    db.exec('CREATE TABLE codex_cloud_consent(owner,local_team,team,enabled,at,source_name)')
    if(directory===source){
      db.prepare('INSERT INTO codex_installations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(installation,11,'team','{}','desktop','a'.repeat(64),'active','generation',now-1000,now+10000,now)
      db.prepare('INSERT INTO codex_tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(task,installation,session,'task','unknown','','','','',0,0,now)
      db.prepare('INSERT INTO codex_events(task_id,turn_id,kind,text,at,truncated) VALUES(?,?,?,?,?,?)').run(task,'turn_1','UserPromptSubmit','original',now,0)
      const journal=new TeamCodexCloudJournal(db)
      journal.reconcile(11,'team','101',[{id:task,installationId:installation,title:'task'} as TeamCodexTask],()=>[{sequence:1,turnId:'turn_1',kind:'UserPromptSubmit',text:'original',at:now,truncated:false}])
      db.exec('UPDATE codex_cloud_tasks SET ack=version;UPDATE codex_cloud_events SET ack=version')
      db.prepare('INSERT INTO codex_cloud_consent VALUES(?,?,?,?,?,?)').run(11,'team','101',1,now,'source')
      mkdirSync(join(source,installation,'inbox'),{recursive:true})
      writeFileSync(join(source,installation,'control.json'),JSON.stringify({version:2,userId:11,status:'active'}))
      writeFileSync(join(source,installation,'claim.json'),JSON.stringify({version:2,homeKey:'a'.repeat(64)}))
    }
    db.close()
    if(directory===source)service.close();else await service.tick()
  }
  const row=(type:string,payload:object,offset:number)=>({timestamp:new Date(now+offset).toISOString(),type,payload})
  writeFileSync(rollout,[row('session_meta',{id:session},-2000),row('turn_context',{turn_id:'turn_1',root_turn_id:'turn_1'},-1),
    row('response_item',{type:'message',role:'user',content:[{type:'input_text',text:'duplicate'}]},1),
    row('response_item',{type:'message',role:'assistant',phase:'commentary',content:[{type:'output_text',text:'must not recover commentary'}]},2),
    row('response_item',{type:'reasoning',text:'must not recover reasoning'},3),
    row('event_msg',{type:'task_complete',turn_id:'turn_1',root_turn_id:'turn_1',last_agent_message:'finished'},4),
    row('turn_context',{turn_id:'turn_2',root_turn_id:'turn_2'},5),
    row('response_item',{type:'message',role:'user',content:[{type:'input_text',text:'api_key=private-value'}]},6),
    row('response_item',{type:'message',role:'developer',content:[{type:'input_text',text:'hidden instruction'}]},7),
    row('event_msg',{type:'task_complete',turn_id:'turn_2',root_turn_id:'turn_2',last_agent_message:'second finished'},8),
    row('turn_context',{turn_id:'child',root_turn_id:'turn_2'},9),
    row('response_item',{type:'message',role:'user',content:[{type:'input_text',text:'hidden child'}]},10),
    row('event_msg',{type:'task_complete',turn_id:'child',root_turn_id:'turn_2',last_agent_message:'hidden child result'},11),
  ].map(x=>JSON.stringify(x)).join('\n')+'\n')
  const run=(extra:string[]=[])=>spawnSync('python3',['scripts/recover-codex-sync.py','--source',source,'--target',target,'--session',session,'--owner','11','--rollout',rollout,'--audit',audit,...extra],{encoding:'utf8',timeout:10000})
  return {source,target,audit,rollout,task,run}
}
it('previews without writes, preserves IDs/ACKs and original inputs, restores only allowlisted final replies once',async()=>{
  const f=await fixture(),preview=f.run()
  expect(preview.status,preview.stderr).toBe(0)
  expect(JSON.parse(preview.stdout)).toMatchObject({recovered:{Stop:2,UserPromptSubmit:1},skippedExisting:1})
  expect(existsSync(f.audit)).toBe(false)
  const result=f.run(['--apply']);expect(result.status,result.stderr).toBe(0)
  const db=new DatabaseSync(join(f.target,'journal.sqlite')),old=new DatabaseSync(join(f.source,'journal.sqlite'))
  try{
    expect(db.prepare('SELECT id,ack,version FROM codex_cloud_tasks').all()).toEqual(old.prepare('SELECT id,ack,version FROM codex_cloud_tasks').all())
    expect(db.prepare('SELECT text FROM codex_events ORDER BY sequence').all().map(r=>r.text)).toEqual(['original','finished','api_key=[REDACTED]','second finished'])
    expect(db.prepare('SELECT COUNT(*) n FROM codex_tasks').get()?.n).toBe(1)
    expect(f.run(['--apply']).status).not.toBe(0)
    expect(db.prepare('SELECT COUNT(*) n FROM codex_events').get()?.n).toBe(4)
  }finally{db.close();old.close()}
  expect(readFileSync(join(f.audit,'applied.json'),'utf8')).not.toContain('private-value')
})
it('rejects recovery against another account and a different session file',async()=>{
  const f=await fixture()
  writeFileSync(join(f.target,'active.json'),JSON.stringify({userId:22,at:Date.now()}))
  expect(f.run(['--apply']).status).not.toBe(0)
  expect(existsSync(f.audit)).toBe(false)
  writeFileSync(f.rollout,JSON.stringify({timestamp:new Date().toISOString(),type:'session_meta',payload:{id:'another_session'}})+'\n')
  expect(f.run().status).not.toBe(0)
})
