// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { ArkmeMessageReadReceiptSummaryList, ArkmeSourceItem, ArkmeTimelineItem } from '../src/types.js'
import { ArkmeMessageReadReceipt } from '../src/client/ArkmeMessageReadReceipt.js'
import { arkmeMessageReadReceipts as store } from '../src/client/message-read-receipt-store.js'
import { ArkmeConversationMessageMergeOwner, conversationMessageDefaultUnread } from '../src/client/conversation-message-merge.js'

const { read } = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: read }))
afterEach(() => { store.activateAccount(undefined); vi.useRealTimers(); vi.unstubAllGlobals(); read.mockReset() })

it.each(['private_chat', 'group_chat'] as const)('keeps a new %s message unread through refreshes, then preserves confirmed read truth', async kind => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', undefined)
  store.activateAccount(42, 'test:42')
  const source: ArkmeSourceItem = { sourceRef: 'ref', sourceKey: 'key', kind, displayName: '会话' }
  const target = { sourceRef: 'ref', sourceKey: 'key', conversationKind: kind, itemUid: 'sent', sequence: 8 }
  let reply = Promise.withResolvers<ArkmeMessageReadReceiptSummaryList>()
  read.mockImplementation((operation: string) => {
    expect(operation).toBe('source.read-receipts.summary-list')
    reply = Promise.withResolvers<ArkmeMessageReadReceiptSummaryList>()
    return reply.promise
  })
  const response = (readCount: number, totalMemberCount = 1): ArkmeMessageReadReceiptSummaryList => ({
    sourceRef: 'ref', conversationKind: kind,
    items: [{ itemUid: 'sent', sequence: 8, readCount, unreadCount: totalMemberCount - readCount,
      totalMemberCount, status: readCount ? 'read' : 'unread' }],
  })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const owner = new ArkmeConversationMessageMergeOwner()
  const local: ArkmeTimelineItem = owner.begin('key', { itemUid: 'sent', isMe: true, senderName: '我', sendAtMillis: 1, status: 0, title: '', textContent: '消息' })
  const indicator = () => host.querySelector('[data-arkme-read-receipt-indicator]')?.getAttribute('data-arkme-read-receipt-indicator')
  try {
    await act(async () => root.render(<ArkmeMessageReadReceipt source={source} item={local} defaultUnread={conversationMessageDefaultUnread(local)} />))
    expect(indicator()).toBe('unread')
    expect(read).not.toHaveBeenCalled()
    const slot = host.querySelector('[data-arkme-read-receipt]')
    // A live event may provide the sequence before the HTTP send acknowledgement.
    const canonical = owner.merge('key', [{ ...JSON.parse(JSON.stringify(local)), status: 1, sequence: 8, timelineEventId: 'event' }])[0]!
    await act(async () => root.render(<ArkmeMessageReadReceipt source={source} item={canonical} defaultUnread={conversationMessageDefaultUnread(canonical)} />))
    expect(indicator()).toBe('unread')
    await act(async () => vi.advanceTimersByTimeAsync(180))
    await act(async () => store.provision(target))
    expect(indicator()).toBe('unread')
    await act(async () => reply.resolve(response(0, 0)))
    expect(indicator()).toBe('unread')
    expect(store.get(target)?.provisionalUnread).toBe(true)
    await act(async () => store.invalidate('key', 8))
    expect(indicator()).toBe('unread')
    await act(async () => vi.advanceTimersByTimeAsync(180))
    expect(indicator()).toBe('unread')
    await act(async () => reply.reject(new Error('offline')))
    expect(indicator()).toBe('unread')
    expect(store.get(target)?.provisionalUnread).toBe(true)
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(indicator()).toBe('unread')
    await act(async () => reply.resolve(response(0)))
    expect(indicator()).toBe('unread')
    await act(async () => { store.invalidate('key', 8); await vi.advanceTimersByTimeAsync(180) })
    expect(indicator()).toBe('unread')
    await act(async () => reply.resolve(response(1)))
    expect(indicator()).toBe('all-read')
    await act(async () => store.provision(target))
    expect(indicator()).toBe('all-read')
    await act(async () => { store.invalidate('key', 8); await vi.advanceTimersByTimeAsync(180) })
    expect(indicator()).toBe('all-read')
    await act(async () => reply.resolve(response(0, 0)))
    expect(indicator()).toBe('all-read')
    expect(host.querySelector('[data-arkme-read-receipt]')).toBe(slot)
    expect(read).toHaveBeenCalledTimes(5)
  } finally { await act(async () => root.unmount()); host.remove() }
})
