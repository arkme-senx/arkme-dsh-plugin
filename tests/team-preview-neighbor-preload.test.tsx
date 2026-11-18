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


const call=vi.hoisted(()=>vi.fn())
vi.mock('../src/client/api.js',()=>({callArkme:call}))
const conversation={key:'conversation',ref:'conversation-ref'}
const message=(key:string,assets=[key]):TeamMessage=>({key,ref:`message-${key}`,seq:1,revision:1,side:'team',sender:{nickname:'Synthetic member'},own:false,state:'published',createdAt:1,canEdit:false,canDelete:false,version:3,contentStatus:'available',media:assets.map(asset=>({key:asset,ref:`ref-${asset}`,url:`/authorized-${asset}`,name:`${asset}.png`,mimeType:'image/png',size:1,kind:1}))})
let root:Root,host:HTMLDivElement,doc:Document,child:{closed:boolean},unbind:()=>void
let pending:Array<{resolve(value:unknown):void;reject(error:unknown):void;signal:AbortSignal}>
let draw:ReturnType<typeof vi.fn>
let created:HTMLImageElement[]
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:42});unbind=bindAttachmentPreviewAccount()
 vi.stubGlobal('arkmeAttachmentPreview',{version:1,focus(){},close(){}})
 doc=document.implementation.createHTMLDocument('preview');const events=new EventTarget()
 Object.defineProperty(doc,'visibilityState',{configurable:true,value:'visible'});vi.spyOn(doc,'hasFocus').mockReturnValue(true)
 created=[];const create=doc.createElement.bind(doc);vi.spyOn(doc,'createElement').mockImplementation(((tag:string,options?:ElementCreationOptions)=>{const element=create(tag,options);if(tag==='img')created.push(element as HTMLImageElement);return element}) as typeof doc.createElement)
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
async function open(key:string){await act(async()=>host.querySelector<HTMLButtonElement>(`button[aria-label="预览图片 ${key}.png"]`)!.click())}
async function next(){await act(async()=>doc.querySelector<HTMLButtonElement>('button[aria-label="下一个媒体"]')!.click())}
async function settle(key:string,index=0){await act(async()=>{pending[index]!.resolve([]);const image=doc.querySelector<HTMLImageElement>(`img[alt="${key}.png"]`)!;Object.defineProperties(image,{complete:{configurable:true,value:true},naturalWidth:{configurable:true,value:1600},naturalHeight:{configurable:true,value:1200},currentSrc:{configurable:true,get(){return image.src}}});image.dispatchEvent(new Event('load'))})}

const previous=async()=>{await act(async()=>doc.querySelector<HTMLButtonElement>('button[aria-label="上一个媒体"]')!.click())}
const preview=(key:string)=>doc.querySelector<HTMLImageElement>(`img[alt="${key}.png"]`)!

const prepared=(key:string)=>created.find(image=>image.getAttribute('src')===`/authorized-${key}`&&!image.isConnected)
async function loaded(image:HTMLImageElement,width=1600,height=1200){await act(async()=>{Object.defineProperties(image,{complete:{configurable:true,value:true},naturalWidth:{configurable:true,value:width},naturalHeight:{configurable:true,value:height},currentSrc:{configurable:true,get(){return image.src}}});image.dispatchEvent(new Event('load'))})}

it('preloads the nearest two images on each side serially and reuses both left originals',async()=>{
 await mount(['a','b','c','d','e','f','g'].map(key=>message(key)));await open('d');await settle('d')
 const neighbors=new Map<string,HTMLImageElement>()
 for(const key of ['e','c','f','b']){
  const image=prepared(key)!;expect(image,`neighbor ${key}`).toBeDefined()
  expect(created.filter(value=>!value.isConnected&&value.hasAttribute('src')&&!value.complete)).toHaveLength(1)
  neighbors.set(key,image);await loaded(image)
 }
 expect(prepared('a')).toBeUndefined();expect(prepared('g')).toBeUndefined()
 expect(created.filter(image=>!image.isConnected&&image.hasAttribute('src'))).toHaveLength(4)
 for(const [index,key] of ['c','b'].entries()){
  const image=neighbors.get(key)!;const set=vi.spyOn(image,'setAttribute')
  await previous();expect(preview(key)).toBe(image)
  await act(async()=>pending[index+1]!.resolve([]));expect(image.closest('[hidden]')).toBeNull()
  expect(set.mock.calls.filter(([name])=>name==='src')).toHaveLength(0)
  expect(created.filter(value=>!value.isConnected&&value.hasAttribute('src')).length).toBeLessThanOrEqual(4)
 }
})

