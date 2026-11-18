// @vitest-environment jsdom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {TeamMessageContent,teamAttachmentNavigationEntries} from '../src/client/TeamMessageContent.js'
import {ArkmeAttachmentNavigationProvider} from '../src/client/attachment-preview-navigation.js'
import {arkmeAuthStore} from '../src/client/auth-store.js'
import {invalidateTeamMessages} from '../src/client/team-messaging-events.js'
import {closeAttachmentPreview} from '../src/client/attachment-preview-window.js'
import {bindAttachmentPreviewAccount} from '../src/client/attachment-preview-auth-binding.js'
import type {TeamMessage} from '../src/team-app-contract.js'
import {arkmeContainedImageRect} from '../src/client/ArkmeRichContent.js'


const call=vi.hoisted(()=>vi.fn())
vi.mock('../src/client/api.js',()=>({callArkme:call}))
const conversation={key:'conversation',ref:'conversation-ref'}
const message=(key:string,assets=[key]):TeamMessage=>({key,ref:`message-${key}`,seq:1,revision:1,side:'team',sender:{nickname:'Synthetic member'},own:false,state:'published',createdAt:1,canEdit:false,canDelete:false,version:3,contentStatus:'available',media:assets.map(asset=>({key:asset,ref:`ref-${asset}`,url:`/authorized-${asset}`,name:`${asset}.png`,mimeType:'image/png',size:1,kind:1}))})
let root:Root,host:HTMLDivElement,doc:Document,child:{closed:boolean},unbind:()=>void
let pending:Array<{resolve(value:unknown):void;reject(error:unknown):void;signal:AbortSignal}>
let draw:ReturnType<typeof vi.fn>
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:42});unbind=bindAttachmentPreviewAccount()
 vi.stubGlobal('arkmeAttachmentPreview',{version:1,focus(){},close(){}})
 doc=document.implementation.createHTMLDocument('preview');const events=new EventTarget()
 Object.defineProperty(doc,'visibilityState',{configurable:true,value:'visible'});vi.spyOn(doc,'hasFocus').mockReturnValue(true)
 child={document:doc,closed:false,focus(){},close(){this.closed=true;events.dispatchEvent(new Event('beforeunload'))},addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)} as typeof child
 vi.spyOn(window,'open').mockReturnValue(child as unknown as Window)
 draw=vi.fn();vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:draw} as never)
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{})
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
 pending=[];call.mockReset();call.mockImplementation((_operation,_params,signal)=>new Promise((resolve,reject)=>pending.push({resolve,reject,signal})))
})
afterEach(async()=>{await act(async()=>{closeAttachmentPreview();root.unmount();unbind()});host.remove();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()})
async function mount(messages:TeamMessage[],visible=messages){
 await act(async()=>root.render(<ArkmeAttachmentNavigationProvider scopeKey="test:42:conversation" entries={teamAttachmentNavigationEntries(messages,conversation,'test:42')}>
  {visible.map(value=><TeamMessageContent key={value.key} message={value} conversationRef={conversation.ref} conversationKey={conversation.key} attachmentNavigationKey={value.key}/>)}
 </ArkmeAttachmentNavigationProvider>))
 for(const image of host.querySelectorAll<HTMLImageElement>('img'))Object.defineProperties(image,{complete:{configurable:true,value:true},naturalWidth:{configurable:true,value:4000},naturalHeight:{configurable:true,value:3000},currentSrc:{configurable:true,get(){return image.src}}})
}
const source=(key:string)=>host.querySelector<HTMLImageElement>(`img[alt="${key}.png"]`)!
async function open(key:string){await act(async()=>host.querySelector<HTMLButtonElement>(`button[aria-label="预览图片 ${key}.png"]`)!.click())}
async function next(){await act(async()=>doc.querySelector<HTMLButtonElement>('button[aria-label="下一个媒体"]')!.click())}
async function settle(key:string,index=0){await act(async()=>{pending[index]!.resolve([]);const image=doc.querySelector<HTMLImageElement>(`img[alt="${key}.png"]`)!;Object.defineProperties(image,{complete:{configurable:true,value:true},naturalWidth:{configurable:true,value:1600},naturalHeight:{configurable:true,value:1200},currentSrc:{configurable:true,get(){return image.src}}});image.dispatchEvent(new Event('load'))})}

