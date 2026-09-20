import { describe, expect, it } from 'vitest'
import type { ArkmePrivateInteraction, ArkmeSourceItem } from '../src/types.js'
import { applyPrivateInteractionDirectory, projectPrivateInteractions, mergePrivateInteractionSources } from '../src/client/private-interaction-directory.js'

function interaction(overrides: Partial<ArkmePrivateInteraction> = {}): ArkmePrivateInteraction {
  return {
    interactionRef: 'a'.repeat(64),
    privateSourceRef: 'private-source',
    peerName: '小林',
    groupSourceRef: 'group-source',
    groupName: '项目群',
    sequence: 4,
    occurredAtMillis: 2_000,
    senderIsMe: false,
    summary: '请看一下接口',
    unread: true,
    attention: true,
    ...overrides,
  }
}

function source(overrides: Partial<ArkmeSourceItem> = {}): ArkmeSourceItem {
  return {
    sourceRef: 'private-source',
    kind: 'private_chat',
    displayName: '小林',
    activeAtMillis: 1_000,
    unreadCount: 0,
    ...overrides,
  }
}

describe('private interaction directory projection', () => {
  it('keeps direct unread separate while projecting a newer group interaction', () => {
    const page = projectPrivateInteractions([interaction()], 'v1')
    const result = applyPrivateInteractionDirectory([source({ unreadCount: 2 })], page)
    expect(result[0]).toMatchObject({
      latestPreview: '项目群 · 小林：请看一下接口',
      activeAtMillis: 2_000,
      unreadCount: 2,
      privateInteraction: { unreadCount: 1, attentionCount: 1, version: 'v1' },
    })
  })

  it('does not replace a newer direct message with an older interaction', () => {
    const page = projectPrivateInteractions([interaction({ occurredAtMillis: 900 })], 'v2')
    const result = applyPrivateInteractionDirectory([source({ latestPreview: '直接消息', activeAtMillis: 1_000 })], page)
    expect(result[0]).toMatchObject({ latestPreview: '直接消息', activeAtMillis: 1_000 })
    expect(result[0]?.privateInteraction?.latest.summary).toBe('请看一下接口')
  })

  it('creates an existing-contact projection when there is no direct message row yet', () => {
    const page = projectPrivateInteractions([interaction({ senderIsMe: true, unread: false, attention: false })], 'v3')
    const result = applyPrivateInteractionDirectory([], page)
    expect(result[0]).toMatchObject({
      sourceRef: 'private-source', kind: 'private_chat', displayName: '小林',
      latestPreview: '项目群 · 我：请看一下接口', activeAtMillis: 2_000, unreadCount: 0,
    })
  })

  it('deduplicates repeated interaction occurrences', () => {
    const item = interaction()
    const page = projectPrivateInteractions([item, item], 'v4')
    expect(page.get('private-source')).toMatchObject({ unreadCount: 1, attentionCount: 1 })
  })

  it('matches a stable peer key across changed remarks and sealed references', () => {
    const rows = applyPrivateInteractionDirectory([source({ sourceKey: 'peer', sourceRef: 'remark-ref', displayName: '周鹏' })],
      projectPrivateInteractions([interaction({ privateSourceKey: 'peer', privateSourceRef: 'nickname-ref' })], 'v1'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ displayName: '周鹏', activeAtMillis: 2000 })
  })

  it('uses complete server counts without changing direct unread, remark or avatar', () => {
    const current = source({ sourceKey: 'peer', sourceRef: 'remark-ref', displayName: '备注', avatarRef: 'avatar', unreadCount: 3 })
    const incoming = source({ sourceKey: 'peer', sourceRef: 'new-ref', activeAtMillis: 2000,
      latestPreview: '项目群 · 我：@小林 测试', privateInteraction: { latest: interaction(), version: 'v1', unreadCount: 87, attentionCount: 86 } })
    const [result] = mergePrivateInteractionSources([current], [incoming])
    expect(result).toMatchObject({ sourceRef: 'new-ref', displayName: '备注', avatarRef: 'avatar', unreadCount: 3,
      latestPreview: incoming.latestPreview, activeAtMillis: 2000, privateInteraction: { attentionCount: 86 } })
    const [read] = mergePrivateInteractionSources([current], [{ ...incoming, privateInteraction: { ...incoming.privateInteraction!, unreadCount: 0, attentionCount: 0 } }])
    expect(read).toMatchObject({ unreadCount: 3, privateInteraction: { attentionCount: 0 }, latestPreview: incoming.latestPreview })
  })

  it('does not let a delayed interaction response replace a newer direct message', () => {
    const current = source({ sourceKey: 'peer', activeAtMillis: 5000, latestSequence: 9, latestPreview: '最新私聊' })
    const old = source({ sourceKey: 'peer', activeAtMillis: 2000, latestPreview: '旧群互动', privateInteraction: {
      latest: interaction(), unreadCount: 1, attentionCount: 1, version: 'v1',
    } })
    expect(mergePrivateInteractionSources([current], [old])[0]).toMatchObject({ latestPreview: '最新私聊', activeAtMillis: 5000 })
    expect(mergePrivateInteractionSources([current], [{ ...old, activeAtMillis: 5000, latestSequence: 8 }])[0]?.latestPreview).toBe('最新私聊')
  })

  it('adds visible zero-message contacts but never resurrects excluded contacts', () => {
    const incoming = source({ sourceKey: 'peer', privateInteraction: { latest: interaction(), unreadCount: 0, attentionCount: 0, version: 'v1' } })
    expect(mergePrivateInteractionSources([], [incoming])).toEqual([incoming])
    expect(mergePrivateInteractionSources([], [incoming], new Set(['peer']))).toEqual([])
    expect(mergePrivateInteractionSources([], [source()])).toEqual([])
  })
})
