// @vitest-environment jsdom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {TeamGroupSourceCards} from '../src/client/TeamGroupSourceCards.js'
import {arkmeComposerDraftStore,arkmeSourceComposerDraftKey} from '../src/client/composer-draft-store.js'
import {arkmeUi} from '../src/client/ui-controller.js'
import {invalidateTeamWorkspace,invalidateTeamMessages} from '../src/client/team-messaging-events.js'
import type {TeamConversation} from '../src/team-app-contract.js'
import type {ArkmeSourceItem,ArkmeTimelineItem} from '../src/types.js'
const {call}=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:call}))
const source:ArkmeSourceItem={kind:'group_chat',sourceRef:'encrypted-group-source',sourceKey:'team-admission-scope',accessKind:'team_delegation',displayName:'客户群',activeAtMillis:100,unreadCount:0}
const item={itemUid:'message',sequence:10,recordVersion:3,messageActionRef:'opaque-action',senderName:'客户',title:'',isMe:false,textContent:'请帮我看看',sendAtMillis:100,status:1,templateKind:1,displayKind:0} as ArkmeTimelineItem
const conversation={ref:'customer',key:'customer-key',side:'team',channel:{name:'Support'}} as TeamConversation
let host:HTMLDivElement,root:Root
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);call.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);arkmeComposerDraftStore.clearAccount(90)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();arkmeComposerDraftStore.clearAccount(90);vi.restoreAllMocks();vi.unstubAllGlobals()})
async function mount(){await act(async()=>root.render(<TeamGroupSourceCards accountKey="test:90" conversation={conversation}/>))}
const cards={items:[{ref:'card',key:'card-key',source,activityAt:100,latestRef:'current-occurrence'}],hasMore:false}

it('replies in the exact original group using its existing draft and leaves personal drafts and DM state untouched',async()=>{
 call.mockImplementation(async(op)=>op==='team.app.sources.locate'?{source,item}:cards)
 const open=vi.spyOn(arkmeUi,'selectSource').mockImplementation(()=>{})
 const groupKey=arkmeSourceComposerDraftKey(90,source),personalKey=arkmeSourceComposerDraftKey(90,{...source,sourceKey:'personal-scope'})
 arkmeComposerDraftStore.setText(groupKey,'团队草稿');arkmeComposerDraftStore.setText(personalKey,'个人草稿')
 await mount()
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='回复到此群')!.click())
 expect(call).toHaveBeenCalledWith('team.app.sources.locate',{expectedAccountKey:'test:90',anchorRef:'current-occurrence'},expect.any(AbortSignal))
 expect(arkmeComposerDraftStore.get(groupKey)).toMatchObject({text:'团队草稿',extensionTarget:{item:{itemUid:'message',messageActionRef:'opaque-action'}}})
 expect(arkmeComposerDraftStore.get(personalKey).text).toBe('个人草稿')
 expect(open).toHaveBeenCalledWith(source,true)
 expect(call.mock.calls.every(([op])=>['team.app.sources.cards','team.app.sources.locate'].includes(op))).toBe(true)
})

it('rejects revoked source replies and discovers the first source of an already open DM through workspace hints',async()=>{
 let hasSource=false
 call.mockImplementation(async(op)=>{if(op==='team.app.sources.locate')throw new Error('来源权限已变化');return hasSource?cards:{items:[],hasMore:false}})
 const open=vi.spyOn(arkmeUi,'selectSource').mockImplementation(()=>{})
 await mount();expect(host.textContent).toBe('')
 const before=call.mock.calls.length
 await act(async()=>invalidateTeamMessages('test:90',false,{kind:'team.message.changed'}))
 expect(call).toHaveBeenCalledTimes(before)
 hasSource=true
 await act(async()=>invalidateTeamWorkspace('test:90'))
 expect(host.textContent).toContain('客户群')
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='回复到此群')!.click())
 expect(host.querySelector('[role="alert"]')?.textContent).toContain('来源权限已变化')
 expect(open).not.toHaveBeenCalled()
 expect(arkmeComposerDraftStore.get(arkmeSourceComposerDraftKey(90,source)).extensionTarget).toBeUndefined()
})

it('does not drop the first source change while an empty older response is pending',async()=>{
 let release!:(v:typeof cards)=>void,reads=0
 const pending=new Promise<typeof cards>(resolve=>{release=resolve})
 call.mockImplementation(async op=>op==='team.app.sources.cards'?(++reads===1?pending:cards):cards)
 await mount()
 await act(async()=>invalidateTeamWorkspace('test:90'))
 await act(async()=>release({...cards,items:[]}))
 expect(reads,'the source hint needs a head read after the older request').toBe(2)
 expect(host.textContent).toContain('客户群')
})