const previous=async()=>{await act(async()=>doc.querySelector<HTMLButtonElement>('button[aria-label="上一个媒体"]')!.click())}
const preview=(key:string)=>doc.querySelector<HTMLImageElement>(`img[alt="${key}.png"]`)!

it('keeps the authorized current picture until the next original and fresh read are ready',async()=>{
 await mount([message('a'),message('b')],[message('a')]);await open('a');await settle('a')
 await next()
 const held=doc.querySelector<HTMLCanvasElement>('[data-arkme-transition-image]')!
 expect(held?.getAttribute('aria-label')).toBe('a.png');expect(held.width).toBe(1600)
 expect(doc.body.textContent).not.toContain('图片加载中')
 expect(preview('b').closest('[hidden]')).not.toBeNull();expect(doc.querySelector('fieldset')?.disabled).toBe(true)
 await act(async()=>pending[1]!.resolve([]))
 expect(doc.querySelector('[data-arkme-transition-image]')).toBe(held)
 await settle('b',1)
 expect(doc.querySelector('[data-arkme-transition-image]')).toBeNull();expect(held.width).toBe(0)
 expect(call).toHaveBeenCalledTimes(2)
})

it('keeps only the last displayed picture during rapid pending navigation and clears it on source invalidation',async()=>{
 const messages=[message('a'),message('b'),message('c')]
 await mount(messages,[messages[0]!]);await open('a');await settle('a');await next()
 const held=doc.querySelector<HTMLCanvasElement>('[data-arkme-transition-image]')!
 await next()
 expect(doc.querySelector('[data-arkme-transition-image]')).toBe(held)
 expect(held.getAttribute('aria-label')).toBe('a.png');expect(pending[1]!.signal.aborted).toBe(true)
 await act(async()=>{invalidateTeamMessages('test:42',false,{kind:'team.message.changed',messageKey:'a'});expect(held.width).toBe(0)})
 expect(doc.querySelector('[data-arkme-transition-image]')).toBeNull()
 expect(preview('c').closest('[hidden]')).not.toBeNull()
})

it.each(['deny','close','account'] as const)('releases transitional pixels on %s',async reason=>{
 await mount([message('a'),message('b')]);await open('a');await settle('a');await next()
 const held=doc.querySelector<HTMLCanvasElement>('[data-arkme-transition-image]')!
 expect(held.width).toBeGreaterThan(0)
 await act(async()=>{if(reason==='deny')pending[1]!.reject({body:{code:'team-not_accessible'}});else if(reason==='close')closeAttachmentPreview();else arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:43})})
 expect(held.width).toBe(0);expect(child.closed).toBe(true)
})

it('reuses the actual decoded A node without another src assignment, but repeats A authorization before displaying it',async()=>{
 await mount([message('a'),message('b')]);await open('a');await settle('a')
 const firstA=preview('a'),url=firstA.getAttribute('src')
 const assign=vi.spyOn(firstA,'setAttribute')
 await next();await settle('b',1);await previous()
 expect(preview('a')).toBe(firstA)
 expect(firstA.getAttribute('src')).toBe(url)
 expect(assign.mock.calls.filter(([name])=>name==='src')).toHaveLength(0)
 expect(call).toHaveBeenCalledTimes(3)
 expect(call.mock.calls[2]![1]).toMatchObject({selections:[{messageRef:'message-a',version:3}]})
 expect(firstA.closest('[hidden]')).not.toBeNull()
 expect(doc.querySelector('fieldset')?.disabled).toBe(true)
 await act(async()=>firstA.dispatchEvent(new Event('load')))
 expect(firstA.closest('[hidden]')).not.toBeNull()
 await act(async()=>pending[2]!.resolve([]))
 expect(firstA.closest('[hidden]')).toBeNull()
 expect(doc.querySelector('fieldset')?.disabled).toBe(false)
})

