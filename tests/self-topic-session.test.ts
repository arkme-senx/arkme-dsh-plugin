import { describe, expect, it } from 'vitest'
import { ArkmeUiController } from '../src/client/ui-controller.js'
import type { ArkmeSourceItem } from '../src/types.js'

const topic: ArkmeSourceItem = { kind: 'topic', sourceRef: 'work', topicHierarchyKey: 'work-id', displayName: '工作' }
const peer: ArkmeSourceItem = { kind: 'private_chat', sourceRef: 'peer', displayName: '同事' }

describe('personal topic memory in the current account session', () => {
  it.each([
    topic,
    { ...topic, sourceRef: 'child', topicHierarchyKey: 'child-id', parentSourceRef: 'work', displayName: '子主题' },
    { kind: 'default_category', sourceRef: 'default', displayName: '未分类' } as ArkmeSourceItem,
  ])('returns to $displayName after switching conversations and product pages', selected => {
    const controller = new ArkmeUiController()
    controller.authChanged(true)
    controller.selectSource(selected)
    controller.selectSource(peer)
    controller.showNotifications()
    controller.showRecordings()
    controller.resumeSendToSelf()
    expect(controller.getSnapshot()).toMatchObject({ mode: 'source', selectedSource: selected })
    controller.selectSource({ ...peer, kind: 'group_chat' })
    controller.resumeSendToSelf()
    expect(controller.getSnapshot().selectedSource).toEqual(selected)
  })

  it.each(['explicit-all', 'aggregate-source'] as const)('remembers all after %s rather than reviving the old topic', entry => {
    const controller = new ArkmeUiController()
    controller.selectSource(topic)
    if (entry === 'explicit-all') controller.focusSendToSelf()
    else controller.selectSource({ kind: 'send_to_self', sourceRef: 'self', displayName: '全部' })
    controller.selectSource(peer)
    controller.resumeSendToSelf()
    expect(controller.getSnapshot()).toMatchObject({ mode: 'source' })
    expect(controller.getSnapshot().selectedSource).toBeUndefined()
  })

  it('preserves the topic on credential refresh, and clears it on account replacement, logout and a fresh client', () => {
    const controller = new ArkmeUiController()
    controller.authChanged(true)
    controller.selectSource(topic)
    controller.selectSource(peer)
    controller.authChanged(true)
    controller.resumeSendToSelf()
    expect(controller.getSnapshot().selectedSource).toEqual(topic)
    controller.authChanged(true, true)
    controller.resumeSendToSelf()
    expect(controller.getSnapshot().selectedSource).toBeUndefined()
    controller.selectSource(topic)
    controller.authChanged(false)
    controller.authChanged(true)
    controller.resumeSendToSelf()
    expect(controller.getSnapshot().selectedSource).toBeUndefined()
    controller.selectSource(topic)
    const restarted = new ArkmeUiController()
    restarted.authChanged(true)
    expect(restarted.getSnapshot().mode).toBe('harness')
    restarted.resumeSendToSelf()
    expect(restarted.getSnapshot().selectedSource).toBeUndefined()
  })

  it('retains refreshed topic metadata and clears a previous message jump on ordinary return', () => {
    const controller = new ArkmeUiController()
    controller.selectSource(topic)
    const refreshed = { ...topic, sourceRef: 'fresh-work-ref', displayName: '工作改名' }
    expect(controller.updateSelectedSourceProjection(refreshed)).toBe(true)
    controller.showConversationTarget(peer, 'old-message', 123)
    controller.resumeSendToSelf()
    expect(controller.getSnapshot().selectedSource).toEqual(refreshed)
    expect(controller.getSnapshot().conversationTarget).toBeUndefined()
  })

  it('opens an explicit self message target in its own topic and remembers that destination', () => {
    const controller = new ArkmeUiController()
    controller.selectSource(topic)
    const target = { ...topic, sourceRef: 'other-topic', topicHierarchyKey: 'other-id' }
    controller.showConversationTarget(target, 'message', 123)
    expect(controller.getSnapshot()).toMatchObject({ selectedSource: target, conversationTarget: { itemUid: 'message' } })
    controller.selectSource(peer)
    controller.resumeSendToSelf()
    expect(controller.getSnapshot().selectedSource).toEqual(target)
    expect(controller.getSnapshot().conversationTarget).toBeUndefined()
  })
})
