import type { ArkmeChatClientEvent } from '../types.js'

export type ArkmeDesktopNotificationRequest = Extract<
  ArkmeChatClientEvent,
  { type: 'message-notification' }
>['notification']

export interface ArkmeDesktopNotificationActivation {
  sourceRef: string
  sourceKey?: string
}

export interface ArkmeDesktopNotificationBridge {
  show(request: ArkmeDesktopNotificationRequest): Promise<{ shown: boolean }>
  onActivated(listener: (sourceRef: string) => void): () => void
  permission?(): ArkmeDesktopNotificationPermission
  requestPermission?(): Promise<ArkmeDesktopNotificationPermission>
}

export type ArkmeDesktopNotificationPermission = NotificationPermission | 'unavailable'

declare global {
  interface Window {
    arkmeDesktopNotifications?: ArkmeDesktopNotificationBridge
  }
}

export class ArkmeDesktopNotificationRuntime {
  private readonly rememberedEventUids = new Set<string>()
  private readonly rememberedActivations = new Map<string, ArkmeDesktopNotificationActivation>()

  constructor(
    private readonly getBridge: () => ArkmeDesktopNotificationBridge | undefined = browserBridge,
    private readonly maxRememberedEventUids = 2_048,
  ) {}

  async show(request: ArkmeDesktopNotificationRequest): Promise<boolean> {
    const bridge = this.getBridge()
    if (bridge === undefined || this.rememberedEventUids.has(request.eventUid)) return false
    this.rememberedEventUids.add(request.eventUid)
    this.rememberedActivations.set(request.sourceRef, {
      sourceRef: request.sourceRef,
      sourceKey: request.sourceKey,
    })
    while (this.rememberedActivations.size > this.maxRememberedEventUids) {
      const oldest = this.rememberedActivations.keys().next().value
      if (oldest === undefined) break
      this.rememberedActivations.delete(oldest)
    }
    while (this.rememberedEventUids.size > this.maxRememberedEventUids) {
      const oldest = this.rememberedEventUids.values().next().value
      if (oldest === undefined) break
      this.rememberedEventUids.delete(oldest)
    }
    try { return (await bridge.show(request)).shown === true }
    catch { return false }
  }

  permission(): ArkmeDesktopNotificationPermission {
    const bridge = this.getBridge()
    if (bridge === undefined) return 'unavailable'
    try { return bridge.permission?.() ?? 'granted' }
    catch { return 'unavailable' }
  }

  async requestPermission(): Promise<ArkmeDesktopNotificationPermission> {
    const bridge = this.getBridge()
    if (bridge === undefined) return 'unavailable'
    try { return await bridge.requestPermission?.() ?? bridge.permission?.() ?? 'granted' }
    catch { return 'unavailable' }
  }

  onActivated(listener: (activation: ArkmeDesktopNotificationActivation) => void): () => void {
    const bridge = this.getBridge()
    if (bridge === undefined) return () => undefined
    try {
      return bridge.onActivated(sourceRef => {
        const remembered = this.rememberedActivations.get(sourceRef)
        listener({
          sourceRef,
          ...(remembered?.sourceKey === undefined ? {} : { sourceKey: remembered.sourceKey }),
        })
      })
    }
    catch { return () => undefined }
  }
}

function browserBridge(): ArkmeDesktopNotificationBridge | undefined {
  if (typeof window === 'undefined') return undefined
  const bridge = window.arkmeDesktopNotifications
  if (typeof bridge?.show === 'function' && typeof bridge.onActivated === 'function') return bridge
  if (typeof Notification === 'undefined') return undefined
  return nativeBrowserNotificationBridge
}

class ArkmeNativeBrowserNotificationBridge implements ArkmeDesktopNotificationBridge {
  private readonly listeners = new Set<(sourceRef: string) => void>()

  async show(request: ArkmeDesktopNotificationRequest): Promise<{ shown: boolean }> {
    if (Notification.permission !== 'granted') return { shown: false }
    const notification = new Notification(request.title, {
      body: request.body,
      tag: `arkme-message-${request.eventUid}`,
    })
    notification.onclick = () => {
      window.focus()
      for (const listener of [...this.listeners]) listener(request.sourceRef)
      notification.close()
    }
    return { shown: true }
  }

  onActivated(listener: (sourceRef: string) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  permission(): NotificationPermission {
    return Notification.permission
  }

  async requestPermission(): Promise<NotificationPermission> {
    return await Notification.requestPermission()
  }
}

const nativeBrowserNotificationBridge = new ArkmeNativeBrowserNotificationBridge()

export const arkmeDesktopNotifications = new ArkmeDesktopNotificationRuntime()