it('retains the previous two completed destinations and releases images outside that range',async()=>{
 await mount([message('a'),message('b'),message('c'),message('d')]);await open('a');await settle('a');const a=preview('a')
 await next();await settle('b',1);const b=preview('b')
 await next();await settle('c',2)
 expect(a.hasAttribute('src')).toBe(true)
 await next();await settle('d',3)
 expect(a.hasAttribute('src')).toBe(false)
 await previous();await act(async()=>pending[4]!.resolve([]))
 await previous();expect(preview('b')).toBe(b)
 await act(async()=>pending[5]!.resolve([]))
 expect(preview('b').closest('[hidden]')).toBeNull()
})

it('invalidates detached pixels immediately through the original mounted presentation owner',async()=>{
 await mount([message('a'),message('b')]);await open('a');await settle('a');const a=preview('a')
 await next();await settle('b',1)
 await act(async()=>{invalidateTeamMessages('test:42',false,{kind:'team.message.changed',messageKey:'a'});expect(a.hasAttribute('src')).toBe(false)})
 await previous();expect(preview('a')).not.toBe(a)
 expect(preview('a').closest('[hidden]')).not.toBeNull()
})

it.each(['close','account'] as const)('releases both current and detached image pixels on %s',async reason=>{
 await mount([message('a'),message('b')]);await open('a');await settle('a');const a=preview('a')
 await next();await settle('b',1);const b=preview('b')
 await act(async()=>{if(reason==='close')closeAttachmentPreview();else arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:43})})
 expect(a.hasAttribute('src')).toBe(false);expect(b.hasAttribute('src')).toBe(false);expect(child.closed).toBe(true)
})

it.each(['too-large','not-loaded','url-replaced'] as const)('does not retain %s pixels',async reason=>{
 await mount([message('a'),message('b')]);await open('a');await settle('a');const a=preview('a')
 if(reason==='too-large')Object.defineProperty(a,'naturalWidth',{value:2049})
 if(reason==='not-loaded')Object.defineProperty(a,'complete',{value:false})
 if(reason==='url-replaced')a.src='/unexpected'
 await next();await settle('b',1);await previous()
 expect(preview('a')).not.toBe(a);expect(a.hasAttribute('src')).toBe(false)
})

it('does not reuse a previous version of the same attachment key',async()=>{
 const a=message('a'),b=message('b');await mount([a,b]);await open('a');await settle('a');const firstA=preview('a')
 await next();await settle('b',1);await mount([{...a,version:4},b]);await previous()
 expect(preview('a')).not.toBe(firstA);expect(firstA.hasAttribute('src')).toBe(false)
 expect(call.mock.calls[2]![1]).toMatchObject({selections:[{messageRef:'message-a',version:4}]})
})

it('discards warm pixels when their fresh permission check rejects',async()=>{
 await mount([message('a'),message('b')]);await open('a');await settle('a');const a=preview('a')
 await next();await settle('b',1);await previous();expect(preview('a')).toBe(a)
 await act(async()=>pending[2]!.reject({body:{code:'team-not_accessible'}}))
 expect(a.hasAttribute('src')).toBe(false);expect(child.closed).toBe(true)
})

it('releases the retained image when its mounted source owner is removed',async()=>{
 const a=message('a'),b=message('b');await mount([a,b]);await open('a');await settle('a');const image=preview('a')
 await next();await settle('b',1);await mount([a,b],[b])
 expect(image.hasAttribute('src')).toBe(false)
 await previous();expect(preview('a')).not.toBe(image)
})

it('uses the new grant for warm preflight while retaining the equivalent displayed asset',async()=>{
 const a=message('a'),b=message('b');await mount([a,b]);await open('a');await settle('a');const image=preview('a')
 await next();await settle('b',1)
 await mount([{...a,ref:'message-a-new',media:a.media.map(asset=>({...asset,ref:'ref-a-new',url:'/new-a'}))},b])
 await previous();expect(preview('a')).toBe(image)
 expect(call.mock.calls[2]![1]).toMatchObject({selections:[{messageRef:'message-a-new',version:3}]})
 expect(image.closest('[hidden]')).not.toBeNull()
 await act(async()=>pending[2]!.resolve([]))
 expect(image.closest('[hidden]')).toBeNull()
})

