// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TeamWorldManagement } from '../src/client/TeamWorldManagement.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import type { ArkmeWorldFeedItem } from '../src/types.js'
import type { TeamWorldFeedbackTarget } from '../src/team-world-contract.js'
const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<object>(), callArkme: (...args: unknown[]) => call(...args) }))
const comment: ArkmeWorldFeedItem = { recordRef:'comment',authorName:'用户甲',headline:'',textContent:'当前公开评论',imageRefs:['panel-image'],imageCount:1,tags:[],templateKind:0,createdAtMillis:100,publishedAtMillis:100,videoCount:0,voiceCount:0,extendCount:0 }
const event = {contentRef:'original-ref',key:'event',sequence:21,kind:'comment',isMe:false,at:100,eventRef:'event-ref',preview:{title:'关联帖子',text:'内部原稿正文',imageCount:0,teamName:'团队'},comment}
const target = { original:{title:'关联帖子',text:'内部原稿正文',assets:[]},comment } as unknown as TeamWorldFeedbackTarget
let host: HTMLDivElement, root: Root, denied: boolean
beforeEach(() => {
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);call.mockReset();denied=false
 arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:42})
 call.mockImplementation(async(op,input)=>{
  if(op==='world.image.read')return {mediaType:'image/png',dataBase64:'cG5n'}
  if(op==='world.replies')return {items:[],hasMore:false}
  if(op==='team.app.teams'||op==='world.author-labels')return []
  if(op!=='team.world')return {items:[],unavailableRecordRefs:[]}
  if(input.action==='originals')return {items:[],hasMore:false}
  if(input.action==='feedback')return {items:[denied?{...event,comment:undefined}:event],hasMore:false,afterSequence:21,offeredThrough:21,seenThrough:0}
  if(input.action==='feedback-target')return denied?{...target,comment:undefined}:target
  throw Error('unexpected')
 })
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals()})
const button=(label:string)=>document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
async function mount(){await act(async()=>root.render(<TeamWorldManagement accountKey="test:42" context={{teamRef:'team',jotmoId:'team',name:'团队',capabilities:{publish:true,manage:true,feedback:true,reply:true}}}/>));await act(async()=>[...document.querySelectorAll('button')].find(e=>e.textContent==='共同反馈')!.click())}
async function open(){await act(async()=>host.querySelector<HTMLElement>('[data-world-record-ref]')!.click())}
it('keeps the list node, position and focus when closing the shared World panel',async()=>{
 await mount();const list=host.querySelector<HTMLElement>('.wm-feedback-scroll')!;const card=host.querySelector<HTMLElement>('[data-world-record-ref]')!;list.scrollTop=167
 await open()
 expect(document.querySelector('[aria-label="世界动态详情"] [data-arkme-detail-author]')).not.toBeNull()
 expect(host.querySelector('.wm-feedback-scroll')).toBe(list);expect(list.scrollTop).toBe(167)
 expect(document.querySelector('.wm-feedback-original')?.textContent).toContain('内部原稿正文')
 expect(document.querySelector('[aria-label="世界动态详情"]')?.textContent).not.toContain('内部原稿正文')
 expect(call.mock.calls.some(([op])=>op==='world.record.read')).toBe(false)
 await act(async()=>button('关闭动态详情').click())
 expect(document.querySelector('[aria-label="世界动态详情"]')).toBeNull()
 expect(host.querySelector('[data-world-record-ref]')).toBe(card);expect(list.scrollTop).toBe(167);expect(document.activeElement).toBe(card)
})
it('cancels a pending detail and never reopens it on a late response',async()=>{
 await mount();let resolve!:(value:TeamWorldFeedbackTarget)=>void;let signal:AbortSignal|undefined
 const previous=call.getMockImplementation()!
 call.mockImplementation((op,input,s)=>input.action==='feedback-target'?new Promise(r=>{resolve=r;signal=s}):previous(op,input,s))
 await open();expect(button('关闭反馈详情')).not.toBeNull()
 await act(async()=>button('关闭反馈详情').click());expect(signal?.aborted).toBe(true)
 await act(async()=>resolve(target))
 expect(document.querySelector('[role="dialog"]')).toBeNull();expect(host.querySelector('.wm-feedback-list')).not.toBeNull()
})
it('preserves detail across renewed feedback capabilities and revokes the active page and panel',async()=>{
 let starts:number[]=[]
 const previous=call.getMockImplementation()!
 call.mockImplementation((op,input,s)=>{
  if(input.action==='feedback'){
   starts.push(input.afterSequence)
   const renewed={...event,key:'renewed-key-'+starts.length,eventRef:'renewed-event-'+starts.length}
   return Promise.resolve(input.afterSequence===0?{items:[{...event,key:'first',sequence:20,eventRef:'first-event',comment:{...comment,recordRef:'first'}}],hasMore:true,afterSequence:20,offeredThrough:20,seenThrough:0}:{items:[denied?{...renewed,comment:undefined}:renewed],hasMore:false,afterSequence:21,offeredThrough:21,seenThrough:0})
  }
  return previous(op,input,s)
 })
 await mount();await act(async()=>[...document.querySelectorAll('button')].find(e=>e.textContent==='下一页')!.click());await open()
 const area=button('评论内容') as unknown as HTMLTextAreaElement
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,'保留草稿');area.dispatchEvent(new Event('input',{bubbles:true}))})
 await act(async()=>window.dispatchEvent(new Event('focus')))
 expect(starts).toEqual([0,20,20]);expect(document.querySelector<HTMLTextAreaElement>('[aria-label="评论内容"]')!.value).toBe('保留草稿')
 denied=true;await act(async()=>window.dispatchEvent(new Event('focus')))
 expect(starts).toEqual([0,20,20,20]);expect(document.querySelector('[aria-label="评论内容"]')).toBeNull()
 expect(document.body.textContent).not.toContain('当前公开评论');expect(document.querySelector('img[alt*="发布的图片"]')).toBeNull()
 expect(document.body.textContent).toContain('这条评论已不可访问')
})
it('keeps the detail open when Escape dismisses its image preview first',async()=>{
 await mount();await open()
 const pane=document.querySelector('[aria-label="世界动态详情"]')!
 await act(async()=>pane.querySelector<HTMLButtonElement>('[aria-label="预览用户甲发布的图片 1"]')!.click())
 expect(button('关闭图片预览')).not.toBeNull()
 await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
 expect(button('关闭图片预览')).toBeNull();expect(document.querySelector('[aria-label="世界动态详情"]')).toBe(pane)
 await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
 expect(document.querySelector('[aria-label="世界动态详情"]')).toBeNull()
})

