// @vitest-environment jsdom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {TeamMessageContent} from '../src/client/TeamMessageContent.js'
import {ArkmeMessageContent} from '../src/client/ArkmeRichContent.js'
import {backgroundUiReads} from '../src/client/background-read.js'
import {arkmeAuthStore} from '../src/client/auth-store.js'
import type {TeamMessage} from '../src/team-app-contract.js'
vi.mock('../src/client/api.js',()=>({callArkme:vi.fn()}))
const message:TeamMessage={key:'message',ref:'message-ref',seq:1,revision:1,side:'team',sender:{nickname:'Synthetic'},own:false,state:'published',createdAt:1,canEdit:false,canDelete:false,version:3,contentStatus:'available',media:['a','b','c','d'].map(key=>({key,ref:key,url:`/authorized-${key}`,name:`${key}.png`,mimeType:'image/png',size:1,kind:1}))}
let host:HTMLDivElement,root:Root
const observers=new Set<{element?:Element;callback:IntersectionObserverCallback;options?:IntersectionObserverInit}>()
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 vi.stubGlobal('IntersectionObserver',class {
  element?:Element
  constructor(public callback:IntersectionObserverCallback,public options?:IntersectionObserverInit){observers.add(this)}
  observe(element:Element){this.element=element}
  disconnect(){observers.delete(this)}
 })
 arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:42})
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();observers.clear();vi.restoreAllMocks();vi.unstubAllGlobals()})
async function render(value=message){await act(async()=>root.render(<TeamMessageContent message={value} conversationRef="conversation-ref" conversationKey="conversation"/>))}
async function visible(){await act(async()=>{for(const observer of [...observers])observer.callback([{target:observer.element,isIntersecting:true}] as IntersectionObserverEntry[],{} as IntersectionObserver)})}
const images=()=>[...host.querySelectorAll<HTMLImageElement>('img')]
const admitted=()=>images().filter(image=>image.hasAttribute('src'))
async function load(image:HTMLImageElement){Object.defineProperties(image,{naturalWidth:{configurable:true,value:800},naturalHeight:{configurable:true,value:600}});await act(async()=>image.dispatchEvent(new Event('load')))}

it('admits only visible Team images and holds the shared budget until load or error',async()=>{
 await render();expect(images()).toHaveLength(0);expect(host.querySelectorAll('[data-arkme-image-loading]')).toHaveLength(4)
 await visible();expect(admitted().map(image=>image.alt)).toEqual(['a.png','b.png'])
 expect(admitted().every(image=>image.getAttribute('loading')==='eager')).toBe(true)
 await load(admitted()[0]!);expect(admitted().map(image=>image.alt)).toEqual(['a.png','b.png','c.png'])
 await act(async()=>admitted().find(image=>image.alt==='b.png')!.dispatchEvent(new Event('error')))
 expect(admitted().map(image=>image.alt)).toEqual(['a.png','c.png','d.png'])
 expect(host.textContent).toContain('重试')
})

it('loads at most two images independently while background JSON occupies both of its permits',async()=>{
 const releases:Array<()=>void>=[]
 const jobs=[0,1].map(()=>backgroundUiReads.run({scope:'test:42',lane:'background-read',service:'other',operation:()=>new Promise<void>(resolve=>releases.push(resolve))}))
 try{
  await act(async()=>Promise.resolve());expect(releases).toHaveLength(2)
  await render();expect(admitted()).toHaveLength(0)
  await visible();expect(admitted().map(image=>image.alt)).toEqual(['a.png','b.png'])
  await act(async()=>releases[0]!());expect(admitted().map(image=>image.alt)).toEqual(['a.png','b.png'])
  await load(admitted()[0]!);expect(admitted().map(image=>image.alt)).toEqual(['a.png','b.png','c.png'])
 }finally{await act(async()=>{releases.forEach(release=>release());await Promise.all(jobs)})}
})

it('observes a bounded 300px vertical near-viewport window before borrowing image permits',async()=>{
 await render();expect(admitted()).toHaveLength(0)
 expect(observers.size).toBe(4)
 expect([...observers].every(observer=>observer.options?.rootMargin==='300px 0px')).toBe(true)
 await visible();expect(admitted()).toHaveLength(2)
})

