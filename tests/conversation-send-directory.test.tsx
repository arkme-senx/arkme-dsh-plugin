import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeSourceItem, ArkmeTimelineItem } from '../src/types.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))

vi.mock('../src/client/api.js', () => ({
  callArkme: mocks.callArkme,
  ArkmeClientError: class ArkmeClientError extends Error {
    body = { message: this.message }
  },
}))

import { ArkmeSurface } from '../src/client/ArkmeSidebar.js'
import { ArkmeRichComposerInput } from '../src/client/ArkmeRichComposerInput.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeChatDirectory } from '../src/client/chat-directory-store.js'
import { arkmeComposerDraftStore } from '../src/client/composer-draft-store.js'
import { arkmeMessageReadReceipts } from '../src/client/message-read-receipt-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'

const target: ArkmeSourceItem = {
  sourceRef: 'source-harness', sourceKey: 'chat:harness', kind: 'private_chat', displayName: 'Harness4',
  latestPreview: '@狗才 1', activeAtMillis: 22, unreadCount: 0, latestSequence: 8,
}
const other: ArkmeSourceItem = {
  sourceRef: 'source-other', sourceKey: 'chat:other', kind: 'private_chat', displayName: '其他会话',
  latestPreview: '稍新的消息', activeAtMillis: 40, unreadCount: 1, latestSequence: 4,
}

