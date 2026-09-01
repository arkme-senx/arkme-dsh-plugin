import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'
import {
  ArkmeDesktopNotificationRuntime, type ArkmeDesktopNotificationBridge, type ArkmeDesktopNotificationPermission,
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

  it('deduplicates event UIDs and forwards legacy-only activation subscriptions', async () => {
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
    expect(runtime.permission()).toBe('system-managed')
    await expect(runtime.requestPermission()).resolves.toBe('system-managed')
    const listener = vi.fn()
    const cleanup = runtime.onActivated(listener)
    const bridgeListener = vi.mocked(bridge.onActivated).mock.calls[0]?.[0]
    bridgeListener?.('source-1')
    await Promise.resolve()
    expect(listener).toHaveBeenCalledWith({ sourceRef: 'source-1', sourceKey: 'source-key-1' })
    cleanup()
    expect(stop).toHaveBeenCalledOnce()
  })

  it('uses typed legacy-client activation exclusively when that bridge is available', () => {
    const stopTyped = vi.fn()
    let typedListener: ((activation: { sourceRef: string; sourceKey?: string }) => void) | undefined
    const bridge: ArkmeDesktopNotificationBridge = {
      show: vi.fn(async () => ({ shown: true })),
      onActivated: vi.fn(() => vi.fn()),
      onActivation: vi.fn(listener => { typedListener = listener; return stopTyped }),
    }
    const runtime = new ArkmeDesktopNotificationRuntime(() => bridge)
    const listener = vi.fn()

    const cleanup = runtime.onActivated(listener)
    typedListener?.({ sourceRef: 'old-source-ref', sourceKey: 'stable-source-key' })

    expect(listener).toHaveBeenCalledWith({ sourceRef: 'old-source-ref', sourceKey: 'stable-source-key' })
    expect(listener).toHaveBeenCalledOnce()
    expect(bridge.onActivated).not.toHaveBeenCalled()
    cleanup()
    expect(stopTyped).toHaveBeenCalledOnce()
  })

  it('prefers V2 activation and completes its explicit lifecycle', async () => {
    const stopV2 = vi.fn()
    let v2Listener: ((activation: {
      activationId: string; kind: 'chat-source'; sourceRef: string; sourceKey?: string
    }) => void) | undefined
    const bridge: ArkmeDesktopNotificationBridge = {
      show: vi.fn(async () => ({ shown: true })),
      onActivated: vi.fn(() => vi.fn()),
      onActivation: vi.fn(() => vi.fn()),
      onActivationV2: vi.fn(listener => { v2Listener = listener; return stopV2 }),
      completeActivationV2: vi.fn(),
    }
    const runtime = new ArkmeDesktopNotificationRuntime(() => bridge)
    const listener = vi.fn()

    const cleanup = runtime.onActivated(listener)
    v2Listener?.({
      activationId: 'activation-1', kind: 'chat-source',
      sourceRef: 'old-source-ref', sourceKey: 'stable-source-key',
    })
    v2Listener?.({
      activationId: 'activation-1', kind: 'chat-source',
      sourceRef: 'old-source-ref', sourceKey: 'stable-source-key',
    })
    expect(listener).toHaveBeenCalledWith({
      activationId: 'activation-1', kind: 'chat-source',
      sourceRef: 'old-source-ref', sourceKey: 'stable-source-key',
    })
    expect(bridge.onActivation).not.toHaveBeenCalled()
    expect(bridge.onActivated).not.toHaveBeenCalled()
    expect(listener).toHaveBeenCalledOnce()
    await runtime.completeActivationV2('activation-1', 'resolved')
    expect(bridge.completeActivationV2).toHaveBeenCalledWith('activation-1', 'resolved')
    v2Listener?.({
      activationId: 'activation-1', kind: 'chat-source',
      sourceRef: 'old-source-ref', sourceKey: 'stable-source-key',
    })
    await Promise.resolve()
    expect(listener).toHaveBeenCalledOnce()
    expect(bridge.completeActivationV2).toHaveBeenCalledTimes(2)
    await runtime.completeActivationV2('activation-1', 'failed')
    expect(bridge.completeActivationV2).toHaveBeenLastCalledWith('activation-1', 'resolved')
    cleanup()
    expect(stopV2).toHaveBeenCalledOnce()
  })

  it('bounds active V2 IDs and terminally supersedes the oldest activation', async () => {
    let v2Listener: ((activation: {
      activationId: string; kind: 'chat-source'; sourceRef: string
    }) => void) | undefined
    const bridge: ArkmeDesktopNotificationBridge = {
      show: vi.fn(async () => ({ shown: true })),
      onActivated: vi.fn(() => vi.fn()),
      onActivationV2: vi.fn(listener => { v2Listener = listener; return vi.fn() }),
      completeActivationV2: vi.fn(),
    }
    const runtime = new ArkmeDesktopNotificationRuntime(() => bridge, 1)
    const listener = vi.fn()
    runtime.onActivated(listener)

    v2Listener?.({ activationId: 'activation-old', kind: 'chat-source', sourceRef: 'source-old' })
    v2Listener?.({ activationId: 'activation-new', kind: 'chat-source', sourceRef: 'source-new' })
    await Promise.resolve()

    expect(listener).toHaveBeenCalledTimes(2)
    expect(bridge.completeActivationV2).toHaveBeenCalledWith('activation-old', 'superseded')
    v2Listener?.({ activationId: 'activation-old', kind: 'chat-source', sourceRef: 'source-old' })
    await Promise.resolve()
    expect(listener).toHaveBeenCalledTimes(2)
    expect(bridge.completeActivationV2).toHaveBeenLastCalledWith('activation-old', 'superseded')
  })

  it('recovers Browser fallback sourceKey when typed activation comes from the legacy request shape', async () => {
    let typedListener: ((activation: { sourceRef: string; sourceKey?: string }) => void) | undefined
    const bridge: ArkmeDesktopNotificationBridge = {
      show: vi.fn(async () => ({ shown: true })),
      onActivated: vi.fn(() => vi.fn()),
      onActivation: vi.fn(listener => { typedListener = listener; return vi.fn() }),
    }
    const runtime = new ArkmeDesktopNotificationRuntime(() => bridge)
    await runtime.show({
      eventUid: 'fallback-event', sourceRef: 'old-source-ref', sourceKey: 'stable-source-key',
      sourceKind: 'group_chat', title: '旧群名', body: '新消息', eventAtMillis: 1,
    })
    const listener = vi.fn()
    runtime.onActivated(listener)
    typedListener?.({ sourceRef: 'old-source-ref' })
    await Promise.resolve()
    expect(listener).toHaveBeenCalledWith({ sourceRef: 'old-source-ref', sourceKey: 'stable-source-key' })
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
      expect(runtime.permission()).toBe('granted')

      await expect(runtime.show({
        eventUid: 'event-browser', sourceRef: 'source-browser', sourceKey: 'source-key-browser', sourceKind: 'private_chat',
        title: '林溪', body: '你好', eventAtMillis: 1,
      })).resolves.toBe(true)
      expect(created).toMatchObject({ title: '林溪', options: { body: '你好', tag: 'arkme-message-event-browser' } })
      created?.onclick?.(new Event('click'))
      await Promise.resolve()
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

  it('shares permission state, refreshes after focus, and opens system settings', async () => {
    let permissionChanged: ((permission: ArkmeDesktopNotificationPermission) => void) | undefined
    const bridge: ArkmeDesktopNotificationBridge = {
      show: vi.fn(async () => ({ shown: true })),
      onActivated: vi.fn(() => vi.fn()),
      permission: vi.fn(() => 'default'),
      refreshPermission: vi.fn(() => 'denied'),
      requestPermission: vi.fn(async () => 'granted'),
      openSettings: vi.fn(async () => true),
      onPermissionChanged: vi.fn(listener => { permissionChanged = listener; return vi.fn() }),
    }
    const runtime = new ArkmeDesktopNotificationRuntime(() => bridge)
    const listener = vi.fn()
    const unsubscribe = runtime.subscribePermission(listener)

    expect(runtime.getPermissionSnapshot()).toEqual({ revision: 1, permission: 'default' })
    await expect(runtime.refreshPermission()).resolves.toBe('denied')
    expect(runtime.getPermissionSnapshot()).toEqual({ revision: 2, permission: 'denied' })
    await expect(runtime.openPermissionSettings()).resolves.toBe(true)
    await expect(runtime.requestPermission()).resolves.toBe('granted')
    expect(runtime.getPermissionSnapshot()).toEqual({ revision: 3, permission: 'granted' })
    permissionChanged?.('denied')
    expect(runtime.getPermissionSnapshot()).toEqual({ revision: 4, permission: 'denied' })
    expect(listener).toHaveBeenCalledTimes(3)
    expect(bridge.openSettings).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it('coalesces simultaneous focus permission refreshes', async () => {
    let resolveRefresh!: (permission: ArkmeDesktopNotificationPermission) => void
    const refreshPermission = vi.fn(() => new Promise<ArkmeDesktopNotificationPermission>(resolve => {
      resolveRefresh = resolve
    }))
    const bridge: ArkmeDesktopNotificationBridge = {
      show: vi.fn(async () => ({ shown: true })),
      onActivated: vi.fn(() => vi.fn()),
      permission: vi.fn(() => 'default'),
      refreshPermission,
    }
    const runtime = new ArkmeDesktopNotificationRuntime(() => bridge)

    const first = runtime.refreshPermission()
    const second = runtime.refreshPermission()
    expect(refreshPermission).toHaveBeenCalledOnce()
    resolveRefresh('granted')
    await expect(Promise.all([first, second])).resolves.toEqual(['granted', 'granted'])
  })

  it('reports unavailable when the Electron capability says native notifications are unsupported', async () => {
    const bridge: ArkmeDesktopNotificationBridge = {
      show: vi.fn(async () => ({ shown: false })),
      onActivated: vi.fn(() => vi.fn()),
    }
    vi.stubGlobal('window', {
      arkmeDesktopNotifications: bridge,
      arkmeDesktop: { attention: { notificationShow: false } },
    })
    try {
      const runtime = new ArkmeDesktopNotificationRuntime()
      expect(runtime.permission()).toBe('unavailable')
      await expect(runtime.requestPermission()).resolves.toBe('unavailable')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('notification activation store', () => {
  it('retains one resolved source until explicit lifecycle cleanup', () => {
    const store = new ArkmeNotificationActivationStore()
    const source: ArkmeSourceItem = {
      sourceRef: 'source-1', kind: 'private_chat', displayName: '林溪',
      activeAtMillis: 1, unreadCount: 1, latestSequence: 3,
    }

    store.publish('activation-1', source)
    const pending = store.getSnapshot()
    expect(pending.activationId).toBe('activation-1')
    expect(pending.source).toEqual(source)
    expect(store.consume(pending.revision)).toBe(true)
    expect(store.getSnapshot()).toEqual({
      revision: pending.revision + 1,
      navigationApplied: false,
      surfaceCommitted: false,
    })
  })

  it('returns the displaced activation so its V2 lifecycle can be superseded', () => {
    const store = new ArkmeNotificationActivationStore()
    const first: ArkmeSourceItem = {
      sourceRef: 'source-1', kind: 'private_chat', displayName: '林溪', activeAtMillis: 1, unreadCount: 1,
    }
    const second: ArkmeSourceItem = {
      sourceRef: 'source-2', kind: 'group_chat', displayName: '项目群', activeAtMillis: 2, unreadCount: 1,
    }

    store.publish('activation-1', first)
    expect(store.publish('activation-2', second)).toMatchObject({ activationId: 'activation-1', source: first })
    expect(store.getSnapshot()).toMatchObject({ activationId: 'activation-2', source: second })
  })
})