it('groups interleaved feedback by original identity, not identical text, and renews references without remounting', async()=>{
 let generation=0
 const previous=call.getMockImplementation()!
 call.mockImplementation((op,input,s)=>{
  if(input.action==='feedback'){
   generation++
   return Promise.resolve({items:[
    {...event,contentRef:`a-${generation}`,sequence:21},
    {...event,contentRef:`b-${generation}`,sequence:22,comment:{...comment,recordRef:'other-comment'}},
    {...event,contentRef:`a-${generation}`,sequence:23,kind:'reaction',comment:undefined,actorName:'小周',reaction:{active:false,expression:{text:'谢谢',emoji:'🙏'}}},
   ],hasMore:false,afterSequence:23,offeredThrough:23,seenThrough:0})
  }
  return previous(op,input,s)
 })
 await mount()
 const groups=host.querySelectorAll('.wm-feedback-group')
 expect(groups).toHaveLength(2)
 expect(groups[0]!.querySelectorAll('.wm-feedback-card,.wm-feedback-row')).toHaveLength(2)
 expect(groups[0]!.textContent).toContain('小周 取消了表态')
 expect(groups[0]!.textContent).toContain('谢谢')
 expect(groups[1]!.querySelectorAll('.wm-feedback-card,.wm-feedback-row')).toHaveLength(1)
 expect(host.querySelectorAll('.wm-feedback-original')).toHaveLength(2)
 expect(call.mock.calls.some(([,input])=>input.action==='original'||input.action==='feedback-target')).toBe(false)
 const card=groups[0]!.querySelector('[data-world-record-ref]')
 await act(async()=>window.dispatchEvent(new Event('focus')))
 expect(host.querySelector('.wm-feedback-group')).toBe(groups[0])
 expect(host.querySelector('[data-world-record-ref]')).toBe(card)
})

