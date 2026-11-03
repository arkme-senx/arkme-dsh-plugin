import {codexObjectFixture} from "./helpers/codex-object-fixture.js"
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeamCodexCloudJournal, type CloudBatch } from '../src/team-codex-cloud-journal.js'
import { TeamCodexCloud, type TeamCodexCloudPort } from '../src/team-codex-cloud.js'
import type { TeamCodexEvent, TeamCodexState, TeamCodexTask } from '../src/team-codex-contract.js'
import { ArkmePluginError } from '../src/services/service.js'

const databases: DatabaseSync[] = []
afterEach(() => { vi.unstubAllGlobals();for (const db of databases.splice(0)) db.close() })
const db = () => { const value = new DatabaseSync(':memory:'); databases.push(value); return value }
const member = { userRef: 'usr_v1_test', displayName: '我', role: 'member' as const, joinedAtMillis: 1, identityState: 'ready' as const }
const task: TeamCodexTask = { id: 'local-task', installationId: 'local-installation', title: '开发任务', projectKey: 'project-key', projectName: '项目', cwd: '/private/path', branch: 'dev', status: 'active', state: 'finished', updatedAt: 2000, eventCount: 2, member }
const events: TeamCodexEvent[] = [
  { sequence: 1, turnId: 'turn-one', kind: 'UserPromptSubmit', text: '需求', at: 1000, truncated: false },
  { sequence: 2, turnId: 'turn-one', kind: 'Stop', text: '回答', at: 2000, truncated: false },
]
const active = new Set([task.id])
function ack(batch: CloudBatch) {
  return { owner_ref: '11', task_results: batch.tasks.map(t => ({ task_id: t.task_id, status: 'saved', version: t.version })),
    event_results: batch.tasks.flatMap(t => t.events.map(e => ({ task_id: t.task_id, event_id: e.event_id, status: 'saved', version: e.version }))) }
}
function journalFixture() {
  const database = db(), journal = new TeamCodexCloudJournal(database)
  const reconcile = (items = events, tasks = [task]) => journal.reconcile(11, 'opaque-team', '101', tasks, () => items)
  reconcile()
  const batch = () => journal.batch(11, 'opaque-team', active)!
  return { database, journal, reconcile, batch }
}

it('reopens an existing local outbox without losing prompt identities or creating unstable summaries',()=>{
 const database=db()
 database.exec(`CREATE TABLE codex_cloud_sources(id TEXT PRIMARY KEY,owner INTEGER,local_team TEXT,local_source TEXT,team TEXT,name TEXT);
 CREATE TABLE codex_cloud_tasks(id TEXT PRIMARY KEY,local_id TEXT,source TEXT,payload TEXT,version INTEGER,ack INTEGER DEFAULT 0,blocked TEXT DEFAULT '');
 CREATE TABLE codex_cloud_events(id TEXT PRIMARY KEY,task TEXT,slot TEXT,payload TEXT,version INTEGER,ack INTEGER DEFAULT 0,blocked TEXT DEFAULT '');
 INSERT INTO codex_cloud_sources VALUES('source',11,'opaque-team','local-source','101','电脑');
 INSERT INTO codex_cloud_tasks VALUES('task','local-task','source','{}',1,1,'');`)
 database.prepare("INSERT INTO codex_cloud_events VALUES('event','task','turn:prompt',?,1,1,'')").run(JSON.stringify({turn_id:'turn',turn_seq:1,kind:'UserPromptSubmit',text:'保留本地原文',at:1000,truncated:false}))
 const journal=new TeamCodexCloudJournal(database),summary=journal.contentSummary('task')
 expect(summary).toMatchObject({version:1,event_count:1,latest_at:1000,state:'in_progress'})
 expect(new TeamCodexCloudJournal(database).contentSummary('task')).toEqual(summary)
 expect(database.prepare('SELECT id,payload,message_seq FROM codex_cloud_events').get()).toMatchObject({id:'event',message_seq:0})
})

