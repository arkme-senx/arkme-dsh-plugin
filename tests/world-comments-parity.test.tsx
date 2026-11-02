// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorldCard } from '../src/client/ArkmeWorldSurface.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import type { ArkmeWorldFeedItem, ArkmeWorldInteractionItem } from '../src/types.js'
const {call}=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',async original=>({...await original<object>(),callArkme:(...args:unknown[])=>call(...args)}))
const post:ArkmeWorldFeedItem={recordRef:'post',authorName:'团队',headline:'原文',textContent:'原始正文',tags:[],templateKind:0,imageRefs:[],imageCount:0,videoCount:0,voiceCount:0,extendCount:0,createdAtMillis:1,publishedAtMillis:1}
const row=(id:string,parent:string):ArkmeWorldInteractionItem=>({interactionRef:id,parentRef:parent,authorName:id,textContent:`正文 ${id}`,createdAtMillis:1,publishedAtMillis:1,imageCount:0,videoCount:0,voiceCount:0})
let host:HTMLDivElement,root:Root
const created=vi.fn()
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);call.mockReset();created.mockClear();arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:42})
 call.mockImplementation(async(op,p)=>{
  if(op==='team.app.teams'||op==='world.author-labels')return []
  if(op==='world.reactions.prepare')return {items:[],unavailableRecordRefs:[]}
  if(op==='world.replies'){
   if(p.recordRef==='post')return p.cursor?{items:[row('second','post')],hasMore:false}:{items:[row('first','post')],hasMore:true,nextCursor:'next'}
   if(p.recordRef==='first')return {items:[row('nested','first')],hasMore:false}
   return {items:[],hasMore:false}
  }
  if(op==='world.interactions.create-text')return {interaction:{...row('sent',p.targetRef),textContent:p.textContent}}
  return {items:[],hasMore:false}
 })
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
async function mount(){await act(async()=>root.render(<WorldCard item={post} detail playable={false} voiceprintActive={false} voiceprintLoading={false} interactionsOpen onOpenInteractions={()=>{}} onInteractionCreated={created} onToggleVoiceprint={()=>{}}/>))}
const panel=()=>host.querySelector<HTMLElement>('[data-world-comment-panel]')!
const button=(text:string)=>[...panel().querySelectorAll('button')].find(x=>x.textContent===text)!
async function draft(value:string){const input=panel().querySelector('textarea')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))});return input}
it('shows replies immediately; load more appends and retains reply target, editor and the first comment',async()=>{
 await mount();expect(panel().textContent).toContain('正文 nested');expect(panel().textContent).not.toMatch(/展开回复|查看回复|暂无回复|下一页评论/)
 const first=panel().querySelector('[data-world-comment-level="root"]')!;expect(first).not.toBeNull()
 await act(async()=>button('回复').click());const input=await draft('继续讨论')
 await act(async()=>button('加载更多评论').click())
 expect(panel().textContent).toContain('正文 first');expect(panel().textContent).toContain('正文 nested');expect(panel().textContent).toContain('正文 second')
 expect(panel().querySelector('textarea')).toBe(input);expect(input.value).toBe('继续讨论');expect(panel().textContent).toContain('取消回复')
 expect(panel().querySelector('[data-world-comment-level="root"]')).toBe(first)
 await act(async()=>button('发送').click());expect(call.mock.calls.find(([op])=>op==='world.interactions.create-text')?.[1].targetRef).toBe('first')
 expect(panel().textContent).toContain('继续讨论');expect(panel().textContent).not.toContain('冻结');expect(input.value).toBe('');expect(created).toHaveBeenCalledOnce()
})
it('clears old comments when the next authorized page reports revocation',async()=>{
 await mount();const previous=call.getMockImplementation()!;call.mockImplementation((op,p,s)=>op==='world.replies'&&p.cursor?Promise.reject(Error('已撤回公开')):previous(op,p,s))
 await act(async()=>button('加载更多评论').click());expect(panel().textContent).not.toContain('正文 first');expect(panel().textContent).not.toContain('正文 nested');expect(panel().textContent).toContain('已撤回公开')
})
