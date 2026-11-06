// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createHash, webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MessageQuoteThreadsProvider, MessageQuoteThreadBadge } from '../src/client/MessageQuoteThreads.js'
import { ArkmeMessageContent } from '../src/client/ArkmeRichContent.js'
import { invalidateMessageQuoteSources } from '../src/client/message-quote-invalidations.js'
import { quoteSourceContent } from '../src/message-quote.js'
import type { ArkmeTimelineItem } from '../src/types.js'
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: vi.fn(async () => ({})) }))
const original: ArkmeTimelineItem = { itemUid: 'original', messageActionRef: 'action', recordOwnerUserId: 7, sequence: 11,
  senderName: '作者', title: '', textContent: '可以。可以。', isMe: false, status: 1, sendAtMillis: 1 }
const quote = { version: 1 as const, projection: 'arkme-text-v1' as const,
  sourceDigest: createHash('sha256').update(quoteSourceContent(original)).digest('hex'), start: 3, end: 5, text: '可以', prefix: '可以。', suffix: '。' }
const reply: ArkmeTimelineItem = { ...original, itemUid: 'reply', sequence: 12, extensionParent: {
  itemUid: original.itemUid, recordOwnerUserId: 7, sequence: 11, senderName: '作者', title: '', textContent: original.textContent, quote, quoteState: 'available',
} }
let host: HTMLDivElement, root: Root, highlights: Map<string, { ranges: Range[] }>
const tick = () => new Promise(resolve => setTimeout(resolve, 40))
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  highlights = new Map(); vi.stubGlobal('CSS', { highlights })
  vi.stubGlobal('Highlight', class { constructor(...ranges: Range[]) { this.ranges = ranges } ranges: Range[] })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 200, 100))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.getSelection()?.removeAllRanges(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('underlines the exact occurrence in list and detail without replacing text nodes or selection, then invalidates cleanly', async () => {
  const open = vi.fn()
  await act(async () => { root.render(<MessageQuoteThreadsProvider scope="account:chat" sourceRef="source" chat items={[original, reply]} onOpenComments={open}>
    <ArkmeMessageContent item={original} sourceRef="source"/><div data-arkme-note-detail><ArkmeMessageContent item={original} sourceRef="source" presentation="detail"/></div>
    <MessageQuoteThreadBadge item={original}/>
  </MessageQuoteThreadsProvider>); await tick() })
  await act(tick)
  // Digest verification and highlight publication are asynchronous; a fixed
  // frame delay does not establish readiness under the full suite's load.
  await vi.waitFor(() => expect([...highlights.values()].flatMap(x => x.ranges)).toHaveLength(2))
  const ranges = [...highlights.values()].flatMap(x => x.ranges)
  for (const range of ranges) { expect(range.toString()).toBe('可以'); expect(range.startOffset).toBe(3) }
  const text = ranges[0]!.startContainer
  const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(ranges[0]!.cloneRange())
  await act(async () => { document.dispatchEvent(new Event('scroll')); await tick() })
  expect(selection.toString()).toBe('可以'); expect(text.isConnected).toBe(true)
  await act(async () => (host.querySelector('[data-arkme-quote-comments]') as HTMLButtonElement).click())
  expect(open).toHaveBeenCalledWith(original)
  await act(async () => { invalidateMessageQuoteSources(); await tick() })
  expect(host.querySelector('[data-arkme-quote-comments]')).toBeNull()
  expect([...highlights.values()].flatMap(x => x.ranges)).toHaveLength(0)
})
it('never applies a historical anchor to edited source text or an explicitly unavailable quote', async () => {
  await act(async () => { root.render(<MessageQuoteThreadsProvider scope="account:chat" sourceRef="source" chat
    items={[{ ...original, textContent: '修改后的正文' }, reply, { ...reply, itemUid: 'hidden', extensionParent: { ...reply.extensionParent!, quoteState: 'unavailable' } }]} onOpenComments={() => {}}>
    <ArkmeMessageContent item={{ ...original, textContent: '修改后的正文' }} sourceRef="source"/>
  </MessageQuoteThreadsProvider>); await tick() })
  await act(tick)
  expect([...highlights.values()].flatMap(x => x.ranges)).toHaveLength(0)
})