describe('durable cloud upload ledger', () => {
  it('uploads title-only renames with stable IDs and a new metadata version, without resending events',()=>{
    const f=journalFixture(),first=f.batch()
    f.journal.acknowledge(first,ack(first))
    f.reconcile(events,[{...task,title:'Codex 重命名后的标题'}])
    const renamed=f.batch()
    expect(renamed.source_id).toBe(first.source_id)
    expect(renamed.tasks).toEqual([{...first.tasks[0]!,task_title:'Codex 重命名后的标题',version:2,events:[]}])
    f.reconcile(events,[{...task,title:'再次改名'}])
    f.journal.acknowledge(renamed,ack(renamed))
    expect(f.batch().tasks[0]).toMatchObject({task_id:first.tasks[0]!.task_id,task_title:'再次改名',version:3,events:[]})
    const latest=f.batch();f.journal.acknowledge(latest,ack(latest))
    f.reconcile(events,[{...task,title:'再次改名'}])
    expect(f.batch()).toBeUndefined()
  })
  it('keeps stable identity, per-turn order and allowlisted payload on retries/reopen', () => {
    const f = journalFixture(), first = f.batch()
    f.reconcile()
    expect(f.batch()).toEqual(first)
    expect(new TeamCodexCloudJournal(f.database).batch(11, 'opaque-team', active)).toEqual(first)
    expect(first.tasks[0]!.events.map(e => e.turn_seq)).toEqual([1, 1])
    expect(JSON.stringify(first)).not.toContain('/private/path')
    expect(Object.keys(first).sort()).toEqual(['expected_owner_ref','protocol_version', 'source_id', 'source_name', 'tasks', 'team_ref'])
    f.journal.acknowledge(first, ack(first))
    expect(f.batch()).toBeUndefined()
  })
  it('versions text separately, freezes original timestamp, ACKs only the sent version', () => {
    const f = journalFixture(), first = f.batch()
    f.reconcile([{ ...events[0]!, text: '更新需求', at: 9000 }, events[1]!])
    f.journal.acknowledge(first, ack(first))
    const next = f.batch()
    expect(next.tasks[0]!.version).toBe(1)
    expect(next.tasks[0]!.events).toHaveLength(1)
    expect(next.tasks[0]!.events[0]).toMatchObject({ version: 2, at: 1000, text: '更新需求', event_id: first.tasks[0]!.events[0]!.event_id })
  })
  it('partial ACK leaves missing entries pending and task conflicts do not prevent event ACK', () => {
    const f = journalFixture(), batch = f.batch(), result = ack(batch)
    result.task_results[0]!.status = 'conflict'
    result.event_results.pop()
    f.journal.acknowledge(batch, result)
    expect(f.journal.counts(11, 'opaque-team', active)).toEqual({ pending: 1, blocked: 1 })
    expect(f.batch().tasks[0]!.events.map(e => e.kind)).toEqual(['Stop'])
    const remaining = f.batch(); f.journal.acknowledge(remaining, ack(remaining))
    expect(f.journal.counts(11, 'opaque-team', active)).toEqual({ pending: 0, blocked: 1 })
  })
  it('stale and permanent rejection remain blocked; retryable rejection keeps identical payload', () => {
    const f = journalFixture(), batch = f.batch(), result = ack(batch)
    result.event_results[0] = { ...result.event_results[0]!, status: 'stale', version: 9 }
    result.event_results[1] = { ...result.event_results[1]!, status: 'rejected', version: 0, retryable: true } as typeof result.event_results[number]
    f.journal.acknowledge(batch, result)
    f.reconcile([{ ...events[0]!, text: '不覆盖冲突' }, events[1]!])
    expect(f.batch().tasks[0]!.events).toEqual([batch.tasks[0]!.events[1]])
    expect(f.journal.counts(11, 'opaque-team', active)).toEqual({ pending: 1, blocked: 1 })
  })
  it('does not ACK duplicate/wrong-owner responses or transmit ineligible tasks', () => {
    const f = journalFixture(), batch = f.batch(), result = ack(batch)
    expect(() => f.journal.acknowledge(batch, { ...result, owner_ref: '22' })).toThrow('ACCOUNT_OR_DESTINATION_MISMATCH')
    result.event_results.push(result.event_results[0]!)
    f.journal.acknowledge(batch, result)
    expect(f.batch().tasks[0]!.events).toHaveLength(1)
    expect(f.journal.batch(11, 'opaque-team', new Set())).toBeUndefined()
    expect(f.journal.batch(22, 'opaque-team', active)).toBeUndefined()
  })
  it('never rebinds an existing destination and separates accounts even with same local IDs', () => {
    const f = journalFixture(), first = f.batch()
    expect(() => f.journal.reconcile(11, 'opaque-team', '102', [task], () => events)).toThrow('ACCOUNT_OR_DESTINATION_MISMATCH')
    f.journal.reconcile(22, 'opaque-team', '101', [task], () => events)
    const second = f.journal.batch(22, 'opaque-team', active)!
    expect(second.source_id).not.toBe(first.source_id)
    expect(second.tasks[0]!.task_id).not.toBe(first.tasks[0]!.task_id)
  })
  it('bounds actual UTF-8 request bytes and total event count without splitting characters', () => {
    const f = journalFixture()
    const huge = Array.from({ length: 105 }, (_, i) => ({ ...events[0]!, sequence: i + 3, turnId: `new-${i}`, text: '😀'.repeat(70000), at: 3000 + i }))
    f.reconcile(huge)
    const batch = f.batch()
    expect(Buffer.byteLength(JSON.stringify(batch))).toBeLessThanOrEqual(1_048_576)
    expect(batch.tasks.flatMap(t => t.events).length).toBeLessThanOrEqual(100)
    for (const e of batch.tasks.flatMap(t => t.events)) { expect(Buffer.byteLength(e.text)).toBeLessThanOrEqual(256 * 1024); expect(e.text).not.toContain('\ufffd') }
  })
  it('local deletion removes pending text copies without making a cloud delete request', () => {
    const f = journalFixture()
    f.journal.forget(22, 'opaque-team', task.id)
    expect(f.batch()).toBeDefined()
    f.journal.forget(11, 'opaque-team', task.id)
    expect(f.batch()).toBeUndefined()
    expect(f.database.prepare('SELECT count(*) AS n FROM codex_cloud_events').get()).toEqual({n:0})
  })
  it('retains cloud IDs when an old single-task connection migrates to machine collection',()=>{
    const database=db(), journal=new TeamCodexCloudJournal(database)
    database.exec('CREATE TABLE codex_legacy_migrations(connection_id TEXT PRIMARY KEY,task_id TEXT NOT NULL)')
    const legacy={...task,id:'legacy-task'};delete legacy.installationId
    journal.reconcile(11,'opaque-team','101',[legacy],()=>events)
    const first=journal.mapping(11,'opaque-team','legacy-task')!
    database.prepare('INSERT INTO codex_legacy_migrations VALUES(?,?)').run('legacy-task',task.id)
    journal.reconcile(11,'opaque-team','101',[task],()=>events)
    expect(journal.mapping(11,'opaque-team',task.id)).toEqual(first)
    expect(database.prepare('SELECT count(*) AS n FROM codex_cloud_tasks').get()).toEqual({n:1})
    expect(database.prepare('SELECT count(*) AS n FROM codex_cloud_events').get()).toEqual({n:2})
  })
})

