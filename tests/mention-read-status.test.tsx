import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeMessageReadReceiptDetail, ArkmeSourceItem, ArkmeTimelineItem, ArkmeTimelineMentionTarget } from '../src/types.js'
import { ArkmeMentionReadProvider, useReadMentionMembers } from '../src/client/mention-read-status.js'
import { ArkmeRichText } from '../src/client/ArkmeRichText.js'
import { ArkmeMarkdownBody } from '../src/client/ArkmeMarkdownBody.js'
import { ArkmeMessageContent } from '../src/client/ArkmeRichContent.js'
import { arkmeMessageReadReceipts } from '../src/client/message-read-receipt-store.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { ArkmeReadReceiptIcon } from '../src/client/ArkmeReadReceiptIcon.js'
import { arkmeTheme } from '../src/client/arkme-theme.js'

const { read } = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: read }))
const source: ArkmeSourceItem = { sourceRef: 'group-ref', sourceKey: 'group-key', kind: 'group_chat', displayName: '群' }
const mentions: ArkmeTimelineMentionTarget[] = [
  { kind: 'member', memberRef: 'person-a', displayName: '同名', startIndex: 0, length: 3 },
  { kind: 'member', memberRef: 'person-b', displayName: '同名', startIndex: 4, length: 3 },
]
const message: ArkmeTimelineItem = { itemUid: 'msg', sequence: 8, isMe: true, status: 1, senderName: '我',
  title: '', textContent: '@同名 @同名 内容', displayKind: 0, sendAtMillis: 1, mentions }
const detail: ArkmeMessageReadReceiptDetail = { sourceRef: source.sourceRef, itemUid: message.itemUid, sequence: 8,
  readCount: 1, unreadCount: 1, totalMemberCount: 2, items: [
    { memberRef: 'person-a', displayName: '不同的备注', readStatus: 'unread' },
    { memberRef: 'person-b', displayName: '同名', readStatus: 'read' },
  ] }
let renderer: ReactTestRenderer | undefined
const ref = createRef<HTMLElement>()
function Text({ item = message, sourceRef = source.sourceRef, onMentionClick }: {
  item?: ArkmeTimelineItem; sourceRef?: string; onMentionClick?: () => void
}) {
  const members = useReadMentionMembers(item.itemUid, sourceRef)
  return <ArkmeRichText text={item.textContent} highlightMentions mentionTargets={item.mentions}
    readMentionMembers={members} {...(onMentionClick === undefined ? {} : { onMentionClick })} />
}
const render = (item = message, src = source) => <ArkmeMentionReadProvider source={src} item={item} elementRef={ref}>
  <Text item={item} sourceRef={src.sourceRef} />
</ArkmeMentionReadProvider>
const checks = () => renderer!.root.findAllByProps({ 'data-arkme-mention-read': 'true' })
const detailCalls = () => read.mock.calls.filter(([operation]) => operation === 'source.read-receipts.detail')

beforeEach(() => {
  vi.useFakeTimers()
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
  arkmeMessageReadReceipts.activateAccount(42, 'test:42')
  read.mockImplementation(async (operation: string) => {
    if (operation === 'source.read-receipts.detail') return detail
    if (operation === 'source.read-receipts.summary-list') return { sourceRef: source.sourceRef,
      conversationKind: 'group_chat', items: [{ itemUid: 'msg', sequence: 8, readCount: 1, unreadCount: 1, totalMemberCount: 2, status: 'partially_read' }] }
    throw new Error(`unexpected ${operation}`)
  })
})
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
  arkmeMessageReadReceipts.activateAccount(undefined)
  read.mockReset(); vi.unstubAllGlobals(); vi.useRealTimers()
})

