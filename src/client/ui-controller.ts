import type { JotmoSourceItem } from '../types.js'

export interface JotmoUiState {
  open: boolean
  surfaceOpen: boolean
  authRevision: number
  mode: 'login' | 'source' | 'calls' | 'recordings'
  selectedSource?: JotmoSourceItem
}

export class JotmoUiController {
  private state: JotmoUiState = { open: false, surfaceOpen: false, authRevision: 0, mode: 'login' }
  private readonly listeners = new Set<() => void>()

  readonly getSnapshot = (): JotmoUiState => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  open(): void {
    this.publish({ ...this.state, open: true })
  }

  activateSurface(): void {
    this.publish({ ...this.state, open: true, surfaceOpen: true })
  }

  deactivateSurface(): void {
    this.publish({ ...this.state, surfaceOpen: false })
  }

  focusSendToSelf(): void {
    const { selectedSource: _selectedSource, ...rest } = this.state
    this.publish({ ...rest, open: true, surfaceOpen: true, mode: 'source' })
  }

  close(): void {
    this.publish({ ...this.state, open: false, surfaceOpen: false })
  }

  authChanged(authenticated = false): void {
    const { selectedSource: _selectedSource, ...rest } = this.state
    this.publish({
      ...rest,
      open: authenticated,
      surfaceOpen: authenticated ? true : this.state.surfaceOpen,
      mode: 'login',
      authRevision: this.state.authRevision + 1,
    })
  }

  showLogin(): void {
    const { selectedSource: _selectedSource, ...rest } = this.state
    this.publish({ ...rest, open: true, surfaceOpen: true, mode: 'login' })
  }

  showLoginSurface(): void {
    const { selectedSource: _selectedSource, ...rest } = this.state
    this.publish({ ...rest, open: false, surfaceOpen: true, mode: 'login' })
  }

  showCalls(): void {
    this.publish({ ...this.state, open: true, surfaceOpen: true, mode: 'calls' })
  }

  selectSource(source: JotmoSourceItem): void {
    this.publish({ ...this.state, open: true, mode: 'source', selectedSource: source })
  }

  showRecordings(): void {
    const { selectedSource: _selectedSource, ...rest } = this.state
    this.publish({ ...rest, open: true, mode: 'recordings' })
  }

  private publish(next: JotmoUiState): void {
    if (next.open === this.state.open && next.surfaceOpen === this.state.surfaceOpen
      && next.authRevision === this.state.authRevision
      && next.mode === this.state.mode && next.selectedSource?.sourceRef === this.state.selectedSource?.sourceRef) return
    this.state = next
    for (const listener of this.listeners) listener()
  }
}

export const jotmoUi = new JotmoUiController()
