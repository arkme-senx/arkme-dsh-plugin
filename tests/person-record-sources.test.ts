import { expect, it, vi } from 'vitest'
import { openPersonSourcesCursor, sealPersonSourcesCursor } from '../src/person-records.js'
import { ChatService } from '../src/services/chat-service.js'
const context={scope:'prod:1',target:2,entry:'entry'}
it('binds discovery cursors to viewer/environment/person/entry and rejects modification and expiry',()=>{
 const cursor=sealPersonSourcesCursor({...context,phase:'groups',after:'last',at:100},'secret')
 expect(openPersonSourcesCursor(cursor,'secret',context,101).after).toBe('last')
 for(const changed of [{...context,scope:'prod:2'},{...context,target:3},{...context,entry:'other'}])expect(()=>openPersonSourcesCursor(cursor,'secret',changed,101)).toThrow()
 expect(()=>openPersonSourcesCursor(cursor,'wrong',context,101)).toThrow();expect(()=>openPersonSourcesCursor(cursor,'secret',context,100+1800001)).toThrow()
 expect(()=>openPersonSourcesCursor(cursor+'.extra','secret',context,101)).toThrow()
})
function fixture(kind='group_chat') {
 let user=1
 const post=vi.fn(async(path:string,body:Record<string,unknown>)=>{
  if(path.endsWith('common-group/query'))return {items:[{chat_session_uid:'entry',title:'Entry',member_count:2},{chat_session_uid:'group2',title:'Other',member_count:3}],removed:[],has_more:false}
  if(path.endsWith('/list'))return {items:[{session:{chat_session_uid:'private',session_kind:1},private_counterpart:{user_id:2}},{session:{chat_session_uid:'unrelated',session_kind:1},private_counterpart:{user_id:3}}],has_more:false}
  throw Error('Unexpected write or read: '+path)
 })
 const memberRead=vi.fn(async()=>[{user_id:2}])
 const chat=Object.create(ChatService.prototype) as ChatService
 Object.assign(chat,{runtime:{requireSession:async()=>({userId:user}),config:{environment:'prod',chatBaseUrl:'https://chat'},stateStore:{uniqueCode:async()=>'secret'},authenticatedChatPost:post},source:{openSourceRef:async()=>({kind,userId:user,ownerRef:'entry'}),sourceItem:async(s:{ownerRef:string;kind:string;displayName:string})=>({sourceRef:s.ownerRef,sourceKey:s.ownerRef,kind:s.kind,displayName:s.displayName})},openChatMemberRef:async()=>({targetUserId:2}),sealChatMemberRef:async(_v:number,uid:string)=>'member:'+uid,rawChatMembers:memberRead})
 return {chat,post,memberRead,setUser:(n:number)=>{user=n}}
}
it('discovers real shared groups, then only the existing peer private chat without creation or read writes',async()=>{
 const f=fixture();const first=await f.chat.personRecordSources('entry','member')
 expect(first.items.map(x=>x.source.sourceRef)).toEqual(['group2']);expect(first.hasMore).toBe(true)
 const next=await f.chat.personRecordSources('entry','member',first.nextCursor)
 expect(next.items.map(x=>x.source.sourceRef)).toEqual(['private']);expect(next.hasMore).toBe(false)
 expect(f.post.mock.calls.map(([p])=>p)).toEqual(['/api/v1/chats/common-group/query','/api/v1/chats/list'])
 expect(f.post.mock.calls[0]![1]).toEqual({target_user_id:2,after:''})
})
it('does not scan or create a private chat when the entry is already the private chat',async()=>{
 const f=fixture('private_chat');const page=await f.chat.personRecordSources('entry','member');expect(page.hasMore).toBe(false);expect(f.post).toHaveBeenCalledTimes(1)
})
it('revalidates entry membership and refuses discovery after revocation or abort',async()=>{
 const f=fixture();f.memberRead.mockResolvedValue([]);await expect(f.chat.personRecordSources('entry','member')).rejects.toThrow('已不属于');expect(f.post).not.toHaveBeenCalled()
})
it('continues private-directory pages instead of reporting an incomplete scan as empty',async()=>{
 const f=fixture();const first=await f.chat.personRecordSources('entry','member');f.post.mockResolvedValueOnce({items:[],has_more:true,next_page_cursor:{last_at:10}} as never)
 const second=await f.chat.personRecordSources('entry','member',first.nextCursor);expect(second.hasMore).toBe(true);expect(second.items).toEqual([])
 const third=await f.chat.personRecordSources('entry','member',second.nextCursor);expect(third.items[0]!.source.sourceRef).toBe('private');expect(f.post.mock.calls.at(-1)![1]).toMatchObject({page_cursor:{last_at:10}})
})

it('honors cancellation before network and fences a late account change',async()=>{
 const f=fixture();const controller=new AbortController();controller.abort()
 await expect(f.chat.personRecordSources('entry','member',undefined,controller.signal)).rejects.toThrow();expect(f.post).not.toHaveBeenCalled();expect(f.memberRead).not.toHaveBeenCalled()
 f.post.mockImplementationOnce(async()=>{f.setUser(9);return {items:[],removed:[],has_more:false}})
 await expect(f.chat.personRecordSources('entry','member')).rejects.toThrow('账号已切换')
})
