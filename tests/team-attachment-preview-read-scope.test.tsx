// @vitest-environment jsdom
import {act, StrictMode, useContext} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {TeamMessageContent} from '../src/client/TeamMessageContent.js'
import {ArkmeMediaAccessContext, type ArkmeMediaAccess} from '../src/client/media-access.js'
import {ArkmeMediaPreview, openSessionAttachmentPreview} from '../src/client/ArkmeRichContent.js'
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
let clipboardDescriptor:PropertyDescriptor|undefined
beforeEach(()=>{
 clipboardDescriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard')
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
afterEach(async()=>{await act(async()=>{closeAttachmentPreview();root.unmount();unbind()});host.remove();if(clipboardDescriptor)Object.defineProperty(navigator,'clipboard',clipboardDescriptor);else Reflect.deleteProperty(navigator,'clipboard');vi.restoreAllMocks();vi.unstubAllGlobals()})
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
it('retains one confirmed source read while navigating its images and reopening an equivalent source snapshot',async()=>{
 await act(async()=>root.render(<TeamMessageContent message={message} conversationRef="conversation-ref" conversationKey="conversation-key"/>))
 const images=[{...block,kind:'image' as const,fileName:'first.png',mimeType:'image/png'},{...block,kind:'image' as const,mediaRef:'second-ref',fileName:'second.png',mimeType:'image/png'}]
 await act(async()=>openSessionAttachmentPreview(images,images[0]!,'message-key:message-key',false,access))
 expect(call).toHaveBeenCalledTimes(1)
 await act(async()=>doc.querySelector<HTMLButtonElement>('button[aria-label="下一个媒体"]')!.click())
 expect(doc.querySelector('img[alt="second.png"]')).not.toBeNull()
 expect(call).toHaveBeenCalledTimes(1)
 await act(async()=>doc.querySelector<HTMLButtonElement>('button[aria-label="上一个媒体"]')!.click())
 expect(doc.querySelector('img[alt="first.png"]')).not.toBeNull()
 expect(call).toHaveBeenCalledTimes(1)
 await act(async()=>root.render(<TeamMessageContent message={{...message,ref:'renewed-message-ref'}} conversationRef="renewed-conversation-ref" conversationKey="conversation-key"/>))
 await act(async()=>openSessionAttachmentPreview(images,images[1]!,'message-key:message-key',false,access))
 expect(call).toHaveBeenCalledTimes(1)
 await act(async()=>root.render(<TeamMessageContent message={{...message,version:4}} conversationRef="conversation-ref" conversationKey="conversation-key"/>))
 await act(async()=>openSessionAttachmentPreview(images,images[0]!,'message-key:message-key',false,access))
 expect(call).toHaveBeenCalledTimes(2)
})
it('loads only the clicked Team image while hidden, then reveals the same element after permission succeeds',async()=>{
 let ready!:(value:unknown)=>void
 call.mockImplementation(()=>new Promise(resolve=>{ready=resolve}))
 await act(async()=>root.render(<TeamMessageContent message={message} conversationRef="conversation-ref" conversationKey="conversation-key"/>))
 const focus=vi.spyOn(HTMLElement.prototype,'focus')
 const image={...block,kind:'image' as const,fileName:'first.png',mimeType:'image/png'}
 await act(async()=>openSessionAttachmentPreview([image],image,'image-source',false,access))
 const element=doc.querySelector('img[alt="first.png"]')!
 expect(element).not.toBeNull();expect(element.closest('[hidden]')).not.toBeNull()
 expect(doc.activeElement?.getAttribute('role')).not.toBe('dialog')
 expect(focus).not.toHaveBeenCalled()
 expect(doc.body.style.overflow).not.toBe('hidden')
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
 await act(async()=>doc.querySelector<HTMLButtonElement>('button[aria-label="复制图片"]')!.click())
 expect(fetch).not.toHaveBeenCalled()
 await act(async()=>ready([message]))
 expect(doc.querySelector('img[alt="first.png"]')).toBe(element)
 expect(element.closest('[hidden]')).toBeNull()
 expect(focus.mock.contexts).toContain(doc.querySelector('[role="dialog"]'))
 await act(async()=>invalidateTeamMessages('test:42'))
 expect(doc.querySelector('img[alt="first.png"]')).toBeNull()
 expect(element.hasAttribute('src')).toBe(false)
})
it('discards a hidden image on failed permission, retries safely, and closes a revoked pending scope',async()=>{
 const pending:Array<{resolve(value:unknown):void;reject(reason:unknown):void}>=[]
 call.mockImplementation(()=>new Promise((resolve,reject)=>pending.push({resolve,reject})))
 await act(async()=>root.render(<TeamMessageContent message={message} conversationRef="conversation-ref" conversationKey="conversation-key"/>))
 const image={...block,kind:'image' as const,fileName:'first.png',mimeType:'image/png'}
 await act(async()=>openSessionAttachmentPreview([image],image,'image-source',false,access))
 const element=doc.querySelector('img[alt="first.png"]')!
 expect(element).not.toBeNull()
 await act(async()=>pending[0]!.reject(new Error('offline')))
 expect(doc.querySelector('img[alt="first.png"]')).toBeNull();expect(element.hasAttribute('src')).toBe(false)
 await act(async()=>doc.querySelector<HTMLButtonElement>('button')!.click())
 await act(async()=>pending[1]!.resolve([message]))
 expect(doc.querySelector('img[alt="first.png"]')).not.toBeNull()
 await act(async()=>invalidateTeamMessages('test:42'))
 await act(async()=>pending[2]!.reject({body:{code:'team-not_accessible'}}))
 expect(child.closed).toBe(true)
})
it.each(['video','file','force-image'] as const)('keeps %s behind the original preflight gate',async kind=>{
 call.mockImplementation(()=>new Promise(()=>{}))
 await act(async()=>root.render(<TeamMessageContent message={message} conversationRef="conversation-ref" conversationKey="conversation-key"/>))
 const selected={...block,kind:kind==='force-image'?'image' as const:kind,fileName:'asset.png',mimeType:'image/png'}
 await act(async()=>openSessionAttachmentPreview([selected],selected,'gated-source',kind==='force-image',access))
 expect(doc.querySelector('img,video,audio,[role="dialog"]')).toBeNull()
 expect(call).toHaveBeenCalledTimes(1)
})
it('removes failed image bytes before a late successful preflight, with retry and sibling navigation intact',async()=>{
 let ready!:(value:unknown)=>void
 call.mockImplementation(()=>new Promise(resolve=>{ready=resolve}))
 await act(async()=>root.render(<TeamMessageContent message={message} conversationRef="conversation-ref" conversationKey="conversation-key"/>))
 const images=[{...block,kind:'image' as const,fileName:'first.png',mimeType:'image/png'},{...block,kind:'image' as const,mediaRef:'second-ref',fileName:'second.png',mimeType:'image/png'}]
 await act(async()=>openSessionAttachmentPreview(images,images[0]!,'image-source',false,access))
 const old=doc.querySelector('img[alt="first.png"]')!
 await act(async()=>old.dispatchEvent(new Event('error')))
 expect(doc.querySelector('img[alt="first.png"]')).toBeNull();expect(old.hasAttribute('src')).toBe(false)
 await act(async()=>ready([message]))
 expect(doc.querySelector('[role="alert"]')?.textContent).toContain('图片加载失败')
 expect([...doc.querySelectorAll('button')].some(button=>button.textContent==='关闭预览')).toBe(true)
 await act(async()=>doc.querySelector<HTMLButtonElement>('[role="alert"] button')!.click())
 const retry=doc.querySelector('img[alt="first.png"]')!;expect(retry).not.toBe(old)
 await act(async()=>retry.dispatchEvent(new Event('error')))
 await act(async()=>doc.querySelector<HTMLButtonElement>('button[aria-label="下一个媒体"]')!.click())
 expect(doc.querySelector('img[alt="second.png"]')).not.toBeNull();expect(call).toHaveBeenCalledTimes(1)
 await act(async()=>doc.querySelector('img[alt="second.png"]')!.dispatchEvent(new Event('error')))
 await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})))
 expect(child.closed).toBe(true)
})
it('resets permission synchronously for the same asset in a different scope, and discards late reads on logout',async()=>{
 await act(async()=>root.render(<TeamMessageContent message={message} conversationRef="conversation-ref" conversationKey="conversation-key"/>))
 const image={...block,kind:'image' as const,fileName:'first.png',mimeType:'image/png'}
 await act(async()=>openSessionAttachmentPreview([image],image,'same-source',false,access))
 const old=doc.querySelector('img[alt="first.png"]')!
 let ready!:(value:unknown)=>void;call.mockImplementation(()=>new Promise(resolve=>{ready=resolve}))
 await act(async()=>root.render(<TeamMessageContent message={{...message,version:4}} conversationRef="conversation-ref" conversationKey="conversation-key"/>))
 await act(async()=>openSessionAttachmentPreview([image],image,'same-source',false,access))
 const next=doc.querySelector('img[alt="first.png"]')!;expect(next).not.toBe(old);expect(next.closest('[hidden]')).not.toBeNull()
 expect(old.hasAttribute('src')).toBe(false)
 const signal=call.mock.calls.at(-1)![2] as AbortSignal
 await act(async()=>arkmeAuthStore.setAuth({status:'logged-out',environment:'test'}))
 expect(signal.aborted).toBe(true);expect(child.closed).toBe(true);expect(next.hasAttribute('src')).toBe(false)
 await act(async()=>ready([message]));expect(doc.querySelector('img[alt="first.png"]')).toBeNull()
})
it('aborts an active image copy when source access changes, before any late bytes reach the clipboard',async()=>{
 await act(async()=>root.render(<TeamMessageContent message={message} conversationRef="conversation-ref" conversationKey="conversation-key"/>))
 const image={...block,kind:'image' as const,fileName:'first.png',mimeType:'image/png'}
 await act(async()=>openSessionAttachmentPreview([image],image,'image-source',false,access))
 let resolve!:(value:Response)=>void
 const fetch=vi.fn(()=>new Promise<Response>(yes=>{resolve=yes}));vi.stubGlobal('fetch',fetch)
 class Item {constructor(readonly values:Record<string,Promise<Blob>>){}}
 vi.stubGlobal('ClipboardItem',Item)
 let completed=0;const write=vi.fn(async(items:Item[])=>{await items[0]!.values['image/png'];completed++})
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write}})
 await act(async()=>doc.querySelector<HTMLButtonElement>('button[aria-label="复制图片"]')!.click())
 expect(fetch).toHaveBeenCalledTimes(1)
 const signal=(fetch.mock.calls[0] as unknown as [string,RequestInit])[1].signal!
 call.mockImplementation(()=>new Promise(()=>{}))
 await act(async()=>invalidateTeamMessages('test:42'))
 expect(signal.aborted).toBe(true);expect(doc.querySelector('img[alt="first.png"]')).toBeNull()
 await act(async()=>resolve(new Response(new Blob(['late']),{status:200})))
 expect(completed).toBe(0)
})
it('cannot let an old preflight close a newly selected version before React commits the replacement',async()=>{
 const pending:Array<{resolve(value:unknown):void;reject(reason:unknown):void}>=[]
 call.mockImplementation(()=>new Promise((resolve,reject)=>pending.push({resolve,reject})))
 await act(async()=>root.render(<TeamMessageContent message={message} conversationRef="conversation-ref" conversationKey="conversation-key"/>))
 const image={...block,kind:'image' as const,fileName:'first.png',mimeType:'image/png'}
 await act(async()=>openSessionAttachmentPreview([image],image,'same-source',false,access))
 await act(async()=>root.render(<TeamMessageContent message={{...message,version:4}} conversationRef="conversation-ref" conversationKey="conversation-key"/>))
 await act(async()=>{
  openSessionAttachmentPreview([image],image,'same-source',false,access)
  pending[0]!.reject({body:{code:'team-version_conflict'}})
  await Promise.resolve();await Promise.resolve()
 })
 expect(child.closed).toBe(false)
 expect(doc.querySelector('img[alt="first.png"]')?.closest('[hidden]')).not.toBeNull()
 await act(async()=>pending.at(-1)!.resolve([message]))
 expect(doc.querySelector('img[alt="first.png"]')?.closest('[hidden]')).toBeNull()
})
it('preserves the current URL on the same real image node through StrictMode and same-asset URL refreshes',async()=>{
 const image={...block,kind:'image' as const,fileName:'first.png',mimeType:'image/png'}
 const render=(url:string)=><StrictMode><ArkmeMediaAccessContext.Provider value={{url:()=>url}}><ArkmeMediaPreview blocks={[image]} selected={image} onSelect={()=>{}} onClose={()=>{}} /></ArkmeMediaAccessContext.Provider></StrictMode>
 await act(async()=>root.render(render('/image-a')))
 const element=host.querySelector('img[alt="first.png"]')!
 expect(element.getAttribute('src')).toBe('/image-a')
 for(const url of ['/image-b','/image-a']){
  await act(async()=>root.render(render(url)))
  expect(host.querySelector('img[alt="first.png"]')).toBe(element)
  expect(element.getAttribute('src')).toBe(url)
 }
 await act(async()=>root.render(null))
 expect(element.hasAttribute('src')).toBe(false)
})