describe('conversation send directory projection', () => {
  let renderer: ReactTestRenderer | undefined
  let timeline: ArkmeTimelineItem[]

  beforeEach(() => {
    timeline = []
    vi.spyOn(Date, 'now').mockReturnValue(48)
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('crypto', { randomUUID: vi.fn()
      .mockReturnValueOnce('record-new')
      .mockReturnValueOnce('relation-new') })
    arkmeComposerDraftStore.clearAccount(42)
    arkmeChatDirectory.clear()
    arkmeChatDirectory.activateAccount(42)
    arkmeChatDirectory.publish([other, target])
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    arkmeMessageReadReceipts.activateAccount(42)
    arkmeUi.selectSource(target)
    mocks.callArkme.mockReset()
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'user.profile') return {
        profile: {
          userId: 42, displayName: '狗才', nickname: '狗才', avatarRef: '', arkmeId: 'doge', accountType: 1,
          createdAt: 1, bindings: { apple: false, wechat: true, google: false }, contact: {},
        },
        cachedAtMillis: 1,
        revision: 1,
      }
      if (operation === 'source.members') return { source: target, items: [], total: 0, activeCount: 0 }
      if (operation === 'source.timeline') return { source: target, items: timeline, hasMore: false }
      if (operation === 'source.interwoven-moments') return {
        state: 'disabled', moments: [], preparedAtMillis: 48,
      }
      if (operation === 'source.send-text') return {
        sourceRef: target.sourceRef, itemUid: 'record-new', status: 1, sequence: 9, localState: 'synced',
      }
      throw new Error(`unexpected operation ${operation}`)
    })
  })

  afterEach(async () => {
    await act(async () => { renderer?.unmount() })
    renderer = undefined
    arkmeComposerDraftStore.clearAccount(42)
    arkmeChatDirectory.clear()
    arkmeMessageReadReceipts.activateAccount(undefined)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('updates and reorders the left conversation row when a send succeeds', async () => {
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
    })
    const composer = renderer!.root.findByType(ArkmeRichComposerInput)
    await act(async () => {
      composer.props.onTextChange('测试')
      await Promise.resolve()
    })
    const sendButton = renderer!.root.findByProps({ 'aria-label': '发送消息' })
    await act(async () => {
      sendButton.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(arkmeChatDirectory.getSnapshot().sources.map(source => source.sourceRef))
      .toEqual(['source-harness', 'source-other'])
    expect(arkmeChatDirectory.getSnapshot().sources[0]).toMatchObject({
      latestPreview: '测试', activeAtMillis: 48, unreadCount: 0, latestSequence: 9,
    })
    expect(renderer!.root.findByProps({ 'data-arkme-read-receipt-indicator': 'unread' })).toBeDefined()
  })

  it('keeps the read receipt next to a forwarded card while opening its complete transcript detail', async () => {
    timeline = [{
      itemUid: 'forward-receipt', sequence: 8, senderName: '我', isMe: true, sendAtMillis: 1,
      title: '', textContent: '', status: 1,
      forwardRecords: {
        title: '会议录音', createdAtMillis: 1, summaryLines: ['甲：第一段', '乙：第二段', '乙：第三段', '甲：第四段'],
        items: [{
          senderName: '录音作者', sendAtMillis: 1, title: '', textContent: '',
          segments: ['甲', '乙', '乙', '甲'].map((speakerName, index) => ({
            speakerName, textContent: `完整转写${index + 1}`, startMillis: index * 1000, endMillis: (index + 1) * 1000,
          })),
        }],
      },
    }]
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
    })
    const line = renderer!.root.findByProps({ 'data-arkme-message-content-line': 'forward-receipt' })
    const bubble = line.findByProps({ 'aria-label': '打开快记详情' })
    expect(bubble.props['data-arkme-message-direction']).toBe('self')
    expect(line.findAllByProps({ 'data-arkme-read-receipt': 'unknown' })).toHaveLength(1)
    expect(bubble.findAllByProps({ 'data-arkme-read-receipt': 'unknown' })).toHaveLength(0)
    expect(JSON.stringify(renderer!.toJSON())).toContain('完整转写3')
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('完整转写4')

    class MediaControl {
      closest(selector: string) { return selector.includes('input') ? this : null }
    }
    vi.stubGlobal('Element', MediaControl)
    act(() => { bubble.props.onClick({ target: new MediaControl() }) })
    expect(renderer!.root.findAllByProps({ 'data-arkme-note-detail': 'true' })).toHaveLength(0)

    vi.stubGlobal('HTMLElement', class {})
    vi.stubGlobal('document', { activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const trigger = {}
    const preventDefault = vi.fn()
    await act(async () => {
      bubble.props.onKeyDown({ key: 'Enter', target: trigger, currentTarget: trigger, preventDefault })
    })
    expect(preventDefault).toHaveBeenCalledOnce()
    const detail = renderer!.root.findByProps({ 'data-arkme-note-detail': 'true' })
    expect(detail.findAllByProps({ 'data-arkme-forward-segment': 'true' })).toHaveLength(4)
    expect(detail.findAll(node => node.type === 'span' && node.props['aria-label'] === '转写说话人头像')).toHaveLength(4)
    expect(JSON.stringify(renderer!.toJSON())).toContain('完整转写4')
    await act(async () => { detail.findByProps({ 'aria-label': '关闭详情' }).props.onClick() })
    expect(renderer!.root.findAllByProps({ 'data-arkme-note-detail': 'true' })).toHaveLength(0)
    expect(renderer!.root.findByProps({ 'data-arkme-message-content-line': 'forward-receipt' })).toBeDefined()
  })

  it('keeps the previous directory summary when sending fails', async () => {
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
    })
    const composer = renderer!.root.findByType(ArkmeRichComposerInput)
    await act(async () => {
      composer.props.onTextChange('测试')
      await Promise.resolve()
    })
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.send-text') throw new Error('发送失败')
      throw new Error(`unexpected operation ${operation}`)
    })
    const sendButton = renderer!.root.findByProps({ 'aria-label': '发送消息' })
    await act(async () => {
      sendButton.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(arkmeChatDirectory.getSnapshot().sources.map(source => source.sourceRef))
      .toEqual(['source-other', 'source-harness'])
    expect(arkmeChatDirectory.getSnapshot().sources[1]).toMatchObject({
      latestPreview: '@狗才 1', activeAtMillis: 22, unreadCount: 0, latestSequence: 8,
    })
  })
})
