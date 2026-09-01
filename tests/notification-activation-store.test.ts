import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'
import { ArkmeNotificationActivationStore } from '../src/client/notification-activation-store.js'

const sourceA: ArkmeSourceItem = {
  sourceRef: 'notification-a', sourceKey: 'chat:a', kind: 'private_chat',
  displayName: '会话 A', activeAtMillis: 1, unreadCount: 1,
}
const sourceB: ArkmeSourceItem = {
  sourceRef: 'notification-b', sourceKey: 'chat:b', kind: 'group_chat',
  displayName: '会话 B', activeAtMillis: 2, unreadCount: 1,
}

describe('notification activation commit barrier', () => {
  it.each([
    ['navigation then surface', ['navigation', 'surface']],
    ['surface then navigation', ['surface', 'navigation']],
  ] as const)('takes an activation only after both owners commit: %s', (_label, order) => {
    const store = new ArkmeNotificationActivationStore()
    store.publish('activation-a', sourceA)
    const revision = store.getSnapshot().revision

    for (const [index, owner] of order.entries()) {
      expect(owner === 'navigation'
        ? store.markNavigationApplied(revision)
        : store.markSurfaceCommitted(revision)).toBe(true)
      if (index === 0) expect(store.takeReady(revision)).toBeUndefined()
    }

    expect(store.takeReady(revision)).toMatchObject({
      revision,
      activationId: 'activation-a',
      source: sourceA,
      navigationApplied: true,
      surfaceCommitted: true,
    })
    expect(store.getSnapshot()).toMatchObject({
      revision: revision + 1,
      navigationApplied: false,
      surfaceCommitted: false,
    })
    expect(store.getSnapshot().source).toBeUndefined()
  })

  it('makes owner marks idempotent and rejects stale async commits after A is displaced by B', () => {
    const store = new ArkmeNotificationActivationStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.publish('activation-a', sourceA)
    const revisionA = store.getSnapshot().revision
    expect(store.markNavigationApplied(revisionA)).toBe(true)
    const emittedAfterFirstMark = listener.mock.calls.length
    expect(store.markNavigationApplied(revisionA)).toBe(true)
    expect(listener).toHaveBeenCalledTimes(emittedAfterFirstMark)

    const displaced = store.publish('activation-b', sourceB)
    const revisionB = store.getSnapshot().revision
    expect(displaced).toMatchObject({ revision: revisionA, activationId: 'activation-a', source: sourceA })
    expect(store.markSurfaceCommitted(revisionA)).toBe(false)
    expect(store.takeReady(revisionA)).toBeUndefined()
    expect(store.getSnapshot()).toMatchObject({
      revision: revisionB,
      activationId: 'activation-b',
      source: sourceB,
      navigationApplied: false,
      surfaceCommitted: false,
    })
  })
})
