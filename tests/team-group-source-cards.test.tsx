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
