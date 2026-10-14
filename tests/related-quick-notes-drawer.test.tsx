import { emojiSample } from './fixtures/emoji.js'
import { arkmeTheme } from '../src/client/arkme-theme.js'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ArkmeConversationMemberItem,
  ArkmeRelatedQuickNoteList,
  ArkmeSourceMessageExtendResult,
  ArkmeTimelineItem,
} from '../src/types.js'

const mocks = vi.hoisted(() => ({
  callArkme: vi.fn(),
  fileCapabilities: vi.fn(async () => ({ version: 1, maxFileBytes: 1_000, maxImageBytes: 1_000, maxAttachments: 9 })),
  stageFile: vi.fn(async (file: { name: string; type: string; size: number }) => ({
    fileRef: 'arkme-file-v1.11111111-1111-4111-8111-111111111111',
    fileName: file.name, mimeType: file.type, size: file.size, fileKind: 1,
  })),
  removeLocalFile: vi.fn(async () => undefined),
  openLocalFile: vi.fn(async () => ({ opened: true })),
}))

vi.mock('../src/client/api.js', () => ({
  callArkme: mocks.callArkme,
  ArkmeClientError: class ArkmeClientError extends Error {
    constructor(readonly body: { code: string; message: string; retryable: boolean }) {
      super(body.message)
    }
  },
}))

vi.mock('../src/sdk/index.js', () => ({
  createArkmeSdk: () => ({
    fileCapabilities: mocks.fileCapabilities,
    stageFile: mocks.stageFile,
    removeLocalFile: mocks.removeLocalFile,
    openLocalFile: mocks.openLocalFile,
    localFileUrl: (fileRef: string) => `/arkme-local/${fileRef}`,
  }),
}))

vi.mock('@tiptap/react', async importOriginal => {
  const actual = await importOriginal<typeof import('@tiptap/react')>()
  return { ...actual, useEditor: () => null }
})

import { ArkmeRichComposerInput } from '../src/client/ArkmeRichComposerInput.js'
import { ArkmeComposerSendButton } from '../src/client/ArkmeComposerSendButton.js'
import { ArkmeSelfRolePicker } from '../src/client/ArkmeSelfRolePicker.js'
import { ArkmeTimelineDetailDrawer } from '../src/client/ArkmeNoteDetails.js'
import { ArkmeUserAvatar } from '../src/client/ArkmeAvatar.js'
import { ArkmeTopicSourceIcon, arkmeDetailSourceBadgeStyle } from '../src/client/ArkmeDetailSourceBadgeVisuals.js'
import { ArkmeClientError } from '../src/client/api.js'

const timelineItem: ArkmeTimelineItem = {
  itemUid: 'record-source',
  messageActionRef: 'opaque-action',
  senderName: '小林',
  isMe: false,
  sendAtMillis: 1_710_000_000_000,
  title: '',
  textContent: '源快记正文',
  status: 1,
}

const relatedList: ArkmeRelatedQuickNoteList = {
  total: 2,
  items: [{
    relatedRef: 'opaque-related-b', senderName: '小林',
    sendAtMillis: 1_709_000_000_000, title: '', textPreview: '问题不大',
  }, {
    relatedRef: 'opaque-related-a', senderName: '我',
    sendAtMillis: 1_708_000_000_000, title: '', textPreview: '没什么问题',
  }],
}

