import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ArkmeConversationMemberItem,
  ArkmeMessageCopyLinkSnapshotItem,
  ArkmeSourceItem,
  ArkmeTimelineItem,
} from '../src/types.js'

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
  ArkmeConfirmedSendRetentionOwner, ArkmeSurface, ArkmeTimelineMessageHeader, arkmeBackgroundSoundCaptureFailureFeedback,
  arkmeGroupMentionCandidates, arkmeRealtimeDeltaCoversTimelineGap,
} from '../src/client/ArkmeSidebar.js'
import { ArkmeClientError } from '../src/client/api.js'
import { ArkmeRichComposerInput } from '../src/client/ArkmeRichComposerInput.js'
import { ArkmeMemberProfileCard } from '../src/client/ArkmeChatMemberActions.js'
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
const sendToSelf: ArkmeSourceItem = {
  sourceRef: 'source-self', sourceKey: 'record:self', kind: 'send_to_self', displayName: '发给自己',
  latestPreview: '', activeAtMillis: 48, unreadCount: 0,
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

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function renderedText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(renderedText).join('')
  if (value !== null && typeof value === 'object' && 'children' in value) {
    return renderedText((value as { children?: unknown }).children)
  }
  return ''
}

describe('conversation send directory projection', () => {
  let renderer: ReactTestRenderer | undefined
  let timeline: ArkmeTimelineItem[]
  let aroundTimeline: ArkmeTimelineItem[] | undefined
  let aroundOlderHasMore = false
  let aroundOlderCursor: { beforeSequence: number } | undefined
  let aroundNewerHasMore = false
  let aroundNewerCursor: { afterSequence: number } | undefined
  let newerTimelinePages = new Map<number, {
    items: ArkmeTimelineItem[]
    hasMore: boolean
    nextCursor?: { afterSequence: number }
  }>()
  let olderTimelinePages = new Map<number, {
    items: ArkmeTimelineItem[]
    hasMore: boolean
    nextCursor?: { beforeSequence: number }
  }>()
  let copiedQuickLinkExtensionText = ''
  let copiedQuickLinkItems: ArkmeMessageCopyLinkSnapshotItem[]
  let activeSource = target

  it.each([
    ['permission-denied', '未获得麦克风权限'],
    ['start-failed', '录音启动失败'],
    ['stop-failed', '录音结束失败'],
    ['retention-evicted', '切换会话较多，较早草稿的背景音已释放'],
    ['limit-reached', '录音达到上限且未生成可用片段'],
  ] as const)('maps %s background capture failure to visible send feedback', (failure, feedback) => {
    expect(arkmeBackgroundSoundCaptureFailureFeedback(failure)).toBe(feedback)
  })

  it('bounds confirmed-send retention and preserves its action ref through a sparse authoritative row', () => {
    const owner = new ArkmeConfirmedSendRetentionOwner(2)
    const retained = (itemUid: string): ArkmeTimelineItem => ({
      itemUid, messageActionRef: `action-${itemUid}`, senderName: '我', isMe: true,
      sendAtMillis: 1, title: '', textContent: itemUid, status: 1,
    })
    owner.retain('self', retained('one'), 0)
    owner.retain('self', retained('two'), 0)
    owner.retain('self', retained('three'), 0)
    expect(owner.merge('self', [], 1).map(item => item.itemUid)).toEqual(['three', 'two'])

    const { messageActionRef: _actionRef, ...sparseAuthoritative } = retained('three')
    const merged = owner.merge('self', [sparseAuthoritative], 2)
    expect(merged.find(item => item.itemUid === 'three')?.messageActionRef).toBe('action-three')
    owner.merge('self', [retained('three')], 3)
    expect(owner.merge('self', [], 4).map(item => item.itemUid)).toEqual(['two'])
    expect(owner.merge('self', [], 60_001)).toEqual([])
  })

  beforeEach(() => {
    timeline = []
    aroundTimeline = undefined
    aroundOlderHasMore = false
    aroundOlderCursor = undefined
    aroundNewerHasMore = false
    aroundNewerCursor = undefined
    newerTimelinePages = new Map()
    olderTimelinePages = new Map()
    copiedQuickLinkExtensionText = ''
    copiedQuickLinkItems = [{
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
    }]
    activeSource = target
    vi.spyOn(Date, 'now').mockReturnValue(48)
    const localStorage = new Map<string, string>()
    const sessionStorage = new Map<string, string>()
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      open: vi.fn(),
      confirm: vi.fn(() => true),
      localStorage: {
        getItem: (key: string) => localStorage.get(key) ?? null,
        setItem: (key: string, value: string) => { localStorage.set(key, value) },
        removeItem: (key: string) => { localStorage.delete(key) },
      },
      sessionStorage: {
        getItem: (key: string) => sessionStorage.get(key) ?? null,
        setItem: (key: string, value: string) => { sessionStorage.set(key, value) },
        removeItem: (key: string) => { sessionStorage.delete(key) },
      },
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
      sourceRef?: string
      messageActionRef?: string
      textContent?: string
      recordUid?: string
      fileRefs?: string[]
      targetSourceRef?: string
      directory?: 'root' | 'send_to_self'
      itemUid?: string
      cursor?: { beforeSequence?: number; afterSequence?: number }
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
      if (operation === 'source.timeline') {
        const beforeSequence = params?.cursor?.beforeSequence
        const olderPage = beforeSequence === undefined ? undefined : olderTimelinePages.get(beforeSequence)
        if (olderPage !== undefined) return { source: target, ...olderPage }
        const afterSequence = params?.cursor?.afterSequence
        const newerPage = afterSequence === undefined ? undefined : newerTimelinePages.get(afterSequence)
        if (newerPage !== undefined) return { source: target, ...newerPage }
        return { source: activeSource, items: timeline, hasMore: false }
      }
      if (operation === 'source.timeline-around' && aroundTimeline !== undefined) return {
        source: activeSource, items: aroundTimeline,
        anchorItemUid: params?.itemUid, anchorSequence: 11, anchorIndex: 1,
        olderHasMore: aroundOlderHasMore, newerHasMore: aroundNewerHasMore,
        ...(aroundOlderCursor === undefined ? {} : { olderCursor: aroundOlderCursor }),
        ...(aroundNewerCursor === undefined ? {} : { newerCursor: aroundNewerCursor }),
      }
      if (operation === 'sources.list') return {
        directory: params?.directory ?? 'root',
        items: params?.directory === 'send_to_self' ? [] : activeSource === group ? [other, target, group] : [other, target],
        hasMore: false,
      }
      if (operation === 'source.interwoven-moments') return {
        state: 'disabled', moments: [], preparedAtMillis: 48,
      }
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [] }
      if (operation === 'source.message-extension.context') return {
        parentRecordUid: 'parent-record', extensionCount: 0, extensions: [],
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
        items: copiedQuickLinkItems,
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
      if (operation === 'source.message-extension.extend') return {
        recordUid: params?.recordUid ?? 'record-new',
        parentRecordUid: 'parent-record',
        status: 1,
        localState: 'synced',
        extension: {
          recordUid: params?.recordUid ?? 'record-new', level: 2, sourceKind: 'record_extension',
          senderDisplayName: '狗才', title: '', textContent: params?.textContent ?? '', sendAtMillis: 48,
          templateKind: 1, displayKind: 0, officialMark: 0, mediaItems: [],
        },
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

  it('highlights visible @ mentions in private conversation bubbles for self and peer messages', async () => {
    timeline = [{
      itemUid: 'received-mention', sequence: 1, senderName: '朋友', isMe: false,
      sendAtMillis: 1, title: '', textContent: '收到 @狗才', status: 1,
    }, {
      itemUid: 'self-mention', sequence: 2, senderName: '狗才', isMe: true,
      sendAtMillis: 2, title: '', textContent: '@🚀助手 我来处理', status: 1,
    }]

    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve(); await Promise.resolve()
    })

    const highlighted = renderer.root.findAll(node =>
      node.type === 'span' && node.props.style?.color === 'var(--dsw-alias-state-business-primary, #3964fe)',
    ).map(node => renderedText(node.children))
    expect(highlighted).toEqual(expect.arrayContaining(['@狗才', '@🚀助手']))
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
      menu.findAllByProps({ role: 'menuitem' })[4]!.props.onClick()
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
    act(() => { menu.findAllByProps({ role: 'menuitem' })[3]!.props.onClick() })
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
    expect(row.findAllByType(ArkmeTimelineMessageHeader)).toHaveLength(0)
    const messageLine = row.find(node => node.type === 'div' && node.props.style?.width === 'min(600px, 100%)')
    expect(messageLine.props.style).toMatchObject({
      gridColumn: '2', minWidth: 0, justifySelf: 'center', justifyContent: 'center', marginBottom: 0,
    })
  })

  it('hides sender and time metadata for a self-authored quick note', async () => {
    timeline = [{
      itemUid: 'own-message-without-metadata', senderName: '狗才', isMe: true,
      sendAtMillis: 1, title: '', textContent: '自己的快记', status: 1,
    }]
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />, {
        createNodeMock: element => element.props.className === 'arkme-conversation-panel'
          ? { getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }) }
          : null,
      })
      await Promise.resolve()
    })

    const row = renderer!.root.findByProps({ 'data-arkme-message-item-uid': 'own-message-without-metadata' })
    expect(row.findAllByType(ArkmeTimelineMessageHeader)).toHaveLength(0)
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

  it('requests microphone permission from the first text input instead of focus or settings load', async () => {
    const stopTrack = vi.fn()
    const getUserMedia = vi.fn(async () => ({
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream))
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 Chrome/152 Safari/537.36',
      mediaDevices: { getUserMedia },
      permissions: { query: vi.fn(async () => ({ state: 'prompt' as PermissionState })) },
    })
    const fallback = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>, signal?: AbortSignal) => {
      if (operation === 'provider.capabilities') return {
        contractVersion: 1,
        provider: '@senguoyun/dsh-arkme',
        sdk: '@senguoyun/dsh-arkme/sdk',
        environment: 'test',
        features: { backgroundSound: true },
        limits: {},
      }
      if (operation === 'settings.background-sound.get') return {
        userId: 42,
        found: true,
        enabled: true,
        eligible: true,
        memberType: 2,
        eligibilityReason: 'eligible',
      }
      return await fallback(operation, params, signal)
    })

    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    const composer = renderer!.root.findByType(ArkmeRichComposerInput)
    await act(async () => {
      composer.props.onFocus()
      await Promise.resolve()
    })
    expect(getUserMedia).not.toHaveBeenCalled()

    await act(async () => {
      composer.props.onTextChange('首')
      await new Promise(resolve => { setTimeout(resolve, 5) })
    })
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(stopTrack).toHaveBeenCalledOnce()

    await act(async () => {
      composer.props.onTextChange('首次输入')
      await Promise.resolve()
    })
    expect(getUserMedia).toHaveBeenCalledOnce()
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

  it('requests location permission on the first supported send and records that message', async () => {
    const permissionQuery = vi.fn(async () => ({ state: 'prompt' as PermissionState }))
    const getCurrentPosition = vi.fn((success: PositionCallback) => { success({
      coords: {
        latitude: 30.52, longitude: 114.31, accuracy: 18, altitude: null,
        altitudeAccuracy: null, heading: null, speed: null,
      },
      timestamp: 100,
    } as GeolocationPosition) })
    vi.stubGlobal('navigator', {
      permissions: { query: permissionQuery },
      geolocation: { getCurrentPosition },
    })
    const baseImplementation = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>, signal?: AbortSignal) => {
      if (operation === 'source.send-text') return {
        sourceRef: target.sourceRef,
        itemUid: params?.recordUid ?? 'record-new',
        status: 1,
        sequence: 9,
        localState: 'synced',
      }
      if (operation === 'source.message-location.set') return {}
      return await baseImplementation(operation, params, signal)
    })

    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    const composer = renderer!.root.findByType(ArkmeRichComposerInput)
    await act(async () => {
      composer.props.onTextChange('首条消息')
      renderer!.root.findByProps({ 'aria-label': '发送消息' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(permissionQuery).toHaveBeenCalledTimes(2)
    expect(getCurrentPosition).toHaveBeenCalledOnce()
    expect(mocks.callArkme).toHaveBeenCalledWith('source.message-location.set', {
      sourceRef: target.sourceRef,
      itemUid: 'record-new',
      location: { latitude: 30.52, longitude: 114.31, accuracyMeters: 18, capturedAtMillis: 100 },
    })
  })

  it.each([
    ['私聊', target],
    ['发给自己', sendToSelf],
  ])('automatically records an already-authorized location after a %s send without prompting during input', async (_label, selectedSource) => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => { success({
      coords: {
        latitude: 30.52, longitude: 114.31, accuracy: 18, altitude: null,
        altitudeAccuracy: null, heading: null, speed: null,
      },
      timestamp: 100,
    } as GeolocationPosition) })
    vi.stubGlobal('navigator', {
      permissions: { query: vi.fn(async () => ({ state: 'granted' })) },
      geolocation: { getCurrentPosition },
    })
    activeSource = selectedSource
    arkmeUi.selectSource(selectedSource)
    const baseImplementation = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>, signal?: AbortSignal) => {
      if (operation === 'sources.list') return {
        directory: params?.directory ?? 'root',
        items: params?.directory === 'send_to_self' ? [sendToSelf] : [other, target],
        hasMore: false,
      }
      if (operation === 'source.timeline') return { source: selectedSource, items: [], hasMore: false }
      if (operation === 'source.send-text') return {
        sourceRef: selectedSource.sourceRef,
        itemUid: params?.recordUid ?? 'record-new',
        status: 1,
        sequence: selectedSource.kind === 'private_chat' ? 9 : undefined,
        localState: 'synced',
      }
      if (operation === 'source.message-location.set') return {}
      return await baseImplementation(operation, params, signal)
    })

    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    const composer = renderer!.root.findByType(ArkmeRichComposerInput)
    await act(async () => {
      composer.props.onTextChange('自动位置')
      await Promise.resolve()
    })
    expect(getCurrentPosition).not.toHaveBeenCalled()

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '发送消息' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getCurrentPosition).toHaveBeenCalledOnce()
    expect(mocks.callArkme).toHaveBeenCalledWith('source.message-location.set', {
      sourceRef: selectedSource.sourceRef,
      itemUid: 'record-new',
      location: { latitude: 30.52, longitude: 114.31, accuracyMeters: 18, capturedAtMillis: 100 },
    })
  })

  it('keeps the immediate snapshot action while the send-to-self owner projection converges', async () => {
    activeSource = sendToSelf
    arkmeUi.selectSource(sendToSelf)
    vi.stubGlobal('HTMLElement', class { focus() {} })
    vi.stubGlobal('document', {
      activeElement: null,
      body: {},
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    const baseImplementation = mocks.callArkme.getMockImplementation()!
    const openSettings = vi.spyOn(arkmeUi, 'openDshSettings')
    let timelineCalls = 0
    let resolveRefresh!: (value: unknown) => void
    const pendingRefresh = new Promise(resolve => { resolveRefresh = resolve })
    const authoritativeItem: ArkmeTimelineItem = {
      itemUid: 'record-new', messageActionRef: 'opaque-send-to-self-message-action',
      senderName: '狗才', isMe: true, sendAtMillis: 48, title: '', textContent: '立即查看快照', status: 1,
    }
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>, signal?: AbortSignal) => {
      if (operation === 'provider.capabilities') return {
        contractVersion: 1, provider: '@senguoyun/dsh-arkme', sdk: '@senguoyun/dsh-arkme/sdk',
        environment: 'test', features: { backgroundSound: true }, limits: {},
      }
      if (operation === 'settings.background-sound.get') return {
        userId: 42, found: true, enabled: false, eligible: true, memberType: 2,
        eligibilityReason: 'eligible',
      }
      if (operation === 'sources.list') return {
        directory: params?.directory ?? 'root',
        items: params?.directory === 'send_to_self' ? [sendToSelf] : [other, target],
        hasMore: false,
      }
      if (operation === 'source.timeline') {
        timelineCalls += 1
        if (timelineCalls === 1) return { source: sendToSelf, items: [], hasMore: false }
        if (timelineCalls === 2) return await pendingRefresh
        return { source: sendToSelf, items: [authoritativeItem], hasMore: false }
      }
      if (operation === 'source.send-text') return {
        sourceRef: sendToSelf.sourceRef,
        itemUid: params?.recordUid ?? 'record-new',
        status: 1,
        localState: 'synced',
        messageActionRef: 'opaque-send-to-self-message-action',
      }
      if (operation === 'source.message-snapshot.detail') return {
        itemUid: 'record-new', textContent: '立即查看快照', recordDurationMillis: 1,
        backgroundSound: 'not-recorded', syncState: 'synced',
      }
      return await baseImplementation(operation, params, signal)
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
    const revisionBeforeSend = arkmeUi.getSnapshot()
    const composer = renderer!.root.findByType(ArkmeRichComposerInput)
    await act(async () => {
      composer.props.onTextChange('立即查看快照')
      await Promise.resolve()
      renderer!.root.findByProps({ 'aria-label': '发送消息' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(arkmeUi.getSnapshot().recordRevision).toBe(revisionBeforeSend.recordRevision + 1)
    expect(arkmeUi.getSnapshot().chatRevision).toBe(revisionBeforeSend.chatRevision)
    const openMenu = async () => {
      const line = renderer!.root.findByProps({ 'data-arkme-message-content-line': 'record-new' })
      await act(async () => {
        line.findByProps({ 'aria-label': '打开快记详情' }).props.onContextMenu({
          preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 120, clientY: 180,
        })
        await Promise.resolve()
      })
      const menu = renderer!.root.findByProps({ 'aria-label': '消息操作' })
      return menu.findAllByProps({ role: 'menuitem' }).find(button => button.findAllByType('span')
        .some(span => span.children.includes('详情')))
    }
    const detailAction = await openMenu()
    expect(detailAction).toBeDefined()
    expect(mocks.callArkme.mock.calls.some(([operation]) => operation === 'source.message-snapshot.detail')).toBe(false)
    await act(async () => {
      detailAction!.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.callArkme).toHaveBeenCalledWith('source.message-snapshot.detail', {
      sourceRef: sendToSelf.sourceRef,
      actionRef: 'opaque-send-to-self-message-action',
    }, expect.any(AbortSignal))
    expect(renderer!.root.findByProps({ 'aria-label': '快记详情' })).toBeDefined()
    const enableBackgroundSound = renderer!.root.findAll(node => node.type === 'button'
      && node.children.includes('去开启›'))[0]
    expect(enableBackgroundSound).toBeDefined()
    await act(async () => { enableBackgroundSound!.props.onClick() })
    expect(openSettings).toHaveBeenCalledOnce()
    expect(renderer!.root.findAllByProps({ 'aria-label': '快记详情' })).toHaveLength(0)
    expect(mocks.callArkme.mock.calls.some(([operation]) => operation === 'settings.background-sound.update')).toBe(false)

    await act(async () => {
      resolveRefresh({ source: sendToSelf, items: [], hasMore: false })
      await pendingRefresh
      await Promise.resolve()
    })
    expect(await openMenu()).toBeDefined()
    await act(async () => {
      arkmeUi.recordChanged()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(timelineCalls).toBe(3)
    expect(renderer!.root.findByProps({ 'data-arkme-message-content-line': 'record-new' })).toBeDefined()
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
          mentionDisplayName: 'Tison',
          mentionSecondaryName: '我的私有备注',
          displayName: '我的私有备注',
          secondaryName: 'Tison',
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
      option.findAll(node => node.type === 'span' && node.children.join('') === 'Tison（我的私有备注）').length > 0)
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
      option.findAll(node => node.type === 'span' && node.children.join('') === 'Tison（我的私有备注）').length > 0)
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
      option.findAll(node => node.type === 'span' && node.children.join('') === 'Tison（我的私有备注）').length > 0)
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

  it('opens group settings without reselecting the conversation or reloading its timeline', async () => {
    const visibleItem: ArkmeTimelineItem = {
      itemUid: 'group-settings-visible-message', sequence: 784, senderName: '我', isMe: true,
      sendAtMillis: 40, title: '', textContent: '打开设置时继续可见', status: 1,
    }
    const settingsSource = { ...group, sourceRef: 'source-group-from-settings' }
    timeline = [visibleItem]
    activeSource = group
    arkmeChatDirectory.publish([group, other])
    arkmeUi.selectSource(group)
    const baseCall = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>, signal?: AbortSignal) => {
      if (operation === 'group.settings') return {
        target: settingsSource, selfRole: 'member', selfStatus: 'active', canRename: false,
        canDissolve: false, canLeave: true, messageDnd: false,
      }
      if (operation === 'source.ai-polish.settings') return {
        sourceRef: settingsSource.sourceRef, groupName: group.displayName, enabled: false,
        canManage: false, viewerRole: 1, activeRuleName: '', updatedAtMillis: 1, rules: [],
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
    const timelineCallsBeforeOpen = mocks.callArkme.mock.calls
      .filter(([operation]) => operation === 'source.timeline').length
    const messageBeforeOpen = renderer!.root.findByProps({ 'data-arkme-message-content-line': visibleItem.itemUid })

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '群聊设置' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(renderer!.root.findByProps({ role: 'menu', 'aria-label': '群聊设置' })).toBeDefined()
    expect(renderer!.root.findByProps({ 'data-arkme-message-content-line': visibleItem.itemUid })).toBe(messageBeforeOpen)
    expect(arkmeUi.getSnapshot().selectedSource?.sourceRef).toBe(group.sourceRef)
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.timeline'))
      .toHaveLength(timelineCallsBeforeOpen)
  })

  it('does not navigate back when an earlier group settings mutation finishes after switching conversations', async () => {
    activeSource = group
    arkmeChatDirectory.publish([group, other])
    arkmeUi.selectSource(group)
    let resolveNotification: ((value: { messageDnd: boolean }) => void) | undefined
    const notificationResult = new Promise<{ messageDnd: boolean }>(resolve => { resolveNotification = resolve })
    const baseCall = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>, signal?: AbortSignal) => {
      if (operation === 'group.settings') return {
        target: group, selfRole: 'member', selfStatus: 'active', canRename: false,
        canDissolve: false, canLeave: true, messageDnd: false,
      }
      if (operation === 'source.ai-polish.settings') return {
        sourceRef: group.sourceRef, groupName: group.displayName, enabled: false,
        canManage: false, viewerRole: 1, activeRuleName: '', updatedAtMillis: 1, rules: [],
      }
      if (operation === 'group.notification.set') return await notificationResult
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
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '群聊设置' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '消息免打扰' }).props.onClick({ stopPropagation: vi.fn() })
      await Promise.resolve()
    })

    activeSource = other
    await act(async () => {
      arkmeUi.selectSource(other)
      await Promise.resolve()
      await Promise.resolve()
    })
    const timelineCallsAfterSwitch = mocks.callArkme.mock.calls
      .filter(([operation]) => operation === 'source.timeline').length
    await act(async () => {
      resolveNotification?.({ messageDnd: true })
      await notificationResult
      await Promise.resolve()
    })

    expect(arkmeUi.getSnapshot().selectedSource).toEqual(other)
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.timeline'))
      .toHaveLength(timelineCallsAfterSwitch)
  })

  it('does not navigate back when a group membership change finishes after switching conversations', async () => {
    window.confirm = vi.fn(() => true)
    activeSource = group
    arkmeChatDirectory.publish([group, other])
    arkmeUi.selectSource(group)
    let resolveLeave: ((value: { status: 'ok' }) => void) | undefined
    const leaveResult = new Promise<{ status: 'ok' }>(resolve => { resolveLeave = resolve })
    const baseCall = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>, signal?: AbortSignal) => {
      if (operation === 'group.settings') return {
        target: group, selfRole: 'member', selfStatus: 'active', canRename: false,
        canDissolve: false, canLeave: true, messageDnd: false,
      }
      if (operation === 'source.ai-polish.settings') return {
        sourceRef: group.sourceRef, groupName: group.displayName, enabled: false,
        canManage: false, viewerRole: 1, activeRuleName: '', updatedAtMillis: 1, rules: [],
      }
      if (operation === 'group.leave') return await leaveResult
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
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '群聊设置' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    const leaveButton = renderer!.root.findAllByProps({ role: 'menuitem' }).find(node =>
      node.findAll(child => child.children.includes('退出群聊')).length > 0)
    expect(leaveButton).toBeDefined()
    await act(async () => {
      leaveButton!.props.onClick()
      await Promise.resolve()
    })

    activeSource = other
    await act(async () => {
      arkmeUi.selectSource(other)
      await Promise.resolve()
      await Promise.resolve()
    })
    const timelineCallsAfterSwitch = mocks.callArkme.mock.calls
      .filter(([operation]) => operation === 'source.timeline').length
    await act(async () => {
      resolveLeave?.({ status: 'ok' })
      await leaveResult
      await Promise.resolve()
    })

    expect(arkmeUi.getSnapshot().selectedSource).toEqual(other)
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.timeline'))
      .toHaveLength(timelineCallsAfterSwitch)
  })

  it('applies a group notification projection without replacing the timeline', async () => {
    const visibleItem: ArkmeTimelineItem = {
      itemUid: 'group-notification-visible-message', sequence: 784, senderName: '我', isMe: true,
      sendAtMillis: 40, title: '', textContent: '切换免打扰时继续可见', status: 1,
    }
    timeline = [visibleItem]
    activeSource = group
    arkmeChatDirectory.publish([group, other])
    arkmeUi.selectSource(group)
    const baseCall = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>, signal?: AbortSignal) => {
      if (operation === 'group.settings') return {
        target: { ...group, sourceRef: 'source-group-settings-capability' },
        selfRole: 'member', selfStatus: 'active', canRename: false,
        canDissolve: false, canLeave: true, messageDnd: false,
      }
      if (operation === 'source.ai-polish.settings') return {
        sourceRef: group.sourceRef, groupName: group.displayName, enabled: false,
        canManage: false, viewerRole: 1, activeRuleName: '', updatedAtMillis: 1, rules: [],
      }
      if (operation === 'group.notification.set') return { messageDnd: true }
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
    const timelineCallsBeforeMutation = mocks.callArkme.mock.calls
      .filter(([operation]) => operation === 'source.timeline').length
    const messageBeforeMutation = renderer!.root.findByProps({ 'data-arkme-message-content-line': visibleItem.itemUid })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '群聊设置' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '消息免打扰' }).props.onClick({ stopPropagation: vi.fn() })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(arkmeUi.getSnapshot().selectedSource).toMatchObject({
      sourceKey: group.sourceKey,
      sourceRef: group.sourceRef,
      displayName: group.displayName,
      latestPreview: group.latestPreview,
      latestSequence: group.latestSequence,
      isMuted: true,
    })
    expect(renderer!.root.findByProps({ 'data-arkme-message-content-line': visibleItem.itemUid })).toBe(messageBeforeMutation)
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.timeline'))
      .toHaveLength(timelineCallsBeforeMutation)
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
          memberRef: 'member-b', mentionRef: 'mention-b', mentionDisplayName: 'B 成员', displayName: 'B 成员',
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
          memberRef: 'member-a', mentionRef: 'mention-a', mentionDisplayName: 'A 成员', displayName: 'A 成员',
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

  it('cancels a pending member private-chat open when the selected conversation changes or the card closes', async () => {
    const groupA: ArkmeSourceItem = {
      ...group, sourceRef: 'source-private-open-a', sourceKey: 'chat:private-open-a', displayName: 'A 群', latestSequence: 1,
    }
    const groupB: ArkmeSourceItem = {
      ...group, sourceRef: 'source-private-open-b', sourceKey: 'chat:private-open-b', displayName: 'B 群', latestSequence: 1,
    }
    const groupARotatedRef: ArkmeSourceItem = { ...groupA, sourceRef: 'source-private-open-a-rotated' }
    const member: ArkmeConversationMemberItem = {
      memberRef: 'member-private-open-a', displayName: 'A 成员', role: 'member', status: 'active',
      isSelf: false, isOwner: false, joinedAtMillis: 1, recordCount: 0, mentionCount: 0,
    }
    const message: ArkmeTimelineItem = {
      itemUid: 'message-private-open-a', memberRef: member.memberRef, senderName: member.displayName,
      isMe: false, sendAtMillis: 1, title: '', textContent: '你好', status: 1, sequence: 1,
    }
    let resolvePrivateOpen: ((value: unknown) => void) | undefined
    let pendingPrivateOpen: Promise<unknown> = new Promise(resolve => { resolvePrivateOpen = resolve })
    const privateOpenSignals: AbortSignal[] = []
    arkmeChatDirectory.clear()
    arkmeChatDirectory.activateAccount(42)
    arkmeChatDirectory.publish([groupA, groupB])
    arkmeUi.selectSource(groupA)
    mocks.callArkme.mockImplementation(async (
      operation: string,
      params?: Record<string, unknown>,
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
      if (operation === 'source.members') return {
        source: params?.sourceRef === groupB.sourceRef ? groupB : groupARotatedRef,
        items: params?.sourceRef === groupB.sourceRef ? [] : [member],
        total: params?.sourceRef === groupB.sourceRef ? 0 : 1,
        activeCount: params?.sourceRef === groupB.sourceRef ? 0 : 1,
      }
      if (operation === 'source.timeline') return {
        source: params?.sourceRef === groupB.sourceRef ? groupB : groupARotatedRef,
        items: params?.sourceRef === groupB.sourceRef ? [] : [message],
        hasMore: false,
      }
      if (operation === 'source.interwoven-moments') return { state: 'disabled', moments: [], preparedAtMillis: 48 }
      if (operation === 'chat.member.private.open') {
        if (signal !== undefined) privateOpenSignals.push(signal)
        return await pendingPrivateOpen
      }
      throw new Error(`unexpected operation ${operation}`)
    })

    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '查看 A 成员' }).props.onClick({ stopPropagation: vi.fn() })
      await Promise.resolve()
    })
    const idleButton = renderer!.root.findByProps({ 'data-arkme-profile-send-state': 'idle' })
    await act(async () => {
      idleButton.props.onClick()
      idleButton.props.onClick()
      await Promise.resolve()
    })
    const busyButton = renderer!.root.findByProps({ 'data-arkme-profile-send-state': 'loading' })
    expect(busyButton.props.disabled).toBe(true)
    await act(async () => {
      busyButton.props.onClick()
      await Promise.resolve()
    })
    expect(mocks.callArkme.mock.calls.filter(call => call[0] === 'chat.member.private.open')).toHaveLength(1)
    expect(privateOpenSignals).toHaveLength(1)

    await act(async () => {
      arkmeUi.selectSource(groupARotatedRef)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(privateOpenSignals[0]?.aborted).toBe(false)

    await act(async () => {
      arkmeUi.selectSource(groupB)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(privateOpenSignals[0]?.aborted).toBe(true)

    await act(async () => {
      resolvePrivateOpen?.({
        source: {
          sourceRef: 'late-private-source', sourceKey: 'chat:late-private', kind: 'private_chat',
          displayName: 'A 成员', activeAtMillis: 2, unreadCount: 0,
        },
      })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(arkmeUi.getSnapshot().selectedSource?.sourceKey).toBe(groupB.sourceKey)

    pendingPrivateOpen = new Promise(resolve => { resolvePrivateOpen = resolve })
    await act(async () => {
      arkmeUi.selectSource(groupA)
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '查看 A 成员' }).props.onClick({ stopPropagation: vi.fn() })
      await Promise.resolve()
      renderer!.root.findByType(ArkmeMemberProfileCard).props.onSend()
      await Promise.resolve()
    })
    expect(privateOpenSignals).toHaveLength(2)
    await act(async () => {
      renderer!.root.findByType(ArkmeMemberProfileCard).props.onClose()
      await Promise.resolve()
    })
    expect(privateOpenSignals[1]?.aborted).toBe(true)
    expect(renderer!.root.findAllByType(ArkmeMemberProfileCard)).toHaveLength(0)

    await act(async () => {
      resolvePrivateOpen?.({
        source: {
          sourceRef: 'closed-card-private-source', sourceKey: 'chat:closed-card-private', kind: 'private_chat',
          displayName: 'A 成员', activeAtMillis: 3, unreadCount: 0,
        },
      })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(arkmeUi.getSnapshot().selectedSource?.sourceKey).toBe(groupA.sourceKey)
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
            memberRef: 'member-account-b', mentionRef: 'mention-account-b',
            mentionDisplayName: '账号 B 成员', displayName: '账号 B 成员',
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
          memberRef: 'member-account-a', mentionRef: 'mention-account-a',
          mentionDisplayName: '账号 A 成员', displayName: '账号 A 成员',
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

  it('switches the current conversation composer into source-message extension mode without opening the detail drawer', async () => {
    timeline = [{
      itemUid: 'extension-source', messageActionRef: 'opaque-extension-action',
      senderName: '小林', isMe: false, sendAtMillis: 1, title: '', textContent: '这个谁解答一下', status: 1,
      contentBlocks: [{
        kind: 'image', mediaRef: 'opaque-image', fileName: 'question.png', mimeType: 'image/png', size: 12, sortOrder: 0,
      }],
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
      bubble.props.onContextMenu({ preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 120, clientY: 180 })
    })
    const menu = renderer!.root.findByProps({ 'aria-label': '消息操作' })
    const extendAction = menu.findAll(node => node.props.role === 'menuitem'
      && node.findAll(child => child.children.includes('延展')).length > 0)[0]
    expect(extendAction).toBeDefined()
    await act(async () => { extendAction!.props.onClick(); await Promise.resolve() })

    expect(renderer!.root.findAllByProps({ 'data-arkme-note-detail': 'true' })).toHaveLength(0)
    const targetPreview = renderer!.root.findByProps({ 'data-arkme-composer-extension-target': 'true' })
    expect(targetPreview.findAll(node => node.children.includes('这个谁解答一下')).length).toBeGreaterThan(0)
    expect(targetPreview.findAll(node => node.children.includes('question.png')).length).toBeGreaterThan(0)
    expect(targetPreview.props.style).toMatchObject({
      margin: 0,
      borderRadius: '12px 12px 0 0',
      borderBottom: 0,
      background: 'var(--dsw-alias-fill-secondary, var(--dsw-alias-bg-module-platform, #f2f2f2))',
      boxShadow: 'inset 0 -1px 0 var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.10))',
    })
    expect(targetPreview.findAll(node => node.children.some(child => typeof child === 'string' && child.includes('正在延展')))).toHaveLength(0)
    const destinationHint = renderer!.root.findByProps({ 'data-arkme-composer-destination-hint': 'true' })
    expect(destinationHint.findAll(node => node.children.includes('正在给 '))).toHaveLength(1)
    expect(destinationHint.findAll(node => node.children.includes('Harness4')).length).toBeGreaterThan(0)
    expect(destinationHint.findAll(node => node.children.includes(' 发消息'))).toHaveLength(1)
    const composerSurface = renderer!.root.findByProps({ className: 'arkme-conversation-composer-inner' })
    expect(composerSurface.props.style).toMatchObject({
      borderRadius: '0 0 15px 15px',
      background: 'var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-2, #ffffff))',
    })
    const composer = renderer!.root.findByType(ArkmeRichComposerInput)
    expect(composer.props.placeholder).toBe('发送到「Harness4」…')
    await act(async () => { composer.props.onTextChange('我的补充'); await Promise.resolve() })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '发送消息' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith('source.message-extension.extend', {
      sourceRef: 'source-harness',
      messageActionRef: 'opaque-extension-action',
      textContent: '我的补充',
      recordUid: 'record-new',
      relationUid: 'relation-new',
      fileRefs: [],
    })
    expect(renderer!.root.findAllByProps({ 'data-arkme-composer-extension-target': 'true' })).toHaveLength(0)
    expect(renderer!.root.findByType(ArkmeRichComposerInput).props.placeholder).toBe('发消息给@Harness…')
  })

  it('omits the non-text fallback label when extending an attachment-only quick note', async () => {
    timeline = [{
      itemUid: 'extension-image-source', messageActionRef: 'opaque-extension-image-action',
      senderName: '小林', isMe: false, sendAtMillis: 1, title: '', textContent: '', status: 1,
      contentBlocks: [{
        kind: 'image', mediaRef: 'opaque-image', fileName: 'question.png', mimeType: 'image/png', size: 12, sortOrder: 0,
      }],
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
    act(() => bubble.props.onContextMenu({ preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 120, clientY: 180 }))
    const menu = renderer!.root.findByProps({ 'aria-label': '消息操作' })
    const extendAction = menu.findAll(node => node.props.role === 'menuitem'
      && node.findAll(child => child.children.includes('延展')).length > 0)[0]!
    await act(async () => { extendAction.props.onClick(); await Promise.resolve() })

    const targetPreview = renderer!.root.findByProps({ 'data-arkme-composer-extension-target': 'true' })
    expect(targetPreview.findAll(node => node.children.includes('非文本快记'))).toHaveLength(0)
    expect(targetPreview.findAll(node => node.children.includes('question.png')).length).toBeGreaterThan(0)
  })

  it('uses the desktop six-node extension icon in the message action menu', async () => {
    timeline = [{
      itemUid: 'extension-icon-source', messageActionRef: 'opaque-extension-icon-action',
      senderName: '小林', isMe: false, sendAtMillis: 1, title: '', textContent: '测试', status: 1,
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
    act(() => bubble.props.onContextMenu({ preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 120, clientY: 180 }))

    const icon = renderer!.root.findByProps({ 'data-arkme-message-extension-icon': 'desktop' })
    expect(icon.props.viewBox).toBe('0 0 16 16')
    expect(icon.findAllByType('circle')).toHaveLength(5)
    expect(icon.findAllByType('path')).toHaveLength(2)
  })

  it('shows a successful private-chat extension as a desktop-style compound message', async () => {
    timeline = [{
      itemUid: 'extension-parent', messageActionRef: 'opaque-extension-parent-action',
      senderName: '小林', isMe: false, sendAtMillis: 1, title: '', textContent: '原消息内容', status: 1,
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
    act(() => bubble.props.onContextMenu({ preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 120, clientY: 180 }))
    const menu = renderer!.root.findByProps({ 'aria-label': '消息操作' })
    const extendAction = menu.findAll(node => node.props.role === 'menuitem'
      && node.findAll(child => child.children.includes('延展')).length > 0)[0]!
    await act(async () => { extendAction.props.onClick(); await Promise.resolve() })
    await act(async () => {
      renderer!.root.findByType(ArkmeRichComposerInput).props.onTextChange('延展正文')
      await Promise.resolve()
    })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '发送消息' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    const sentRow = renderer!.root.findByProps({ 'data-arkme-message-item-uid': 'record-new' })
    expect(sentRow.findAll(node => node.children.includes('延展正文')).length).toBeGreaterThan(0)
    const extensionCluster = sentRow.findByProps({ 'data-arkme-extension-message-cluster': 'true' })
    expect(extensionCluster.props.style).toMatchObject({ alignItems: 'flex-end', gap: 0 })
    const parentPreview = sentRow.findByProps({ 'data-arkme-extension-parent-preview': 'extension-parent' })
    expect(parentPreview.findAll(node => node.children.includes('原消息内容')).length).toBeGreaterThan(0)
    expect(parentPreview.props.style).toMatchObject({
      marginRight: 44,
      background: 'linear-gradient(180deg, var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-1, #f5f6f8)) 0%, transparent 68.06%)',
    })
    const childLine = extensionCluster.findByProps({ 'data-arkme-extension-child-line': 'true' })
    expect(childLine.props.style).toMatchObject({ flexDirection: 'row-reverse', gap: 10 })
    expect(extensionCluster.findAllByType(ArkmeTimelineMessageHeader)).toHaveLength(0)
    expect(childLine.findByProps({ 'data-arkme-message-content-line': 'record-new' })).toBeDefined()
    expect(childLine.findAllByProps({ 'data-arkme-extension-parent-preview': 'extension-parent' })).toHaveLength(0)
  })

  it('aligns a received extension preview with the sender and content column', async () => {
    timeline = [{
      itemUid: 'received-extension-child', senderName: '同事', isMe: false, sendAtMillis: 12,
      title: '', textContent: '补充内容', status: 1,
      extensionParentRecordUid: 'received-extension-parent',
      extensionParent: {
        itemUid: 'received-extension-parent', senderName: '同事', title: '', textContent: '原快记',
        recordOwnerUserId: 7, sequence: 11, sendAtMillis: 11,
      },
    }]
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />, {
        createNodeMock: element => element.props.className === 'arkme-conversation-panel'
          ? { getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }) }
          : null,
      })
      await Promise.resolve()
    })

    const row = renderer!.root.findByProps({ 'data-arkme-message-item-uid': 'received-extension-child' })
    const preview = row.findByProps({ 'data-arkme-extension-parent-preview': 'received-extension-parent' })
    expect(preview.props.style.marginLeft).toBe(44)
    const childLine = row.findByProps({ 'data-arkme-extension-child-line': 'true' })
    expect(childLine.findAllByType(ArkmeTimelineMessageHeader)).toHaveLength(1)
  })

  it('uses a pointer cursor for a clickable extension parent preview', async () => {
    timeline = [{
      itemUid: 'extension-child', senderName: '我', isMe: true, sendAtMillis: 12,
      title: '', textContent: '延展内容', status: 1, sequence: 12,
      extensionParentRecordUid: 'extension-parent-old',
      extensionParent: {
        itemUid: 'extension-parent-old', senderName: '同事', title: '', textContent: '较早的原快记',
        recordOwnerUserId: 7, sequence: 11, sendAtMillis: 11,
      },
    }]
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />, {
        createNodeMock: element => element.props.className === 'arkme-conversation-panel'
          ? { getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }) }
          : null,
      })
      await Promise.resolve()
    })

    const parentPreview = renderer!.root.findByProps({
      'data-arkme-extension-parent-preview': 'extension-parent-old',
    })
    expect(parentPreview.props.role).toBe('button')
    expect(parentPreview.props.style.cursor).toBe('pointer')
  })

  it('centers the around-loaded extension parent in the conversation viewport', async () => {
    timeline = [{
      itemUid: 'extension-child', senderName: '我', isMe: true, sendAtMillis: 12,
      title: '', textContent: '延展内容', status: 1, sequence: 12,
      extensionParentRecordUid: 'extension-parent-old',
      extensionParent: {
        itemUid: 'extension-parent-old', senderName: '同事', title: '', textContent: '较早的原快记',
        recordOwnerUserId: 7, sequence: 11, sendAtMillis: 11,
      },
    }]
    aroundTimeline = [{
      itemUid: 'before-parent', senderName: '同事', isMe: false, sendAtMillis: 10,
      title: '', textContent: '更早', status: 1, sequence: 10,
    }, {
      itemUid: 'extension-parent-old', senderName: '同事', isMe: false, sendAtMillis: 11,
      title: '', textContent: '较早的原快记', status: 1, sequence: 11,
    }, timeline[0]!]
    const scrollTo = vi.fn()
    const targetRow = {
      dataset: {
        arkmeConversationRow: 'message:extension-parent-old',
        arkmeMessageItemUid: 'extension-parent-old',
      },
      getBoundingClientRect: () => {
        const top = 490 - conversationBody.scrollTop
        return { left: 0, top, right: 600, bottom: top + 80, width: 600, height: 80 }
      },
    }
    const conversationBody = {
      scrollTop: 40,
      scrollHeight: 1_500,
      clientHeight: 600,
      scrollTo,
      querySelectorAll: vi.fn(() => [targetRow]),
      getBoundingClientRect: () => ({ left: 0, top: 100, right: 600, bottom: 700, width: 600, height: 600 }),
    }
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />, {
        createNodeMock: element => {
          if (element.props.className === 'arkme-conversation-panel') {
            return { getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }) }
          }
          if (element.props.className === 'arkme-conversation-body') return conversationBody
          return null
        },
      })
      await Promise.resolve(); await Promise.resolve()
    })

    const parentPreview = renderer!.root.findByProps({ 'data-arkme-extension-parent-preview': 'extension-parent-old' })
    await act(async () => {
      parentPreview.props.onClick()
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith('source.timeline-around', {
      sourceRef: 'source-harness', itemUid: 'extension-parent-old', recordOwnerUserId: 7,
      beforeLimit: 20, afterLimit: 20,
    }, expect.any(AbortSignal))
    expect(renderer!.root.findByProps({ 'data-arkme-message-item-uid': 'extension-parent-old' })).toBeDefined()
    expect(scrollTo).toHaveBeenCalledWith({ top: 130, behavior: 'auto' })
  })

  it('keeps an around-loaded locate window continuous when the latest realtime item is retained', async () => {
    const latestExtension: ArkmeTimelineItem = {
      itemUid: 'extension-child-latest', senderName: '我', isMe: true, sendAtMillis: 50,
      title: '', textContent: '当前延展内容', status: 1, sequence: 50,
      extensionParentRecordUid: 'extension-parent-old',
      extensionParent: {
        itemUid: 'extension-parent-old', senderName: '同事', title: '', textContent: '较早的原快记',
        recordOwnerUserId: 7, sequence: 11, sendAtMillis: 11,
      },
    }
    timeline = [latestExtension]
    aroundTimeline = [{
      itemUid: 'before-parent', senderName: '同事', isMe: false, sendAtMillis: 10,
      title: '', textContent: '更早', status: 1, sequence: 10,
    }, {
      itemUid: 'extension-parent-old', senderName: '同事', isMe: false, sendAtMillis: 11,
      title: '', textContent: '较早的原快记', status: 1, sequence: 11,
    }, {
      itemUid: 'after-parent', senderName: '同事', isMe: false, sendAtMillis: 12,
      title: '', textContent: '稍后', status: 1, sequence: 12,
    }]
    arkmeChatTimelineDelta.publish([{ source: target, items: [latestExtension] }])
    const scrollTo = vi.fn()
    const targetRow = {
      dataset: {
        arkmeConversationRow: 'message:extension-parent-old',
        arkmeMessageItemUid: 'extension-parent-old',
      },
      getBoundingClientRect: () => {
        const top = 390 - conversationBody.scrollTop
        return { left: 0, top, right: 600, bottom: top + 80, width: 600, height: 80 }
      },
    }
    const conversationBody = {
      scrollTop: 0,
      scrollHeight: 1_500,
      clientHeight: 600,
      scrollTo,
      querySelectorAll: vi.fn(() => [targetRow]),
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, bottom: 600, width: 600, height: 600 }),
    }
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />, {
        createNodeMock: element => {
          if (element.props.className === 'arkme-conversation-panel') {
            return { getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }) }
          }
          if (element.props.className === 'arkme-conversation-body') return conversationBody
          return null
        },
      })
      await Promise.resolve(); await Promise.resolve()
    })

    const parentPreview = renderer!.root.findByProps({
      'data-arkme-extension-parent-preview': 'extension-parent-old',
    })
    await act(async () => {
      parentPreview.props.onClick()
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })

    const visibleItemUids = renderer!.root
      .findAll(node => typeof node.props['data-arkme-message-item-uid'] === 'string')
      .map(node => node.props['data-arkme-message-item-uid'])
    expect(visibleItemUids).toEqual(['before-parent', 'extension-parent-old', 'after-parent'])
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ top: 130, behavior: 'auto' })
  })

  it('does not let an older background latest response replace an installed around window', async () => {
    const latestExtension: ArkmeTimelineItem = {
      itemUid: 'extension-child-latest', senderName: '我', isMe: true, sendAtMillis: 50,
      title: '', textContent: '当前延展内容', status: 1, sequence: 50,
      extensionParentRecordUid: 'extension-parent-old',
      extensionParent: {
        itemUid: 'extension-parent-old', senderName: '同事', title: '', textContent: '较早的原快记',
        recordOwnerUserId: 7, sequence: 11, sendAtMillis: 11,
      },
    }
    timeline = [latestExtension]
    aroundTimeline = [{
      itemUid: 'before-parent', senderName: '同事', isMe: false, sendAtMillis: 10,
      title: '', textContent: '更早', status: 1, sequence: 10,
    }, {
      itemUid: 'extension-parent-old', senderName: '同事', isMe: false, sendAtMillis: 11,
      title: '', textContent: '较早的原快记', status: 1, sequence: 11,
    }, {
      itemUid: 'after-parent', senderName: '同事', isMe: false, sendAtMillis: 12,
      title: '', textContent: '稍后', status: 1, sequence: 12,
    }]
    const conversationBody = {
      scrollTop: 0, scrollHeight: 1_500, clientHeight: 600, scrollTo: vi.fn(),
      querySelectorAll: vi.fn(() => renderer?.root.findAllByProps({
        'data-arkme-message-item-uid': 'extension-parent-old',
      }).length === 1 ? [{
          dataset: { arkmeMessageItemUid: 'extension-parent-old' },
          getBoundingClientRect: () => ({ left: 0, top: 300, right: 600, bottom: 380, width: 600, height: 80 }),
        }] : []),
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, bottom: 600, width: 600, height: 600 }),
    }
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />, {
        createNodeMock: element => element.props.className === 'arkme-conversation-body'
          ? conversationBody
          : element.props.className === 'arkme-conversation-panel'
            ? { getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }) }
            : null,
      })
      await Promise.resolve(); await Promise.resolve()
    })

    const staleLatest = deferred<unknown>()
    const previousImplementation = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation: string, params?: unknown, signal?: AbortSignal) => {
      if (operation === 'source.timeline' && (params as { cursor?: unknown } | undefined)?.cursor === undefined) {
        return await staleLatest.promise
      }
      return await previousImplementation(operation, params, signal)
    })
    await act(async () => {
      arkmeUi.chatChanged()
      await Promise.resolve(); await Promise.resolve()
    })
    const parentPreview = renderer!.root.findByProps({
      'data-arkme-extension-parent-preview': 'extension-parent-old',
    })
    await act(async () => {
      parentPreview.props.onClick()
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })
    await act(async () => {
      staleLatest.resolve({ source: target, items: [latestExtension], hasMore: false })
      await staleLatest.promise
      await Promise.resolve(); await Promise.resolve()
    })

    const visibleItemUids = renderer!.root
      .findAll(node => typeof node.props['data-arkme-message-item-uid'] === 'string')
      .map(node => node.props['data-arkme-message-item-uid'])
    expect(visibleItemUids).toEqual(['before-parent', 'extension-parent-old', 'after-parent'])
    expect(conversationBody.scrollTo).toHaveBeenCalledTimes(1)
  })

  it('does not start a background latest refresh while an around request is pending', async () => {
    const latestExtension: ArkmeTimelineItem = {
      itemUid: 'extension-child-latest', senderName: '我', isMe: true, sendAtMillis: 50,
      title: '', textContent: '当前延展内容', status: 1, sequence: 50,
      extensionParentRecordUid: 'extension-parent-old',
      extensionParent: {
        itemUid: 'extension-parent-old', senderName: '同事', title: '', textContent: '较早的原快记',
        recordOwnerUserId: 7, sequence: 11, sendAtMillis: 11,
      },
    }
    timeline = [latestExtension]
    const pendingAround = deferred<unknown>()
    const pendingLatest = deferred<unknown>()
    let pendingBackgroundCalls = 0
    const conversationBody = {
      scrollTop: 0, scrollHeight: 1_500, clientHeight: 600, scrollTo: vi.fn(),
      querySelectorAll: vi.fn(() => renderer?.root.findAllByProps({
        'data-arkme-message-item-uid': 'extension-parent-old',
      }).length === 1 ? [{
          dataset: { arkmeMessageItemUid: 'extension-parent-old' },
          getBoundingClientRect: () => ({ left: 0, top: 300, right: 600, bottom: 380, width: 600, height: 80 }),
        }] : []),
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, bottom: 600, width: 600, height: 600 }),
    }
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />, {
        createNodeMock: element => element.props.className === 'arkme-conversation-body'
          ? conversationBody
          : element.props.className === 'arkme-conversation-panel'
            ? { getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }) }
            : null,
      })
      await Promise.resolve(); await Promise.resolve()
    })
    const previousImplementation = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation: string, params?: unknown, signal?: AbortSignal) => {
      if (operation === 'source.timeline-around') return await pendingAround.promise
      if (operation === 'source.timeline' && (params as { cursor?: unknown } | undefined)?.cursor === undefined) {
        pendingBackgroundCalls += 1
        return await pendingLatest.promise
      }
      return await previousImplementation(operation, params, signal)
    })

    await act(async () => {
      renderer!.root.findByProps({ 'data-arkme-extension-parent-preview': 'extension-parent-old' }).props.onClick()
      await Promise.resolve(); await Promise.resolve()
    })
    await act(async () => {
      arkmeUi.chatChanged()
      await Promise.resolve(); await Promise.resolve()
    })
    await act(async () => {
      pendingAround.resolve({
        source: target,
        items: [{
          itemUid: 'before-parent', senderName: '同事', isMe: false, sendAtMillis: 10,
          title: '', textContent: '更早', status: 1, sequence: 10,
        }, {
          itemUid: 'extension-parent-old', senderName: '同事', isMe: false, sendAtMillis: 11,
          title: '', textContent: '较早的原快记', status: 1, sequence: 11,
        }, {
          itemUid: 'after-parent', senderName: '同事', isMe: false, sendAtMillis: 12,
          title: '', textContent: '稍后', status: 1, sequence: 12,
        }],
        anchorItemUid: 'extension-parent-old', anchorSequence: 11, anchorIndex: 1,
        olderHasMore: false, newerHasMore: false,
      })
      await pendingAround.promise
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })
    pendingLatest.resolve({ source: target, items: [latestExtension], hasMore: false })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(pendingBackgroundCalls).toBe(0)
    expect(renderer!.root.findByProps({ 'data-arkme-message-item-uid': 'extension-parent-old' })).toBeDefined()
    expect(renderer!.root.findAllByProps({ 'data-arkme-message-item-uid': latestExtension.itemUid })).toHaveLength(0)
  })

  it('merges simultaneous older and newer around pages without cancelling either direction', async () => {
    timeline = [{
      itemUid: 'extension-child', senderName: '我', isMe: true, sendAtMillis: 50,
      title: '', textContent: '当前延展内容', status: 1, sequence: 50,
      extensionParentRecordUid: 'extension-parent-old',
      extensionParent: {
        itemUid: 'extension-parent-old', senderName: '同事', title: '', textContent: '较早的原快记',
        recordOwnerUserId: 7, sequence: 11, sendAtMillis: 11,
      },
    }]
    aroundTimeline = [{
      itemUid: 'extension-parent-old', senderName: '同事', isMe: false, sendAtMillis: 11,
      title: '', textContent: '较早的原快记', status: 1, sequence: 11,
    }, {
      itemUid: 'after-parent-12', senderName: '同事', isMe: false, sendAtMillis: 12,
      title: '', textContent: '稍后', status: 1, sequence: 12,
    }]
    aroundOlderHasMore = true
    aroundOlderCursor = { beforeSequence: 11 }
    aroundNewerHasMore = true
    aroundNewerCursor = { afterSequence: 12 }
    const olderPage = deferred<unknown>()
    const newerPage = deferred<unknown>()
    const previousImplementation = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation: string, params?: unknown, signal?: AbortSignal) => {
      const cursor = (params as { cursor?: { beforeSequence?: number; afterSequence?: number } } | undefined)?.cursor
      const pending = cursor?.beforeSequence === 11 ? olderPage : cursor?.afterSequence === 12 ? newerPage : undefined
      if (operation === 'source.timeline' && pending !== undefined) {
        signal?.addEventListener('abort', () => { pending.reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
        return await pending.promise
      }
      return await previousImplementation(operation, params, signal)
    })
    const olderObservers: IntersectionObserverCallback[] = []
    const newerObservers: IntersectionObserverCallback[] = []
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        if (options?.rootMargin === '120px 0px 0px') olderObservers.push(callback)
        if (options?.rootMargin === '0px 0px 120px') newerObservers.push(callback)
      }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return [] }
      readonly root = null
      readonly rootMargin = ''
      readonly thresholds = []
    })
    const conversationBody = {
      scrollTop: 0, scrollHeight: 1_500, clientHeight: 600, scrollTo: vi.fn(),
      querySelectorAll: vi.fn(() => renderer?.root.findAllByProps({
        'data-arkme-message-item-uid': 'extension-parent-old',
      }).length === 1 ? [{
          dataset: { arkmeMessageItemUid: 'extension-parent-old' },
          getBoundingClientRect: () => ({ left: 0, top: 300, right: 600, bottom: 380, width: 600, height: 80 }),
        }] : []),
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, bottom: 600, width: 600, height: 600 }),
    }
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />, {
        createNodeMock: element => element.props.className === 'arkme-conversation-body'
          ? conversationBody
          : element.props.className === 'arkme-conversation-panel'
            ? { getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }) }
            : element.props.style?.width === '100%' && element.props.style?.height === 1 ? {} : null,
      })
      await Promise.resolve(); await Promise.resolve()
    })
    await act(async () => {
      renderer!.root.findByProps({ 'data-arkme-extension-parent-preview': 'extension-parent-old' }).props.onClick()
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })
    expect(olderObservers).toHaveLength(1)
    expect(newerObservers).toHaveLength(1)

    act(() => {
      olderObservers.at(-1)!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
      newerObservers.at(-1)!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    })
    await act(async () => {
      newerPage.resolve({ source: target, items: [{
        itemUid: 'newer-13', senderName: '同事', isMe: false, sendAtMillis: 13,
        title: '', textContent: '更新', status: 1, sequence: 13,
      }], hasMore: true, nextCursor: { afterSequence: 13 } })
      olderPage.resolve({ source: target, items: [{
        itemUid: 'older-10', senderName: '同事', isMe: false, sendAtMillis: 10,
        title: '', textContent: '更早', status: 1, sequence: 10,
      }], hasMore: true, nextCursor: { beforeSequence: 10 } })
      await Promise.all([olderPage.promise, newerPage.promise])
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })

    expect(renderer!.root.findByProps({ 'data-arkme-message-item-uid': 'older-10' })).toBeDefined()
    expect(renderer!.root.findByProps({ 'data-arkme-message-item-uid': 'newer-13' })).toBeDefined()
    await act(async () => {
      olderObservers.at(-1)!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
      newerObservers.at(-1)!([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver)
      newerObservers.at(-1)!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })
    expect(mocks.callArkme).toHaveBeenCalledWith('source.timeline', {
      sourceRef: target.sourceRef, limit: 40, cursor: { beforeSequence: 10 },
    }, expect.any(AbortSignal))
    expect(mocks.callArkme).toHaveBeenCalledWith('source.timeline', {
      sourceRef: target.sourceRef, limit: 40, cursor: { afterSequence: 13 },
    }, expect.any(AbortSignal))
  })

  it('loads only one newer page until the bottom sentinel leaves and re-enters', async () => {
    const latestExtension: ArkmeTimelineItem = {
      itemUid: 'extension-child-latest', senderName: '我', isMe: true, sendAtMillis: 50,
      title: '', textContent: '当前延展内容', status: 1, sequence: 50,
      extensionParentRecordUid: 'extension-parent-old',
      extensionParent: {
        itemUid: 'extension-parent-old', senderName: '同事', title: '', textContent: '较早的原快记',
        recordOwnerUserId: 7, sequence: 11, sendAtMillis: 11,
      },
    }
    const page13: ArkmeTimelineItem = {
      itemUid: 'after-parent-13', senderName: '同事', isMe: false, sendAtMillis: 13,
      title: '', textContent: '更新一页', status: 1, sequence: 13,
    }
    const liveDelta: ArkmeTimelineItem = {
      itemUid: 'live-after-locate', senderName: '同事', isMe: false, sendAtMillis: 51,
      title: '', textContent: '已经回到实时窗口', status: 1, sequence: 51,
    }
    timeline = [latestExtension]
    aroundTimeline = [{
      itemUid: 'extension-parent-old', senderName: '同事', isMe: false, sendAtMillis: 11,
      title: '', textContent: '较早的原快记', status: 1, sequence: 11,
    }, {
      itemUid: 'after-parent-12', senderName: '同事', isMe: false, sendAtMillis: 12,
      title: '', textContent: '稍后', status: 1, sequence: 12,
    }]
    aroundNewerHasMore = true
    aroundNewerCursor = { afterSequence: 12 }
    newerTimelinePages.set(12, { items: [page13], hasMore: true, nextCursor: { afterSequence: 13 } })
    newerTimelinePages.set(13, { items: [latestExtension], hasMore: false })
    arkmeChatTimelineDelta.publish([{ source: target, items: [latestExtension] }])
    const newerObservers: IntersectionObserverCallback[] = []
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        if (options?.rootMargin === '0px 0px 120px') newerObservers.push(callback)
      }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return [] }
      readonly root = null
      readonly rootMargin = ''
      readonly thresholds = []
    })
    const targetRow = {
      dataset: {
        arkmeConversationRow: 'message:extension-parent-old',
        arkmeMessageItemUid: 'extension-parent-old',
      },
      getBoundingClientRect: () => {
        const top = 390 - conversationBody.scrollTop
        return { left: 0, top, right: 600, bottom: top + 80, width: 600, height: 80 }
      },
    }
    const conversationBody = {
      scrollTop: 0,
      scrollHeight: 1_500,
      clientHeight: 600,
      scrollTo: vi.fn(),
      querySelectorAll: vi.fn(() => [targetRow]),
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, bottom: 600, width: 600, height: 600 }),
    }
    const sentinel = {}
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />, {
        createNodeMock: element => {
          if (element.props.className === 'arkme-conversation-panel') {
            return { getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }) }
          }
          if (element.props.className === 'arkme-conversation-body') return conversationBody
          if (element.props.style?.width === '100%' && element.props.style?.height === 1) return sentinel
          return null
        },
      })
      await Promise.resolve(); await Promise.resolve()
    })
    const parentPreview = renderer!.root.findByProps({
      'data-arkme-extension-parent-preview': 'extension-parent-old',
    })
    await act(async () => {
      parentPreview.props.onClick()
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })

    expect(newerObservers).toHaveLength(1)
    await act(async () => {
      newerObservers.at(-1)!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })
    expect(mocks.callArkme).toHaveBeenCalledWith('source.timeline', {
      sourceRef: target.sourceRef, limit: 40, cursor: { afterSequence: 12 },
    }, expect.any(AbortSignal))
    expect(renderer!.root.findByProps({ 'data-arkme-message-item-uid': page13.itemUid })).toBeDefined()
    expect(renderer!.root.findAllByProps({ 'data-arkme-message-item-uid': latestExtension.itemUid })).toHaveLength(0)

    await act(async () => {
      newerObservers.at(-1)!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })
    expect(mocks.callArkme).not.toHaveBeenCalledWith('source.timeline', {
      sourceRef: target.sourceRef, limit: 40, cursor: { afterSequence: 13 },
    }, expect.any(AbortSignal))

    await act(async () => {
      newerObservers.at(-1)!([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver)
      newerObservers.at(-1)!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })
    expect(mocks.callArkme).toHaveBeenCalledWith('source.timeline', {
      sourceRef: target.sourceRef, limit: 40, cursor: { afterSequence: 13 },
    }, expect.any(AbortSignal))
    await act(async () => {
      arkmeChatTimelineDelta.publish([{ source: target, items: [liveDelta] }])
      await Promise.resolve()
    })
    expect(renderer!.root.findByProps({ 'data-arkme-message-item-uid': liveDelta.itemUid })).toBeDefined()
  })

  it('positions the first newly loaded newer message at the top of the conversation viewport', async () => {
    const latestExtension: ArkmeTimelineItem = {
      itemUid: 'extension-child-latest', senderName: '我', isMe: true, sendAtMillis: 50,
      title: '', textContent: '当前延展内容', status: 1, sequence: 50,
      extensionParentRecordUid: 'extension-parent-old',
      extensionParent: {
        itemUid: 'extension-parent-old', senderName: '同事', title: '', textContent: '较早的原快记',
        recordOwnerUserId: 7, sequence: 11, sendAtMillis: 11,
      },
    }
    const firstNewerItem: ArkmeTimelineItem = {
      itemUid: 'after-parent-13', senderName: '同事', isMe: false, sendAtMillis: 13,
      title: '', textContent: '本次新页第一条', status: 1, sequence: 13,
    }
    const secondNewerItem: ArkmeTimelineItem = {
      itemUid: 'after-parent-14', senderName: '同事', isMe: false, sendAtMillis: 14,
      title: '', textContent: '本次新页第二条', status: 1, sequence: 14,
    }
    timeline = [latestExtension]
    aroundTimeline = [{
      itemUid: 'extension-parent-old', senderName: '同事', isMe: false, sendAtMillis: 11,
      title: '', textContent: '较早的原快记', status: 1, sequence: 11,
    }, {
      itemUid: 'after-parent-12', senderName: '同事', isMe: false, sendAtMillis: 12,
      title: '', textContent: '稍后', status: 1, sequence: 12,
    }]
    aroundNewerHasMore = true
    aroundNewerCursor = { afterSequence: 12 }
    newerTimelinePages.set(12, {
      items: [firstNewerItem, secondNewerItem], hasMore: true, nextCursor: { afterSequence: 14 },
    })
    const newerObservers: IntersectionObserverCallback[] = []
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        if (options?.rootMargin === '0px 0px 120px') newerObservers.push(callback)
      }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return [] }
      readonly root = null
      readonly rootMargin = ''
      readonly thresholds = []
    })
    let scrollTop = 0
    const targetRow = {
      dataset: {
        arkmeConversationRow: 'message:extension-parent-old',
        arkmeMessageItemUid: 'extension-parent-old',
      },
      getBoundingClientRect: () => {
        const top = 390 - scrollTop
        return { left: 0, top, right: 600, bottom: top + 80, width: 600, height: 80 }
      },
    }
    const firstNewerRow = {
      dataset: {
        arkmeConversationRow: 'message:after-parent-13',
        arkmeMessageItemUid: 'after-parent-13',
      },
      getBoundingClientRect: () => {
        const top = 1_200 - scrollTop
        return { left: 0, top, right: 600, bottom: top + 80, width: 600, height: 80 }
      },
    }
    const newerPageRendered = () => {
      try {
        return renderer?.root.findAllByProps({
          'data-arkme-message-item-uid': firstNewerItem.itemUid,
        }).length === 1
      } catch {
        return false
      }
    }
    const conversationBody = {
      get scrollTop() { return scrollTop },
      set scrollTop(value: number) { scrollTop = value },
      get scrollHeight() { return newerPageRendered() ? 2_400 : 1_200 },
      clientHeight: 600,
      scrollTo: vi.fn((options: ScrollToOptions) => { scrollTop = options.top ?? scrollTop }),
      querySelectorAll: vi.fn(() => newerPageRendered() ? [targetRow, firstNewerRow] : [targetRow]),
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, bottom: 600, width: 600, height: 600 }),
    }
    const sentinel = {}
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />, {
        createNodeMock: element => {
          if (element.props.className === 'arkme-conversation-panel') {
            return { getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }) }
          }
          if (element.props.className === 'arkme-conversation-body') return conversationBody
          if (element.props.style?.width === '100%' && element.props.style?.height === 1) return sentinel
          return null
        },
      })
      await Promise.resolve(); await Promise.resolve()
    })
    const parentPreview = renderer!.root.findByProps({
      'data-arkme-extension-parent-preview': 'extension-parent-old',
    })
    await act(async () => {
      parentPreview.props.onClick()
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })
    scrollTop = 600
    await act(async () => {
      newerObservers.at(-1)!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })

    expect(renderer!.root.findByProps({ 'data-arkme-message-item-uid': firstNewerItem.itemUid })).toBeDefined()
    expect(firstNewerRow.getBoundingClientRect().top).toBe(conversationBody.getBoundingClientRect().top)
  })

  it('uses a layout-neutral desktop-style backdrop for a located quick note', async () => {
    timeline = [{
      itemUid: 'highlight-target', senderName: '同事', isMe: false, sendAtMillis: 11,
      title: '', textContent: '需要定位的快记', status: 1, sequence: 11,
    }]
    const targetRow = {
      dataset: { arkmeConversationRow: 'message:highlight-target', arkmeMessageItemUid: 'highlight-target' },
      getBoundingClientRect: () => ({ left: 0, top: 240, right: 600, bottom: 320, width: 600, height: 80 }),
    }
    const conversationBody = {
      scrollTop: 0,
      scrollHeight: 900,
      clientHeight: 600,
      scrollTo: vi.fn(),
      querySelectorAll: vi.fn(() => [targetRow]),
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, bottom: 600, width: 600, height: 600 }),
    }
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />, {
        createNodeMock: element => {
          if (element.props.className === 'arkme-conversation-panel') {
            return { getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }) }
          }
          if (element.props.className === 'arkme-conversation-body') return conversationBody
          return null
        },
      })
      await Promise.resolve(); await Promise.resolve()
    })

    act(() => { arkmeUi.showConversationTarget(target, 'highlight-target', 11) })

    const locatedRow = renderer!.root.findByProps({ 'data-arkme-message-item-uid': 'highlight-target' })
    expect(locatedRow.props.style).toMatchObject({
      background: 'transparent',
      position: 'relative',
      isolation: 'isolate',
      transition: 'background-color .3s ease',
    })
    expect(locatedRow.props.style.padding).toBeUndefined()
    expect(locatedRow.props.style.margin).toBeUndefined()
    expect(renderer!.root.findByProps({ 'data-arkme-highlight-backdrop': 'true' }).props.style).toMatchObject({
      position: 'absolute',
      top: -6,
      right: -6,
      bottom: 12,
      left: -6,
      background: 'var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, 0.10))',
      pointerEvents: 'none',
      zIndex: -1,
    })
    expect(locatedRow.props.style.outline).toBeUndefined()
    expect(locatedRow.props.style.borderRadius).toBeUndefined()
  })

  it('keeps a located quick note highlighted after the previous timeout window', async () => {
    vi.useFakeTimers()
    Object.assign(window, {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
    try {
      timeline = [{
        itemUid: 'persistent-highlight-target', senderName: '同事', isMe: false, sendAtMillis: 12,
        title: '', textContent: '高亮不应自动消失', status: 1, sequence: 12,
      }]
      const targetRow = {
        dataset: {
          arkmeConversationRow: 'message:persistent-highlight-target',
          arkmeMessageItemUid: 'persistent-highlight-target',
        },
        getBoundingClientRect: () => ({ left: 0, top: 240, right: 600, bottom: 320, width: 600, height: 80 }),
      }
      const conversationBody = {
        scrollTop: 0,
        scrollHeight: 900,
        clientHeight: 600,
        scrollTo: vi.fn(),
        querySelectorAll: vi.fn(() => [targetRow]),
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, bottom: 600, width: 600, height: 600 }),
      }
      await act(async () => {
        renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />, {
          createNodeMock: element => {
            if (element.props.className === 'arkme-conversation-panel') {
              return { getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }) }
            }
            if (element.props.className === 'arkme-conversation-body') return conversationBody
            return null
          },
        })
        await Promise.resolve(); await Promise.resolve()
      })

      act(() => { arkmeUi.showConversationTarget(target, 'persistent-highlight-target', 12) })
      act(() => { vi.advanceTimersByTime(2_500) })

      const highlightedRow = renderer!.root.findByProps({
        'data-arkme-message-item-uid': 'persistent-highlight-target',
      })
      expect(highlightedRow.findByProps({
        'data-arkme-highlight-backdrop': 'true',
      })).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears a located quick note highlight only when another area is pressed', async () => {
    const pointerdownListeners = new Set<(event: PointerEvent) => void>()
    vi.stubGlobal('document', {
      activeElement: null,
      body: { style: { overflow: '' } },
      addEventListener: vi.fn((type: string, listener: (event: PointerEvent) => void) => {
        if (type === 'pointerdown') pointerdownListeners.add(listener)
      }),
      removeEventListener: vi.fn((type: string, listener: (event: PointerEvent) => void) => {
        if (type === 'pointerdown') pointerdownListeners.delete(listener)
      }),
      querySelector: vi.fn(() => null),
    })
    timeline = [{
      itemUid: 'click-away-highlight-target', senderName: '同事', isMe: false, sendAtMillis: 13,
      title: '', textContent: '点击外部才取消高亮', status: 1, sequence: 13,
    }]
    const targetRow = {
      dataset: {
        arkmeConversationRow: 'message:click-away-highlight-target',
        arkmeMessageItemUid: 'click-away-highlight-target',
      },
      getBoundingClientRect: () => ({ left: 0, top: 240, right: 600, bottom: 320, width: 600, height: 80 }),
    }
    const conversationBody = {
      scrollTop: 0,
      scrollHeight: 900,
      clientHeight: 600,
      scrollTo: vi.fn(),
      querySelectorAll: vi.fn(() => [targetRow]),
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, bottom: 600, width: 600, height: 600 }),
    }
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />, {
        createNodeMock: element => {
          if (element.props.className === 'arkme-conversation-panel') {
            return { getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }) }
          }
          if (element.props.className === 'arkme-conversation-body') return conversationBody
          return null
        },
      })
      await Promise.resolve(); await Promise.resolve()
    })

    await act(async () => {
      arkmeUi.showConversationTarget(target, 'click-away-highlight-target', 13)
      await Promise.resolve()
    })
    const pointerdown = [...pointerdownListeners].at(-1)
    expect(pointerdown).toBeDefined()

    act(() => {
      pointerdown!({
        button: 0,
        target: {
          closest: () => ({
            getAttribute: (name: string) => name === 'data-arkme-message-item-uid'
              ? 'click-away-highlight-target'
              : null,
          }),
        },
      } as unknown as PointerEvent)
    })
    const highlightedRow = renderer!.root.findByProps({
      'data-arkme-message-item-uid': 'click-away-highlight-target',
    })
    expect(highlightedRow.findByProps({
      'data-arkme-highlight-backdrop': 'true',
    })).toBeDefined()

    act(() => {
      pointerdown!({ button: 0, target: { closest: () => null } } as unknown as PointerEvent)
    })
    expect(renderer!.root.findByProps({
      'data-arkme-message-item-uid': 'click-away-highlight-target',
    }).findAllByProps({ 'data-arkme-highlight-backdrop': 'true' })).toHaveLength(0)
  })

  it('projects a detail-drawer extension into the current conversation and retains it through the immediate refresh', async () => {
    timeline = [{
      itemUid: 'parent-record', messageActionRef: 'opaque-detail-extension-action',
      senderName: '小林', isMe: false, sendAtMillis: 1, title: '', textContent: '详情中的原快记', status: 1,
    }]
    vi.stubGlobal('HTMLElement', class {})
    vi.stubGlobal('document', {
      activeElement: null,
      body: { style: { overflow: '' } },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      querySelector: vi.fn(() => null),
    })
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />, {
        createNodeMock: element => element.props.className === 'arkme-conversation-panel'
          ? { getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }) }
          : null,
      })
      await Promise.resolve(); await Promise.resolve()
    })
    const bubble = renderer!.root.findByProps({ 'aria-label': '打开快记详情' })
    const trigger = {}
    await act(async () => {
      bubble.props.onKeyDown({ key: 'Enter', target: trigger, currentTarget: trigger, preventDefault: vi.fn() })
      await Promise.resolve(); await Promise.resolve()
    })
    expect(renderer!.root.findAllByProps({ 'data-arkme-note-detail': 'true' })).toHaveLength(1)
    act(() => {
      renderer!.root.findByProps({ 'aria-label': '延展此快记' }).props.onChange({ target: { value: '抽屉发送的新延展' } })
    })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '发送延展' }).props.onClick()
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })

    const sentRow = renderer!.root.findByProps({ 'data-arkme-message-item-uid': 'record-new' })
    expect(sentRow.findAll(node => node.children.includes('抽屉发送的新延展')).length).toBeGreaterThan(0)
    expect(sentRow.findByProps({ 'data-arkme-extension-parent-preview': 'parent-record' })
      .findAll(node => node.children.includes('详情中的原快记')).length).toBeGreaterThan(0)
    expect(renderer!.root.findAllByProps({
      'data-arkme-note-extension-item': 'record-new',
    })).toHaveLength(1)
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.timeline').length).toBeGreaterThan(1)
  })

  it('reuses the extension record uid after failure and removes staged attachments only after success', async () => {
    timeline = [{
      itemUid: 'extension-retry-source', messageActionRef: 'opaque-extension-retry-action',
      senderName: '小林', isMe: false, sendAtMillis: 1, title: '', textContent: '带附件的问题', status: 1,
    }]
    const uuids = [
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444',
    ]
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => uuids.shift()) })
    const defaultCall = mocks.callArkme.getMockImplementation()!
    let extensionAttempts = 0
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'source.message-extension.extend') {
        extensionAttempts += 1
        if (extensionAttempts === 1) throw new Error('网络中断')
        return {
          recordUid: params?.recordUid, parentRecordUid: 'parent-record', status: 1, localState: 'synced',
          extension: { recordUid: params?.recordUid, level: 2, sourceKind: 'record_extension', senderDisplayName: '狗才', title: '', textContent: params?.textContent, sendAtMillis: 48, templateKind: 1, displayKind: 0, officialMark: 0, mediaItems: [] },
        }
      }
      if (operation === 'files.local.remove') return {}
      return defaultCall(operation, params)
    })
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />, {
        createNodeMock: element => element.props.className === 'arkme-conversation-panel'
          ? { getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }) }
          : null,
      })
      await Promise.resolve()
    })
    const bubble = renderer!.root.findByProps({ 'aria-label': '打开快记详情' })
    act(() => bubble.props.onContextMenu({ preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 120, clientY: 180 }))
    const menu = renderer!.root.findByProps({ 'aria-label': '消息操作' })
    const extendAction = menu.findAll(node => node.props.role === 'menuitem'
      && node.findAll(child => child.children.includes('延展')).length > 0)[0]!
    await act(async () => { extendAction.props.onClick(); await Promise.resolve() })
    const draftKey = arkmeSourceComposerDraftKey(42, target)!
    arkmeComposerDraftStore.setText(draftKey, '失败后重试')
    arkmeComposerDraftStore.appendAttachments(draftKey, [{ localFile: {
      fileRef: 'arkme-file-v1.55555555-5555-4555-8555-555555555555',
      fileName: 'evidence.pdf', mimeType: 'application/pdf', size: 12, fileKind: 4,
    } }])

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '发送消息' }).props.onClick()
      await Promise.resolve(); await Promise.resolve()
    })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '发送消息' }).props.onClick()
      await Promise.resolve(); await Promise.resolve()
    })

    const extensionCalls = mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.message-extension.extend')
    expect(extensionCalls).toHaveLength(2)
    expect(extensionCalls[0]?.[1]?.recordUid).toBe('11111111-1111-4111-8111-111111111111')
    expect(extensionCalls[1]?.[1]?.recordUid).toBe(extensionCalls[0]?.[1]?.recordUid)
    expect(extensionCalls[0]?.[1]?.relationUid).toBe('22222222-2222-4222-8222-222222222222')
    expect(extensionCalls[1]?.[1]?.relationUid).toBe(extensionCalls[0]?.[1]?.relationUid)
    expect(mocks.callArkme).toHaveBeenCalledWith('files.local.remove', {
      fileRef: 'arkme-file-v1.55555555-5555-4555-8555-555555555555',
    })
  })

  it('restores the desktop composer focus fill and centered paper-plane action', async () => {
    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} productNavigation={false} />)
      await Promise.resolve()
    })

    const composer = renderer!.root.findByType(ArkmeRichComposerInput)
    let composerShell = renderer!.root.findByProps({ className: 'arkme-conversation-composer-inner' })
    let sendButton = renderer!.root.findByProps({ 'aria-label': '发送消息' })

    expect(composerShell.props.style).toMatchObject({
      background: arkmeTheme.input,
      boxShadow: 'none',
    })
    expect(composerShell.props).toMatchObject({
      'data-arkme-primary-composer': 'true',
      'data-arkme-composer-focused': 'false',
    })
    expect(sendButton.props.disabled).toBe(true)
    expect(sendButton.props.style).toMatchObject({
      width: 36,
      height: 28,
      borderRadius: 14,
      background: '#DCE1E9',
      color: '#fff',
    })

    act(() => { composer.props.onFocus() })
    composerShell = renderer!.root.findByProps({ className: 'arkme-conversation-composer-inner' })
    expect(composerShell.props.style).toMatchObject({
      background: 'color-mix(in srgb, var(--dsw-alias-bg-base, #ffffff) 97%, #000000)',
      boxShadow: 'none',
    })
    expect(composerShell.props['data-arkme-composer-focused']).toBe('true')

    await act(async () => {
      composer.props.onTextChange('继续输入')
      await Promise.resolve()
    })
    sendButton = renderer!.root.findByProps({ 'aria-label': '发送消息' })
    expect(sendButton.props.disabled).toBe(false)
    expect(sendButton.props.style).toMatchObject({ background: '#09B83E', cursor: 'pointer' })
    expect(sendButton.findByType('svg').props).toMatchObject({
      viewBox: '9.7 6.1 16 16',
      width: '16',
      height: '16',
    })
    expect(sendButton.findByType('path').props.d).toContain('M23.5521 7.04659')
  })

  it('keeps a raw URL label in a single copied quick-link detail record', async () => {
    copiedQuickLinkItems[0] = {
      ...copiedQuickLinkItems[0]!,
      textContent: '单条 https://example.com/single',
    }
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
    const link = detail.find(node => node.type === 'a' && node.props.href === 'https://example.com/single')
    expect(link.findByProps({ 'data-arkme-link-label': 'true' }).children).toEqual([
      'https://example.com/single',
    ])
  })

  it('keeps raw URL labels in multi-record and extension copied-link details', async () => {
    copiedQuickLinkItems = [
      { ...copiedQuickLinkItems[0]!, textContent: '第一条 https://example.com/first' },
      {
        ...copiedQuickLinkItems[0]!,
        senderDisplayName: '狗才',
        sendAtMillis: 1_775_399_800_000,
        textContent: '第二条 https://example.com/second',
      },
    ]
    copiedQuickLinkExtensionText = '延展 https://example.com/extension'
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
    for (const href of [
      'https://example.com/first',
      'https://example.com/second',
      'https://example.com/extension',
    ]) {
      const link = detail.find(node => node.type === 'a' && node.props.href === href)
      expect(link.findByProps({ 'data-arkme-link-label': 'true' }).children).toEqual([href])
    }
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
