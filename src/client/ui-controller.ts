export interface JotmoUiState {
  open: boolean
  authRevision: number
}

export class JotmoUiController {
  private state: JotmoUiState = { open: false, authRevision: 0 }
  private readonly listeners = new Set<() => void>()

  readonly getSnapshot = (): JotmoUiState => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  open(): void {
    this.publish({ ...this.state, open: true })
  }

  close(): void {
    this.publish({ ...this.state, open: false })
  }

  authChanged(): void {
    this.publish({ ...this.state, authRevision: this.state.authRevision + 1 })
  }

  private publish(next: JotmoUiState): void {
    if (next.open === this.state.open && next.authRevision === this.state.authRevision) return
    this.state = next
    for (const listener of this.listeners) listener()
  }
}

export const jotmoUi = new JotmoUiController()
