// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TeamConversationMessage } from '../src/client/TeamConversationMessage.js'
import { ArkmeMessageTextSelectionToolbar } from '../src/client/ArkmeMessageTextSelection.js'
import { copyText } from '../src/client/clipboard-text.js'
import type { TeamMessage } from '../src/team-app-contract.js'
import { emptyTeamReceipt, type TeamReceiptStore } from '../src/client/team-read-receipts.js'
vi.mock('../src/client/clipboard-text.js', () => ({ copyText: vi.fn(async () => {}) }))
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: vi.fn(async () => ({})) }))
vi.mock('../src/client/TeamReadReceipts.js', () => ({ TeamReceiptBadge: () => null }))
vi.mock('../src/client/ArkmeDshMenu.js', () => ({ ArkmeActionMenu: ({ label, actions }: any) => <div role="menu" aria-label={label}>{actions.filter(Boolean).filter((a: any) => !a.type).map((a: any) => <button key={a.id} disabled={a.disabled} onClick={a.onSelect}>{a.label}</button>)}</div> }))
const message: TeamMessage = { ref: 'team-message-ref', key: 'm1', seq: 1, revision: 1, side: 'external', sender: { nickname: '用户' }, own: false,
  state: 'published', createdAt: 1, canEdit: false, canDelete: false, version: 1, contentStatus: 'available', media: [],
  localMarkRef: 'team-mark-ref', content: { text_content: '前缀选中的文字后缀', template_kind: 1 } }
let root: Root, host: HTMLDivElement
const recall = vi.fn(), selectMessage = vi.fn(), toggleMessage = vi.fn(), detail = vi.fn(), snapshot = vi.fn(), edit = vi.fn(), remove = vi.fn(), mark = vi.fn(async () => undefined), error = vi.fn()
const toolbar = () => document.querySelector('[role="toolbar"]')
const labels = (node: Element | null) => [...node?.querySelectorAll('button') ?? []].map(b => b.textContent)
function Fixture({ msg = message, includeToolbar = true, selecting = false, scopeControl, cloud = false, onReply }: { msg?: TeamMessage; includeToolbar?: boolean; selecting?: boolean; scopeControl?: ReactNode; cloud?: boolean; onReply?: (target: any, quote: any) => void }) {
  return <>{includeToolbar && <ArkmeMessageTextSelectionToolbar replySourceRef="team-conversation" onReply={onReply} onUnderline={mark} markStorage={cloud?'cloud':'local'} markScopeControl={scopeControl} />}
    <div data-arkme-message-selection-scope><TeamConversationMessage message={msg} conversationRef="team-conversation" avatar={<span />}
      selecting={selecting} selected={selecting} onSelect={selectMessage} onToggle={toggleMessage} onDetail={detail} onSnapshot={snapshot} writable showReceipts receiptStore={{subscribe:()=>()=>{},get:()=>emptyTeamReceipt,watch:()=>()=>{}} as unknown as TeamReceiptStore} busy={false} onRecall={recall} onEdit={edit} onReceipts={() => {}} onError={error} /></div></>
}
async function render(msg = message, includeToolbar = true) { await act(async () => root.render(<Fixture msg={msg} includeToolbar={includeToolbar} />)) }
async function mouse(element: Element, type: string, button = 0) { await act(async () => { element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button })) }) }
async function waitForMark(check: () => void) {
  // Event handlers await WebCrypto outside React's act queue. Observe completion,
  // rather than assuming a click has already finished hashing the selected text.
  await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }); check() })
}
async function select() {
  const p = host.querySelector('[data-arkme-text-selection] p')!, node = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode()!
  await mouse(p, 'mousedown')
  const range = document.createRange(); range.setStart(node, 2); range.setEnd(node, 7)
  document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range)
  await mouse(p, 'mouseup'); return p
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  Range.prototype.getBoundingClientRect = () => new DOMRect(50, 100, 180, 20)
  Range.prototype.getClientRects = () => [new DOMRect(50, 100, 180, 20)] as unknown as DOMRectList
  vi.clearAllMocks()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.getSelection()?.removeAllRanges(); vi.unstubAllGlobals() })
