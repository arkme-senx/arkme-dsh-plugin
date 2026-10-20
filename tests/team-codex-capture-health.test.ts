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
