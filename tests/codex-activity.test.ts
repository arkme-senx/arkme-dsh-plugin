import { expect,it,vi } from 'vitest'
import type { TeamCodexState,TeamCodexTask } from '../src/team-codex-contract.js'
import { readCodexActivity,codexActivityPresentation } from '../src/client/redesign/contacts/codex-activity.js'
import { codexTaskStatus,mergeCodexActivityTasks } from '../src/client/redesign/contacts/codex-task-status.js'

const now = 100_000
const self = {userRef:'self',displayName:'Me',role:'member' as const,joinedAtMillis:1}
const teams = [{teamRef:'a',name:'A',jotmoId:'a'},{teamRef:'b',name:'B',jotmoId:'b'}]
const task = (id:string,patch:Partial<TeamCodexTask>={}):TeamCodexTask => ({id,title:id,member:self,status:'active',state:'working',updatedAt:1,eventCount:1,...patch})
const page = (tasks:TeamCodexTask[],more=false):TeamCodexState => ({self,localOnly:false,installations:[],tasks,cloud:{status:'ready',pending:0,blocked:0,page:1,hasMore:more}})
const signal = () => new AbortController().signal

it('counts later pages, merges repeated ids by latest event, and ignores other members',async()=>{
  const read = vi.fn(async(_team:string,p:number)=>p===1?page([task('same'),task('old',{state:'finished'})],true):page([
    task('same',{state:'finished',updatedAt:3}),task('new'),task('colleague',{member:{...self,userRef:'other'}}),
  ]))
  const result = await readCodexActivity(teams.slice(0,1),'11',read,signal())
  expect(read.mock.calls.map(c=>c[1])).toEqual([1,2])
  expect(result.complete).toBe(true)
  expect(result.tasks.map(t=>t.id).sort()).toEqual(['new','old','same'])
  expect(codexActivityPresentation(result).task?.id).toBe('new')
  expect(codexActivityPresentation(result).count).toBe(1)
})
it('deduplicates a shared cloud identity across teams, but not different tasks with identical names',async()=>{
  const shared = task('local',{title:'Same title',cloud:{ownerRef:'11',sourceId:'device',taskId:'cloud-id',sourceName:'Laptop',remote:false}})
  const result = await readCodexActivity(teams,'11',async ref=>page(ref==='a'?[shared]:[
    {...shared,id:'remote-view'},task('different',{title:'Same title'}),
  ]),signal())
  expect(result.tasks).toHaveLength(2)
  expect(codexActivityPresentation(result).count).toBe(2)
})
it.each(['offline','blocked','reviewing','throw'] as const)('never presents an incomplete %s scan as an exact zero or total',async failure=>{
  const result = await readCodexActivity(teams,'11',async ref=>{
    if(ref==='a')return page([task('working')])
    if(failure==='throw')throw Error('offline')
    const value=page([])
    value.cloud=failure==='reviewing'?{...value.cloud!,reviewingTasks:1}:{...value.cloud!,status:failure}
    return value
  },signal())
  expect(result.complete).toBe(false)
  expect(codexActivityPresentation(result)).toEqual({kind:'updating'})
})
it('finishes local-only sources in one page and excludes paused/excluded tasks from running',async()=>{
  const read=vi.fn(async()=>({...page([task('paused',{status:'paused'}),task('excluded',{excluded:true})],true),localOnly:true}))
  const result=await readCodexActivity(teams.slice(0,1),'11',read,signal())
  expect(read).toHaveBeenCalledTimes(1)
  expect(codexActivityPresentation(result).kind).toBe('idle')
})
it('bounds pagination and retains an incomplete status when a server never ends',async()=>{
  const read=vi.fn(async()=>page([task('repeated')],true))
  const result=await readCodexActivity(teams.slice(0,1),'11',read,signal())
  expect(read).toHaveBeenCalledTimes(100)
  expect(result.complete).toBe(false)
})
it('aborts old-account work without publishing a partial result',async()=>{
  const controller=new AbortController()
  await expect(readCodexActivity(teams,'11',async()=>{controller.abort();return page([])},controller.signal)).rejects.toThrow()
})
it('counts a verified online cloud mirror, but not stale, paused, buffered, or unverified sources',()=>{
  const cloud={taskId:'c',sourceId:'s',sourceName:'Laptop',ownerRef:'11',remote:true}
  expect(codexTaskStatus(task('one',{cloud}),now)).toBe('unknown')
  const captureHealth={status:'online' as const,checkedAt:now,lastReceivedAt:1}
  expect(codexTaskStatus(task('one',{cloud,captureHealth}),now)).toBe('running')
  expect(codexTaskStatus(task('one',{cloud,captureHealth}),now+30_000)).toBe('unknown')
  for(const status of ['offline','buffering','paused'] as const) expect(codexTaskStatus(task('one',{captureHealth:{...captureHealth,status}}),now)).toBe('unknown')
  expect(codexTaskStatus(task('one',{state:'interrupted',cloud}),now)).toBe('interrupted')
  expect(codexTaskStatus(task('one',{state:'finished',cloud}),now)).toBe('finished')
})
it('shows recent finished title only after known running work is gone; stale/unknown never becomes completed',()=>{
  const snapshot={complete:true,checkedAt:now,tasks:mergeCodexActivityTasks([task('old',{state:'finished'}),task('recent',{state:'finished',updatedAt:2})])}
  expect(codexActivityPresentation(snapshot,now).task?.id).toBe('recent')
  expect(codexActivityPresentation(snapshot,now+30_000).kind).toBe('updating')
  expect(codexActivityPresentation({...snapshot,tasks:[task('bad',{captureHealth:{status:'offline',checkedAt:now,lastReceivedAt:1}}),...snapshot.tasks]},now).kind).toBe('unknown')
})
