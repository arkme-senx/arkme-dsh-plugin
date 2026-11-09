// @vitest-environment jsdom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {useTeamMentionCandidates} from '../src/client/use-team-mention-candidates.js'
import {arkmeAuthStore} from '../src/client/auth-store.js'
import {invalidateTeamMessages} from '../src/client/team-messaging-events.js'
import type {TeamConversation} from '../src/team-app-contract.js'
const {read}=vi.hoisted(()=>({read:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:read}))
const conversation={ref:'conversation',key:'conversation-key',side:'team',channel:{teamRef:'team'}} as TeamConversation
const page={items:[{personRef:'member-ref',personKey:'member-key',nickname:'Member'}],hasMore:false}
let host:HTMLDivElement,root:Root,scope:object,invalidated:ReturnType<typeof vi.fn>,value:ReturnType<typeof useTeamMentionCandidates>
function View({open=false,enabled=true,owner=scope}:{open?:boolean;enabled?:boolean;owner?:object}){
 value=useTeamMentionCandidates(conversation,'test:7777',owner,open,'',invalidated,enabled)
 return <div data-loading={value.loading}>{value.candidates.map(person=>person.displayName).join(',')}</div>
}
async function render(props:Parameters<typeof View>[0]={}){await act(async()=>root.render(<View {...props}/>))}
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:7777});scope={};invalidated=vi.fn();read.mockReset().mockResolvedValue(page);host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
it('prepares the current composer before the first @ and shows the completed page without a new request',async()=>{
 await render();expect(read).toHaveBeenCalledOnce();expect(host.textContent).toBe('')
 await render({open:true});expect(host.textContent).toBe('Member');expect(value.loading).toBe(false);expect(read).toHaveBeenCalledOnce()
})
it('joins the pending preparation when @ opens/closes instead of restarting it',async()=>{
 let finish!:(page:unknown)=>void;read.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
 await render();expect(read).toHaveBeenCalledOnce();const signal=read.mock.calls[0]![2] as AbortSignal
 await render({open:true});expect(value.loading).toBe(true);await render();expect(signal.aborted).toBe(false);expect(read).toHaveBeenCalledOnce()
 await act(async()=>finish(page));await render({open:true});expect(host.textContent).toBe('Member');expect(read).toHaveBeenCalledOnce()
})
it('keeps an expired page visible at @ while refreshing once, with no timer-driven polling',async()=>{
 await render();expect(read).toHaveBeenCalledOnce();vi.spyOn(Date,'now').mockReturnValue(Date.now()+30_001)
 let finish!:(page:unknown)=>void;read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 await render();expect(read).toHaveBeenCalledOnce();await render({open:true});expect(host.textContent).toBe('Member');expect(value.loading).toBe(false);expect(read).toHaveBeenCalledTimes(2)
 await act(async()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'))});expect(read).toHaveBeenCalledTimes(2);expect(host.textContent).toBe('Member')
 await act(async()=>finish(page));expect(host.textContent).toBe('Member')
})
it('hard invalidates members immediately and ignores the retired preparation result',async()=>{
 let finish!:(page:unknown)=>void;read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 await render();expect(read).toHaveBeenCalledOnce();const signal=read.mock.calls[0]![2] as AbortSignal
 await act(async()=>invalidateTeamMessages('test:7777',false,{kind:'team.member.changed',conversationKeys:['conversation-key']}));expect(signal.aborted).toBe(true);expect(invalidated).toHaveBeenCalledOnce()
 await act(async()=>finish(page));await render({open:true});expect(read).toHaveBeenCalledTimes(2);expect(host.textContent).toBe('Member')
})
it('drops retained data on a failed reauthorization, with an explicit bounded retry',async()=>{
 await render();read.mockRejectedValueOnce(Object.assign(new Error('denied'),{body:{code:'team-not_accessible',retryable:false}}))
 await act(async()=>window.dispatchEvent(new Event('focus')));await render({open:true});expect(host.textContent).toBe('');expect(value.error).toBe(true);expect(read).toHaveBeenCalledTimes(2)
 await render({open:true});expect(read).toHaveBeenCalledTimes(2);await act(async()=>value.retry());expect(host.textContent).toBe('Member');expect(read).toHaveBeenCalledTimes(3)
})
it('does not prepare disabled composers and cancels old scope/account work',async()=>{
 await render({enabled:false});expect(read).not.toHaveBeenCalled()
 let finish!:(page:unknown)=>void;read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 await render();expect(read).toHaveBeenCalledOnce();const first=read.mock.calls[0]![2] as AbortSignal
 const other={};await render({owner:other});expect(first.aborted).toBe(true);expect(read).toHaveBeenCalledTimes(2)
 await act(async()=>finish(page));await render({owner:other,open:true});expect(host.textContent).toBe('Member')
 await act(async()=>arkmeAuthStore.setAuth({status:'logged-out',environment:'test'}));expect(host.textContent).toBe('');expect(value.canSelect({kind:'member',mentionRef:'member-ref'} as never)).toBe(false)
})
it('does not warm a hidden window; foreground starts one read and hides/unmounts cancel it',async()=>{
 const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden')
 await render();expect(read).not.toHaveBeenCalled()
 let finish!:(page:unknown)=>void;read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 visibility.mockReturnValue('visible');await act(async()=>document.dispatchEvent(new Event('visibilitychange')));expect(read).toHaveBeenCalledOnce()
 const signal=read.mock.calls[0]![2] as AbortSignal
 visibility.mockReturnValue('hidden');await act(async()=>document.dispatchEvent(new Event('visibilitychange')));expect(signal.aborted).toBe(true)
 await act(async()=>finish(page));await render({open:true});expect(host.textContent).toBe('')
 visibility.mockReturnValue('visible');await act(async()=>document.dispatchEvent(new Event('visibilitychange')));expect(read).toHaveBeenCalledTimes(2);expect(host.textContent).toBe('Member')
 await act(async()=>root.render(null));await act(async()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'))});expect(read).toHaveBeenCalledTimes(2)
})
it('a stale page is cleared synchronously when actual membership changes, before its old selection closure can insert',async()=>{
 await render({open:true});const select=value.canSelect,candidate=value.candidates[0]!
 expect(select(candidate)).toBe(true);read.mockImplementationOnce(()=>new Promise(()=>{}))
 await act(async()=>{invalidateTeamMessages('test:7777',false,{kind:'team.member.changed',conversationKeys:['conversation-key']});expect(select(candidate)).toBe(false)})
 expect(host.textContent).toBe('');expect(read).toHaveBeenCalledTimes(2)
})

it('keeps stale suggestions on an explicitly retryable network failure and exposes a manual retry',async()=>{
 await render();read.mockRejectedValueOnce(Object.assign(new Error('network'),{body:{code:'local-network-unavailable',retryable:true}}))
 await act(async()=>window.dispatchEvent(new Event('focus')));await render({open:true})
 expect(host.textContent).toBe('Member');expect(value.error).toBe(true);expect(value.loading).toBe(false);expect(value.canSelect(value.candidates[0]!)).toBe(true);expect(read).toHaveBeenCalledTimes(2)
 await render();await render({open:true});expect(read).toHaveBeenCalledTimes(2)
 await act(async()=>value.retry());expect(value.error).toBe(false);expect(host.textContent).toBe('Member');expect(read).toHaveBeenCalledTimes(3)
})

it('projects Team avatar references without delaying the prepared candidates for image bytes',async()=>{
 read.mockResolvedValueOnce({...page,items:[{...page.items[0],imageRef:'team-image-ref',imageKey:'image-key'}]})
 await render();await render({open:true})
 expect(value.candidates[0]).toMatchObject({displayName:'Member',teamImage:{ref:'team-image-ref',key:'image-key'}})
 expect(read).toHaveBeenCalledOnce();expect(read.mock.calls[0]![0]).toBe('team.messages.mention-candidates');expect(value.loading).toBe(false)
})

it('coalesces a membership event burst into one new preparation while the picker is closed',async()=>{
 await render();let finish!:(page:unknown)=>void;read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 await act(async()=>{for(let i=0;i<3;i++)invalidateTeamMessages('test:7777',false,{kind:'team.member.changed',conversationKeys:['conversation-key']})})
 expect(read).toHaveBeenCalledTimes(2);expect(host.textContent).toBe('')
 await act(async()=>finish(page));await render({open:true});expect(host.textContent).toBe('Member');expect(read).toHaveBeenCalledTimes(2)
})
it.each(['focus','online'])('allows one independent %s recovery after a preparation failure without render-driven retries',async event=>{
 read.mockRejectedValueOnce(Object.assign(new Error('network'),{body:{code:'local-network-unavailable',retryable:true}}))
 await render();expect(read).toHaveBeenCalledOnce();await render();await render({open:true});expect(read).toHaveBeenCalledOnce()
 let finish!:(page:unknown)=>void;read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 await act(async()=>{window.dispatchEvent(new Event(event));window.dispatchEvent(new Event(event))});expect(read).toHaveBeenCalledTimes(2)
 await act(async()=>finish(page));expect(host.textContent).toBe('Member')
})
