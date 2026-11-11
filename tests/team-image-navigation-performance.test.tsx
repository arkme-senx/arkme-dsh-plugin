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
import {withoutTeamMessageMaterial} from '../src/team-message-projection.js'

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
async function settle(key:string,index=0){await act(async()=>{pending[index]!.resolve([]);doc.querySelector<HTMLImageElement>(`img[alt="${key}.png"]`)!.dispatchEvent(new Event('load'))})}

it('hands the next mounted message pixels over immediately while retaining its one fresh authorization read',async()=>{
 await mount([message('a'),message('b')]);await open('a');await settle('a')
 const old=pending[0]!.signal
 await next()
 expect(doc.querySelector('[data-arkme-presented-image]')?.getAttribute('aria-label')).toBe('b.png')
 expect(draw).toHaveBeenLastCalledWith(source('b'),0,0,640,480)
 expect(call).toHaveBeenCalledTimes(2);expect(old.aborted).toBe(true)
 expect(call.mock.calls[1]![1]).toMatchObject({selections:[{messageRef:'message-b',version:3}]})
 expect(doc.querySelector('fieldset')?.disabled).toBe(true)
 await settle('b',1)
 expect(doc.querySelector('[data-arkme-presented-image]')).toBeNull()
 expect(call).toHaveBeenCalledTimes(2)
})

it('also hands over a sibling image without resetting the same-message read owner',async()=>{
 await mount([message('a',['a','b'])]);await open('a');await settle('a')
 await next()
 expect(doc.querySelector('[data-arkme-presented-image]')?.getAttribute('aria-label')).toBe('b.png')
 expect(draw).toHaveBeenLastCalledWith(source('b'),0,0,640,480)
 expect(call).toHaveBeenCalledTimes(1);expect(pending[0]!.signal.aborted).toBe(false)
})

it('does not treat the previous A image load as the new A load during a same-message A-B-A switch',async()=>{
 await mount([message('a',['a','b'])]);await open('a');await settle('a')
 await next()
 await act(async()=>doc.querySelector<HTMLButtonElement>('button[aria-label="上一个媒体"]')!.click())
 const canvas=doc.querySelector<HTMLCanvasElement>('[data-arkme-presented-image]')!
 expect(canvas?.getAttribute('aria-label')).toBe('a.png')
 expect(doc.querySelector('img[alt="a.png"]')?.closest('[hidden]')).not.toBeNull()
 expect(call).toHaveBeenCalledTimes(1);expect(pending[0]!.signal.aborted).toBe(false)
 await act(async()=>doc.querySelector('img[alt="a.png"]')!.dispatchEvent(new Event('load')))
 expect(doc.querySelector('[data-arkme-presented-image]')).toBeNull()
 expect(canvas.width).toBe(0)
})

it('uses the displayed asset identity when equivalent Host grants rotate before navigation',async()=>{
 const a=message('a'),b=message('b');await mount([a,b]);await open('a');await settle('a')
 const displayed=source('b')
 const fresh={...b,ref:'message-b-new',media:b.media.map(asset=>({...asset,ref:'rotated-b',url:'/rotated-b'}))}
 await mount([a,fresh]);expect(source('b')).toBe(displayed)
 await next()
 expect(doc.querySelector('[data-arkme-presented-image]')?.getAttribute('aria-label')).toBe('b.png')
 expect(draw).toHaveBeenLastCalledWith(displayed,0,0,640,480)
 expect(call.mock.calls[1]![1]).toMatchObject({selections:[{messageRef:'message-b-new',version:3}]})
})

it('clears the destination pixels synchronously when its source invalidates during the new read',async()=>{
 await mount([message('a'),message('b')]);await open('a');await settle('a');await next()
 const canvas=doc.querySelector<HTMLCanvasElement>('[data-arkme-presented-image]')!
 expect(canvas).not.toBeNull()
 await act(async()=>{invalidateTeamMessages('test:42',false,{kind:'team.message.changed',messageKey:'b'});expect(canvas.width).toBe(0)})
 expect(doc.querySelector('[data-arkme-presented-image]')).toBeNull()
 expect(pending[1]!.signal.aborted).toBe(true)
 expect(call).toHaveBeenCalledTimes(3)
})

