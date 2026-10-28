// @vitest-environment jsdom
import { act } from 'react'
import { createHash, webcrypto } from 'node:crypto'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useMessageQuoteNavigation } from '../src/client/use-message-quote-navigation.js'
import type { ArkmeTimelineExtensionParent, ArkmeTimelineItem } from '../src/types.js'

const current = vi.hoisted(() => ({ text: '先检查再修改' }))
vi.mock('../src/client/ArkmeMessageTextSelection.js', () => ({ messageSelectionTarget: () => ({ sourceRef: 'test', item: { title: '', textContent: current.text, textFormat: 'plain' } }) }))
const parent: ArkmeTimelineExtensionParent = { itemUid: 'parent', recordOwnerUserId: 11, sequence: 7, senderName: '甲', title: '', textContent: '先检查再修改',
  quoteState: 'available', quote: { version: 1, projection: 'arkme-text-v1', sourceDigest: createHash('sha256').update(JSON.stringify(['先检查再修改', 'plain'])).digest('hex'), start: 1, end: 3, text: '检查', prefix: '先', suffix: '再修改' } }
const from: ArkmeTimelineItem = { itemUid: 'reply', status: 1, isMe: true, senderName: '我', textContent: '好的', title: '', sendAtMillis: 1 }
let host: HTMLDivElement, root: Root, nav: ReturnType<typeof useMessageQuoteNavigation>
let frames: FrameRequestCallback[], highlights: Map<string, unknown>
function Harness({ scope = 'chat-a' }: { scope?: string }) { nav = useMessageQuoteNavigation(scope); return <output>{nav.notice}</output> }
function row(sequence = '7') {
  const el = document.createElement('li'); el.dataset.arkmeMessageOwnerId = '11'; el.dataset.arkmeMessageSequence = sequence
  el.innerHTML = '<div data-arkme-text-selection><p>先检查再修改</p></div>'; host.append(el); return el
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  current.text = '先检查再修改'; vi.stubGlobal('crypto', webcrypto)
  frames = []; highlights = new Map()
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => frames.push(fn))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('CSS', { highlights }); vi.stubGlobal('Highlight', class { constructor(public range: Range) {} })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<Harness />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
it('highlights the exact fragment without changing text or selection and cleans up on conversation switch', async () => {
  const target = row(), before = target.innerHTML
  await act(async () => { nav.begin(parent, from); nav.located(target, 'parent'); frames.shift()?.(0); await new Promise(resolve => setTimeout(resolve, 10)) })
  expect((highlights.get('arkme-message-quote') as { range: Range }).range.toString()).toBe('检查')
  expect(target.innerHTML).toBe(before); expect(document.getSelection()?.toString()).toBe('')
  expect(nav.back?.itemUid).toBe('reply')
  await act(async () => root.render(<Harness scope="chat-b" />))
  expect(highlights.size).toBe(0); expect(nav.back).toBeUndefined()
})
it('does not highlight the wrong occurrence of the same record', async () => {
  await act(async () => { nav.begin(parent, from); nav.located(row('8'), 'parent') })
  expect(frames).toHaveLength(0); expect(highlights.size).toBe(0)
  expect(nav.notice).toContain('那次发送'); expect(nav.back?.itemUid).toBe('reply')
})
it('keeps the quote snapshot when edited and avoids a misleading highlight', async () => {
  await act(async () => { nav.begin({ ...parent, quoteState: 'edited' }, from); nav.located(row(), 'parent') })
  expect(frames).toHaveLength(0); expect(nav.notice).toContain('原消息已编辑')
})
it('cancels pending highlighting when another message navigation wins', async () => {
  await act(async () => { nav.begin(parent, from); nav.located(row(), 'another'); nav.located(row(), 'parent') })
  expect(frames).toHaveLength(0); expect(highlights.size).toBe(0)
})

it('rejects a full-source edit even when the selected fragment and nearby context survive', async () => {
  current.text += '新增';
  await act(async () => { nav.begin(parent, from); nav.located(row(), 'parent'); frames.shift()?.(0); await new Promise(resolve => setTimeout(resolve, 10)) });
  expect(highlights.size).toBe(0); expect(nav.notice).toContain('原文发生变化');
});
