import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeSourceItem, ArkmeTimelineItem } from '../src/types.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))

vi.mock('../src/client/api.js', () => ({
  callArkme: mocks.callArkme,
  ArkmeClientError: class ArkmeClientError extends Error {
    constructor(readonly body: { code: string; message: string; retryable: boolean }) {
      super(body.message)
    }
  },
}))

import { ArkmeSurface } from '../src/client/ArkmeSidebar.js'
import { ArkmeClientError } from '../src/client/api.js'
import { ArkmeRichComposerInput } from '../src/client/ArkmeRichComposerInput.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeChatDirectory, arkmeChatTimelineDelta } from '../src/client/chat-directory-store.js'
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
const group: ArkmeSourceItem = {
  sourceRef: 'source-group', sourceKey: 'chat:group', kind: 'group_chat', displayName: '群聊',
  latestPreview: 'message-784', activeAtMillis: 48, unreadCount: 0, latestSequence: 784,
}

describe('conversation send directory projection', () => {
  let renderer: ReactTestRenderer | undefined
  let timeline: ArkmeTimelineItem[]
  let copiedQuickLinkExtensionText = ''

  beforeEach(() => {
    timeline = []
    copiedQuickLinkExtensionText = ''
    vi.spyOn(Date, 'now').mockReturnValue(48)
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      open: vi.fn(),
    })
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('crypto', { randomUUID: vi.fn()
      .mockReturnValueOnce('record-new')
      .mockReturnValueOnce('relation-new') })
    arkmeComposerDraftStore.clearAccount(42)
    arkmeChatDirectory.clear()
    arkmeChatTimelineDelta.publish([])
    arkmeChatDirectory.activateAccount(42)
    arkmeChatDirectory.publish([other, target])
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    arkmeMessageReadReceipts.activateAccount(42)
    arkmeUi.selectSource(target)
    mocks.callArkme.mockReset()
    mocks.callArkme.mockImplementation(async (operation: string, params?: {
      sid?: string
      textContent?: string
      recordUid?: string
      targetSourceRef?: string
      directory?: 'root' | 'send_to_self'
    }) => {
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
      if (operation === 'sources.list') return {
        directory: params?.directory ?? 'root',
        items: params?.directory === 'send_to_self' ? [] : [other, target],
        hasMore: false,
      }
      if (operation === 'source.interwoven-moments') return {
        state: 'disabled', moments: [], preparedAtMillis: 48,
      }
      if (operation === 'source.message-copy-link.resolve') return {
        sid: params?.sid ?? 'U2HQgn1RhPJZaFmx',
        displayTitle: '1D3E的快记',
        generatedAtMillis: 1_775_400_000_000,
        accessMode: 'normal',
        sourceSessionUid: 'chat-session-1',
        sourceAnchors: [{
          relationUid: 'rel-parent',
          recordUid: 'parent-record',
          recordOwnerUserId: 42,
          sequence: 8,
        }],
        items: [{
          sourceKind: 'chat_record',
          senderDisplayName: '1D3E',
          senderAvatarUrl: '',
          title: '',
          textContent: 'bot相关接口有点问题，会优化下',
          sendAtMillis: 1_775_399_700_000,
          templateKind: 1,
          displayKind: 0,
          officialMark: 0,
          mediaItems: [],
        }],
        presentation: [{ kind: 'item', itemIndex: 0 }],
        ...(copiedQuickLinkExtensionText === '' ? {} : {
          recordContext: {
            extensionCount: 1,
            extensions: [{
              recordUid: 'record-new',
              level: 2,
              sourceKind: 'record_extension',
              senderDisplayName: '狗才',
              title: '',
              textContent: copiedQuickLinkExtensionText,
              sendAtMillis: 48,
              templateKind: 1,
              displayKind: 0,
              officialMark: 0,
              mediaItems: [],
            }],
          },
        }),
      }
      if (operation === 'source.send-text') return {
        sourceRef: target.sourceRef, itemUid: params?.recordUid ?? 'record-new', status: 1, sequence: 9, localState: 'synced',
      }
      if (operation === 'source.forward-messages') return {
        sourceRef: params?.targetSourceRef ?? other.sourceRef,
        itemUid: params?.recordUid ?? 'forwarded-record',
        status: 1,
        sequence: 5,
        localState: 'synced',
      }
      if (operation === 'source.message-copy-link.extend') {
        copiedQuickLinkExtensionText = params?.textContent ?? '补充想法'
        return {
          sid: params?.sid ?? 'U2HQgn1RhPJZaFmx',
          recordUid: params?.recordUid ?? 'record-new',
          parentRecordUid: 'parent-record',
          status: 1,
          localState: 'synced',
          extension: {
            recordUid: params?.recordUid ?? 'record-new',
            level: 2,
            sourceKind: 'record_extension',
            senderDisplayName: '狗才',
            title: '',
            textContent: copiedQuickLinkExtensionText,
            sendAtMillis: 48,
            templateKind: 1,
            displayKind: 0,
            officialMark: 0,
            mediaItems: [],
          },
        }
      }
      throw new Error(`unexpected operation ${operation}`)
    })
  })

  afterEach(async () => {
    await act(async () => { renderer?.unmount() })
    renderer = undefined
    arkmeComposerDraftStore.clearAccount(42)
    arkmeChatDirectory.clear()
    arkmeChatTimelineDelta.publish([])
    arkmeMessageReadReceipts.activateAccount(undefined)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function openForwardPicker() {
    timeline = [{
      itemUid: 'forward-source', messageActionRef: 'opaque-forward-action',
      senderName: '狗才', isMe: true, sendAtMillis: 1, title: '', textContent: '待转发快记', status: 1,
    }]
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />, {
        createNodeMock: element => element.props.className === 'arkme-conversation-panel'
          ? { getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }) }
          : null,
      })
      await Promise.resolve()
    })
    const bubble = renderer!.root.findByProps({ 'aria-label': '打开快记详情' })
    act(() => {
      bubble.props.onContextMenu({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        clientX: 120,
        clientY: 180,
      })
    })
    const menu = renderer!.root.findByProps({ 'aria-label': '消息操作' })
    await act(async () => {
      menu.findAllByProps({ role: 'menuitem' })[3]!.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    return renderer!.root.findByProps({ 'aria-labelledby': 'arkme-forward-target-title' })
  }

  it('keeps the forward picker mounted while rapid comment changes are deferred', async () => {
    const dialog = await openForwardPicker()
    const targetButton = dialog.findAll(node => node.type === 'button'
      && typeof node.props['aria-pressed'] === 'boolean')[0]!
    act(() => { targetButton.props.onClick() })
    const comment = dialog.findByProps({ 'aria-label': '转发附言' })
    const firstEvent: { currentTarget: { value: string } | null } = { currentTarget: { value: '附' } }
    const secondEvent: { currentTarget: { value: string } | null } = { currentTarget: { value: '附言' } }

    expect(() => {
      act(() => {
        comment.props.onChange(firstEvent)
        firstEvent.currentTarget = null
        comment.props.onChange(secondEvent)
        secondEvent.currentTarget = null
      })
    }).not.toThrow()

    expect(renderer!.root.findByProps({ 'aria-label': '转发附言' }).props.value).toBe('附言')
    expect(renderer!.root.findByProps({ 'aria-labelledby': 'arkme-forward-target-title' })).toBeDefined()
  })

  it('keeps the forward picker mounted while rapid search changes are deferred', async () => {
    await openForwardPicker()
    const search = renderer!.root.findByProps({ 'aria-label': '搜索转发对象' })
    const firstEvent: { currentTarget: { value: string } | null } = { currentTarget: { value: '其' } }
    const secondEvent: { currentTarget: { value: string } | null } = { currentTarget: { value: '其他' } }

    expect(() => {
      act(() => {
        search.props.onChange(firstEvent)
        firstEvent.currentTarget = null
        search.props.onChange(secondEvent)
        secondEvent.currentTarget = null
      })
    }).not.toThrow()

    expect(renderer!.root.findByProps({ 'aria-label': '搜索转发对象' }).props.value).toBe('其他')
    expect(renderer!.root.findByProps({ 'aria-labelledby': 'arkme-forward-target-title' })).toBeDefined()
  })

  it('renders the forward submit button with primary action contrast', async () => {
    const dialog = await openForwardPicker()
    const targetButton = dialog.findAll(node => node.type === 'button'
      && typeof node.props['aria-pressed'] === 'boolean')[0]!
    act(() => { targetButton.props.onClick() })

    expect(renderer!.root.findByProps({ 'aria-label': '发送转发' }).props.style).toMatchObject({
      background: 'var(--dsw-alias-button-primary-fill, #17191c)',
      color: 'var(--dsw-alias-label-primary-inverted, #ffffff)',
    })
  })

  it('removes the forwarding status after a forward succeeds', async () => {
    const dialog = await openForwardPicker()
    const targetButton = dialog.findAll(node => node.type === 'button'
      && typeof node.props['aria-pressed'] === 'boolean')[0]!
    act(() => { targetButton.props.onClick() })

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '发送转发' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(renderer!.root.findAllByProps({ 'aria-labelledby': 'arkme-forward-target-title' })).toHaveLength(0)
    expect(renderer!.root.findByProps({ 'aria-label': '已转发到 1 个对象' })).toBeDefined()
    expect(renderer!.root.findAllByProps({ role: 'status' })).toHaveLength(0)
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

  it('keeps the list mounted and avoids a timeline reload when an AI-polished send advances the selected projection', async () => {
    const previousItem: ArkmeTimelineItem = {
      itemUid: 'message-784', sequence: 784, senderName: '我', isMe: true,
      sendAtMillis: 40, title: '', textContent: '之前的消息', status: 1,
    }
    const polishedItem: ArkmeTimelineItem = {
      itemUid: 'record-new', sequence: 785, senderName: '狗才', isMe: true,
      sendAtMillis: 48, title: '', textContent: '润色后的测试', status: 1,
      aiPolish: { state: 'polished', originalText: '测试', polishedText: '润色后的测试' },
    }
    timeline = [previousItem]
    arkmeChatDirectory.publish([group, other])
    arkmeUi.selectSource(group)
    let timelineCalls = 0
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'user.profile') return {
        profile: {
          userId: 42, displayName: '狗才', nickname: '狗才', avatarRef: '', arkmeId: 'doge', accountType: 1,
          createdAt: 1, bindings: { apple: false, wechat: true, google: false }, contact: {},
        },
        cachedAtMillis: 1, revision: 1,
      }
      if (operation === 'source.members') return { source: group, items: [], total: 0, activeCount: 0 }
      if (operation === 'source.timeline') {
        timelineCalls += 1
        return {
          source: group, items: timeline, hasMore: false,
          aiPolishSettings: {
            sourceRef: group.sourceRef, groupName: group.displayName, enabled: true, canManage: true,
            viewerRole: 3, activeRuleName: '非主流', rules: [], updatedAtMillis: 1,
          },
        }
      }
      if (operation === 'source.send-text') {
        timeline = [previousItem, polishedItem]
        return {
          sourceRef: group.sourceRef, itemUid: polishedItem.itemUid, status: 1,
          sequence: polishedItem.sequence, localState: 'synced', aiPolish: polishedItem.aiPolish,
        }
      }
      throw new Error(`unexpected operation ${operation}`)
    })
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
    })
    const conversationList = () => renderer!.root.find(node => node.type === 'ul'
      && typeof node.props.className === 'string'
      && node.props.className.includes('arkme-conversation-records'))
    const timelineCallsBeforeSend = timelineCalls
    const listBefore = conversationList()
    const previousRowBefore = renderer!.root.findByProps({ 'data-arkme-message-content-line': previousItem.itemUid })
    const unsubscribe = arkmeChatDirectory.subscribe(() => {
      const projected = arkmeChatDirectory.getSnapshot().sources.find(item => item.sourceRef === group.sourceRef)
      if (projected?.latestSequence === polishedItem.sequence
        && arkmeUi.getSnapshot().selectedSource?.latestSequence !== polishedItem.sequence) {
        arkmeUi.selectSource(projected)
      }
    })
    const composer = renderer!.root.findByType(ArkmeRichComposerInput)
    await act(async () => {
      composer.props.onTextChange('测试')
      await Promise.resolve()
    })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '发送消息' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    unsubscribe()

    expect(timelineCalls).toBe(timelineCallsBeforeSend)
    expect(conversationList()).toBe(listBefore)
    expect(renderer!.root.findByProps({ 'data-arkme-message-content-line': previousItem.itemUid })).toBe(previousRowBefore)
    expect(renderer!.root.findByProps({ 'data-arkme-message-content-line': polishedItem.itemUid })).toBeDefined()
  })

  it('keeps one initial timeline request alive when the chat projection changes during loading', async () => {
    const loadedItem: ArkmeTimelineItem = {
      itemUid: 'message-after-reconcile', sequence: 784, senderName: '我', isMe: true,
      sendAtMillis: 48, title: '', textContent: '加载完成', status: 1,
    }
    arkmeChatDirectory.publish([group, other])
    arkmeUi.selectSource(group)
    let timelineCalls = 0
    let resolveTimeline!: (page: unknown) => void
    const pendingTimeline = new Promise(resolve => { resolveTimeline = resolve })
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'user.profile') return {
        profile: {
          userId: 42, displayName: '狗才', nickname: '狗才', avatarRef: '', arkmeId: 'doge', accountType: 1,
          createdAt: 1, bindings: { apple: false, wechat: true, google: false }, contact: {},
        },
        cachedAtMillis: 1,
        revision: 1,
      }
      if (operation === 'source.timeline') {
        timelineCalls += 1
        return await pendingTimeline
      }
      if (operation === 'source.ai-polish.settings') return {
        sourceRef: group.sourceRef, groupName: group.displayName, enabled: true, canManage: true,
        viewerRole: 3, activeRuleName: '非主流', rules: [], updatedAtMillis: 1,
      }
      if (operation === 'source.ai-polish.notices') return []
      throw new Error(`unexpected operation ${operation}`)
    })

    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
    })
    await act(async () => {
      arkmeUi.chatChanged()
      await Promise.resolve()
    })

    expect(timelineCalls).toBe(1)
    await act(async () => {
      resolveTimeline({ source: group, items: [loadedItem], hasMore: false })
      await pendingTimeline
      await Promise.resolve()
    })
    expect(renderer!.root.findByProps({ 'data-arkme-message-content-line': loadedItem.itemUid })).toBeDefined()
    expect(renderer!.root.findAllByProps({ 'aria-label': '正在加载会话内容' })).toHaveLength(0)
  })

  it('recovers the initial timeline after a transient browser transport failure', async () => {
    const loadedItem: ArkmeTimelineItem = {
      itemUid: 'message-after-retry', sequence: 784, senderName: '我', isMe: true,
      sendAtMillis: 48, title: '', textContent: '重试后加载完成', status: 1,
    }
    arkmeChatDirectory.publish([group, other])
    arkmeUi.selectSource(group)
    let timelineCalls = 0
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'user.profile') return {
        profile: {
          userId: 42, displayName: '狗才', nickname: '狗才', avatarRef: '', arkmeId: 'doge', accountType: 1,
          createdAt: 1, bindings: { apple: false, wechat: true, google: false }, contact: {},
        },
        cachedAtMillis: 1, revision: 1,
      }
      if (operation === 'source.timeline') {
        timelineCalls += 1
        if (timelineCalls === 1) throw new TypeError('Failed to fetch')
        return { source: group, items: [loadedItem], hasMore: false }
      }
      if (operation === 'source.ai-polish.settings') return {
        sourceRef: group.sourceRef, groupName: group.displayName, enabled: true, canManage: true,
        viewerRole: 3, activeRuleName: '非主流', rules: [], updatedAtMillis: 1,
      }
      if (operation === 'source.ai-polish.notices') return []
      throw new Error(`unexpected operation ${operation}`)
    })

    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(timelineCalls).toBe(2)
    expect(renderer!.root.findByProps({ 'data-arkme-message-content-line': loadedItem.itemUid })).toBeDefined()
    expect(renderer!.root.findAllByProps({ 'aria-label': '正在加载会话内容' })).toHaveLength(0)
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('Failed to fetch')
  })

  it('keeps the complete cached group timeline when returning from Harness with a retained realtime delta', async () => {
    timeline = Array.from({ length: 6 }, (_, index): ArkmeTimelineItem => ({
      itemUid: `message-${String(779 + index)}`,
      sequence: 779 + index,
      senderName: '我',
      isMe: true,
      sendAtMillis: 40 + index,
      title: '',
      textContent: `message-${String(779 + index)}`,
      status: 1,
    }))
    arkmeChatDirectory.publish([group, other])
    arkmeUi.selectSource(group)

    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
    })
    const visibleMessageIds = () => renderer!.root
      .findAll(node => typeof node.props['data-arkme-message-content-line'] === 'string')
      .map(node => node.props['data-arkme-message-content-line'])
    expect(visibleMessageIds()).toEqual(timeline.map(item => item.itemUid))

    await act(async () => {
      arkmeChatTimelineDelta.publish([{ sourceRef: group.sourceRef, items: [timeline[5]!] }])
    })
    await act(async () => { arkmeUi.showHarness() })
    await act(async () => {
      arkmeUi.selectSource(group)
      await Promise.resolve()
    })

    expect(visibleMessageIds()).toEqual(timeline.map(item => item.itemUid))
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
    expect(typeof bubble.props.onContextMenu).toBe('function')
    const preventContextDefault = vi.fn()
    const stopContextPropagation = vi.fn()
    act(() => {
      bubble.props.onContextMenu({
        preventDefault: preventContextDefault,
        stopPropagation: stopContextPropagation,
        clientX: 120,
        clientY: 180,
      })
    })
    expect(preventContextDefault).toHaveBeenCalledOnce()
    expect(stopContextPropagation).toHaveBeenCalledOnce()
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

  it('extends the copied quick-link detail record from the footer input', async () => {
    timeline = [{
      itemUid: 'copy-link-message', senderName: '1D3E', isMe: false, sendAtMillis: 1, status: 1,
      title: '', textContent: 'https://jiwo.cc/s/U2HQgn1RhPJZaFmx', templateKind: 1, displayKind: 0,
    }]
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
    })

    const quickLink = renderer!.root.findByProps({ 'data-arkme-inline-link': 'message-copy-link' })
    await act(async () => {
      quickLink.props.onClick({ stopPropagation: vi.fn() })
      await Promise.resolve()
      await Promise.resolve()
    })
    const detail = renderer!.root.findByProps({ 'data-arkme-copy-link-detail': 'true' })
    const input = detail.findByProps({ 'aria-label': '记录此刻想法' })
    await act(async () => {
      input.props.onChange({ target: { value: '补充想法' } })
      await Promise.resolve()
    })
    await act(async () => {
      detail.findByProps({ 'aria-label': '发送延展' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
      await new Promise(resolve => { setTimeout(resolve, 600) })
      await Promise.resolve()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith('source.message-copy-link.extend', {
      sid: 'U2HQgn1RhPJZaFmx',
      itemIndex: 0,
      textContent: '补充想法',
      recordUid: 'record-new',
    })
    const treeText = JSON.stringify(renderer!.toJSON())
    expect(treeText).not.toContain('已延展')
    expect(treeText).toContain('共')
    expect(treeText).toContain('条延展')
    expect(treeText).toContain('补充想法')
    expect(detail.findByProps({ 'aria-label': '记录此刻想法' }).props.value).toBe('')
    expect(arkmeChatDirectory.getSnapshot().sources[1]).toMatchObject({
      latestPreview: '@狗才 1', activeAtMillis: 22, latestSequence: 8,
    })
  })

  it('loads related quick notes for an interwoven moment and opens nested detail', async () => {
    const interwovenMoment = {
      momentId: 'moment-one', momentRef: 'opaque-moment-one', occurredAtMillis: 45,
      groupName: '项目群', senderName: '小林', senderIsMe: false,
      summary: '@狗才 问题不大', degraded: false,
    }
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'user.profile') return {
        profile: {
          userId: 42, displayName: '狗才', nickname: '狗才', avatarRef: '', arkmeId: 'doge', accountType: 1,
          createdAt: 1, bindings: { apple: false, wechat: true, google: false }, contact: {},
        }, cachedAtMillis: 1, revision: 1,
      }
      if (operation === 'source.members') return { source: target, items: [], total: 0, activeCount: 0 }
      if (operation === 'source.timeline') return { source: target, items: [], hasMore: false }
      if (operation === 'source.interwoven-moments') return {
        state: 'success', moments: [interwovenMoment], preparedAtMillis: 48,
      }
      if (operation === 'source.interwoven-detail') return {
        momentId: 'moment-one', groupName: '项目群', senderName: '小林', senderIsMe: false,
        occurredAtMillis: 45, title: '', textContent: '@狗才 问题不大', status: 1, degraded: false,
      }
      if (operation === 'source.related-quick-notes.from-moment') return {
        total: 1,
        items: [{
          relatedRef: 'opaque-related-one', senderName: '小林',
          sendAtMillis: 44, title: '', textPreview: '没什么问题',
        }],
      }
      if (operation === 'source.related-quick-note.detail') return {
        relatedRef: 'opaque-related-one', senderName: '小林', isMe: false,
        sendAtMillis: 44, title: '', textContent: '完整相关快记正文', status: 1,
      }
      throw new Error(`unexpected operation ${operation}`)
    })
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    const momentCard = renderer!.root.findByProps({ 'data-arkme-interwoven-card': 'moment-one' })
    await act(async () => {
      momentCard.findByType('button').props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith(
      'source.related-quick-notes.from-moment',
      { sourceRef: 'source-harness', momentRef: 'opaque-moment-one' },
      expect.any(AbortSignal),
    )
    const relatedCard = renderer!.root.findByProps({ 'aria-label': '查看 1 条相关快记' })
    act(() => { relatedCard.props.onClick() })
    const row = renderer!.root.findByProps({ 'aria-label': '打开相关快记：没什么问题' })
    await act(async () => {
      row.props.onClick()
      await Promise.resolve()
    })
    expect(mocks.callArkme).toHaveBeenCalledWith(
      'source.related-quick-note.detail',
      { sourceRef: 'source-harness', relatedRef: 'opaque-related-one' },
      expect.any(AbortSignal),
    )
    expect(JSON.stringify(renderer!.toJSON())).toContain('完整相关快记正文')
  })

  it('refreshes interwoven related notes when a detail reference expires', async () => {
    const interwovenMoment = {
      momentId: 'moment-one', momentRef: 'opaque-moment-one', occurredAtMillis: 45,
      groupName: '项目群', senderName: '小林', senderIsMe: false,
      summary: '@狗才 问题不大', degraded: false,
    }
    let relatedListCalls = 0
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'user.profile') return {
        profile: {
          userId: 42, displayName: '狗才', nickname: '狗才', avatarRef: '', arkmeId: 'doge', accountType: 1,
          createdAt: 1, bindings: { apple: false, wechat: true, google: false }, contact: {},
        }, cachedAtMillis: 1, revision: 1,
      }
      if (operation === 'source.members') return { source: target, items: [], total: 0, activeCount: 0 }
      if (operation === 'source.timeline') return { source: target, items: [], hasMore: false }
      if (operation === 'source.interwoven-moments') return {
        state: 'success', moments: [interwovenMoment], preparedAtMillis: 48,
      }
      if (operation === 'source.interwoven-detail') return {
        momentId: 'moment-one', groupName: '项目群', senderName: '小林', senderIsMe: false,
        occurredAtMillis: 45, title: '', textContent: '@狗才 问题不大', status: 1, degraded: false,
      }
      if (operation === 'source.related-quick-notes.from-moment') {
        relatedListCalls += 1
        return {
          total: 1,
          items: [{
            relatedRef: relatedListCalls === 1 ? 'opaque-related-old' : 'opaque-related-fresh',
            senderName: '小林', sendAtMillis: 44, title: '',
            textPreview: relatedListCalls === 1 ? '旧引用快记' : '刷新后的相关快记',
          }],
        }
      }
      if (operation === 'source.related-quick-note.detail') {
        throw new ArkmeClientError({
          code: 'related-quick-note-ref-expired',
          message: '相关快记引用已过期，请刷新后重试',
          retryable: true,
        })
      }
      throw new Error(`unexpected operation ${operation}`)
    })
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      renderer!.root.findByProps({ 'data-arkme-interwoven-card': 'moment-one' }).findByType('button').props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => { renderer!.root.findByProps({ 'aria-label': '查看 1 条相关快记' }).props.onClick() })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '打开相关快记：旧引用快记' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(relatedListCalls).toBe(2)
    expect(renderer!.root.findAllByProps({ 'aria-label': '打开相关快记：刷新后的相关快记' })).toHaveLength(1)
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('相关快记引用已过期，请刷新后重试')
  })
})
