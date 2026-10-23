// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach,afterEach,it,expect,vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { CodexSelectableBody,useCodexMessageInteractions } from '../src/client/redesign/contacts/CodexMessageInteractions.js'
import { CodexMessageBody } from '../src/client/redesign/contacts/TeamCodexConversation.js'
import { callArkme } from '../src/client/api.js'
import { copyText } from '../src/client/clipboard-text.js'
import type { TeamCodexEvent,TeamCodexTask } from '../src/team-codex-contract.js'
vi.mock('../src/client/api.js',()=>({callArkme:vi.fn(async(op)=>op.endsWith('capabilities')?{supported:true,maxLength:2000,storage:'local'}:[])}))
vi.mock('../src/client/clipboard-text.js',()=>({copyText:vi.fn(async()=>{})}))
vi.mock('../src/client/ArkmeDshMenu.js',()=>({ArkmeActionMenu:({actions}:any)=><div role="menu">{actions.map((a:any)=><button key={a.id} onClick={a.onSelect}>{a.label}</button>)}</div>}))
const task={id:'task',title:'任务标题',member:{displayName:'同事'}} as TeamCodexTask
const event:TeamCodexEvent={sequence:1,text:'前缀**重要内容**后缀',at:1000,turnId:'turn',kind:'Stop',truncated:false}
let root:Root,host:HTMLDivElement
function Fixture({events=[event]}:{events?:TeamCodexEvent[]}){
 const actions=useCodexMessageInteractions({teamRef:'team',task,events,account:'prod:11',userId:11})
 return <div data-codex-source={actions.sourceRef}>{events.map(e=><article key={e.sequence} onContextMenu={ev=>actions.contextMenu(e,ev)}>{actions.check(e)}<CodexSelectableBody sourceRef={actions.sourceRef} event={e} inputName="同事"><CodexMessageBody text={e.text}/></CodexSelectableBody></article>)}<div data-bottom>{actions.dock}</div>{actions.feedback}{actions.host}</div>
}
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});host=document.createElement('div');document.body.append(host);root=createRoot(host);Range.prototype.getBoundingClientRect=()=>new DOMRect(50,100,180,20);Range.prototype.getClientRects=()=>[new DOMRect(50,100,180,20)] as unknown as DOMRectList})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();document.getSelection()?.removeAllRanges();vi.unstubAllGlobals();vi.clearAllMocks()})
const render=async(events=[event])=>act(async()=>root.render(<Fixture events={events}/>))
const click=async(label:string)=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent===label||e.getAttribute('aria-label')===label);expect(b).toBeTruthy();await act(async()=>b!.click())}
async function select(){const el=host.querySelector('strong')!;const range=document.createRange();range.selectNodeContents(el);document.getSelection()!.addRange(range);await act(async()=>el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})))}
it('opens a menu immediately and keeps selection/count/actions at the bottom across polling, but removes changed messages',async()=>{
 await render();await act(async()=>host.querySelector('article')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true})));await click('多选')
 expect(host.querySelector('[data-bottom]')?.textContent).toContain('已选 1 条');expect(host.querySelector('[data-bottom]')?.textContent).toContain('复制链接转发退出多选')
 await render([{...event},{...event,sequence:2,turnId:'new',text:'新回答'}]);expect(host.querySelector('[data-bottom]')?.textContent).toContain('已选 1 条')
 await click('复制文本');expect(copyText).toHaveBeenCalledWith(event.text)
 await render([{...event,text:'已更新'}]);expect(host.querySelector('[data-bottom]')?.textContent).toContain('已选 0 条')
 await click('退出多选');expect(host.querySelector('[data-bottom]')?.textContent).toBe('')
})
it('shows all five partial-selection actions and captures rendered Markdown quote without adding replacement',async()=>{
 await render();await select()
 const menu=document.querySelector('[data-arkme-text-selection-toolbar]')!
 expect([...menu.querySelectorAll('button')].map(b=>b.textContent)).toEqual(['复制','全选','标记','查找','发给自己'])
 await click('发给自己')
 // The quote's WebCrypto digest may finish after the click's React act scope.
 await vi.waitFor(async()=>{await act(async()=>{});expect(document.querySelector('[role="dialog"]')).not.toBeNull()})
 const dialog=document.querySelector('[role="dialog"]')!
 expect(dialog?.textContent).toContain('引用 · Codex · 任务标题');expect(dialog?.querySelector('blockquote')?.textContent).toBe('重要内容')
 expect(vi.mocked(callArkme).mock.calls.some(c=>c[0]==='source.send-text')).toBe(false)
 await click('取消');expect(document.querySelector('[role="dialog"]')).toBeNull()
})
it('selects all visible message prose and opens shared find without matching metadata',async()=>{
 await render();await select();await click('全选');expect(document.getSelection()?.toString()).toBe('前缀重要内容后缀')
 await click('查找');expect(document.querySelector('[role="search"]')?.textContent).toContain('仅查找当前已加载消息')
 expect(document.querySelector('[aria-label="查找关键词"]')?.getAttribute('value')).toBe('前缀重要内容后缀')
})
it('keeps code and table text nodes stable during unchanged polling so selection is not detached',async()=>{
 const codeEvent={...event,text:'```text\n可选代码\n```\n\n| 标题 |\n| --- |\n| 表格正文 |'}
 await render([codeEvent]);const code=host.querySelector('pre code')!,cell=host.querySelector('td')!
 const range=document.createRange();range.selectNodeContents(code);document.getSelection()!.addRange(range)
 await act(async()=>code.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})))
 await render([{...codeEvent}])
 expect(host.querySelector('pre code')).toBe(code);expect(host.querySelector('td')).toBe(cell)
 expect(document.getSelection()?.toString()).toContain('可选代码');expect(document.querySelector('[data-arkme-text-selection-toolbar]')).not.toBeNull()
})
