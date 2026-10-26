import { act,create,type ReactTestRenderer,type ReactTestInstance } from 'react-test-renderer'
import { afterEach,beforeEach,expect,it,vi } from 'vitest'
import { CodexActivityPreview,CodexActivityLabel } from '../src/client/redesign/contacts/CodexActivityPreview.js'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'

const api=vi.hoisted(()=>vi.fn())
vi.mock('../src/client/api.js',()=>({callArkme:api}))
const text=(node:ReactTestInstance):string=>node.children.map(c=>typeof c==='string'?c:text(c)).join('')
const self={userRef:'self',displayName:'Me',role:'member',joinedAtMillis:1}
const task=(id:string,state='working')=>({id,title:id,member:self,status:'active',state,updatedAt:Date.now(),eventCount:1})
let renderer:ReactTestRenderer|undefined
let tasks:ReturnType<typeof task>[]=[]
beforeEach(()=>{
  vi.useFakeTimers();api.mockReset();tasks=[task('正在开发')]
  api.mockImplementation(async op=>op==='team.list'?{items:[{teamRef:'team',name:'Team',jotmoId:'team'}],hasMore:false}:
    {self,localOnly:true,installations:[],tasks})
})
afterEach(()=>{act(()=>renderer?.unmount());renderer=undefined;vi.useRealTimers();vi.unstubAllGlobals()})
it('updates in the directory without an open Codex reader, using DSH native running and done icons',async()=>{
  await act(async()=>{renderer=create(<CodexActivityPreview accountKey="prod:11" userId={11} active/>)} )
  expect(text(renderer!.root)).toBe('正在开发')
  expect(renderer!.root.findByType(StateDot).props.state).toBe('ongoing')
  tasks=[task('任务 A'),task('任务 B')]
  await act(async()=>{await vi.advanceTimersByTimeAsync(10_000)})
  expect(text(renderer!.root)).toBe('2 个任务进行中')
  tasks=[task('任务 B','finished')]
  await act(async()=>{await vi.advanceTimersByTimeAsync(10_000)})
  expect(text(renderer!.root)).toBe('任务 B')
  expect(renderer!.root.findByType(StateDot).props.state).toBe('done')
})
it('does not flash the previous account or accept a late aborted response',async()=>{
  await act(async()=>{renderer=create(<CodexActivityPreview accountKey="prod:11" userId={11} active/>)} )
  let finish!:(value:unknown)=>void
  api.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
  await act(async()=>{await vi.advanceTimersByTimeAsync(10_000)})
  tasks=[]
  await act(async()=>{renderer!.update(<CodexActivityPreview accountKey="prod:22" userId={22} active/>);finish({items:[{teamRef:'old-team'}],hasMore:false})})
  expect(text(renderer!.root)).toBe('我的任务与对话')
  expect(api.mock.calls.some(c=>c[1]?.teamRef==='old-team')).toBe(false)
})
it('reuses only terminal history pages and lets a fresh reactivated task supersede cached history',async()=>{
  let resumed=false
  const old=task('已结束任务','finished')
  api.mockImplementation(async(op,params)=>op==='team.list'?{items:[{teamRef:'team',name:'Team',jotmoId:'team'}],hasMore:false}:
    {self,localOnly:false,installations:[],tasks:params.page===1?[task('正在开发'),...(resumed?[task('已结束任务')]:[])]:[old],
      cloud:{status:'ready',pending:0,blocked:0,page:params.page,hasMore:params.page===1}})
  await act(async()=>{renderer=create(<CodexActivityPreview accountKey="prod:11" userId={11} active/>)} )
  expect(text(renderer!.root)).toBe('正在开发')
  resumed=true
  await act(async()=>{await vi.advanceTimersByTimeAsync(10_000)})
  expect(text(renderer!.root)).toBe('2 个任务进行中')
  expect(api.mock.calls.filter(c=>c[0]==='team.codex.state'&&c[1].page===2)).toHaveLength(1)
  await act(async()=>{await vi.advanceTimersByTimeAsync(20_000)})
  expect(api.mock.calls.filter(c=>c[0]==='team.codex.state'&&c[1].page===2)).toHaveLength(2)
})
it('retains no false running animation on failed refresh and suspends hidden/background polling',async()=>{
  vi.stubGlobal('document',{hidden:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})
  await act(async()=>{renderer=create(<CodexActivityPreview accountKey="prod:11" userId={11} active/>)} )
  api.mockRejectedValue(Error('offline'))
  await act(async()=>{await vi.advanceTimersByTimeAsync(10_000)})
  expect(text(renderer!.root)).toBe('状态更新中…')
  expect(renderer!.root.findAllByType(StateDot)).toHaveLength(0)
  const count=api.mock.calls.length
  document.hidden=true
  await act(async()=>{await vi.advanceTimersByTimeAsync(20_000)})
  expect(api).toHaveBeenCalledTimes(count)
  await act(async()=>{renderer!.update(<CodexActivityPreview accountKey="prod:11" userId={11} active={false}/>);await vi.advanceTimersByTimeAsync(20_000)})
  expect(api).toHaveBeenCalledTimes(count)
})
it('does not show completed when source state is unknown',()=>{
  act(()=>{renderer=create(<CodexActivityLabel snapshot={{complete:true,checkedAt:Date.now(),tasks:[{
    ...task('远端任务'),state:'working',status:'active',member:{...self,role:'member'},
    cloud:{sourceId:'s',taskId:'t',ownerRef:'11',sourceName:'Remote',remote:true},
  }]}}/>)})
  expect(text(renderer!.root)).toBe('任务状态待核实')
  expect(renderer!.root.findByType(StateDot).props.state).toBe('warning')
})
