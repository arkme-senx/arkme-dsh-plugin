import type { ArkmeChatClientEvent } from '../types.js'

export type ArkmeDesktopNotificationRequest = Extract<
  ArkmeChatClientEvent,
  { type: 'message-notification' }
>['notification']

export interface ArkmeDesktopNotificationActivation {
  activationId?: string
  kind?: 'chat-source'
  sourceRef: string
  sourceKey?: string
}

export interface ArkmeDesktopNotificationActivationV2 {
  activationId: string
  kind: 'chat-source'
  sourceRef: string
  sourceKey?: string
}

export type ArkmeDesktopNotificationActivationOutcome = 'resolved' | 'not-found' | 'failed' | 'superseded'

export interface ArkmeDesktopNotificationBridge {
  show(request: ArkmeDesktopNotificationRequest): Promise<{ shown: boolean }>
  onActivated(listener: (sourceRef: string) => void): () => void
  onActivation?(listener: (activation: ArkmeDesktopNotificationActivation) => void): () => void
  onActivationV2?(listener: (activation: ArkmeDesktopNotificationActivationV2) => void): () => void
  completeActivationV2?(
    activationId: string,
    outcome: ArkmeDesktopNotificationActivationOutcome,
  ): boolean | void | Promise<boolean | void>
  permission?(): ArkmeDesktopNotificationPermission
  requestPermission?(): Promise<ArkmeDesktopNotificationPermission>
  refreshPermission?(): ArkmeDesktopNotificationPermission | Promise<ArkmeDesktopNotificationPermission>
  openSettings?(): Promise<boolean>
  onPermissionChanged?(listener: (permission: ArkmeDesktopNotificationPermission) => void): () => void
}

export type ArkmeDesktopNotificationPermission = NotificationPermission | 'system-managed' | 'unavailable'

export interface ArkmeDesktopNotificationPermissionSnapshot {
  revision: number
  permission: ArkmeDesktopNotificationPermission
}

declare global {
  interface Window {
    arkmeDesktopNotifications?: ArkmeDesktopNotificationBridge
  }
}

export class ArkmeDesktopNotificationRuntime {
  private readonly rememberedEventUids = new Set<string>()
  private readonly rememberedActivations = new Map<string, ArkmeDesktopNotificationActivation>()
  private readonly activeActivationIds = new Set<string>()
  private readonly completedActivationOutcomes = new Map<string, ArkmeDesktopNotificationActivationOutcome>()
  private readonly permissionListeners = new Set<() => void>()
  private permissionSnapshot: ArkmeDesktopNotificationPermissionSnapshot = { revision: 0, permission: 'unavailable' }
  private permissionRefreshInFlight: Promise<ArkmeDesktopNotificationPermission> | undefined

  constructor(
    private readonly getBridge: () => ArkmeDesktopNotificationBridge | undefined = browserBridge,
    private readonly maxRememberedEventUids = 2_048,
  ) {
    this.updatePermission(this.readPermission())
    this.getBridge()?.onPermissionChanged?.(permission => { this.updatePermission(permission) })
  }

  readonly getPermissionSnapshot = (): ArkmeDesktopNotificationPermissionSnapshot => this.permissionSnapshot

