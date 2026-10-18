// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { ArkmeMessageTextSelectionToolbar, ArkmeSelectableMessageText } from '../src/client/ArkmeMessageTextSelection.js'
import { copyText } from '../src/client/clipboard-text.js'
import { ArkmeMarkdownBody } from '../src/client/ArkmeMarkdownBody.js'
import { ArkmeMessageContent } from '../src/client/ArkmeRichContent.js'
import type { ArkmeTimelineItem } from '../src/types.js'
vi.mock('../src/client/clipboard-text.js', () => ({ copyText: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: vi.fn(async () => ({})) }))
let root: Root, host: HTMLDivElement
const menu = () => document.querySelector('[role="toolbar"]')
const buttons = () => Array.from(menu()?.querySelectorAll('button') ?? [])
const partial = '选中的文字'
function Fixture({ text = `前缀${partial}后缀`, detail = true }: { text?: string; detail?: boolean }) {
  return <><ArkmeMessageTextSelectionToolbar /><div data-arkme-message-selection-scope>
    <ArkmeSelectableMessageText text={text}><p id="one">{text}</p></ArkmeSelectableMessageText>
    <ArkmeSelectableMessageText text="第二条消息"><p id="two">第二条消息</p></ArkmeSelectableMessageText>
    <div contentEditable suppressContentEditableWarning id="editor">输入中的文字</div>
  </div>{detail && <aside data-arkme-note-detail><ArkmeSelectableMessageText text="**详情**正文"><ArkmeMarkdownBody text="**详情**正文" /></ArkmeSelectableMessageText></aside>}</>
}
async function render(node = <Fixture />) { await act(async () => root.render(node)) }
function select(node: Node, start: number, end: number, endNode = node) {
  const range = document.createRange(); range.setStart(node, start); range.setEnd(endNode, end)
  const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
}
async function mouse(node: Element, type: string, button = 0) {
  await act(async () => { node.dispatchEvent(new MouseEvent(type, { button, bubbles: true, cancelable: true })) })
}
async function open() {
  const p = host.querySelector('#one')!; await mouse(p, 'mousedown'); select(p.firstChild!, 2, 7); await mouse(p, 'mouseup')
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.mocked(copyText).mockReset().mockResolvedValue(undefined)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  Range.prototype.getBoundingClientRect = () => new DOMRect(50, 100, 180, 20)
  Range.prototype.getClientRects = () => [new DOMRect(50, 100, 180, 20)] as unknown as DOMRectList
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.getSelection()?.removeAllRanges(); vi.unstubAllGlobals() })
it('waits until mouse release, then copies the captured substring without whole-message actions', async () => {
  await render(); const p = host.querySelector('#one')!; await mouse(p, 'mousedown'); select(p.firstChild!, 2, 7)
  await act(async () => { document.dispatchEvent(new Event('selectionchange')) }); expect(menu()).toBeNull()
  await mouse(p, 'mouseup'); expect(buttons().map(button => button.textContent)).toEqual(['复制', '全选'])
  await mouse(buttons()[0]!, 'mousedown'); expect(document.getSelection()!.toString()).toBe(partial)
  await act(async () => buttons()[0]!.click()); expect(copyText).toHaveBeenCalledWith(partial); expect(menu()).toBeNull()
})
it('selects only the current message, keeps the toolbar, and waits for Copy', async () => {
  await render(); await open()
  const position = menu()!.getAttribute('style')
  await act(async () => buttons()[1]!.click())
  expect(document.getSelection()!.toString()).toBe(`前缀${partial}后缀`)
  expect(copyText).not.toHaveBeenCalled()
  await act(async () => document.dispatchEvent(new Event('selectionchange')))
  expect(buttons().map(button => button.textContent)).toEqual(['复制', '全选'])
  expect(menu()!.getAttribute('style')).toBe(position)
  await act(async () => buttons()[1]!.click())
  await act(async () => buttons()[0]!.click())
  expect(copyText).toHaveBeenCalledWith(`前缀${partial}后缀`)
  expect(menu()).toBeNull()
})
it('selects rendered Markdown prose without copying source syntax, stylesheet or attachment controls', async () => {
  await render(<><ArkmeMessageTextSelectionToolbar /><aside data-arkme-note-detail>
    <ArkmeSelectableMessageText text="**详情**正文">
      <ArkmeMarkdownBody text="**详情**正文" />
      <button>展开</button><button>附件.pdf</button>
    </ArkmeSelectableMessageText>
  </aside></>)
  const bold = host.querySelector('strong')!
  select(document.createTreeWalker(bold, NodeFilter.SHOW_TEXT).nextNode()!, 0, 1)
  await mouse(bold, 'mouseup')
  await act(async () => buttons()[1]!.click())
  expect(document.getSelection()!.toString()).toBe('详情正文')
  expect(copyText).not.toHaveBeenCalled()
  await act(async () => buttons()[0]!.click())
  expect(copyText).toHaveBeenCalledWith('详情正文')
})
it('selects the full text of a collapsed message without including its expand button', async () => {
  const text = '这是完整正文。'.repeat(80)
  const item = { itemUid: 'long', title: '', textContent: text, textFormat: 'plain', status: 1 } as ArkmeTimelineItem
  await render(<><ArkmeMessageTextSelectionToolbar /><ArkmeMessageContent item={item} /></>)
  const p = host.querySelector('[data-arkme-text-selection] p')!
  select(document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode()!, 0, 2)
  await mouse(p, 'mouseup')
  await act(async () => buttons()[1]!.click())
  expect(document.getSelection()!.toString()).toBe(text)
  expect(host.querySelector('[data-arkme-text-toggle]')!.getAttribute('aria-expanded')).toBe('false')
  await act(async () => buttons()[0]!.click())
  expect(copyText).toHaveBeenCalledWith(text)
})
it('opens automatically for rendered Markdown inside details', async () => {
  await render(); const bold = host.querySelector('aside strong')!; select(document.createTreeWalker(bold, NodeFilter.SHOW_TEXT).nextNode()!, 0, 2); await mouse(bold, 'mouseup')
  expect(menu()).not.toBeNull(); await act(async () => buttons()[0]!.click()); expect(copyText).toHaveBeenCalledWith('详情')
})
it('supports the actual shared message component used by self/private/group/bot details and bubbles', async () => {
  for (const presentation of ['bubble', 'detail'] as const) {
    for (const senderKind of ['user', 'bot'] as const) {
      const item = { itemUid: 'message', title: '', textContent: `前缀${partial}后缀`, textFormat: 'plain', status: 1, senderKind } as ArkmeTimelineItem
      await render(<><ArkmeMessageTextSelectionToolbar /><ArkmeMessageContent item={item} presentation={presentation} /></>)
      const p = host.querySelector('[data-arkme-text-selection] p')!; expect(p).not.toBeNull()
      const node = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode()!; select(node, 2, 7); await mouse(p, 'mouseup')
      expect(menu()).not.toBeNull(); await act(async () => buttons()[0]!.click()); expect(copyText).toHaveBeenLastCalledWith(partial)
    }
  }
})
it('offers selected-text only across messages and rejects crossing from list to details', async () => {
  await render(); const a = host.querySelector('#one')!, b = host.querySelector('#two')!
  select(a.firstChild!, 2, 3, b.firstChild!); await mouse(b, 'mouseup'); expect(buttons()).toHaveLength(1)
  const bold = host.querySelector('aside strong')!; select(a.firstChild!, 2, 2, document.createTreeWalker(bold, NodeFilter.SHOW_TEXT).nextNode()!); await mouse(bold, 'mouseup'); expect(menu()).toBeNull()
})
it('excludes editors and ignores right-click without text selection', async () => {
  await render(); const p = host.querySelector('#editor')!; select(p.firstChild!, 0, 2); await mouse(p, 'mouseup'); expect(menu()).toBeNull()
  document.getSelection()!.removeAllRanges(); await mouse(host.querySelector('#one')!, 'contextmenu'); expect(menu()).toBeNull()
})
it('dismisses on scroll, Escape, outside click, and source removal without closing details', async () => {
  await render(); await open(); await act(async () => document.dispatchEvent(new Event('scroll'))); expect(menu()).toBeNull()
  await open(); const onEscape = vi.fn(); document.addEventListener('keydown', onEscape)
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(menu()).toBeNull(); expect(onEscape).not.toHaveBeenCalled(); document.removeEventListener('keydown', onEscape)
  await open(); await mouse(host.querySelector('#editor')!, 'mousedown'); expect(menu()).toBeNull()
  await open(); await render(<ArkmeMessageTextSelectionToolbar />); expect(menu()).toBeNull()
})
it('does not reuse an old selection after the selected message changes', async () => {
  await render(); await open(); await render(<Fixture text="更新后的消息" />); expect(menu()).toBeNull()
})
it('keeps the selection menu on right-click and supports keyboard selection', async () => {
  await render(); await open(); await mouse(host.querySelector('#one')!, 'contextmenu', 2); expect(menu()).not.toBeNull()
  await act(async () => document.dispatchEvent(new Event('scroll')))
  await act(async () => host.querySelector('#one')!.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true, bubbles: true })))
  expect(menu()).not.toBeNull()
})
it('shows a retryable local copy error without falsely claiming success', async () => {
  await render(); await open(); vi.mocked(copyText).mockRejectedValueOnce(new Error('denied'))
  await act(async () => buttons()[0]!.click()); expect(menu()?.textContent).toContain('复制失败，请重试')
  await act(async () => buttons()[0]!.click()); expect(menu()).toBeNull()
})
it('never applies a retained selection to a different right-clicked message', async () => {
  await render(); await open(); await act(async () => document.dispatchEvent(new Event('scroll')))
  await mouse(host.querySelector('#two')!, 'contextmenu', 2); expect(menu()).toBeNull()
})
it('dismisses a stale toolbar when the selection moves outside registered content', async () => {
  await render(); await open(); const editor = host.querySelector('#editor')!
  select(editor.firstChild!, 0, 2)
  await act(async () => document.dispatchEvent(new Event('selectionchange'))); expect(menu()).toBeNull()
})