it.each(['unmounted','not-loaded','invalidated','url-replaced'] as const)('does not borrow %s target pixels or skip its read',async reason=>{
 const a=message('a'),b=message('b');await mount([a,b]);await open('a');await settle('a');draw.mockClear()
 if(reason==='unmounted')await mount([a,b],[a])
 if(reason==='not-loaded')Object.defineProperty(source('b'),'complete',{value:false})
 if(reason==='invalidated')await act(async()=>invalidateTeamMessages('test:42',false,{kind:'team.message.changed',messageKey:'b'}))
 if(reason==='url-replaced')source('b').src='/unrelated'
 await next()
 expect(doc.querySelector('[data-arkme-presented-image]')).toBeNull();expect(draw).not.toHaveBeenCalled()
 expect(call).toHaveBeenCalledTimes(2)
 expect(doc.querySelector('fieldset')?.disabled).toBe(true)
})

it('measures the same 800ms authorization and 1200ms image workload without extra reads',async()=>{
 await mount([message('a'),message('b')]);await open('a');await settle('a')
 vi.useFakeTimers();await next()
 const immediate=!!doc.querySelector('[data-arkme-presented-image]')
 const atClick=call.mock.calls.length
 await act(async()=>{await vi.advanceTimersByTimeAsync(800);pending[1]!.resolve([])})
 await act(async()=>{await vi.advanceTimersByTimeAsync(400);doc.querySelector('img[alt="b.png"]')!.dispatchEvent(new Event('load'))})
 const metric={preflightDelayMs:800,imageDelayMs:1200,firstVisualMs:immediate?0:1200,preflightCalls:call.mock.calls.length,extraCallsAfterClick:call.mock.calls.length-atClick}
 console.info('[team-image-fixture-metric]'+JSON.stringify(metric))
 expect(metric).toMatchObject({firstVisualMs:0,preflightCalls:2,extraCallsAfterClick:0})
})

it.each([
 {viewport:800,ratio:2,sourceWidth:4000,sourceHeight:3000,width:1600,height:1200},
 {viewport:4000,ratio:3,sourceWidth:4000,sourceHeight:3000,width:2048,height:1536},
 {viewport:800,ratio:2,sourceWidth:300,sourceHeight:200,width:300,height:200},
])('hands over sharp window pixels within one bounded canvas ($width x $height)',async size=>{
 Object.defineProperty(doc,'defaultView',{configurable:true,value:window})
 vi.stubGlobal('innerWidth',size.viewport);vi.stubGlobal('innerHeight',600);vi.stubGlobal('devicePixelRatio',size.ratio)
 await mount([message('a')])
 Object.defineProperties(source('a'),{naturalWidth:{value:size.sourceWidth},naturalHeight:{value:size.sourceHeight}})
 await open('a')
 const canvas=doc.querySelector<HTMLCanvasElement>('[data-arkme-presented-image]')!
 expect([canvas.width,canvas.height]).toEqual([size.width,size.height])
 expect(canvas.width*canvas.height*4).toBeLessThanOrEqual(16*1024*1024)
 expect(doc.querySelectorAll('[data-arkme-presented-image]')).toHaveLength(1)
 expect(call).toHaveBeenCalledTimes(1)
 await act(async()=>closeAttachmentPreview())
 expect(canvas.width).toBe(0);expect(canvas.height).toBe(0);expect(pending[0]!.signal.aborted).toBe(true)
})