  readonly subscribePermission = (listener: () => void): (() => void) => {
    this.permissionListeners.add(listener)
    return () => { this.permissionListeners.delete(listener) }
  }

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
    return this.updatePermission(this.readPermission())
  }

  async refreshPermission(): Promise<ArkmeDesktopNotificationPermission> {
    if (this.permissionRefreshInFlight !== undefined) return await this.permissionRefreshInFlight
    const pending = this.refreshPermissionOnce()
    this.permissionRefreshInFlight = pending
    try { return await pending }
    finally {
      if (this.permissionRefreshInFlight === pending) this.permissionRefreshInFlight = undefined
    }
  }

  private async refreshPermissionOnce(): Promise<ArkmeDesktopNotificationPermission> {
    const bridge = this.getBridge()
    if (bridge === undefined) return this.updatePermission('unavailable')
    try {
      const permission = await bridge.refreshPermission?.() ?? bridge.permission?.()
        ?? (desktopNotificationCapability() === false ? 'unavailable' : 'system-managed')
      return this.updatePermission(permission)
    }
    catch { return this.updatePermission('unavailable') }
  }

  async requestPermission(): Promise<ArkmeDesktopNotificationPermission> {
    const bridge = this.getBridge()
    if (bridge === undefined) return this.updatePermission('unavailable')
    try {
      const permission = await bridge.requestPermission?.() ?? bridge.permission?.()
        ?? (desktopNotificationCapability() === false ? 'unavailable' : 'system-managed')
      return this.updatePermission(permission)
    }
    catch { return this.updatePermission('unavailable') }
  }

  async openPermissionSettings(): Promise<boolean> {
    const bridge = this.getBridge()
    if (bridge?.openSettings === undefined) return false
    try { return await bridge.openSettings() }
    catch { return false }
  }

  onActivated(listener: (activation: ArkmeDesktopNotificationActivation) => void): () => void {
    const bridge = this.getBridge()
    if (bridge === undefined) return () => undefined
    if (typeof bridge.onActivationV2 === 'function') {
      try {
        return bridge.onActivationV2(activation => {
          const completedOutcome = this.completedActivationOutcomes.get(activation.activationId)
          if (completedOutcome !== undefined) {
            void this.sendActivationV2Outcome(activation.activationId, completedOutcome)
            return
          }
          if (this.activeActivationIds.has(activation.activationId)) return
          this.activeActivationIds.add(activation.activationId)
          while (this.activeActivationIds.size > this.maxRememberedEventUids) {
            const oldest = this.activeActivationIds.values().next().value
            if (oldest === undefined) break
            void this.completeActivationV2(oldest, 'superseded')
          }
          if (!this.activeActivationIds.has(activation.activationId)) return
          try {
            listener({
              activationId: activation.activationId,
              kind: activation.kind,
              sourceRef: activation.sourceRef,
              ...(activation.sourceKey === undefined ? {} : { sourceKey: activation.sourceKey }),
            })
          }
          catch { void this.completeActivationV2(activation.activationId, 'failed') }
        })
      }
      catch { return () => undefined }
    }

    const forward = (activation: ArkmeDesktopNotificationActivation): void => {
      const remembered = this.rememberedActivations.get(activation.sourceRef)
      const sourceKey = activation.sourceKey ?? remembered?.sourceKey
      listener({
        sourceRef: activation.sourceRef,
        ...(sourceKey === undefined ? {} : { sourceKey }),
      })
    }
    try {
      if (typeof bridge.onActivation === 'function') {
        return bridge.onActivation(forward)
      }
      return bridge.onActivated(sourceRef => { forward({ sourceRef }) })
    }
    catch { return () => undefined }
  }

  async completeActivationV2(
    activationId: string,
    outcome: ArkmeDesktopNotificationActivationOutcome,
  ): Promise<void> {
    const completedOutcome = this.completedActivationOutcomes.get(activationId) ?? outcome
    this.activeActivationIds.delete(activationId)
    if (!this.completedActivationOutcomes.has(activationId)) {
      this.completedActivationOutcomes.set(activationId, completedOutcome)
      while (this.completedActivationOutcomes.size > this.maxRememberedEventUids) {
        const oldest = this.completedActivationOutcomes.keys().next().value
        if (oldest === undefined) break
        this.completedActivationOutcomes.delete(oldest)
      }
    }
    await this.sendActivationV2Outcome(activationId, completedOutcome)
  }

  private async sendActivationV2Outcome(
    activationId: string,
    outcome: ArkmeDesktopNotificationActivationOutcome,
  ): Promise<void> {
    const bridge = this.getBridge()
    if (bridge?.completeActivationV2 === undefined) return
    try { await bridge.completeActivationV2(activationId, outcome) }
    catch { /* Activation completion is best effort during old-client compatibility. */ }
  }

  private readPermission(): ArkmeDesktopNotificationPermission {
    const bridge = this.getBridge()
    if (bridge === undefined) return 'unavailable'
    try {
      return bridge.permission?.() ?? (desktopNotificationCapability() === false ? 'unavailable' : 'system-managed')
    } catch {
      return 'unavailable'
    }
  }

  private updatePermission(permission: ArkmeDesktopNotificationPermission): ArkmeDesktopNotificationPermission {
    if (permission === this.permissionSnapshot.permission) return permission
    this.permissionSnapshot = { revision: this.permissionSnapshot.revision + 1, permission }
    for (const listener of [...this.permissionListeners]) listener()
    return permission
  }
}

function browserBridge(): ArkmeDesktopNotificationBridge | undefined {
  if (typeof window === 'undefined') return undefined
  const bridge = window.arkmeDesktopNotifications
  if (typeof bridge?.show === 'function' && typeof bridge.onActivated === 'function') return bridge
  if (typeof Notification === 'undefined') return undefined
  return nativeBrowserNotificationBridge
}

function desktopNotificationCapability(): boolean | undefined {
  if (typeof window === 'undefined') return undefined
  const scope = window as unknown as {
    arkmeDesktop?: { attention?: { notificationShow?: boolean } }
  }
  const supported = scope.arkmeDesktop?.attention?.notificationShow
  return typeof supported === 'boolean' ? supported : undefined
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

  refreshPermission(): NotificationPermission {
    return Notification.permission
  }
}

const nativeBrowserNotificationBridge = new ArkmeNativeBrowserNotificationBridge()

export const arkmeDesktopNotifications = new ArkmeDesktopNotificationRuntime()
