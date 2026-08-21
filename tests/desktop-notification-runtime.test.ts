import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'
import {
  ArkmeDesktopNotificationRuntime, type ArkmeDesktopNotificationBridge,
} from '../src/client/desktop-notification-runtime.js'
import { ArkmeNotificationActivationStore } from '../src/client/notification-activation-store.js'

describe('Arkme desktop notification runtime', () => {
  it('silently degrades without a Harness bridge', async () => {
    const runtime = new ArkmeDesktopNotificationRuntime(() => undefined)

    await expect(runtime.show({
      eventUid: 'event-1', sourceRef: 'source-1', sourceKind: 'private_chat',
      title: '林溪', body: '你好', eventAtMillis: 1,
    })).resolves.toBe(false)
    expect(runtime.onActivated(() => undefined)).toBeTypeOf('function')
  })

  it('deduplicates event UIDs and forwards activation subscriptions', async () => {
    const stop = vi.fn()
    const bridge: ArkmeDesktopNotificationBridge = {
      show: vi.fn(async () => ({ shown: true })),
      onActivated: vi.fn(() => stop),
    }
    const runtime = new ArkmeDesktopNotificationRuntime(() => bridge)
    const notification = {
      eventUid: 'event-1', sourceRef: 'source-1', sourceKind: 'group_chat' as const,
      title: '产品群', body: '周鹏：你好', eventAtMillis: 1,
    }

    await expect(runtime.show(notification)).resolves.toBe(true)
    await expect(runtime.show(notification)).resolves.toBe(false)
    expect(bridge.show).toHaveBeenCalledOnce()
    const listener = vi.fn()
    expect(runtime.onActivated(listener)).toBe(stop)
    expect(bridge.onActivated).toHaveBeenCalledWith(listener)
  })
})

describe('notification activation store', () => {
  it('retains one resolved source until navigation consumes it', () => {
    const store = new ArkmeNotificationActivationStore()
    const source: ArkmeSourceItem = {
      sourceRef: 'source-1', kind: 'private_chat', displayName: '林溪',
      activeAtMillis: 1, unreadCount: 1, latestSequence: 3,
    }

    store.publish(source)
    const pending = store.getSnapshot()
    expect(pending.source).toEqual(source)
    store.consume(pending.revision)
    expect(store.getSnapshot()).toEqual({ revision: pending.revision + 1 })
  })
})
