import type { ArkmeChatClientEvent } from '../types.js'

export type ArkmeDesktopNotificationRequest = Extract<
  ArkmeChatClientEvent,
  { type: 'message-notification' }
>['notification']

export interface ArkmeDesktopNotificationBridge {
  show(request: ArkmeDesktopNotificationRequest): Promise<{ shown: boolean }>
  onActivated(listener: (sourceRef: string) => void): () => void
}

declare global {
  interface Window {
    arkmeDesktopNotifications?: ArkmeDesktopNotificationBridge
  }
}

export class ArkmeDesktopNotificationRuntime {
  private readonly rememberedEventUids = new Set<string>()

  constructor(
    private readonly getBridge: () => ArkmeDesktopNotificationBridge | undefined = browserBridge,
    private readonly maxRememberedEventUids = 2_048,
  ) {}

  async show(request: ArkmeDesktopNotificationRequest): Promise<boolean> {
    const bridge = this.getBridge()
    if (bridge === undefined || this.rememberedEventUids.has(request.eventUid)) return false
    this.rememberedEventUids.add(request.eventUid)
    while (this.rememberedEventUids.size > this.maxRememberedEventUids) {
      const oldest = this.rememberedEventUids.values().next().value
      if (oldest === undefined) break
      this.rememberedEventUids.delete(oldest)
    }
    try { return (await bridge.show(request)).shown === true }
    catch { return false }
  }

  onActivated(listener: (sourceRef: string) => void): () => void {
    const bridge = this.getBridge()
    if (bridge === undefined) return () => undefined
    try { return bridge.onActivated(listener) }
    catch { return () => undefined }
  }
}

function browserBridge(): ArkmeDesktopNotificationBridge | undefined {
  if (typeof window === 'undefined') return undefined
  const bridge = window.arkmeDesktopNotifications
  return typeof bridge?.show === 'function' && typeof bridge.onActivated === 'function' ? bridge : undefined
}

export const arkmeDesktopNotifications = new ArkmeDesktopNotificationRuntime()