function cloudFixture(presentation: Partial<TeamCodexCloudPort> = {}) {
  let user = 11, now = 10000
  const objects=codexObjectFixture();vi.stubGlobal('fetch',objects.fetch)
  const post = vi.fn(async (_owner: number, path: string, body: Record<string, unknown>) => {
    if (path.endsWith('list-mine')) return { teams: [{ team_id: 101, jotmo_id: 'arkme_cn' }] }
    if (path.endsWith('/content/prepare')) return objects.prepare(body.descriptor as Record<string,unknown>)
    if (path.endsWith('/content/commit')) {const data=objects.body(body.descriptor as Record<string,unknown>);return {owner_ref:'11',event_results:(data.events as Record<string,unknown>[]).map(e=>({task_id:(body.descriptor as Record<string,unknown>).task_id,event_id:e.event_id,version:e.version,status:'saved'}))}}
    if (path.endsWith('/sync')) return ack(body as CloudBatch)
    return { items: [], page: body.page, has_more: false }
  })
  const selectedTeam = vi.fn(async () => ({ teamRef: 'opaque-team', name: '即我', jotmoId: 'arkme_cn', currentUserRole: 'member' as const, createdAtMillis: 1, updatedAtMillis: 1 }))
  const cloud = new TeamCodexCloud(db(), { post, selectedTeam, ...presentation } as TeamCodexCloudPort, async () => user, () => now)
  const local: TeamCodexState = { localOnly: true, self: member, installations: [], tasks: [task] }
  return { cloud, post, selectedTeam, local, objects, setUser: (value: number) => { user = value; cloud.fence() }, advance: () => { now += 61000 } }
}

