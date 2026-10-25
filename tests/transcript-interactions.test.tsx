// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { changeLocalTranscript, type LocalTranscriptChange, type LocalTranscriptEntry } from '../src/local-transcript-state.js'
import { quoteSourceContent } from '../src/message-quote.js'
import { useTranscriptInteractions } from '../src/client/TranscriptInteractions.js'
import { ArkmeMessageTextSelectionToolbar, registeredMessageTargets } from '../src/client/ArkmeMessageTextSelection.js'
const mocks=vi.hoisted(()=>({call:vi.fn(),copy:vi.fn(),play:vi.fn(),auth:{auth:{status:'authenticated',userId:11,environment:'prod'}}}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.call}))
vi.mock('../src/client/auth-store.js',()=>({arkmeAuthStore:{subscribe:()=>()=>{},getSnapshot:()=>mocks.auth}}))
vi.mock('../src/client/clipboard-text.js',()=>({copyText:mocks.copy}))
vi.mock('../src/client/message-quote-selection.js',async original=>({...await original<typeof import('../src/client/message-quote-selection.js')>(),quoteDigest:async(item:Parameters<typeof quoteSourceContent>[0])=>createHash('sha256').update(quoteSourceContent(item)).digest('hex')}))
vi.mock('../src/client/ArkmeDshMenu.js',()=>({ArkmeActionMenu:({actions,onClose}:any)=><div role="menu">{actions.map((a:any)=><button role="menuitem" key={a.id} disabled={a.disabled} onClick={()=>{a.onSelect()}}>{a.label}</button>)}</div>}))
let root:Root,host:HTMLDivElement
const stored=new Map<string,LocalTranscriptEntry>()
const original='重复词，重复词。'
function Fixture({text=original,scope='recording:123',enabled=true,omitFirst=false,playable=true}:{text?:string;scope?:string;enabled?:boolean;omitFirst?:boolean;playable?:boolean}) {
 const rows=[{id:'one',text,speaker:'说话人一',at:1000,playable},{id:'two',text:'第二段',speaker:'说话人二',at:2000,playable:true}].filter(row=>!omitFirst||row.id!=='one')
 const actions=useTranscriptInteractions({scope,rows,enabled,onPlay:mocks.play})
 return <><ArkmeMessageTextSelectionToolbar replySourceRef="ordinary-chat" />{actions.host}
 {rows.map(row=><article key={row.id} onContextMenu={e=>actions.contextMenu(row,e)}>{actions.checkbox(row)}{actions.renderText(row)}</article>)}{actions.controls}</>
}
async function select(start=4,end=7){
 const element=host.querySelector('[data-arkme-text-selection]')!,range=document.createRange()
 range.setStart(element.firstChild!,start);range.setEnd(element.firstChild!,end)
 await act(async()=>{document.getSelection()!.removeAllRanges();document.getSelection()!.addRange(range);element.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0}))})
}
const click=async(text:string)=>{await act(async()=>{[...document.querySelectorAll('button')].find(b=>b.textContent===text)!.click()})}
async function input(value:string){await act(async()=>{const el=document.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))})}
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 vi.stubGlobal('ResizeObserver',class{observe(){} disconnect(){}})
 vi.stubGlobal('CSS',{escape:(s:string)=>s.replaceAll('\"','\\\"')})
 Range.prototype.getBoundingClientRect=()=>new DOMRect(50,100,180,20)
 Range.prototype.getClientRects=()=>[new DOMRect(50,100,180,20)] as unknown as DOMRectList
 Element.prototype.scrollIntoView=vi.fn()
 stored.clear();mocks.copy.mockReset().mockResolvedValue(undefined);mocks.play.mockReset()
 mocks.call.mockReset().mockImplementation(async(op:string,p:{scope:string;ids?:string[];id?:string;change?:LocalTranscriptChange})=>{
  if(op==='transcript.local.change'){const key=p.scope+':'+p.id;stored.set(key,changeLocalTranscript(stored.get(key),p.change!,11))}
  return Object.fromEntries((p.ids??[p.id!]).flatMap(id=>{const entry=stored.get(p.scope+':'+id);return entry?[[id,entry]]:[]}))
 })
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();document.getSelection()?.removeAllRanges();vi.unstubAllGlobals()})
it('shows exactly one toolbar, copies only the selection, and selects the current block',async()=>{
 await act(async()=>root.render(<Fixture/>));await select()
 expect(document.querySelectorAll('[aria-label="选中文字操作"]')).toHaveLength(1)
 expect([...document.querySelectorAll('[aria-label="选中文字操作"] button')].map(b=>b.textContent)).toEqual(['复制','全选','标记','查找','替换','转发'])
 await click('复制');expect(mocks.copy).toHaveBeenCalledWith('重复词')
 await select();await click('全选');expect(document.getSelection()?.toString()).toBe(original)
})
it('replaces just the second occurrence, restores after remount, and can restore original',async()=>{
 await act(async()=>root.render(<Fixture/>));await select();await click('替换');await input('新词');await click('替换')
 expect(host.querySelector('[data-arkme-text-selection]')?.textContent).toBe('重复词，新词。')
 await act(async()=>root.unmount());root=createRoot(host);await act(async()=>root.render(<Fixture/>))
 expect(host.querySelector('[data-arkme-text-selection]')?.textContent).toBe('重复词，新词。')
 await click('本机更正 · 恢复原文');expect(host.querySelector('[data-arkme-text-selection]')?.textContent).toBe(original)
})
it('saves marks locally and cancels the same mark without changing text',async()=>{
 await act(async()=>root.render(<Fixture/>));await select();await click('标记')
 expect(stored.get('recording:123:one')?.marks[0]?.anchor).toMatchObject({text:'重复词',start:4,end:7})
 await select();await click('✓ 取消标记');expect(stored.get('recording:123:one')?.marks).toEqual([])
 expect(host.querySelector('[data-arkme-text-selection]')?.textContent).toBe(original)
})
it('retains replacement input on failed save and does not alter the displayed transcript',async()=>{
 await act(async()=>root.render(<Fixture/>));await select();await click('替换');await input('新词')
 const normal=mocks.call.getMockImplementation()!;mocks.call.mockImplementation(async(op,p)=>{if(op==='transcript.local.change')throw new Error('磁盘已满');return normal(op,p)})
 await click('替换');expect(document.querySelector('textarea')?.value).toBe('新词');expect(document.querySelector('[role="alert"]')?.textContent).toBe('磁盘已满')
 expect(host.querySelector('[data-arkme-text-selection]')?.textContent).toBe(original)
})
it('searches only the active transcript and selects/plays multiple rows in time order',async()=>{
 await act(async()=>root.render(<Fixture scope="call:123"/>));await select();await click('查找');expect(host.querySelectorAll('mark')).toHaveLength(2)
 await click('关闭查找');document.getSelection()?.removeAllRanges()
 await act(async()=>host.querySelector('article')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:50,clientY:50})))
 expect([...document.querySelectorAll('[role="menuitem"]')].map(b=>b.textContent)).toEqual(['复制','多选','播放'])
 await click('多选');expect(document.querySelector('[role="menu"]')).toBeNull();await act(async()=>{(host.querySelectorAll('input[type="checkbox"]')[1] as HTMLInputElement).click()})
 await click('播放');expect(mocks.play).toHaveBeenLastCalledWith(['one','two'])
})
it('does not apply local corrections to a changed cloud original or another scope',async()=>{
 stored.set('recording:123:one',{revision:1,original,text:'旧更正',marks:[]})
 await act(async()=>root.render(<Fixture text="云端新原文"/>));expect(host.querySelector('[data-arkme-text-selection]')?.textContent).toBe('云端新原文')
 expect(host.textContent).toContain('原文已更新')
 await act(async()=>root.render(<Fixture scope="call:123"/>));expect(host.querySelector('[data-arkme-text-selection]')?.textContent).toBe(original)
})

