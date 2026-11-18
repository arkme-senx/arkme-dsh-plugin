// @vitest-environment jsdom
import {act, useContext, useSyncExternalStore} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import type {TeamConversation, TeamMessage, TeamTimeline} from '../src/team-app-contract.js'
import * as content from '../src/client/TeamMessageContent.js'
import {TeamConversationPane} from '../src/client/TeamMessagingPanel.js'
import {TeamConversationPreview} from '../src/client/TeamConversationPreview.js'
import {ArkmeAttachmentNavigationContext, type ArkmeAttachmentNavigation} from '../src/client/attachment-preview-navigation.js'
import {arkmeAuthStore} from '../src/client/auth-store.js'
import {invalidateTeamMessages} from '../src/client/team-messaging-events.js'

const mocks=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.call}))
const empty:never[]=[]
const noop=()=>()=>{}
let observed:ArkmeAttachmentNavigation|undefined
vi.mock('../src/client/ArkmeRichContent.js',()=>({ArkmeMessageContent:({item,attachmentNavigationKey}:any)=>{
 const navigation=useContext(ArkmeAttachmentNavigationContext)
 const entries=useSyncExternalStore(navigation?.subscribe??noop,navigation?.getSnapshot??(()=>empty))
 observed=navigation
 return <div data-message={item.itemUid} data-navigation-key={attachmentNavigationKey} data-neighbours={entries.map(entry=>entry.key).join(',')}/>
}}))
const channel={teamRef:'team',name:'Synthetic team',jotmoId:'team',publicRef:'',link:'',enabled:true,revision:1,canManage:false}
const conversation:TeamConversation={ref:'conversation-ref',key:'conversation-key',channel,visitor:{nickname:'Synthetic visitor'},side:'team',lastSeq:3,latestTeamReplySeq:0,myReadSeq:0,unread:3,needsReply:false,blocked:false,revision:1,updatedAt:3}
const message=(key:string,seq:number,mimeType='image/png'):TeamMessage=>({key,ref:`message-${key}`,seq,revision:1,version:2,side:'external',sender:{nickname:'Synthetic sender'},own:false,state:'published',createdAt:seq,canEdit:false,canDelete:false,contentStatus:'available',content:{text_content:'',template_kind:2},media:[{key:`asset-${key}`,ref:`ref-${key}`,url:`/team-media-${key}`,name:`${key}.png`,mimeType,size:1,kind:1}]})
const a=message('a',1),b=message('b',2),c=message('c',3)
const page=(messages:TeamMessage[],hasMore=false):TeamTimeline=>({conversation,messages,hasMore,beforeSeq:messages[0]?.seq??0})
let host:HTMLDivElement,root:Root
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 vi.stubGlobal('IntersectionObserver',class {observe(){}disconnect(){}})
 vi.spyOn(document,'hasFocus').mockReturnValue(true)
 localStorage.clear();mocks.call.mockReset();observed=undefined
 arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:42})
 mocks.call.mockImplementation(async(op:string)=>{if(op==='team.app.timeline')return page([b,c],true);if(op==='team.app.read')return {};throw new Error(op)})
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})

it('projects ready visual messages and identity-only revalidation markers without issuing reads',()=>{
 const mixed={...a,media:[...a.media,{...a.media[0]!,key:'audio',ref:'audio',mimeType:'audio/mp4'},{...a.media[0]!,key:'file',ref:'file',mimeType:'application/zip'}]}
 const entries=content.teamAttachmentNavigationEntries([mixed,{...b,key:'pending',version:0},{...b,key:'sending',state:'sending'},{...b,key:'recalled',state:'recalled'},{...b,key:'deleted',contentStatus:'deleted'},{...b,key:'validating',contentStatus:'revalidating'},{...b,key:'excerpt',historyPreview:true},message('audio-only',4,'audio/mp4'),message('video',5,'video/mp4')],conversation,'test:42')
 expect(entries.map(entry=>entry.key)).toEqual(['a','validating','video'])
 expect(entries[0]).toMatchObject({source:'a:a',version:'2',blocks:[{kind:'image',mediaRef:'ref-a'}]})
 expect(entries[1]).toMatchObject({key:'validating',revalidating:true,blocks:[]})
 expect(entries[1]!.mediaAccess).toBeUndefined()
 expect(entries[2]!.blocks[0]!.kind).toBe('video')
 expect(entries[0]!.mediaAccess?.imagePresentation).toBeUndefined()
 expect(mocks.call).not.toHaveBeenCalled()
})

it('uses stable asset identity across rotated references and same-version partial-media completion',()=>{
 const original=content.teamMessagePresentation(a).contentBlocks![0]!
 const completed={...a,media:[{...a.media[0]!,key:'inserted',ref:'inserted-ref'}, {...a.media[0]!,ref:'rotated-a',url:'/rotated-a'}]}
 const entry=content.teamAttachmentNavigationEntries([completed],conversation,'test:42')[0]!
 expect(entry.blockKey!(original)).toBe(entry.blockKey!(entry.blocks[1]!))
 expect(entry.blockKey!(original)).not.toBe(entry.blockKey!(entry.blocks[0]!))
 expect(entry.mediaAccess!.url(entry.blocks[1]!)).toBe('/rotated-a')
 expect(original.fileAssetUid).toBeUndefined()
})

