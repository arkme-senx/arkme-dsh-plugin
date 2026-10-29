// @vitest-environment jsdom
import {act, useContext} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {TeamMessageContent} from '../src/client/TeamMessageContent.js'
import {ArkmeMediaAccessContext, type ArkmeMediaAccess} from '../src/client/media-access.js'
import {openSessionAttachmentPreview} from '../src/client/ArkmeRichContent.js'
import {closeAttachmentPreview} from '../src/client/attachment-preview-window.js'
import {bindAttachmentPreviewAccount} from '../src/client/attachment-preview-auth-binding.js'
import {arkmeAuthStore} from '../src/client/auth-store.js'
import {invalidateTeamMessages} from '../src/client/team-messaging-events.js'
import type {TeamMessage} from '../src/team-app-contract.js'
const call = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({callArkme:call}))
let access: ArkmeMediaAccess | undefined
vi.mock('../src/client/ArkmeRichContent.js', async original => ({
  ...await original<typeof import('../src/client/ArkmeRichContent.js')>(),
  ArkmeMessageContent: () => {access=useContext(ArkmeMediaAccessContext);return null},
}))
vi.mock('../src/client/ArkmeFileViewer.js', async original => ({
  ...await original<typeof import('../src/client/ArkmeFileViewer.js')>(),
  ArkmeFileViewer: () => <video src="blob:authorized-preview" data-preview="original" />,
}))
const message: TeamMessage = {ref:'message-ref',key:'message-key',seq:1,revision:1,side:'team',sender:{nickname:'同事'},own:false,state:'published',createdAt:1,canEdit:false,canDelete:false,version:3,contentStatus:'available',media:[{key:'asset-key',ref:'asset-ref',url:'/authorized-media',name:'原附件.pdf',mimeType:'application/pdf',size:3,kind:2}]}
const block={kind:'file' as const,mediaRef:'asset-ref',fileName:'原附件.pdf',mimeType:'application/pdf',size:3,sortOrder:0}
let root:Root,host:HTMLDivElement,doc:Document,child:{closed:boolean},unbind:()=>void
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{})
 vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{})
 arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:42})
 unbind=bindAttachmentPreviewAccount()
 doc=document.implementation.createHTMLDocument('preview')
 const events=new EventTarget()
 child={document:doc,closed:false,focus(){},close(){this.closed=true;events.dispatchEvent(new Event('beforeunload'))},addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)} as typeof child
 vi.spyOn(window,'open').mockImplementation(()=>child as unknown as Window)
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
 call.mockReset();call.mockResolvedValue([message])
})
afterEach(async()=>{await act(async()=>{closeAttachmentPreview();root.unmount();unbind()});host.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
async function open(){
 await act(async()=>root.render(<TeamMessageContent message={message} conversationRef="conversation-ref" conversationKey="conversation-key"/>))
 await act(async()=>openSessionAttachmentPreview([block],block,'message-key:message-key',false,access))
 expect(doc.querySelector('video')).not.toBeNull()
}
it('keeps the same window and media for policy, receipts, other accounts and other message hints',async()=>{
 await open();const video=doc.querySelector('video')!;video.currentTime=37;const reads=call.mock.calls.length
 await act(async()=>{
  invalidateTeamMessages('test:42',false,{kind:'team.notification-policy.changed'})
  invalidateTeamMessages('test:42',true)
  invalidateTeamMessages('test:7')
  invalidateTeamMessages('test:42',false,{kind:'team.message.changed',messageKey:'another-message'})
 })
 expect(child.closed).toBe(false)
 expect(doc.querySelector('video')).toBe(video)
 expect(video.currentTime).toBe(37)
 expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled()
 expect(call.mock.calls.length).toBe(reads)
})
it('hides matching material while checking and closes only after the source is rejected',async()=>{
 await open()
 let reject!:(error:unknown)=>void
 call.mockImplementation(()=>new Promise((_,no)=>{reject=no}))
 await act(async()=>invalidateTeamMessages('test:42',false,{kind:'team.message.changed',messageKey:message.key}))
 expect(child.closed).toBe(false)
 expect(doc.querySelector('video')).toBeNull()
 await act(async()=>reject({body:{code:'team-message_recalled',message:'消息已撤回'}}))
 expect(child.closed).toBe(true)
 expect(doc.body.textContent).not.toContain('原附件.pdf')
})
it('keeps a recoverable window on network failure and ignores a late pre-revocation success',async()=>{
 await open()
 const pending:Array<{yes(value:unknown):void;no(error:unknown):void}>=[]
 call.mockImplementation(()=>new Promise((yes,no)=>pending.push({yes,no})))
 await act(async()=>invalidateTeamMessages('test:42'))
 await act(async()=>pending[0]!.no(new Error('offline')))
 expect(child.closed).toBe(false)
 expect(doc.querySelector('video')).toBeNull()
 call.mockResolvedValue([message])
 await act(async()=>doc.querySelector<HTMLButtonElement>('button')!.click())
 expect(doc.querySelector('video')).not.toBeNull()
 call.mockImplementation(()=>new Promise((yes,no)=>pending.push({yes,no})))
 await act(async()=>invalidateTeamMessages('test:42'))
 await act(async()=>invalidateTeamMessages('test:42'))
 await act(async()=>pending.at(-1)!.no({body:{code:'team-not_accessible'}}))
 await act(async()=>pending[1]!.yes([message]))
 expect(child.closed).toBe(true)
 expect(doc.querySelector('video')).toBeNull()
})
it('closes immediately on logout without accepting an old account read',async()=>{
 await open()
 await act(async()=>arkmeAuthStore.setAuth({status:'logged-out',environment:'test'}))
 expect(child.closed).toBe(true)
})
it('does not let the replaced source lifetime close a newly selected source',async()=>{
 await open()
 let reject!:(error:unknown)=>void
 call.mockImplementationOnce(()=>new Promise((_,no)=>{reject=no}))
 await act(async()=>invalidateTeamMessages('test:42'))
 const next={...message,key:'next-message',ref:'next-ref'}
 await act(async()=>root.render(<TeamMessageContent message={next} conversationRef="conversation-ref" conversationKey="conversation-key"/>))
 await act(async()=>openSessionAttachmentPreview([block],block,'message-key:next-message',false,access))
 const video=doc.querySelector('video');expect(video).not.toBeNull()
 await act(async()=>reject({body:{code:'team-message_recalled'}}))
 expect(child.closed).toBe(false);expect(doc.querySelector('video')).toBe(video)
})
