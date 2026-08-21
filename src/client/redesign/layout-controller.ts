import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'

export interface ArkmeLayoutSnapshot {
  sidebarOpen: boolean
  detailsOpen: boolean
}

/** Arkme-owned implementation of DSH's public layout action contract. */
export class ArkmeLayoutController implements ILayout {
  private snapshot: ArkmeLayoutSnapshot = { sidebarOpen: true, detailsOpen: false }
  private readonly listeners = new Set<() => void>()

  readonly getSnapshot = (): ArkmeLayoutSnapshot => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  toggleSidebar(): void {
    this.publish({ ...this.snapshot, sidebarOpen: !this.snapshot.sidebarOpen })
  }

  openDetails(): void {
    this.publish({ ...this.snapshot, detailsOpen: true })
  }

  closeDetails(): void {
    this.publish({ ...this.snapshot, detailsOpen: false })
  }

  private publish(next: ArkmeLayoutSnapshot): void {
    if (next.sidebarOpen === this.snapshot.sidebarOpen && next.detailsOpen === this.snapshot.detailsOpen) return
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}