it('clears original text, private images and the open preview after loss of team access',async()=>{
 const revoke=vi.fn()
 vi.stubGlobal('URL',class extends URL {static createObjectURL=()=> 'blob:team-original';static revokeObjectURL=revoke})
 const previous=call.getMockImplementation()!
 call.mockImplementation((op,input,s)=>{
  if(op==='image.read')return Promise.resolve({mediaType:'image/png',dataBase64:'cG5n'})
  if(input.action==='feedback')return denied?Promise.reject(Error('没有团队权限')):Promise.resolve({items:[{...event,preview:{...event.preview,imageRefs:['private-image'],imageCount:1}}],hasMore:false,afterSequence:21,offeredThrough:21,seenThrough:0})
  return previous(op,input,s)
 })
 await mount()
 await act(async()=>button('放大图片 1').click())
 expect(document.querySelector('[aria-label="世界图片预览"]')).not.toBeNull()
 denied=true;await act(async()=>window.dispatchEvent(new Event('focus')))
 expect(document.body.textContent).not.toContain('内部原稿正文')
 expect(document.body.textContent).not.toContain('当前公开评论')
 expect(document.querySelector('[aria-label="世界图片预览"]')).toBeNull()
 expect(document.querySelector('.wm-feedback-group')).toBeNull()
 expect(revoke).toHaveBeenCalledWith('blob:team-original')
})

