// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { selectedTextSelfDelivery } from '../src/client/SelectedTextSelfNote.js'
import { SelectedTextSelfNoteContent } from '../src/client/SelectedTextSelfNoteContent.js'
import { ArkmeMessageTextSelectionToolbar, ArkmeSelectableMessageText, type MessageSelectionTarget } from '../src/client/ArkmeMessageTextSelection.js'
import { captureQuoteAnchor, quoteDomProjection } from '../src/client/message-quote-selection.js'
import { quoteCanonicalText } from '../src/message-quote.js'
import { selectedTextNoteHeader, selectedTextNoteWireText, selectedTextNotePresentation, selectedTextForwardWireText, type SelectedTextNoteQuote } from '../src/selected-text-note.js'
import { registerLocalSnapshotForward } from '../src/client/local-snapshot-forward.js'
import { callArkme } from '../src/client/api.js'
vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
const quote: SelectedTextNoteQuote = { version: 1, sourceLabel: '群聊 · 产品讨论', senderName: '同事', sourceAtMillis: 1000, text: '引用文字\n第二行' }
let root: Root, host: HTMLDivElement
beforeEach(() => {
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