describe('inline mention read receipts', () => {
  it.each([undefined, 'pending-message'])('handles a pending message without a receipt scope (%s)', async itemUid => {
    function PendingMessage() {
      const members = useReadMentionMembers(itemUid, undefined)
      return <span data-read-count={members.size}>等待发送</span>
    }
    await act(async () => { renderer = create(<PendingMessage />) })
    expect(renderer!.root.findByType('span').props['data-read-count']).toBe(0)
    expect(detailCalls()).toHaveLength(0)
  })

  it('matches stable member identity, not nickname or the message aggregate', async () => {
    await act(async () => { renderer = create(render()) })
    expect(checks()).toHaveLength(1)
    expect(checks()[0]!.parent!.children[0]).toBe('@同名')
    expect(checks()[0]!.props).toMatchObject({ 'aria-label': '@同名 已读', style: { width: 12, height: 12 } })
    expect(detailCalls()).toHaveLength(1)
    expect(detailCalls()[0]![1]).toMatchObject({ itemUid: 'msg', sequence: 8, basicOnly: true })
  })

  it('uses the private receipt circle/check at the mention bottom-right without affecting line height', async () => {
    await act(async () => { renderer = create(render()) })
    const badge = checks()[0]!
    expect(badge.parent!.props.style).toMatchObject({ position: 'relative', whiteSpace: 'nowrap', paddingRight: 14 })
    expect(badge.props.style).toMatchObject({ position: 'absolute', right: 0, bottom: 0,
      width: 12, height: 12, pointerEvents: 'none', userSelect: 'none' })
    expect(badge.findByType(ArkmeReadReceiptIcon).props.checked).toBe(true)
    expect(badge.findByType('svg').props).toMatchObject({ width: 12, height: 12, viewBox: '0 0 12 12',
      'aria-hidden': true, style: { color: arkmeTheme.text, opacity: 0.16 } })
    expect(badge.findAllByType('circle')).toHaveLength(1)
    expect(badge.findAllByType('path')).toHaveLength(1)
  })

  it('refreshes both individual states on receipt invalidation without another click', async () => {
    await act(async () => { renderer = create(render()) })
    read.mockResolvedValue({ ...detail, readCount: 2, unreadCount: 0,
      items: detail.items.map(member => ({ ...member, readStatus: 'read' })) })
    await act(async () => { arkmeMessageReadReceipts.invalidate('group-key', 8); await vi.advanceTimersByTimeAsync(180) })
    expect(checks()).toHaveLength(2)
  })

  it('wires checks into real plain-text and image-message content and preserves mention clicks', async () => {
    const click = vi.fn()
    await act(async () => { renderer = create(<ArkmeMentionReadProvider source={source} item={message} elementRef={ref}>
      <ArkmeMessageContent item={message} sourceRef={source.sourceRef} highlightMentions onMentionClick={click} />
    </ArkmeMentionReadProvider>) })
    expect(checks()).toHaveLength(1)
    checks()[0]!.parent!.props.onClick({ preventDefault() {}, stopPropagation() {} })
    expect(click).toHaveBeenCalledWith('@同名', expect.objectContaining({ memberRef: 'person-b' }))
    await act(async () => { renderer!.update(<ArkmeMentionReadProvider source={source} item={message} elementRef={ref}>
      <ArkmeMessageContent item={{ ...message, contentBlocks: [{ mediaRef: 'image', kind: 'image', fileName: 'a.png', mimeType: 'image/png', size: 1, sortOrder: 0 }] }}
        sourceRef={source.sourceRef} highlightMentions />
    </ArkmeMentionReadProvider>) })
    expect(checks()).toHaveLength(1)
  })

  it.each(['@同名 **@同名** 内容', '前言 &amp; 内容\n\n@同名 **@同名**', '`@同名` [@同名](https://example.com) @同名 **@同名**'])('preserves structured identity through Markdown source offsets: %s', async text => {
    const first = text.lastIndexOf('@同名', text.lastIndexOf('@同名') - 1)
    const item: ArkmeTimelineItem = { ...message, textFormat: 'markdown', textContent: text, mentions: [
      { ...mentions[0]!, startIndex: first }, { ...mentions[1]!, startIndex: text.lastIndexOf('@同名') },
    ] }
    const click = vi.fn()
    await act(async () => { renderer = create(<ArkmeMentionReadProvider source={source} item={item} elementRef={ref}>
      <ArkmeMessageContent item={item} sourceRef={source.sourceRef} highlightMentions onMentionClick={click} />
    </ArkmeMentionReadProvider>) })
    expect(checks()).toHaveLength(1)
    expect(checks()[0]!.parent!.children[0]).toBe('@同名')
    checks()[0]!.parent!.props.onClick({ preventDefault() {}, stopPropagation() {} })
    expect(click).toHaveBeenCalledWith('@同名', expect.objectContaining({ memberRef: 'person-b' }))
  })

  it.each([
    [{ ...message, isMe: false }, source],
    [message, { ...source, kind: 'private_chat' as const }],
    [{ ...message, sequence: 0 }, source],
    [{ ...message, status: 2 }, source],
    [{ ...message, mentions: [] }, source],
    [{ ...message, mentions: [{ ...mentions[0]!, kind: 'all' as const }] }, source],
    [{ ...message, mentions: [{ ...mentions[0]!, kind: 'bot' as const }] }, source],
  ])('does not request or show receipts outside eligible outgoing member mentions (%#)', async (item, src) => {
    await act(async () => { renderer = create(render(item, src)) })
    expect(checks()).toHaveLength(0)
    expect(detailCalls()).toHaveLength(0)
  })

  it('does not leak truth into a different message or conversation in a nested detail', async () => {
    await act(async () => { renderer = create(<ArkmeMentionReadProvider source={source} item={message} elementRef={ref}>
      <Text item={{ ...message, itemUid: 'other' }} /><Text sourceRef="other-group" />
    </ArkmeMentionReadProvider>) })
    expect(checks()).toHaveLength(0)
  })

  it('hides unknown states and recovers a transient detail failure with unchanged aggregate', async () => {
    read.mockRejectedValueOnce(new Error('offline'))
    await act(async () => { renderer = create(render()) })
    expect(checks()).toHaveLength(0)
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(checks()).toHaveLength(1)
    expect(detailCalls()).toHaveLength(2)
  })

  it('clears checks immediately at logout and ignores a late response', async () => {
    let resolve!: (value: ArkmeMessageReadReceiptDetail) => void
    read.mockImplementation(() => new Promise(done => { resolve = done }))
    await act(async () => { renderer = create(render()) })
    await act(async () => { arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' }); arkmeMessageReadReceipts.activateAccount(undefined) })
    await act(async () => { resolve(detail) })
    expect(checks()).toHaveLength(0)
  })

  it('clears existing truth at an account switch, before the new account request completes', async () => {
    await act(async () => { renderer = create(render()) })
    expect(checks()).toHaveLength(1)
    read.mockImplementation(() => new Promise(() => {}))
    await act(async () => {
      arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 43 })
      arkmeMessageReadReceipts.activateAccount(43, 'test:43')
    })
    expect(checks()).toHaveLength(0)
  })

  it.each(['plain', 'markdown'])('does not append the read tooltip to copied %s text or HTML', async format => {
    const markup = renderToStaticMarkup(<ArkmeRichText text="@同名 内容" highlightMentions
      mentionTargets={[mentions[0]!]} readMentionMembers={new Set(['person-a'])} />)
    const dom = new JSDOM(`<span id="message">${markup}</span>`)
    try {
      const element = dom.window.document.getElementById('message')!
      const range = dom.window.document.createRange()
      range.selectNodeContents(element)
      dom.window.getSelection()!.addRange(range)
      await act(async () => { renderer = create(format === 'plain' ? <ArkmeRichText text="@同名 内容" /> : <ArkmeMarkdownBody text="@同名 内容" />) })
      const setData = vi.fn(), preventDefault = vi.fn()
      renderer!.root.findAll(node => (node.type === 'span' || node.type === 'div') && node.props.onCopy)[0]!.props.onCopy({
        defaultPrevented: false, currentTarget: element, clipboardData: { setData }, preventDefault,
      })
      expect(setData).toHaveBeenCalledWith('text/plain', '@同名 内容')
      const copiedHtml = setData.mock.calls.find(([kind]) => kind === 'text/html')?.[1]
      expect(copiedHtml).toBeDefined()
      const copied = JSDOM.fragment(copiedHtml)
      expect(copied.textContent).toBe('@同名 内容')
      expect(copied.querySelector('[data-arkme-mention-read], svg')).toBeNull()
      expect(copiedHtml).not.toContain('已读')
      expect(preventDefault).toHaveBeenCalledOnce()
    } finally { dom.window.close() }
  })

  it('loads only visible foreground mentions and resumes after visibility changes', async () => {
    let intersect!: (entries: unknown[]) => void
    let visibility!: () => void
    const element = {} as HTMLElement
    const elementRef = { current: element }
    const doc = { visibilityState: 'visible', addEventListener: vi.fn((_event, callback) => { visibility = callback }), removeEventListener: vi.fn() }
    vi.stubGlobal('document', doc)
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: typeof intersect) { intersect = callback }
      observe() {} disconnect() {}
    })
    await act(async () => { renderer = create(<ArkmeMentionReadProvider source={source} item={message} elementRef={elementRef}><Text /></ArkmeMentionReadProvider>) })
    expect(detailCalls()).toHaveLength(0)
    await act(async () => { intersect([{ target: element, isIntersecting: true }]) })
    expect(checks()).toHaveLength(1)
    await act(async () => { doc.visibilityState = 'hidden'; visibility(); arkmeMessageReadReceipts.invalidate('group-key', 8); await vi.advanceTimersByTimeAsync(500) })
    expect(detailCalls()).toHaveLength(1)
    await act(async () => { doc.visibilityState = 'visible'; visibility() })
    expect(detailCalls()).toHaveLength(2)
  })
})