it('starts only after the current original is shown, prepares one neighbor at a time, and waits for clicked fresh authority',async()=>{
 await mount([message('a'),message('b'),message('c')]);expect(created).toHaveLength(0)
 await open('b');expect(prepared('c')).toBeUndefined();expect(prepared('a')).toBeUndefined()
 await settle('b');const c=prepared('c')!;expect(c).toBeDefined();expect(prepared('a')).toBeUndefined()
 await loaded(c);const a=prepared('a')!;expect(a).toBeDefined();await loaded(a)
 const set=vi.spyOn(c,'setAttribute');await next();expect(preview('c')).toBe(c)
 expect(set.mock.calls.filter(([name])=>name==='src')).toHaveLength(0)
 expect(c.closest('[hidden]')).not.toBeNull();expect(pending).toHaveLength(2)
 await act(async()=>pending[1]!.resolve([]));expect(c.closest('[hidden]')).toBeNull()
 expect(a.hasAttribute('src')).toBe(true)
})

it('adopts an in-flight neighbor without assigning src again or fabricating load completion',async()=>{
 await mount([message('a'),message('b')]);await open('a');await settle('a')
 const b=prepared('b')!;expect(b).toBeDefined();const set=vi.spyOn(b,'setAttribute')
 await next();expect(preview('b')).toBe(b);await act(async()=>pending[1]!.resolve([]))
 expect(b.closest('[hidden]')).not.toBeNull()
 await loaded(b);expect(b.closest('[hidden]')).toBeNull()
 expect(set.mock.calls.filter(([name])=>name==='src')).toHaveLength(0)
})

it('keeps unknown-size slots in the two-position range without skipping navigation',async()=>{
 const b=message('b');b.media[0]!.size=0
 await mount([message('a'),b,message('c'),message('d')]);await open('a');await settle('a')
 expect(prepared('b')).toBeUndefined();expect(prepared('c')).toBeDefined();expect(prepared('d')).toBeUndefined()
 await next();expect(preview('b').getAttribute('src')).toBe('/authorized-b')
})

it('cancels and releases neighbors when hidden, then prepares at most once after returning',async()=>{
 await mount([message('a'),message('b')]);await open('a');await settle('a');const b=prepared('b')!
 await act(async()=>{Object.defineProperty(doc,'visibilityState',{value:'hidden'});doc.dispatchEvent(new Event('visibilitychange'))})
 expect(b.hasAttribute('src')).toBe(false);expect(preview('a').hasAttribute('src')).toBe(true)
 await act(async()=>{Object.defineProperty(doc,'visibilityState',{value:'visible'});doc.dispatchEvent(new Event('visibilitychange'))})
 const replacement=prepared('b');expect(replacement).toBeDefined();expect(replacement).not.toBe(b)
 await mount([message('a'),message('b')]);expect(created.filter(image=>image.hasAttribute('src')&&image.getAttribute('src')==='/authorized-b')).toHaveLength(1)
})

it('replaces obsolete neighbors before starting a newly adjacent image',async()=>{
 const [a,b,c,d,e,f,g]=['a','b','c','d','e','f','g'].map(key=>message(key)) as [TeamMessage,TeamMessage,TeamMessage,TeamMessage,TeamMessage,TeamMessage,TeamMessage]
 await mount([a,b,c,d,e,f,g]);await open('d');await settle('d')
 for(const key of ['e','c','f','b'])await loaded(prepared(key)!)
 const cImage=prepared('c')!
 await mount([c,a,b,d,e,f,g])
 expect(cImage.hasAttribute('src')).toBe(false);expect(prepared('a')).toBeDefined()
 expect(created.filter(image=>!image.isConnected&&image.hasAttribute('src'))).toHaveLength(4)
})

it('does not start a neighbor when its current image loads before fresh preflight',async()=>{
 await mount([message('a'),message('b')]);await open('a');await loaded(preview('a'))
 expect(prepared('b')).toBeUndefined()
 await act(async()=>pending[0]!.resolve([]));expect(prepared('b')).toBeDefined()
})

it('clears preloads synchronously on a new authority check and ignores late load',async()=>{
 await mount([message('a'),message('b')]);await open('a');await settle('a');const b=prepared('b')!
 await act(async()=>invalidateTeamMessages('test:42',false,{kind:'team.message.changed',conversationKeys:['conversation'],messageKey:'a',messageRevision:2}))
 expect(b.hasAttribute('src')).toBe(false)
 await loaded(b);expect(prepared('b')).toBeUndefined()
})

