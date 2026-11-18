// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { selectedTextSelfDelivery } from '../src/client/SelectedTextSelfNote.js'
import { SelectedTextSelfNoteContent } from '../src/client/SelectedTextSelfNoteContent.js'
import { ArkmeMessageTextSelectionToolbar, ArkmeSelectableMessageText, registerMessageTextSelectionTarget, type MessageSelectionTarget } from '../src/client/ArkmeMessageTextSelection.js'
import { captureQuoteAnchor, quoteDomProjection } from '../src/client/message-quote-selection.js'
import { quoteCanonicalText } from '../src/message-quote.js'
import { selectedTextNoteHeader, selectedTextNoteWireText, selectedTextNotePresentation, selectedTextForwardWireText, type SelectedTextNoteQuote } from '../src/selected-text-note.js'
import { registerLocalSnapshotForward } from '../src/client/local-snapshot-forward.js'
import { callArkme } from '../src/client/api.js'
import { ExcerptOriginal } from '../src/client/ExcerptOriginal.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { ArkmeClientError } from '../src/sdk/index.js'
import { captureMessageTextSelection } from '../src/client/message-text-selection.js'
vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
const quote: SelectedTextNoteQuote = { version: 1, sourceLabel: '群聊 · 产品讨论', senderName: '同事', sourceAtMillis: 1000, text: '引用文字\n第二行' }
let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.mocked(callArkme).mockReset(); vi.mocked(callArkme).mockImplementation(async(operation,params)=>operation==='selected-text.prepare'?params!.quote:undefined)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  Range.prototype.getBoundingClientRect = () => new DOMRect(50, 100, 180, 20)
  Range.prototype.getClientRects = () => [new DOMRect(50, 100, 180, 20)] as unknown as DOMRectList
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.getSelection()?.removeAllRanges(); vi.unstubAllGlobals(); vi.clearAllMocks() })
it('keeps quote/thought visually separate while exact selection offsets still match persisted text', async () => {
  const noteText = '我的😀新想法', wire = selectedTextNoteWireText(noteText, quote)
  await act(async () => root.render(<SelectedTextSelfNoteContent value={{ quote, noteText, header: selectedTextNoteHeader(quote), storage: 'local' }} />))
  expect(quoteDomProjection(host).text).toBe(quoteCanonicalText({ textContent: wire }))
  const own = host.querySelectorAll('[data-arkme-quote-prose]')[3]!, range = document.createRange(); range.selectNodeContents(own)
  const anchor = captureQuoteAnchor(host, range, noteText, { textContent: wire } as never)
  expect(quoteCanonicalText({ textContent: wire }).slice(anchor.start, anchor.end)).toBe(noteText)
  expect(host.querySelector('[data-arkme-self-note-quote]')?.children.length).toBe(3)
})
it.each(['私聊', '群聊', '发给自己', 'Arko', '团队消息', '录音转写', '通话转写', 'DeepSeek Harness', 'Codex'])('forwards just the selection for %s while retaining reply', async label => {
  const present = vi.fn(() => Promise.resolve({ completed: false })), cleanup = registerLocalSnapshotForward(present)
  const target: MessageSelectionTarget = { sourceRef: 'source', item: { itemUid: 'id', senderName: '原作者', sendAtMillis: 1000, isMe: false, title: '', textContent: '部分原文', status: 1, messageActionRef: 'ref' } }
  await act(async () => root.render(<StrictMode><ArkmeSelectableMessageText text="部分原文" target={target}><span data-body>部分原文</span></ArkmeSelectableMessageText><ArkmeMessageTextSelectionToolbar replySourceRef="source" onReply={() => {}} selfNote={{ sourceLabel: label, accountKey: 'prod:11' }} /></StrictMode>))
  const body = host.querySelector('[data-body]')!, range = document.createRange(); range.selectNodeContents(body); document.getSelection()!.addRange(range)
  await act(async () => body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })))
  const buttons = [...document.querySelectorAll('[data-arkme-text-selection-toolbar] button')]
  expect(buttons.map(b => b.textContent)).toContain('回复')
  expect(buttons.map(b => b.textContent)).not.toContain('发给自己')
  await act(async () => (buttons.find(b => b.textContent === '转发') as HTMLButtonElement).click())
  await vi.waitFor(() => expect(present).toHaveBeenCalledOnce())
  expect((present.mock.calls[0] as unknown as any[])[0].preview.quote).toMatchObject({ text: '部分原文', sourceLabel: label, senderName: '原作者' })
  cleanup()
  expect(callArkme).not.toHaveBeenCalled()
})
it('does not use stale quote content after the message text changes', () => {
  const saved = { quote, noteText: '旧笔记', header: selectedTextNoteHeader(quote), storage: 'local' as const }
  expect(selectedTextNotePresentation(selectedTextNoteWireText('修改后的笔记', quote), saved)?.noteText).toBe('修改后的笔记')
  expect(selectedTextNotePresentation('完全不同的内容', saved)).toBeUndefined()
})
it('uses one immutable request for an uncertain retry and never sends after account teardown', async () => {
  vi.mocked(callArkme).mockRejectedValueOnce(new Error('timeout')).mockResolvedValue({ itemUid: 'stable', localState: 'synced' })
  const send = selectedTextSelfDelivery('prod:11', '新的想法', quote, 'stable'), ctrl = new AbortController()
  await expect(send(ctrl.signal)).rejects.toThrow('timeout'); await send(ctrl.signal); await send(ctrl.signal)
  expect(callArkme).toHaveBeenCalledTimes(2)
  expect(vi.mocked(callArkme).mock.calls[0]).toEqual(vi.mocked(callArkme).mock.calls[1])
  expect(vi.mocked(callArkme).mock.calls[0]?.[1]).toMatchObject({ noteText: '新的想法', quote, expectedAccountKey: 'prod:11' })
  ctrl.abort(); await expect(send(ctrl.signal)).rejects.toThrow()
})