it('does not introduce a rate limit or delay loaded pixels after React handles the load event',async()=>{
 vi.useFakeTimers()
 try{
  const media=Array.from({length:16},(_,index)=>({...message.media[0]!,key:`image-${index}`,ref:`image-${index}`,url:`/synthetic-${index}`,name:`${index}.png`}))
  await render({...message,media});const observerAt=Date.now();await visible()
  expect(admitted()).toHaveLength(2);expect(Date.now()-observerAt).toBe(0)
  for(let index=0;index<media.length;index++){
   const current=admitted().find(image=>image.style.visibility==='hidden')!
   expect(current).toBeDefined();const callbackAt=Date.now();await load(current)
   expect(current.style.visibility).not.toBe('hidden');expect(Date.now()-callbackAt).toBe(0)
  }
  expect(admitted()).toHaveLength(16);expect(vi.getTimerCount()).toBe(0)
 }finally{vi.useRealTimers()}
})

it('releases active reads and removes queued work when the gallery unmounts',async()=>{
 await render();await visible();expect(admitted()).toHaveLength(2)
 const old=images();await act(async()=>root.render(null))
 expect(old.every(image=>!image.hasAttribute('src'))).toBe(true)
 const work=vi.fn(async()=>{})
 await backgroundUiReads.run({scope:'test:42',lane:'image',service:'team',operation:work})
 expect(work).toHaveBeenCalledTimes(1)
 expect(host.querySelector('img')).toBeNull()
})

it('does not restart loaded URLs when equivalent authorized message refs rotate',async()=>{
 await render();await visible();const first=admitted()[0]!;await load(first)
 const remove=vi.spyOn(first,'removeAttribute')
 await render({...message,ref:'new-message-ref',media:message.media.map(media=>({...media,ref:`new-${media.ref}`,url:`/new-${media.key}`}))})
 expect(images()[0]).toBe(first);expect(first.getAttribute('src')).toBe('/authorized-a')
 expect(remove).not.toHaveBeenCalledWith('src')
 expect(admitted()).toHaveLength(3)
})

it('aborts old-account active and queued reads before a new account uses the budget',async()=>{
 await render();await visible();const old=images()
 await act(async()=>arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:7}))
 expect(old.every(image=>!image.hasAttribute('src'))).toBe(true)
 const work=vi.fn(async()=>{})
 await backgroundUiReads.run({scope:'test:7',lane:'image',service:'team',operation:work})
 expect(work).toHaveBeenCalledTimes(1)
})

it('falls back to bounded eager reads when IntersectionObserver is unavailable',async()=>{
 vi.stubGlobal('IntersectionObserver',undefined)
 await render();expect(admitted()).toHaveLength(2)
 expect(admitted().every(image=>image.getAttribute('loading')==='eager')).toBe(true)
})

it('keeps ordinary conversation images on their existing direct lazy path',async()=>{
 await act(async()=>root.render(<ArkmeMessageContent item={{itemUid:'ordinary',status:1,isMe:false,senderName:'Synthetic',sendAtMillis:1,title:'',textContent:'',contentBlocks:message.media.map((media,sortOrder)=>({kind:'image',mediaRef:media.ref,fileName:media.name,mimeType:media.mimeType,size:1,sortOrder}))}}/>))
 expect(admitted()).toHaveLength(4);expect(admitted().every(image=>image.getAttribute('loading')==='lazy')).toBe(true)
})

it('keeps pending images visually hidden with an explicit loading state and unchanged tile geometry',async()=>{
 await render()
 const tile=host.querySelector<HTMLButtonElement>('button[aria-label="预览图片 a.png"]')!,geometry=tile.getAttribute('style')
 expect(images()).toHaveLength(0)
 expect(host.querySelectorAll('[data-arkme-image-loading]')).toHaveLength(4)
 await visible();const first=admitted()[0]!;expect(first.style.visibility).toBe('hidden')
 await load(first);expect(first.style.visibility).not.toBe('hidden')
 expect(first.closest('button')!.getAttribute('style')).toBe(geometry)
 expect(host.querySelectorAll('[data-arkme-image-loading]')).toHaveLength(3)
})

it('cancels a queued image outside the observed near-viewport window so current images get the next permit',async()=>{
 const releases:Array<()=>void>=[]
 const jobs=[0,1].map(()=>backgroundUiReads.run({scope:'test:42',lane:'image',service:'team',operation:()=>new Promise<void>(resolve=>releases.push(resolve))}))
 try{
  await act(async()=>Promise.resolve());await render()
  const tracked=[...observers];await visible()
  await act(async()=>{for(const observer of tracked.slice(0,2))observer.callback([{target:observer.element,isIntersecting:false}] as IntersectionObserverEntry[],{} as IntersectionObserver)})
  await act(async()=>releases[0]!())
  expect(admitted().map(image=>image.alt)).toEqual(['c.png'])
 }finally{await act(async()=>{releases.forEach(release=>release());await Promise.all(jobs)})}
})

