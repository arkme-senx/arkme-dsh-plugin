import type { ArkmeSourceItem } from '../types.js'

export interface ArkmeNotificationActivationSnapshot {
  revision: number
  activationId?: string
  source?: ArkmeSourceItem
  navigationApplied: boolean
  surfaceCommitted: boolean
}

export class ArkmeNotificationActivationStore {
  private snapshot: ArkmeNotificationActivationSnapshot = {
    revision: 0,
    navigationApplied: false,
    surfaceCommitted: false,
  }
  private readonly listeners = new Set<() => void>()

  readonly getSnapshot = (): ArkmeNotificationActivationSnapshot => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  publish(source: ArkmeSourceItem): ArkmeNotificationActivationSnapshot | undefined
  publish(activationId: string | undefined, source: ArkmeSourceItem): ArkmeNotificationActivationSnapshot | undefined
  publish(
    activationIdOrSource: string | ArkmeSourceItem | undefined,
    resolvedSource?: ArkmeSourceItem,
  ): ArkmeNotificationActivationSnapshot | undefined {
    const source = typeof activationIdOrSource === 'string' || activationIdOrSource === undefined
      ? resolvedSource
      : activationIdOrSource
    if (source === undefined) throw new TypeError('通知激活必须包含已解析的会话来源')
    const activationId = typeof activationIdOrSource === 'string' ? activationIdOrSource : undefined
    const displaced = this.snapshot.source === undefined ? undefined : this.snapshot
    this.snapshot = {
      revision: this.snapshot.revision + 1,
      ...(activationId === undefined ? {} : { activationId }),
      source,
      navigationApplied: false,
      surfaceCommitted: false,
    }
    this.emit()
    return displaced
  }

  markNavigationApplied(revision: number): boolean {
    return this.mark(revision, 'navigationApplied')
  }

  markSurfaceCommitted(revision: number): boolean {
    return this.mark(revision, 'surfaceCommitted')
  }

  /** Atomically take an activation only after both independent UI owners commit it. */
  takeReady(revision: number): ArkmeNotificationActivationSnapshot | undefined {
    const current = this.snapshot
    if (current.revision !== revision || current.source === undefined
      || !current.navigationApplied || !current.surfaceCommitted) return undefined
    this.snapshot = {
      revision: current.revision + 1,
      navigationApplied: false,
      surfaceCommitted: false,
    }
    this.emit()
    return current
  }

  /** Explicit lifecycle cleanup compatibility; presentation owners must use the commit barrier. */
  consume(revision: number): boolean {
    if (this.snapshot.revision !== revision || this.snapshot.source === undefined) return false
    this.snapshot = {
      revision: this.snapshot.revision + 1,
      navigationApplied: false,
      surfaceCommitted: false,
    }
    this.emit()
    return true
  }

  private mark(
    revision: number,
    field: 'navigationApplied' | 'surfaceCommitted',
  ): boolean {
    const current = this.snapshot
    if (current.revision !== revision || current.source === undefined) return false
    if (current[field]) return true
    this.snapshot = { ...current, [field]: true }
    this.emit()
    return true
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

export const arkmeNotificationActivation = new ArkmeNotificationActivationStore()
