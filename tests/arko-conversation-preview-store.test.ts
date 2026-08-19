import { describe, expect, it, vi } from 'vitest'
import {
  ArkmeArkoConversationPreviewStore,
  latestArkoConversationPreview,
  latestArkoConversationPreviewInDisplayOrder,
  normalizeArkoConversationPreview,
} from '../src/client/arko-conversation-preview-store.js'
import type { ArkmeArkoHistoryItem } from '../src/types.js'

function historyItem(messageId: number, text: string, createdAtMillis: number): ArkmeArkoHistoryItem {
  return {
    messageId,
    sessionId: 88,
    role: messageId % 2 === 0 ? 'assistant' : 'user',
    text,
    reasoning: '',
    createdAtMillis,
    status: 1,
    createdRecordUids: [],
  }
}

describe('Arko conversation preview store', () => {
  it('selects the newest non-empty message and normalizes it to one line', () => {
    expect(normalizeArkoConversationPreview('  第一行\n  第二行  ')).toBe('第一行 第二行')
    expect(latestArkoConversationPreview([
      { key: 'older', text: '较早消息', createdAtMillis: 10 },
      { key: 'empty-assistant', text: '', createdAtMillis: 30 },
      { key: 'latest-visible', text: ' 最新可见消息 ', createdAtMillis: 20 },
    ])).toMatchObject({ key: 'latest-visible', text: '最新可见消息' })
  })

  it('uses numeric message ids when server messages share the same second', () => {
    expect(latestArkoConversationPreview([
      { key: 'history:9999', messageId: 9999, text: '较早消息', createdAtMillis: 1000 },
      { key: 'history:10000', messageId: 10000, text: '最新消息', createdAtMillis: 1000 },
    ])).toMatchObject({ messageId: 10000, text: '最新消息' })
  })

  it('uses the last visible surface message instead of comparing local and server clocks', () => {
    expect(latestArkoConversationPreviewInDisplayOrder([
      { key: 'local-user', text: '用户问题', createdAtMillis: 2000 },
      { key: 'history:100', messageId: 100, text: 'AI 最终回复', createdAtMillis: 1000 },
      { key: 'pending', text: '', createdAtMillis: 3000 },
    ])).toMatchObject({ key: 'history:100', text: 'AI 最终回复' })
  })

  it('lets the current surface replace an optimistic preview with an authoritative reply', () => {
    const store = new ArkmeArkoConversationPreviewStore()
    store.activateUser(1001)
    store.setLatestFromSurface(1001, [{ key: 'local-user', text: '刚发送的消息', createdAtMillis: 2000 }])
    store.setLatestFromSurface(1001, [
      { key: 'history:101', messageId: 101, text: '刚发送的消息', createdAtMillis: 1000 },
      { key: 'history:102', messageId: 102, text: 'AI 最终回复', createdAtMillis: 1000 },
    ])

    expect(store.getSnapshot()).toMatchObject({ latestPreview: 'AI 最终回复', latestMessageId: 102 })
  })

  it('ignores a history response when the surface changed after the request started', () => {
    const store = new ArkmeArkoConversationPreviewStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.activateUser(1001)
    const request = store.beginHistoryRequest(1001)
    expect(request).toBeDefined()
    store.setLatestFromSurface(1001, [{ key: 'local-new', text: '刚发送的消息', createdAtMillis: 200 }])
    const applied = request === undefined
      ? true
      : store.setLatestFromHistory(request, [historyItem(100, '旧历史', 100)])

    expect(applied).toBe(false)
    expect(store.getSnapshot()).toMatchObject({
      userId: 1001,
      latestPreview: '刚发送的消息',
      latestAtMillis: 200,
    })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('accepts only the newest history request and clears a now-empty history', () => {
    const store = new ArkmeArkoConversationPreviewStore()
    store.activateUser(1001)
    const olderRequest = store.beginHistoryRequest(1001)
    const latestRequest = store.beginHistoryRequest(1001)
    expect(olderRequest).toBeDefined()
    expect(latestRequest).toBeDefined()

    if (olderRequest === undefined || latestRequest === undefined) return
    expect(store.setLatestFromHistory(olderRequest, [historyItem(101, '迟到结果', 100)])).toBe(false)
    expect(store.setLatestFromHistory(latestRequest, [historyItem(102, '当前结果', 200)])).toBe(true)
    const clearRequest = store.beginHistoryRequest(1001)
    expect(clearRequest).toBeDefined()
    if (clearRequest === undefined) return
    expect(store.setLatestFromHistory(clearRequest, [])).toBe(true)
    expect(store.getSnapshot()).toEqual({ revision: 3, userId: 1001 })
  })

  it('isolates previews when the authenticated account changes', () => {
    const store = new ArkmeArkoConversationPreviewStore()
    store.activateUser(1001)
    store.setLatestFromSurface(1001, [{ key: 'account-a', text: '账号 A 消息', createdAtMillis: 100 }])
    store.activateUser(2002)
    store.setLatestFromSurface(1001, [{ key: 'late-a', text: '账号 A 迟到消息', createdAtMillis: 300 }])

    expect(store.getSnapshot()).toEqual({ revision: 3, userId: 2002 })
  })
})
