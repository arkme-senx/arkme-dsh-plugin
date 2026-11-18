// @vitest-environment jsdom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {ArkmeMessageContent} from '../src/client/ArkmeRichContent.js'
import {ArkmeAttachmentNavigationProvider,type ArkmeAttachmentNavigationEntry} from '../src/client/attachment-preview-navigation.js'
import {closeAttachmentPreview} from '../src/client/attachment-preview-window.js'
import {arkmeAuthStore} from '../src/client/auth-store.js'
import {bindAttachmentPreviewAccount} from '../src/client/attachment-preview-auth-binding.js'
import {ArkmeMediaAccessContext} from '../src/client/media-access.js'
vi.mock('../src/client/api.js',()=>({callArkme:vi.fn().mockResolvedValue(undefined)}))
let root:Root,host:HTMLDivElement,doc:Document,child:{closed:boolean},unbind:()=>void
const entry=(key:string,names:string[]):ArkmeAttachmentNavigationEntry=>({key,source:`chat:${key}`,version:'1',blocks:names.map((name,sortOrder)=>({kind:'image',fileAssetUid:name,mediaRef:name,fileName:name,mimeType:'image/png',size:1,sortOrder}))})
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:42});unbind=bindAttachmentPreviewAccount()
 vi.stubGlobal('arkmeAttachmentPreview',{version:1,focus(){},close(){}})
 doc=document.implementation.createHTMLDocument('preview');const events=new EventTarget()
 child={document:doc,closed:false,focus(){},close(){this.closed=true;events.dispatchEvent(new Event('beforeunload'))},addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)} as typeof child
 vi.spyOn(window,'open').mockImplementation(()=>child as unknown as Window)
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>{closeAttachmentPreview();root.unmount();unbind()});host.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
async function render(entries:ArkmeAttachmentNavigationEntry[],scope='test:42:chat'){
 await act(async()=>root.render(<ArkmeAttachmentNavigationProvider scopeKey={scope} entries={entries}>{entries.map(value=><ArkmeMediaAccessContext.Provider key={value.key} value={value.mediaAccess}><ArkmeMessageContent sessionAttachmentPreview attachmentNavigationKey={value.key} sourceIdentityKey="chat" item={{itemUid:value.key,status:1,isMe:false,senderName:'member',sendAtMillis:1,title:'',textContent:'',contentBlocks:value.blocks}}/></ArkmeMediaAccessContext.Provider>)}</ArkmeAttachmentNavigationProvider>))
}
async function open(name:string){await act(async()=>host.querySelector<HTMLButtonElement>(`button[aria-label="预览图片 ${name}"]`)!.click())}
async function next(){await act(async()=>doc.querySelector<HTMLButtonElement>('button[aria-label="下一个媒体"]')!.click())}
it('navigates loaded message order and attachment order in the same child window',async()=>{
 await render([entry('first',['a.png','b.png']),entry('second',['c.png'])]);await open('b.png')
 expect(doc.querySelector<HTMLButtonElement>('button[aria-label="下一个媒体"]')?.disabled).toBe(false)
 await next();expect(doc.querySelector('img[alt="c.png"]')).not.toBeNull()
 await act(async()=>doc.querySelector<HTMLButtonElement>('button[aria-label="上一个媒体"]')!.click())
 expect(doc.querySelector('img[alt="b.png"]')).not.toBeNull();expect(window.open).toHaveBeenCalledTimes(1)
})
it('updates the loaded boundary and closes a selected occurrence removed by its owner',async()=>{
 const first=entry('first',['a.png']);await render([first]);await open('a.png')
 await render([first,entry('second',['b.png'])])
 expect(doc.querySelector<HTMLButtonElement>('button[aria-label="下一个媒体"]')?.disabled).toBe(false)
 await next();await render([first]);expect(child.closed).toBe(true)
})
it('keeps the old finite conversation after its list changes scope, and supports arrow keys',async()=>{
 await render([entry('first',['a.png']),entry('second',['b.png'])]);await open('a.png')
 await render([entry('other',['other.png'])],'test:42:other-chat')
 expect(child.closed).toBe(false)
 await act(async()=>doc.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})))
 expect(doc.querySelector('img[alt="b.png"]')).not.toBeNull();expect(doc.querySelector('img[alt="other.png"]')).toBeNull()
})
it('distinguishes occurrences of the same asset and keeps current pixels on reference rotation',async()=>{
 const a=entry('first',['a.png']),b=entry('second',['b.png']);b.blocks[0]!.fileAssetUid=a.blocks[0]!.fileAssetUid
 await render([a,b]);await open('a.png');const image=doc.querySelector<HTMLImageElement>('img[alt="a.png"]')!,src=image.src
 await render([{...a,blocks:[{...a.blocks[0]!,mediaRef:'rotated',attachmentUid:'slot-added-to-old-asset'}]},b])
 expect(doc.querySelector('img[alt="a.png"]')).toBe(image);expect(image.src).toBe(src)
 await next();expect(doc.querySelector('img[alt="b.png"]')).not.toBeNull()
})
it('closes an updated version and retains the account binding',async()=>{
 const a=entry('first',['a.png']);await render([a]);await open('a.png')
 await render([{...a,version:'2'}]);expect(child.closed).toBe(true)
 child.closed=false;await open('a.png')
 await act(async()=>arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:7}))
 expect(child.closed).toBe(true)
})
it('can leave a failed single-image message using cross-message error-page navigation',async()=>{
 const a=entry('first',['a.png']),b=entry('second',['b.png'])
 for(const value of [a,b])value.mediaAccess={url:block=>`/${block.mediaRef}`,readScopeKey:value.key,prepareImageWhileChecking:true,subscribeReadState:listener=>{listener({status:'available'});return()=>{}}}
 await render([a,b]);await open('a.png')
 await act(async()=>doc.querySelector('img[alt="a.png"]')!.dispatchEvent(new Event('error')))
 expect(doc.querySelector('[role="alert"]')?.textContent).toContain('图片加载失败')
 expect(doc.querySelector<HTMLButtonElement>('button[aria-label="下一个媒体"]')?.disabled).toBe(false)
 await next();expect(doc.querySelector('img[alt="b.png"]')).not.toBeNull()
})
function pendingEntry(key:string,name:string,slot:string){
 const value=entry(key,[name]);const block=value.blocks[0]!;delete block.fileAssetUid
 Object.assign(block,{mediaRef:'',attachmentUid:slot,attachmentState:'pending'});return value
}
function readyBlock(value:ArkmeAttachmentNavigationEntry){const block={...value.blocks[0]!,mediaRef:`grant-${value.key}`,fileAssetUid:`asset-${value.key}`};delete block.attachmentState;return block}
it('stops on the pending slot, reads it once and continues the same image when its real version advances',async()=>{
 const a=entry('first',['a.png']),p=pendingEntry('pending','p.png','slot-p'),b=entry('last',['b.png']),ready=readyBlock(p)
 let resolve!:(blocks:typeof p.blocks)=>void;p.load=vi.fn(()=>new Promise(r=>{resolve=r}))
 await render([a,p,b]);await open('a.png');await next()
 expect(p.load).toHaveBeenCalledTimes(1);expect(doc.querySelector('[role="dialog"][aria-label="p.png"]')).not.toBeNull()
 expect(doc.querySelector('[role="status"]')?.textContent).toBe('图片加载中…');expect(doc.querySelector('img')).toBeNull()
 await act(async()=>resolve([ready]));expect(doc.querySelector<HTMLImageElement>('img[alt="p.png"]')?.src).toContain('grant-pending')
 await render([a,{...p,version:'2',blocks:[ready]},b])
 expect(child.closed).toBe(false);expect(doc.querySelector('img[alt="p.png"]')).not.toBeNull();expect(p.load).toHaveBeenCalledTimes(1)
 await next();expect(doc.querySelector('img[alt="b.png"]')).not.toBeNull()
})
it('retries only the attachment read and distinguishes multiple empty-ref upload slots',async()=>{
 const a=entry('first',['a.png']),p=pendingEntry('pending','p.png','slot-p'),q=pendingEntry('pending','q.png','slot-q')
 p.blocks.push({...q.blocks[0]!,sortOrder:1});p.load=vi.fn().mockRejectedValueOnce(new Error('read failed')).mockResolvedValue(p.blocks)
 await render([a,p]);await open('a.png');await next()
 expect(doc.querySelector('[role="alert"]')?.textContent).toBe('read failed')
 await act(async()=>[...doc.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='重试')!.click())
 expect(doc.querySelector('[role="status"]')?.textContent).toBe('附件上传中');expect(p.load).toHaveBeenCalledTimes(2)
 await next();expect(doc.querySelector('[role="dialog"][aria-label="q.png"]')).not.toBeNull();expect(p.load).toHaveBeenCalledTimes(3)
 expect(doc.querySelector('img')).toBeNull()
})
it('aborts a pending read on navigation and ignores its late ready reply',async()=>{
 const a=entry('first',['a.png']),p=pendingEntry('pending','p.png','slot-p'),b=entry('last',['b.png'])
 let signal!:AbortSignal,resolve!:(blocks:typeof p.blocks)=>void;p.load=vi.fn(value=>{signal=value;return new Promise(r=>{resolve=r})})
 await render([a,p,b]);await open('a.png');await next();await next()
 expect(signal.aborted).toBe(true);await act(async()=>resolve([readyBlock(p)]))
 expect(doc.querySelector('img[alt="b.png"]')).not.toBeNull();expect(doc.querySelector('img[alt="p.png"]')).toBeNull()
})
it('does not guess a ready slot from its filename when the true attachment uid is missing',async()=>{
 const a=entry('first',['a.png']),p=pendingEntry('pending','p.png','slot-p'),ready=readyBlock(p);delete ready.attachmentUid
 p.load=vi.fn().mockResolvedValue([ready]);await render([a,p]);await open('a.png');await next()
 expect(doc.querySelector('[role="alert"]')?.textContent).toBe('附件已移除或暂不可用');expect(doc.querySelector('img')).toBeNull()
 expect(doc.querySelector<HTMLButtonElement>('button[aria-label="上一个媒体"]')?.disabled).toBe(false)
})
it('offers retry and cross-message navigation after an ordinary chat image byte load fails',async()=>{
 await render([entry('first',['a.png']),entry('second',['b.png'])]);await open('a.png')
 await act(async()=>doc.querySelector('img[alt="a.png"]')!.dispatchEvent(new Event('error')))
 expect(doc.querySelector('[role="alert"]')?.textContent).toContain('图片加载失败')
 await act(async()=>doc.querySelector<HTMLButtonElement>('[role="alert"] button')!.click())
 expect(doc.querySelector('img[alt="a.png"]')).not.toBeNull()
 await next();expect(doc.querySelector('img[alt="b.png"]')).not.toBeNull()
})
it('retains a sibling resolved from the same pending read until its parent observes readiness',async()=>{
 const a=entry('first',['a.png']),p=pendingEntry('pending','p.png','slot-p'),q=pendingEntry('pending','q.png','slot-q')
 q.blocks[0]!.sortOrder=1;p.blocks.push(q.blocks[0]!)
 const ready=[readyBlock(p),readyBlock(q)];p.load=vi.fn().mockResolvedValue(ready)
 await render([a,p]);await open('a.png');await next();await next()
 expect(doc.querySelector('img[alt="q.png"]')).not.toBeNull();expect(p.load).toHaveBeenCalledTimes(1)
 await render([a,{...p,version:'2',blocks:ready}])
 expect(child.closed).toBe(false);expect(doc.querySelector('img[alt="q.png"]')).not.toBeNull();expect(p.load).toHaveBeenCalledTimes(1)
 await render([a,{...p,version:'3',blocks:ready}]);expect(child.closed).toBe(true)
})