it.each(['', '自己的附言'])('renders a forwarded quotation and optional comment in wire order', async noteText => {
  const saved = { quote: { ...quote, text: '含结尾空格的选段  ' }, noteText, header: selectedTextNoteHeader(quote), kind: 'forward' as const, storage: 'local' as const }
  const wire = selectedTextForwardWireText(noteText, saved.quote), presentation = selectedTextNotePresentation(wire, saved)!
  await act(async () => root.render(<SelectedTextSelfNoteContent value={presentation} />))
  expect(quoteDomProjection(host).text).toBe(quoteCanonicalText({ textContent: wire }))
  expect(host.textContent).not.toContain('我的笔记')
  if (!noteText) expect(host.textContent).not.toContain('附言')
})

it('closes original content and aborts its read when the saved occurrence or account changes', async () => {
  arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:11} as never)
  vi.mocked(callArkme).mockResolvedValue({title:'原文',text:'只属于当前账号的内容'})
  await act(async()=>root.render(<ExcerptOriginal recordUid="same" sourceRef="source-1" messageActionRef="occurrence-1"/>))
  await act(async()=>host.querySelector('button')!.click())
  expect(host.querySelector('section')?.textContent).toContain('只属于当前账号的内容')
  const signal=vi.mocked(callArkme).mock.calls[0]?.[2]
  await act(async()=>root.render(<ExcerptOriginal recordUid="same" sourceRef="source-2" messageActionRef="occurrence-2"/>))
  expect(signal?.aborted).toBe(true)
  expect(host.querySelector('section')).toBeNull()
  await act(async()=>host.querySelector('button')!.click())
  expect(vi.mocked(callArkme).mock.calls[1]?.[1]).toEqual({recordUid:'same',sourceRef:'source-2',messageActionRef:'occurrence-2'})
  await act(async()=>arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:22} as never))
  expect(host.querySelector('section')).toBeNull()
})

