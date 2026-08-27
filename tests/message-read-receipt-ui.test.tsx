import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ArkmeMessageReadReceiptSummary,
  ArkmeSourceItem,
  ArkmeTimelineItem,
} from '../src/types.js'

const receiptMock = vi.hoisted(() => ({
  entry: undefined as undefined | { status: string; summary?: ArkmeMessageReadReceiptSummary },
  store: {
    subscribe: () => () => undefined,
    getSnapshot: () => 1,
    register: () => () => undefined,
    setVisible: vi.fn(),
    get: () => receiptMock.entry,
    retry: vi.fn(),
    detail: vi.fn(),
  },
}))

vi.mock('../src/client/message-read-receipt-store.js', () => ({
  arkmeMessageReadReceipts: receiptMock.store,
}))

import {
  ArkmeMessageReadReceipt,
  ArkmeMessageReadReceiptLine,
  arkmeMessageReadReceiptPanelLayout,
} from '../src/client/ArkmeMessageReadReceipt.js'

function source(kind: 'private_chat' | 'group_chat'): ArkmeSourceItem {
  return {
    sourceRef: `source-${kind}`, sourceKey: `key-${kind}`, kind, displayName: '会话',
    activeAtMillis: 1, unreadCount: 0,
  }
}

function message(): ArkmeTimelineItem {
  return {
    itemUid: 'item-8', sequence: 8, senderName: '我', isMe: true, sendAtMillis: 1,
    title: '', textContent: '消息', status: 1, displayKind: 0,
  }
}

function summary(overrides: Partial<ArkmeMessageReadReceiptSummary>): ArkmeMessageReadReceiptSummary {
  return {
    itemUid: 'item-8', sequence: 8, readCount: 0, unreadCount: 1,
    totalMemberCount: 1, status: 'unread', ...overrides,
  }
}

let renderer: ReactTestRenderer | undefined
afterEach(() => {
  act(() => { renderer?.unmount() })
  renderer = undefined
  receiptMock.entry = undefined
  vi.clearAllMocks()
})