it('releases offscreen in-flight images, lets current images start, and re-admits only when visible again',async()=>{
 await render();const tracked=[...observers];await visible();const first=images()[0]!
 await act(async()=>tracked[0]!.callback([{target:first,isIntersecting:false}] as IntersectionObserverEntry[],{} as IntersectionObserver))
 expect(first.hasAttribute('src')).toBe(false);expect(admitted().map(image=>image.alt)).toEqual(['b.png','c.png'])
 expect(host.textContent).not.toContain('重试')
 await act(async()=>first.dispatchEvent(new Event('error')))
 expect(host.textContent).not.toContain('重试')
 await act(async()=>tracked[0]!.callback([{target:first,isIntersecting:true}] as IntersectionObserverEntry[],{} as IntersectionObserver))
 await load(admitted().find(image=>image.alt==='b.png')!);await load(admitted().find(image=>image.alt==='c.png')!)
 const replacement=admitted().find(image=>image.alt==='a.png')!
 expect(replacement).not.toBe(first);expect(replacement.getAttribute('src')).toBe('/authorized-a')
 await act(async()=>{first.dispatchEvent(new Event('load'));first.dispatchEvent(new Event('error'))})
 expect(replacement.style.visibility).toBe('hidden');expect(host.textContent).not.toContain('重试')
 await load(replacement)
 await act(async()=>tracked[0]!.callback([{target:replacement,isIntersecting:false}] as IntersectionObserverEntry[],{} as IntersectionObserver))
 expect(replacement.getAttribute('src')).toBe('/authorized-a');expect(replacement.style.visibility).not.toBe('hidden')
})

it('recovers a failed request only after explicit retry and settles the same shared permit',async()=>{
 await render({...message,media:message.media.slice(0,1)});await visible()
 await act(async()=>admitted()[0]!.dispatchEvent(new Event('error')))
 expect(admitted()).toHaveLength(0)
 const retry=host.querySelector<HTMLButtonElement>('[data-arkme-media-fallback="image"]')!
 expect(retry).not.toBeNull();await act(async()=>Promise.resolve());expect(admitted()).toHaveLength(0)
 await act(async()=>retry.click());await visible()
 const current=admitted()[0]!;expect(current.getAttribute('src')).toBe('/authorized-a?retry=1');expect(current.style.visibility).toBe('hidden')
 await load(current);expect(current.style.visibility).not.toBe('hidden');expect(host.textContent).not.toContain('重试')
 const work=vi.fn(async()=>{});await backgroundUiReads.run({scope:'test:42',lane:'image',service:'team',operation:work});expect(work).toHaveBeenCalledOnce()
})

it('rejects missing Team image URLs without issuing an empty or retry-only URL request',async()=>{
 await render({...message,media:[{...message.media[0]!,url:''}]})
 expect(admitted()).toHaveLength(0)
 const retry=host.querySelector<HTMLButtonElement>('[data-arkme-media-fallback="image"]')!
 expect(retry).not.toBeNull()
 await act(async()=>retry.click());await visible()
 expect(admitted()).toHaveLength(0);expect(host.querySelector('[data-arkme-media-fallback="image"]')).not.toBeNull()
})


it('does not let an old source load or error settle a replacement source',async()=>{
 await render({...message,media:message.media.slice(0,1)});await visible();const old=admitted()[0]!
 await render({...message,version:4,media:[{...message.media[0]!,url:'/replacement'}]});await visible();const replacement=admitted()[0]!
 expect(replacement).not.toBe(old);expect(replacement.getAttribute('src')).toBe('/replacement')
 await act(async()=>{old.dispatchEvent(new Event('load'));old.dispatchEvent(new Event('error'))})
 expect(replacement.style.visibility).toBe('hidden');expect(host.textContent).not.toContain('重试')
 await load(replacement);expect(replacement.style.visibility).not.toBe('hidden')
})

it('clears loaded Team pixels on account change without reusing them in the next scope',async()=>{
 await render({...message,media:message.media.slice(0,1)});await visible();const old=admitted()[0]!;await load(old)
 await act(async()=>arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:7}))
 expect(old.hasAttribute('src')).toBe(false);expect(images()).toHaveLength(0)
 await render({...message,media:message.media.slice(0,1)});await visible();expect(admitted()[0]).not.toBe(old)
})