it('opens inline without changing quote offsets and only retries temporary failures', async () => {
  const cloudQuote: SelectedTextNoteQuote = { ...quote, source: { kind: 'record', owner_user_id: 11, record_uid: 'source' } }
  const noteText = '我的想法'
  const value = { quote: cloudQuote, noteText, header: selectedTextNoteHeader(cloudQuote), storage: 'cloud' as const }
  const pending = Promise.withResolvers<never>()
  vi.mocked(callArkme).mockReturnValueOnce(pending.promise).mockRejectedValueOnce(
    new ArkmeClientError({ code: 'excerpt-source-unavailable', message: 'raw backend detail', retryable: false }),
  )
  await act(async () => root.render(<SelectedTextSelfNoteContent value={value} recordUid="excerpt" detail />))
  const opener = [...host.querySelectorAll('button')].find(button => button.textContent === '查看原文')!
  await act(async () => opener.click())
  const panel = document.getElementById(opener.getAttribute('aria-controls')!)!
  expect(panel.previousElementSibling?.hasAttribute('data-arkme-self-note-quote')).toBe(true)
  expect(document.querySelector('[aria-modal="true"]')).toBeNull()
  expect(document.activeElement).toBe(panel)
  expect(panel.querySelector('[role="status"]')?.textContent).toBe('正在打开原文…')
  expect(quoteDomProjection(host).text).toBe(quoteCanonicalText({ textContent: selectedTextNoteWireText(noteText, cloudQuote) }))
  await act(async () => pending.reject(new TypeError('Failed to fetch')))
  const retry = [...panel.querySelectorAll('button')].find(button => button.textContent === '重试')!
  await act(async () => retry.click())
  expect(callArkme).toHaveBeenCalledTimes(2)
  expect(panel.querySelector('[role="alert"]')?.textContent).toBe('原文暂不可查看。')
  expect(panel.textContent).not.toContain('重试')
  const parentEscape = vi.fn()
  document.addEventListener('keydown', parentEscape, { once: true })
  await act(async () => panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  document.removeEventListener('keydown', parentEscape)
  expect(parentEscape).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(opener)
  expect(opener.getAttribute('aria-expanded')).toBe('false')
})


it('scrolls the exact range into view without requiring browser highlight support', async () => {
  const size = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.tabIndex === 0 ? 180 : 0
  })
  const rect = vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 1000, 36, 18)] as unknown as DOMRectList)
  vi.stubGlobal('Highlight', undefined)
  try {
    const text = '定位目标 ' + '原文段落 '.repeat(80) + '定位目标'
    const start = text.lastIndexOf('定位目标')
    vi.mocked(callArkme).mockResolvedValue({ title: '原文', text, selection: { start, end: start + 4 } })
    await act(async () => root.render(<ExcerptOriginal recordUid="excerpt" />))
    await act(async () => host.querySelector('button')!.click())
    expect(host.querySelector<HTMLElement>('section div[tabindex="0"]')?.scrollTop).toBe(919)
  } finally {
    size.mockRestore()
    rect.mockRestore()
  }
})

it.each([
  { name: 'partly clipped on the right', left: 95, width: 12, visibleWidth: 12, shouldScroll: true },
  { name: 'fully visible', left: 48, width: 12, visibleWidth: 12, shouldScroll: false },
  { name: 'wider than the viewport', left: 24, width: 120, visibleWidth: 100, shouldScroll: true,
    leadingGlyphLeft: 24 },
  { name: 'wider than the viewport with its first glyph on the right',
    left: 24, width: 240, visibleLeft: 164, visibleWidth: 100, shouldScroll: true,
    leadingGlyphLeft: 256 },
  { name: 'split across the right edge on one line', left: 88, width: 29, visibleWidth: 29, shouldScroll: true,
    fragments: [new DOMRect(88, 0, 8, 18), new DOMRect(96, 0, 21, 18)] },
  { name: 'visible on the first line with a wide second line', left: 48, width: 12, visibleWidth: 12, shouldScroll: false,
    fragments: [new DOMRect(48, 0, 12, 18), new DOMRect(0, 18, 130, 18)] },
])('reveals the selected code when it is $name', async ({ left, width, visibleLeft = left, visibleWidth, shouldScroll, leadingGlyphLeft, fragments }) => {
  const viewport = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return this.tagName === 'PRE' ? 100 : 0
  })
  const content = vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(function (this: Element) {
    return this.tagName === 'PRE' ? 300 : 0
  })
  const rect = vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
    const boxes = leadingGlyphLeft !== undefined && this.toString() === '定'
      ? [new DOMRect(leadingGlyphLeft, 0, 8, 18)]
      : fragments ?? [new DOMRect(left, 0, width, 18)]
    return boxes as unknown as DOMRectList
  })
  try {
    vi.mocked(callArkme).mockResolvedValue({
      title: '原文', text: '```\n前文定位目标后文\n```', textFormat: 'markdown', selection: { start: 2, end: 6 },
    })
    await act(async () => root.render(<ExcerptOriginal recordUid="excerpt" />))
    await act(async () => host.querySelector('button')!.click())
    const code = host.querySelector('pre')!
    expect(code.scrollLeft > 0).toBe(shouldScroll)
    expect(visibleLeft - code.scrollLeft).toBeGreaterThanOrEqual(0)
    expect(visibleLeft + visibleWidth - code.scrollLeft).toBeLessThanOrEqual(code.clientWidth)
  } finally {
    viewport.mockRestore()
    content.mockRestore()
    rect.mockRestore()
  }
})