describe('cloud member avatar projection', () => {
  const rows = Array.from({length:50},(_,i)=>({task_id:`11111111-1111-4111-8111-${String(i+1).padStart(12,'0')}`,
    source_id:'22222222-2222-4222-8222-222222222222',owner_ref:'22',team_ref:'101',display_name:'同事',identity_state:'ready',
    task_title:'对话',latest_at:1000,event_count:1,state:'in_progress'}))
  const prepare = (presentation: Partial<TeamCodexCloudPort>) => {
    const f=cloudFixture(presentation),original=f.post.getMockImplementation()!
    f.post.mockImplementation(async(owner,path,body)=>path.endsWith('/tasks/list')?{items:rows,page:1,has_more:false} as never:original(owner,path,body))
    return f
  }
  it('decorates an entire page through one deduplicated public-owner batch',async()=>{
    const memberAvatars=vi.fn(async()=>new Map([[22,{avatarRef:'public-avatar-for-current-viewer'}]]))
    const f=prepare({memberAvatars}),result=await f.cloud.state(11,'opaque-team',{...f.local,tasks:[]})
    expect(memberAvatars).toHaveBeenCalledExactlyOnceWith([22],expect.any(AbortSignal))
    expect(result.tasks).toHaveLength(50)
    expect(result.tasks.every(t=>t.member.avatarRef==='public-avatar-for-current-viewer')).toBe(true)
    expect(result.cloud?.status).toBe('ready')
  })
  it('keeps authorized task data readable when public avatar lookup fails',async()=>{
    const f=prepare({memberAvatars:vi.fn(async()=>{throw Error('avatar unavailable')})})
    const result=await f.cloud.state(11,'opaque-team',{...f.local,tasks:[]})
    expect(result.cloud?.status).toBe('ready');expect(result.tasks).toHaveLength(50)
    expect(result.tasks[0]?.member.avatarRef).toBeUndefined()
  })
  it('rejects a late avatar result after the account changes',async()=>{
    let entered!:()=>void,finish!:(value:Map<number,{avatarRef:string}>)=>void
    const started=new Promise<void>(resolve=>{entered=resolve})
    const f=prepare({memberAvatars:()=>{entered();return new Promise(resolve=>{finish=resolve})}})
    const pending=f.cloud.state(11,'opaque-team',{...f.local,tasks:[]})
    await started;f.setUser(22);finish(new Map([[22,{avatarRef:'old-viewer-avatar'}]]))
    await expect(pending).rejects.toThrow()
  })
  it('bounds a slow avatar lookup without dropping the conversation page',async()=>{
    vi.useFakeTimers()
    try {
      let entered!:()=>void
      const started=new Promise<void>(resolve=>{entered=resolve})
      const f=prepare({memberAvatars:(_ids,signal)=>new Promise((_resolve,reject)=>{
        entered();signal.addEventListener('abort',()=>reject(signal.reason),{once:true})
      })})
      const pending=f.cloud.state(11,'opaque-team',{...f.local,tasks:[]})
      await started;await vi.advanceTimersByTimeAsync(1500)
      const result=await pending
      expect(result.cloud?.status).toBe('ready');expect(result.tasks).toHaveLength(50)
    } finally { vi.useRealTimers() }
  })
})
describe('cloud coordinator account/team boundaries', () => {
  it('drains acknowledged batches in one trigger but stops immediately if ACK makes no progress',async()=>{
    const f=cloudFixture();await f.cloud.enable(11,'opaque-team')
    const many=Array.from({length:205},(_,i)=>({...events[0]!,sequence:i+1,turnId:`turn-${i}`,at:1000+i,localProgress:[{id:'private-progress',text:'本机过程',at:1,truncated:false}]}))
    await f.cloud.sync(11,'opaque-team',[task],()=>many)
    const uploads=f.post.mock.calls.filter(c=>c[1].endsWith('/sync'))
    expect(uploads).toHaveLength(4)
    expect(JSON.stringify(uploads)).not.toContain('本机过程');expect(f.objects.uploads.length).toBeGreaterThan(0);expect(f.objects.uploads.length).toBeLessThanOrEqual(32);expect(JSON.stringify(f.objects.uploads)).toContain('本机过程')
    f.post.mockImplementation(async()=>({owner_ref:'11',task_results:[],event_results:[]}) as never)
    f.post.mockClear()
    await f.cloud.sync(11,'opaque-team',[task],()=>[...many,{...events[0]!,turnId:'extra'}])
    expect(f.post).toHaveBeenCalledTimes(1)
  })
  it('keeps a successful list readable after an upload failed, without falsely clearing upload retries',async()=>{
    const f=cloudFixture(),original=f.post.getMockImplementation()!
    await f.cloud.enable(11,'opaque-team')
    f.post.mockImplementation(async(owner,path,body)=>{if(path.endsWith('/sync'))throw new Error('network');return original(owner,path,body)})
    await f.cloud.sync(11,'opaque-team',[task],()=>events)
    const result=await f.cloud.state(11,'opaque-team',f.local)
    expect(result.cloud).toMatchObject({status:'ready',pending:3})
    expect(result.tasks[0]?.title).toBe('开发任务')
    await f.cloud.sync(11,'opaque-team',[task],()=>events)
    expect(f.post.mock.calls.filter(c=>c[1].endsWith('/sync'))).toHaveLength(1)
  })
  it('checks only account connection status for reader-only computers',async()=>{
    const f=cloudFixture()
    f.post.mockResolvedValue({owner_ref:'11',has_connected_codex:false,first_connected_at:null} as never)
    expect(await f.cloud.connectionStatus(11)).toBe(false)
    expect(f.post).toHaveBeenCalledExactlyOnceWith(11,'/api/v1/team-codex/connection/status',{},expect.any(AbortSignal))
    expect(f.selectedTeam).not.toHaveBeenCalled()
    f.post.mockResolvedValue({owner_ref:'11',has_connected_codex:true,first_connected_at:1000} as never)
    expect(await f.cloud.connectionStatus(11)).toBe(true)
  })
  it.each(['foreign-owner','missing-time','invalid-flag'])('rejects unsafe entry evidence: %s',async kind=>{
    const f=cloudFixture()
    f.post.mockResolvedValue({owner_ref:kind==='foreign-owner'?'22':'11',has_connected_codex:kind==='invalid-flag'?'true':true,first_connected_at:kind==='missing-time'?null:1000} as never)
    await expect(f.cloud.connectionStatus(11)).rejects.toThrow()
  })
  it('resolves member identity across directory pages by public ID, never by nickname',async()=>{
    const f=cloudFixture(), original=f.post.getMockImplementation()!
    f.post.mockImplementation(async(owner,path,body)=>path.endsWith('/members/list') ? body.page_cursor
      ? {items:[{user_id:22,jotmo_id:'coworker',display_name:'同名'}],has_more:false}
      : {items:[{user_id:33,jotmo_id:'someone_else',display_name:'同名'}],has_more:true,next_page_cursor:'opaque-next'}
      : original(owner,path,body))
    expect(await f.cloud.resolveMember(11,'opaque-team','coworker')).toBe('22')
    expect(f.post).toHaveBeenLastCalledWith(11,'/api/v1/team/members/list',{team_id:101,limit:50,page_cursor:'opaque-next'},expect.any(AbortSignal))
    expect(f.post.mock.calls.every(call=>!call[1].endsWith('/sync'))).toBe(true)
  })
  it.each(['missing','ambiguous','repeated-cursor'] as const)('fails closed for %s member mappings',async kind=>{
    const f=cloudFixture(),original=f.post.getMockImplementation()!
    f.post.mockImplementation(async(owner,path,body)=>path.endsWith('/members/list')?{
      items:kind==='ambiguous'?[{user_id:22,jotmo_id:'coworker'},{user_id:33,jotmo_id:'coworker'}]:[],
      has_more:kind==='repeated-cursor',next_page_cursor:'same',
    }:original(owner,path,body))
    await expect(f.cloud.resolveMember(11,'opaque-team','coworker')).rejects.toThrow()
    expect(f.post.mock.calls.filter(call=>call[1].endsWith('/members/list')).length).toBeLessThanOrEqual(2)
  })
  it('cancels a delayed member mapping when the account changes',async()=>{
    const f=cloudFixture(),original=f.post.getMockImplementation()!
    let finish:(value:never)=>void=()=>undefined
    f.post.mockImplementation(async(owner,path,body)=>path.endsWith('/members/list')?await new Promise<never>(resolve=>{finish=resolve}):original(owner,path,body))
    const pending=f.cloud.resolveMember(11,'opaque-team','coworker')
    const checked=expect(pending).rejects.toThrow()
    await vi.waitFor(()=>expect(f.post.mock.calls.some(call=>call[1].endsWith('/members/list'))).toBe(true))
    f.setUser(22);finish({items:[{user_id:22,jotmo_id:'coworker'}],has_more:false} as never)
    await checked
  })
  it('resolves the opaque selected team to the official numeric destination and uploads only eligible records', async () => {
    const f = cloudFixture()
    await f.cloud.enable(11,'opaque-team')
    await f.cloud.sync(11, 'opaque-team', [task, { ...task, id: 'excluded', excluded: true }, { ...task, id: 'paused', status: 'paused' }, { ...task, id: 'project', projectExcluded: true }], () => events)
    const sent = f.post.mock.calls.find(c => c[1].endsWith('/sync'))![2] as CloudBatch
    expect(sent).toMatchObject({ expected_owner_ref: '11', team_ref: '101' })
    expect(sent.tasks).toHaveLength(1)
    expect((await f.cloud.state(11, 'opaque-team', f.local)).cloud).toMatchObject({ status: 'ready', pending: 0, blocked: 0 })
  })
  it('opens an ordinary authorized team using its exact public identity, never its display name', async () => {
    const f = cloudFixture()
    f.selectedTeam.mockResolvedValue({ ...(await f.selectedTeam()), jotmoId: 'ordinary_team', name: '即我' })
    const original=f.post.getMockImplementation()!
    f.post.mockImplementation(async(owner,path,body)=>path.endsWith('list-mine')
      ? {teams:[{team_id:101,jotmo_id:'arkme_cn',name:'即我'},{team_id:202,jotmo_id:'ordinary_team',name:'即我'}]}
      : original(owner,path,body))
    await f.cloud.enable(11,'opaque-team')
    await f.cloud.sync(11,'opaque-team',[task],()=>events)
    expect(f.post.mock.calls.find(c=>c[1].endsWith('/sync'))?.[2]).toMatchObject({team_ref:'202',expected_owner_ref:'11'})
    expect((await f.cloud.state(11,'opaque-team',f.local)).cloud).toMatchObject({status:'ready',uploadEnabled:true})
    expect(f.post.mock.calls.every(c=>!c[1].includes('/create')&&!c[1].includes('/join'))).toBe(true)
  })
  it.each(['missing','duplicate','invalid-id'] as const)('denies a %s selected team without uploading or granting consent',async kind=>{
    const f=cloudFixture(),original=f.post.getMockImplementation()!
    f.selectedTeam.mockResolvedValue({...(await f.selectedTeam()),jotmoId:'ordinary_team'})
    f.post.mockImplementation(async(owner,path,body)=>path.endsWith('list-mine')?{teams:kind==='missing'
      ? [{team_id:101,jotmo_id:'arkme_cn'}]
      : kind==='duplicate'?[{team_id:202,jotmo_id:'ordinary_team'},{team_id:203,jotmo_id:'ordinary_team'}]
      : [{team_id:'unsafe',jotmo_id:'ordinary_team'}]}:original(owner,path,body))
    await expect(f.cloud.enable(11,'opaque-team')).rejects.toMatchObject({code:'TEAM_FORBIDDEN'})
    expect((await f.cloud.state(11,'opaque-team',f.local)).cloud).toMatchObject({status:'blocked',uploadEnabled:false})
    await f.cloud.sync(11,'opaque-team',[task],()=>events)
    expect(f.post.mock.calls.some(c=>c[1].endsWith('/sync'))).toBe(false)
  })
  it('preserves the original numeric binding across team rename and rejects handle reuse',async()=>{
    const f=cloudFixture(),original=f.post.getMockImplementation()!
    await f.cloud.enable(11,'opaque-team')
    await f.cloud.sync(11,'opaque-team',[task],()=>events)
    f.selectedTeam.mockResolvedValue({...(await f.selectedTeam()),jotmoId:'renamed_team'})
    f.post.mockImplementation(async(owner,path,body)=>path.endsWith('list-mine')?{teams:[{team_id:101,jotmo_id:'renamed_team'}]}:original(owner,path,body))
    f.advance();await f.cloud.enable(11,'opaque-team')
    expect((await f.cloud.state(11,'opaque-team',f.local)).cloud?.uploadEnabled).toBe(true)
    f.post.mockImplementation(async(owner,path,body)=>path.endsWith('list-mine')?{teams:[{team_id:202,jotmo_id:'renamed_team'}]}:original(owner,path,body))
    f.advance()
    await expect(f.cloud.enable(11,'opaque-team')).rejects.toMatchObject({code:'ACCOUNT_OR_DESTINATION_MISMATCH'})
    f.post.mockClear()
    await f.cloud.sync(11,'opaque-team',[task],()=>events)
    expect(f.post.mock.calls.some(c=>c[1].endsWith('/sync'))).toBe(false)
  })
  it('keeps upload consent and destination separate when one account belongs to two teams',async()=>{
    const f=cloudFixture(),base=await f.selectedTeam(),original=f.post.getMockImplementation()!
    f.selectedTeam.mockImplementation(async(ref='opaque-team')=>({...base,teamRef:ref,jotmoId:ref==='opaque-team'?'arkme_cn':'ordinary_team'}))
    f.post.mockImplementation(async(owner,path,body)=>path.endsWith('list-mine')?{teams:[{team_id:101,jotmo_id:'arkme_cn'},{team_id:202,jotmo_id:'ordinary_team'}]}:original(owner,path,body))
    await f.cloud.enable(11,'opaque-team')
    expect((await f.cloud.state(11,'second-team',{...f.local,tasks:[]})).cloud).toMatchObject({uploadEnabled:false,status:'ready'})
    f.post.mockClear()
    await f.cloud.sync(11,'second-team',[{...task,id:'second-task'}],()=>events)
    expect(f.post).not.toHaveBeenCalled()
    await f.cloud.enable(11,'second-team')
    await f.cloud.sync(11,'second-team',[{...task,id:'second-task'}],()=>events)
    await f.cloud.sync(11,'opaque-team',[task],()=>events)
    const sent=f.post.mock.calls.filter(c=>c[1].endsWith('/sync')).map(c=>c[2] as CloudBatch)
    expect(sent.map(batch=>batch.team_ref)).toEqual(['202','101'])
    expect(sent[0]!.source_id).not.toBe(sent[1]!.source_id)
    f.setUser(22);f.post.mockClear()
    await f.cloud.sync(22,'second-team',[task],()=>events)
    expect(f.post).not.toHaveBeenCalled()
  })
  it('keeps pending payload unchanged after network loss, then retries and ACKs', async () => {
    const f = cloudFixture(), original = f.post.getMockImplementation()!
    await f.cloud.enable(11,'opaque-team')
    f.post.mockImplementation(async (owner, path, body) => { if (path.endsWith('/sync')) throw new Error('network'); return original(owner, path, body) })
    await f.cloud.sync(11, 'opaque-team', [task], () => events)
    const first = f.post.mock.calls.find(c => c[1].endsWith('/sync'))![2]
    f.post.mockImplementation(original); f.advance()
    await f.cloud.sync(11, 'opaque-team', [task], () => events)
    expect(f.post.mock.calls.filter(c => c[1].endsWith('/sync')).at(-1)![2]).toEqual(first)
  })
  it('fences a delayed upload response on account switch without ACK or replacement identity', async () => {
    const f = cloudFixture(), original = f.post.getMockImplementation()!
    await f.cloud.enable(11,'opaque-team')
    let finish: (v: unknown) => void = () => undefined, submitted: CloudBatch | undefined
    f.post.mockImplementation(async (owner, path, body) => {
      if (path.endsWith('/sync')) { submitted = body as CloudBatch; return await new Promise(resolve => { finish = resolve }) as never }
      return original(owner, path, body)
    })
    const pending = f.cloud.sync(11, 'opaque-team', [task], () => events)
    await vi.waitFor(() => expect(submitted).toBeDefined())
    f.setUser(22); finish(ack(submitted!)); await pending
    expect(f.cloud.journal.counts(11, 'opaque-team', active).pending).toBe(3)
    expect(f.cloud.journal.counts(22, 'opaque-team', active).pending).toBe(0)
  })
  it('cross-device reads need no installation and respect member/page filters', async () => {
    const f = cloudFixture(), original = f.post.getMockImplementation()!
    f.post.mockImplementation(async (owner, path, body) => path.endsWith('/tasks/list') ? {
      items: [{ task_id: '22222222-2222-4222-8222-222222222222', source_id: '11111111-1111-4111-8111-111111111111', owner_ref: '22', team_ref: '101', display_name: '同事', identity_state: 'ready', project_name: '项目', project_key: 'key', task_title: '云任务', source_name: '另一台电脑', event_count: 2, latest_at: 2000, state: 'turn_ended' }], page: body.page, has_more: true,next_cursor:'next-page',
    } : original(owner, path, body))
    await f.cloud.state(11,'opaque-team',{...f.local,tasks:[]},1,'22')
    const result = await f.cloud.state(11, 'opaque-team', { ...f.local, tasks: [] }, 2, '22')
    expect(result.tasks[0]).toMatchObject({ title: '云任务', state: 'finished', cloud: { remote: true, ownerRef: '22' }, member: { displayName: '同事' } })
    expect(result.tasks[0]!.queue).toBeUndefined()
    expect(result.cloud).toMatchObject({ page: 2, hasMore: true })
    expect(f.post.mock.calls.at(-1)![2]).toEqual({protocol_version:2,view: 'team', team_ref: '101', page: 2,cursor:'next-page', limit: 50, member_ref: '22' })
  })
  it('permission loss drops cloud rows and preserves only local records', async () => {
    const f = cloudFixture()
    f.post.mockRejectedValue(new ArkmePluginError('TEAM_FORBIDDEN', 'no access', false, 403))
    const result = await f.cloud.state(11, 'opaque-team', f.local)
    expect(result.tasks).toEqual([task]); expect(result.cloud?.status).toBe('blocked')
    expect(f.post.mock.calls.every(c => !c[1].endsWith('/sync'))).toBe(true)
  })
  it('reads events with server cursors and preserves independent event versions', async () => {
    const f = cloudFixture(), original = f.post.getMockImplementation()!
    f.post.mockImplementation(async (owner,path,body)=>path.endsWith('/content/list')?f.objects.page(String(body.source_id),String(body.task_id),[
      {event_id:'event',version:2,turn_id:'turn',turn_seq:3,kind:'Stop',text:'只有回答',at:1000,truncated:true}
    ],{has_more:true,next_cursor:'opaque_cursor'}):original(owner,path,body))
    const result = await f.cloud.events(11, 'opaque-team', '22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111')
    expect(result).toMatchObject({ nextCursor: 'opaque_cursor', items: [{ eventId: 'event', version: 2, text: '只有回答', sequence: 15, truncated: true }] })
  })
  it('reads the source empty-state summary without treating it as an incomplete response',async()=>{
    const f=cloudFixture(),original=f.post.getMockImplementation()!
    f.post.mockImplementation(async(owner,path,body)=>{
      if(!path.endsWith('/content/list'))return original(owner,path,body)
      const page=f.objects.page(String(body.source_id),String(body.task_id),[])
      return {...page,task_summary:{...page.task_summary,state:'empty'}}
    })
    const result=await f.cloud.events(11,'opaque-team','22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111')
    expect(result.taskSummary).toMatchObject({state:'waiting',eventCount:0})
  })
  it('sends source-scoped project filters and never mixes unrelated local tasks', async () => {
    const f = cloudFixture()
    await f.cloud.enable(11,'opaque-team')
    await f.cloud.sync(11, 'opaque-team', [task], () => events)
    const source = f.cloud.journal.mapping(11, 'opaque-team', task.id)!.sourceId
    const result = await f.cloud.state(11, 'opaque-team', f.local, 1, '', source, 'another-project')
    expect(result.tasks).toEqual([])
    expect(f.post.mock.calls.at(-1)![2]).toMatchObject({source_id:source,project_key:'another-project'})
    await expect(f.cloud.state(11, 'opaque-team', f.local, 1, '', '', 'project')).rejects.toThrow('云端筛选参数无效')
  })
  it('requires explicit per-account consent and stopping uploads retains local collection',async()=>{
    const f=cloudFixture()
    await f.cloud.sync(11,'opaque-team',[task],()=>events)
    expect(f.post).not.toHaveBeenCalled()
    await f.cloud.enable(11,'opaque-team')
    await f.cloud.sync(11,'opaque-team',[task],()=>events)
    expect(f.post.mock.calls.some(c=>c[1].endsWith('/sync'))).toBe(true)
    f.cloud.disable(11,'opaque-team');f.post.mockClear()
    await f.cloud.sync(11,'opaque-team',[task],()=>[{...events[0]!,text:'保留本地'}])
    expect(f.post).not.toHaveBeenCalled()
    f.setUser(22)
    await f.cloud.sync(22,'opaque-team',[task],()=>events)
    expect(f.post).not.toHaveBeenCalled()
  })
  it('never uploads a session with ambiguous account ownership',async()=>{
    const f=cloudFixture();await f.cloud.enable(11,'opaque-team')
    await f.cloud.sync(11,'opaque-team',[{...task,cloudBlocked:true}],()=>events)
    expect(f.post.mock.calls.some(c=>c[1].endsWith('/sync'))).toBe(false)
    const result=await f.cloud.state(11,'opaque-team',{...f.local,tasks:[{...task,cloudBlocked:true}]})
    expect(result.cloud).toMatchObject({blocked:1,message:'部分任务存在跨账号归属冲突，仅保留在本机，未继续上传。'})
  })
})

