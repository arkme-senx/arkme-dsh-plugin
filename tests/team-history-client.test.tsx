// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { historyMonthWindow, useTeamHistoryPage } from '../src/client/team-history-client.js'
import type { TeamHistoryResponse } from '../src/team-history-contract.js'
import type { TeamMessage } from '../src/team-app-contract.js'
const {call}=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:call}))
const message=(n:number)=>({key:`m${n}`,ref:`r${n}`,version:1}) as TeamMessage
const page=(start:number,size=1,more=false,cursor=''):TeamHistoryResponse=>({state:'ready',messages:Array.from({length:size},(_,i)=>message(start+i)),words:[],days:[],participants:[],hasMore:more,cursor})
let host:HTMLDivElement,root:Root,owner:ReturnType<typeof useTeamHistoryPage>
function Query({keyword='old',enabled=true,account='prod:1'}:{keyword?:string;enabled?:boolean;account?:string}){
 owner=useTeamHistoryPage('conversation',account,'query',{keyword},enabled,{key:'conversation',conversationKey:'conversation'})
 return <>{owner.page?.messages.map(m=><span key={m.key}>{m.key}</span>)}{owner.error}</>
}
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);call.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
it('converts the original month selection to an exclusive next-month bound, including leap years and year rollover',()=>{
 expect(historyMonthWindow('2024-02')).toEqual({fromAt:new Date(2024,1,1).getTime(),untilAt:new Date(2024,2,1).getTime(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})
 expect(historyMonthWindow('2026-12').untilAt).toBe(new Date(2027,0,1).getTime())
 expect(historyMonthWindow('')).toEqual({timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})
 for(const input of ['bad','2026-00','2026-13','2026-01-01'])expect(()=>historyMonthWindow(input)).toThrow()
})
it('clears old results as soon as the query changes and ignores a late account response',async()=>{
 call.mockResolvedValue(page(1));await act(async()=>root.render(<Query/>));expect(host.textContent).toBe('m1')
 let finish!:(value:TeamHistoryResponse)=>void
 call.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
 await act(async()=>root.render(<Query keyword="new"/>));expect(host.textContent).toBe('')
 const previous=finish,signal=call.mock.lastCall![2] as AbortSignal
 await act(async()=>root.render(<Query keyword="new" account="prod:2"/>));expect(signal.aborted).toBe(true)
 await act(async()=>previous(page(2)));expect(host.textContent).toBe('')
 await act(async()=>finish(page(3)));expect(host.textContent).toBe('m3')
 await act(async()=>root.render(<Query enabled={false}/>));expect(host.textContent).toBe('')
})
it('bounds the displayed page window while continuing stable cursors and refreshes from the beginning',async()=>{
 call.mockResolvedValueOnce(page(0,100,true,'c1')).mockResolvedValueOnce(page(100,100,true,'c2')).mockResolvedValueOnce(page(200,50,true,'c3')).mockResolvedValueOnce(page(0,100,true,'new'))
 await act(async()=>root.render(<Query/>));await act(async()=>owner.more());await act(async()=>owner.more())
 expect(host.querySelectorAll('span')).toHaveLength(200);expect(host.querySelector('span')?.textContent).toBe('m50');expect(owner.windowed).toBe(true)
 expect(call.mock.calls[2]![1].options).toEqual({keyword:'old',cursor:'c2'})
 await act(async()=>owner.refresh());expect(host.querySelector('span')?.textContent).toBe('m0');expect(owner.windowed).toBe(false)
 expect(call.mock.lastCall![1].options.cursor).toBeUndefined()
})
it('fails closed for a non-advancing cursor and content invalidation, including a late preparing reply',async()=>{
 call.mockResolvedValueOnce(page(1,1,true,'same')).mockResolvedValueOnce(page(2,1,true,'same'))
 await act(async()=>root.render(<Query/>));await act(async()=>owner.more())
 expect(host.querySelector('span')).toBeNull();expect(host.textContent).toContain('分页异常')
 let finish!:(value:TeamHistoryResponse)=>void
 call.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
 await act(async()=>owner.refresh())
 const {invalidateTeamMessages}=await import('../src/client/team-messaging-events.js')
 await act(async()=>invalidateTeamMessages('prod:1'));expect(host.textContent).toContain('团队内容已更新')
 const calls=call.mock.calls.length
 await act(async()=>finish({...page(9),state:'index_preparing'}))
 expect(host.querySelector('span')).toBeNull();expect(host.textContent).toContain('团队内容已更新');expect(call).toHaveBeenCalledTimes(calls)
})
it('uses independent local month boundaries when DST skips midnight on the first day',()=>{
 vi.stubEnv('TZ','America/Asuncion')
 try{
  const range=historyMonthWindow('2017-10')
  expect(new Date(range.fromAt!).getHours()).toBe(1)
  expect(range.untilAt).toBe(new Date(2017,10,1).getTime())
  expect(new Date(range.untilAt!).getHours()).toBe(0)
 }finally{vi.unstubAllEnvs()}
})

it('keeps history for nonmaterial and unrelated notifications but invalidates changed content',async()=>{
 call.mockResolvedValue(page(1));await act(async()=>root.render(<Query/>))
 const {invalidateTeamMessages}=await import('../src/client/team-messaging-events.js')
 for(const change of [
  {kind:'team.receipt.changed'}, {kind:'team.message.published'},
  {kind:'team.message.changed',conversationKeys:['other']},
 ]){
  await act(async()=>invalidateTeamMessages('prod:1',false,change))
  expect(host.textContent).toBe('m1')
 }
 await act(async()=>invalidateTeamMessages('prod:1',false,{kind:'team.message.changed',conversationKeys:['conversation'],messageKey:'m1',messageRevision:2}))
 expect(host.querySelector('span')).toBeNull()
 expect(host.textContent).toContain('团队内容已更新')
})
