import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeamCodexService } from '../src/team-codex-service.js'
import type { ArkmeTeamMember, ArkmeUserProfileSnapshot } from '../src/types.js'
import type { TeamCodexCloudPort } from '../src/team-codex-cloud.js'

const teamRef=`team_v1_${'a'.repeat(32)}`
const member:ArkmeTeamMember={userRef:`usr_v1_${'b'.repeat(32)}`,displayName:'本机用户',jotmoId:'my_user',identityState:'ready',role:'member',joinedAtMillis:1}
const roots:string[]=[],services:TeamCodexService[]=[]
afterEach(()=>{for(const s of services.splice(0))s.close();for(const path of roots.splice(0))rmSync(path,{recursive:true,force:true})})

function fixture(cloud?:TeamCodexCloudPort){
  const root=mkdtempSync(join(tmpdir(),"arkme codex's machine-"));roots.push(root)
  const directory=join(root,'bridge'),codex=join(root,'codex'),project=join(root,'project-a')
  mkdirSync(codex);mkdirSync(project)
  let user:number|undefined=11,offset=0,installation=''
  const options={directory,codexHome:codex,currentUserId:async()=>user,
    profile:async()=>({profile:{userId:user,arkmeId:'my_user'}} as ArkmeUserProfileSnapshot),
    teams:{listMembers:vi.fn(async()=>({team:{teamRef,name:'测试团队',jotmoId:'team_test',currentUserRole:'member' as const,createdAtMillis:1,updatedAtMillis:1},items:[member],totalCount:1,hasMore:false}))},now:()=>Date.now()+offset,...(cloud?{cloud}:{})}
  const service=new TeamCodexService(options);services.push(service)
  const run=(args:string[],input?:object,env:Record<string,string>={})=>spawnSync('python3',[join(directory,'bridge.py'),...args],{
    env:{...process.env,CODEX_HOME:codex,CODEX_THREAD_ID:'',...env},...(input?{input:JSON.stringify(input)}:{}),encoding:'utf8',timeout:5000})
  const enroll=async()=>{const invite=await service.invite(teamRef);installation=invite.id;const result=run(['enroll',installation]);expect(result.status,result.stderr).toBe(0);return invite}
  const claim=()=>JSON.parse(readFileSync(join(directory,installation,'claim.json'),'utf8'))
  const record=(kind='UserPromptSubmit',override:Record<string,unknown>={})=>run(['capture',installation,'--home-key',claim().homeKey],{
    hook_event_name:kind,session_id:'task_current_123',turn_id:'turn_123',prompt:'请修复页面',last_assistant_message:'已经修复',cwd:project,...override})
  const tasks=async()=>(await service.state(teamRef)).tasks
  const task=async()=>(await tasks())[0]!
  return {service,options,root,directory,codex,project,run,enroll,record,claim,tasks,task,
    setUser:(value:number|undefined)=>{user=value;service.fence()},advance:(value:number)=>{offset+=value}}
}