it('uses the same automatic toolbar for Team text and copies only the selected substring', async () => {
  await render(); const p = await select()
  expect(labels(toolbar())).toEqual(['复制', '全选', '标记', '查找'])
  expect(toolbar()?.textContent).toContain('仅本机')
  await mouse(p, 'contextmenu', 2)
  expect(document.querySelector('[role="menu"]')).toBeNull()
  await act(async () => toolbar()!.querySelector('button')!.click())
  expect(copyText).toHaveBeenCalledWith('选中的文字')
})
it.each([
  ['external', false, '外部用户'], ['team', false, '同事'], ['team', true, '自己'],
] as const)('keeps the original time inside the bubble for %s own=%s', async (side, own, nickname) => {
  const at = new Date('2026-10-19T16:12:34+08:00').getTime()
  await render({ ...message, side, own, sender: { nickname }, createdAt: at })
  const bubble = host.querySelector<HTMLElement>('.arkme-timed-bubble')!
  const time = bubble.querySelector<HTMLTimeElement>(':scope > .arkme-message-timestamp')!
  expect(time?.dateTime).toBe('2026-10-19T08:12:34.000Z')
  expect(host.querySelectorAll('time')).toHaveLength(1)
  expect(bubble.lastElementChild).toBe(time)
  expect(bubble.querySelector('[data-arkme-text-selection]')?.contains(time)).toBe(false)
  expect(bubble.style.background).toContain(own ? '--arkme-chat-self-bubble' : '--arkme-chat-other-bubble')
  const body = bubble.closest('article')!
  expect(body.querySelector('strong')?.textContent).toBe(own ? undefined : nickname)
  // Own messages have no empty sender/time header consuming another row.
  if (own) expect(body.querySelector('strong')).toBeNull()
  await render({ ...message, side, own, sender: { nickname }, createdAt: at, version: 2, content: { text_content: '编辑后的内容', template_kind: 1 } })
  expect(host.querySelector<HTMLTimeElement>('.arkme-message-timestamp')?.dateTime).toBe(time.dateTime)
})
it('selects just the message body and passes explicit Team mark authority without Chat authority', async () => {
  await render(); await select()
  await act(async () => (toolbar()!.querySelectorAll('button')[1] as HTMLButtonElement).click())
  expect(document.getSelection()!.toString()).toBe(message.content!.text_content)
  await act(async () => (toolbar()!.querySelectorAll('button')[2] as HTMLButtonElement).click())
  await waitForMark(() => expect(mark).toHaveBeenCalledWith(expect.objectContaining({ localMarkRef: 'team-mark-ref', sourceRef: 'team-conversation' }), expect.objectContaining({ text: message.content!.text_content, recordVersion: 1 })))
  expect((mark.mock.calls[0] as any)?.[0].item.messageActionRef).toBeUndefined()
  expect(toolbar()).toBeNull()
})
it('keeps selection through equivalent background grants, dismisses it for changed content', async () => {
  await render(); await select()
  await render({ ...message, ref: 'rotated', localMarkRef: 'rotated-mark', revision: 2 })
  expect(labels(toolbar())).toContain('复制')
  await render({ ...message, version: 2, content: { text_content: '已修改', template_kind: 1 } })
  expect(toolbar()).toBeNull()
})
it('can mark after an equivalent parent refresh replaces presentation objects', async () => {
  await render(); await select()
  await render({ ...message, ref: 'rotated', localMarkRef: 'rotated-mark', revision: 2 })
  await act(async () => (toolbar()!.querySelectorAll('button')[2] as HTMLButtonElement).click())
  await waitForMark(() => expect(mark).toHaveBeenCalledTimes(1))
})
it('shares the fallback context menu and retains the captured selection after focus loss', async () => {
  await render(message, false); const p = await select(); await mouse(p, 'contextmenu', 2)
  const menu = document.querySelector('[role="menu"]')!
  expect(labels(menu)).toEqual(['复制选中文字', '复制整条消息'])
  document.getSelection()!.removeAllRanges()
  await act(async () => menu.querySelector('button')!.click())
  expect(copyText).toHaveBeenCalledWith('选中的文字')
  expect(edit).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled()
})
it('keeps whole-message commands permission gated and clears the menu after deletion', async () => {
  await render(); const p = host.querySelector('p')!
  await mouse(p, 'contextmenu', 2)
  expect(labels(document.querySelector('[role="menu"]'))).toEqual(['表态', '复制', '复制链接', '延展', '多选', '转发', '问 DSH', '举报', '查看阅读状态'])
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find(button => button.textContent === '复制')!.click())
  expect(copyText).toHaveBeenCalledWith(message.content!.text_content)
  await render({ ...message, own: true, canRecall:true, canEdit: true, canDelete: true })
  await mouse(host.querySelector('p')!, 'contextmenu', 2)
  expect(labels(document.querySelector('[role="menu"]'))).toEqual(['表态', '复制', '复制链接', '延展', '重新编辑', '多选', '转发', '问 DSH', '查看阅读状态', '撤回', '详情'])
  await render({ ...message, contentStatus: 'deleted' })
  expect(document.querySelector('[role="menu"]')).toBeNull()
})
it('dismisses on Escape and does not register deleted or pending messages for marking', async () => {
  await render(); await select()
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(toolbar()).toBeNull()
  await render({ ...message, state: 'sending' }); await select()
  expect(labels(toolbar())).toEqual(['复制', '全选'])
  await render({ ...message, contentStatus: 'deleted' })
  expect(host.querySelector('[data-arkme-text-selection]')).toBeNull()
})

