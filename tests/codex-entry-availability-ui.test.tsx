import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useCodexEntryAvailability } from '../src/client/redesign/contacts/use-codex-entry-availability.js'
const api=vi.hoisted(()=>vi.fn())
vi.mock('../src/client/api.js',()=>({callArkme:api}))
let renderer:ReactTestRenderer|undefined
function Entry({account='prod:11',user=11,active=true}:{account?:string;user?:number;active?:boolean}) {
  return useCodexEntryAvailability(account,user,active)?<button>Codex</button>:null
}
const visible=()=>renderer!.root.findAllByType('button').length>0
beforeEach(()=>{vi.useFakeTimers();api.mockReset();api.mockResolvedValue({userId:11,visible:false,checked:true})})
afterEach(()=>{act(()=>renderer?.unmount());renderer=undefined;vi.useRealTimers()})
it('starts hidden, reveals a confirmed binding, and retains it during transient errors',async()=>{
  act(()=>{renderer=create(<Entry/>)});expect(visible()).toBe(false)
  await act(async()=>{});expect(visible()).toBe(false)
  api.mockResolvedValue({userId:11,visible:true,checked:true})
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000)});expect(visible()).toBe(true)
  api.mockRejectedValue(new Error('offline'))
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000)});expect(visible()).toBe(true)
})
it('does not flash the previous account or accept its delayed response',async()=>{
  let finish!:(value:unknown)=>void
  api.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
  await act(async()=>{renderer=create(<Entry/>)});expect(visible()).toBe(false)
  api.mockResolvedValue({userId:22,visible:false,checked:true})
  await act(async()=>{renderer!.update(<Entry account="prod:22" user={22}/>);finish({userId:11,visible:true,checked:true})})
  expect(visible()).toBe(false)
  api.mockResolvedValue({userId:22,visible:true,checked:true})
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000)});expect(visible()).toBe(true)
  act(()=>{renderer!.update(<Entry account="prod:11" user={11} active={false}/>)});expect(visible()).toBe(false)
})
it('checks immediately on returning from team setup and stops polling while hidden',async()=>{
  await act(async()=>{renderer=create(<Entry active={false}/>)});expect(api).not.toHaveBeenCalled()
  api.mockResolvedValue({userId:11,visible:true,checked:true})
  await act(async()=>{renderer!.update(<Entry/>)});expect(visible()).toBe(true)
  await act(async()=>{renderer!.update(<Entry active={false}/>);await vi.advanceTimersByTimeAsync(15_000)})
  expect(api).toHaveBeenCalledTimes(1)
})
it.each([{userId:22,visible:true,checked:true},{userId:11,visible:true,checked:false}])('never activates from an unverified or mismatched response',async value=>{
  api.mockResolvedValue(value)
  await act(async()=>{renderer=create(<Entry/>)});expect(visible()).toBe(false)
})