it('requires an independent classification ACK and versions background repair without sending historical text',()=>{
 const f=journalFixture()
 f.reconcile(events,[{...task,classification:{version:1,kind:'user',evidence:'native-persistent-root'}}])
 const metadata=f.batch();f.journal.acknowledge(metadata,ack(metadata))
 const classification=f.journal.classificationBatch(11,'opaque-team')!
 expect(classification.tasks[0]).toMatchObject({events:[],classification:{version:1,kind:'user'}})
 expect(f.journal.acknowledgeClassifications(classification,ack(classification))).toBe(0)
 expect(f.journal.classificationBatch(11,'opaque-team')).toEqual(classification)
 const response={owner_ref:'11',task_results:classification.tasks.map(t=>({task_id:t.task_id,status:'unchanged',version:t.version,classification_result:{status:'saved',version:1}}))}
 expect(f.journal.acknowledgeClassifications(classification,response)).toBe(1)
 expect(f.journal.classificationBatch(11,'opaque-team')).toBeUndefined()
 f.database.exec(`CREATE TABLE codex_tasks(id TEXT,installation_id TEXT,session_id TEXT);
 CREATE TABLE codex_session_visibility(installation_id TEXT,session_id TEXT,visibility TEXT);
 INSERT INTO codex_tasks VALUES('local-task','installation','native-session');
 INSERT INTO codex_session_visibility VALUES('installation','native-session','internal');`)
 const repair=f.journal.classificationBatch(11,'opaque-team')!
 expect(repair.tasks[0]).toMatchObject({version:1,events:[],classification:{version:2,kind:'background'}})
 expect(f.journal.acknowledgeClassifications(classification,response)).toBe(1)
 expect(f.journal.classificationBatch(11,'opaque-team')).toEqual(repair)
 expect(f.journal.classificationBatch(22,'opaque-team')).toBeUndefined()
})