it('keeps native original selection out of the excerpt menu and whole-message range', async () => {
  const cloudQuote: SelectedTextNoteQuote = { ...quote, source: { kind: 'record', owner_user_id: 11, record_uid: 'source' } }
  const noteText = '独立附言'
  const wire = selectedTextForwardWireText(noteText, cloudQuote)
  const value = { quote: cloudQuote, noteText, header: selectedTextNoteHeader(cloudQuote), storage: 'cloud' as const, kind: 'forward' as const }
  const target: MessageSelectionTarget = { sourceRef: 'source', item: { itemUid: 'excerpt', senderName: '同事', sendAtMillis: 1000,
    isMe: false, title: '', textContent: wire, status: 1, messageActionRef: 'ref' } }
  const parentContextMenu = vi.fn()
  vi.mocked(callArkme).mockResolvedValue({ title: '原文', text: '未摘录的原文内容' })
  await act(async () => root.render(<div onContextMenu={parentContextMenu}>
    <SelectedTextSelfNoteContent value={value} recordUid="excerpt" contentRef={element => {
      if (element) return registerMessageTextSelectionTarget(element, wire, target)
    }} />
    <ArkmeMessageTextSelectionToolbar replySourceRef="source" onReply={() => {}} selfNote={{ sourceLabel: '群聊', accountKey: 'prod:11' }} />
  </div>))
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '查看原文')!.click())
  const message = host.querySelector<HTMLElement>('[data-arkme-text-selection]')!
  const original = host.querySelector('[data-arkme-excerpt-original] div[tabindex="0"]')!
  const selection = document.getSelection()!
  const select = async (element: Element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    selection.removeAllRanges()
    selection.addRange(range)
    await act(async () => element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })))
  }
  await select(original)
  expect(document.querySelector('[data-arkme-text-selection-toolbar]')).toBeNull()
  expect(selection.toString()).toBe('未摘录的原文内容')
  expect(captureMessageTextSelection(host)).toBeUndefined()
  await act(async () => original.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
  expect(parentContextMenu).not.toHaveBeenCalled()

  await select(message.querySelectorAll('[data-arkme-quote-prose]')[1]!)
  const toolbar = document.querySelector('[data-arkme-text-selection-toolbar]')!
  expect(toolbar.textContent).toContain('转发')
  await act(async () => [...toolbar.querySelectorAll('button')].find(button => button.textContent === '全选')!.click())
  expect(selection.toString()).toContain(noteText)
  expect(selection.toString()).not.toContain('未摘录的原文内容')
  expect(quoteDomProjection(message).text).toBe(quoteCanonicalText({ textContent: wire }))
})

it.each([
  { text: '前文\n\n相同词\n相同词 https://example.com', textFormat: 'plain' as const },
  { text: '前文\n\n**相同词**\n\n**相同词** [链接](https://example.com)', textFormat: 'markdown' as const },
])('preserves paragraphs and links while highlighting the exact original range ($textFormat)', async original => {
  class TestHighlight {
    constructor(readonly range: Range) {}
  }
  const highlights = new Map<string, TestHighlight>()
  vi.stubGlobal('Highlight', TestHighlight)
  vi.stubGlobal('CSS', { highlights })
  const canonical = quoteCanonicalText({ textContent: original.text, textFormat: original.textFormat })
  const start = canonical.lastIndexOf('相同词')
  vi.mocked(callArkme).mockResolvedValue({ title: '原文', ...original, selection: { start, end: start + 3 } })
  await act(async () => root.render(<ExcerptOriginal recordUid="excerpt"/>))
  await act(async () => host.querySelector('button')!.click())
  const panel = host.querySelector('section')!
  const link = panel.querySelector('a')!
  expect(link.href).toBe('https://example.com/')
  const range = [...highlights.values()][0]?.range
  expect(range?.toString()).toBe('相同词')
  if (original.textFormat === 'plain') {
    expect(link.parentElement!.textContent).toBe(original.text)
    expect(range!.startOffset).toBe(original.text.lastIndexOf('相同词'))
  } else {
    expect(panel.querySelectorAll('p')).toHaveLength(3)
    expect(range!.startContainer.parentElement!.closest('strong')).toBe(panel.querySelector('p:last-of-type strong'))
  }
  await act(async () => panel.querySelector<HTMLButtonElement>('button[aria-label="关闭原文"]')!.click())
  expect(highlights.size).toBe(0)
})