it('waits for the original load event when an in-flight element reports complete just before takeover',async()=>{
 await mount([message('a'),message('b')]);await open('a');await settle('a');const b=prepared('b')!
 Object.defineProperties(b,{complete:{configurable:true,value:true},naturalWidth:{configurable:true,value:1000},naturalHeight:{configurable:true,value:1000},currentSrc:{configurable:true,get(){return b.src}}})
 await next();await act(async()=>pending[1]!.resolve([]));expect(b.closest('[hidden]')).not.toBeNull()
 await loaded(b);expect(b.closest('[hidden]')).toBeNull()
})

it('cancels a mounted neighbor immediately when its source presentation is invalidated',async()=>{
 await mount([message('a'),message('b')]);await open('a');await settle('a');const b=prepared('b')!
 await act(async()=>invalidateTeamMessages('test:42',false,{kind:'team.message.changed',conversationKeys:['conversation'],messageKey:'b',messageRevision:2}))
 expect(b.hasAttribute('src')).toBe(false)
 await loaded(b);expect(prepared('b')).toBeUndefined();expect(child.closed).toBe(false)
})

it.each(['close','account','detach','version','marker','removed'] as const)('releases loaded and in-flight neighbors on %s without a late-load restart',async reason=>{
 const a=message('a'),b=message('b'),c=message('c')
 await mount([a,b,c]);await open('b');await settle('b');const cImage=prepared('c')!
 await loaded(cImage);const aImage=prepared('a')!
 await act(async()=>{
  if(reason==='close')closeAttachmentPreview()
  else if(reason==='account')arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:43})
  else if(reason==='detach')root.render(null)
 })
 if(reason==='version')await mount([{...a,version:4},b,{...c,version:4}])
 if(reason==='marker')await mount([{...a,contentStatus:'revalidating',media:[]},b,{...c,contentStatus:'revalidating',media:[]}])
 if(reason==='removed')await mount([b])
 expect(cImage.hasAttribute('src')).toBe(false);expect(aImage.hasAttribute('src')).toBe(false)
 const count=created.length;await loaded(aImage);expect(created).toHaveLength(count)
 if(reason==='close'||reason==='account')expect(child.closed).toBe(true)
 else expect(child.closed).toBe(false)
})

it('keeps a revalidating neighbor in its position instead of preparing or navigating past it',async()=>{
 const a=message('a'),b=message('b'),c=message('c')
 await mount([a,b,c]);await mount([a,{...b,contentStatus:'revalidating',media:[]},c]);await open('a');await settle('a')
 expect(prepared('b')).toBeUndefined();expect(prepared('c')).toBeDefined()
 await next();expect(doc.title).toBe('b.png');expect(doc.querySelector('[data-arkme-transition-image]')?.getAttribute('aria-label')).toBe('a.png')
 expect(preview('c')).toBeNull();expect(preview('b')).toBeNull()
})

it.each([Number.NaN,-1,0,2*1024*1024+1])('does not speculate on an image with invalid or excessive declared size %s',async size=>{
 const b=message('b');b.media[0]!.size=size
 await mount([message('a'),b]);await open('a');await settle('a');expect(prepared('b')).toBeUndefined()
 await next();expect(preview('b').getAttribute('src')).toBe('/authorized-b')
})

it('releases oversized decoded neighbors and does not retry them on a normal render',async()=>{
 await mount([message('a'),message('b')]);await open('a');await settle('a');const b=prepared('b')!
 await loaded(b,2049,1000);expect(b.hasAttribute('src')).toBe(false)
 await mount([message('a'),message('b')]);expect(prepared('b')).toBeUndefined()
 await next();expect(preview('b')).not.toBe(b);await settle('b',1);expect(preview('b').closest('[hidden]')).toBeNull()
})

it('continues to its other neighbor after one error without retrying the failed request',async()=>{
 await mount([message('a'),message('b'),message('c')]);await open('b');await settle('b');const c=prepared('c')!
 await act(async()=>c.dispatchEvent(new Event('error')))
 expect(c.hasAttribute('src')).toBe(false);expect(prepared('a')).toBeDefined()
 await mount([message('a'),message('b'),message('c')]);expect(prepared('c')).toBeUndefined()
})

it('cancels the opposite in-flight request on a direction change within the four-neighbor bound',async()=>{
 await mount([message('a'),message('b'),message('c'),message('d')]);await open('b');await settle('b');const c=prepared('c')!
 await loaded(c);const a=prepared('a')!;await next()
 expect(a.hasAttribute('src')).toBe(false);expect(preview('c')).toBe(c);expect(prepared('d')).toBeUndefined()
 await act(async()=>pending[1]!.resolve([]));expect(prepared('d')).toBeDefined()
 expect(created.filter(image=>!image.isConnected&&image.hasAttribute('src'))).toHaveLength(2)
 await loaded(a);expect(created.filter(image=>!image.isConnected&&image.hasAttribute('src'))).toHaveLength(2)
})

