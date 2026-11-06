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
function Fixture({text=original,scope='recording:123',enabled=true,omitFirst=false,playable=true,savedSource=true,privateRows='all',emptyRows=false}:{text?:string;scope?:string;enabled?:boolean;omitFirst?:boolean;playable?:boolean;savedSource?:boolean;privateRows?:'all'|'none'|'second';emptyRows?:boolean}) {
 const rows=[{id:'one',text,speaker:'说话人一',at:1000,playable},{id:'two',text:'第二段',speaker:'说话人二',at:2000,playable:true}].map(row=>({...row,sourceVersion:createHash('sha256').update(row.text).digest('hex'),viewRef:privateRows==='none'||privateRows==='second'&&row.id==='one'?undefined:JSON.stringify({scope,id:row.id,text:row.text})})).filter(row=>!emptyRows&&(!omitFirst||row.id!=='one'))
 const actions=useTranscriptInteractions({scope,rows,enabled,onPlay:mocks.play,...(savedSource?{savedRef:JSON.stringify({kind:'recording',sessionRef:scope})}:{})})
 return <><ArkmeMessageTextSelectionToolbar replySourceRef="ordinary-chat" />{actions.host}
 {actions.sourceControls}{rows.map(row=><article key={row.id} onContextMenu={e=>actions.contextMenu(row,e)}>{actions.checkbox(row)}{actions.renderText(row)}</article>)}{actions.controls}</>
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
  if(op==='transcript.views.saved')return {historical:true,items:[],next_cursor:''}
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
it('replaces just the second occurrence, restores after remount, and can restore original',async()=>{
 await act(async()=>root.render(<Fixture/>));await select();await click('替换');await input('新词');await click('替换')
 expect(host.querySelector('[data-arkme-text-selection]')?.textContent).toBe('重复词，新词。')
 await act(async()=>root.unmount());root=createRoot(host);await act(async()=>root.render(<Fixture/>))
 expect(host.querySelector('[data-arkme-text-selection]')?.textContent).toBe('重复词，新词。')
 await click('已更正');await click('恢复原文');expect(host.querySelector('[data-arkme-text-selection]')?.textContent).toBe(original)
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
 expect(host.querySelectorAll('article button')).toHaveLength(0)
 await act(async()=>root.render(<Fixture scope="call:123"/>));expect(host.querySelector('[data-arkme-text-selection]')?.textContent).toBe(original)
})

it.each(['source-update', 'remote-restore'] as const)('retires a comparison that no longer describes the displayed row after %s', async reason => {
 stored.set('recording:123:one',{revision:1,original,text:'当前私人更正',marks:[]})
 await act(async()=>root.render(<Fixture/>));await click('已更正')
 expect(document.querySelector('[role="dialog"]')?.textContent).toContain('当前私人更正')
 if(reason==='source-update') {
  const normal=mocks.call.getMockImplementation()!
  mocks.call.mockImplementation((op,p)=>op==='transcript.views.read'?new Promise(()=>{}):normal(op,p))
  await act(async()=>root.render(<Fixture text="更新后的原文"/>))
 } else {
  stored.set('recording:123:one',{revision:2,original,text:original,marks:[]})
  await act(async()=>window.dispatchEvent(new Event('focus')))
 }
 expect(document.querySelector('[role="dialog"]')).toBeNull()
 if(reason==='remote-restore') {
  stored.set('recording:123:one',{revision:3,original,text:'稍后另一设备的新更正',marks:[]})
  await act(async()=>window.dispatchEvent(new Event('focus')))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
 }
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

it.each(['replacement', 'history', 'correction'] as const)('retires an open %s surface when background read observes source revocation', async surface => {
 if(surface==='correction')stored.set('recording:123:one',{revision:1,original,text:'对话框中的私人更正',marks:[]})
 await act(async()=>root.render(<Fixture/>))
 if(surface==='replacement') {await select();await click('替换');await input('未提交私人草稿')}
 else if(surface==='correction')await click('已更正')
 else {
  const normal=mocks.call.getMockImplementation()!
  mocks.call.mockImplementation(async(op,p)=>op==='transcript.views.saved'?{historical:true,items:[{kind:'recording',source_uid:'source',segment_uid:'old',original:'之前的原文',original_version:'v1',text:'历史私人正文',revision:1,marks:[]}],next_cursor:''}:normal(op,p))
  await click('我的修改');expect(document.body.textContent).toContain('历史私人正文')
 }
 const normal=mocks.call.getMockImplementation()!
 mocks.call.mockImplementation(async(op,p)=>{if(op==='transcript.views.read')throw Object.assign(new Error('来源已撤权'),{body:{code:'transcript-source-unavailable',httpStatus:403}});return normal(op,p)})
 await act(async()=>{document.getSelection()?.removeAllRanges();window.dispatchEvent(new Event('focus'))})
 expect(document.querySelector('textarea')).toBeNull()
 expect(document.querySelector('[role="dialog"]')).toBeNull()
 expect(document.body.textContent).not.toContain('对话框中的私人更正')
 expect(document.body.textContent).not.toContain('历史私人正文')
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

it.each(['change','saved'] as const)('clears private projections when %s observes source revocation before the next watch', async operation => {
 stored.set('recording:123:one',{revision:1,original,text:'已确认私人正文',marks:[]})
 await act(async()=>root.render(<Fixture/>));expect(host.textContent).toContain('已确认私人正文')
 const normal=mocks.call.getMockImplementation()!
 // Closing the modal restores focus and may refresh. Hold that later read so
 // only the operation's denial, before another authorization decision, can pass.
 mocks.call.mockImplementation(async(op,p)=>{if(op===`transcript.views.${operation}`)throw Object.assign(new Error('来源已撤权'),{body:{code:'transcript-source-unavailable',httpStatus:403}});if(op==='transcript.views.read')return new Promise(()=>{});return normal(op,p)})
 if(operation==='change'){await click('已更正');await click('恢复原文')}else await click('我的修改')
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

it('keeps ordinary prose free of per-row history and exposes one correctly scoped source control',async()=>{
 await act(async()=>root.render(<Fixture/>))
 expect([...document.querySelectorAll('button')].filter(b=>b.textContent==='历史更正')).toHaveLength(0)
 expect([...document.querySelectorAll('button')].filter(b=>b.textContent==='我的修改')).toHaveLength(1)
 expect(host.querySelectorAll('article button')).toHaveLength(0)
 await act(async()=>root.render(<Fixture savedSource={false}/>))
 expect([...document.querySelectorAll('button')].filter(b=>b.textContent==='我的修改')).toHaveLength(0)
})
it('shows only the chosen row correction rather than reading the entire source as its history',async()=>{
 stored.set('recording:123:one',{revision:1,original,text:'重复词，新词。',marks:[]})
 await act(async()=>root.render(<Fixture/>));await click('已更正')
 const dialog=document.querySelector('[role="dialog"]')!
 expect(dialog).not.toBeNull();expect(dialog.textContent).toContain('原文');expect(dialog.textContent).toContain('我的更正')
 expect(dialog.textContent).toContain('重复词，新词。');expect(dialog.textContent).toContain(original)
 expect(mocks.call.mock.calls.some(([op])=>op==='transcript.views.saved')).toBe(false)
 expect(mocks.play).not.toHaveBeenCalled()
 await click('恢复原文');expect(host.querySelector('[data-arkme-text-selection]')?.textContent).toBe(original)
 expect(document.querySelector('[role="dialog"]')).toBeNull()
})

it('keeps the explicit source recovery entry reachable when no current physical row remains',async()=>{
 const normal=mocks.call.getMockImplementation()!
 mocks.call.mockImplementation(async(op,p)=>op==='transcript.views.saved'?{historical:true,items:[{kind:'recording',source_uid:'source',segment_uid:'retired',original:'旧识别文本',original_version:'v1',text:'保留的个人更正',revision:1,marks:[]}],next_cursor:''}:normal(op,p))
 await act(async()=>root.render(<Fixture emptyRows/>));expect(host.querySelectorAll('article')).toHaveLength(0)
 await click('我的修改');expect(document.body.textContent).toContain('保留的个人更正')
 expect(mocks.call.mock.calls.find(([op])=>op==='transcript.views.saved')?.[1].ref).toBe(JSON.stringify({kind:'recording',sessionRef:'recording:123'}))
})

it.each(['corrected','restored'] as const)('does not label a source-version refresh as a live correction (%s)',async state=>{
 const previousOriginal='之前的原文',previousText=state==='corrected'?'保留的更正':'之前的原文'
 stored.set('recording:123:one',{revision:2,original:previousOriginal,text:previousText,marks:[]})
 const normal=mocks.call.getMockImplementation()!
 mocks.call.mockImplementation(async(op,p)=>op==='transcript.views.saved'?{historical:true,items:[{kind:'recording',source_uid:'source',segment_uid:'one',original:previousOriginal,original_version:'old',text:previousText,revision:2,marks:[]}],next_cursor:''}:normal(op,p))
 await act(async()=>root.render(<Fixture text="更新后的原文"/>))
 expect(host.querySelector('[data-arkme-text-selection]')?.textContent).toBe('更新后的原文')
 expect(host.querySelectorAll('article button')).toHaveLength(0)
 await click('我的修改')
 if(state==='corrected')expect(document.querySelector('[role="dialog"]')?.textContent).toContain('保留的更正')
 else expect(document.querySelector('[role="dialog"]')?.textContent).toContain('还没有更正或标记')
})


it.each(['row', 'source'] as const)('retires the %s modal on a scope or activation change without reopening it on return', async surface => {
 stored.set('recording:123:one',{revision:1,original,text:'私人更正',marks:[]})
 for (const reason of ['scope', 'inactive'] as const) {
  await act(async()=>root.render(<Fixture/>))
  await click(surface==='row'?'已更正':'我的修改')
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await act(async()=>root.render(<Fixture scope={reason==='scope'?'call:456':'recording:123'} enabled={reason!=='inactive'}/>))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async()=>root.render(<Fixture/>))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
 }
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
 await click('已更正');await click('恢复原文')
 expect(bubble.querySelector('[data-arkme-text-selection]')?.textContent).toBe(raw)
 expect(bubble.getAttribute('aria-label')).toContain(raw)
 expect(detail.transcriptSegments[0]!.text).toBe(raw)
})


it('keeps saved changes reachable for an ordinary recording through the chosen row menu without a first-row source fallback', async () => {
 const normal=mocks.call.getMockImplementation()!
 mocks.call.mockImplementation(async(op,p)=>op==='transcript.views.saved'?{historical:true,items:[],next_cursor:''}:normal(op,p))
 await act(async()=>root.render(<Fixture savedSource={false}/>))
 expect(host.querySelectorAll('article button')).toHaveLength(0)
 await act(async()=>host.querySelectorAll('article')[1]!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:50,clientY:50})))
 await click('这份录音的修改')
 expect(document.querySelector('[role="menu"]')).toBeNull()
 expect(document.querySelector('[role="dialog"]')).not.toBeNull()
 const request=mocks.call.mock.calls.find(([op])=>op==='transcript.views.saved')![1]
 expect(JSON.parse(request.ref)).toMatchObject({scope:'recording:123',id:'two'})
 expect(mocks.call.mock.calls.filter(([op])=>op==='transcript.views.change')).toHaveLength(0)
})
