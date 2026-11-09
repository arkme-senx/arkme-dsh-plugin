import {applyMessageTextReplacement,resolveMessageTextReplacement} from '../src/client/message-text-replacement.js'
import type {PersonalTranscriptEntry,TranscriptViewCommand} from '../src/transcript-view-contract.js'
// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { changeLocalTranscript } from './helpers/legacy-transcript-owner.js'
import type { LocalTranscriptEntry } from '../src/local-transcript-state.js'
import { quoteSourceContent } from '../src/message-quote.js'
import { useTranscriptInteractions } from '../src/client/TranscriptInteractions.js'
import { ArkmeCallDetailContent } from '../src/client/ArkmeCallDetailContent.js'
import type { ArkmeCallDetail } from '../src/types.js'
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
function Fixture({text=original,scope='recording:123',enabled=true,omitFirst=false,playable=true,privateRows='all'}:{text?:string;scope?:string;enabled?:boolean;omitFirst?:boolean;playable?:boolean;privateRows?:'all'|'none'|'second'}) {
 const rows=[{id:'one',text,speaker:'说话人一',at:1000,playable},{id:'two',text:'第二段',speaker:'说话人二',at:2000,playable:true}].map(row=>({...row,sourceVersion:createHash('sha256').update(row.text).digest('hex'),viewRef:privateRows==='none'||privateRows==='second'&&row.id==='one'?undefined:JSON.stringify({scope,id:row.id,text:row.text})})).filter(row=>!omitFirst||row.id!=='one')
 const actions=useTranscriptInteractions({scope,rows,enabled,onPlay:mocks.play})
 return <><ArkmeMessageTextSelectionToolbar replySourceRef="ordinary-chat" />{actions.host}
 {rows.map(row=><article key={row.id} onContextMenu={e=>actions.contextMenu(row,e)}>{actions.checkbox(row)}{actions.renderText(row)}</article>)}{actions.controls}</>
}
async function select(start=4,end=7,index=0){
 const element=host.querySelectorAll('[data-arkme-text-selection]')[index]!,range=document.createRange()
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
 mocks.call.mockReset().mockImplementation(async(op:string,p:any)=>{
  if(op==='transcript.views.capabilities')return {supported:true,protocol_version:1}
  const project=(ref:string):PersonalTranscriptEntry=>{const r=JSON.parse(ref),entry=stored.get(r.scope+':'+r.id)??{revision:0,original:r.text,text:r.text,marks:[]},changed=entry.original!==r.text;return {...entry,text:changed?r.text:entry.text,original:r.text,originalVersion:createHash('sha256').update(r.text).digest('hex'),originalDigest:'a'.repeat(64),originalChanged:changed,...(changed?{previousText:entry.text}:{})}}
  if(op==='transcript.views.read')return Object.fromEntries(p.items.map((item:any)=>[item.id,project(item.ref)]))
  if(op==='transcript.views.change'){
   const row=JSON.parse(p.ref),key=row.scope+':'+row.id,c=p.command as TranscriptViewCommand,previous=stored.get(key),current=project(p.ref)
   const mark=c.action==='add_mark'?{kind:'add' as const,operationId:c.operation_id,anchor:c.anchor!}:c.action==='remove_mark'?{kind:'remove' as const,operationId:c.operation_id,annotationId:c.annotation_id!}:undefined
   const text=c.action==='replace'?applyMessageTextReplacement(current.text,resolveMessageTextReplacement({textContent:current.text,textFormat:'plain'},c.anchor!),c.replacement!).text:undefined
   stored.set(key,changeLocalTranscript(previous,{id:row.id,original:row.text,expectedRevision:c.expected_revision,...(text===undefined?{}:{text}),...(mark?{mark}:{}),...(c.action==='restore'?{restore:true}:{})},11));return project(p.ref)
  }
  throw new Error('Unexpected '+op)
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
it('replaces the second single-character selection and restores directly from the row after remount', async () => {
 const text = '是，是。'
 await act(async () => root.render(<Fixture text={text} />))
 await select(2, 3)
 await click('替换'); await input('对'); await click('替换')
 expect(host.querySelector('[data-arkme-text-selection]')?.textContent).toBe('是，对。')
 await act(async () => root.unmount()); root = createRoot(host)
 await act(async () => root.render(<Fixture text={text} />))
 expect(host.querySelector('[data-arkme-text-selection]')?.textContent).toBe('是，对。')
 const restore = [...host.querySelectorAll('button')].find(button => button.textContent === '个人更正 · 恢复原文')!
 expect(restore.title).toContain('原文：是，是。')
 await act(async () => { restore.click(); restore.click() })
 expect(mocks.call.mock.calls.filter(([operation, params]) => operation === 'transcript.views.change' && params.command.action === 'restore')).toHaveLength(1)
 expect(host.querySelector('[data-arkme-text-selection]')?.textContent).toBe(text)
 expect(host.querySelectorAll('article button')).toHaveLength(0)
 expect(document.querySelector('[role="dialog"]')).toBeNull()
 expect(mocks.play).not.toHaveBeenCalled()
})
it('saves private marks in the cloud and cancels the same mark without changing text',async()=>{
 await act(async()=>root.render(<Fixture/>));await select();await click('标记')
 expect(stored.get('recording:123:one')?.marks[0]?.anchor).toMatchObject({text:'重复词',start:4,end:7})
 await select();await click('✓ 取消标记');expect(stored.get('recording:123:one')?.marks).toEqual([])
 expect(host.querySelector('[data-arkme-text-selection]')?.textContent).toBe(original)
})
it('retains replacement input on failed save and does not alter the displayed transcript',async()=>{
 await act(async()=>root.render(<Fixture/>));await select();await click('替换');await input('新词')
 const normal=mocks.call.getMockImplementation()!;mocks.call.mockImplementation(async(op,p)=>{if(op==='transcript.views.change')throw new Error('磁盘已满');return normal(op,p)})
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
 expect(host.querySelector('article button')?.textContent).toBe('原文已更新 · 恢复原文')
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
it('drops the private wording when the Host reports an account change before the auth store rerenders',async()=>{
 await act(async()=>root.render(<Fixture/>));await select();await click('替换');await input('私人新词');await click('替换');expect(host.textContent).toContain('私人新词')
 const normal=mocks.call.getMockImplementation()!;mocks.call.mockImplementation(async(op,p)=>{if(op==='transcript.views.read')throw Object.assign(new Error('账号已变化'),{body:{code:'transcript-account-changed',httpStatus:409}});return normal(op,p)})
 await act(async()=>{document.getSelection()?.removeAllRanges();window.dispatchEvent(new Event('focus'))})
 expect(host.querySelector('[data-arkme-text-selection]')?.textContent).toBe(original)
})

it('closes the existing replacement editor when a background read observes source revocation', async () => {
 await act(async () => root.render(<Fixture />))
 await select(); await click('替换'); await input('未提交私人草稿')
 const normal = mocks.call.getMockImplementation()!
 mocks.call.mockImplementation(async (op, p) => {
  if (op === 'transcript.views.read') throw Object.assign(new Error('来源已撤权'), { body: { code: 'transcript-source-unavailable', httpStatus: 403 } })
  return normal(op, p)
 })
 await act(async () => { document.getSelection()?.removeAllRanges(); window.dispatchEvent(new Event('focus')) })
 expect(document.querySelector('textarea')).toBeNull()
})

it('checks source access while private prose is selected without replacing an active selection',async()=>{
 stored.set('recording:123:one',{revision:1,original,text:'私人词，私人词。',marks:[]})
 await act(async()=>root.render(<Fixture/>));await select()
 expect(document.getSelection()?.toString()).toBe('私人词')
 stored.set('recording:123:one',{revision:2,original,text:'另一设备的新更正',marks:[]})
 const before=mocks.call.mock.calls.filter(([op])=>op==='transcript.views.read').length
 await act(async()=>{window.dispatchEvent(new Event('focus'))})
 expect(mocks.call.mock.calls.filter(([op])=>op==='transcript.views.read').length).toBeGreaterThan(before)
 expect(host.querySelector('[data-arkme-text-selection]')?.textContent).toBe('私人词，私人词。')
 expect(document.getSelection()?.toString()).toBe('私人词')
 const normal=mocks.call.getMockImplementation()!
 mocks.call.mockImplementation(async(op,p)=>{if(op==='transcript.views.read')throw Object.assign(new Error('来源已撤权'),{body:{code:'transcript-source-unavailable',httpStatus:403}});return normal(op,p)})
 await act(async()=>{window.dispatchEvent(new Event('focus'))})
 expect(host.textContent).not.toContain('私人词')
 expect(host.querySelector('[data-arkme-text-selection]')?.textContent).toBe(original)
})

it('clears private projections when direct restore observes source revocation', async () => {
 stored.set('recording:123:one',{revision:1,original,text:'已确认私人正文',marks:[]})
 await act(async () => root.render(<Fixture />)); expect(host.textContent).toContain('已确认私人正文')
 const normal = mocks.call.getMockImplementation()!
 mocks.call.mockImplementation(async (op, p) => {
  if (op === 'transcript.views.change') throw Object.assign(new Error('来源已撤权'), { body: { code: 'transcript-source-unavailable', httpStatus: 403 } })
  return normal(op, p)
 })
 await click('个人更正 · 恢复原文')
 expect(host.textContent).not.toContain('已确认私人正文')
 expect(host.querySelector('[data-arkme-text-selection]')?.textContent).toBe(original)
})

it.each(['none','second'] as const)('keeps raw transcript actions without private mark authority (%s)',async privateRows=>{
 await act(async()=>root.render(<Fixture privateRows={privateRows}/>));await select()
 const buttons=[...document.querySelectorAll('[aria-label="选中文字操作"] button')].map(b=>b.textContent)
 expect(buttons).toContain('复制');expect(buttons).toContain('查找')
 expect(buttons).not.toContain('标记');expect(buttons).not.toContain('替换')
 await click('复制');expect(mocks.copy).toHaveBeenCalledWith('重复词')
 expect(mocks.call.mock.calls.filter(([op,p])=>op==='transcript.views.read'&&p.items.some((item:any)=>item.id==='one'))).toEqual([])
 expect(mocks.call.mock.calls.filter(([op])=>op==='transcript.views.change')).toEqual([])
 if(privateRows==='none')expect(mocks.call).not.toHaveBeenCalled()
 else {await select(0,2,1);expect([...document.querySelectorAll('[aria-label="选中文字操作"] button')].map(b=>b.textContent)).toContain('标记');await click('标记');expect(mocks.call.mock.calls.filter(([op])=>op==='transcript.views.change')).toHaveLength(1)}
})

it('retains the original reading and menu surfaces for ordinary recording rows', async () => {
 await act(async () => root.render(<Fixture />))
 expect(host.querySelectorAll('article button')).toHaveLength(0)
 expect(host.textContent).not.toMatch(/历史更正|我的修改/)
 await openContext()
 expect([...document.querySelectorAll('[role="menuitem"]')].map(button => button.textContent)).toEqual(['复制', '多选', '播放'])
 expect(mocks.call.mock.calls.some(([operation]) => operation === 'transcript.views.saved')).toBe(false)
})

it.each(['corrected', 'restored'] as const)('can reset a private view after the source version changes (%s)', async state => {
 const previousOriginal = '之前的原文'
 stored.set('recording:123:one', { revision: 2, original: previousOriginal, text: state === 'corrected' ? '保留的更正' : previousOriginal, marks: [] })
 await act(async () => root.render(<Fixture text="更新后的原文" />))
 expect(host.querySelector('[data-arkme-text-selection]')?.textContent).toBe('更新后的原文')
 await click('原文已更新 · 恢复原文')
 expect(stored.get('recording:123:one')).toMatchObject({ original: '更新后的原文', text: '更新后的原文' })
 expect(host.querySelectorAll('article button')).toHaveLength(0)
})

it('announces the same current private wording that the call bubble displays, then follows restoration', async () => {
 const raw='识别原文', privateText='个人更正后的通话文字'
 const detail:ArkmeCallDetail={stableId:'room-one',callRef:'call-ref',title:'通话详情',mediaType:'audio',startedAtMillis:1000,acceptedAtMillis:1000,endedAtMillis:5000,durationSeconds:4,callResult:'NormalEnd',resultLabel:'已接通',summaryStatus:'done',summaryText:'摘要',transcriptPending:false,transcriptFailed:false,participants:[],transcriptSegments:[{segmentId:'one',speakerDisplayName:'同事',text:raw,startMillis:0,endMillis:1000,audioUrl:'https://example.invalid/audio.wav',privateViewTarget:{kind:'call',source_uid:'room-one',segment_uid:'one'},privateViewVersion:'v1'}]}
 let current:PersonalTranscriptEntry={revision:1,original:raw,text:privateText,originalVersion:'v1',originalDigest:'a'.repeat(64),originalChanged:false,marks:[]}
 const normal=mocks.call.getMockImplementation()!
 mocks.call.mockImplementation(async(op,p)=>{
  if(op==='transcript.views.read')return Object.fromEntries(p.items.map((item:any)=>[item.id,current]))
  if(op==='transcript.views.change'){current={...current,revision:2,text:raw};return current}
  return normal(op,p)
 })
 await act(async()=>root.render(<ArkmeCallDetailContent selectedItem={{callRef:'call-ref',peerDisplayName:'同事',mediaType:'audio',acceptedAtMillis:1000,durationSeconds:4,summaryPreview:''}} detail={detail} detailState="ready"/>))
 const bubble=host.querySelector('[data-arkme-call-utterance="one"] [role="button"]')!
 expect(bubble.querySelector('[data-arkme-text-selection]')?.textContent).toBe(privateText)
 expect(bubble.getAttribute('aria-label')).toContain(privateText)
 expect(bubble.getAttribute('aria-label')).not.toContain(raw)
 await click('个人更正 · 恢复原文')
 expect(bubble.querySelector('[data-arkme-text-selection]')?.textContent).toBe(raw)
 expect(bubble.getAttribute('aria-label')).toContain(raw)
 expect(detail.transcriptSegments[0]!.text).toBe(raw)
})
