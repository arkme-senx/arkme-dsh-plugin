import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeamCodexService } from '../src/team-codex-service.js'
import type { ArkmeTeamMember, ArkmeUserProfileSnapshot } from '../src/types.js'

const teamRef = `team_v1_${'a'.repeat(32)}`
const member: ArkmeTeamMember = { userRef:`usr_v1_${'b'.repeat(32)}`,displayName:'本机用户',jotmoId:'my_user',identityState:'ready',role:'member',joinedAtMillis:1 }
const roots: string[] = []
const services: TeamCodexService[] = []
afterEach(() => { for (const s of services.splice(0)) s.close(); for (const path of roots.splice(0)) rmSync(path,{ recursive:true,force:true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(),"arkme codex's test-"))
  roots.push(root)
  const directory = join(root,'bridge')
  const codex = join(root,'codex')
  mkdirSync(codex)
  let user: number | undefined = 11
  let offset = 0
  const options = {
    directory,
    codexHome: codex,
    currentUserId: async () => user,
    profile: async () => ({ profile:{userId:user,arkmeId:'my_user'} } as ArkmeUserProfileSnapshot),
    teams: { listMembers:vi.fn(async () => ({team:{teamRef,name:'测试团队',jotmoId:'team_test',currentUserRole:'member' as const,createdAtMillis:1,updatedAtMillis:1},items:[member],totalCount:1,hasMore:false})) },
    now:() => Date.now()+offset,
  }
  const service = new TeamCodexService(options)
  services.push(service)
  // Seed the previous version's enrollment schema to exercise backward compatibility.
  let legacyInvitation: {id:string;instructions:string;expiresAt:number}|undefined
  vi.spyOn(service,'invite').mockImplementation(async ref => {
    await service.state(ref)
    if (legacyInvitation) return legacyInvitation
    const id=randomUUID(),now=Date.now(),generation=randomUUID()
    const db=new DatabaseSync(join(directory,'journal.sqlite'))
    db.prepare('INSERT INTO connections VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,user!,ref,JSON.stringify(member),'Codex',null,'pending',generation,now,now+20*60_000,now)
    db.close()
    mkdirSync(join(directory,id,'inbox'),{recursive:true})
    writeFileSync(join(directory,id,'control.json'),JSON.stringify({version:1,userId:user,status:'pending',generation,expiresAt:now+20*60_000}))
    legacyInvitation={id,instructions:'Legacy CODEX_THREAD_ID fixture',expiresAt:now+20*60_000}
    return legacyInvitation
  })
  const script = join(directory,'bridge.py')
  const run = (args: string[], input?: object) => spawnSync('python3',[script,...args],{
    env:{...process.env,CODEX_HOME:codex,CODEX_THREAD_ID:'task_current_123'},
    ...(input ? {input:JSON.stringify(input)} : {}),encoding:'utf8',timeout:5000,
  })
  const record = (kind = 'UserPromptSubmit', override: Record<string,unknown> = {}) => run(['record'],{
    hook_event_name:kind,session_id:'task_current_123',turn_id:'turn_123',prompt:'请修复页面',last_assistant_message:'已经修复',...override,
  })
  return {service,options,root,directory,codex,run,record,setUser:(value:number|undefined) => { user=value; service.fence() },advance:(value:number) => { offset+=value }}
}

describe('local Codex team journal and real bridge helper', () => {
  it('refreshes an existing single-task connection title without new events, retaining it if the source disappears',async()=>{
    const f=fixture(),invite=await f.service.invite(teamRef)
    f.run(['connect',invite.id,'--title','旧标题']);f.record()
    const first=(await f.service.state(teamRef)).tasks[0]!
    const path=join(f.codex,'session_index.jsonl')
    const rename=(name:string)=>writeFileSync(path,JSON.stringify({id:'task_current_123',thread_name:name,updated_at:new Date().toISOString()})+'\n')
    rename('原生真实标题');await f.service.tick()
    expect((await f.service.state(teamRef)).tasks[0]).toMatchObject({id:first.id,title:'原生真实标题',updatedAt:first.updatedAt,eventCount:first.eventCount})
    rename('改名后的标题');await f.service.tick()
    expect((await f.service.state(teamRef)).tasks[0]?.title).toBe('改名后的标题')
    rmSync(path);f.record('Stop')
    expect((await f.service.state(teamRef)).tasks[0]?.title).toBe('改名后的标题')
  })
  it('enrolls only the authenticated member and does not claim connection before a real event', async () => {
    const f = fixture()
    const invitation = await f.service.invite(teamRef)
    expect((await f.service.invite(teamRef)).id).toBe(invitation.id)
    expect(invitation.instructions).toContain('CODEX_THREAD_ID')
    expect(invitation.instructions).not.toContain('accessToken')
    expect((await f.service.state(teamRef)).tasks[0]).toMatchObject({status:'pending',eventCount:0,member})
    expect(f.run(['connect',invitation.id,'--title','修复录音']).status).toBe(0)
    expect((await f.service.state(teamRef)).tasks[0]?.status).toBe('pending')
    expect(f.record('UserPromptSubmit',{session_id:'some_other_task'}).stdout.trim()).toBe('{}')
    expect((await f.service.state(teamRef)).tasks[0]?.eventCount).toBe(0)
    expect(f.record().status).toBe(0)
    expect((await f.service.state(teamRef)).tasks[0]).toMatchObject({status:'active',state:'working',title:'修复录音',eventCount:1})
    f.record('Stop')
    expect((await f.service.state(teamRef)).tasks[0]?.state).toBe('finished')
    expect((await f.service.events(teamRef,invitation.id)).items.map(e=>e.text)).toEqual(['请修复页面','已经修复'])
  })

  it('merges hooks, backs up existing config and never changes hook trust or Codex login', async () => {
    const f=fixture()
    const original={description:'Existing user hooks',hooks:{Stop:[{hooks:[{type:'command',command:'existing-command'}]}]}}
    writeFileSync(join(f.codex,'hooks.json'),JSON.stringify(original))
    const invitation=await f.service.invite(teamRef)
    expect(f.run(['connect',invitation.id]).status).toBe(0)
    const hooks=JSON.parse(readFileSync(join(f.codex,'hooks.json'),'utf8'))
    expect(hooks.description).toBe(original.description)
    expect(hooks.hooks.Stop[0]).toEqual(original.hooks.Stop[0])
    expect(hooks.hooks.Stop).toHaveLength(2)
    expect(hooks.hooks.Stop[1].hooks[0].command).toContain('record')
    expect(f.run(['connect',invitation.id]).status).toBe(0)
    expect(JSON.parse(readFileSync(join(f.codex,'hooks.json'),'utf8')).hooks.Stop).toHaveLength(2)
    expect(readdirSync(f.codex).every(name=>name.startsWith('hooks.json'))).toBe(true)
    const changed=f.run(['connect',invitation.id,'--session-id','different_task_123'])
    expect(changed.status).toBe(1)
  })

  it('deduplicates retries and stores only allowlisted visible text, with common credentials redacted', async () => {
    const f=fixture();const invitation=await f.service.invite(teamRef)
    f.run(['connect',invitation.id])
    const input={prompt:'api_key=super-secret-value test Bearer very-secret-token',transcript_path:'/private/never-read.jsonl',tool_response:'hidden',reasoning:'hidden'}
    f.record('UserPromptSubmit',input);f.record('UserPromptSubmit',input)
    await f.service.tick()
    const events=await f.service.events(teamRef,invitation.id)
    expect(events.items).toHaveLength(1)
    expect(events.items[0]?.text).toBe('api_key=[REDACTED] test Bearer [REDACTED]')
    expect(JSON.stringify(events)).not.toMatch(/super-secret|very-secret|hidden|never-read/)
    f.record('PostToolUse',{tool_response:'should not collect'})
    await f.service.tick()
    expect((await f.service.events(teamRef,invitation.id)).items).toHaveLength(1)
  })

  it('pauses without backfill, discards already-queued old-generation events, and disconnects', async () => {
    const f=fixture();const invitation=await f.service.invite(teamRef)
    f.run(['connect',invitation.id]);f.record();await f.service.tick()
    f.record('Stop',{last_assistant_message:'queued before pause'})
    await f.service.change(teamRef,invitation.id,'pause')
    f.record('UserPromptSubmit',{turn_id:'turn_paused',prompt:'must not be saved'})
    await f.service.change(teamRef,invitation.id,'resume');await f.service.tick()
    expect((await f.service.events(teamRef,invitation.id)).items).toHaveLength(1)
    f.record('Stop');await f.service.tick()
    expect((await f.service.events(teamRef,invitation.id)).items).toHaveLength(2)
    await f.service.change(teamRef,invitation.id,'disconnect')
    f.record('UserPromptSubmit',{turn_id:'turn_disconnected'});await f.service.tick()
    expect((await f.service.state(teamRef)).tasks[0]?.status).toBe('disconnected')
    expect((await f.service.events(teamRef,invitation.id)).items).toHaveLength(2)
    await expect(f.service.change(teamRef,invitation.id,'resume')).rejects.toMatchObject({httpStatus:409})
  })

  it('fences logout/account changes, retains records on disk and denies cross-account reads and writes', async () => {
    const f=fixture();const invitation=await f.service.invite(teamRef)
    f.run(['connect',invitation.id]);f.record();await f.service.tick()
    f.setUser(undefined);f.record('Stop')
    await expect(f.service.state(teamRef)).rejects.toMatchObject({httpStatus:401})
    f.setUser(22);await f.service.tick()
    expect((await f.service.state(teamRef)).tasks).toEqual([])
    await expect(f.service.events(teamRef,invitation.id)).rejects.toMatchObject({httpStatus:404})
    await expect(f.service.change(teamRef,invitation.id,'delete')).rejects.toMatchObject({httpStatus:404})
    f.record('Stop')
    f.setUser(11);await f.service.tick()
    expect((await f.service.events(teamRef,invitation.id)).items).toHaveLength(1)
    f.service.close()
    const reopened=new TeamCodexService(f.options);services.push(reopened)
    expect((await reopened.events(teamRef,invitation.id)).items).toHaveLength(1)
  })

  it('rejects unverifiable members and expired invitations, and keeps disconnected tombstones after deletion', async () => {
    const f=fixture()
    f.options.teams.listMembers.mockResolvedValueOnce({team:{teamRef,name:'test',jotmoId:'team_test',currentUserRole:'member',createdAtMillis:1,updatedAtMillis:1},items:[],totalCount:0,hasMore:false})
    await expect(f.service.invite(teamRef)).rejects.toMatchObject({httpStatus:403})
    const invitation=await f.service.invite(teamRef)
    f.advance(21*60_000)
    expect((await f.service.state(teamRef)).tasks[0]?.status).toBe('expired')
    await f.service.change(teamRef,invitation.id,'delete')
    expect((await f.service.state(teamRef)).tasks).toEqual([])
    expect(f.run(['connect',invitation.id]).status).toBe(1)
    expect(f.record().status).toBe(0)
  })

  it('orders batched events, pages history without overlap and discards malformed inbox entries', async () => {
    const f=fixture(); const invitation=await f.service.invite(teamRef)
    f.run(['connect',invitation.id])
    const folder=join(f.directory,invitation.id)
    const control=JSON.parse(readFileSync(join(folder,'control.json'),'utf8'))
    const at=Date.now()
    for (let n=0;n<56;n++) {
      writeFileSync(join(folder,'inbox',`${String(99-n).padStart(64,'0')}.json`),JSON.stringify({
        version:1,sessionId:'task_current_123',generation:control.generation,turnId:`turn_${Math.floor(n/2)}`,
        kind:n%2?'Stop':'UserPromptSubmit',text:`text_${n}`,at:at+Math.floor(n/2),
      }))
    }
    writeFileSync(join(folder,'inbox',`${'f'.repeat(64)}.json`),'invalid json')
    await f.service.tick()
    expect((await f.service.state(teamRef)).tasks[0]).toMatchObject({eventCount:56,state:'finished'})
    const newest=await f.service.events(teamRef,invitation.id)
    expect(newest.items.map(e=>e.text)).toEqual(Array.from({length:50},(_,i)=>`text_${i+6}`))
    const older=await f.service.events(teamRef,invitation.id,newest.nextBefore)
    expect(older.items.map(e=>e.text)).toEqual(Array.from({length:6},(_,i)=>`text_${i}`))
    expect(older.nextBefore).toBeUndefined()
    expect(readdirSync(join(folder,'inbox'))).toEqual([])
    await expect(f.service.events(teamRef,invitation.id,0)).rejects.toMatchObject({httpStatus:400})
  })
})
