import { expect,it,vi } from 'vitest'
import { TeamAppService } from '../src/services/team-app-service.js'
import { ArrangementSourceService } from '../src/services/arrangement-source-service.js'
import type { ServiceRuntime } from '../src/services/service.js'
import type { ArkmeArrangementItem } from '../src/types.js'

function fixture(){
  const session={userId:11,refreshToken:'isolated-session'}
  const raw={message_uid:'message-a',state:'published',record:{status:'available',version:7,text_content:'明天去会议室确认样机'}}
  const conversation={ref:'opaque-conversation',key:'opaque-key',side:'team',channel:{name:'研发团队'}}
  const message={ref:'opaque-message',key:'opaque-message-key',version:7,createdAt:1000,sender:{nickname:'李工'},content:{text_content:raw.record.text_content}}
  const runtime={requireSession:vi.fn(async()=>session),authenticatedTeamPost:vi.fn(async(path:string)=>path.endsWith('/context')?{conversation_uid:'conversation-a',side:'team'}:{conversation:{conversation_uid:'conversation-a',side:'team'},messages:[raw]})}
  const host={runtime,conversation:vi.fn(async()=>conversation),message:vi.fn(async()=>message)}
  const read=(signal?:AbortSignal)=>TeamAppService.prototype.arrangementSource.call(host as unknown as TeamAppService,'conversation-a','message-a','team',7,signal)
  return{runtime,host,raw,conversation,message,read}
}
it('reads the exact current team source through its owner and returns opaque references',async()=>{
  const{read,runtime,message}=fixture();expect(await read()).toMatchObject({message})
  expect(runtime.authenticatedTeamPost.mock.calls.map(c=>c[0])).toEqual(['/api/v1/team/conversations/context','/api/v1/team/conversations/timeline/locate'])
})
it('rechecks an explicitly selected side for a member who also owns the visitor thread',async()=>{
  const{runtime,read}=fixture(),original=runtime.authenticatedTeamPost.getMockImplementation()!
  runtime.authenticatedTeamPost.mockImplementation(async(path:string)=>path.endsWith('/context')?{conversation_uid:'conversation-a',side:'external'}:path.endsWith('/notification-policy/get')?{muted:false,policy_version:0,notify_after_seq:0}:original(path))
  await expect(read()).resolves.toMatchObject({message:{version:7}})
  expect(runtime.authenticatedTeamPost.mock.calls.some(([path])=>path.endsWith('/notification-policy/get'))).toBe(true)
})
it.each(['version','unavailable','side','account','abort'])('rejects a %s change in a team source',async kind=>{
  const{read,runtime,raw}=fixture();const controller=new AbortController()
  if(kind==='version')raw.record.version++
  if(kind==='unavailable')raw.record.status='unavailable'
  if(kind==='side')runtime.authenticatedTeamPost.mockResolvedValueOnce({conversation_uid:'conversation-a',side:'external'} as never)
  if(kind==='account')runtime.requireSession.mockResolvedValueOnce({userId:11,refreshToken:'isolated-session'}).mockResolvedValue({userId:12,refreshToken:'new-session'})
  if(kind==='abort')controller.abort()
  await expect(read(controller.signal)).rejects.toThrow()
})
it('shows team source metadata while keeping source text out of cached evidence',async()=>{
  const{conversation,message}=fixture()
  const team={arrangementSource:vi.fn(async()=>({conversation,message}))}
  const source={sourceEvidence:vi.fn(async()=>({kind:'team_message',id:'e',text:'确认样机',team_conversation_uid:'conversation-a',team_message_uid:'message-a',team_side:'team',record_version:7}))}
  const service=new ArrangementSourceService({} as ServiceRuntime,source as never,{} as never,{} as never,{} as never,{} as never,team as never)
  expect(await service.arrangementSourceRead('arr','e')).toMatchObject({state:'ready',text:'确认样机',teamConversation:{conversation,message}})
  expect(team.arrangementSource).toHaveBeenCalledWith('conversation-a','message-a','team',7,undefined)
})