it('drains one coalesced source refresh after an in-flight reply locate',async()=>{
 let release!:(v:{source:ArkmeSourceItem;item:ArkmeTimelineItem})=>void,reads=0
 const locate=new Promise<{source:ArkmeSourceItem;item:ArkmeTimelineItem}>(resolve=>{release=resolve})
 call.mockImplementation(async op=>op==='team.app.sources.locate'?locate:(++reads===1?cards:{...cards,items:[]}))
 const open=vi.spyOn(arkmeUi,'selectSource').mockImplementation(()=>{})
 await mount()
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='回复到此群')!.click())
 await act(async()=>{for(let i=0;i<5;i++)invalidateTeamWorkspace('test:90')})
 expect(reads).toBe(1)
 await act(async()=>release({source,item}))
 expect(reads).toBe(2)
 expect(open).toHaveBeenCalledWith(source,true)
 expect(host.textContent).toBe('')
 expect(arkmeComposerDraftStore.get(arkmeSourceComposerDraftKey(90,source)).extensionTarget?.item.itemUid).toBe('message')
})

it('replaces the head after a failed pending cursor instead of losing its hints',async()=>{
 let reject!:(e:Error)=>void,reads=0
 const pending=new Promise<typeof cards>((_,fail)=>{reject=fail})
 call.mockImplementation(async op=>++reads===1?{...cards,hasMore:true,nextCursor:'older'}:reads===2?pending:{...cards,items:[]})
 await mount()
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='更多来源群')!.click())
 await act(async()=>{invalidateTeamWorkspace('test:90');window.dispatchEvent(new Event('focus'))})
 expect(reads).toBe(2)
 await act(async()=>reject(new Error('old source page failed')))
 expect(reads).toBe(3)
 expect(call.mock.calls.map(([,params])=>params.cursor)).toEqual([undefined,'older',undefined])
 expect(host.textContent).toBe('')
})

it('isolates a changed conversation from an old response and queued hints',async()=>{
 let release!:(p:typeof cards)=>void
 const pending=new Promise<typeof cards>(resolve=>{release=resolve})
 call.mockImplementation(async(op,params)=>params.conversationRef==='customer'?pending:{...cards,items:[]})
 await mount()
 await act(async()=>invalidateTeamWorkspace('test:90'))
 const signal=call.mock.calls[0]![2] as AbortSignal
 await act(async()=>root.render(<TeamGroupSourceCards key="test:90:other-key" accountKey="test:90" conversation={{...conversation,key:'other-key',ref:'other-customer'}}/>))
 expect(signal.aborted).toBe(true)
 await act(async()=>release(cards))
 expect(call.mock.calls.map(([,params])=>params.conversationRef)).toEqual(['customer','other-customer'])
 expect(host.textContent).toBe('')
})

it('does not drain or navigate after the source owner is unmounted',async()=>{
 let release!:(v:{source:ArkmeSourceItem;item:ArkmeTimelineItem})=>void,reads=0
 const locate=new Promise<{source:ArkmeSourceItem;item:ArkmeTimelineItem}>(resolve=>{release=resolve})
 call.mockImplementation(async op=>op==='team.app.sources.locate'?locate:(reads++,cards))
 const open=vi.spyOn(arkmeUi,'selectSource').mockImplementation(()=>{})
 await mount()
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='回复到此群')!.click())
 await act(async()=>invalidateTeamWorkspace('test:90'))
 await act(async()=>root.render(null))
 await act(async()=>release({source,item}))
 expect(reads).toBe(1)
 expect(open).not.toHaveBeenCalled()
 expect(arkmeComposerDraftStore.get(arkmeSourceComposerDraftKey(90,source)).extensionTarget).toBeUndefined()
})


it('keeps visible source cards while a same-conversation reference rotates',async()=>{
 let release!:(p:typeof cards)=>void,reads=0
 const pending=new Promise<typeof cards>(resolve=>{release=resolve})
 call.mockImplementation(async()=>++reads===1?cards:pending)
 await mount()
 await act(async()=>root.render(<TeamGroupSourceCards accountKey="test:90" conversation={{...conversation,ref:'rotated-ref'}}/>))
 expect(reads).toBe(2)
 expect(host.textContent).toContain('客户群')
 await act(async()=>release({...cards,items:[]}))
 expect(host.textContent).toBe('')
})
