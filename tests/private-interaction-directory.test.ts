import { describe, expect, it } from 'vitest'
import type { ArkmePrivateInteraction, ArkmeSourceItem } from '../src/types.js'
import { applyPrivateInteractionDirectory, projectPrivateInteractions } from '../src/client/private-interaction-directory.js'

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
})
