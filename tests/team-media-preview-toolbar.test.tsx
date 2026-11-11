// @vitest-environment jsdom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {TeamMessageContent,teamAttachmentNavigationEntries} from '../src/client/TeamMessageContent.js'
import {ArkmeAttachmentNavigationProvider} from '../src/client/attachment-preview-navigation.js'
import {arkmeAuthStore} from '../src/client/auth-store.js'
import {invalidateTeamMessages} from '../src/client/team-messaging-events.js'
import {closeAttachmentPreview} from '../src/client/attachment-preview-window.js'
import {openSessionAttachmentPreview} from '../src/client/ArkmeRichContent.js'
import {bindAttachmentPreviewAccount} from '../src/client/attachment-preview-auth-binding.js'
import type {TeamMessage} from '../src/team-app-contract.js'
import type {ArkmeContentBlock} from '../src/types.js'

const call=vi.hoisted(()=>vi.fn())
vi.mock('../src/client/api.js',()=>({callArkme:call}))
const message=(key:string):TeamMessage=>({key,ref:`message-${key}`,seq:key==='a'?1:2,revision:1,side:'team',sender:{nickname:'member'},own:false,state:'published',createdAt:1,canEdit:false,canDelete:false,version:3,contentStatus:'available',media:[{key:`asset-${key}`,ref:`ref-${key}`,url:`/authorized-${key}`,name:`${key}.png`,mimeType:'image/png',size:1,kind:1}]})
const messages=[message('a'),message('b')],conversation={ref:'conversation-ref',key:'conversation'}
let root:Root,host:HTMLDivElement,doc:Document,child:{closed:boolean},unbind:()=>void
let pending:Array<{resolve(value:unknown):void;reject(reason:unknown):void}>
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:42});unbind=bindAttachmentPreviewAccount()
 vi.stubGlobal('arkmeAttachmentPreview',{version:1,focus(){},close(){}})
 doc=document.implementation.createHTMLDocument('preview');const events=new EventTarget()
 child={document:doc,closed:false,focus(){},close(){this.closed=true;events.dispatchEvent(new Event('beforeunload'))},addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)} as typeof child
 vi.spyOn(window,'open').mockImplementation(()=>child as unknown as Window)
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:vi.fn()} as never)
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{})
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
 pending=[];call.mockReset();call.mockImplementation(()=>new Promise((resolve,reject)=>pending.push({resolve,reject})))
})
afterEach(async()=>{await act(async()=>{closeAttachmentPreview();root.unmount();unbind()});host.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
async function open(){
 await act(async()=>root.render(<ArkmeAttachmentNavigationProvider scopeKey="test:42:conversation" entries={teamAttachmentNavigationEntries(messages,conversation,'test:42')}>
  {messages.map(message=><TeamMessageContent key={message.key} message={message} conversationRef={conversation.ref} conversationKey={conversation.key} attachmentNavigationKey={message.key}/>)}</ArkmeAttachmentNavigationProvider>))
 const image=host.querySelector<HTMLImageElement>('img[alt="a.png"]')!
 Object.defineProperties(image,{complete:{configurable:true,value:true},naturalWidth:{configurable:true,value:4000},naturalHeight:{configurable:true,value:3000},currentSrc:{configurable:true,get(){return image.src}}})
 await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="预览图片 a.png"]')!.click())
 return image
}
const button=(name:string)=>doc.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!
const visible=(node:Element)=>!node.closest('[hidden],[aria-hidden="true"]')
const click=async(node:HTMLElement)=>{await act(async()=>node.click())}

it('shows the shared toolbar with immediate Team pixels, allowing navigation while copy and download wait for authorization',async()=>{
 await open()
 expect(doc.querySelector('[data-arkme-presented-image]')).not.toBeNull()
 const toolbar=doc.querySelector('[data-arkme-media-preview-actions="bottom"]')!
 expect(visible(toolbar)).toBe(true)
 expect(button('上一个媒体').disabled).toBe(true)
 expect(button('下一个媒体').disabled).toBe(false)
 expect(button('复制图片').matches(':disabled')).toBe(true)
 expect(button('下载图片').matches(':disabled')).toBe(true)
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
 await click(button('复制图片'));await click(button('下载图片'))
 expect(fetch).not.toHaveBeenCalled();expect(call).toHaveBeenCalledTimes(1)
 const oldSignal=call.mock.calls[0]![2] as AbortSignal
 await click(button('下一个媒体'))
 expect(oldSignal.aborted).toBe(true)
 expect(call).toHaveBeenCalledTimes(2)
 expect(call.mock.calls[1]![1]).toMatchObject({selections:[{messageRef:'message-b',version:3}]})
 expect(doc.querySelector('img[alt="b.png"]')).not.toBeNull()
 await act(async()=>pending[0]!.resolve([messages[0]]))
 expect(button('复制图片').matches(':disabled')).toBe(true)
})

it('enables existing actions after authorization without waiting for the new image to load',async()=>{
 await open()
 const toolbar=doc.querySelector('[data-arkme-media-preview-actions="bottom"]')!
 const original=doc.querySelector<HTMLImageElement>('img[alt="a.png"]')!
 await act(async()=>pending[0]!.resolve([messages[0]]))
 expect(doc.querySelector('[data-arkme-presented-image]')).not.toBeNull()
 expect(visible(toolbar)).toBe(true)
 expect(button('复制图片').matches(':disabled')).toBe(false)
 expect(button('下载图片').matches(':disabled')).toBe(false)
 expect(original.closest('[hidden]')).not.toBeNull()
 await act(async()=>original.dispatchEvent(new Event('load')))
 expect(doc.querySelector('[data-arkme-presented-image]')).toBeNull()
 expect(doc.querySelector('[data-arkme-media-preview-actions="bottom"]')).toBe(toolbar)
 expect(visible(original)).toBe(true)
})

it('removes invalidated pixels and active actions while retaining navigation to a different message',async()=>{
 await open();await act(async()=>pending[0]!.resolve([messages[0]]))
 const original=doc.querySelector<HTMLImageElement>('img[alt="a.png"]')!
 await act(async()=>original.dispatchEvent(new Event('load')))
 await act(async()=>invalidateTeamMessages('test:42',false,{kind:'team.message.changed',messageKey:'a'}))
 expect(doc.querySelector('[data-arkme-presented-image],img[alt="a.png"]')).toBeNull()
 expect(doc.querySelector('button[aria-label="复制图片"]')).toBeNull()
 expect(button('下一个媒体')).not.toBeNull()
 expect(button('下一个媒体').disabled).toBe(false)
 await click(button('下一个媒体'))
 expect(call.mock.calls.at(-1)![1]).toMatchObject({selections:[{messageRef:'message-b',version:3}]})
 await act(async()=>pending[1]!.reject({body:{code:'team-not_accessible'}}))
 expect(child.closed).toBe(false)
 expect(doc.querySelector('img[alt="b.png"]')).not.toBeNull()
})

it.each(['original','local','dynamic'] as const)('retains safe first pixels for a %s image without starting its separate loading owner early',async kind=>{
 const image=await open()
 await act(async()=>closeAttachmentPreview())
 const entry=teamAttachmentNavigationEntries(messages,conversation,'test:42')[0]!
 const block:ArkmeContentBlock={...entry.blocks[0]!,...(kind==='original'?{originalRef:'arkme-media-v1.original'}
  :kind==='local'?{localFileRef:'arkme-file-v1.local'}:{dynamicPhoto:{logicalUid:'live-photo'}})}
 const access={...entry.mediaAccess!,imagePresentation:{current:()=>true,subscribeInvalidation:()=>()=>{}}}
 const reads=call.mock.calls.length
 await act(async()=>openSessionAttachmentPreview([block],block,'non-prepare',false,access,image))
 expect(doc.querySelector('[data-arkme-presented-image]')).not.toBeNull()
 expect(doc.querySelector('img,video,button[aria-label="复制图片"]')).toBeNull()
 expect(call.mock.calls.slice(reads).map(([operation])=>operation)).toEqual(['team.app.preflight'])
})
