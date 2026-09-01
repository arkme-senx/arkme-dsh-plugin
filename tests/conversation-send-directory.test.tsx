import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeConversationMemberItem, ArkmeSourceItem, ArkmeTimelineItem } from '../src/types.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))

vi.mock('../src/client/api.js', () => ({
  callArkme: mocks.callArkme,
  ArkmeClientError: class ArkmeClientError extends Error {
    constructor(readonly body: { code: string; message: string; retryable: boolean }) {
      super(body.message)
    }
  },
}))

vi.mock('react-dom', () => ({
  createPortal: (children: unknown) => children,
}))

import {
  ArkmeSurface, arkmeGroupMentionCandidates, arkmeRealtimeDeltaCoversTimelineGap,
} from '../src/client/ArkmeSidebar.js'
import { ArkmeClientError } from '../src/client/api.js'
import { ArkmeRichComposerInput } from '../src/client/ArkmeRichComposerInput.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeChatDirectory, arkmeChatTimelineDelta } from '../src/client/chat-directory-store.js'
import { arkmeComposerDraftStore, arkmeSourceComposerDraftKey } from '../src/client/composer-draft-store.js'
import { arkmeMessageReadReceipts } from '../src/client/message-read-receipt-store.js'
import { arkmeTheme } from '../src/client/arkme-theme.js'
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

function activeMembers(count: number): ArkmeConversationMemberItem[] {
  return Array.from({ length: count }, (_, index) => ({
    memberRef: `member-${String(index)}`,
    displayName: `成员${String(index)}`,
    role: 'member',
    status: 'active',
    isSelf: false,
    isOwner: false,
    joinedAtMillis: index + 1,
    recordCount: 0,
    mentionCount: 0,
  }))
}

