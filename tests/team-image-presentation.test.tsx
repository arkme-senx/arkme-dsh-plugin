// @vitest-environment jsdom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {TeamMessageContent} from '../src/client/TeamMessageContent.js'
import {arkmeAuthStore} from '../src/client/auth-store.js'
import {invalidateTeamMessages} from '../src/client/team-messaging-events.js'
import {closeAttachmentPreview} from '../src/client/attachment-preview-window.js'
import {bindAttachmentPreviewAccount} from '../src/client/attachment-preview-auth-binding.js'
import type {TeamMessage} from '../src/team-app-contract.js'
const call=vi.hoisted(()=>vi.fn())
vi.mock('../src/client/api.js',()=>({callArkme:call}))
const message:TeamMessage={key:'message',ref:'message-ref',seq:1,revision:1,side:'team',sender:{nickname:'member'},own:false,state:'published',createdAt:1,canEdit:false,canDelete:false,version:3,contentStatus:'available',media:[{key:'asset',ref:'asset-ref',url:'/authorized-image',name:'photo.png',mimeType:'image/png',size:1,kind:1}]}
let root:Root,host:HTMLDivElement,doc:Document,child:{closed:boolean},unbind:()=>void
let pending:Array<{resolve(value:unknown):void;reject(reason:unknown):void}>
let draw:ReturnType<typeof vi.fn>
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:42});unbind=bindAttachmentPreviewAccount()
 vi.stubGlobal('arkmeAttachmentPreview',{version:1,focus(){},close(){}})
 doc=document.implementation.createHTMLDocument('preview');const events=new EventTarget()
 child={document:doc,closed:false,focus(){},close(){this.closed=true;events.dispatchEvent(new Event('beforeunload'))},addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)} as typeof child
 vi.spyOn(window,'open').mockImplementation(()=>child as unknown as Window)
 draw=vi.fn();vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:draw} as never)
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{})
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
 pending=[];call.mockReset();call.mockImplementation(()=>new Promise((resolve,reject)=>pending.push({resolve,reject})))
})
afterEach(async()=>{await act(async()=>{closeAttachmentPreview();root.unmount();unbind()});host.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
async function mount(loaded=true){
 await act(async()=>root.render(<TeamMessageContent message={message} conversationRef="conversation-ref" conversationKey="conversation"/>))
 const image=host.querySelector('img[alt="photo.png"]')! as HTMLImageElement
 Object.defineProperties(image,{complete:{configurable:true,value:loaded},naturalWidth:{configurable:true,value:loaded?4000:0},naturalHeight:{configurable:true,value:loaded?3000:0},currentSrc:{configurable:true,get(){return image.src}}})
 return image
}
async function open(){await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="预览图片 photo.png"]')!.click())}
it('continues bounded visible pixels immediately without a new grant, and keeps them until both original load and preflight complete',async()=>{
 const source=await mount();expect(call).not.toHaveBeenCalled();await open()
 const canvas=doc.querySelector<HTMLCanvasElement>('[data-arkme-presented-image]')!
 expect(canvas).not.toBeNull();expect(canvas.width).toBe(640);expect(canvas.height).toBe(480)
 expect(canvas.getAttribute('role')).toBe('img');expect(canvas.getAttribute('aria-label')).toBe('photo.png')
 expect(doc.querySelector('p[role="status"]')).toBeNull()
 expect(canvas.closest('[hidden]')).toBeNull();expect(draw).toHaveBeenCalledWith(source,0,0,640,480)
 expect(call).toHaveBeenCalledTimes(1)
 expect(doc.querySelector('img[alt="photo.png"]')?.closest('[hidden]')).not.toBeNull()
 await act(async()=>pending[0]!.resolve([message]))
 expect(doc.querySelector('[data-arkme-presented-image]')).toBe(canvas)
 await act(async()=>doc.querySelector('img[alt="photo.png"]')!.dispatchEvent(new Event('load')))
 expect(doc.querySelector('[data-arkme-presented-image]')).toBeNull();expect(canvas.width).toBe(0);expect(canvas.height).toBe(0)
})
it('replaces the first pixels after the authorized byte load while actions still wait for preflight',async()=>{
 await mount();await open()
 const canvas=doc.querySelector<HTMLCanvasElement>('[data-arkme-presented-image]')!
 const original=doc.querySelector<HTMLImageElement>('img[alt="photo.png"]')!
 await act(async()=>original.dispatchEvent(new Event('load')))
 expect(doc.querySelector('[data-arkme-presented-image]')).toBeNull()
 expect(original.closest('[hidden][inert]')).toBeNull()
 expect(canvas.width).toBe(0);expect(doc.querySelector('fieldset')?.disabled).toBe(true)
 await act(async()=>pending[0]!.resolve([message]))
 expect(doc.querySelector('[data-arkme-presented-image]')).toBeNull()
 expect(canvas.width).toBe(0);expect(original.closest('[hidden]')).toBeNull()
})
it('checks the exact source URL again between the click and canvas layout',async()=>{
 const image=await mount()
 await act(async()=>{
  host.querySelector<HTMLButtonElement>('button[aria-label="预览图片 photo.png"]')!.click()
  image.src='/replaced-before-layout'
 })
 expect(doc.querySelector('[data-arkme-presented-image]')).toBeNull();expect(draw).not.toHaveBeenCalled()
 expect(doc.querySelector('p[role="status"]')?.textContent).toContain('图片加载中')
})
it('clears the first pixels synchronously for an invalidation while the first preflight is pending',async()=>{
 await mount();await open();const canvas=doc.querySelector<HTMLCanvasElement>('[data-arkme-presented-image]')!
 expect(canvas).not.toBeNull()
 await act(async()=>{invalidateTeamMessages('test:42',false,{kind:'team.message.changed',messageKey:message.key});expect(canvas.width).toBe(0)})
 expect(doc.querySelector('[data-arkme-presented-image]')).toBeNull()
 await act(async()=>pending[0]!.resolve([message]));expect(doc.querySelector('[data-arkme-presented-image]')).toBeNull()
})
it('does not reuse pixels after an invalidation received before React removes the old DOM',async()=>{
 await mount()
 await act(async()=>{invalidateTeamMessages('test:42',false,{kind:'team.message.changed',messageKey:message.key});host.querySelector<HTMLButtonElement>('button[aria-label="预览图片 photo.png"]')!.click()})
 expect(doc.querySelector('[data-arkme-presented-image]')).toBeNull();expect(draw).not.toHaveBeenCalled()
})
it.each(['not-loaded','url-mismatch','account-mismatch'] as const)('keeps the original gate for %s source pixels',async reason=>{
 const image=await mount(reason!=='not-loaded')
 if(reason==='url-mismatch')image.src='/wrong-image'
 if(reason==='account-mismatch')arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:7})
 await open();expect(doc.querySelector('[data-arkme-presented-image]')).toBeNull();expect(draw).not.toHaveBeenCalled()
})