it('assigns each entry its own account, exact message version, URL and cancellable preflight',async()=>{
 mocks.call.mockImplementation(()=>new Promise(()=>{}))
 const entries=content.teamAttachmentNavigationEntries([a,{...b,version:7}],conversation,'test:42')
 const states=[vi.fn(),vi.fn()]
 const stops=entries.map((entry,index)=>entry.mediaAccess!.subscribeReadState!(states[index]!))
 try{
  expect(entries[0]!.mediaAccess!.url(entries[0]!.blocks[0]!)).toBe('/team-media-a')
  expect(entries[0]!.mediaAccess!.url(entries[1]!.blocks[0]!)).toBe('')
  expect(entries[0]!.mediaAccess!.readScopeKey).not.toBe(entries[1]!.mediaAccess!.readScopeKey)
  expect(mocks.call.mock.calls.map(([op,params])=>[op,params])).toEqual([
   ['team.app.preflight',{conversationRef:conversation.ref,selections:[{messageRef:a.ref,version:2}],expectedAccountKey:'test:42'}],
   ['team.app.preflight',{conversationRef:conversation.ref,selections:[{messageRef:b.ref,version:7}],expectedAccountKey:'test:42'}],
  ])
  const signals=mocks.call.mock.calls.map((args:any[])=>args[2] as AbortSignal)
  invalidateTeamMessages('test:42',false,{kind:'team.message.changed',conversationKeys:[conversation.key],messageKey:b.key})
  expect(mocks.call).toHaveBeenCalledTimes(3)
  expect(signals[0]!.aborted).toBe(false);expect(signals[1]!.aborted).toBe(true)
  stops[0]!();expect(signals[0]!.aborted).toBe(true)
 }finally{stops.forEach(stop=>stop())}
})

it.each(['pane','preview'] as const)('connects the %s to loaded neighbours, paging updates and isolated owner lifetimes',async mode=>{
 const render=(scope=conversation)=>mode==='pane'
  ? <TeamConversationPane key={scope.key} accountKey="test:42" conversation={scope}/>
  : <TeamConversationPreview key={scope.key} accountKey="test:42" target={{kind:'conversation',conversation:scope}} onClose={()=>{}}/>
 mocks.call.mockImplementation(async(op:string,p:any)=>{if(op==='team.app.timeline')return p.conversationRef===conversation.ref?(p.beforeSeq?page([a]):page([b,c],true)): {...page([message('other',9)]),conversation:{...conversation,key:'other-conversation',ref:'other-conversation-ref'}};if(op==='team.app.read')return {};throw new Error(op)})
 await act(async()=>root.render(render()))
 expect(document.querySelector('[data-message="b"]')?.getAttribute('data-navigation-key')).toBe('b')
 expect(document.querySelector('[data-message="b"]')?.getAttribute('data-neighbours')).toBe('b,c')
 const owner=observed!
 const pagingLabel=mode==='pane'?'继续加载更早消息':'加载更早消息'
 const more=[...document.querySelectorAll('button')].find(button=>button.textContent===pagingLabel)!
 await act(async()=>more.click())
 expect(observed).toBe(owner)
 expect(owner.getSnapshot().map(entry=>entry.key)).toEqual(['a','b','c'])
 expect(mocks.call.mock.calls.filter(([op])=>op==='team.app.timeline')).toHaveLength(2)
 expect(mocks.call.mock.calls.filter(([op])=>op==='team.app.preflight')).toHaveLength(0)
 const read=mocks.call.getMockImplementation()!
 mocks.call.mockImplementation((op:string,...args:unknown[])=>op==='team.app.timeline'?new Promise(()=>{}):read(op,...args))
 await act(async()=>invalidateTeamMessages('test:42',false,{kind:'team.message.changed',conversationKeys:[conversation.key],messageKey:'b'}))
 expect(owner.getSnapshot().map(entry=>entry.key)).toEqual(['a','b','c'])
 expect(owner.getSnapshot()[1]).toMatchObject({key:'b',revalidating:true,version:'2'})
 mocks.call.mockImplementation(read)
 await act(async()=>root.render(render({...conversation,key:'other-conversation',ref:'other-conversation-ref'})))
 expect(observed).not.toBe(owner)
 expect(owner.getSnapshot().map(entry=>entry.key)).toEqual(['a','c'])
 expect(observed!.getSnapshot().map(entry=>entry.key)).toEqual(['other'])
 await act(async()=>root.render(null))
 expect(owner.getSnapshot().map(entry=>entry.key)).toEqual(['a','c'])
})
