import type { ILayout, MainPanelId, PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'

export interface ArkmeLayoutSnapshot {
  sidebarOpen: boolean
  detailsOpen: boolean
}

/** Arkme-owned implementation of DSH's public layout action contract. */
export class ArkmeLayoutController implements ILayout {
  private snapshot: ArkmeLayoutSnapshot = { sidebarOpen: true, detailsOpen: false }
  private panel: PanelInfo = { activePanelId: null }
  private navigation = new AbortController()
  readonly panelInfo = {
    getSnapshot: (): PanelInfo => this.panel,
    subscribe: (listener: () => void): (() => void) => this.subscribe(listener),
  }
  selectPanel(activePanelId: MainPanelId | null): void {
    if (this.panel.activePanelId === activePanelId) return
    this.panel = { activePanelId }
    for (const listener of this.listeners) listener()
  }
  beginNavigation(): AbortSignal {
    this.navigation.abort()
    this.navigation = new AbortController()
    return this.navigation.signal
  }
  openRightbar(_track: boolean, _fullscreen: boolean): void { this.openDetails() }
  closeRightbar(): void { this.closeDetails() }

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
