// @vitest-environment jsdom
import { act } from 'react'
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
const selectMessage = vi.fn(), toggleMessage = vi.fn(), detail = vi.fn(), edit = vi.fn(), remove = vi.fn(), mark = vi.fn(async () => undefined), error = vi.fn()
const toolbar = () => document.querySelector('[role="toolbar"]')
const labels = (node: Element | null) => [...node?.querySelectorAll('button') ?? []].map(b => b.textContent)
function Fixture({ msg = message, includeToolbar = true, selecting = false }: { msg?: TeamMessage; includeToolbar?: boolean; selecting?: boolean }) {
  return <>{includeToolbar && <ArkmeMessageTextSelectionToolbar replySourceRef="team-conversation" onUnderline={mark} markStorage="local" />}
    <div data-arkme-message-selection-scope><TeamConversationMessage message={msg} conversationRef="team-conversation" avatar={<span />}
      selecting={selecting} selected={selecting} onSelect={selectMessage} onToggle={toggleMessage} onDetail={detail} writable showReceipts receiptStore={{subscribe:()=>()=>{},get:()=>emptyTeamReceipt,watch:()=>()=>{}} as unknown as TeamReceiptStore} busy={false} onEdit={edit} onReceipts={() => {}} onError={error} /></div></>
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
  expect(labels(toolbar())).toEqual(['复制', '全选', '标记'])
  expect(toolbar()?.textContent).toContain('仅本机')
  await mouse(p, 'contextmenu', 2)
  expect(document.querySelector('[role="menu"]')).toBeNull()
  await act(async () => toolbar()!.querySelector('button')!.click())
  expect(copyText).toHaveBeenCalledWith('选中的文字')
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
  expect(labels(document.querySelector('[role="menu"]'))).toEqual(['表态', '复制', '复制链接', '延展', '多选', '转发', '问 DSH', '举报', '消息详情', '查看阅读状态'])
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find(button => button.textContent === '复制')!.click())
  expect(copyText).toHaveBeenCalledWith(message.content!.text_content)
  await render({ ...message, own: true, canEdit: true, canDelete: true })
  await mouse(host.querySelector('p')!, 'contextmenu', 2)
  expect(labels(document.querySelector('[role="menu"]'))).toEqual(['表态', '复制', '复制链接', '延展', '重新编辑', '多选', '转发', '问 DSH', '消息详情', '查看阅读状态', '撤回'])
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

it('enters multiselect from the shared menu and keeps unsupported Team operations disabled', async () => {
  await render(); await mouse(host.querySelector('p')!, 'contextmenu', 2)
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')]
  expect(buttons.filter(button => !button.disabled).map(button => button.textContent)).toEqual(['复制', '多选', '消息详情', '查看阅读状态'])
  expect(buttons.find(button => button.textContent === '转发')?.querySelector('span')?.title).toBe('团队通道暂未支持此操作')
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
