import {afterEach,expect,it,vi} from 'vitest'
import {TeamMessageNotificationService} from '../src/services/team-message-notification-service.js'
import {decodeArkmeTeamNotificationDataLine,type ArkmeChatRealtimeNotice} from '../src/chat-realtime.js'
const start=1700000000000
const session={userId:7,accessToken:'fixture',refreshToken:'epoch'}
const publication={eventUid:'event',conversationUid:'conversation',messageUid:'message',seq:8,publishedAt:start,expiresAt:start+3600000}
const resolved={eventUid:'event',sourceRef:'sealed-team-ref',sourceKey:'scoped-key',sourceKind:'team_conversation' as const,title:'团队',body:'新消息',eventAtMillis:start,expiresAtMillis:start+300000}
const active:TeamMessageNotificationService[]=[]
afterEach(()=>{for(const s of active.splice(0))s.dispose();vi.useRealTimers()})
function setup(){
 vi.useFakeTimers();vi.setSystemTime(start+1000)
 const signal=new AbortController(),ports={session:vi.fn(async()=>session),resolve:vi.fn(async()=>resolved as typeof resolved|undefined),fallback:vi.fn()}
 const native={showNotification:vi.fn(async()=>({fallbackToBrowser:false,outcome:'accepted' as const}))}
 const service=new TeamMessageNotificationService(ports,native);active.push(service)
 const notice={state:{} as never,cause:'team-message-published',teamPublication:publication,connectionUserId:7,connectionStartedAtMillis:start-1,connectionSignal:signal.signal} satisfies ArkmeChatRealtimeNotice
 return {signal,ports,native,service,notice}
}
it('decodes publication metadata without treating invalidation or receipt as a new message',()=>{
 const wire={t:28,event_uid:'event',kind:'team.message.published',conversation_uid:'c',message_uid:'m',revision:1,event_at:start,published_at:start,expires_at:start+3600000,seq:3}
 expect(decodeArkmeTeamNotificationDataLine(`data: ${JSON.stringify(wire)}`)?.publication?.seq).toBe(3)
 for(const patch of [{expires_at:start+3600001},{seq:0},{record:'private'},{message_uid:''}])expect(decodeArkmeTeamNotificationDataLine(`data: ${JSON.stringify({...wire,...patch})}`)).toBeUndefined()
 expect(decodeArkmeTeamNotificationDataLine(`data: ${JSON.stringify({t:28,event_uid:'p',kind:'team.notification-policy.changed',conversation_uid:'c',revision:2,event_at:start})}`)?.publication).toBeUndefined()
})
it('one logical event creates a typed native Team intent and no Chat identity',async()=>{
 const f=setup();for(let i=0;i<20;i++)f.service.accept(f.notice);await vi.advanceTimersByTimeAsync(1)
 expect(f.ports.resolve).toHaveBeenCalledOnce();expect(f.native.showNotification).toHaveBeenCalledOnce()
 expect(f.native.showNotification.mock.calls[0]![0]).toMatchObject({idempotencyKey:'event',kind:'team.message',expiresAtMillis:start+300000,activation:{kind:'team-conversation',sourceRef:'sealed-team-ref'}})
 expect(f.ports.fallback).not.toHaveBeenCalled();f.service.accept(f.notice);await vi.advanceTimersByTimeAsync(1);expect(f.native.showNotification).toHaveBeenCalledOnce()
})
for(const reason of ['reconnect','expired','account','aborted','muted'])it(`${reason} cannot alert`,async()=>{
 const f=setup()
 if(reason==='reconnect')f.notice.connectionStartedAtMillis=start+1
 if(reason==='expired')vi.setSystemTime(start+300001)
 if(reason==='account')f.ports.session.mockResolvedValue({...session,userId:8})
 if(reason==='aborted')f.signal.abort()
 if(reason==='muted')f.ports.resolve.mockResolvedValue(undefined)
 f.service.accept(f.notice);await vi.advanceTimersByTimeAsync(1);expect(f.native.showNotification).not.toHaveBeenCalled();expect(f.ports.fallback).not.toHaveBeenCalled()
})
it('authority failure retries within fixed window and never permits an unknown lookup',async()=>{
 const f=setup();f.ports.resolve.mockRejectedValueOnce(new Error('offline'));f.service.accept(f.notice)
 await vi.advanceTimersByTimeAsync(1);expect(f.native.showNotification).not.toHaveBeenCalled()
 await vi.advanceTimersByTimeAsync(1000);expect(f.native.showNotification).toHaveBeenCalledOnce()
})
it('account swap while resolving discards the old content',async()=>{
 const f=setup();f.ports.resolve.mockImplementation(async()=>{f.ports.session.mockResolvedValue({...session,userId:8});return resolved})
 f.service.accept(f.notice);await vi.advanceTimersByTimeAsync(1);expect(f.native.showNotification).not.toHaveBeenCalled()
})
it('unknown native attempt never falls through to Browser and retries the same key',async()=>{
 const f=setup();f.native.showNotification.mockRejectedValueOnce(new Error('timeout'));f.service.accept(f.notice)
 await vi.advanceTimersByTimeAsync(1);expect(f.ports.fallback).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1000)
 expect(f.native.showNotification).toHaveBeenCalledTimes(2)
 expect(f.native.showNotification.mock.calls[0]![0]).toEqual(f.native.showNotification.mock.calls[1]![0])
})
it('Browser fallback is emitted only after an explicit no-side-effect result',async()=>{
 const f=setup();f.native.showNotification.mockResolvedValue({fallbackToBrowser:true,outcome:'unsupported'} as never)
 f.service.accept(f.notice);await vi.advanceTimersByTimeAsync(1);expect(f.ports.fallback).toHaveBeenCalledWith(resolved)
})