describe('conversation send directory projection', () => {
  let renderer: ReactTestRenderer | undefined
  let timeline: ArkmeTimelineItem[]
  let copiedQuickLinkExtensionText = ''
  let activeSource = target

  beforeEach(() => {
    timeline = []
    copiedQuickLinkExtensionText = ''
    activeSource = target
    vi.spyOn(Date, 'now').mockReturnValue(48)
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      open: vi.fn(),
      confirm: vi.fn(() => true),
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
      if (operation === 'source.members') return { source: activeSource, items: [], total: 0, activeCount: 0 }
      if (operation === 'source.timeline') return { source: activeSource, items: timeline, hasMore: false }
      if (operation === 'sources.list') return {
        directory: params?.directory ?? 'root',
        items: params?.directory === 'send_to_self' ? [] : activeSource === group ? [other, target, group] : [other, target],
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

  it('suppresses an owner read only when retained delta items continuously cover a cached timeline gap', () => {
    const cached = {
      items: [{
        itemUid: 'message-8', sequence: 8, senderName: '联系人', isMe: false,
        sendAtMillis: 8, title: '', textContent: '第八条', status: 1,
      }],
      aiPolishNotices: [], hasMore: false, fetchedAtMillis: 1, latestSequence: 8,
    }
    const message = (sequence: number): ArkmeTimelineItem => ({
      itemUid: `message-${String(sequence)}`, sequence, senderName: '联系人', isMe: false,
      sendAtMillis: sequence, title: '', textContent: `第 ${String(sequence)} 条`, status: 1,
    })

    expect(arkmeRealtimeDeltaCoversTimelineGap(undefined, [message(9)], 9)).toBe(false)
    expect(arkmeRealtimeDeltaCoversTimelineGap(cached, [], 8)).toBe(false)
    expect(arkmeRealtimeDeltaCoversTimelineGap(cached, [message(10)], 10)).toBe(false)
    expect(arkmeRealtimeDeltaCoversTimelineGap(cached, [message(9), message(10)], 10)).toBe(true)
    expect(arkmeRealtimeDeltaCoversTimelineGap({ ...cached, latestSequence: 8, items: [message(9)] }, [message(10)], 10)).toBe(true)
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

  it('does not expose a human mention action without a mention-scoped capability ref', () => {
    const member: ArkmeConversationMemberItem = {
      memberRef: 'member-action-only',
      displayName: '仅成员身份',
      role: 'member', status: 'active', isSelf: false, isOwner: false,
      joinedAtMillis: 1, recordCount: 0, mentionCount: 0,
    }

    expect(arkmeGroupMentionCandidates('', [], [member]).map(candidate => candidate.kind))
      .toEqual(['all'])
  })

  it('lets the user remove terminal local file tasks without hiding an unknown remote outcome', async () => {
    const baseCall = mocks.callArkme.getMockImplementation()!
    const failedTask = {
      taskRef: 'task-failed-file', sourceRef: target.sourceRef,
      recordUid: 'record-failed-file', relationUid: 'relation-failed-file',
      fileRefs: ['arkme-file-v1.00000000-0000-4000-8000-000000000001'],
      content: { textContent: '@小林 请看' },
      files: [{
        fileRef: 'arkme-file-v1.00000000-0000-4000-8000-000000000001',
        fileName: '图片.png', mimeType: 'image/png', size: 3, fileKind: 1,
        progress: { phase: 'ready', sentBytes: 3, totalBytes: 3 },
      }],
      state: 'failed', createdAtMillis: 48, error: '媒体载荷不合法',
    }
    let tasks = [failedTask]
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>, signal?: AbortSignal) => {
      if (operation === 'files.send.tasks') return tasks
      if (operation === 'files.send.discard') {
        tasks = []
        return undefined
      }
      return await baseCall(operation, params, signal)
    })

    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />, {
        createNodeMock: element => element.props.className === 'arkme-conversation-panel'
          ? { getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }) }
          : null,
      })
      await Promise.resolve()
      await Promise.resolve()
    })
    const remove = renderer!.root.findAllByType('button').find(button => button.children.includes('清除'))
    expect(remove).toBeDefined()

    await act(async () => {
      remove!.props.onClick({ stopPropagation: vi.fn() })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith('files.send.discard', { taskRef: 'task-failed-file' })

    await act(async () => {
      renderer!.unmount()
    })
    renderer = undefined
    tasks = [{
      ...failedTask,
      taskRef: 'task-uncertain-file',
      recordUid: 'record-uncertain-file',
      relationUid: 'relation-uncertain-file',
      state: 'uncertain',
      error: '发送结果待确认',
    }]
    const confirm = vi.mocked(window.confirm)
    confirm.mockReset()
    confirm.mockReturnValueOnce(false).mockReturnValueOnce(true)

    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />, {
        createNodeMock: element => element.props.className === 'arkme-conversation-panel'
          ? { getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }) }
          : null,
      })
      await Promise.resolve()
      await Promise.resolve()
    })
    const uncertainRemove = renderer!.root.findAllByType('button').find(button => button.children.includes('清除'))
    expect(uncertainRemove).toBeDefined()

    await act(async () => {
      uncertainRemove!.props.onClick({ stopPropagation: vi.fn() })
      await Promise.resolve()
    })
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(mocks.callArkme).not.toHaveBeenCalledWith('files.send.discard', { taskRef: 'task-uncertain-file' })

    await act(async () => {
      uncertainRemove!.props.onClick({ stopPropagation: vi.fn() })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(mocks.callArkme).toHaveBeenCalledWith('files.send.discard', { taskRef: 'task-uncertain-file' })
  })

  it('opens the report dialog from a peer group-message action menu', async () => {
    activeSource = group
    timeline = [{
      itemUid: 'report-source', messageActionRef: 'opaque-action', messageRef: 'opaque-report-message',
      senderName: '群成员', isMe: false, sendAtMillis: 1, title: '', textContent: '待举报消息', status: 1,
    }]
    arkmeChatDirectory.publish([group])
    arkmeUi.selectSource(group)
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />, {
        createNodeMock: element => element.props.className === 'arkme-conversation-panel'
          ? { getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }) }
          : null,
      })
      await Promise.resolve()
    })
    act(() => {
      renderer!.root.findByProps({ 'aria-label': '打开快记详情' }).props.onContextMenu({
        preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 120, clientY: 180,
      })
    })
    const menu = renderer!.root.findByProps({ 'aria-label': '消息操作' })
    const report = menu.findAllByProps({ role: 'menuitem' }).find(button => button.findAllByType('span')
      .some(span => span.children.includes('举报')))
    expect(report).toBeDefined()
    act(() => { report!.props.onClick() })
    expect(renderer!.root.findByProps({ 'aria-labelledby': 'arkme-message-report-title' })).toBeDefined()
    await act(async () => {
      renderer!.update(<ArkmeSurface productChrome={false} productNavigation={false} active={false} />)
      await Promise.resolve()
    })
    expect(renderer!.root.findAllByProps({ 'aria-labelledby': 'arkme-message-report-title' })).toHaveLength(0)
    await act(async () => {
      renderer!.update(<ArkmeSurface productChrome={false} productNavigation={false} active />)
      await Promise.resolve()
    })
    expect(renderer!.root.findAllByProps({ 'aria-labelledby': 'arkme-message-report-title' })).toHaveLength(0)
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

  async function enterMessageSelectMode(item: ArkmeTimelineItem) {
    timeline = [item]
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />, {
        createNodeMock: element => element.props.className === 'arkme-conversation-panel'
          ? { getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }) }
          : null,
      })
      await Promise.resolve()
    })
    const row = renderer!.root.findByProps({ 'data-arkme-message-item-uid': item.itemUid })
    const bubble = row.findByProps({ 'data-arkme-message-direction': item.isMe ? 'self' : 'other' })
    act(() => {
      bubble.props.onContextMenu({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        clientX: 120,
        clientY: 180,
      })
    })
    const menu = renderer!.root.findByProps({ 'aria-label': '消息操作' })
    act(() => { menu.findAllByProps({ role: 'menuitem' })[2]!.props.onClick() })
  }

  it('anchors the themed multi-select control to the avatar top and renders exit as a standard toolbar action', async () => {
    await enterMessageSelectMode({
      itemUid: 'select-source', messageActionRef: 'opaque-select-action',
      senderName: '狗才', isMe: true, sendAtMillis: 1, title: '',
      textContent: '这是一条用于验证多选圆点锚定头像而不是整条长消息中心的长文本。'.repeat(12), status: 1,
    })

    const row = renderer!.root.findByProps({ 'data-arkme-message-item-uid': 'select-source' })
    expect(row.props.style).toMatchObject({
      display: 'grid',
      gridTemplateColumns: '32px minmax(0, 1fr)',
      alignItems: 'start',
      marginBottom: 18,
    })
    expect(row.props.style.justifyContent).toBeUndefined()
    const checkbox = row.findByProps({ role: 'checkbox' })
    expect(checkbox.props['data-arkme-selection-anchor']).toBe('avatar')
    expect(checkbox.props.style.position).toBeUndefined()
    expect(checkbox.props.style).toMatchObject({ width: 32, height: 32, marginTop: 1 })
    const avatar = row.findByProps({ 'data-arkme-message-avatar': 'true' })
    expect(checkbox.props.style.marginTop + checkbox.props.style.height / 2).toBe(avatar.props.style.height / 2)
    const circle = checkbox.findByType('span')
    expect(circle.props.style).toMatchObject({
      borderColor: arkmeTheme.accent,
      background: arkmeTheme.accent,
      color: arkmeTheme.foreground,
    })

    const toolbar = renderer!.root.findByProps({ role: 'toolbar' })
    const exit = toolbar.findByProps({ 'aria-label': '退出多选' })
    const exitParts = exit.findAllByType('span')
    expect(exit.props.style).toMatchObject({ flexDirection: 'column', alignItems: 'center' })
    expect(exitParts[0]!.props.style.background).toBe(arkmeTheme.elevated)
    expect(exitParts[1]!.children).toEqual(['退出多选'])
    expect(exit.findByType('svg').props.width).toBe(18)
  })

  it.each([
    {
      label: '自己的短文本',
      item: {
        itemUid: 'select-own-short', messageActionRef: 'opaque-own-short-action',
        senderName: '狗才', isMe: true, sendAtMillis: 1, title: '', textContent: '短消息', status: 1,
      } satisfies ArkmeTimelineItem,
    },
    {
      label: '他人的短文本',
      item: {
        itemUid: 'select-other-short', messageActionRef: 'opaque-other-short-action',
        senderName: '朋友', isMe: false, sendAtMillis: 1, title: '', textContent: '收到', status: 1,
      } satisfies ArkmeTimelineItem,
    },
    {
      label: '自己的图片',
      item: {
        itemUid: 'select-own-image', messageActionRef: 'opaque-own-image-action',
        senderName: '狗才', isMe: true, sendAtMillis: 1, title: '', textContent: '', status: 1,
        contentBlocks: [{
          kind: 'image', mediaRef: 'opaque-image-ref', fileName: '示例图片.png', mimeType: 'image/png', size: 128, sortOrder: 0,
        }],
      } satisfies ArkmeTimelineItem,
    },
  ])('keeps $label on the avatar selection contract', async ({ item }) => {
    await enterMessageSelectMode(item)

    const row = renderer!.root.findByProps({ 'data-arkme-message-item-uid': item.itemUid })
    expect(row.props.style).toMatchObject({
      display: 'grid',
      gridTemplateColumns: '32px minmax(0, 1fr)',
      alignItems: 'start',
    })
    expect(row.findByProps({ role: 'checkbox' }).props['data-arkme-selection-anchor']).toBe('avatar')
    expect(row.findByProps({ 'data-arkme-message-avatar': 'true' })).toBeDefined()
  })

  it('reserves symmetric selection rails so an avatarless shared recording stays centered without overlap', async () => {
    const item: ArkmeTimelineItem = {
      itemUid: 'select-shared-recording', messageActionRef: 'opaque-shared-recording-action',
      senderName: '朋友', isMe: false, sendAtMillis: 1, title: '', textContent: '', status: 1,
      sharedRecording: {
        sourceDigest: 'digest-select', detailRef: 'detail-select', sharedByUserId: 12,
        sharedAtMillis: 1, displayAtMillis: 1, endAtMillis: 60_001,
        timeRangeText: '10:00 - 10:01', title: '项目沟通', summary: '确认了下一步安排。',
        transcriptAvailable: true, participants: [{ refUserId: 12, displayName: '朋友', role: 1 }],
      },
    }
    await enterMessageSelectMode(item)

    const row = renderer!.root.findByProps({ 'data-arkme-message-item-uid': item.itemUid })
    expect(row.props.style).toMatchObject({
      display: 'grid',
      gridTemplateColumns: '42px minmax(0, 1fr) 42px',
      alignItems: 'center',
      marginBottom: 42,
    })
    expect(row.props.style.position).toBeUndefined()
    expect(row.props.style.justifyContent).toBeUndefined()
    const checkbox = row.findByProps({ role: 'checkbox' })
    expect(checkbox.props['data-arkme-selection-anchor']).toBe('card-center')
    expect(checkbox.props.style).toMatchObject({ justifySelf: 'center', width: 32, height: 32 })
    expect(checkbox.props.style.position).toBeUndefined()
    expect(row.findAllByProps({ 'data-arkme-message-avatar': 'true' })).toHaveLength(0)
    const messageLine = row.find(node => node.type === 'div' && node.props.style?.width === 'min(600px, 100%)')
    expect(messageLine.props.style).toMatchObject({
      gridColumn: '2', minWidth: 0, justifySelf: 'center', justifyContent: 'center', marginBottom: 0,
    })
  })

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

  it('keeps the owner directory unchanged after send until the authoritative session projection arrives', async () => {
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
    })
    const composer = renderer!.root.findByType(ArkmeRichComposerInput)
    await act(async () => {
      composer.props.onTextChange('@普通文字')
      composer.props.onSelectionChange('@普通文字', 5, 5)
      await Promise.resolve()
    })
    const directoryBeforeSend = arkmeChatDirectory.getSnapshot()
    const sendButton = renderer!.root.findByProps({ 'aria-label': '发送消息' })
    await act(async () => {
      sendButton.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(arkmeChatDirectory.getSnapshot()).toEqual(directoryBeforeSend)
    const sendCall = mocks.callArkme.mock.calls.find(([operation]) => operation === 'source.send-text')
    expect(sendCall?.[1]).not.toHaveProperty('humanMentions')
    expect(sendCall?.[1]).not.toHaveProperty('botMentions')
    expect(renderer!.root.findByProps({ 'data-arkme-read-receipt-indicator': 'unread' })).toBeDefined()
  })

  it('replaces the native editor when the selected draft identity changes', async () => {
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
    })
    const firstComposer = renderer!.root.findByType(ArkmeRichComposerInput)

    await act(async () => {
      arkmeUi.selectSource(other)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(renderer!.root.findByType(ArkmeRichComposerInput)).not.toBe(firstComposer)
  })

  it('keeps the current group live member count when an aborted previous request resolves late', async () => {
    const groupA: ArkmeSourceItem = {
      ...group,
      sourceRef: 'source-group-a',
      sourceKey: 'chat:group-a',
      displayName: '群聊 A',
      groupAvatar: { memberCount: 5, strategy: 'owner_recent_speakers', computedAtMillis: 1, slots: [] },
    }
    const groupB: ArkmeSourceItem = {
      ...group,
      sourceRef: 'source-group-b',
      sourceKey: 'chat:group-b',
      displayName: '群聊 B',
      groupAvatar: { memberCount: 6, strategy: 'owner_recent_speakers', computedAtMillis: 1, slots: [] },
    }
    let resolveGroupA!: (value: unknown) => void
    const pendingGroupA = new Promise(resolve => { resolveGroupA = resolve })
    let groupASignal: AbortSignal | undefined
    arkmeChatDirectory.publish([groupA, groupB])
    arkmeUi.selectSource(groupA)
    mocks.callArkme.mockImplementation(async (
      operation: string,
      params?: { sourceRef?: string },
      signal?: AbortSignal,
    ) => {
      if (operation === 'user.profile') return {
        profile: {
          userId: 42, displayName: '狗才', nickname: '狗才', avatarRef: '', arkmeId: 'doge', accountType: 1,
          createdAt: 1, bindings: { apple: false, wechat: true, google: false }, contact: {},
        },
        cachedAtMillis: 1,
        revision: 1,
      }
      if (operation === 'source.members') {
        if (params?.sourceRef === groupA.sourceRef) {
          groupASignal = signal
          return await pendingGroupA
        }
        if (params?.sourceRef === groupB.sourceRef) {
          return { source: groupB, items: activeMembers(22), total: 22, activeCount: 22 }
        }
      }
      if (operation === 'source.timeline') {
        const timelineSource = params?.sourceRef === groupB.sourceRef ? groupB : groupA
        return { source: timelineSource, items: [], hasMore: false }
      }
      if (operation === 'source.interwoven-moments') {
        return { state: 'disabled', moments: [], preparedAtMillis: 48 }
      }
      throw new Error(`unexpected operation ${operation}`)
    })

    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
    })
    expect(renderer!.root.findByType(ArkmeRichComposerInput).props).toMatchObject({
      placeholder: '发消息到 群聊 A(5人)',
      disabled: false,
    })

    await act(async () => {
      arkmeUi.selectSource(groupB)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(groupASignal?.aborted).toBe(true)
    expect(renderer!.root.findByType(ArkmeRichComposerInput).props.placeholder).toBe('发消息到 群聊 B(22人)')

    await act(async () => {
      resolveGroupA({ source: groupA, items: activeMembers(11), total: 11, activeCount: 11 })
      await Promise.resolve()
    })

    expect(renderer!.root.findByType(ArkmeRichComposerInput).props.placeholder).toBe('发消息到 群聊 B(22人)')
  })

  it('keeps the composer usable with the projected group count when member refresh fails', async () => {
    const fallbackGroup: ArkmeSourceItem = {
      ...group,
      displayName: '故障恢复群',
      groupAvatar: { memberCount: 9, strategy: 'owner_recent_speakers', computedAtMillis: 1, slots: [] },
    }
    arkmeChatDirectory.publish([fallbackGroup])
    arkmeUi.selectSource(fallbackGroup)
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'user.profile') return {
        profile: {
          userId: 42, displayName: '狗才', nickname: '狗才', avatarRef: '', arkmeId: 'doge', accountType: 1,
          createdAt: 1, bindings: { apple: false, wechat: true, google: false }, contact: {},
        },
        cachedAtMillis: 1,
        revision: 1,
      }
      if (operation === 'source.members') throw new Error('成员刷新失败')
      if (operation === 'source.timeline') return { source: fallbackGroup, items: [], hasMore: false }
      if (operation === 'source.interwoven-moments') {
        return { state: 'disabled', moments: [], preparedAtMillis: 48 }
      }
      throw new Error(`unexpected operation ${operation}`)
    })

    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
    })

    expect(renderer!.root.findByType(ArkmeRichComposerInput).props).toMatchObject({
      placeholder: '发消息到 故障恢复群(9人)',
      disabled: false,
    })
    expect(renderer!.root.findAll(node => node.type === 'div' && node.children.includes('成员刷新失败'))).not.toHaveLength(0)
  })

  it('falls back to the projected group count when the refreshed active count is zero', async () => {
    const fallbackGroup: ArkmeSourceItem = {
      ...group,
      displayName: '零成员快照群',
      groupAvatar: { memberCount: 9, strategy: 'owner_recent_speakers', computedAtMillis: 1, slots: [] },
    }
    arkmeChatDirectory.publish([fallbackGroup])
    arkmeUi.selectSource(fallbackGroup)
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'user.profile') return {
        profile: {
          userId: 42, displayName: '狗才', nickname: '狗才', avatarRef: '', arkmeId: 'doge', accountType: 1,
          createdAt: 1, bindings: { apple: false, wechat: true, google: false }, contact: {},
        },
        cachedAtMillis: 1,
        revision: 1,
      }
      if (operation === 'source.members') return {
        source: fallbackGroup, items: [], total: 0, activeCount: 0,
      }
      if (operation === 'source.timeline') return { source: fallbackGroup, items: [], hasMore: false }
      if (operation === 'source.interwoven-moments') {
        return { state: 'disabled', moments: [], preparedAtMillis: 48 }
      }
      throw new Error(`unexpected operation ${operation}`)
    })

    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
    })

    expect(renderer!.root.findByType(ArkmeRichComposerInput).props).toMatchObject({
      placeholder: '发消息到 零成员快照群(9人)',
      disabled: false,
    })
  })

  it('sends a selected group member with the mention-scoped ref and restores the same structured draft on failure', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const groupTarget: ArkmeSourceItem = {
      ...target,
      sourceRef: 'source-mention-group',
      sourceKey: 'chat:mention-group',
      kind: 'group_chat',
      displayName: '协作群',
    }
    arkmeChatDirectory.clear()
    arkmeChatDirectory.activateAccount(42)
    arkmeChatDirectory.publish([other, groupTarget])
    arkmeUi.selectSource(groupTarget)
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'user.profile') return {
        profile: {
          userId: 42, displayName: '狗才', nickname: '狗才', avatarRef: '', arkmeId: 'doge', accountType: 1,
          createdAt: 1, bindings: { apple: false, wechat: true, google: false }, contact: {},
        },
        cachedAtMillis: 1,
        revision: 1,
      }
      if (operation === 'source.members') return {
        source: groupTarget,
        items: [{
          memberRef: 'arkme-chat-member-v1.stable.signature',
          mentionRef: 'arkme-chat-human-mention-v1.mention.signature',
          displayName: 'Tison',
          role: 'member', status: 'active', isSelf: false, isOwner: false,
          joinedAtMillis: 1, recordCount: 0, mentionCount: 0,
        }],
        total: 1,
        activeCount: 1,
      }
      if (operation === 'source.timeline') return { source: groupTarget, items: [], hasMore: false }
      if (operation === 'group.bots') throw new Error('Bot candidates unavailable')
      if (operation === 'source.send-text') return {
        sourceRef: groupTarget.sourceRef,
        itemUid: params?.recordUid ?? 'record-new',
        status: 1,
        sequence: 9,
        localState: 'synced',
      }
      throw new Error(`unexpected operation ${operation}`)
    })

    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    const composer = renderer!.root.findByType(ArkmeRichComposerInput)
    await act(async () => {
      composer.props.onTextChange('  @T')
      composer.props.onSelectionChange('  @T', 4, 4)
      await Promise.resolve()
      await Promise.resolve()
    })
    const tisonOption = renderer!.root.findAllByProps({ role: 'option' }).find(option =>
      option.findAll(node => node.type === 'span' && node.children.join('') === 'Tison').length > 0)
    expect(tisonOption).toBeDefined()
    await act(async () => {
      tisonOption!.props.onMouseDown({ preventDefault: vi.fn() })
      await Promise.resolve()
    })

    const draftKey = arkmeSourceComposerDraftKey(42, groupTarget)!
    expect(arkmeComposerDraftStore.get(draftKey)).toMatchObject({
      text: '  @Tison ',
      mentions: [{
        mentionRef: 'arkme-chat-human-mention-v1.mention.signature',
        displayName: 'Tison', startIndex: 2, length: 6,
      }],
    })
    const directoryBeforeSend = arkmeChatDirectory.getSnapshot()

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '发送消息' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.callArkme).toHaveBeenCalledWith('source.send-text', expect.objectContaining({
      sourceRef: groupTarget.sourceRef,
      textContent: '  @Tison ',
      humanMentions: [{
        mentionRef: 'arkme-chat-human-mention-v1.mention.signature',
        startIndex: 2,
        length: 6,
      }],
    }))
    expect(warning).toHaveBeenCalledWith(
      'dsh-arkme: mention bot refresh failed',
      'Bot candidates unavailable',
    )
    expect(arkmeComposerDraftStore.get(draftKey).text).toBe('')
    expect(arkmeChatDirectory.getSnapshot()).toEqual(directoryBeforeSend)

    await act(async () => {
      composer.props.onTextChange('  @T')
      composer.props.onSelectionChange('  @T', 4, 4)
      await Promise.resolve()
      await Promise.resolve()
    })
    const fileMentionOption = renderer!.root.findAllByProps({ role: 'option' }).find(option =>
      option.findAll(node => node.type === 'span' && node.children.join('') === 'Tison').length > 0)
    expect(fileMentionOption).toBeDefined()
    await act(async () => {
      fileMentionOption!.props.onMouseDown({ preventDefault: vi.fn() })
      arkmeComposerDraftStore.appendAttachments(draftKey, [{ localFile: {
        fileRef: 'arkme-file-v1.00000000-0000-4000-8000-000000000001',
        fileName: '说明.md', mimeType: 'text/markdown', size: 8, fileKind: 4,
      } }])
      await Promise.resolve()
    })
    vi.stubGlobal('crypto', { randomUUID: vi.fn()
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000003') })
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'files.send') return {
        taskRef: 'task-human-mention-file',
        sourceRef: groupTarget.sourceRef,
        recordUid: params?.recordUid,
        relationUid: params?.relationUid,
        fileRefs: params?.fileRefs,
        content: {
          textContent: params?.textContent,
          humanMentions: params?.humanMentions,
        },
        files: [], state: 'queued', createdAtMillis: 48,
      }
      if (operation === 'files.send.tasks') return []
      throw new Error(`unexpected operation ${operation}`)
    })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '发送消息' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.callArkme).toHaveBeenCalledWith('files.send', expect.objectContaining({
      sourceRef: groupTarget.sourceRef,
      textContent: '  @Tison ',
      humanMentions: [{
        mentionRef: 'arkme-chat-human-mention-v1.mention.signature',
        startIndex: 2,
        length: 6,
      }],
    }))

    await act(async () => {
      composer.props.onTextChange('@T')
      composer.props.onSelectionChange('@T', 2, 2)
      await Promise.resolve()
      await Promise.resolve()
    })
    const retryOption = renderer!.root.findAllByProps({ role: 'option' }).find(option =>
      option.findAll(node => node.type === 'span' && node.children.join('') === 'Tison').length > 0)
    expect(retryOption).toBeDefined()
    await act(async () => {
      retryOption!.props.onMouseDown({ preventDefault: vi.fn() })
      await Promise.resolve()
    })
    vi.stubGlobal('crypto', { randomUUID: vi.fn()
      .mockReturnValueOnce('record-retry')
      .mockReturnValueOnce('relation-retry') })
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.send-text') throw new Error('发送失败')
      throw new Error(`unexpected operation ${operation}`)
    })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '发送消息' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(arkmeComposerDraftStore.get(draftKey)).toMatchObject({
      text: '@Tison ',
      mentions: [{
        mentionRef: 'arkme-chat-human-mention-v1.mention.signature',
        displayName: 'Tison', startIndex: 0, length: 6,
      }],
    })
    expect(arkmeChatDirectory.getSnapshot()).toEqual(directoryBeforeSend)
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

  it('does not refresh the selected owner timeline when only another conversation projection changes', async () => {
    timeline = [{
      itemUid: 'selected-message', sequence: 784, senderName: '我', isMe: true,
      sendAtMillis: 40, title: '', textContent: '当前会话', status: 1,
    }]
    arkmeChatDirectory.publish([group, other])
    arkmeUi.selectSource(group)
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    const timelineCallsBeforeOtherUpdate = mocks.callArkme.mock.calls
      .filter(([operation]) => operation === 'source.timeline').length

    await act(async () => {
      arkmeChatDirectory.upsert({
        ...other,
        latestPreview: '其他会话的新消息',
        activeAtMillis: 49,
        latestSequence: 5,
      })
      arkmeUi.chatChanged()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.timeline'))
      .toHaveLength(timelineCallsBeforeOtherUpdate)
    expect(JSON.stringify(renderer!.toJSON())).toContain('当前会话')
  })

  it('keeps the current group mounted and applies a complete realtime delta without a duplicate timeline read', async () => {
    const stableGroup: ArkmeSourceItem = {
      ...target,
      sourceRef: 'source-group-before-activity',
      sourceKey: 'chat:stable-group',
      kind: 'group_chat',
      displayName: '稳定群聊',
      latestSequence: 8,
    }
    timeline = [{
      itemUid: 'message-8', sequence: 8, senderName: 'Tison', isMe: false, sendAtMillis: 8,
      title: '', textContent: '刷新前消息', status: 1,
    }]
    arkmeChatDirectory.publish([stableGroup, other])
    arkmeUi.selectSource(stableGroup)

    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    const conversationList = renderer!.root.find(node => node.type === 'ul'
      && typeof node.props.className === 'string'
      && node.props.className.includes('arkme-conversation-records'))
    const timelineCallsBeforeProjection = mocks.callArkme.mock.calls
      .filter(([operation]) => operation === 'source.timeline').length
    const projected = {
      ...stableGroup,
      sourceRef: 'source-group-after-activity',
      latestPreview: '刷新后消息',
      activeAtMillis: 9,
      latestSequence: 9,
    }
    const deltaItem: ArkmeTimelineItem = {
      itemUid: 'message-9', sequence: 9, senderName: '我', isMe: true, sendAtMillis: 9,
      title: '', textContent: '刷新后消息', status: 1,
    }
    timeline = [timeline[0]!, deltaItem]

    await act(async () => {
      arkmeChatTimelineDelta.publish([{ source: projected, items: [deltaItem] }])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.timeline')).toHaveLength(
      timelineCallsBeforeProjection,
    )
    expect(renderer!.root.find(node => node.type === 'ul'
      && typeof node.props.className === 'string'
      && node.props.className.includes('arkme-conversation-records'))).toBe(conversationList)
    const rendered = JSON.stringify(renderer!.toJSON())
    expect(rendered).toContain('刷新前消息')
    expect(rendered).toContain('刷新后消息')
  })

  it('reloads member capabilities when the selected group keeps its identity but rotates its source ref', async () => {
    const before: ArkmeSourceItem = {
      ...group,
      sourceRef: 'source-group-before-member-refresh',
      sourceKey: 'chat:stable-member-group',
    }
    const after: ArkmeSourceItem = {
      ...before,
      sourceRef: 'source-group-after-member-refresh',
    }
    arkmeChatDirectory.publish([before])
    arkmeUi.selectSource(before)
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'user.profile') return {
        profile: {
          userId: 42, displayName: '狗才', nickname: '狗才', avatarRef: '', arkmeId: 'doge', accountType: 1,
          createdAt: 1, bindings: { apple: false, wechat: true, google: false }, contact: {},
        },
        cachedAtMillis: 1,
        revision: 1,
      }
      if (operation === 'source.members') return {
        source: params?.sourceRef === after.sourceRef ? after : before,
        items: [], total: 0, activeCount: 0,
      }
      if (operation === 'source.timeline') return { source: before, items: [], hasMore: false }
      throw new Error(`unexpected operation ${operation}`)
    })

    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.callArkme).toHaveBeenCalledWith('source.members', {
      sourceRef: before.sourceRef,
      activeOnly: true,
    }, expect.any(AbortSignal))

    await act(async () => {
      arkmeUi.selectSource(after)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith('source.members', {
      sourceRef: after.sourceRef,
      activeOnly: true,
    }, expect.any(AbortSignal))
  })

  it('does not expose member candidates returned by a previously selected group', async () => {
    const groupA: ArkmeSourceItem = {
      ...target, sourceRef: 'source-group-a', sourceKey: 'chat:group-a', kind: 'group_chat', displayName: 'A 群',
    }
    const groupB: ArkmeSourceItem = {
      ...target, sourceRef: 'source-group-b', sourceKey: 'chat:group-b', kind: 'group_chat', displayName: 'B 群',
    }
    let resolveGroupA: ((value: unknown) => void) | undefined
    const groupAMembers = new Promise(resolve => { resolveGroupA = resolve })
    arkmeChatDirectory.clear()
    arkmeChatDirectory.activateAccount(42)
    arkmeChatDirectory.publish([groupA, groupB])
    arkmeUi.selectSource(groupA)
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'user.profile') return {
        profile: {
          userId: 42, displayName: '狗才', nickname: '狗才', avatarRef: '', arkmeId: 'doge', accountType: 1,
          createdAt: 1, bindings: { apple: false, wechat: true, google: false }, contact: {},
        },
        cachedAtMillis: 1,
        revision: 1,
      }
      if (operation === 'source.members' && params?.sourceRef === groupA.sourceRef) return await groupAMembers
      if (operation === 'source.members' && params?.sourceRef === groupB.sourceRef) return {
        source: groupB,
        items: [{
          memberRef: 'member-b', mentionRef: 'mention-b', displayName: 'B 成员',
          role: 'member', status: 'active', isSelf: false, isOwner: false,
          joinedAtMillis: 1, recordCount: 0, mentionCount: 0,
        }],
        total: 1,
        activeCount: 1,
      }
      if (operation === 'source.timeline') return {
        source: params?.sourceRef === groupA.sourceRef ? groupA : groupB, items: [], hasMore: false,
      }
      if (operation === 'source.interwoven-moments') return { state: 'disabled', moments: [], preparedAtMillis: 48 }
      if (operation === 'group.bots') return { source: groupB, items: [], total: 0 }
      throw new Error(`unexpected operation ${operation}`)
    })

    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
    })
    await act(async () => {
      arkmeUi.selectSource(groupB)
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      resolveGroupA?.({
        source: groupA,
        items: [{
          memberRef: 'member-a', mentionRef: 'mention-a', displayName: 'A 成员',
          role: 'member', status: 'active', isSelf: false, isOwner: false,
          joinedAtMillis: 1, recordCount: 0, mentionCount: 0,
        }],
        total: 1,
        activeCount: 1,
      })
      await Promise.resolve()
      await Promise.resolve()
    })
    const composer = renderer!.root.findByType(ArkmeRichComposerInput)
    await act(async () => {
      composer.props.onTextChange('@')
      composer.props.onSelectionChange('@', 1, 1)
      await Promise.resolve()
      await Promise.resolve()
    })
    const rendered = JSON.stringify(renderer!.toJSON())
    expect(rendered).toContain('B 成员')
    expect(rendered).not.toContain('A 成员')
  })

  it('does not expose Bot candidates returned by a previously selected group', async () => {
    const groupA: ArkmeSourceItem = {
      ...target, sourceRef: 'source-bot-group-a', sourceKey: 'chat:bot-group-a', kind: 'group_chat', displayName: 'Bot A 群',
    }
    const groupB: ArkmeSourceItem = {
      ...target, sourceRef: 'source-bot-group-b', sourceKey: 'chat:bot-group-b', kind: 'group_chat', displayName: 'Bot B 群',
    }
    let resolveGroupABots: ((value: unknown) => void) | undefined
    const groupABots = new Promise(resolve => { resolveGroupABots = resolve })
    arkmeChatDirectory.clear()
    arkmeChatDirectory.activateAccount(42)
    arkmeChatDirectory.publish([groupA, groupB])
    arkmeUi.selectSource(groupA)
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'user.profile') return {
        profile: {
          userId: 42, displayName: '狗才', nickname: '狗才', avatarRef: '', arkmeId: 'doge', accountType: 1,
          createdAt: 1, bindings: { apple: false, wechat: true, google: false }, contact: {},
        },
        cachedAtMillis: 1,
        revision: 1,
      }
      if (operation === 'source.members') return {
        source: params?.sourceRef === groupA.sourceRef ? groupA : groupB, items: [], total: 0, activeCount: 0,
      }
      if (operation === 'source.timeline') return {
        source: params?.sourceRef === groupA.sourceRef ? groupA : groupB, items: [], hasMore: false,
      }
      if (operation === 'source.interwoven-moments') return { state: 'disabled', moments: [], preparedAtMillis: 48 }
      if (operation === 'group.bots' && params?.sourceRef === groupA.sourceRef) return await groupABots
      if (operation === 'group.bots' && params?.sourceRef === groupB.sourceRef) return {
        source: groupB,
        items: [{ botRef: 'bot-b', name: 'B 助手', description: '', provider: 'openclaw', installed: true }],
        total: 1,
      }
      throw new Error(`unexpected operation ${operation}`)
    })

    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
    })
    let composer = renderer!.root.findByType(ArkmeRichComposerInput)
    await act(async () => {
      composer.props.onTextChange('@')
      composer.props.onSelectionChange('@', 1, 1)
      await Promise.resolve()
    })
    await act(async () => {
      arkmeUi.selectSource(groupB)
      await Promise.resolve()
      await Promise.resolve()
    })
    composer = renderer!.root.findByType(ArkmeRichComposerInput)
    await act(async () => {
      composer.props.onTextChange('@')
      composer.props.onSelectionChange('@', 1, 1)
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      resolveGroupABots?.({
        source: groupA,
        items: [{ botRef: 'bot-a', name: 'A 助手', description: '', provider: 'openclaw', installed: true }],
        total: 1,
      })
      await Promise.resolve()
      await Promise.resolve()
    })
    const rendered = JSON.stringify(renderer!.toJSON())
    expect(rendered).toContain('B 助手')
    expect(rendered).not.toContain('A 助手')
  })

  it('reloads account-bound member candidates when the authenticated account changes', async () => {
    const accountGroup: ArkmeSourceItem = {
      ...target, sourceRef: 'source-account-group', sourceKey: 'chat:account-group', kind: 'group_chat', displayName: '账号群',
    }
    let resolveAccountA: ((value: unknown) => void) | undefined
    const accountAMembers = new Promise(resolve => { resolveAccountA = resolve })
    let memberRequestCount = 0
    arkmeChatDirectory.clear()
    arkmeChatDirectory.activateAccount(42)
    arkmeChatDirectory.publish([accountGroup])
    arkmeUi.selectSource(accountGroup)
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'user.profile') return {
        profile: {
          userId: arkmeAuthStore.getSnapshot().auth?.status === 'authenticated'
            ? arkmeAuthStore.getSnapshot().auth!.userId
            : 0,
          displayName: '当前账号', nickname: '当前账号', avatarRef: '', arkmeId: 'current', accountType: 1,
          createdAt: 1, bindings: { apple: false, wechat: true, google: false }, contact: {},
        },
        cachedAtMillis: 1,
        revision: 1,
      }
      if (operation === 'source.members') {
        memberRequestCount += 1
        if (memberRequestCount === 1) return await accountAMembers
        return {
          source: accountGroup,
          items: [{
            memberRef: 'member-account-b', mentionRef: 'mention-account-b', displayName: '账号 B 成员',
            role: 'member', status: 'active', isSelf: false, isOwner: false,
            joinedAtMillis: 1, recordCount: 0, mentionCount: 0,
          }],
          total: 1,
          activeCount: 1,
        }
      }
      if (operation === 'source.timeline') return { source: accountGroup, items: [], hasMore: false }
      if (operation === 'source.interwoven-moments') return { state: 'disabled', moments: [], preparedAtMillis: 48 }
      if (operation === 'group.bots') return { source: accountGroup, items: [], total: 0 }
      throw new Error(`unexpected operation ${operation}`)
    })

    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
    })
    await act(async () => {
      arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 43 })
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      resolveAccountA?.({
        source: accountGroup,
        items: [{
          memberRef: 'member-account-a', mentionRef: 'mention-account-a', displayName: '账号 A 成员',
          role: 'member', status: 'active', isSelf: false, isOwner: false,
          joinedAtMillis: 1, recordCount: 0, mentionCount: 0,
        }],
        total: 1,
        activeCount: 1,
      })
      await Promise.resolve()
      await Promise.resolve()
    })
    const composer = renderer!.root.findByType(ArkmeRichComposerInput)
    await act(async () => {
      composer.props.onTextChange('@')
      composer.props.onSelectionChange('@', 1, 1)
      await Promise.resolve()
      await Promise.resolve()
    })
    const rendered = JSON.stringify(renderer!.toJSON())
    expect(memberRequestCount).toBe(2)
    expect(rendered).toContain('账号 B 成员')
    expect(rendered).not.toContain('账号 A 成员')
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
      arkmeChatTimelineDelta.publish([{ source: group, items: [timeline[5]!] }])
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
