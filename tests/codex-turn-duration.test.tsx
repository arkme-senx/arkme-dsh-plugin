// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CodexTurnDuration } from '../src/client/redesign/contacts/CodexTurnDuration.js'
import type { TeamCodexTask, TeamCodexTurnTiming } from '../src/team-codex-contract.js'
vi.mock('../src/client/redesign/contacts/CodexTaskStateDot.js',()=>({CodexTaskStateDot:({status}:{status:string})=><span data-status={status}/>}))
let host:HTMLDivElement,root:Root
const start=1792748662000
const task={state:'working',status:'active',captureHealth:{status:'online',checkedAt:start+120000,lastReceivedAt:start}} as TeamCodexTask
const running:TeamCodexTurnTiming={state:'working',startedAt:start,observedAt:start+120000}
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers();vi.setSystemTime(start+128000);host=document.createElement('div');root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());vi.useRealTimers();vi.unstubAllGlobals()})
const render=async(timing=running,current=task)=>act(async()=>root.render(<CodexTurnDuration timing={timing} task={current}/>))
it('updates a verified running clock and freezes the true duration on completion',async()=>{
  await render();expect(host.textContent).toBe('已处理 2分钟 8秒')
  await act(async()=>vi.advanceTimersByTime(1000));expect(host.textContent).toBe('已处理 2分钟 9秒')
  await render({...running,state:'finished',completedAt:start+128000,durationMs:128012,observedAt:start+128000})
  await act(async()=>vi.advanceTimersByTime(60000));expect(host.textContent).toBe('用时 2分钟 8秒')
})
it('stops live projection when source evidence expires and labels an interruption',async()=>{
  await render();await act(async()=>vi.advanceTimersByTime(30000))
  expect(host.textContent).toContain('等待同步');expect(host.querySelector('[data-status="running"]')).toBeNull()
  await render({...running,state:'interrupted',completedAt:start+128000,durationMs:128012,observedAt:start+128000})
  expect(host.textContent).toBe('已中断 · 用时 2分钟 8秒')
})
it('does not run an unverified remote clock or render invalid zero-time evidence',async()=>{
  await render(running,{state:'working',status:'active',cloud:{remote:true}} as TeamCodexTask)
  expect(host.textContent).toBe('已处理 2分钟 0秒 · 等待同步')
  await render({...running,startedAt:0});expect(host.textContent).toBe('')
})
it('uses freshly verified source liveness even if the conversation-list snapshot is old',async()=>{
  await render({...running,live:true},{...task,captureHealth:{...task.captureHealth!,checkedAt:1}})
  expect(host.textContent).toBe('已处理 2分钟 8秒')
  await render({...running,live:false},task)
  expect(host.textContent).toContain('等待同步')
  expect(host.querySelector('[data-status="running"]')).toBeNull()
})
it('does not flash waiting when fresh evidence arrives between clock ticks',async()=>{
  await render({...running,live:true})
  vi.setSystemTime(start+128500)
  await render({...running,live:true,observedAt:start+128400})
  expect(host.textContent).toBe('已处理 2分钟 8秒')
  expect(host.querySelector('[data-status="running"]')).not.toBeNull()
})
