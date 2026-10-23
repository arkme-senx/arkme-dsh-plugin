import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { TeamCodexCaptureHealthReader, codexCaptureCommand } from '../src/team-codex-capture-health.js'
import type { TeamCodexTask } from '../src/team-codex-contract.js'
const roots:string[]=[]
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
const id='11111111-1111-1111-1111-111111111111'
it('parses generated quoted commands without executing or accepting shell commands',()=>{
  const key='a'.repeat(64)
  expect(codexCaptureCommand(`python3 '/path with spaces/bridge.py' capture ${id} --home-key ${key}`)?.directory).toBe('/path with spaces')
  expect(codexCaptureCommand(`python3 '/path'"'"'s/bridge.py' capture ${id} --home-key ${key}`)?.directory).toBe("/path's")
  expect(codexCaptureCommand(`python3 /path/bridge.py capture ${id} --home-key ${key};echo secret`)).toBeUndefined()
})
it('resolves timing only through exact cloud owner/team/source/task and original turn hashes',()=>{
  const root=mkdtempSync(join(tmpdir(),'codex-timing-source-'));roots.push(root)
  const home=join(root,'codex'),bridge=join(root,'desktop');mkdirSync(home);mkdirSync(bridge)
  const key=createHash('sha256').update(realpathSync(home)).digest('hex')
  const command=`python3 '${join(bridge,'bridge.py')}' capture ${id} --home-key ${key}`
  writeFileSync(join(home,'hooks.json'),JSON.stringify({hooks:{Stop:[{hooks:[{type:'command',command}]}]}}))
  const db=new DatabaseSync(join(bridge,'journal.sqlite'))
  try {
    db.exec(`CREATE TABLE codex_installations(id,user_id,team_ref,home_key,status);
      CREATE TABLE codex_tasks(id,installation_id,session_id,project_key,deleted,excluded);
      CREATE TABLE codex_cloud_sources(id,owner,local_team);
      CREATE TABLE codex_cloud_tasks(id,local_id,source);
      CREATE TABLE codex_project_exclusions(installation_id,project_key);
      CREATE TABLE codex_session_visibility(installation_id,session_id,visibility);
      CREATE TABLE codex_events(task_id,turn_id);`)
    db.prepare('INSERT INTO codex_installations VALUES(?,?,?,?,?)').run(id,11,'team',key,'active')
    db.prepare('INSERT INTO codex_tasks VALUES(?,?,?,?,0,0)').run('local',id,'session_123','project')
    db.prepare('INSERT INTO codex_session_visibility VALUES(?,?,?)').run(id,'session_123','user')
    db.exec("INSERT INTO codex_cloud_sources VALUES('source',11,'team');INSERT INTO codex_cloud_tasks VALUES('cloud','local','source');INSERT INTO codex_events VALUES('local','original_turn')")
    const reader=new TeamCodexCaptureHealthReader(home),hash=createHash('sha256').update('original_turn').digest('hex')
    expect(reader.timingSource(11,'team','cloud','source',[hash])?.turns?.get(hash)).toBe('original_turn')
    for(const args of [[22,'team','cloud','source'],[11,'other','cloud','source'],[11,'team','other','source'],[11,'team','cloud','other']] as const) {
      expect(reader.timingSource(...args,[hash])).toBeUndefined()
    }
    expect(reader.timingSource(11,'team','cloud','source',['unknown'])).toBeUndefined()
    db.exec('DROP TABLE codex_session_visibility')
    expect(reader.timingSource(11,'team','cloud','source',[hash])).toBeUndefined()
    const native=new DatabaseSync(join(home,'state_5.sqlite'))
    native.exec("CREATE TABLE threads(id TEXT,name TEXT);INSERT INTO threads VALUES('session_123','用户任务')");native.close()
    expect(reader.timingSource(11,'team','cloud','source',[hash])?.turns?.get(hash)).toBe('original_turn')
    db.exec('UPDATE codex_tasks SET excluded=1')
    expect(reader.timingSource(11,'team','cloud','source',[hash])).toBeUndefined()
  } finally {db.close()}
})
it('matches owner, team and source before diagnosing the configured collector, never inferring health from old message time',()=>{
  const root=mkdtempSync(join(tmpdir(),'codex-health-'));roots.push(root)
  const home=join(root,'codex'),bridge=join(root,'desktop');mkdirSync(home);mkdirSync(bridge)
  const key=createHash('sha256').update(realpathSync(home)).digest('hex'),now=Date.now()
  const command=`python3 '${join(bridge,'bridge.py')}' capture ${id} --home-key ${key}`
  writeFileSync(join(home,'hooks.json'),JSON.stringify({hooks:Object.fromEntries(['UserPromptSubmit','Stop','Interrupt'].map(k=>[k,[{hooks:[{type:'command',command}]}]]))}))
  const db=new DatabaseSync(join(bridge,'journal.sqlite'))
  db.exec(`CREATE TABLE codex_installations(id,user_id,team_ref,home_key,status,updated_at);
    CREATE TABLE codex_tasks(id,installation_id,updated_at);
    CREATE TABLE codex_cloud_sources(id,owner,local_team);
    CREATE TABLE codex_cloud_tasks(id,local_id,source);`)
  db.prepare('INSERT INTO codex_installations VALUES(?,?,?,?,?,?)').run(id,11,'team',key,'active',1)
  db.prepare('INSERT INTO codex_tasks VALUES(?,?,?)').run('local',id,1)
  db.exec("INSERT INTO codex_cloud_sources VALUES('source',11,'team');INSERT INTO codex_cloud_tasks VALUES('cloud','local','source')");db.close()
  const task={id:'cloud',updatedAt:1,cloud:{taskId:'cloud',sourceId:'source',ownerRef:'11',remote:true}} as TeamCodexTask
  const reader=new TeamCodexCaptureHealthReader(home,()=>now)
  expect(reader.annotate(11,'team',[task])[0]?.captureHealth?.status).toBe('offline')
  writeFileSync(join(bridge,'active.json'),JSON.stringify({userId:11,at:now}))
  expect(reader.annotate(11,'team',[task])[0]?.captureHealth?.status).toBe('online')
  expect(reader.annotate(22,'team',[task])[0]?.captureHealth).toBeUndefined()
  expect(reader.annotate(11,'other-team',[task])[0]?.captureHealth).toBeUndefined()
  expect(reader.annotate(11,'team',[{...task,cloud:{...task.cloud!,sourceId:'other'}}])[0]?.captureHealth).toBeUndefined()
  rmSync(join(bridge,'active.json'))
  writeFileSync(join(bridge,'capture-lease.json'),JSON.stringify({userId:11,at:now,expiresAt:now+600000}))
  expect(reader.annotate(11,'team',[task])[0]?.captureHealth?.status).toBe('buffering')
  writeFileSync(join(bridge,'active.json'),JSON.stringify({userId:22,at:now}))
  expect(reader.annotate(11,'team',[task])[0]?.captureHealth?.status).toBe('offline')
})