describe('Arkme message read receipt UI', () => {
  it('flips the detail panel above a lower-edge trigger using its measured height', () => {
    expect(arkmeMessageReadReceiptPanelLayout(
      { left: 900, right: 918, top: 620, bottom: 660, width: 18, height: 40 },
      { width: 1_000, height: 700 },
      170,
    )).toEqual({
      left: 632,
      top: 440,
      arrowPlacement: 'bottom',
      arrowOffset: 260,
    })
  })

  it('keeps a short flipped panel adjacent to the same lower-edge trigger', () => {
    expect(arkmeMessageReadReceiptPanelLayout(
      { left: 900, right: 918, top: 620, bottom: 660, width: 18, height: 40 },
      { width: 1_000, height: 700 },
      54,
    )).toMatchObject({ top: 556, arrowPlacement: 'bottom' })
  })

  it('renders private read truth without exposing member detail', () => {
    receiptMock.entry = { status: 'ready', summary: summary({ readCount: 1, unreadCount: 0, status: 'read' }) }
    act(() => { renderer = create(<ArkmeMessageReadReceipt source={source('private_chat')} item={message()} />) })

    expect(renderer.root.findByProps({ 'aria-label': '已读' })).toBeDefined()
    expect(renderer.root.findByProps({ 'data-arkme-read-receipt-indicator': 'all-read' })).toBeDefined()
    expect(renderer.root.findAllByType('button')).toHaveLength(0)
    expect(renderer.toJSON()).toMatchObject({ props: { 'data-arkme-read-receipt': 'ready' } })
  })

  it('renders group partial progress as the member detail entry point', () => {
    receiptMock.entry = {
      status: 'ready',
      summary: summary({ readCount: 2, unreadCount: 3, totalMemberCount: 5, status: 'partially_read' }),
    }
    act(() => { renderer = create(<ArkmeMessageReadReceipt source={source('group_chat')} item={message()} />) })

    const button = renderer.root.findByProps({ 'aria-label': '已读 2 / 未读 3，查看成员已读详情' })
    expect(button.type).toBe('button')
    expect(renderer.root.findByProps({ 'data-arkme-read-receipt-indicator': 'partial-read' })).toBeDefined()
    expect(button.findByType('span').findByProps({ children: 2 })).toBeDefined()
    expect(JSON.stringify(renderer.toJSON())).not.toContain('2/5 已读')
  })

  it('does not misreport unknown zero counts as unread', () => {
    receiptMock.entry = {
      status: 'ready',
      summary: summary({ readCount: 0, unreadCount: 0, totalMemberCount: 0, status: 'unread' }),
    }
    act(() => { renderer = create(<ArkmeMessageReadReceipt source={source('group_chat')} item={message()} />) })

    expect(renderer.root.findByProps({ 'aria-label': '已读状态同步中' })).toBeDefined()
    expect(renderer.root.findByProps({ 'data-arkme-read-receipt-indicator': 'placeholder' })).toBeDefined()
    expect(renderer.root.findAllByType('button')).toHaveLength(0)
  })

  it('shows a provisional unread marker immediately after a successful send', () => {
    receiptMock.entry = { status: 'provisional' }
    act(() => { renderer = create(<ArkmeMessageReadReceipt source={source('private_chat')} item={message()} />) })

    const status = renderer.root.findByProps({ 'aria-label': '未读' })
    expect(status).toBeDefined()
    expect(renderer.root.findByProps({ 'data-arkme-read-receipt-indicator': 'unread' })).toBeDefined()
    expect(status.children).toHaveLength(1)
  })

  it('renders summary failures as a compact retry target', () => {
    receiptMock.entry = { status: 'error' }
    act(() => { renderer = create(<ArkmeMessageReadReceipt source={source('private_chat')} item={message()} />) })

    const retry = renderer.root.findByProps({ 'aria-label': '已读状态同步失败，点击重试' })
    expect(retry.type).toBe('button')
    expect(renderer.root.findByProps({ 'data-arkme-read-receipt-indicator': 'error' })).toBeDefined()
    act(() => { retry.props.onClick() })
    expect(receiptMock.store.retry).toHaveBeenCalledOnce()
  })

  it('caps large partial read counts at 999', () => {
    receiptMock.entry = {
      status: 'ready',
      summary: summary({ readCount: 1200, unreadCount: 1, totalMemberCount: 1201, status: 'partially_read' }),
    }
    act(() => { renderer = create(<ArkmeMessageReadReceipt source={source('group_chat')} item={message()} />) })

    expect(renderer.root.findByProps({ children: 999 })).toBeDefined()
    expect(renderer.root.findAllByProps({ children: 1200 })).toHaveLength(0)
  })

  it('keeps the receipt slot directly adjacent to the own-message bubble', () => {
    receiptMock.entry = {
      status: 'ready',
      summary: summary({ readCount: 2, unreadCount: 3, totalMemberCount: 5, status: 'partially_read' }),
    }
    act(() => {
      renderer = create(<ArkmeMessageReadReceiptLine source={source('group_chat')} item={message()}>
        <span data-test-message-bubble="true">消息气泡</span>
      </ArkmeMessageReadReceiptLine>)
    })

    const line = renderer.root.findByProps({ 'data-arkme-message-content-line': 'item-8' })
    expect(line.props.style).toMatchObject({
      display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', maxWidth: '100%',
    })
    expect(line.children).toHaveLength(2)
    expect(line.children[0]?.type).toBe(ArkmeMessageReadReceipt)
    expect(line.children[1]?.props['data-test-message-bubble']).toBe('true')
    expect(line.findByProps({ 'data-arkme-read-receipt': 'ready' })).toBeDefined()
  })
})