it('reads the same canonical progress on the source device with tuple pagination and late-window reload',()=>{
 const f=journalFixture()
 const progress=Array.from({length:80},(_,i)=>({id:'native-'+i,text:'step '+i,at:1100+i,truncated:false,sourceSequence:100+i*10}))
 f.reconcile([{...events[0]!,localProgress:progress},events[1]!])
 const newest=f.journal.readPage(11,'opaque-team',task.id)!
 expect(newest.items).toHaveLength(50);expect(newest.items.at(-1)?.kind).toBe('Stop')
 const older=f.journal.readPage(11,'opaque-team',task.id,newest.nextCursor)!
 expect(older.items).toHaveLength(32);expect(older.items[0]?.kind).toBe('UserPromptSubmit')
 expect(new Set([...older.items,...newest.items].map(e=>e.eventId)).size).toBe(82)
 const first=newest.items[0]!.cursor!,last=newest.items.at(-1)!.cursor!
 f.reconcile([{...events[0]!,localProgress:[...progress,{id:'late-source-record',text:'late',at:1100,truncated:false,sourceSequence:455}]},events[1]!])
 const window=f.journal.readPage(11,'opaque-team',task.id,'',{from:first,through:last})!
 expect(window.items.some(e=>e.text==='late')).toBe(true)
 expect(window.items.find(e=>e.text==='late')?.messageSequence).toBe(455)
 expect(f.journal.readPage(22,'opaque-team',task.id)).toBeUndefined()
 expect(()=>f.journal.readPage(11,'opaque-team',task.id,'lc1_invalid')).toThrow()
})