it('contains a tall handoff inside the same fixed stage as the full image, independent of its intrinsic grid minimum',async()=>{
 Object.defineProperty(doc,'defaultView',{configurable:true,value:window})
 vi.stubGlobal('innerWidth',1560);vi.stubGlobal('innerHeight',1000);vi.stubGlobal('devicePixelRatio',2)
 await mount([message('a')])
 Object.defineProperties(source('a'),{naturalWidth:{value:720},naturalHeight:{value:3000}})
 await open('a')
 const canvas=doc.querySelector<HTMLCanvasElement>('[data-arkme-presented-image]')!
 // Absolute fill avoids CSS grid's automatic intrinsic minimum growing the
 // percentage-height canvas. jsdom checks the contract, not browser layout.
 expect(canvas.style.position).toBe('absolute');expect(canvas.style.inset).toBe('0')
 const image=doc.querySelector<HTMLImageElement>('img[alt="a.png"]')!
 expect([canvas.style.width,canvas.style.height,canvas.style.objectFit]).toEqual([image.style.width,image.style.height,image.style.objectFit])
 const stage=canvas.parentElement!,fullStage=image.closest('[data-arkme-image-preview-viewport]')!.parentElement!
 for(const edge of ['top','right','bottom','left'] as const)expect(stage.style[edge]).toBe(fullStage.style[edge])
 // Existing contain geometry: subtract overlay padding and the shared stage's
 // 30/52px insets. Bitmap rounding must not alter the portrait crop or position.
 const expected=arkmeContainedImageRect(1540,878,720,3000)
 const handoff=arkmeContainedImageRect(1540,878,canvas.width,canvas.height)
 expect(expected.height).toBeCloseTo(878);expect(expected.width).toBeCloseTo(210.72)
 for(const key of ['left','top','width','height'] as const)expect(Math.abs(handoff[key]-expected[key])).toBeLessThan(1)
 await settle('a')
 expect(doc.querySelector('[data-arkme-presented-image]')).toBeNull()
 expect(doc.querySelector('img[alt="a.png"]')).toBe(image)
})

it('keeps the window through matching invalidation and only restores fresh same-version material with a new preflight',async()=>{
 const a=message('a'),b=message('b');await mount([a,b]);await open('a');await settle('a')
 const old=doc.querySelector<HTMLImageElement>('img[alt="a.png"]')!
 await act(async()=>invalidateTeamMessages('test:42',false,{kind:'team.message.changed',messageKey:'a'}))
 expect(old.hasAttribute('src')).toBe(false)
 await mount([withoutTeamMessageMaterial(a),b])
 expect(child.closed).toBe(false);expect(doc.querySelector('img')).toBeNull();expect(doc.querySelector('canvas')).toBeNull()
 expect(doc.querySelector('button[aria-label="复制图片"]')).toBeNull();expect(call).toHaveBeenCalledTimes(2)
 // The source read may beat the timeline. Its old projection must stay hidden.
 await act(async()=>pending[1]!.resolve([]))
 expect(child.closed).toBe(false);expect(doc.querySelector('img')).toBeNull()
 const fresh={...a,ref:'fresh-message-a',media:a.media.map(asset=>({...asset,ref:'fresh-ref-a',url:'/fresh-authorized-a'}))}
 await mount([fresh,b])
 expect(child.closed).toBe(false);expect(window.open).toHaveBeenCalledTimes(1);expect(call).toHaveBeenCalledTimes(3)
 expect(call.mock.calls[2]![1]).toMatchObject({selections:[{messageRef:fresh.ref,version:3}]})
 const restored=doc.querySelector<HTMLImageElement>('img[alt="a.png"]')!
 expect(restored?.src).toContain('/fresh-authorized-a');expect(restored.closest('[hidden]')).not.toBeNull()
 expect(doc.querySelector('fieldset')?.disabled).toBe(true)
 await act(async()=>restored.dispatchEvent(new Event('load')))
 expect(restored.closest('[hidden]')).not.toBeNull();expect(doc.querySelector('fieldset')?.disabled).toBe(true)
 await act(async()=>pending[2]!.resolve([]))
 expect(restored.closest('[hidden]')).toBeNull();expect(doc.querySelector('fieldset')?.disabled).toBe(false)
 await mount([{...fresh,ref:'equivalent-message-a'},b])
 expect(doc.querySelector('img[alt="a.png"]')).toBe(restored);expect(call).toHaveBeenCalledTimes(3)
})

