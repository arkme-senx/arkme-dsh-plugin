// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodexMessageBody, TeamCodexConversation, codexReadingKey, mergeCodexEvents, newCodexReadingState } from '../src/client/redesign/contacts/TeamCodexConversation.js'
import type { TeamCodexEvent, TeamCodexTask } from '../src/team-codex-contract.js'
import { browserContext, wrappedCodexPrompt } from './fixtures/codex-prompt.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn(), writeText: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme }))
const task: TeamCodexTask = { id:'task-a', title:'任务 A', state:'finished', status:'active', eventCount:2, updatedAt:1,
  member:{ userRef:'user-a', displayName:'用户 A', role:'member', identityState:'ready', joinedAtMillis:1 } }
const event = (sequence:number, text=`内容 ${sequence}`, kind:TeamCodexEvent['kind']='Stop'):TeamCodexEvent => ({ sequence,text,kind,turnId:`turn-${sequence}`,at:sequence*1000,truncated:false })

describe('Codex conversation reader', () => {
  let host:HTMLDivElement, root:Root
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
    vi.stubGlobal('navigator',{clipboard:{writeText:mocks.writeText}})
    mocks.callArkme.mockReset(); mocks.writeText.mockReset(); mocks.writeText.mockResolvedValue(undefined)
    mocks.callArkme.mockResolvedValue({items:[event(1,'需求','UserPromptSubmit'),event(2,'回答')]})
    host=document.createElement('div');document.body.append(host);root=createRoot(host)
  })
  afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals()})
  const render=async(current=task,reading=newCodexReadingState())=>{await act(async()=>root.render(<TeamCodexConversation key={current.id} teamRef="team-a" task={current} reading={reading} inputName="用户 A"/>));return reading}
  const click=async(label:string)=>{const button=[...host.querySelectorAll('button')].find(b=>b.textContent===label||b.getAttribute('aria-label')===label);expect(button).toBeTruthy();await act(async()=>button!.click())}
  const scroll=(height=1400)=>{
    const el=host.querySelector<HTMLDivElement>('.arkme-codex-transcript')!
    Object.defineProperties(el,{scrollHeight:{configurable:true,get:()=>height},clientHeight:{configurable:true,value:400}})
    return el
  }
  it('renders local public progress without converting it into a final answer, and refreshes on foreground/online events',async()=>{
    const input={...event(1,'需求','UserPromptSubmit'),localProgress:[{id:'p1',text:'已定位问题',at:1100,truncated:false}]}
    mocks.callArkme.mockResolvedValue({items:[input]})
    const reading=await render({...task,state:'working'})
    expect(host.querySelector('[aria-label="Codex 进度"]')?.textContent).toContain('已定位问题')
    expect(host.textContent).toContain('过程回复 · 仅本机')
    expect(host.querySelector('[aria-label="Codex 回答"]')).toBeNull()
    expect(reading.items).toHaveLength(1)
    mocks.callArkme.mockClear()
    await act(async()=>window.dispatchEvent(new Event('focus')))
    expect(mocks.callArkme).toHaveBeenCalledTimes(1)
    await act(async()=>window.dispatchEvent(new Event('online')))
    expect(mocks.callArkme).toHaveBeenCalledTimes(2)
  })
  it('places a recovered earlier final before the next prompt despite its later insertion sequence',()=>{
    const recovered={...event(3,'补回的回答'),at:1500,turnId:'turn-1'}
    expect(mergeCodexEvents([event(1),event(2)],[recovered]).map(e=>e.sequence)).toEqual([1,3,2])
  })
  it('renders readable Markdown, code copying and safe external links without loading images or HTML',async()=>{
    const markdown='# 标题\n\n**重点**\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst answer = 42;\n```\n\n[网站](https://example.com) [本机](/private/file) [恶意](javascript:alert)\n\n![截图](https://example.com/tracker.png)\n\n<script>alert(1)</script>\n\n- [x] 完成'
    await act(async()=>root.render(<CodexMessageBody text={markdown}/>))
    expect(host.querySelector('h1')?.textContent).toBe('标题')
    expect(host.querySelector('strong')?.textContent).toBe('重点')
    expect(host.querySelectorAll('table')).toHaveLength(1)
    expect(host.querySelectorAll('a')).toHaveLength(1)
    expect(host.querySelector('a')?.rel).toBe('noopener noreferrer')
    expect(host.querySelectorAll('img,script')).toHaveLength(0)
    expect(host.textContent).toContain('图片仅本人可见')
    expect(host.querySelector('input')?.disabled).toBe(true)
    await click('复制代码')
    expect(mocks.writeText).toHaveBeenCalledWith('const answer = 42;')
    expect(host.textContent).toContain('已复制')
  })
  it('contains a single transcript scrollport and distinct user/assistant rows',async()=>{
    await render()
    expect(host.querySelectorAll('.arkme-codex-transcript')).toHaveLength(1)
    expect(host.querySelector('.is-user')?.textContent).toContain('需求')
    expect(host.querySelector('.is-assistant')?.textContent).toContain('回答')
    expect(host.querySelectorAll('.arkme-team-codex-text')).toHaveLength(0)
    await click('复制回答');expect(mocks.writeText).toHaveBeenCalledWith('回答')
  })
  it('places duration above its own answer without putting timing into copied message text',async()=>{
    const start=Date.now()-150000
    mocks.callArkme.mockResolvedValue({items:[event(1,'提问','UserPromptSubmit'),{...event(2,'真实回答'),timing:{state:'finished',startedAt:start,completedAt:start+128000,durationMs:128012,observedAt:start+128000}}]})
    await render()
    const label=host.querySelector('.arkme-codex-turn-duration')!
    expect(label.textContent).toContain('用时 2分钟 8秒')
    expect(label.nextElementSibling?.classList.contains('is-assistant')).toBe(true)
    await click('复制回答');expect(mocks.writeText).toHaveBeenLastCalledWith('真实回答')
  })
  it('cleans cached and refreshed questions for both display and copy without rewriting history',async()=>{
    const raw=wrappedCodexPrompt('24mm 和 26mm，统一起来对比。')
    const reading={...newCodexReadingState(),loaded:true,items:[event(1,raw,'UserPromptSubmit')]}
    let complete!:(value:unknown)=>void
    mocks.callArkme.mockImplementation(()=>new Promise(resolve=>{complete=resolve}))
    await render(task,reading)
    expect(host.querySelector('.arkme-codex-user-text')?.textContent).toBe('24mm 和 26mm，统一起来对比。')
    expect(host.textContent).not.toContain('ambient-ui-state')
    await click('复制输入');expect(mocks.writeText).toHaveBeenLastCalledWith('24mm 和 26mm，统一起来对比。')
    expect(reading.items[0]?.text).toBe(raw)
    await act(async()=>complete({items:reading.items}))
    mocks.callArkme.mockResolvedValue({items:[event(1,wrappedCodexPrompt('新的正文'),'UserPromptSubmit')]})
    await render({...task,updatedAt:2},reading)
    expect(host.querySelector('.arkme-codex-user-text')?.textContent).toBe('新的正文')
    await click('复制输入');expect(mocks.writeText).toHaveBeenLastCalledWith('新的正文')
  })
  it('uses cleaned current-request text and an honest empty state',async()=>{
    mocks.callArkme.mockResolvedValue({items:[]})
    await render({...task,state:'working',currentInput:{turnId:'pending',text:wrappedCodexPrompt('待处理的实际问题'),at:1}})
    expect(host.querySelector('.arkme-codex-user-text')?.textContent).toBe('待处理的实际问题')
    mocks.callArkme.mockResolvedValue({items:[event(1,browserContext,'UserPromptSubmit')]})
    await render({...task,updatedAt:2})
    expect(host.querySelector('.is-user')?.textContent).toContain('无文本输入')
    expect(host.querySelector('[aria-label="复制输入"]')).toBeNull()
  })
  it('never cleans the assistant response and preserves an explicitly quoted example in the question',async()=>{
    const quoted=`\`\`\`text\n${wrappedCodexPrompt('示例')}\n\`\`\``
    const answer=wrappedCodexPrompt('回答里的示例')
    mocks.callArkme.mockResolvedValue({items:[event(1,wrappedCodexPrompt(quoted),'UserPromptSubmit'),event(2,answer)]})
    await render()
    expect(host.querySelector('.arkme-codex-user-text')?.textContent).toBe(quoted)
    await click('复制输入');expect(mocks.writeText).toHaveBeenLastCalledWith(quoted)
    await click('复制回答');expect(mocks.writeText).toHaveBeenLastCalledWith(answer)
  })
  it('shows cached content immediately while revalidating and restores the reading position',async()=>{
    const reading=await render()
    const el=scroll();el.scrollTop=240
    await act(async()=>el.dispatchEvent(new Event('scroll')))
    expect(reading.scrollTop).toBe(240);expect(reading.atBottom).toBe(false)
    await act(async()=>root.render(<div/>))
    mocks.callArkme.mockImplementation(()=>new Promise(()=>{}))
    await render(task,reading)
    expect(host.textContent).toContain('需求');expect(host.textContent).toContain('回答')
    expect(host.querySelector('.arkme-codex-transcript')?.scrollTop).toBe(240)
  })
  it('keeps the scroll position on a new response until the reader chooses to jump',async()=>{
    vi.useFakeTimers()
    await render()
    const el=scroll();el.scrollTop=180
    await act(async()=>el.dispatchEvent(new Event('scroll')))
    mocks.callArkme.mockResolvedValue({items:[event(3,'新增回答')]})
    await act(async()=>vi.advanceTimersByTimeAsync(5000))
    expect(el.scrollTop).toBe(180);expect(host.textContent).toContain('有新内容 ↓')
    await click('有新内容 ↓');expect(el.scrollTop).toBe(1400)
  })
  it('follows new content when already at the bottom',async()=>{
    vi.useFakeTimers();await render()
    const el=scroll();el.scrollTop=1000
    await act(async()=>el.dispatchEvent(new Event('scroll')))
    mocks.callArkme.mockResolvedValue({items:[event(3)]})
    await act(async()=>vi.advanceTimersByTimeAsync(5000))
    expect(el.scrollTop).toBe(1400);expect(host.textContent).not.toContain('有新内容 ↓')
  })
  it('anchors reading when loading older messages and preserves the oldest cursor during refresh',async()=>{
    mocks.callArkme.mockResolvedValue({items:[event(5)],nextBefore:5})
    const reading=await render()
    const el=scroll();el.scrollTop=30
    Object.defineProperty(el,'scrollHeight',{configurable:true,get:()=>host.querySelectorAll('.arkme-codex-message').length * 1400})
    await act(async()=>el.dispatchEvent(new Event('scroll')))
    mocks.callArkme.mockResolvedValue({items:[event(1)],nextBefore:1})
    await click('加载更早记录')
    expect(mocks.callArkme).toHaveBeenLastCalledWith('team.codex.events',{teamRef:'team-a',id:'task-a',before:5},expect.any(AbortSignal))
    expect(reading.before).toBe(1)
    expect(el.scrollTop).toBe(1430)
    expect(host.textContent).toContain('内容 1');expect(host.textContent).toContain('内容 5')
    mocks.callArkme.mockResolvedValue({items:[event(6)],nextBefore:5})
    await render({...task,updatedAt:2},reading)
    expect(reading.before).toBe(1)
  })
  it('aborts stale task reads and does not leak a previous task response',async()=>{
    let resolve!:(value:unknown)=>void, signal:AbortSignal|undefined
    mocks.callArkme.mockImplementationOnce((_op,_params,s)=>{signal=s;return new Promise(r=>{resolve=r})})
    await render()
    mocks.callArkme.mockResolvedValue({items:[event(1,'任务 B 的回答')]})
    await render({...task,id:'task-b'})
    expect(signal?.aborted).toBe(true)
    await act(async()=>resolve({items:[event(2,'旧任务迟到内容')]}))
    expect(host.textContent).toContain('任务 B 的回答');expect(host.textContent).not.toContain('旧任务迟到内容')
  })
  it('clears cached remote data when permission revalidation fails',async()=>{
    vi.useFakeTimers()
    const remote={...task,cloud:{taskId:task.id,sourceId:'source',sourceName:'电脑',ownerRef:'user',remote:true}}
    const reading=await render(remote)
    expect(reading.items).toHaveLength(2)
    mocks.callArkme.mockRejectedValue(new Error('无权查看'))
    await act(async()=>vi.advanceTimersByTimeAsync(5000))
    expect(reading.items).toHaveLength(0);expect(host.textContent).not.toContain('需求');expect(host.textContent).toContain('无权查看')
  })
  it('does not duplicate the current request already present in history',async()=>{
    await render({...task,state:'working',currentInput:{turnId:'turn-1',text:'需求',at:1}})
    expect(host.querySelectorAll('.is-user')).toHaveLength(1)
    expect(host.textContent).toContain('等待同步本轮回答')
  })
  it('keeps account-team/source keys distinct and prevents event-version regression',()=>{
    expect(codexReadingKey('team-a',task)).not.toBe(codexReadingKey('team-b',task))
    expect(codexReadingKey('team-a',task)).not.toBe(codexReadingKey('team-a',{...task,cloud:{taskId:task.id,sourceId:'device',sourceName:'电脑',ownerRef:'user',remote:true}}))
    const current={...event(1,'新版本'),eventId:'event',version:2}
    expect(mergeCodexEvents([current],[{...current,text:'旧版本',version:1}])[0]?.text).toBe('新版本')
  })
})
