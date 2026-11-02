// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeWorldRecordDetailView } from '../src/client/ArkmeWorldRecordDetail.js'
import { ArkmeWorldReactions } from '../src/client/ArkmeWorldReactions.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { worldReactionContexts, worldCloudReactionPreview } from '../src/client/world-reactions.js'
import { reactionLibrary } from '../src/client/reaction-library.js'
import { reactionFixture } from './reaction-fixture.js'
import type { ArkmeWorldFeedItem } from '../src/types.js'
const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<object>(), callArkme: (...args: unknown[]) => call(...args) }))
const item: ArkmeWorldFeedItem = {recordRef:'post',authorName:'团队',headline:'',textContent:'正文',tags:[],templateKind:0,imageRefs:[],imageCount:0,videoCount:0,voiceCount:0,extendCount:0,createdAtMillis:1,publishedAtMillis:1}
let host: HTMLDivElement, root: Root
const closed = vi.fn()
function Detail(){const [open,setOpen]=useState(true);return open ? <ArkmeWorldRecordDetailView item={item} renderAvatar={()=>null} onClose={()=>{closed();setOpen(false)}}><ArkmeWorldReactions item={item} onUnavailable={()=>{}}><span>评论</span></ArkmeWorldReactions></ArkmeWorldRecordDetailView> : null}
beforeEach(()=>{
 vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);closed.mockClear();reactionFixture.reset();call.mockReset()
 arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:1})
 call.mockImplementation(async(op,input)=>op==='world.reactions.prepare'?{items:[{recordRef:'post',target:{id:'target',worldRecordRef:'world-capability'},visibility:'published'}],unavailableRecordRefs:[]}:reactionFixture.call(op,input))
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();worldReactionContexts.setScope(undefined);worldCloudReactionPreview.setScope(undefined);reactionLibrary.setScope(undefined);vi.unstubAllGlobals();vi.useRealTimers()})
const query=(label:string)=>document.querySelector<HTMLElement>(`[aria-label="${label}"]`)!
async function mount(){await act(async()=>root.render(<Detail/>));await act(async()=>{await vi.advanceTimersByTimeAsync(200)});await act(async()=>{await vi.advanceTimersByTimeAsync(100)})}
async function click(el:HTMLElement){await act(async()=>el.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0})));if(el.isConnected)await act(async()=>el.click())}
it('saves a portaled reaction without dismissing the World detail and reads it after reopening',async()=>{
 await mount();await click(query('表态'));await click(query('赞'))
 expect(closed).not.toHaveBeenCalled();expect(query('世界动态详情')).not.toBeNull()
 expect(call.mock.calls.filter(([op,input])=>op==='world.reactions'&&input.action==='set')).toHaveLength(1)
 expect(reactionFixture.states.get('target')?.selections).toHaveLength(1)
 await act(async()=>root.render(null));worldCloudReactionPreview.setScope(undefined);worldReactionContexts.setScope(undefined)
 await mount();await click(query('表态'));expect(query('赞').getAttribute('aria-pressed')).toBe('true')
})
it('Escape closes only the reaction panel and restores its trigger before closing detail',async()=>{
 await mount();await click(query('表态'));const trigger=query('表态');query('赞').focus()
 await act(async()=>query('赞').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})))
 expect(query('表态面板')).toBeNull();expect(closed).not.toHaveBeenCalled();expect(document.activeElement).toBe(trigger)
 await act(async()=>trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})))
 expect(closed).toHaveBeenCalledOnce()
})
it('still dismisses detail when pressing outside both the detail and its reaction panel',async()=>{
 await mount();await click(query('表态'));await click(document.body);expect(closed).toHaveBeenCalledOnce();expect(query('表态面板')).toBeNull()
})

it('moves keyboard focus into the picker every time it opens, so Escape never dismisses the parent detail',async()=>{
 await mount()
 for(let i=0;i<2;i++){
  const trigger=query('表态');trigger.focus();await click(trigger)
  const picker=query('表态面板');expect(picker.contains(document.activeElement)).toBe(true)
  await act(async()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})))
  expect(query('表态面板')).toBeNull();expect(closed).not.toHaveBeenCalled();expect(document.activeElement).toBe(trigger)
 }
})
