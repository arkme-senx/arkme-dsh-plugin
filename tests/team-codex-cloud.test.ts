import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeamCodexCloudJournal, type CloudBatch } from '../src/team-codex-cloud-journal.js'
import { TeamCodexCloud, type TeamCodexCloudPort } from '../src/team-codex-cloud.js'
import type { TeamCodexEvent, TeamCodexState, TeamCodexTask } from '../src/team-codex-contract.js'
import { ArkmePluginError } from '../src/services/service.js'

const databases: DatabaseSync[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })
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
    expect(Object.keys(first).sort()).toEqual(['expected_owner_ref', 'source_id', 'source_name', 'tasks', 'team_ref'])
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

function cloudFixture() {
  let user = 11, now = 10000
  const post = vi.fn(async (_owner: number, path: string, body: Record<string, unknown>) => {
    if (path.endsWith('list-mine')) return { teams: [{ team_id: 101, jotmo_id: 'arkme_cn' }] }
    if (path.endsWith('/sync')) return ack(body as CloudBatch)
    return { items: [], page: body.page, has_more: false }
  })
  const selectedTeam = vi.fn(async () => ({ teamRef: 'opaque-team', name: '即我', jotmoId: 'arkme_cn', currentUserRole: 'member' as const, createdAtMillis: 1, updatedAtMillis: 1 }))
  const cloud = new TeamCodexCloud(db(), { post, selectedTeam } as TeamCodexCloudPort, async () => user, () => now)
  const local: TeamCodexState = { localOnly: true, self: member, installations: [], tasks: [task] }
  return { cloud, post, selectedTeam, local, setUser: (value: number) => { user = value; cloud.fence() }, advance: () => { now += 61000 } }
}
describe('cloud coordinator account/team boundaries', () => {
  it('checks only the authenticated self view for reader-only computers',async()=>{
    const f=cloudFixture()
    expect(await f.cloud.hasPersonalTasks(11)).toBe(false)
    expect(f.post).toHaveBeenCalledExactlyOnceWith(11,'/api/v1/team-codex/tasks/list',{view:'self',page:1,limit:1},expect.any(AbortSignal))
    expect(f.selectedTeam).not.toHaveBeenCalled()
    f.post.mockResolvedValue({items:[{task_id:'22222222-2222-4222-8222-222222222222',source_id:'11111111-1111-4111-8111-111111111111',owner_ref:'11',team_ref:'101'}],page:1,has_more:true})
    expect(await f.cloud.hasPersonalTasks(11)).toBe(true)
  })
  it.each(['foreign-owner','invalid-source','missing-page','empty-more'])('rejects unsafe entry evidence: %s',async kind=>{
    const f=cloudFixture()
    f.post.mockResolvedValue({items:kind==='empty-more'?[]:[{task_id:'22222222-2222-4222-8222-222222222222',source_id:kind==='invalid-source'?'bad':'11111111-1111-4111-8111-111111111111',owner_ref:kind==='foreign-owner'?'22':'11',team_ref:'101'}],page:kind==='missing-page'?undefined:1,has_more:kind==='empty-more'})
    await expect(f.cloud.hasPersonalTasks(11)).rejects.toThrow()
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
  it('never uploads an unrelated team or creates/joins a missing team', async () => {
    const f = cloudFixture()
    f.selectedTeam.mockResolvedValue({ ...(await f.selectedTeam()), jotmoId: 'other_team' })
    await f.cloud.sync(11, 'opaque-team', [task], () => events)
    expect(f.post).not.toHaveBeenCalled()
    expect((await f.cloud.state(11, 'opaque-team', f.local)).cloud?.status).toBe('unsupported')
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
      items: [{ task_id: '22222222-2222-4222-8222-222222222222', source_id: '11111111-1111-4111-8111-111111111111', owner_ref: '22', team_ref: '101', display_name: '同事', identity_state: 'ready', project_name: '项目', project_key: 'key', task_title: '云任务', source_name: '另一台电脑', event_count: 2, latest_at: 2000, state: 'turn_ended' }], page: body.page, has_more: true,
    } : original(owner, path, body))
    const result = await f.cloud.state(11, 'opaque-team', { ...f.local, tasks: [] }, 2, '22')
    expect(result.tasks[0]).toMatchObject({ title: '云任务', state: 'finished', cloud: { remote: true, ownerRef: '22' }, member: { displayName: '同事' } })
    expect(result.tasks[0]!.queue).toBeUndefined()
    expect(result.cloud).toMatchObject({ page: 2, hasMore: true })
    expect(f.post.mock.calls.at(-1)![2]).toEqual({ view: 'team', team_ref: '101', page: 2, limit: 50, member_ref: '22' })
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
    f.post.mockImplementation(async (owner, path, body) => path.endsWith('/events/list') ? {
      items: [{ event_id: 'event', version: 2, turn_id: 'turn', turn_seq: 3, kind: 'Stop', text: '只有回答', at: 1000, truncated: true }], has_more: true, next_cursor: 'opaque_cursor',
    } : original(owner, path, body))
    const result = await f.cloud.events(11, 'opaque-team', '22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111')
    expect(result).toMatchObject({ nextCursor: 'opaque_cursor', items: [{ eventId: 'event', version: 2, text: '只有回答', sequence: 11, truncated: true }] })
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
