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
      eventUid: 'event-1', sourceRef: 'source-1', sourceKey: 'source-key-1', sourceKind: 'private_chat',
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
      eventUid: 'event-1', sourceRef: 'source-1', sourceKey: 'source-key-1', sourceKind: 'group_chat' as const,
      title: '产品群', body: '周鹏：你好', eventAtMillis: 1,
    }

    await expect(runtime.show(notification)).resolves.toBe(true)
    await expect(runtime.show(notification)).resolves.toBe(false)
    expect(bridge.show).toHaveBeenCalledOnce()
    const listener = vi.fn()
    expect(runtime.onActivated(listener)).toBe(stop)
    const bridgeListener = vi.mocked(bridge.onActivated).mock.calls[0]?.[0]
    bridgeListener?.('source-1')
    expect(listener).toHaveBeenCalledWith({ sourceRef: 'source-1', sourceKey: 'source-key-1' })
  })

  it('uses the standard browser Notification API when no native bridge is injected', async () => {
    const focus = vi.fn()
    const close = vi.fn()
    let created: { title: string; options?: NotificationOptions; onclick: ((event: Event) => void) | null } | undefined
    class FakeNotification {
      static permission: NotificationPermission = 'granted'
      static async requestPermission(): Promise<NotificationPermission> { return 'granted' }
      onclick: ((event: Event) => void) | null = null
      constructor(readonly title: string, readonly options?: NotificationOptions) {
        created = this
      }
      close() { close() }
    }
    vi.stubGlobal('window', { focus })
    vi.stubGlobal('Notification', FakeNotification)
    try {
      const runtime = new ArkmeDesktopNotificationRuntime()
      const activated = vi.fn()
      const stop = runtime.onActivated(activated)

      await expect(runtime.show({
        eventUid: 'event-browser', sourceRef: 'source-browser', sourceKey: 'source-key-browser', sourceKind: 'private_chat',
        title: '林溪', body: '你好', eventAtMillis: 1,
      })).resolves.toBe(true)
      expect(created).toMatchObject({ title: '林溪', options: { body: '你好', tag: 'arkme-message-event-browser' } })
      created?.onclick?.(new Event('click'))
      expect(focus).toHaveBeenCalledOnce()
      expect(activated).toHaveBeenCalledWith({ sourceRef: 'source-browser', sourceKey: 'source-key-browser' })
      expect(close).toHaveBeenCalledOnce()
      stop()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('requests permission through the selected bridge', async () => {
    const bridge: ArkmeDesktopNotificationBridge = {
      show: vi.fn(async () => ({ shown: true })),
      onActivated: vi.fn(() => vi.fn()),
      permission: vi.fn(() => 'default'),
      requestPermission: vi.fn(async () => 'granted'),
    }
    const runtime = new ArkmeDesktopNotificationRuntime(() => bridge)

    expect(runtime.permission()).toBe('default')
    await expect(runtime.requestPermission()).resolves.toBe('granted')
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