it('checks the account again after private object downloads before exposing text',async()=>{
 let owner=11;const objects=codexObjectFixture(),source='11111111-1111-4111-8111-111111111111',task='22222222-2222-4222-8222-222222222222'
 const wire=objects.page(source,task,[{event_id:'input',version:1,turn_id:'turn',turn_seq:1,kind:'UserPromptSubmit',text:'private',at:1000,truncated:false}])
 const cloud=new TeamCodexCloud(db(),{post:async()=>wire,selectedTeam:async()=>{throw Error('personal read needs no team')}} as never,async()=>owner)
 vi.stubGlobal('fetch',async(url:URL|string|Request,input?:RequestInit)=>{owner=22;return objects.fetch(url,input)})
 try{await expect(cloud.events(11,'self',task,source)).rejects.toMatchObject({code:'ACCOUNT_OR_DESTINATION_MISMATCH'})}finally{cloud.fence()}
})

it('reconciles changed native classifications in bounded batches without rewriting accepted facts',()=>{
 const database=db(),journal=new TeamCodexCloudJournal(database)
 database.exec(`CREATE TABLE codex_tasks(id TEXT PRIMARY KEY,installation_id TEXT,session_id TEXT);
 CREATE TABLE codex_session_visibility(installation_id TEXT,session_id TEXT,visibility TEXT);`)
 const tasks=Array.from({length:350},(_,i)=>({...task,id:'native-'+i}))
 journal.reconcile(11,'opaque-team','101',tasks,()=>[])
 for(const item of tasks){database.prepare('INSERT INTO codex_tasks VALUES(?,?,?)').run(item.id,'installation',item.id);database.prepare('INSERT INTO codex_session_visibility VALUES(?,?,?)').run('installation',item.id,'user')}
 let total=0
 for(let round=0;round<4;round++){
  const batch=journal.classificationBatch(11,'opaque-team')!;expect(batch.tasks.length).toBeLessThanOrEqual(100);total+=batch.tasks.length
  journal.acknowledgeClassifications(batch,{owner_ref:'11',task_results:batch.tasks.map(task=>({task_id:task.task_id,classification_result:{status:'saved',version:task.classification!.version}}))})
 }
 expect(total).toBe(350)
 const before=database.prepare('SELECT total_changes() n').get()!.n
 expect(journal.classificationBatch(11,'opaque-team')).toBeUndefined()
 expect(database.prepare('SELECT total_changes() n').get()!.n).toBe(before)
})

