import { useSyncExternalStore } from 'react'

export type ArkmeUpdateTarget = 'app'

export interface ArkmeUpdateUiSnapshot {
  revision: number
  target?: ArkmeUpdateTarget
}

class ArkmeUpdateUiController {
  private readonly listeners = new Set<() => void>()
  private snapshot: ArkmeUpdateUiSnapshot = { revision: 0 }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): ArkmeUpdateUiSnapshot => this.snapshot

  open(target?: ArkmeUpdateTarget): void {
    this.snapshot = {
      revision: this.snapshot.revision + 1,
      ...(target === undefined ? {} : { target }),
    }
    for (const listener of [...this.listeners]) listener()
  }
}

export const arkmeUpdateUi = new ArkmeUpdateUiController()

export function useArkmeUpdateUiSnapshot(): ArkmeUpdateUiSnapshot {
  return useSyncExternalStore(arkmeUpdateUi.subscribe, arkmeUpdateUi.getSnapshot, arkmeUpdateUi.getSnapshot)
}