it('releases speculation while blurred and resumes a single request on focus',async()=>{
 await mount([message('a'),message('b')]);await open('a');await settle('a');const b=prepared('b')!
 await act(async()=>{vi.mocked(doc.hasFocus).mockReturnValue(false);window.dispatchEvent(new Event('blur'))})
 expect(b.hasAttribute('src')).toBe(false)
 await act(async()=>{vi.mocked(doc.hasFocus).mockReturnValue(true);window.dispatchEvent(new Event('focus'))})
 expect(prepared('b')).toBeDefined();expect(prepared('b')).not.toBe(b)
 const count=created.length;await act(async()=>window.dispatchEvent(new Event('focus')));expect(created).toHaveLength(count)
})

it('does not display preloaded bytes if fresh preflight denies the selected neighbor',async()=>{
 await mount([message('a'),message('b')]);await open('a');await settle('a');const b=prepared('b')!;await loaded(b)
 await next();expect(b.closest('[hidden]')).not.toBeNull()
 await act(async()=>pending[1]!.reject({body:{code:'team-not_accessible'}}))
 expect(child.closed).toBe(true);expect(b.hasAttribute('src')).toBe(false)
 await loaded(b);expect(b.isConnected).toBe(false);expect(b.hasAttribute('src')).toBe(false)
})

it.each([false,true])('reuses three consecutive unseen left neighbors, including visible focus changes=%s',async changeFocus=>{
 await mount(['d','c','b','a'].map(key=>message(key)));await open('a');await settle('a')
 for(const [index,key] of ['b','c','d'].entries()){
  const neighbor=prepared(key)!;expect(neighbor).toBeDefined();await loaded(neighbor)
  if(changeFocus){
   await act(async()=>{vi.mocked(doc.hasFocus).mockReturnValue(false);window.dispatchEvent(new Event('blur'))})
   expect(neighbor.hasAttribute('src')).toBe(true)
   await act(async()=>{vi.mocked(doc.hasFocus).mockReturnValue(true);window.dispatchEvent(new Event('focus'))})
   expect(prepared(key)).toBe(neighbor)
   expect(created.filter(image=>image.hasAttribute('src')).length).toBeLessThanOrEqual(5)
  }
  const set=vi.spyOn(neighbor,'setAttribute');await previous()
  expect(preview(key)).toBe(neighbor);expect(neighbor.closest('[hidden]')).not.toBeNull()
  await act(async()=>pending[index+1]!.resolve([]));expect(neighbor.closest('[hidden]')).toBeNull()
  expect(set.mock.calls.filter(([name])=>name==='src')).toHaveLength(0)
 }
 expect(pending).toHaveLength(4)
 for(const key of ['b','c','d'])expect(created.filter(image=>image.alt===`${key}.png`)).toHaveLength(1)
})

it('clears completed neighbors if a visible blurred window then becomes hidden',async()=>{
 await mount([message('a'),message('b')]);await open('a');await settle('a');const b=prepared('b')!;await loaded(b)
 await act(async()=>{vi.mocked(doc.hasFocus).mockReturnValue(false);window.dispatchEvent(new Event('blur'))})
 expect(b.hasAttribute('src')).toBe(true)
 await act(async()=>{Object.defineProperty(doc,'visibilityState',{value:'hidden'});doc.dispatchEvent(new Event('visibilitychange'))})
 expect(b.hasAttribute('src')).toBe(false)
})

it('keeps the retained neighbor subscribed to revocation while the visible window is blurred',async()=>{
 await mount([message('a'),message('b')]);await open('a');await settle('a');const b=prepared('b')!;await loaded(b)
 await act(async()=>{vi.mocked(doc.hasFocus).mockReturnValue(false);window.dispatchEvent(new Event('blur'))})
 expect(b.hasAttribute('src')).toBe(true)
 await act(async()=>invalidateTeamMessages('test:42',false,{kind:'team.message.changed',conversationKeys:['conversation'],messageKey:'b',messageRevision:2}))
 expect(b.hasAttribute('src')).toBe(false)
 await act(async()=>{vi.mocked(doc.hasFocus).mockReturnValue(true);window.dispatchEvent(new Event('focus'))})
 expect(prepared('b')).toBeUndefined();expect(child.closed).toBe(false)
})