it('stops on a revalidating neighbour instead of skipping it and resumes the same slot',async()=>{
 const a=message('a'),b=message('b'),c=message('c');await mount([a,b,c]);await open('a');await settle('a')
 await act(async()=>invalidateTeamMessages('test:42',false,{kind:'team.message.changed',messageKey:'b'}))
 await mount([a,withoutTeamMessageMaterial(b),c]);await next()
 expect(child.closed).toBe(false);expect(doc.querySelector('img')).toBeNull()
 expect(doc.querySelector('[role="status"]')?.textContent).toContain('图片加载中')
 expect(call.mock.calls[1]![1]).toMatchObject({selections:[{messageRef:b.ref,version:3}]})
 expect(doc.querySelector<HTMLButtonElement>('button[aria-label="上一个媒体"]')?.disabled).toBe(false)
 expect(doc.querySelector<HTMLButtonElement>('button[aria-label="下一个媒体"]')?.disabled).toBe(false)
 await mount([a,{...b,ref:'fresh-message-b'},c]);expect(call).toHaveBeenCalledTimes(3)
 await settle('b',2);expect(doc.querySelector('img[alt="b.png"]')).not.toBeNull();expect(doc.querySelector('img[alt="c.png"]')).toBeNull()
 await next();expect(call.mock.calls[3]![1]).toMatchObject({selections:[{messageRef:c.ref,version:3}]})
})

it.each(['removed','recalled','version','account','denied'] as const)('still closes revalidating previews on %s',async reason=>{
 const a=message('a'),b=message('b');await mount([a,b]);await open('a');await settle('a')
 await act(async()=>invalidateTeamMessages('test:42',false,{kind:'team.message.changed',messageKey:'a'}))
 await mount([withoutTeamMessageMaterial(a),b]);expect(child.closed).toBe(false)
 if(reason==='removed')await mount([b])
 if(reason==='recalled')await mount([{...a,state:'recalled',contentStatus:'recalled'},b])
 if(reason==='version')await mount([{...a,version:4},b])
 if(reason==='account')await act(async()=>arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:7}))
 if(reason==='denied')await act(async()=>pending[1]!.reject({body:{code:'team-not_accessible'}}))
 expect(child.closed).toBe(true);expect(pending[1]!.signal.aborted).toBe(true);expect(doc.querySelector('img')).toBeNull()
})

it('ignores a late old-scope denial after same-version revalidation resumes',async()=>{
 const a=message('a');await mount([a]);await open('a');await settle('a')
 await act(async()=>invalidateTeamMessages('test:42',false,{kind:'team.message.changed',messageKey:'a'}))
 await mount([withoutTeamMessageMaterial(a)]);await mount([{...a,ref:'fresh-a'}])
 expect(call).toHaveBeenCalledTimes(3);expect(pending[1]!.signal.aborted).toBe(true)
 await act(async()=>pending[1]!.reject({body:{code:'team-message_recalled'}}))
 expect(child.closed).toBe(false);await settle('a',2)
 expect(doc.querySelector('img[alt="a.png"]')).not.toBeNull()
})

it('marks the actively selected preview image as a high-priority fetch',async()=>{
 await mount([message('a')]);await open('a')
 expect(doc.querySelector('img[alt="a.png"]')?.getAttribute('fetchpriority')).toBe('high')
})

it.each([false,true])('only terminates an abandoned revalidation when its list unmounts (pending=$0)',async revalidating=>{
 const a=message('a');await mount([a]);await open('a');await settle('a')
 if(revalidating){
  await act(async()=>invalidateTeamMessages('test:42',false,{kind:'team.message.changed',messageKey:'a'}))
  await mount([withoutTeamMessageMaterial(a)])
 }
 expect(child.closed).toBe(false)
 await act(async()=>root.render(null))
 expect(child.closed).toBe(revalidating)
 if(revalidating){expect(pending[1]!.signal.aborted).toBe(true);expect(doc.querySelector('img')).toBeNull()}
 else {expect(doc.querySelector('img[alt="a.png"]')).not.toBeNull();expect(call).toHaveBeenCalledTimes(1)}
})