it('does not convert a cancelled task read into an offline fallback or retry state',async()=>{
 const database=db(),controller=new AbortController();let finish!:(value:unknown)=>void
 const post=vi.fn(async(_owner:number,path:string)=>path.endsWith('tasks/list')?new Promise(resolve=>{finish=resolve}):{teams:[]})
 const cloud=new TeamCodexCloud(database,{post,selectedTeam:async()=>({} as never)},async()=>11)
 try{
  const reading=cloud.state(11,'self',{localOnly:true,self:null,installations:[],tasks:[]},1,'','','',{},controller.signal)
  await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));controller.abort();finish({items:[],page:1,has_more:false})
  await expect(reading).rejects.toMatchObject({name:'AbortError'})
  expect((cloud as any).failures.size).toBe(0)
 }finally{cloud.fence()}
})


it('keeps steering input identity and source order separate from the root prompt and assistant replies',()=>{
 const f=journalFixture()
 const input={...events[0]!,eventId:'steer-input',messageSequence:105,text:'追加需求',at:1101}
 const progress={...events[0]!,eventId:'public-progress',kind:'Progress' as const,messageSequence:100,text:'过程',at:1100}
 f.reconcile([events[0]!,progress,input,events[1]!])
 const rows=f.journal.readPage(11,'opaque-team',task.id)!.items
 expect(rows.map(e=>[e.kind,e.text,e.messageSequence])).toEqual([['UserPromptSubmit','需求',0],['Progress','过程',100],['UserPromptSubmit','追加需求',105],['Stop','回答',0]])
 const batch=f.batch(),steer=batch.tasks[0]!.events.find(e=>e.message_seq===105)!
 const block=f.journal.contentBlock(batch.tasks[0]!.task_id,steer)
 expect(block.map(e=>e.kind)).toEqual(['UserPromptSubmit'])
 expect(steer.turn_id).toBe(batch.tasks[0]!.events[0]!.turn_id)
 f.journal.acknowledge(batch,ack(batch));f.reconcile([events[0]!,progress,input,events[1]!])
 expect(f.batch()).toBeUndefined()
})
