import {expect,it,vi} from 'vitest'
import {ChatService} from '../src/services/chat-service.js'
import {ConversationMembersStore} from '../src/client/conversation-members-store.js'

it('accepts a delegated member page without inventing a personal member role and rejects a personal-role upgrade',async()=>{
 const frame={accessRef:'frozen-frame',teamId:'42',membershipKind:'member',membershipRevision:7,groupMembershipUid:'admission',groupMembershipRevision:1,visibleFromSeq:4}
 let accessKind='team_delegation',selfRole:number|undefined
 const read=vi.fn(async()=>({chat_session_uid:'group',access_kind:accessKind,...(selfRole===undefined?{}:{self_role:selfRole}),items:[{user_id:1001,role:3,status:1,join_at:1}],has_more:false}))
 const runtime={config:{chatMemberJoinEventsEnabled:false},stateStore:{uniqueCode:async()=> 'member-scope-key'},requireSession:async()=>({userId:42}),authenticatedChatPost:read}
 const source={openSourceRef:async()=>({kind:'group_chat',ownerRef:'group',groupDelegation:frame}),sourceItem:async()=>({sourceRef:'scoped-group',kind:'group_chat',accessKind:'team_delegation'}),sourceScopeKey:async()=> 'delegated-member-scope'}
 const chat=new ChatService(runtime as never,source as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never)
 const page=await chat.pageSourceMembers('scoped-group')
 expect(page.selfRole).toBe('unknown');expect(page.items).toHaveLength(1)
 expect(read).toHaveBeenCalledWith('/api/v1/chats/members/page',expect.anything(),expect.anything(),undefined,expect.objectContaining({chatAccessRef:frame.accessRef}))
 const store=new ConversationMembersStore({
  cached:async()=>null,
  page:async()=>await chat.pageSourceMembers('scoped-group'),
  presentation:async(_ref,refs)=>({kind:'presentation',source:page.source,removedMemberRefs:[],unavailableProfileMemberRefs:[],items:page.items.filter(item=>refs.includes(item.memberRef)).map(item=>({...item,displayName:'群成员',recordCount:0,mentionCount:0}))}),
 })
 store.activateAccount('test:42')
 const unsubscribe=store.subscribe('test:42',page.source,()=>{})
 try{
  await store.ensure('test:42',page.source)
  expect(store.get('test:42',page.source)).toMatchObject({ready:true,complete:true,selfRole:'unknown',error:undefined})
  expect(store.get('test:42',page.source).items).toHaveLength(1)
 }finally{unsubscribe();store.activateAccount(undefined)}
 selfRole=3
 await expect(chat.pageSourceMembers('scoped-group')).rejects.toMatchObject({code:'member-page-invalid-response'})
 selfRole=undefined;accessKind='personal_membership'
 await expect(chat.pageSourceMembers('scoped-group')).rejects.toMatchObject({code:'member-page-invalid-response'})
})