describe('normal timeline related quick note drawer', () => {
  it.each([
    { sourceKind: 'send_to_self' as const, path: undefined, expected: '未指定主题', childTopic: false },
    { sourceKind: 'topic' as const, path: '产品 / 设计', expected: '产品 / 设计', childTopic: true },
  ])('shows the topic and dated replies in $sourceKind details', async ({ sourceKind, path, expected, childTopic }) => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 }
      if (operation === 'source.message-extension.context') return {
        parentRecordUid: 'record-source', extensionCount: 1,
        extensions: [{ recordUid: 'reply-1', parentRecordUid: 'record-source', level: 2,
          sourceKind: 'record_extension', senderDisplayName: '小林', title: '', textContent: '补充结论',
          sendAtMillis: 1_710_000_060_000, templateKind: 1, displayKind: 0, officialMark: 0, mediaItems: [] }],
      }
      throw new Error(`unexpected operation: ${operation}`)
    })
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeTimelineDetailDrawer
      item={timelineItem} sourceRef="source-a" sourceKind={sourceKind}
      {...(path === undefined ? {} : { selfTopicPath: path })}
      {...(childTopic ? { selfTopicSource: { sourceRef: 'child-topic', kind: 'topic', displayName: '设计' } as never } : {})}
      showOriginal={false} onClose={() => {}} onToggleOriginal={() => {}} />) })
    expect(view.root.findByProps({ 'data-arkme-detail-self-topic': true })).toBeDefined()
    expect(view.root.findByProps({ 'data-arkme-note-extension-item': 'reply-1' })).toBeDefined()
    const html = JSON.stringify(view.toJSON())
    expect(html).toContain(expected)
    expect(html).toContain('补充结论')
    expect(html).toContain('2024')
    act(() => view.unmount())
  })

  it.each(['embedding', 'search_fallback', 'unavailable', 'recovery-network-failure'] as const)('keeps an empty %s response silent in the actual drawer', async mode => {
    vi.useFakeTimers()
    let reads = 0
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.message-extension.context') return { parentRecordUid: 'record-source', extensionCount: 0, extensions: [] }
      if (operation === 'source.related-quick-notes.from-message') {
        reads++
        if (mode === 'recovery-network-failure' && reads === 2) throw new TypeError('network unavailable')
        return { total: 0, items: [], recallMode: mode === 'recovery-network-failure' ? 'search_fallback' : mode, retryable: mode !== 'embedding', retryAfterMillis: 1500 }
      }
      throw new Error(`unexpected operation: ${operation}`)
    })
    let view: ReactTestRenderer | undefined
    try {
      await act(async () => { view = create(<ArkmeTimelineDetailDrawer item={timelineItem}
        sourceRef="source-a" sourceKind="send_to_self" showOriginal={false} onClose={() => {}} onToggleOriginal={() => {}} />) })
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(reads).toBe(mode === 'embedding' ? 1 : 2)
      expect(view!.root.findAllByProps({ 'data-arkme-related-quick-notes-error': true })).toHaveLength(0)
      expect(view!.root.findAllByProps({ 'data-arkme-related-quick-notes-card': true })).toHaveLength(0)
      const html = JSON.stringify(view!.toJSON())
      expect(html).toContain('源快记正文')
      for (const text of ['暂未找到相关快记', '相关快记暂时不可用', '相关结果可能不完整']) expect(html).not.toContain(text)
      expect(view!.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
      expect(view!.root.findAllByProps({ role: 'alertdialog' })).toHaveLength(0)
    } finally {
      if (view) act(() => view!.unmount())
      vi.useRealTimers()
    }
  })

  it('keeps the owning topic in full detail even when the timeline hides its redundant badge', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => operation === 'source.message-extension.context'
      ? { parentRecordUid: 'record-source', extensionCount: 0, extensions: [] }
      : { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 })
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeTimelineDetailDrawer
      item={timelineItem} sourceRef="current-topic" sourceKind="topic" selfTopicPath="产品"
      showOriginal={false} onClose={() => {}} onToggleOriginal={() => {}} />) })
    expect(view.root.findAllByProps({ 'data-arkme-detail-self-topic': true })).toHaveLength(1)
    expect(JSON.stringify(view.toJSON())).toContain('产品')
    act(() => view.unmount())
  })

  it.each(['send_to_self', 'topic'] as const)('does not reserve an empty reply section for $sourceKind', async sourceKind => {
    mocks.callArkme.mockImplementation(async (operation: string) => operation === 'source.message-extension.context'
      ? { parentRecordUid: 'record-source', extensionCount: 0, extensions: [] }
      : { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 })
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeTimelineDetailDrawer item={timelineItem}
      sourceRef="source-a" sourceKind={sourceKind} showOriginal={false} onClose={() => {}} onToggleOriginal={() => {}} />) })
    expect(view.root.findAllByProps({ 'aria-label': '快记延展列表' })).toHaveLength(0)
    expect(JSON.stringify(view.toJSON())).not.toContain('暂无延展回复')
    expect(JSON.stringify(view.toJSON())).not.toContain('延展回复')
    act(() => view.unmount())
  })

  it.each(['send_to_self', 'default_category', 'topic'] as const)('uses the current account avatar in %s while retaining the recorded nickname', async sourceKind => {
    mocks.callArkme.mockImplementation(async (operation: string) => operation === 'source.message-extension.context'
      ? { parentRecordUid: 'record-source', extensionCount: 0, extensions: [] }
      : { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 })
    const currentSelfProfile = {
      userId: 42, displayName: '现在的昵称', nickname: '现在的昵称', avatarRef: 'current-avatar-ref',
      arkmeId: 'sample', accountType: 1, createdAt: 1,
      bindings: { apple: false, wechat: false, google: false }, contact: {},
    }
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeTimelineDetailDrawer
      item={{ ...timelineItem, isMe: true, senderName: '我', avatarSnapshot: true }}
      currentSelfProfile={currentSelfProfile} sourceRef="source-a" sourceKind={sourceKind}
      showOriginal={false} onClose={() => {}} onToggleOriginal={() => {}} />) })
    let header = view.root.findByProps({ 'data-arkme-detail-author': true })
    expect(JSON.stringify(view.toJSON())).toContain('现在的昵称')
    expect(JSON.stringify(view.toJSON())).not.toContain('当前资料')
    expect(header.findByType(ArkmeUserAvatar).props.avatarRef).toBe('current-avatar-ref')
    await act(async () => view.update(<ArkmeTimelineDetailDrawer
      item={{ ...timelineItem, isMe: true, avatarSnapshot: true, senderName: '当时的昵称', senderNameSnapshot: true, avatarRef: 'old-avatar-ref' }}
      currentSelfProfile={currentSelfProfile} sourceRef="source-a" sourceKind={sourceKind}
      showOriginal={false} onClose={() => {}} onToggleOriginal={() => {}} />))
    header = view.root.findByProps({ 'data-arkme-detail-author': true })
    expect(JSON.stringify(view.toJSON())).toContain('当时的昵称')
    expect(JSON.stringify(view.toJSON())).not.toContain('当前资料')
    expect(header.findByType(ArkmeUserAvatar).props.avatarRef).toBe('current-avatar-ref')
    act(() => view.unmount())
  })

  it('updates a self detail without snapshot flags when the current profile arrives', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => operation === 'source.message-extension.context'
      ? { parentRecordUid: 'record-source', extensionCount: 0, extensions: [] } : { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 })
    const props = { item: { ...timelineItem, isMe: true, avatarRef: 'other-device-avatar' },
      sourceRef: 'source-a', sourceKind: 'send_to_self' as const, showOriginal: false, onClose: () => {}, onToggleOriginal: () => {} }
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeTimelineDetailDrawer {...props} />) })
    const currentSelfProfile = { userId: 42, displayName: '当前账号', nickname: '当前账号', avatarRef: 'current-account-avatar',
      arkmeId: 'sample', accountType: 1, createdAt: 1, bindings: { apple: false, wechat: false, google: false }, contact: {} }
    await act(async () => view.update(<ArkmeTimelineDetailDrawer {...props} currentSelfProfile={currentSelfProfile} />))
    expect(view.root.findByProps({ 'data-arkme-detail-author': true }).findByType(ArkmeUserAvatar).props.avatarRef).toBe('current-account-avatar')
    act(() => view.unmount())
  })

  it('uses the current account nickname for my private-chat detail instead of an old member name', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => operation === 'source.message-extension.context'
      ? { parentRecordUid: 'record-source', extensionCount: 0, extensions: [] } : { total: 0, items: [] })
    const currentSelfProfile = { userId: 42, displayName: '当前昵称', nickname: '当前昵称', avatarRef: 'current-account-avatar',
      arkmeId: 'sample', accountType: 1, createdAt: 1, bindings: { apple: false, wechat: false, google: false }, contact: {} }
    const member: ArkmeConversationMemberItem = {
      memberRef: 'self-member', mentionRef: 'self-mention', mentionDisplayName: '旧昵称', displayName: '旧昵称',
      role: 'member', status: 'active', isSelf: true, isOwner: false, joinedAtMillis: 1, recordCount: 0, mentionCount: 0,
    }
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeTimelineDetailDrawer
      item={{ ...timelineItem, isMe: true, senderName: '更早的昵称', senderMemberRef: 'self-member' }}
      currentSelfProfile={currentSelfProfile} conversationMembers={[member]}
      sourceRef="source-a" sourceKind="private_chat" showOriginal={false} onClose={() => {}} onToggleOriginal={() => {}} />) })
    const header = view.root.findByProps({ 'data-arkme-detail-author': true })
    expect(header.findAll(node => node.children.includes('当前昵称'))).not.toHaveLength(0)
    expect(header.findAll(node => node.children.includes('旧昵称'))).toHaveLength(0)
    expect(header.findAll(node => node.children.includes('更早的昵称'))).toHaveLength(0)
    act(() => view.unmount())
  })

  it.each([
    { sourceKind: 'send_to_self', isMe: false },
    { sourceKind: 'private_chat', isMe: true },
    { sourceKind: 'group_chat', isMe: true },
  ] as const)('does not replace avatars outside the own personal view: $sourceKind/$isMe', async ({ sourceKind, isMe }) => {
    mocks.callArkme.mockImplementation(async (operation: string) => operation === 'source.message-extension.context'
      ? { parentRecordUid: 'record-source', extensionCount: 1, extensions: [{
          recordUid: 'other-reply', recordOwnerUserId: 99, parentRecordUid: 'record-source', level: 2, sourceKind: 'record_extension',
          senderDisplayName: '另一位作者', senderAvatarUrl: 'other-author-avatar', title: '', textContent: '补充内容', sendAtMillis: 1_710_000_060_000,
          templateKind: 1, displayKind: 0, officialMark: 0, mediaItems: [],
        }] } : { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 })
    const currentSelfProfile = { userId: 42, displayName: '当前账号', nickname: '当前账号', avatarRef: 'current-account-avatar',
      arkmeId: 'sample', accountType: 1, createdAt: 1, bindings: { apple: false, wechat: false, google: false }, contact: {} }
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeTimelineDetailDrawer
      item={{ ...timelineItem, isMe, avatarSnapshot: true, avatarRef: 'message-avatar' }}
      currentSelfProfile={currentSelfProfile} sourceRef="source-a" sourceKind={sourceKind}
      showOriginal={false} onClose={() => {}} onToggleOriginal={() => {}} />) })
    expect(view.root.findByProps({ 'data-arkme-detail-author': true }).findByType(ArkmeUserAvatar).props.avatarRef).toBe('message-avatar')
    expect(view.root.findByProps({ 'data-arkme-note-extension-item': 'other-reply' }).findByType(ArkmeUserAvatar).props.avatarRef).toBe('other-author-avatar')
    act(() => view.unmount())
  })

  it('uses the same author identity rule for self-note extensions', async () => {
    const currentSelfProfile = {
      userId: 42, displayName: '现在的昵称', nickname: '现在的昵称', avatarRef: 'current-avatar-ref',
      arkmeId: 'sample', accountType: 1, createdAt: 1,
      bindings: { apple: false, wechat: false, google: false }, contact: {},
    }
    for (const historical of [false, true]) {
      mocks.callArkme.mockImplementation(async (operation: string) => operation === 'source.message-extension.context'
        ? { parentRecordUid: 'record-source', extensionCount: 1, extensions: [{
            recordUid: 'reply-1', parentRecordUid: 'record-source', level: 2, sourceKind: 'record_extension',
            senderDisplayName: historical ? '当时的昵称' : '我',
            ...(historical ? { senderNameSnapshot: true, senderAvatarUrl: 'old-avatar-ref' } : {}),
            title: '', textContent: '补充结论', sendAtMillis: 1_710_000_060_000,
            templateKind: 1, displayKind: 0, officialMark: 0, mediaItems: [],
          }] }
        : { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 })
      let view!: ReactTestRenderer
      await act(async () => { view = create(<ArkmeTimelineDetailDrawer item={{ ...timelineItem, isMe: true, avatarSnapshot: true, senderNameSnapshot: true, avatarRef: 'main-old-ref' }}
        sourceRef="source-a" sourceKind="send_to_self" currentSelfProfile={currentSelfProfile}
        showOriginal={false} onClose={() => {}} onToggleOriginal={() => {}} />) })
      const row = view.root.findByProps({ 'data-arkme-note-extension-item': 'reply-1' })
      const serialized = JSON.stringify(view.toJSON())
      expect(serialized).toContain(historical ? '当时的昵称' : '现在的昵称')
      expect(serialized).not.toContain('当前资料')
      expect(row.findByType(ArkmeUserAvatar).props.avatarRef).toBe('current-avatar-ref')
      act(() => view.unmount())
    }
  })

  it('shows each self-note extension with its own frozen role instead of the real sender or parent role', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => operation === 'source.message-extension.context'
      ? { parentRecordUid: 'record-source', extensionCount: 1, extensions: [{
          recordUid: 'reply-role', parentRecordUid: 'record-source', level: 2, sourceKind: 'record_extension',
          senderDisplayName: '原作者', senderAvatarUrl: 'real-avatar-ref', selfRole: {
            roleId: '11111111-1111-4111-8111-111111111111', name: '理性我', avatarRef: 'role-avatar-ref',
          }, title: '', textContent: '角色的延展', sendAtMillis: 1_710_000_060_000,
          templateKind: 1, displayKind: 0, officialMark: 0, mediaItems: [],
        }] }
      : { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 })
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeTimelineDetailDrawer
      item={{ ...timelineItem, isMe: true, selfRole: { roleId: 'parent', name: '父消息角色' } }}
      sourceRef="source-a" sourceKind="send_to_self"
      showOriginal={false} onClose={() => {}} onToggleOriginal={() => {}} />) })
    const row = view.root.findByProps({ 'data-arkme-note-extension-item': 'reply-role' })
    expect(row.findByType(ArkmeUserAvatar).props.avatarRef).toBe('role-avatar-ref')
    expect(row.findAllByType('span').some(node => node.children.includes('理性我'))).toBe(true)
    expect(row.findAllByType('span').some(node => node.children.includes('父消息角色'))).toBe(false)
    act(() => view.unmount())
  })

  it('renders the topic as the shared source badge and opens it when available', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => operation === 'source.message-extension.context'
      ? { parentRecordUid: 'record-source', extensionCount: 0, extensions: [] }
      : { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 })
    const topic = { sourceRef: 'topic-a', kind: 'topic', displayName: '产品主题' } as never
    const onOpenSelfTopic = vi.fn()
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeTimelineDetailDrawer item={{ ...timelineItem, isMe: true }}
      sourceRef="source-a" sourceKind="send_to_self" selfTopicPath="产品 / 产品主题"
      selfTopicSource={topic} onOpenSelfTopic={onOpenSelfTopic}
      showOriginal={false} onClose={() => {}} onToggleOriginal={() => {}} />) })
    let badge = view.root.findByProps({ 'data-arkme-detail-self-topic': true })
    expect(badge.props.disabled).toBe(false)
    expect(badge.props.style).toMatchObject(arkmeDetailSourceBadgeStyle)
    expect(badge.findByType(ArkmeTopicSourceIcon)).toBeDefined()
    expect(JSON.stringify(view.toJSON())).toContain('产品 / 产品主题')
    const stopPropagation = vi.fn()
    await act(async () => badge.props.onClick({ stopPropagation }))
    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(onOpenSelfTopic).toHaveBeenCalledWith(topic)
    await act(async () => view.update(<ArkmeTimelineDetailDrawer item={{ ...timelineItem, isMe: true }}
      sourceRef="source-a" sourceKind="send_to_self" showOriginal={false}
      onClose={() => {}} onToggleOriginal={() => {}} />))
    badge = view.root.findByProps({ 'data-arkme-detail-self-topic': true })
    expect(badge.props.disabled).toBe(true)
    expect(JSON.stringify(view.toJSON())).toContain('未指定主题')
    act(() => view.unmount())
  })

  it('opens edited history only for manual edits and returns to the detail', async () => {
    mocks.callArkme.mockImplementation(async (op: string) => op === 'source.record-edit-history'
      ? { items: [{ revisionUid: 'rev-1', kind: 'manual', editAtMillis: 1710000000000, content: { title: '', textContent: '历史快记', contentBlocks: [] } }], hasMore: false }
      : { items: [], total: 0, extensions: [], extensionCount: 0 })
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeTimelineDetailDrawer item={{ ...timelineItem, hasManualEdit: false }} sourceRef="source-a" showOriginal={false} onClose={() => {}} onToggleOriginal={() => {}} />) })
    expect(view.root.findAllByType('button').some(node => node.props['aria-label'] === '已编辑')).toBe(false)
    await act(async () => view.update(<ArkmeTimelineDetailDrawer item={{ ...timelineItem, hasManualEdit: true }} sourceRef="source-a" showOriginal={false} onClose={() => {}} onToggleOriginal={() => {}} />))
    await act(async () => view.root.findAllByType('button').find(node => node.props['aria-label'] === '已编辑')!.props.onClick())
    expect(JSON.stringify(view.toJSON())).toContain('历史快记')
    expect(view.root.findByProps({ 'data-arkme-history-row': true }).props.style.flexDirection).toBe('row')
    await act(async () => view.root.findByProps({ 'aria-label': '返回快记详情' }).props.onClick())
    expect(JSON.stringify(view.toJSON())).toContain('源快记正文')
    act(() => view.unmount())
  })

  it('restores the current detail scroll position after reading history', async () => {
    mocks.callArkme.mockImplementation(async (op: string) => op === 'source.record-edit-history'
      ? { items: [{ revisionUid: 'rev', kind: 'manual', editAtMillis: 1710000000000, content: { textContent: 'old', contentBlocks: [] } }], hasMore: false }
      : { items: [], total: 0, extensions: [], extensionCount: 0 })
    const bodies: Array<{ scrollTop: number }> = []
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeTimelineDetailDrawer item={{ ...timelineItem, hasManualEdit: true }} sourceRef="source-a" showOriginal={false} onClose={() => {}} onToggleOriginal={() => {}} />, {
      createNodeMock: element => {
        if (element.type === 'div' && element.props.style?.padding === '24px 22px') {
          const body = { scrollTop: 0 }; bodies.push(body); return body
        }
        return null
      },
    }) })
    expect(bodies.length).toBeGreaterThan(0)
    bodies[bodies.length - 1]!.scrollTop = 480
    await act(async () => view.root.findAllByType('button').find(node => node.props['aria-label'] === '已编辑')!.props.onClick())
    expect(bodies[bodies.length - 1]!.scrollTop).toBe(0)
    await act(async () => view.root.findByProps({ 'aria-label': '返回快记详情' }).props.onClick())
    expect(bodies[bodies.length - 1]!.scrollTop).toBe(480)
    act(() => view.unmount())
  })

  it('preserves unsent extension text and attachments when opening history', async () => {
    mocks.callArkme.mockImplementation(async (op: string) => op === 'source.record-edit-history'
      ? { items: [{ revisionUid: 'rev', kind: 'manual', editAtMillis: 1710000000000, content: { textContent: 'old', contentBlocks: [] } }], hasMore: false }
      : { items: [], total: 0, extensions: [], extensionCount: 0 })
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeTimelineDetailDrawer item={{ ...timelineItem, hasManualEdit: true }} sourceRef="source-a" showOriginal={false} onClose={() => {}} onToggleOriginal={() => {}} />) })
    act(() => view.root.findByType(ArkmeRichComposerInput).props.onTextChange('未发送的延展'))
    await act(async () => { await view.root.findByProps({ 'data-arkme-detail-extension-file-input': 'true' }).props.onChange({ currentTarget: { files: [{ name: 'draft.png', type: 'image/png', size: 12 }], value: '' } }) })
    await act(async () => view.root.findAllByType('button').find(node => node.props['aria-label'] === '已编辑')!.props.onClick())
    expect(view.root.findByType('footer').props.hidden).toBe(true)
    await act(async () => view.root.findByProps({ 'aria-label': '返回快记详情' }).props.onClick())
    expect(view.root.findByType('footer').props.hidden).toBe(false)
    expect(view.root.findByType(ArkmeRichComposerInput).props.value).toBe('未发送的延展')
    expect(view.root.findAllByProps({ 'aria-label': 'draft.png，第 1 个附件' })).toHaveLength(1)
    expect(mocks.removeLocalFile).not.toHaveBeenCalled()
    act(() => view.unmount())
  })

  it('does not cancel an in-flight extension send while browsing history', async () => {
    let finish!: (value: unknown) => void
    let sendSignal!: AbortSignal
    mocks.callArkme.mockImplementation((op: string, _args: unknown, signal: AbortSignal) => {
      if (op === 'source.message-extension.extend') { sendSignal = signal; return new Promise(resolve => { finish = resolve }) }
      if (op === 'source.record-edit-history') return Promise.resolve({ items: [{ revisionUid: 'rev', kind: 'manual', editAtMillis: 1710000000000, content: { textContent: 'old', contentBlocks: [] } }], hasMore: false })
      return Promise.resolve({ items: [], total: 0, extensions: [], extensionCount: 0 })
    })
    const onSent = vi.fn()
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeTimelineDetailDrawer item={{ ...timelineItem, hasManualEdit: true }} sourceRef="source-a" showOriginal={false} onClose={() => {}} onToggleOriginal={() => {}} onExtensionSent={onSent} />) })
    act(() => view.root.findByType(ArkmeRichComposerInput).props.onTextChange('发送中的延展'))
    act(() => view.root.findByProps({ 'aria-label': '发送延展' }).props.onClick())
    await act(async () => view.root.findAllByType('button').find(node => node.props['aria-label'] === '已编辑')!.props.onClick())
    expect(sendSignal.aborted).toBe(false)
    const result = { recordUid: 'extension', parentRecordUid: 'record-source', status: 1, localState: 'synced', extension: { recordUid: 'extension', level: 2, sourceKind: 'record_extension', senderDisplayName: '我', title: '', textContent: '发送中的延展', sendAtMillis: 1710000000000, mediaItems: [] } }
    await act(async () => finish(result))
    expect(onSent).toHaveBeenCalledTimes(1)
    await act(async () => view.root.findByProps({ 'aria-label': '返回快记详情' }).props.onClick())
    expect(view.root.findByType(ArkmeRichComposerInput).props.value).toBe('')
    expect(view.root.findAllByProps({ 'data-arkme-note-extension-item': 'extension' })).toHaveLength(1)
    expect(mocks.callArkme.mock.calls.filter(call => call[0] === 'source.message-extension.extend')).toHaveLength(1)
    act(() => view.unmount())
  })

  it('keeps a staging attachment alive while history is open', async () => {
    let finish!: (value: { fileRef: string; fileName: string; mimeType: string; size: number; fileKind: number }) => void
    mocks.stageFile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    mocks.callArkme.mockImplementation(async (op: string) => op === 'source.record-edit-history'
      ? { items: [{ revisionUid: 'rev', kind: 'manual', editAtMillis: 1710000000000, content: { textContent: 'old', contentBlocks: [] } }], hasMore: false }
      : { items: [], total: 0, extensions: [], extensionCount: 0 })
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeTimelineDetailDrawer item={{ ...timelineItem, hasManualEdit: true }} sourceRef="source-a" showOriginal={false} onClose={() => {}} onToggleOriginal={() => {}} />) })
    let staging!: Promise<void>
    await act(async () => { staging = view.root.findByProps({ 'data-arkme-detail-extension-file-input': 'true' }).props.onChange({ currentTarget: { files: [{ name: 'pending.png', type: 'image/png', size: 12 }], value: '' } }) })
    await act(async () => view.root.findAllByType('button').find(node => node.props['aria-label'] === '已编辑')!.props.onClick())
    await act(async () => { finish({ fileRef: 'arkme-file-v1.pending', fileName: 'pending.png', mimeType: 'image/png', size: 12, fileKind: 1 }); await staging })
    await act(async () => view.root.findByProps({ 'aria-label': '返回快记详情' }).props.onClick())
    expect(view.root.findAllByProps({ 'aria-label': 'pending.png，第 1 个附件' })).toHaveLength(1)
    expect(mocks.removeLocalFile).not.toHaveBeenCalled()
    act(() => view.unmount())
  })

  beforeEach(() => {
    mocks.callArkme.mockReset()
    mocks.fileCapabilities.mockClear()
    mocks.stageFile.mockClear()
    mocks.removeLocalFile.mockClear()
    mocks.openLocalFile.mockClear()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:detail-clipboard-preview')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.stubGlobal('HTMLElement', class {})
    vi.stubGlobal('document', {
      activeElement: null,
      body: { style: { overflow: '' } },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      querySelector: vi.fn(() => null),
    })
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      requestAnimationFrame: (callback: () => void) => { callback(); return 1 },
    })
  })

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('refusal disables detail extension text, attachments and send without losing the draft', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 }
      return { parentRecordUid: 'record-source', extensionCount: 0, extensions: [] }
    })
    let renderer!: ReactTestRenderer
    const drawer = (blocked: boolean) => <ArkmeTimelineDetailDrawer
      item={timelineItem} sourceRef="opaque-source" showOriginal={false}
      onClose={vi.fn()} onToggleOriginal={vi.fn()}
      messageCreationBlocked={blocked} messageCreationRestriction="对方已拒收你的消息"
    />
    await act(async () => { renderer = create(drawer(false)); await Promise.resolve() })
    const draft = { document: { type: 'doc' }, source: '**未发送草稿**', mentions: [] }
    act(() => {
      renderer.root.findByType(ArkmeRichComposerInput).props.onTextChange('未发送草稿')
      renderer.root.findByType(ArkmeRichComposerInput).props.onMarkdownChange(draft)
    })
    act(() => renderer.update(drawer(true)))
    const input = renderer.root.findByType(ArkmeRichComposerInput)
    expect(input.props.disabled).toBe(true)
    expect(input.props.value).toBe('未发送草稿')
    act(() => {
      input.props.onTextChange('不应覆盖草稿')
      input.props.onMarkdownChange(undefined)
    })
    expect(renderer.root.findByProps({ 'aria-label': '添加延展附件' }).props.disabled).toBe(true)
    expect(renderer.root.findByProps({ 'aria-label': '发送延展' }).props.disabled).toBe(true)
    await act(async () => { renderer.root.findByProps({ 'aria-label': '发送延展' }).props.onClick() })
    expect(mocks.callArkme.mock.calls.some(([operation]) => operation === 'source.message-extension.extend')).toBe(false)
    act(() => renderer.update(drawer(false)))
    expect(renderer.root.findByType(ArkmeRichComposerInput).props.value).toBe('未发送草稿')
    expect(renderer.root.findByType(ArkmeRichComposerInput).props.markdown).toEqual(draft)
    expect(renderer.root.findByType(ArkmeRichComposerInput).props.disabled).toBe(false)
    act(() => renderer.unmount())
  })

  it('loads, navigates to detail, and returns through the retained list', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return relatedList
      if (operation === 'source.related-quick-note.detail') return {
        relatedRef: 'opaque-related-b', senderName: '小林', isMe: false,
        sendAtMillis: 1_709_000_000_000, title: '', textContent: '完整相关快记正文', status: 1,
      }
      throw new Error(`unexpected operation: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem}
        sourceRef="opaque-source"
        showOriginal={false}
        onClose={vi.fn()}
        onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith(
      'source.related-quick-notes.from-message',
      { sourceRef: 'opaque-source', messageActionRef: 'opaque-action' },
      expect.any(AbortSignal),
    )
    const card = renderer.root.findByProps({ 'aria-label': '查看 2 条相关快记' })
    act(() => { card.props.onClick() })
    expect(JSON.stringify(renderer.toJSON())).toContain('2 条相关快记')

    const row = renderer.root.findByProps({ 'aria-label': '打开相关快记：问题不大' })
    await act(async () => {
      row.props.onClick()
      await Promise.resolve()
    })
    expect(mocks.callArkme).toHaveBeenCalledWith(
      'source.related-quick-note.detail',
      { sourceRef: 'opaque-source', relatedRef: 'opaque-related-b' },
      expect.any(AbortSignal),
    )
    expect(JSON.stringify(renderer.toJSON())).toContain('完整相关快记正文')

    act(() => { renderer.root.findByProps({ 'aria-label': '返回相关快记列表' }).props.onClick() })
    expect(renderer.root.findAllByProps({ 'aria-label': '打开相关快记：问题不大' })).toHaveLength(1)
    act(() => { renderer.root.findByProps({ 'aria-label': '返回快记详情' }).props.onClick() })
    expect(JSON.stringify(renderer.toJSON())).toContain('源快记正文')
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation !== 'provider.capabilities')).toHaveLength(3)
  })

  it('does not requery a successful empty recall', async () => {
    let relatedCalls = 0
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') {
        relatedCalls += 1
        return { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 }
      }
      if (operation === 'source.message-extension.context') return {
        parentRecordUid: 'record-source', extensionCount: 0, extensions: [],
      }
      throw new Error(`unexpected operation: ${operation}`)
    })
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeTimelineDetailDrawer
      item={timelineItem} sourceRef="opaque-source" sourceKind="private_chat"
      showOriginal={false} onClose={() => {}} onToggleOriginal={() => {}} />) })
    expect(relatedCalls).toBe(1)
    expect(view.root.findAllByProps({ 'aria-label': '查看 2 条相关快记' })).toHaveLength(0)
    act(() => view.unmount())
  })

  it('restores source-detail and related-list scroll positions across nested navigation', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return relatedList
      if (operation === 'source.related-quick-note.detail') return {
        relatedRef: 'opaque-related-b', senderName: '小林', isMe: false,
        sendAtMillis: 1_709_000_000_000, title: '', textContent: '完整相关快记正文', status: 1,
      }
      throw new Error(`unexpected operation: ${operation}`)
    })
    const scrollBody = { scrollTop: 0 }
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem}
        sourceRef="opaque-source"
        showOriginal={false}
        onClose={vi.fn()}
        onToggleOriginal={vi.fn()}
      />, {
        createNodeMock: element => {
          // Only the scroll viewport needs a host node; editor DOM is covered in jsdom tests.
          if (element.props.contentEditable !== undefined) return null
          return element.props.style?.padding === '24px 22px'
            ? scrollBody
            : { focus: vi.fn(), contains: vi.fn(() => false), isConnected: true }
        },
      })
      await Promise.resolve()
    })

    scrollBody.scrollTop = 211
    act(() => { renderer.root.findByProps({ 'aria-label': '查看 2 条相关快记' }).props.onClick() })
    scrollBody.scrollTop = 137
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '打开相关快记：问题不大' }).props.onClick()
      await Promise.resolve()
    })
    scrollBody.scrollTop = 29
    act(() => { renderer.root.findByProps({ 'aria-label': '返回相关快记列表' }).props.onClick() })
    expect(scrollBody.scrollTop).toBe(137)
    act(() => { renderer.root.findByProps({ 'aria-label': '返回快记详情' }).props.onClick() })
    expect(scrollBody.scrollTop).toBe(211)
  })

  it('refreshes the related list instead of retrying an expired detail reference', async () => {
    let listCalls = 0
    const refreshedList: ArkmeRelatedQuickNoteList = {
      total: 1,
      items: [{
        relatedRef: 'opaque-related-fresh', senderName: '小林',
        sendAtMillis: 1_709_000_000_001, title: '', textPreview: '刷新后的相关快记',
      }],
    }
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') {
        listCalls += 1
        return listCalls === 1 ? relatedList : refreshedList
      }
      if (operation === 'source.related-quick-note.detail') {
        throw new ArkmeClientError({
          code: 'related-quick-note-ref-expired',
          message: '相关快记引用已过期，请刷新后重试',
          retryable: true,
        })
      }
      throw new Error(`unexpected operation: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem}
        sourceRef="opaque-source"
        showOriginal={false}
        onClose={vi.fn()}
        onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve()
    })

    act(() => { renderer.root.findByProps({ 'aria-label': '查看 2 条相关快记' }).props.onClick() })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '打开相关快记：问题不大' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(listCalls).toBe(2)
    expect(renderer.root.findAllByProps({ 'aria-label': '打开相关快记：刷新后的相关快记' })).toHaveLength(1)
    expect(JSON.stringify(renderer.toJSON())).not.toContain('相关快记引用已过期，请刷新后重试')
  })

  it('does not query without both source and message action refs', async () => {
    await act(async () => {
      create(<ArkmeTimelineDetailDrawer
        item={{ ...timelineItem, messageActionRef: undefined }}
        sourceRef="opaque-source"
        showOriginal={false}
        onClose={vi.fn()}
        onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve()
    })
    expect(mocks.callArkme).not.toHaveBeenCalled()
  })

  it('does not query related quick notes or extensions for unsupported Bot message details', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={{ ...timelineItem, itemUid: 'bot-daily-statistics', senderName: 'Arkme用户', quickNoteDetailsSupported: false }}
        sourceRef="opaque-source"
        showOriginal={false}
        onClose={vi.fn()}
        onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.callArkme).not.toHaveBeenCalled()
    expect(JSON.stringify(renderer.toJSON())).not.toContain('相关快记')
    expect(renderer.root.findAllByType(ArkmeRichComposerInput)).toHaveLength(0)
    act(() => renderer.unmount())
  })

  it('shows the current quick note extension count and desktop-style extension rows', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 }
      if (operation === 'source.message-extension.context') return {
        parentRecordUid: 'record-source',
        extensionCount: 2,
        extensions: [{
          recordUid: 'extension-newer', level: 2, sourceKind: 'record_extension', senderDisplayName: '狗才',
          senderAvatarUrl: 'opaque-avatar', title: '',
          textContent: '新的延展正文 https://example.com/extension-detail', sendAtMillis: 1_710_000_120_000,
          templateKind: 2, displayKind: 0, officialMark: 0,
          mediaItems: [
            { fileKind: 1, fileName: '补充截图.png', size: 12 },
            { fileKind: 4, fileName: '补充方案.pdf', size: 34 },
          ],
          contentBlocks: [
            { kind: 'image', mediaRef: 'extension-image-ref', originalRef: 'extension-image-original-ref', fileName: '补充截图.png', mimeType: 'image/png', size: 12, sortOrder: 0 },
            { kind: 'file', mediaRef: 'extension-file-ref', originalRef: 'extension-file-original-ref', fileName: '补充方案.pdf', mimeType: 'application/pdf', size: 34, sortOrder: 1 },
          ],
        }, {
          recordUid: 'extension-older', level: 2, sourceKind: 'record_extension', senderDisplayName: '小林',
          title: '', textContent: '较早的延展正文', sendAtMillis: 1_710_000_060_000,
          templateKind: 1, displayKind: 0, officialMark: 0, mediaItems: [],
        }],
      }
      throw new Error(`unexpected operation: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem} sourceRef="opaque-source" showOriginal={false}
        onClose={vi.fn()} onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve(); await Promise.resolve()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith(
      'source.message-extension.context',
      { sourceRef: 'opaque-source', messageActionRef: 'opaque-action' },
      expect.any(AbortSignal),
    )
    expect(renderer.root.findByProps({ 'data-arkme-note-extension-count': 'true' }).children.join('')).toBe('共2条延展')
    const newer = renderer.root.findByProps({ 'data-arkme-note-extension-item': 'extension-newer' })
    expect(newer.findAll(node => node.children.includes('狗才'))).not.toHaveLength(0)
    expect(newer.findAll(node => node.children.some(child =>
      typeof child === 'string' && child.includes('新的延展正文')))).not.toHaveLength(0)
    const extensionLink = newer.find(node => node.type === 'a' && node.props.href === 'https://example.com/extension-detail')
    expect(extensionLink.findByProps({ 'data-arkme-link-label': 'true' }).children).toEqual([
      'https://example.com/extension-detail',
    ])
    expect(newer.findAllByProps({ alt: '补充截图.png' })).toHaveLength(1)
    expect(newer.findAllByProps({ 'data-arkme-file-card': 'file' })).toHaveLength(1)
    expect(newer.findAll(node => node.children.includes('补充方案.pdf'))).not.toHaveLength(0)
    expect(newer.findAll(node => node.children.includes('暂不支持的非文本内容'))).toHaveLength(0)
    const rows = renderer.root.findAll(node => typeof node.props['data-arkme-note-extension-item'] === 'string')
    expect(rows.map(row => row.props['data-arkme-note-extension-item'])).toEqual(['extension-newer', 'extension-older'])
  })

  it('renders a group reply with the current group member name and avatar, not the stored snapshot', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => operation === 'source.message-extension.context'
      ? { parentRecordUid: 'record-source', extensionCount: 1, extensions: [{
        recordUid: 'group-reply', parentRecordUid: 'record-source', level: 2, sourceKind: 'record_extension',
        senderDisplayName: '旧昵称', senderMemberRef: 'current-member', senderAvatarUrl: 'old-avatar',
        title: '', textContent: '群里的回复', sendAtMillis: 1_710_000_120_000,
        templateKind: 1, displayKind: 0, officialMark: 0, mediaItems: [],
      }] } : { total: 0, items: [] })
    const member: ArkmeConversationMemberItem = {
      memberRef: 'current-member', mentionRef: 'member-mention', mentionDisplayName: '群内昵称',
      displayName: '群内昵称', avatarRef: 'group-current-avatar', role: 'member', status: 'active',
      isSelf: false, isOwner: false, joinedAtMillis: 1, recordCount: 0, mentionCount: 0,
    }
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeTimelineDetailDrawer
      item={timelineItem} sourceRef="group-source" sourceKind="group_chat" conversationMembers={[member]}
      showOriginal={false} onClose={() => {}} onToggleOriginal={() => {}} />) })
    const row = view.root.findByProps({ 'data-arkme-note-extension-item': 'group-reply' })
    expect(row.findAll(node => node.children.includes('群内昵称'))).not.toHaveLength(0)
    expect(row.findAll(node => node.children.includes('旧昵称'))).toHaveLength(0)
    expect(row.findByType(ArkmeUserAvatar).props.avatarRef).toBe('group-current-avatar')
    act(() => view.unmount())
  })

  it('keeps readable reply text and only shows a compact indicator for missing attachments', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => operation === 'source.message-extension.context'
      ? { parentRecordUid: 'record-source', extensionCount: 1, extensions: [{
        recordUid: 'text-and-missing-file', parentRecordUid: 'record-source', level: 2,
        sourceKind: 'record_extension', senderDisplayName: '同事', title: '', textContent: '已经处理',
        sendAtMillis: 1_710_000_120_000, templateKind: 2, displayKind: 0, officialMark: 0,
        mediaUnavailable: true, mediaItems: [{ fileKind: 4, fileName: '方案.pdf', size: 12 }],
      }] } : { total: 0, items: [] })
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeTimelineDetailDrawer
      item={timelineItem} sourceRef="private-source" sourceKind="private_chat"
      showOriginal={false} onClose={() => {}} onToggleOriginal={() => {}} />) })
    const row = view.root.findByProps({ 'data-arkme-note-extension-item': 'text-and-missing-file' })
    const tree = JSON.stringify(view.toJSON())
    expect(tree).toContain('已经处理')
    expect(row.findAllByProps({ 'data-arkme-missing-extension-media': true })).toHaveLength(1)
    expect(tree).not.toContain('部分媒体暂时无法加载，请刷新对话后重试')
    act(() => view.unmount())
  })

  it.each(['send_to_self', 'default_category', 'topic'] as const)('hydrates a cross-topic source and related notes in %s details without relying on the list projection', async sourceKind => {
    let finishContext!: (value: unknown) => void
    let finishRelated!: (value: unknown) => void
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return new Promise(resolve => { finishRelated = resolve })
      if (operation === 'source.message-extension.context') return new Promise(resolve => { finishContext = resolve })
      throw new Error(`unexpected operation: ${operation}`)
    })
    const onOpenParent = vi.fn()
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeTimelineDetailDrawer
      item={timelineItem} sourceRef="opaque-source" sourceKind={sourceKind} selfTopicPath="产品"
      showOriginal={false} onClose={vi.fn()} onToggleOriginal={vi.fn()} onOpenExtensionParent={onOpenParent} />) })
    expect(renderer.root.findAllByProps({ 'data-arkme-related-quick-notes-loading': true })).toHaveLength(1)
    const parent = { itemUid: 'external-parent', senderName: '小林', title: '', textContent: '主题外的原始快记' }
    await act(async () => {
      finishContext({ parentRecordUid: timelineItem.itemUid, extensionCount: 0, extensions: [], extensionParent: parent })
      finishRelated(relatedList)
    })
    const sourceButton = renderer.root.findByProps({ 'data-arkme-detail-extension-parent': 'external-parent' })
    const tree = JSON.stringify(renderer.toJSON())
    expect(tree.indexOf('data-arkme-detail-extension-parent')).toBeLessThan(tree.indexOf('data-arkme-timeline-detail-rich-content'))
    expect(tree).toContain('相关快记')
    expect(renderer.root.findAll(node => node.type === 'span' && node.children.join('') === '共 2 条')).toHaveLength(1)
    expect(tree).toContain('产品')
    expect(renderer.root.findAllByProps({ 'aria-label': '快记延展列表' })).toHaveLength(0)
    await act(async () => sourceButton.props.onClick())
    expect(onOpenParent).toHaveBeenCalledWith(parent)
    act(() => renderer.unmount())
  })

  it('ignores delayed detail results from a previously opened note', async () => {
    const pending: { action: string; operation: string; resolve: (value: unknown) => void }[] = []
    mocks.callArkme.mockImplementation((operation: string, payload: { messageActionRef: string }) =>
      new Promise(resolve => pending.push({ action: payload.messageActionRef, operation, resolve })))
    const render = (action: string) => <ArkmeTimelineDetailDrawer
      item={{ ...timelineItem, itemUid: action, messageActionRef: action }} sourceRef="topic" sourceKind="topic"
      showOriginal={false} onClose={vi.fn()} onToggleOriginal={vi.fn()} />
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(render('old')) })
    await act(async () => { renderer.update(render('current')) })
    await act(async () => {
      for (const task of pending.filter(task => task.action === 'current')) task.resolve(
        task.operation === 'source.message-extension.context'
          ? { parentRecordUid: 'current', extensions: [], extensionCount: 0 }
          : { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 })
      for (const task of pending.filter(task => task.action === 'old')) task.resolve(
        task.operation === 'source.message-extension.context'
          ? { parentRecordUid: 'old', extensions: [], extensionCount: 0,
            extensionParent: { itemUid: 'old-parent', title: '', senderName: '', textContent: '过期来源' } }
          : relatedList)
    })
    await act(async () => {
      for (const task of pending.filter(task => task.action === 'current'
        && task.operation === 'source.related-quick-notes.from-message').slice(1)) {
        task.resolve({ total: 0, items: [] })
      }
    })
    expect(JSON.stringify(renderer.toJSON())).not.toContain('过期来源')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('暂未找到相关快记')
    expect(renderer.root.findAllByProps({ 'data-arkme-related-quick-notes-card': true })).toHaveLength(0)
    act(() => renderer.unmount())
  })

  it('shows a clickable extension source above the current quick note content', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 }
      if (operation === 'source.message-extension.context') return {
        parentRecordUid: 'record-source', extensionCount: 0, extensions: [],
      }
      throw new Error(`unexpected operation: ${operation}`)
    })
    const onOpenParent = vi.fn()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={{
          ...timelineItem,
          textContent: '当前延展正文',
          extensionParentRecordUid: 'record-parent',
          extensionParent: {
            itemUid: 'record-parent', senderName: '狗才', title: '',
            textContent: emojiSample,
          },
        }}
        sourceRef="opaque-source" showOriginal={false}
        onClose={vi.fn()} onToggleOriginal={vi.fn()} onOpenExtensionParent={onOpenParent}
      />)
      await Promise.resolve(); await Promise.resolve()
    })

    const parent = renderer.root.findByProps({ 'data-arkme-detail-extension-parent': 'record-parent' })
    expect(parent.findAllByProps({ 'data-arkme-rich-emoji': 'heart_eyes' })).toHaveLength(1)
    expect(parent.findAllByProps({ 'data-arkme-rich-emoji': 'thumb_up' })).toHaveLength(1)
    expect(parent.findAllByType('a')).toHaveLength(0)
    expect(parent.findAll(node => node.props.role === 'link')).toHaveLength(0)
    expect(parent.props.style).toMatchObject({ borderLeftWidth: 1, borderLeftStyle: 'solid' })
    const tree = JSON.stringify(renderer.toJSON())
    expect(tree.indexOf('data-arkme-detail-extension-parent')).toBeLessThan(tree.indexOf('data-arkme-timeline-detail-rich-content'))
    await act(async () => parent.props.onClick())
    expect(onOpenParent).toHaveBeenCalledWith(expect.objectContaining({ itemUid: 'record-parent' }))
  })

  it('selects an extension row as the next extension target and shows the new child indented below it', async () => {
    const sent: ArkmeSourceMessageExtendResult = {
      recordUid: '11111111-1111-4111-8111-111111111111',
      parentRecordUid: 'extension-level-two',
      relationUid: '22222222-2222-4222-8222-222222222222',
      sequence: 19,
      status: 1,
      localState: 'synced',
      extension: {
        recordUid: '11111111-1111-4111-8111-111111111111',
        parentRecordUid: 'extension-level-two', level: 3, sourceKind: 'record_extension',
        senderDisplayName: '狗才', title: '', textContent: '三级延展', sendAtMillis: 1_710_000_180_000,
        templateKind: 1, displayKind: 0, officialMark: 0, mediaItems: [],
      },
    }
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 }
      if (operation === 'source.message-extension.context') return {
        parentRecordUid: 'record-source', extensionCount: 1, extensions: [{
          recordUid: 'extension-level-two', parentRecordUid: 'record-source', level: 2,
          sourceKind: 'record_extension', senderDisplayName: '小林', title: '', textContent: '二级延展',
          sendAtMillis: 1_710_000_120_000, templateKind: 1, displayKind: 0, officialMark: 0, mediaItems: [],
        }],
      }
      if (operation === 'source.message-extension.extend') return sent
      throw new Error(`unexpected operation: ${operation}`)
    })
    vi.stubGlobal('crypto', { randomUUID: vi.fn()
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222') })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem} sourceRef="opaque-source" showOriginal={false}
        onClose={vi.fn()} onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve(); await Promise.resolve()
    })
    const target = renderer.root.findByProps({ 'data-arkme-note-extension-item': 'extension-level-two' })
    act(() => { target.props.onClick() })
    expect(target.props['aria-pressed']).toBe(true)
    expect(target.props.style).toMatchObject({ borderRadius: 12 })
    act(() => {
      renderer.root.findByType(ArkmeRichComposerInput).props.onTextChange('三级延展')
    })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '发送延展' }).props.onClick()
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith('source.message-extension.extend', expect.objectContaining({
      sourceRef: 'opaque-source', messageActionRef: 'opaque-action', parentRecordUid: 'extension-level-two',
      textContent: '三级延展',
    }), expect.any(AbortSignal))
    const child = renderer.root.findByProps({
      'data-arkme-note-extension-item': '11111111-1111-4111-8111-111111111111',
    })
    expect(child.props.style).toMatchObject({ marginLeft: 30 })
  })

  it('keeps a newly sent detail extension visible while the server context catches up and reports it to the conversation', async () => {
    const sent: ArkmeSourceMessageExtendResult = {
      recordUid: '11111111-1111-4111-8111-111111111111',
      parentRecordUid: 'record-source',
      relationUid: '22222222-2222-4222-8222-222222222222',
      sequence: 19,
      status: 1,
      localState: 'synced',
      extension: {
        recordUid: '11111111-1111-4111-8111-111111111111', level: 2, sourceKind: 'record_extension',
        senderDisplayName: '狗才', title: '', textContent: '详情里新延展', sendAtMillis: 1_710_000_180_000,
        templateKind: 1, displayKind: 0, officialMark: 0, mediaItems: [],
      },
    }
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 }
      if (operation === 'source.message-extension.context') return {
        parentRecordUid: 'record-source', extensionCount: 0, extensions: [],
      }
      if (operation === 'source.message-extension.extend') return sent
      throw new Error(`unexpected operation: ${operation}`)
    })
    vi.stubGlobal('crypto', { randomUUID: vi.fn()
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222') })
    const onExtensionSent = vi.fn()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem} sourceRef="opaque-source" showOriginal={false}
        onClose={vi.fn()} onToggleOriginal={vi.fn()} onExtensionSent={onExtensionSent}
      />)
      await Promise.resolve(); await Promise.resolve()
    })
    act(() => {
      renderer.root.findByType(ArkmeRichComposerInput).props.onTextChange('详情里新延展')
    })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '发送延展' }).props.onClick()
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })

    expect(onExtensionSent).toHaveBeenCalledWith(sent)
    expect(renderer.root.findAllByProps({
      'data-arkme-note-extension-item': '11111111-1111-4111-8111-111111111111',
    })).toHaveLength(1)
    expect(renderer.root.findByProps({ 'data-arkme-note-extension-count': 'true' }).children.join('')).toBe('共1条延展')
  })

  it('binds the selected local role before sending a self-note detail extension', async () => {
    const role = { roleId: '33333333-3333-4333-8333-333333333333', name: '理性我', avatarRef: 'role-avatar-ref',
      createdAtMillis: 1, updatedAtMillis: 1 }
    const recordUid = '11111111-1111-4111-8111-111111111111'
    const sent: ArkmeSourceMessageExtendResult = {
      recordUid, parentRecordUid: 'record-source', status: 1, localState: 'synced',
      extension: { recordUid, parentRecordUid: 'record-source', level: 2, sourceKind: 'record_extension',
        senderDisplayName: '我', senderAvatarUrl: 'real-avatar-ref', title: '', textContent: '角色回复',
        sendAtMillis: 1_710_000_180_000, templateKind: 1, displayKind: 0, officialMark: 0, mediaItems: [] },
    }
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'provider.capabilities') return { features: { markdownQuickNotes: false } }
      if (operation === 'self-roles.list') return [role]
      if (operation === 'self-roles.bind') return { roleId: role.roleId, name: role.name, avatarRef: role.avatarRef }
      if (operation === 'source.message-extension.extend') return sent
      if (operation === 'source.message-extension.context') return { parentRecordUid: 'record-source', extensionCount: 0, extensions: [] }
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 }
      throw new Error(`unexpected operation: ${operation}`)
    })
    vi.stubGlobal('crypto', { randomUUID: vi.fn()
      .mockReturnValueOnce(recordUid)
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222') })
    const onExtensionSent = vi.fn()
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeTimelineDetailDrawer
      item={{ ...timelineItem, isMe: true }} sourceRef="opaque-source" sourceKind="send_to_self"
      selfRoleSelection={{ accountKey: 'account-42', userId: 42, selectedRole: role, onSelect: vi.fn() }}
      showOriginal={false} onClose={vi.fn()} onToggleOriginal={vi.fn()} onExtensionSent={onExtensionSent}
    />) })
    const extensionInput = renderer.root.findByProps({ className: 'arkme-detail-extension-input-shell' })
    expect(extensionInput.children.at(-1)).toBe(extensionInput.findByType(ArkmeComposerSendButton))
    expect(extensionInput.children.at(-2)).toBe(extensionInput.findByType(ArkmeSelfRolePicker))
    expect(extensionInput.findByProps({ role: 'tooltip' }).children.join('')).toBe('Enter发送 / Shift+Enter换行')
    act(() => renderer.root.findByType(ArkmeRichComposerInput).props.onTextChange('角色回复'))
    await act(async () => { renderer.root.findByProps({ 'aria-label': '发送延展' }).props.onClick(); await Promise.resolve() })
    const sends = mocks.callArkme.mock.calls.filter(([operation]) => operation === 'self-roles.bind' || operation === 'source.message-extension.extend')
    expect(sends.map(([operation]) => operation)).toEqual(['self-roles.bind', 'source.message-extension.extend'])
    expect(sends[0]?.[1]).toMatchObject({ expectedUserId: 42, recordUid, roleId: role.roleId })
    expect(onExtensionSent).toHaveBeenCalledWith(expect.objectContaining({
      extension: expect.objectContaining({ selfRole: { roleId: role.roleId, name: role.name, avatarRef: role.avatarRef } }),
    }))
    const row = renderer.root.findByProps({ 'data-arkme-note-extension-item': recordUid })
    expect(row.findByType(ArkmeUserAvatar).props.avatarRef).toBe(role.avatarRef)
  })

  it('keeps the quick-note detail silent while extension context is loading', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 }
      if (operation === 'source.message-extension.context') return await new Promise(() => {})
      throw new Error(`unexpected operation: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem} sourceRef="opaque-source" showOriginal={false}
        onClose={vi.fn()} onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve()
    })

    expect(JSON.stringify(renderer.toJSON())).not.toContain('加载延展中')
    expect(renderer.root.findAllByProps({ 'data-arkme-related-quick-notes-loading': true })).toHaveLength(0)
    expect(JSON.stringify(renderer.toJSON())).not.toContain('暂未找到相关快记')
  })

  it('reports detail extension failures through toast without rendering an inline error row', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 }
      if (operation === 'source.message-extension.context') return {
        parentRecordUid: 'record-source', extensionCount: 0, extensions: [],
      }
      if (operation === 'source.message-extension.extend') throw new Error('资源不存在')
      throw new Error(`unexpected operation: ${operation}`)
    })
    vi.stubGlobal('crypto', { randomUUID: vi.fn()
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222') })
    const onToast = vi.fn()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem} sourceRef="opaque-source" showOriginal={false}
        onClose={vi.fn()} onToggleOriginal={vi.fn()} onToast={onToast}
      />)
      await Promise.resolve(); await Promise.resolve()
    })
    act(() => {
      renderer.root.findByType(ArkmeRichComposerInput).props.onTextChange('继续延展')
    })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '发送延展' }).props.onClick()
      await Promise.resolve(); await Promise.resolve()
    })

    expect(onToast).toHaveBeenCalledWith('资源不存在')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('资源不存在')
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
  })

  it('uses the desktop detail footer divider and the shared chat send control', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 }
      throw new Error(`unexpected operation: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem}
        sourceRef="opaque-source"
        showOriginal={false}
        onClose={vi.fn()}
        onToggleOriginal={vi.fn()}
      />, { unstable_isConcurrent: true } as never)
      await Promise.resolve()
    })

    const input = renderer.root.findByType(ArkmeRichComposerInput)
    expect(input.findByProps({ role: 'textbox' }).props.contentEditable).toBe(true)
    expect(input.props.style).toMatchObject({
      fontSize: 14,
      minHeight: 28,
      maxHeight: 84,
      boxSizing: 'border-box',
      fieldSizing: 'content',
      overflowY: 'auto',
    })
    expect(input.parent?.props.style).toMatchObject({
      minHeight: 44,
      maxHeight: 100,
      border: 0,
      borderRadius: 12,
      background: '#f6f6f6',
    })
    expect(input.parent?.parent?.props.style).toMatchObject({
      padding: '12px 16px',
      borderTop: '0.5px solid #e6e6e6',
    })
    const attachmentButton = renderer.root.findByProps({ 'aria-label': '添加延展附件' })
    expect(attachmentButton.children).not.toContain('＋')
    expect(attachmentButton.props.style).toMatchObject({ width: 18, height: 28 })
    const sendButton = renderer.root.findByProps({ 'aria-label': '发送延展' })
    expect(sendButton.findByType('svg').props.viewBox).toBe('9.7 6.1 16 16')
    expect(sendButton.props.style).toMatchObject({ width: 36, height: 28, background: arkmeTheme.active, color: arkmeTheme.tertiary })

    const pastedImage = { name: 'desktop.png', type: 'image/png', size: 12 }
    const preventDefault = vi.fn()
    await act(async () => {
      input.props.onPaste({
        clipboardData: {
          files: [] as unknown as FileList,
          items: [{ kind: 'file', getAsFile: () => pastedImage }] as unknown as DataTransferItemList,
        },
        preventDefault,
      })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(mocks.stageFile).toHaveBeenCalledWith(pastedImage, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    const attachmentList = renderer.root.findByProps({ role: 'list', 'aria-label': '待发送附件' })
    const attachmentPreview = renderer.root.findAll(node => node.type === 'div'
      && node.props.style?.padding === '8px 16px'
      && node.findAll(child => child === attachmentList).length === 1)
    expect(attachmentPreview).toHaveLength(1)
    expect(attachmentPreview[0]?.props.style).not.toHaveProperty('borderTop')
    const attachment = renderer.root.findByProps({ 'aria-label': '附件 desktop.png' })
    expect(attachment.props.style).toMatchObject({ width: 48, height: 48, borderRadius: 8 })
    expect(attachment.findByType('img').props.src).toBe('blob:detail-clipboard-preview')
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    expect(mocks.removeLocalFile).not.toHaveBeenCalled()
    await act(async () => { renderer.root.findByProps({ 'aria-label': '预览 desktop.png' }).props.onClick() })
    const dialog = renderer.root.findByProps({ role: 'dialog', 'aria-label': 'desktop.png' })
    expect(dialog.findByType('img').props.src).toBe('blob:detail-clipboard-preview')
    expect(mocks.openLocalFile).not.toHaveBeenCalled()
  })

  it('keeps the detail extension draft and attachments while browsing related quick notes', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return relatedList
      throw new Error(`unexpected operation: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem}
        sourceRef="opaque-source"
        showOriginal={false}
        onClose={vi.fn()}
        onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve()
    })
    const detailInput = renderer.root.findByType(ArkmeRichComposerInput)
    act(() => { detailInput.props.onTextChange('独立抽屉草稿') })
    const fileInput = renderer.root.findByProps({ 'data-arkme-detail-extension-file-input': 'true' })
    await act(async () => {
      await fileInput.props.onChange({ currentTarget: { files: [{ name: 'draft.png', type: 'image/png', size: 12 }], value: '' } })
      await Promise.resolve()
    })

    act(() => { renderer.root.findByProps({ 'aria-label': '查看 2 条相关快记' }).props.onClick() })
    expect(renderer.root.findByType(ArkmeRichComposerInput).props.value).toBe('独立抽屉草稿')
    expect(renderer.root.findAllByProps({ 'aria-label': 'draft.png，第 1 个附件' })).toHaveLength(1)
    act(() => { renderer.root.findByProps({ 'aria-label': '返回快记详情' }).props.onClick() })
    expect(renderer.root.findByType(ArkmeRichComposerInput).props.value).toBe('独立抽屉草稿')
    expect(renderer.root.findAllByProps({ 'aria-label': 'draft.png，第 1 个附件' })).toHaveLength(1)
  })

  it('sends detail extension mentions with the same range payload as chat messages', async () => {
    const sent: ArkmeSourceMessageExtendResult = {
      recordUid: '11111111-1111-4111-8111-111111111111',
      parentRecordUid: 'record-source',
      relationUid: '22222222-2222-4222-8222-222222222222',
      status: 1,
      localState: 'synced',
      extension: {
        recordUid: '11111111-1111-4111-8111-111111111111', level: 2, sourceKind: 'record_extension',
        senderDisplayName: '我', title: '', textContent: '前缀@小林 收到', sendAtMillis: 1_710_000_180_000,
        templateKind: 1, displayKind: 0, officialMark: 0, mediaItems: [],
      },
    }
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 }
      if (operation === 'source.message-extension.context') return {
        parentRecordUid: 'record-source', extensionCount: 0, extensions: [],
      }
      if (operation === 'group.bots') return {
        groupSourceRef: 'opaque-source', displayName: '测试群', canAddBots: false, items: [],
      }
      if (operation === 'source.message-extension.extend') return sent
      throw new Error(`unexpected operation: ${operation}`)
    })
    vi.stubGlobal('crypto', { randomUUID: vi.fn()
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222') })
    const member: ArkmeConversationMemberItem = {
      memberRef: 'member-ref',
      mentionRef: 'mention-ref',
      mentionDisplayName: '小林',
      displayName: '小林',
      role: 'member',
      status: 'active',
      isSelf: false,
      isOwner: false,
      joinedAtMillis: 1,
      recordCount: 0,
      mentionCount: 0,
    }
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem}
        sourceRef="opaque-source"
        sourceKind="group_chat"
        conversationMembers={[member]}
        showOriginal={false}
        onClose={vi.fn()}
        onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve(); await Promise.resolve()
    })
    act(() => {
      const input = renderer.root.findByType(ArkmeRichComposerInput)
      input.props.onTextChange('前缀@小')
      input.props.onSelectionChange('前缀@小', 4, 4)
    })
    const option = renderer.root.findByProps({ role: 'option' })
    act(() => {
      option.props.onMouseDown({ preventDefault: vi.fn() })
    })
    act(() => {
      renderer.root.findByType(ArkmeRichComposerInput).props.onTextChange('前缀@小林 收到')
    })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '发送延展' }).props.onClick()
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith('source.message-extension.extend', expect.objectContaining({
      sourceRef: 'opaque-source',
      messageActionRef: 'opaque-action',
      textContent: '前缀@小林 收到',
      humanMentions: [{ mentionRef: 'mention-ref', startIndex: 2, length: 3 }],
    }), expect.any(AbortSignal))

    const mentionLinks = renderer.root.findAllByProps({ 'aria-label': '查看 @小林' })
    expect(mentionLinks).toHaveLength(1)
    act(() => {
      mentionLinks[0]!.props.onClick({ preventDefault: vi.fn(), stopPropagation: vi.fn() })
    })
    expect(renderer.root.findAllByProps({ 'data-arkme-profile-send-state': 'idle' })).toHaveLength(1)
  })

  it('sends detail extension reserved Asen mentions as bot mention metadata', async () => {
    const sent: ArkmeSourceMessageExtendResult = {
      recordUid: '11111111-1111-4111-8111-111111111111',
      parentRecordUid: 'record-source',
      relationUid: '22222222-2222-4222-8222-222222222222',
      status: 1,
      localState: 'synced',
      extension: {
        recordUid: '11111111-1111-4111-8111-111111111111', level: 2, sourceKind: 'record_extension',
        senderDisplayName: '我', title: '', textContent: '@阿森 帮看', sendAtMillis: 1_710_000_180_000,
        templateKind: 1, displayKind: 0, officialMark: 0, mediaItems: [],
      },
    }
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 }
      if (operation === 'source.message-extension.context') return {
        parentRecordUid: 'record-source', extensionCount: 0, extensions: [],
      }
      if (operation === 'group.bots') return {
        groupSourceRef: 'opaque-source', displayName: '测试群', canAddBots: false, items: [],
      }
      if (operation === 'source.message-extension.extend') return sent
      throw new Error(`unexpected operation: ${operation}`)
    })
    vi.stubGlobal('crypto', { randomUUID: vi.fn()
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222') })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem}
        sourceRef="opaque-source"
        sourceKind="group_chat"
        conversationMembers={[]}
        showOriginal={false}
        onClose={vi.fn()}
        onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve(); await Promise.resolve()
    })
    act(() => {
      const input = renderer.root.findByType(ArkmeRichComposerInput)
      input.props.onTextChange('@阿')
      input.props.onSelectionChange('@阿', 2, 2)
    })
    const option = renderer.root.findByProps({ role: 'option' })
    expect(option.findByType('img').props.src).toContain('image/svg+xml')
    expect(option.findAllByType('span').some(span => span.children.includes('AI智能体'))).toBe(true)
    act(() => {
      option.props.onMouseDown({ preventDefault: vi.fn() })
    })
    act(() => {
      renderer.root.findByType(ArkmeRichComposerInput).props.onTextChange('@阿森 帮看')
    })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '发送延展' }).props.onClick()
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith('source.message-extension.extend', expect.objectContaining({
      sourceRef: 'opaque-source',
      messageActionRef: 'opaque-action',
      textContent: '@阿森 帮看',
      botMentions: [{ botRef: 'asen', startIndex: 0, length: 3 }],
    }), expect.any(AbortSignal))
  })

  it('triggers and sends detail Asen mentions after leading text like the desktop composer', async () => {
    const sent: ArkmeSourceMessageExtendResult = {
      recordUid: '11111111-1111-4111-8111-111111111111',
      parentRecordUid: 'record-source',
      relationUid: '22222222-2222-4222-8222-222222222222',
      status: 1,
      localState: 'synced',
      extension: {
        recordUid: '11111111-1111-4111-8111-111111111111', level: 2, sourceKind: 'record_extension',
        senderDisplayName: '我', title: '', textContent: '前缀@阿森 帮看', sendAtMillis: 1_710_000_180_000,
        templateKind: 1, displayKind: 0, officialMark: 0, mediaItems: [],
      },
    }
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 }
      if (operation === 'source.message-extension.context') return {
        parentRecordUid: 'record-source', extensionCount: 0, extensions: [],
      }
      if (operation === 'group.bots') return {
        groupSourceRef: 'opaque-source', displayName: '测试群', canAddBots: false, items: [],
      }
      if (operation === 'source.message-extension.extend') return sent
      throw new Error(`unexpected operation: ${operation}`)
    })
    vi.stubGlobal('crypto', { randomUUID: vi.fn()
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222') })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem}
        sourceRef="opaque-source"
        sourceKind="group_chat"
        conversationMembers={[]}
        showOriginal={false}
        onClose={vi.fn()}
        onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve(); await Promise.resolve()
    })
    act(() => {
      const input = renderer.root.findByType(ArkmeRichComposerInput)
      input.props.onTextChange('前缀@阿')
      input.props.onSelectionChange('前缀@阿', 4, 4)
    })
    const option = renderer.root.findByProps({ role: 'option' })
    act(() => {
      option.props.onMouseDown({ preventDefault: vi.fn() })
    })
    act(() => {
      renderer.root.findByType(ArkmeRichComposerInput).props.onTextChange('前缀@阿森 帮看')
    })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '发送延展' }).props.onClick()
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith('source.message-extension.extend', expect.objectContaining({
      sourceRef: 'opaque-source',
      messageActionRef: 'opaque-action',
      textContent: '前缀@阿森 帮看',
      botMentions: [{ botRef: 'asen', startIndex: 2, length: 3 }],
    }), expect.any(AbortSignal))
  })

  it('keeps raw detail extension text so leading trim does not corrupt Asen mention ranges', async () => {
    const sent: ArkmeSourceMessageExtendResult = {
      recordUid: '11111111-1111-4111-8111-111111111111',
      parentRecordUid: 'record-source',
      relationUid: '22222222-2222-4222-8222-222222222222',
      status: 1,
      localState: 'synced',
      extension: {
        recordUid: '11111111-1111-4111-8111-111111111111', level: 2, sourceKind: 'record_extension',
        senderDisplayName: '我', title: '', textContent: '@阿森 帮看', sendAtMillis: 1_710_000_180_000,
        templateKind: 1, displayKind: 0, officialMark: 0, mediaItems: [],
      },
    }
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 }
      if (operation === 'source.message-extension.context') return {
        parentRecordUid: 'record-source', extensionCount: 0, extensions: [],
      }
      if (operation === 'group.bots') return {
        groupSourceRef: 'opaque-source', displayName: '测试群', canAddBots: false, items: [],
      }
      if (operation === 'source.message-extension.extend') return sent
      throw new Error(`unexpected operation: ${operation}`)
    })
    vi.stubGlobal('crypto', { randomUUID: vi.fn()
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222') })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem}
        sourceRef="opaque-source"
        sourceKind="group_chat"
        conversationMembers={[]}
        showOriginal={false}
        onClose={vi.fn()}
        onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve(); await Promise.resolve()
    })
    act(() => {
      const input = renderer.root.findByType(ArkmeRichComposerInput)
      input.props.onTextChange('  @阿')
      input.props.onSelectionChange('  @阿', 4, 4)
    })
    const option = renderer.root.findByProps({ role: 'option' })
    act(() => {
      option.props.onMouseDown({ preventDefault: vi.fn() })
    })
    act(() => {
      renderer.root.findByType(ArkmeRichComposerInput).props.onTextChange('  @阿森 帮看')
    })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '发送延展' }).props.onClick()
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith('source.message-extension.extend', expect.objectContaining({
      sourceRef: 'opaque-source',
      messageActionRef: 'opaque-action',
      textContent: '  @阿森 帮看',
      botMentions: [{ botRef: 'asen', startIndex: 2, length: 3 }],
    }), expect.any(AbortSignal))
  })

  it('reuses the same detail extension record uid after a failed send', async () => {
    let attempts = 0
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 }
      if (operation === 'source.message-extension.extend') {
        attempts += 1
        if (attempts === 1) throw new Error('网络中断')
        return { recordUid: params?.recordUid, parentRecordUid: 'record-source', status: 1, localState: 'synced' }
      }
      throw new Error(`unexpected operation: ${operation}`)
    })
    const uuids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => uuids.shift()) })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem} sourceRef="opaque-source" showOriginal={false}
        onClose={vi.fn()} onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve()
    })
    act(() => { renderer.root.findByType(ArkmeRichComposerInput).props.onTextChange('失败后重试') })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '发送延展' }).props.onClick()
      await Promise.resolve(); await Promise.resolve()
    })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '发送延展' }).props.onClick()
      await Promise.resolve(); await Promise.resolve()
    })

    const extensionCalls = mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.message-extension.extend')
    expect(extensionCalls).toHaveLength(2)
    expect(extensionCalls[0]?.[1]?.recordUid).toBe('11111111-1111-4111-8111-111111111111')
    expect(extensionCalls[1]?.[1]?.recordUid).toBe(extensionCalls[0]?.[1]?.recordUid)
    expect(extensionCalls[0]?.[1]?.relationUid).toBe('22222222-2222-4222-8222-222222222222')
    expect(extensionCalls[1]?.[1]?.relationUid).toBe(extensionCalls[0]?.[1]?.relationUid)
  })

  it('removes staged detail attachments when the drawer is discarded', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 }
      throw new Error(`unexpected operation: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem} sourceRef="opaque-source" showOriginal={false}
        onClose={vi.fn()} onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve()
    })
    const fileInput = renderer.root.findByProps({ 'data-arkme-detail-extension-file-input': 'true' })
    await act(async () => {
      await fileInput.props.onChange({ currentTarget: { files: [{ name: 'discard.png', type: 'image/png', size: 12 }], value: '' } })
      await Promise.resolve()
    })
    await act(async () => { renderer.unmount(); await Promise.resolve() })
    expect(mocks.removeLocalFile).toHaveBeenCalledWith('arkme-file-v1.11111111-1111-4111-8111-111111111111')
  })

  it('aborts an in-flight detail extension before cleaning its staged attachment on close', async () => {
    let requestSignal: AbortSignal | undefined
    mocks.callArkme.mockImplementation(async (operation: string, _params?: Record<string, unknown>, signal?: AbortSignal) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 }
      if (operation === 'source.message-extension.extend') {
        requestSignal = signal
        return await new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
        })
      }
      throw new Error(`unexpected operation: ${operation}`)
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem} sourceRef="opaque-source" showOriginal={false}
        onClose={vi.fn()} onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve()
    })
    const fileInput = renderer.root.findByProps({ 'data-arkme-detail-extension-file-input': 'true' })
    await act(async () => {
      await fileInput.props.onChange({ currentTarget: { files: [{ name: 'sending.png', type: 'image/png', size: 12 }], value: '' } })
      await Promise.resolve()
    })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '发送延展' }).props.onClick()
      await Promise.resolve()
    })
    expect(mocks.removeLocalFile).not.toHaveBeenCalled()
    await act(async () => { renderer.unmount(); await Promise.resolve(); await Promise.resolve() })
    expect(requestSignal?.aborted).toBe(true)
    expect(mocks.removeLocalFile).toHaveBeenCalledWith('arkme-file-v1.11111111-1111-4111-8111-111111111111')
  })

  it('does not let an old detail send clear the next target draft', async () => {
    let resolveOldSend!: (value: unknown) => void
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 }
      if (operation === 'source.message-extension.extend') return await new Promise(resolve => { resolveOldSend = resolve })
      throw new Error(`unexpected operation: ${operation}`)
    })
    const uuids = [
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ]
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => uuids.shift()) })
    let renderer!: ReactTestRenderer
    const renderDrawer = (item: ArkmeTimelineItem) => <ArkmeTimelineDetailDrawer
      item={item} sourceRef="opaque-source" showOriginal={false}
      onClose={vi.fn()} onToggleOriginal={vi.fn()}
    />
    await act(async () => { renderer = create(renderDrawer(timelineItem)); await Promise.resolve() })
    act(() => { renderer.root.findByType(ArkmeRichComposerInput).props.onTextChange('旧目标内容') })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '发送延展' }).props.onClick()
      await Promise.resolve()
    })
    const nextItem = { ...timelineItem, itemUid: 'record-next', messageActionRef: 'opaque-next-action', textContent: '新目标' }
    await act(async () => { renderer.update(renderDrawer(nextItem)); await Promise.resolve() })
    act(() => { renderer.root.findByType(ArkmeRichComposerInput).props.onTextChange('新目标草稿') })
    await act(async () => {
      resolveOldSend({ recordUid: 'old-record', parentRecordUid: 'record-source', status: 1, localState: 'synced' })
      await Promise.resolve(); await Promise.resolve()
    })
    expect(renderer.root.findByType(ArkmeRichComposerInput).props.value).toBe('新目标草稿')
  })

  it('keeps an independent detail-drawer extension draft and sends an attachment-only extension', async () => {
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'source.related-quick-notes.from-message') return { total: 0, items: [], recallMode: 'embedding', retryable: false, retryAfterMillis: 1500 }
      if (operation === 'source.message-extension.extend') return {
        recordUid: params?.recordUid, parentRecordUid: 'record-source', status: 1, localState: 'synced',
        extension: { recordUid: params?.recordUid, level: 2, sourceKind: 'record_extension', senderDisplayName: '我', title: '', textContent: '', sendAtMillis: 1, templateKind: 2, displayKind: 0, officialMark: 0, mediaItems: [] },
      }
      throw new Error(`unexpected operation: ${operation}`)
    })
    const uuids = [
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ]
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => uuids.shift()) })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<ArkmeTimelineDetailDrawer
        item={timelineItem}
        sourceRef="opaque-source"
        showOriginal={false}
        onClose={vi.fn()}
        onToggleOriginal={vi.fn()}
      />)
      await Promise.resolve()
    })

    const detailInput = renderer.root.findByType(ArkmeRichComposerInput)
    expect(detailInput.props.value).toBe('')
    const fileInput = renderer.root.findByProps({ 'data-arkme-detail-extension-file-input': 'true' })
    const image = { name: 'detail.png', type: 'image/png', size: 12 }
    await act(async () => {
      await fileInput.props.onChange({ currentTarget: { files: [image], value: '' } })
      await Promise.resolve()
    })
    expect(mocks.stageFile).toHaveBeenCalledWith(image, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(renderer.root.findAllByProps({ 'aria-label': 'detail.png，第 1 个附件' })).toHaveLength(1)

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': '发送延展' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.callArkme).toHaveBeenCalledWith('source.message-extension.extend', {
      sourceRef: 'opaque-source',
      messageActionRef: 'opaque-action',
      textContent: '',
      recordUid: '22222222-2222-4222-8222-222222222222',
      relationUid: '33333333-3333-4333-8333-333333333333',
      fileRefs: ['arkme-file-v1.11111111-1111-4111-8111-111111111111'],
    }, expect.any(AbortSignal))
    expect(renderer.root.findAllByProps({ 'aria-label': 'detail.png，第 1 个附件' })).toHaveLength(0)
    expect(renderer.root.findByType(ArkmeRichComposerInput).props.value).toBe('')
  })
})