it('enters multiselect and gates commands that need an injected owner', async () => {
  await render(); await mouse(host.querySelector('p')!, 'contextmenu', 2)
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')]
  expect(buttons.filter(button => !button.disabled).map(button => button.textContent)).toEqual(['复制', '多选', '举报', '查看阅读状态'])
  expect(buttons.find(button => button.textContent === '转发')?.disabled).toBe(true)
  await act(async () => buttons.find(button => button.textContent === '多选')!.click())
  expect(selectMessage).toHaveBeenCalledOnce()
  expect(document.querySelector('[role="menu"]')).toBeNull()
})
it('toggles only once when clicking a selection checkbox or message and does not open details', async () => {
  await act(async () => root.render(<Fixture selecting includeToolbar={false} />))
  const checkbox = host.querySelector<HTMLButtonElement>('[role="checkbox"]')!
  expect(checkbox.getAttribute('aria-checked')).toBe('true')
  await mouse(checkbox, 'click')
  expect(toggleMessage).toHaveBeenCalledTimes(1)
  await mouse(host.querySelector('p')!, 'click')
  expect(toggleMessage).toHaveBeenCalledTimes(2)
  expect(detail).not.toHaveBeenCalled()
})
it('clicks into details but never opens details when selecting prose', async () => {
  await render(); await mouse(host.querySelector('p')!, 'click')
  expect(detail).toHaveBeenCalledOnce(); detail.mockClear()
  const p = await select(); await mouse(p, 'click')
  expect(detail).not.toHaveBeenCalled()
})

