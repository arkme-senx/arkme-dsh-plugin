import { describe, expect, it } from 'vitest'
import { MemberEventService } from '../../src/services/member-event-service.js'
import { ArkmePluginError, type ServiceRuntime } from '../../src/services/service.js'
import type { SourceService } from '../../src/services/source-service.js'
import type { ProfileService } from '../../src/services/profile-service.js'

function fixture() {
  let user = 42
  let denied = false
  let profileReads = 0
  const requests: Array<{path:string;body:Record<string,unknown>}> = []
  const opened:number[]=[]
  const event = {event_id:'leave-1',chat_session_uid:'group-1',event_type:'left',occurred_at:200,member_user_id:88,actor_user_id:88,join_at:100,display_name_snapshot:'李四'}
  const service = new MemberEventService({
    requireSession:async()=>({userId:user,accessToken:'test',refreshToken:'test'}),
    stateStore:{uniqueCode:async()=>'member-event-test-key'},
    authenticatedChatPost:async(path:string,body:Record<string,unknown>)=>{
      requests.push({path,body})
      if (denied) throw new ArkmePluginError('arkme-code-2002','denied',false)
      if (path.endsWith('/query')) return {items:[event],has_more:true,next_cursor:'server-cursor'}
      return event
    },
  } as unknown as ServiceRuntime,{
    openSourceRef:async(ref:string)=>({kind:'group_chat',ownerRef:ref}),
  } as unknown as SourceService,{
    publicProfileSummariesByUserIds:async()=>{profileReads++;return new Map([[88,{displayName:'李四新昵称'}]])},
  } as unknown as ProfileService,async userId=>{opened.push(userId);return {source:{sourceRef:'private-88'}} as never})
  return {service,requests,opened,profileReads:()=>profileReads,deny:()=>{denied=true},switchUser:()=>{user=99}}
}

describe('member event host service',()=>{
  it('keeps user identities out of browser rows and binds cursors to the account and time window',async()=>{
    const f=fixture()
    const q={fromAtMillis:100,toAtMillis:300}
    const page=await f.service.list('group-1',q)
    expect(page.items).toEqual([{eventId:'leave-1',type:'left',occurredAtMillis:200,displayName:'李四'}])
    expect(f.profileReads()).toBe(0)
    await f.service.list('group-1',{...q,cursor:page.nextCursor!})
    expect(f.requests[1]!.body.cursor).toBe('server-cursor')
    const count=f.requests.length
    await expect(f.service.list('group-1',{...q,toAtMillis:400,cursor:page.nextCursor!})).rejects.toMatchObject({code:'member-events-cursor-invalid'})
    f.switchUser()
    await expect(f.service.list('group-1',{...q,cursor:page.nextCursor!})).rejects.toMatchObject({code:'member-events-cursor-invalid'})
    expect(f.requests).toHaveLength(count)
  })

  it('resolves a departed user through an authorized event and rechecks before private chat',async()=>{
    const f=fixture()
    expect(await f.service.memberProfile('group-1','leave-1')).toEqual({displayName:'李四新昵称',memberName:'李四'})
    expect(f.profileReads()).toBe(1)
    await f.service.openPrivateChat('group-1','leave-1')
    expect(f.opened).toEqual([88])
    expect(f.requests.map(r=>r.path)).toEqual(['/api/v1/chats/members/events/detail','/api/v1/chats/members/events/detail'])
    f.deny()
    await expect(f.service.openPrivateChat('group-1','leave-1')).rejects.toMatchObject({code:'member-events-unavailable'})
    expect(f.opened).toEqual([88])
  })
})
