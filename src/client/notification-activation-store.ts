import type { ArkmeSourceItem } from '../types.js'

export interface ArkmeNotificationActivationSnapshot {
  revision: number
  source?: ArkmeSourceItem
}

export class ArkmeNotificationActivationStore {
  private snapshot: ArkmeNotificationActivationSnapshot = { revision: 0 }
  private readonly listeners = new Set<() => void>()

  readonly getSnapshot = (): ArkmeNotificationActivationSnapshot => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  publish(source: ArkmeSourceItem): void {
    this.snapshot = { revision: this.snapshot.revision + 1, source }
    this.emit()
  }

  consume(revision: number): void {
    if (this.snapshot.revision !== revision || this.snapshot.source === undefined) return
    this.snapshot = { revision: this.snapshot.revision + 1 }
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

export const arkmeNotificationActivation = new ArkmeNotificationActivationStore()