it('reuses B and C first loaded only in the child when their list rows have never mounted',async()=>{
 const a=message('a'),b=message('b'),c=message('c')
 await mount([a,b,c],[a]);await open('a');await settle('a')
 await next();await settle('b',1);const imageB=preview('b'),assignB=vi.spyOn(imageB,'setAttribute')
 await next();await settle('c',2);const imageC=preview('c'),assignC=vi.spyOn(imageC,'setAttribute')
 await previous();expect(preview('b')).toBe(imageB)
 expect(imageB.closest('[hidden]')).not.toBeNull();expect(doc.querySelector('fieldset')?.disabled).toBe(true)
 await act(async()=>{imageB.dispatchEvent(new Event('load'));expect(imageB.closest('[hidden]')).not.toBeNull();pending[3]!.resolve([])})
 expect(imageB.closest('[hidden]')).toBeNull()
 await next();expect(preview('c')).toBe(imageC);expect(imageC.closest('[hidden]')).not.toBeNull()
 await act(async()=>pending[4]!.resolve([]))
 expect(imageC.closest('[hidden]')).toBeNull()
 expect(assignB.mock.calls.filter(([key])=>key==='src')).toHaveLength(0)
 expect(assignC.mock.calls.filter(([key])=>key==='src')).toHaveLength(0)
 expect(call.mock.calls.map(([,params])=>params.selections[0].messageRef)).toEqual(['message-a','message-b','message-c','message-b','message-c'])
})

it('clears a child-only retained image when its navigation entry starts revalidating',async()=>{
 const a=message('a'),b=message('b'),c=message('c')
 await mount([a,b,c],[a]);await open('a');await settle('a')
 await next();await settle('b',1);const imageB=preview('b')
 await next();await settle('c',2);expect(imageB.hasAttribute('src')).toBe(true)
 await mount([a,{...b,contentStatus:'revalidating',media:[]},c],[a])
 expect(imageB.hasAttribute('src')).toBe(false);expect(child.closed).toBe(false)
})

it('clears child-only retained pixels when the navigation provider detaches while leaving the current independent image open',async()=>{
 const a=message('a'),b=message('b'),c=message('c')
 await mount([a,b,c],[a]);await open('a');await settle('a')
 await next();await settle('b',1);const imageB=preview('b')
 await next();await settle('c',2);const imageC=preview('c')
 expect(imageB.hasAttribute('src')).toBe(true)
 await act(async()=>root.render(null))
 expect(imageB.hasAttribute('src')).toBe(false);expect(imageC.hasAttribute('src')).toBe(true);expect(child.closed).toBe(false)
})

it.each(['deny','account','version','removed'] as const)('does not reuse child-only pixels across %s invalidation',async reason=>{
 const a=message('a'),b=message('b'),c=message('c')
 await mount([a,b,c],[a]);await open('a');await settle('a')
 await next();await settle('b',1);const imageB=preview('b')
 await next();await settle('c',2)
 expect(imageB.hasAttribute('src')).toBe(true)
 if(reason==='deny'){
  await previous();expect(preview('b')).toBe(imageB)
  await act(async()=>imageB.dispatchEvent(new Event('load')))
  expect(imageB.closest('[hidden]')).not.toBeNull()
  await act(async()=>pending[3]!.reject({body:{code:'team-not_accessible'}}))
  expect(child.closed).toBe(true)
 }else if(reason==='account'){
  await act(async()=>arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:43}))
  expect(child.closed).toBe(true)
 }else if(reason==='version'){
  await mount([a,{...b,version:4},c],[a]);await previous()
  expect(preview('b')).not.toBe(imageB)
  expect(call.mock.calls[3]![1]).toMatchObject({selections:[{messageRef:'message-b',version:4}]})
 }else{
  await mount([a,c],[a]);await previous()
  expect(preview('b')).toBeNull();expect(preview('a')).not.toBeNull()
 }
 expect(imageB.hasAttribute('src')).toBe(false)
})