it('offers mark audience only inside the established selection toolbar and preserves the selection while switching', async () => {
  function ScopedFixture() {
    const [shared,setShared] = useState(false)
    return <Fixture msg={message} cloud={shared} scopeControl={<div role="group" aria-label="标记范围"><button type="button" aria-pressed={shared} onClick={()=>setShared(true)}>团队内部</button></div>} />
  }
  await act(async()=>root.render(<ScopedFixture/>))
  expect(document.querySelector('[aria-label="标记范围"]')).toBeNull()
  await select()
  const audience=toolbar()!.querySelector<HTMLButtonElement>('[aria-label="标记范围"] button')!
  await mouse(audience,'mousedown');await act(async()=>audience.click())
  expect(document.getSelection()!.toString()).toBe('选中的文字')
  expect(toolbar()!.querySelector('[aria-label="标记范围"] button')?.getAttribute('aria-pressed')).toBe('true')
  const markButton=[...toolbar()!.querySelectorAll('button')].find(button=>button.textContent==='标记')!
  await act(async()=>markButton.click())
  await waitForMark(()=>expect(mark).toHaveBeenCalledWith(expect.objectContaining({cloudMarkRef:message.ref}),expect.objectContaining({text:'选中的文字'})))
})
it('routes own right-click details to the snapshot while body click stays in reading details', async () => {
  await render({ ...message, own: true })
  await mouse(host.querySelector('p')!, 'click')
  expect(detail).toHaveBeenCalledOnce(); expect(snapshot).not.toHaveBeenCalled()
  await mouse(host.querySelector('p')!, 'contextmenu', 2)
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find(button => button.textContent === '详情')!.click())
  expect(snapshot).toHaveBeenCalledOnce(); expect(detail).toHaveBeenCalledOnce()
})

it('enables actual extension and DSH callbacks, closes the menu and keeps backend gaps disabled', async () => {
  const extend = vi.fn(), ask = vi.fn()
  await act(async () => root.render(<TeamConversationMessage message={message} avatar={null} writable showReceipts={false}
    receiptStore={{subscribe:()=>()=>{},get:()=>emptyTeamReceipt,watch:()=>()=>{}} as unknown as TeamReceiptStore} busy={false} onEdit={edit} onReceipts={() => {}} onError={error}
    onReply={extend} onAsk={ask} />))
  for (const label of ['延展', '问 DSH']) {
    await mouse(host.querySelector('p')!, 'contextmenu', 2)
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')]
    expect(buttons.find(button => button.textContent === label)?.disabled).toBe(false)
    expect(buttons.find(button => button.textContent === '表态')?.disabled).toBe(true)
    await act(async () => buttons.find(button => button.textContent === label)!.click())
    expect(document.querySelector('[role="menu"]')).toBeNull()
  }
  expect(extend).toHaveBeenCalledOnce(); expect(ask).toHaveBeenCalledOnce()
})

it('keeps selected-text reply available for Team without borrowing an ordinary Chat action reference',async()=>{
 const reply=vi.fn()
 await act(async()=>root.render(<Fixture onReply={reply}/>))
 await select()
 expect(labels(toolbar())).toContain('回复')
 await act(async()=>[...toolbar()!.querySelectorAll('button')].find(button=>button.textContent==='回复')!.click())
 await waitForMark(()=>expect(reply).toHaveBeenCalledWith(expect.objectContaining({sourceRef:'team-conversation',cloudMarkRef:message.ref}),expect.objectContaining({text:'选中的文字',start:2,end:7,recordVersion:1})))
 expect(reply.mock.calls[0]![0].item.messageActionRef).toBeUndefined()
})

it('recalls by server capability even without readable body, and renders terminal placeholders',async()=>{
 await render({...message,own:true,canRecall:true,contentStatus:'unavailable',content:undefined})
 await mouse(host.querySelector('p')!,'contextmenu',2)
 expect(labels(document.querySelector('[role="menu"]'))).toEqual(['撤回'])
 await act(async()=>{(document.querySelector('[role="menu"] button') as HTMLButtonElement).click()})
 expect(recall).toHaveBeenCalledOnce()
 await render({...message,own:true,state:'recalled',canRecall:false,contentStatus:'recalled',media:[]})
 expect(host.textContent).toContain('你撤回了一条消息')
 expect(host.textContent).not.toContain(message.content!.text_content)
})
