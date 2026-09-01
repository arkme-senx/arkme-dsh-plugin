import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'
import {
  ARKME_NOTIFICATION_BLOCKING_OVERLAY_SELECTOR,
  ARKME_NOTIFICATION_OVERLAY_OBSERVER_TIMEOUT_MILLIS,
  observeArkmeNotificationBlockingOverlayChanges,
  takeArkmeNotificationSurfaceCommit,
} from '../src/client/ArkmeSidebar.js'
import { ArkmeNotificationActivationStore } from '../src/client/notification-activation-store.js'
import { arkmeSourceIdentityKey } from '../src/client/source-identity.js'

const targetSource: ArkmeSourceItem = {
  sourceRef: 'notification-target-ref', sourceKey: 'notification-target-key',
  kind: 'private_chat', displayName: '通知目标会话', activeAtMillis: 100, unreadCount: 1,
}

describe('notification activation view commit', () => {
  it('does not commit for a mismatched panel identity or a real blocking overlay', () => {
    const store = new ArkmeNotificationActivationStore()
    store.publish('activation-commit', targetSource)
    const revision = store.getSnapshot().revision
    const targetIdentity = arkmeSourceIdentityKey(targetSource)
    store.markNavigationApplied(revision)
    let panelIdentity = 'source:other'
    let blockingOverlay = false
    const panel = { getAttribute: () => panelIdentity }
    const documentScope = {
      querySelector: (selector: string) => {
        expect(selector).toBe(ARKME_NOTIFICATION_BLOCKING_OVERLAY_SELECTOR)
        return blockingOverlay ? {} : null
      },
    }
    const take = () => takeArkmeNotificationSurfaceCommit({
      store,
      revision,
      targetIdentity,
      activeConversation: true,
      sourceIdentity: targetIdentity,
      panel,
      documentScope: documentScope as never,
    })

    expect(take()).toBeUndefined()
    expect(store.getSnapshot().surfaceCommitted).toBe(false)

    panelIdentity = targetIdentity
    blockingOverlay = true
    expect(take()).toBeUndefined()
    expect(store.getSnapshot().surfaceCommitted).toBe(false)

    blockingOverlay = false
    expect(take()).toMatchObject({ activationId: 'activation-commit', source: targetSource })
    expect(store.getSnapshot().source).toBeUndefined()
  })

  it('bounds the blocking-overlay observer and makes timeout/unmount cleanup idempotent', () => {
    const observe = vi.fn()
    const disconnect = vi.fn()
    const clearTimer = vi.fn()
    let timeoutCallback = () => undefined
    const stop = observeArkmeNotificationBlockingOverlayChanges({} as Node, vi.fn(), {
      createObserver: () => ({ observe, disconnect }),
      setTimer: (callback, delay) => {
        expect(delay).toBe(ARKME_NOTIFICATION_OVERLAY_OBSERVER_TIMEOUT_MILLIS)
        timeoutCallback = callback
        return 91 as never
      },
      clearTimer,
    })

    expect(observe).toHaveBeenCalledWith({}, { childList: true, subtree: true })
    timeoutCallback()
    stop()
    expect(disconnect).toHaveBeenCalledOnce()
    expect(clearTimer).toHaveBeenCalledOnce()
  })
})