describe('machine-wide local Codex journal and real Python helper',()=>{
  it.each(['consent-first','hook-first'])('registers metadata only after consent AND a real isolated Hook, in either order: %s',async order=>{
    const post=vi.fn(async(_owner:number,path:string,body:Record<string,unknown>)=>{
      if(path.endsWith('list-mine')) return {teams:[{team_id:101,jotmo_id:'arkme_cn'}]}
      if(path.endsWith('/confirm')) return {owner_ref:'11',source_id:body.source_id}
      if(path.endsWith('/status')) return {owner_ref:'11',has_connected_codex:false,first_connected_at:null}
      return {items:[],page:1,has_more:false}
    })
    const cloud={post,selectedTeam:async()=>({teamRef,jotmoId:'arkme_cn'})} as unknown as TeamCodexCloudPort
    const f=fixture(cloud),invite=await f.enroll()
    const confirms=()=>post.mock.calls.filter(c=>c[1].endsWith('/confirm'))
    await f.service.tick();expect(confirms()).toHaveLength(0)
    if(order==='consent-first') await f.service.change(teamRef,'cloud','enable-cloud',undefined,'测试来源')
    await f.service.tick();expect(confirms()).toHaveLength(0)
    if(order==='hook-first') {
      expect(f.record().status).toBe(0);await f.service.tick()
      expect((await f.service.entryAvailability(11)).visible).toBe(true)
      expect(confirms()).toHaveLength(0)
      // Pause all content before enabling cloud: metadata alone must still register.
      await f.service.change(teamRef,invite.id,'pause')
      await f.service.change(teamRef,'cloud','enable-cloud',undefined,'测试来源')
    } else {
      expect(f.record().status).toBe(0)
      // Ingest without running a cloud pump until collection has been paused.
      await f.service.tick()
      await f.service.change(teamRef,invite.id,'pause')
    }
    f.advance(6000);await f.service.tick()
    await vi.waitFor(()=>expect(confirms()).toHaveLength(1))
    expect(confirms()[0]![2]).toMatchObject({source_name:'测试来源',team_ref:'101',expected_owner_ref:'11'})
    expect(post.mock.calls.some(c=>c[1].endsWith('/sync'))).toBe(false)
  })
  it('reveals the entry only after a real trusted event and keeps it when paused or disconnected',async()=>{
    const f=fixture()
    expect((await f.service.entryAvailability(11)).visible).toBe(false)
    const invitation=await f.service.invite(teamRef)
    expect((await f.service.entryAvailability(11)).visible).toBe(false)
    await f.enroll()
    expect((await f.service.state(teamRef)).installations[0]).toMatchObject({configured:true,status:'pending'})
    expect((await f.service.entryAvailability(11)).visible).toBe(false)
    await f.service.change(teamRef,invitation.id,'pause')
    expect((await f.service.entryAvailability(11)).visible).toBe(false)
    await f.service.change(teamRef,invitation.id,'resume')
    f.record(); await f.service.tick()
    expect((await f.service.entryAvailability(11)).visible).toBe(true)
    await f.service.change(teamRef,invitation.id,'pause')
    expect((await f.service.entryAvailability(11)).visible).toBe(true)
    await f.service.change(teamRef,invitation.id,'disconnect')
    expect((await f.service.entryAvailability(11)).visible).toBe(true)
    f.setUser(22)
    expect((await f.service.entryAvailability(22)).visible).toBe(false)
    await expect(f.service.entryAvailability(11)).rejects.toThrow('账号已切换')
  })
  it('backfills native titles and follows metadata-only renames with unchanged identity, events and activity time',async()=>{
    const f=fixture();await f.enroll();f.record()
    const first=await f.task()
    const journal=new DatabaseSync(join(f.directory,'journal.sqlite'))
    journal.prepare('UPDATE codex_tasks SET title=? WHERE id=?').run('# Files mentioned by the user:',first.id)
    journal.close()
    const db=new DatabaseSync(join(f.codex,'state_5.sqlite'))
    try {
      db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,title TEXT,name TEXT)')
      db.prepare('INSERT INTO threads VALUES(?,?,?)').run('task_current_123','原始需求','Codex 中的真实名称')
      db.prepare('INSERT INTO threads VALUES(?,?,?)').run('not_connected','不能读取','未接入的任务')
      await f.service.tick() // No UI open and no new Hook event.
      const corrected=await f.task()
      expect(corrected).toMatchObject({id:first.id,title:'Codex 中的真实名称',eventCount:first.eventCount,updatedAt:first.updatedAt,state:first.state})
      expect(await f.tasks()).toHaveLength(1)
      db.prepare('UPDATE threads SET name=? WHERE id=?').run('后来重命名的任务','task_current_123')
      await f.service.tick()
      expect(await f.task()).toMatchObject({id:first.id,title:'后来重命名的任务',eventCount:first.eventCount,updatedAt:first.updatedAt})
      db.exec('ALTER TABLE threads RENAME TO unsupported')
      f.record('Stop')
      expect((await f.task()).title).toBe('后来重命名的任务')
    } finally {db.close()}
  })
  it('does not collect titles for paused, excluded, deleted or ambiguous-account sessions',async()=>{
    const f=fixture(),invite=await f.enroll();f.record();const first=await f.task()
    const db=new DatabaseSync(join(f.codex,'state_5.sqlite'))
    try {
      db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,name TEXT)')
      db.prepare('INSERT INTO threads VALUES(?,?)').run('task_current_123','第一次命名')
      expect((await f.task()).title).toBe('第一次命名')
      await f.service.change(teamRef,first.id,'exclude')
      db.prepare('UPDATE threads SET name=?').run('排除时不读取')
      expect((await f.task()).title).toBe('第一次命名')
      await f.service.change(teamRef,first.id,'include')
      expect((await f.task()).title).toBe('排除时不读取')
      await f.service.change(teamRef,invite.id,'exclude',first.projectKey)
      db.prepare('UPDATE threads SET name=?').run('项目排除时不读取')
      expect((await f.task()).title).toBe('排除时不读取')
      await f.service.change(teamRef,invite.id,'include',first.projectKey)
      await f.service.change(teamRef,invite.id,'pause')
      db.prepare('UPDATE threads SET name=?').run('暂停时不读取')
      expect((await f.task()).title).not.toBe('暂停时不读取')
      await f.service.change(teamRef,invite.id,'resume')
      expect((await f.task()).title).toBe('暂停时不读取')
      f.setUser(22);await f.enroll();f.record()
      expect((await f.task()).title).toBe('Codex')
      f.setUser(11)
      db.prepare('UPDATE threads SET name=?').run('不能跨账号读取')
      expect((await f.task()).title).toBe('暂停时不读取')
      await f.service.change(teamRef,first.id,'delete');expect(await f.tasks()).toEqual([])
    } finally {db.close()}
  })
  it('refreshes the app-server queue when legacy JSON has no entry, retaining version and account fences',async()=>{
    const f=fixture(),invite=await f.enroll();f.record()
    writeFileSync(join(f.codex,'.codex-global-state.json'),JSON.stringify({'queued-follow-ups':{}}))
    const db=new DatabaseSync(join(f.codex,'queue_1.sqlite'))
    try {
      db.exec(`PRAGMA journal_mode=WAL;CREATE TABLE queued_items(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,queue_order INTEGER NOT NULL,created_at_ms INTEGER NOT NULL,updated_at_ms INTEGER NOT NULL)`)
      const payload=(text:string)=>JSON.stringify({UserInput:{content:[{type:'text',text,text_elements:[]}],client_id:'client-request'}})
      db.prepare('INSERT INTO queued_items VALUES(?,?,?,?,?,?)').run('server-request','task_current_123',payload('真实格式的排队请求'),0,Date.now(),Date.now())
      db.prepare('INSERT INTO queued_items VALUES(?,?,?,?,?,?)').run('unbound','other-session',payload('未绑定请求'),0,Date.now(),Date.now())
      const first=await f.task()
      expect(first.queue).toMatchObject({availability:'ready',items:[{id:'server-request',text:'真实格式的排队请求'}]})
      expect((await f.task()).queue?.version).toBe(first.queue?.version)
      db.prepare('UPDATE queued_items SET payload_json=? WHERE id=?').run(payload('修改后'),'server-request')
      const edited=await f.task();expect(edited.queue?.version).toBe(first.queue!.version+1)
      expect(edited.queue?.items[0]?.text).toBe('修改后');expect(edited.eventCount).toBe(first.eventCount)
      await f.service.change(teamRef,first.id,'exclude');expect((await f.task()).queue).toMatchObject({availability:'paused',items:[]})
      await f.service.change(teamRef,first.id,'include');expect((await f.task()).queue?.items).toHaveLength(1)
      await f.service.change(teamRef,invite.id,'pause');expect((await f.task()).queue).toMatchObject({availability:'paused',items:[]})
      await f.service.change(teamRef,invite.id,'resume');expect((await f.task()).queue?.items).toHaveLength(1)
      db.exec('ALTER TABLE queued_items RENAME TO unavailable_queue')
      expect((await f.task()).queue).toMatchObject({availability:'unavailable',items:[{id:'server-request'}]})
      db.exec('ALTER TABLE unavailable_queue RENAME TO queued_items')
      db.prepare('DELETE FROM queued_items WHERE id=?').run('server-request')
      expect((await f.task()).queue).toMatchObject({availability:'ready',items:[]})
      db.prepare('INSERT INTO queued_items VALUES(?,?,?,?,?,?)').run('private','task_current_123',payload('不能传给账号二'),0,Date.now(),Date.now())
      f.setUser(22);expect(await f.tasks()).toEqual([]);await f.enroll();f.record()
      expect((await f.task()).queue).toMatchObject({availability:'unavailable',reason:'ambiguous-owner',items:[]})
    } finally { db.close() }
  })
  it('refreshes current queue independently of events, including edits, reorder, removal and persistence',async()=>{
    const f=fixture();await f.enroll();f.record()
    const item=(id:string,text:string)=>({id,text,createdAt:Date.now()})
    const first=item('first','下一项'),second=item('second','之后做'),path=join(f.codex,'.codex-global-state.json')
    const write=(items:object[])=>writeFileSync(path,JSON.stringify({'queued-follow-ups':{task_current_123:items,unbound_session:[item('private','未接入对话')]}}))
    write([first,second]);const task=await f.task()
    expect(task.currentInput?.text).toBe('请修复页面');expect(task.queue).toMatchObject({version:1,availability:'ready',items:[{id:'first'},{id:'second'}]})
    expect(await f.tasks()).toHaveLength(1)
    const initialVersion=task.queue!.version
    write([first,second]);expect((await f.task()).queue?.version).toBe(initialVersion)
    write([second,{...first,text:'修改后的要求'}]);const edited=await f.task()
    expect(edited.eventCount).toBe(task.eventCount);expect(edited.updatedAt).toBe(task.updatedAt)
    expect(edited.queue?.version).toBe(initialVersion+1);expect(edited.queue?.items.map(i=>i.id)).toEqual(['second','first'])
    expect(edited.queue?.items[1]?.text).toBe('修改后的要求')
    writeFileSync(path,'{');const failed=await f.task()
    expect(failed.queue?.availability).toBe('unavailable');expect(failed.queue?.items).toEqual(edited.queue?.items)
    f.service.close();const reopened=new TeamCodexService(f.options);services.push(reopened)
    expect((await reopened.state(teamRef)).tasks[0]?.queue?.items).toEqual(edited.queue?.items)
    write([]);const cleared=(await reopened.state(teamRef)).tasks[0]!
    expect(cleared.queue).toMatchObject({availability:'ready',items:[]});expect(cleared.queue!.version).toBeGreaterThan(edited.queue!.version)
  })
  it('does not mix queues across accounts or collect excluded/paused tasks',async()=>{
    const f=fixture(),invite=await f.enroll();f.record();const task=await f.task()
    const path=join(f.codex,'.codex-global-state.json'),queue={id:'secret',text:'只属于账号一',createdAt:Date.now()}
    writeFileSync(path,JSON.stringify({'queued-follow-ups':{task_current_123:[queue]}}))
    expect((await f.task()).queue?.items).toHaveLength(1)
    await f.service.change(teamRef,task.id,'exclude');expect((await f.task()).queue).toMatchObject({availability:'paused',items:[]})
    await f.service.change(teamRef,task.id,'include');expect((await f.task()).queue?.items).toHaveLength(1)
    await f.service.change(teamRef,invite.id,'pause');expect((await f.task()).queue).toMatchObject({availability:'paused',items:[]})
    f.setUser(22);expect(await f.tasks()).toEqual([])
    await f.enroll();f.record();const other=await f.task()
    expect(other.queue).toMatchObject({availability:'unavailable',reason:'ambiguous-owner',items:[]})
    expect(JSON.stringify(other)).not.toContain('只属于账号一')
  })
  it('enrolls once from any task, captures multiple projects/sessions and deduplicates per session',async()=>{
    const f=fixture(),invitation=await f.enroll()
    expect((await f.service.invite(teamRef)).id).toBe(invitation.id)
    expect(invitation.instructions).toContain('所有本地任务')
    expect((await f.service.state(teamRef)).installations[0]).toMatchObject({status:'pending',configured:true})
    expect(await f.tasks()).toEqual([])
    const other=join(f.root,'project-b');mkdirSync(other)
    expect(f.run(['enroll',invitation.id],undefined,{CODEX_THREAD_ID:'other_task_999'}).status).toBe(0)
    f.record();f.record();f.record('Stop')
    f.record('UserPromptSubmit',{session_id:'other_task_999',cwd:other,prompt:'另一个项目'})
    const tasks=await f.tasks()
    expect(tasks).toHaveLength(2)
    expect(tasks.find(t=>t.projectName==='project-a')).toMatchObject({title:'Codex',state:'finished',eventCount:2,member})
    expect(tasks.find(t=>t.projectName==='project-b')).toMatchObject({title:'Codex',state:'working',eventCount:1})
    expect(tasks[0]?.projectKey).not.toBe(tasks[1]?.projectKey)
    expect((await f.service.state(teamRef)).installations[0]?.status).toBe('active')
  })
  it('merges and backs up hooks, uses a new global command, never modifies trust, rejects another Codex home',async()=>{
    const f=fixture(),original={description:'Existing',hooks:{Stop:[{hooks:[{type:'command',command:'existing-command'}]}]}}
    writeFileSync(join(f.codex,'hooks.json'),JSON.stringify(original))
    const invite=await f.enroll(),hooks=JSON.parse(readFileSync(join(f.codex,'hooks.json'),'utf8'))
    expect(hooks.hooks.Stop[0]).toEqual(original.hooks.Stop[0])
    expect(hooks.hooks.Stop[1].hooks[0].command).toContain('capture')
    expect(hooks.hooks.Stop[1].hooks[0].command).toContain(invite.id)
    expect(f.run(['enroll',invite.id]).status).toBe(0)
    expect(JSON.parse(readFileSync(join(f.codex,'hooks.json'),'utf8')).hooks.Stop).toHaveLength(2)
    expect(readdirSync(f.codex).every(name=>name.startsWith('hooks.json'))).toBe(true)
    const otherHome=join(f.root,'other-codex');mkdirSync(otherHome)
    expect(f.run(['enroll',invite.id],undefined,{CODEX_HOME:otherHome}).status).toBe(1)
  })
  it('saves only allowlisted text, redacts common credentials, skips explicit subagent outputs',async()=>{
    const f=fixture();await f.enroll()
    f.record('UserPromptSubmit',{prompt:'api_key=super-secret-value test Bearer very-secret-token',transcript_path:'/private/never-read.jsonl',tool_response:'hidden',reasoning:'hidden'})
    f.record('PostToolUse',{tool_response:'hidden'});f.record('Stop',{agent_id:'child_agent',last_assistant_message:'child-only'})
    const task=await f.task(),events=await f.service.events(teamRef,task.id)
    expect(events.items).toHaveLength(1)
    expect(events.items[0]?.text).toBe('api_key=[REDACTED] test Bearer [REDACTED]')
    expect(JSON.stringify(events)).not.toMatch(/super-secret|very-secret|hidden|never-read|child-only/)
  })
  it('pauses globally, fences old queues, resumes without backfill and disconnects',async()=>{
    const f=fixture(),invite=await f.enroll();f.record();const task=await f.task()
    f.record('Stop',{last_assistant_message:'queued before pause'})
    await f.service.change(teamRef,invite.id,'pause')
    f.record('UserPromptSubmit',{session_id:'task_during_pause',turn_id:'turn_paused'})
    await f.service.change(teamRef,invite.id,'resume');await f.service.tick()
    expect((await f.service.events(teamRef,task.id)).items).toHaveLength(1)
    f.record('Stop');await f.service.tick();expect((await f.service.events(teamRef,task.id)).items).toHaveLength(2)
    await f.service.change(teamRef,invite.id,'disconnect');f.record('UserPromptSubmit',{session_id:'task_disconnected'})
    expect(await f.tasks()).toHaveLength(1);expect((await f.task()).status).toBe('disconnected')
    await expect(f.service.change(teamRef,invite.id,'resume')).rejects.toMatchObject({httpStatus:409})
  })
  it('excludes projects including new tasks before spooling; supports task exclusions and delete tombstones',async()=>{
    const f=fixture(),invite=await f.enroll();f.record();const task=await f.task()
    await f.service.change(teamRef,invite.id,'exclude',task.projectKey)
    f.record('Stop');f.record('UserPromptSubmit',{session_id:'task_new_in_excluded_project'})
    expect(readdirSync(join(f.directory,invite.id,'inbox'))).toEqual([])
    expect(await f.tasks()).toHaveLength(1);expect((await f.task()).projectExcluded).toBe(true)
    const other=join(f.root,'project-b');mkdirSync(other)
    f.record('UserPromptSubmit',{session_id:'task_other_project',cwd:other});expect(await f.tasks()).toHaveLength(2)
    await f.service.change(teamRef,invite.id,'include',task.projectKey)
    await f.service.change(teamRef,task.id,'exclude');f.record('Stop')
    expect(readdirSync(join(f.directory,invite.id,'inbox'))).toEqual([])
    await f.service.change(teamRef,task.id,'include');f.record('Stop');await f.service.tick()
    expect((await f.service.events(teamRef,task.id)).items).toHaveLength(2)
    await f.service.change(teamRef,task.id,'delete');f.record('UserPromptSubmit',{turn_id:'after_delete'})
    expect((await f.tasks()).some(t=>t.id===task.id)).toBe(false)
    await expect(f.service.events(teamRef,task.id)).rejects.toMatchObject({httpStatus:404})
    expect(readdirSync(join(f.directory,invite.id,'inbox'))).toEqual([])
  })
  it('groups real Git worktrees/subdirectories by repo and preserves branch identity',async()=>{
    const f=fixture();await f.enroll()
    const git=(args:string[])=>{const r=spawnSync('git',args,{cwd:f.project,encoding:'utf8'});expect(r.status,r.stderr).toBe(0)}
    git(['init','-b','dev']);git(['-c','user.name=Test','-c','user.email=test@example.test','commit','--allow-empty','-m','fixture'])
    const worktree=join(f.root,'separate-worktree');git(['worktree','add','-b','feature-test',worktree])
    const sub=join(f.project,'src');mkdirSync(sub)
    f.record('UserPromptSubmit',{cwd:sub});f.record('UserPromptSubmit',{cwd:worktree,session_id:'task_worktree_123'})
    const tasks=await f.tasks();expect(tasks).toHaveLength(2)
    expect(tasks[0]?.projectKey).toBe(tasks[1]?.projectKey)
    expect(tasks.map(t=>t.branch).sort()).toEqual(['dev','feature-test'])
    expect(tasks.every(t=>t.projectName==='project-a')).toBe(true)
    expect(tasks.find(t=>t.branch==='feature-test')?.worktree).toBe(realpathSync(worktree))
  })
  it('fences logout/account changes, persists on disk and denies cross-account access',async()=>{
    const f=fixture(),invite=await f.enroll();f.record();const task=await f.task()
    f.setUser(undefined);f.record('Stop');await expect(f.service.state(teamRef)).rejects.toMatchObject({httpStatus:401})
    f.setUser(22);await f.service.tick();expect(await f.tasks()).toEqual([])
    expect((await f.service.state(teamRef)).installations).toEqual([])
    await expect(f.service.events(teamRef,task.id)).rejects.toMatchObject({httpStatus:404})
    await expect(f.service.change(teamRef,invite.id,'disconnect')).rejects.toMatchObject({httpStatus:404})
    f.record('Stop');f.setUser(11);await f.service.tick();expect((await f.service.events(teamRef,task.id)).items).toHaveLength(1)
    f.service.close();const reopened=new TeamCodexService(f.options);services.push(reopened)
    expect((await reopened.events(teamRef,task.id)).items).toHaveLength(1)
  })
  it('does not expire a configured installation; expires unused invitations',async()=>{
    const f=fixture(),invite=await f.enroll();f.advance(21*60_000)
    expect((await f.service.state(teamRef)).installations[0]?.status).toBe('pending')
    f.advance(-21*60_000);await f.service.tick();f.record();expect((await f.task()).status).toBe('active')
    await f.service.change(teamRef,invite.id,'disconnect')
    const pending=await f.service.invite(teamRef);f.advance(21*60_000)
    expect((await f.service.state(teamRef)).installations.find(i=>i.id===pending.id)?.status).toBe('expired')
  })
  it('orders batches, pages without overlap and discards malformed/wrong-generation/wrong-home records',async()=>{
    const f=fixture(),invite=await f.enroll(),folder=join(f.directory,invite.id)
    const control=JSON.parse(readFileSync(join(folder,'control.json'),'utf8')),at=Date.now()
    const sample={version:2,homeKey:f.claim().homeKey,sessionId:'task_current_123',generation:control.generation,
      turnId:'turn_invalid',kind:'UserPromptSubmit',text:'bad',at,project:{key:'unknown',name:'',cwd:'',branch:'',worktree:''}}
    for(let n=0;n<56;n++)writeFileSync(join(folder,'inbox',`${String(99-n).padStart(64,'0')}.json`),JSON.stringify({...sample,
      turnId:`turn_${Math.floor(n/2)}`,kind:n%2?'Stop':'UserPromptSubmit',text:`text_${n}`,at:at+Math.floor(n/2)}))
    writeFileSync(join(folder,'inbox',`${'f'.repeat(64)}.json`),'invalid json')
    writeFileSync(join(folder,'inbox',`${'e'.repeat(64)}.json`),JSON.stringify({...sample,homeKey:'wrong'}))
    writeFileSync(join(folder,'inbox',`${'d'.repeat(64)}.json`),JSON.stringify({...sample,generation:'old'}))
    const task=await f.task();expect(task).toMatchObject({eventCount:56,state:'finished'})
    const newest=await f.service.events(teamRef,task.id)
    expect(newest.items.map(e=>e.text)).toEqual(Array.from({length:50},(_,i)=>`text_${i+6}`))
    const older=await f.service.events(teamRef,task.id,newest.nextBefore)
    expect(older.items.map(e=>e.text)).toEqual(Array.from({length:6},(_,i)=>`text_${i}`));expect(older.nextBefore).toBeUndefined()
    expect(readdirSync(join(folder,'inbox'))).toEqual([])
  })
  it('keeps legacy records narrow, then preserves history and disables legacy hooks for the migrated task',async()=>{
    const f=fixture(),legacy=randomUUID(),now=Date.now(),generation=randomUUID(),db=new DatabaseSync(join(f.directory,'journal.sqlite'))
    db.prepare('INSERT INTO connections VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(legacy,11,teamRef,JSON.stringify(member),'原任务','task_current_123','active',generation,now,now+100000,now)
    db.prepare('INSERT INTO events(connection_id,turn_id,kind,text,at,truncated) VALUES(?,?,?,?,?,?)').run(legacy,'old_turn','UserPromptSubmit','旧记录',now,0)
    db.close();mkdirSync(join(f.directory,legacy,'inbox'),{recursive:true})
    writeFileSync(join(f.directory,legacy,'control.json'),JSON.stringify({version:1,userId:11,status:'active',generation,expiresAt:now+100000}))
    writeFileSync(join(f.directory,legacy,'claim.json'),JSON.stringify({sessionId:'task_current_123',title:'原任务',at:now}))
    await f.service.tick();f.run(['record'],{session_id:'different_task_123',turn_id:'other',hook_event_name:'UserPromptSubmit',prompt:'ignore'})
    expect((await f.task()).eventCount).toBe(1)
    await f.enroll();f.record();const task=await f.task();expect(await f.tasks()).toHaveLength(1)
    expect(task).toMatchObject({title:'原任务',eventCount:2})
    expect((await f.service.events(teamRef,task.id)).items.map(e=>e.text)).toEqual(['旧记录','请修复页面'])
    expect(JSON.parse(readFileSync(join(f.directory,legacy,'control.json'),'utf8')).status).toBe('disconnected')
  })
  it('retires other legacy collectors too, so they cannot bypass the device pause',async()=>{
    const f=fixture(),legacy=randomUUID(),now=Date.now(),generation=randomUUID(),db=new DatabaseSync(join(f.directory,'journal.sqlite'))
    db.prepare('INSERT INTO connections VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(legacy,11,teamRef,JSON.stringify(member),'其他旧任务','task_legacy_other','active',generation,now,now+100000,now)
    db.prepare('INSERT INTO events(connection_id,turn_id,kind,text,at,truncated) VALUES(?,?,?,?,?,?)').run(legacy,'old_turn','Stop','旧回答',now,0)
    db.close();mkdirSync(join(f.directory,legacy,'inbox'),{recursive:true})
    writeFileSync(join(f.directory,legacy,'control.json'),JSON.stringify({version:1,userId:11,status:'active',generation,expiresAt:now+100000}))
    writeFileSync(join(f.directory,legacy,'claim.json'),JSON.stringify({sessionId:'task_legacy_other',title:'其他旧任务',at:now}))
    const invite=await f.enroll();f.record();const tasks=await f.tasks()
    expect(tasks).toHaveLength(2);expect(tasks.every(t=>t.installationId===invite.id)).toBe(true)
    await f.service.change(teamRef,invite.id,'pause')
    f.run(['record'],{session_id:'task_legacy_other',turn_id:'new_turn',hook_event_name:'UserPromptSubmit',prompt:'do not collect'})
    expect(readdirSync(join(f.directory,legacy,'inbox'))).toEqual([])
    expect((await f.tasks()).every(t=>t.status==='paused')).toBe(true)
  })
  it('handles missing project metadata without inventing a project or task title',async()=>{
    const f=fixture();await f.enroll();f.record('Stop',{cwd:null})
    expect(await f.task()).toMatchObject({projectKey:'unknown',projectName:'',title:'Codex',state:'finished'})
    f.record('UserPromptSubmit',{turn_id:'later_turn',prompt:'继续已有任务',cwd:null})
    expect(await f.task()).toMatchObject({title:'Codex',eventCount:2})
  })
})
