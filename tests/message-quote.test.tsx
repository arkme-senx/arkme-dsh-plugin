// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createHash, webcrypto } from 'node:crypto'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { captureQuoteAnchor, quoteHighlightRange, quoteDomProjection } from '../src/client/message-quote-selection.js'
import { quoteCanonicalText, quoteSourceContent, readMessageQuote, projectedMessageQuote, quoteCapabilitiesFromWire, type ArkmeMessageQuote } from '../src/message-quote.js'
import { ArkmeMessageTextSelectionToolbar } from '../src/client/ArkmeMessageTextSelection.js'
import { ArkmeMessageContent } from '../src/client/ArkmeRichContent.js'
import { ArkmeQuotePreview } from '../src/client/ArkmeQuotePreview.js'
import { ArkmeComposerDraftStore, arkmeSourceComposerDraftKey } from '../src/client/composer-draft-store.js'
import type { ArkmeTimelineItem } from '../src/types.js'
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: vi.fn(async () => ({})) }))
const base: ArkmeTimelineItem = { itemUid: 'message', messageActionRef: 'opaque', title: '', senderName: '宏顺', textContent: '可以，先检查。可以，再处理。', isMe: false, status: 1, sendAtMillis: 1, recordVersion: 2 }
const draftKey = arkmeSourceComposerDraftKey(42, { kind: 'group_chat', sourceRef: 'source', sourceKey: 'chat:one' })!
let host: HTMLDivElement, root: Root
const digest = (item: ArkmeTimelineItem) => createHash('sha256').update(quoteSourceContent(item)).digest('hex')
function select(node: Node, start: number, end: number) {
  const range = document.createRange(); range.setStart(node, start); range.setEnd(node, end)
  document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range); return range
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('crypto', webcrypto)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  Range.prototype.getBoundingClientRect = () => new DOMRect(20, 80, 150, 20)
  Range.prototype.getClientRects = () => [new DOMRect(20, 80, 150, 20)] as unknown as DOMRectList
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.getSelection()?.removeAllRanges(); vi.unstubAllGlobals() })
it('captures the second identical phrase and locates exactly that occurrence', () => {
  const el = document.createElement('div'); el.innerHTML = `<p>${base.textContent}</p>`; host.append(el)
  const node = el.firstChild!.firstChild!; const range = select(node, 7, 9)
  const quote = { ...captureQuoteAnchor(el, range, '可以', base), sourceDigest: digest(base) }
  expect(quote.start).toBe(7); expect(quote.end).toBe(9)
  expect(quoteHighlightRange(el, quote)?.startOffset).toBe(7)
  node.textContent = '这里已经改变了'; expect(quoteHighlightRange(el, quote)).toBeUndefined()
})
it('maps multiline Markdown and emoji while excluding controls', () => {
  const item = { ...base, textFormat: 'markdown' as const, textContent: '**检查**\n\n后续 👋 处理' }
  const el = document.createElement('div'); el.innerHTML = '<div><p><strong>检查</strong></p><p>后续 👋 处理</p><button>展开</button></div>'; host.append(el)
  expect(quoteDomProjection(el).text).toBe(quoteCanonicalText(item))
  const node = el.querySelectorAll('p')[1]!.firstChild!; const range = select(node, 0, 5)
  const q = captureQuoteAnchor(el, range, '后续 👋', item)
  expect(q.start).toBe(3); expect(q.end).toBe(8)
})
it('does not guess offsets when rendered link labels differ from the source', () => {
  const el = document.createElement('div'); el.textContent = '点击 有用的页面'; host.append(el)
  const range = select(el.firstChild!, 0, 2)
  expect(() => captureQuoteAnchor(el, range, '点击', { ...base, textContent: '点击 https://example.com' })).toThrow('准确关联原文')
})
it('keeps a quote from beyond the 2000-character preview across refresh and cancellation', () => {
  const item = { ...base, textContent: '前'.repeat(2500) + '要回复的句子' }
  const quote: ArkmeMessageQuote = { version: 1, projection: 'arkme-text-v1', sourceDigest: digest(item), start: 2500, end: 2506, text: '要回复的句子', prefix: '前'.repeat(32), suffix: '' }
  let saved = ''; const storage = { getItem: () => saved || null, setItem: (_: string, value: string) => { saved = value } }
  const store = new ArkmeComposerDraftStore(storage); store.setText(draftKey, '已经写好的内容'); store.setExtensionTarget(draftKey, item, quote)
  const restored = new ArkmeComposerDraftStore(storage)
  expect(restored.get(draftKey).extensionTarget?.quote).toEqual(quote)
  expect(restored.get(draftKey).extensionTarget?.item.textContent).toHaveLength(2000)
  restored.setExtensionTarget(draftKey, undefined); expect(restored.get(draftKey).text).toBe('已经写好的内容')
})
it('adds Reply for a single eligible message and forwards exact captured text', async () => {
  const reply = vi.fn()
  await act(async () => root.render(<><ArkmeMessageTextSelectionToolbar replySourceRef="source" onReply={reply} /><ArkmeMessageContent item={base} sourceRef="source" /></>))
  const p = host.querySelector('p')!; select(document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode()!, 7, 9)
  await act(async () => p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })))
  const buttons = Array.from(document.querySelectorAll('[role="toolbar"] button'))
  expect(buttons.map(el => el.textContent)).toEqual(['复制', '全选', '回复'])
  await act(async () => { (buttons[2] as HTMLButtonElement).click(); await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(reply).toHaveBeenCalledWith(expect.objectContaining({ item: base }), expect.objectContaining({ text: '可以', start: 7, sourceDigest: digest(base) }))
})
it('does not expose another conversation or an unsupported composite card as a reply target', async () => {
  await act(async () => root.render(<><ArkmeMessageTextSelectionToolbar replySourceRef="other" onReply={vi.fn()} /><ArkmeMessageContent item={base} sourceRef="source" /></>))
  const p = host.querySelector('p')!; select(document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode()!, 7, 9)
  await act(async () => p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })))
  expect(document.querySelector('[role="toolbar"]')?.textContent).not.toContain('回复')
})
it('hides withdrawn snapshots and never parses mentions in a quotation', async () => {
  const q = { version: 1, projection: 'arkme-text-v1', sourceDigest: 'a'.repeat(64), start: 0, end: 6, text: '@所有人 好', prefix: '', suffix: '' } as const
  expect(projectedMessageQuote(q, 'withdrawn')).toEqual({ quoteState: 'unavailable' })
  expect(projectedMessageQuote(q, undefined)).toEqual({ quoteState: 'unavailable' })
  await act(async () => root.render(<ArkmeQuotePreview parent={{ ...base, quote: q, quoteState: 'unavailable' }} onOpen={vi.fn()} />))
  expect(host.textContent).not.toContain('@所有人'); expect(host.querySelector('button')!.disabled).toBe(true)
})
it('rejects corrupt quote offsets and requires the exact capability version', () => {
  expect(readMessageQuote({ version: 1 })).toBeUndefined()
  expect(quoteCapabilitiesFromWire({ enabled: true })).toMatchObject({ supported: false })
  expect(quoteCapabilitiesFromWire({ enabled: true, protocol_version: 1, projection: 'arkme-text-v1', max_quote_length: 1000 })).toEqual({ supported: true, maxQuoteLength: 1000 })
})