const original = {contentRef:'original-ref',recordRef:'original-public',revision:1,title:'团队原稿标题',text:'内部原稿正文',format:'plain',sourceKind:'local',assets:[],deleted:false,publicRequested:true,pending:false,updatedAt:100}
const publicOriginal = {...comment,recordRef:'original-public',textContent:'原始公开快记',imageRefs:[],imageCount:0}
const originalReply = {interactionRef:'root-reply',parentRef:'original-public',authorName:'小乙',textContent:'原始快记下的评论',createdAtMillis:100,publishedAtMillis:100,imageCount:0,videoCount:0,voiceCount:0}
function originalCalls(){
 const previous=call.getMockImplementation()!
 call.mockImplementation((op,input,s)=>{
  if(op==='team.world'&&input.action==='original')return Promise.resolve({...original,publicRequested:!denied})
  if(op==='team.world'&&input.action==='feedback')return Promise.resolve({items:[{...event,...(denied?{comment:undefined}:{})}],hasMore:false,afterSequence:21,offeredThrough:21,seenThrough:0})
  if(op==='world.record.read')return Promise.resolve({...publicOriginal})
  if(op==='world.replies'&&input.recordRef==='original-public')return Promise.resolve({items:[originalReply],hasMore:false})
  return previous(op,input,s)
 })
}
it('opens the original World note and its comments, then returns to the same list and original trigger',async()=>{
 originalCalls();await mount();const list=host.querySelector<HTMLElement>('.wm-feedback-scroll')!;list.scrollTop=213
 const trigger=button('查看原始快记及评论');await act(async()=>trigger.click())
 const pane=document.querySelector('[aria-label="世界动态详情"]')!
 expect(pane.textContent).toContain('原始公开快记');expect(pane.textContent).toContain('原始快记下的评论')
 expect(pane.textContent).not.toContain('内部原稿正文')
 expect(call).toHaveBeenCalledWith('world.record.read',{recordRef:'original-public'},expect.any(AbortSignal))
 expect(call.mock.calls.some(([,input])=>input.action==='feedback-target')).toBe(false)
 expect(button('查看小乙的回复')).toBeNull()
 expect(pane.textContent).not.toContain('展开回复');expect(pane.textContent).not.toContain('暂无回复')
 await act(async()=>button('关闭动态详情').click());expect(document.activeElement).toBe(trigger)
 expect(host.querySelector('.wm-feedback-scroll')).toBe(list);expect(list.scrollTop).toBe(213)
})
it('refreshes original comments while retaining a draft, then removes public actions when the original is withdrawn',async()=>{
 originalCalls();await mount();await act(async()=>button('查看原始快记及评论').click())
 const area=document.querySelector<HTMLTextAreaElement>('[aria-label="评论内容"]')!
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,'保留原帖评论草稿');area.dispatchEvent(new Event('input',{bubbles:true}))})
 const previous=call.getMockImplementation()!
 call.mockImplementation((op,input,s)=>op==='world.replies'&&input.recordRef==='original-public'?Promise.resolve({items:[],hasMore:false}):previous(op,input,s))
 await act(async()=>window.dispatchEvent(new Event('focus')))
 expect(document.querySelector<HTMLTextAreaElement>('[aria-label="评论内容"]')!.value).toBe('保留原帖评论草稿')
 expect(document.querySelector('[aria-label="世界动态详情"]')!.textContent).not.toContain('原始快记下的评论')
 denied=true;await act(async()=>window.dispatchEvent(new Event('focus')))
 expect(document.querySelector('[aria-label="评论内容"]')).toBeNull()
 expect(document.querySelector('[aria-label="团队快记详情"]')?.textContent).toContain('内部原稿正文')
 expect(document.body.textContent).not.toContain('原始公开快记')
})
it('cancels original resolution and never reads the public note after a late private response',async()=>{
 originalCalls();let resolve!:(value:unknown)=>void;let signal:AbortSignal|undefined
 const previous=call.getMockImplementation()!
 call.mockImplementation((op,input,s)=>input.action==='original'?new Promise(r=>{resolve=r;signal=s}):previous(op,input,s))
 await mount();await act(async()=>button('查看原始快记及评论').click())
 await act(async()=>button('关闭快记详情').click());expect(signal?.aborted).toBe(true)
 await act(async()=>resolve(original))
 expect(call.mock.calls.some(([op])=>op==='world.record.read')).toBe(false)
 expect(document.querySelector('[role="dialog"]')).toBeNull()
})
it('drops the original and feedback list if resolving the original loses team authority',async()=>{
 originalCalls();const previous=call.getMockImplementation()!
 call.mockImplementation((op,input,s)=>input.action==='original'?Promise.reject(Error('团队权限已撤销')):previous(op,input,s))
 await mount();await act(async()=>button('查看原始快记及评论').click())
 expect(document.querySelector('.wm-feedback-group')).toBeNull()
 expect(document.body.textContent).not.toContain('内部原稿正文')
 expect(document.querySelector('[role="dialog"]')).toBeNull()
 expect(call.mock.calls.some(([op])=>op==='world.record.read')).toBe(false)
})
it('keeps detail and comments stable while sending, then shows own feedback without a self-unread badge',async()=>{
 originalCalls();const previous=call.getMockImplementation()!;let resolve!:(value:unknown)=>void, saved=false
 const created={...originalReply,interactionRef:'my-new-comment',authorName:'我',textContent:'我的新评论'}
 call.mockImplementation((op,input,s)=>{
  if(op==='world.interactions.create-text')return new Promise(r=>{resolve=r})
  if(op==='team.world'&&input.action==='feedback'&&saved)return Promise.resolve({items:[{...event},{...event,sequence:22,eventRef:'new-event',isMe:true,comment:{...comment,recordRef:'my-new-comment',imageRefs:[],textContent:'我的新评论'}}],hasMore:false,afterSequence:22,offeredThrough:22,seenThrough:0})
  return previous(op,input,s)
 })
 await mount();await act(async()=>button('查看原始快记及评论').click())
 const panel=document.querySelector('[aria-label="世界动态详情"]')!,area=panel.querySelector<HTMLTextAreaElement>('textarea')!
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,'我的新评论');area.dispatchEvent(new Event('input',{bubbles:true}))})
 await act(async()=>[...panel.querySelectorAll('button')].find(e=>e.textContent==='发送')!.click())
 expect(panel.textContent).toContain('发送中…');expect(panel.textContent).not.toContain('冻结');expect(panel.textContent).not.toContain('发送结果待确认')
 expect(panel.textContent).toContain('原始快记下的评论')
 saved=true;await act(async()=>resolve({interaction:created}))
 expect(document.querySelector('[aria-label="世界动态详情"]')).toBe(panel)
 expect(panel.querySelector('textarea')).toBe(area);expect(area.value).toBe('')
 expect(panel.textContent).toContain('原始快记下的评论');expect(panel.textContent).toContain('我的新评论')
 expect(call.mock.calls.filter(([op])=>op==='world.record.read')).toHaveLength(1)
 expect(call.mock.calls.filter(([op,input])=>op==='world.replies'&&input.recordRef==='original-public')).toHaveLength(1)
 const row=host.querySelector('[data-world-record-ref="my-new-comment"]')!;expect(row).not.toBeNull();expect(row.querySelector('[aria-label="未读"]')).toBeNull()
})