it('does not measure or load marks for offscreen transcript content skipped by the browser',async()=>{
 await act(async()=>root.render(<Fixture/>))
 const elements=host.querySelectorAll<HTMLElement>('[data-arkme-text-selection]')
 elements[0]!.checkVisibility=vi.fn(()=>true)
 elements[1]!.checkVisibility=vi.fn(()=>false)
 expect(registeredMessageTargets('transcript:prod:11:recording:123').map(row=>row.target.item.itemUid)).toEqual(['one'])
 expect(elements[1]!.checkVisibility).toHaveBeenCalledWith({contentVisibilityAuto:true})
})

const openContext=async()=>{await act(async()=>host.querySelector('article')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:50,clientY:50})))}
it('uses the latest transcript and playback availability while a menu is open',async()=>{
 await act(async()=>root.render(<Fixture/>));await openContext()
 await act(async()=>root.render(<Fixture text="更新后的原文" playable={false}/>))
 expect([...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(b=>b.textContent==='播放')?.disabled).toBe(true)
 await click('复制');expect(mocks.copy).toHaveBeenLastCalledWith('更新后的原文')
 expect(document.querySelector('[role="menu"]')).toBeNull()
})
it.each(['scope','disabled','removed'] as const)('dismisses the menu on %s changes without resurrecting it later',async reason=>{
 await act(async()=>root.render(<Fixture/>));await openContext()
 await act(async()=>root.render(<Fixture scope={reason==='scope'?'call:456':'recording:123'} enabled={reason!=='disabled'} omitFirst={reason==='removed'}/>))
 expect(document.querySelector('[role="menu"]')).toBeNull()
 await act(async()=>root.render(<Fixture/>))
 expect(document.querySelector('[role="menu"]')).toBeNull()
})
it('keeps the partial-selection toolbar ahead of the block menu',async()=>{
 await act(async()=>root.render(<Fixture/>));await select()
 await act(async()=>host.querySelector('[data-arkme-text-selection]')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:50,clientY:50})))
 expect(document.querySelector('[aria-label="选中文字操作"]')).not.toBeNull()
 expect(document.querySelector('[role="menu"]')).toBeNull()
})
