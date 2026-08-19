import type { ArkmeSourceItem } from '../types.js'

function sameSource(left: ArkmeSourceItem | undefined, right: ArkmeSourceItem | undefined): boolean {
  if (left === undefined || right === undefined) return left === right
  return left.sourceRef === right.sourceRef && left.kind === right.kind && left.displayName === right.displayName
    && left.latestPreview === right.latestPreview && left.activeAtMillis === right.activeAtMillis
    && left.unreadCount === right.unreadCount && left.isMuted === right.isMuted
    && left.latestSequence === right.latestSequence
    && left.avatarRef === right.avatarRef && (left.avatarRefs ?? []).join('|') === (right.avatarRefs ?? []).join('|')
    && JSON.stringify(left.groupAvatar) === JSON.stringify(right.groupAvatar)
}

export interface ArkmeUiState {
  open: boolean
  surfaceOpen: boolean
  authRevision: number
  chatRevision: number
  mode: 'login' | 'source' | 'recordings' | 'search' | 'arko'
  selectedSource?: ArkmeSourceItem
  recordingTarget?: { dateStamp: number; startAtMillis: number }
}

export class ArkmeUiController {
  private state: ArkmeUiState = { open: false, surfaceOpen: false, authRevision: 0, chatRevision: 0, mode: 'login' }
  private readonly listeners = new Set<() => void>()

  readonly getSnapshot = (): ArkmeUiState => this.state

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
    if (authenticated) {
      this.publish({
        ...this.state,
        open: true,
        surfaceOpen: true,
        authRevision: this.state.authRevision + 1,
      })
      return
    }
    const { selectedSource: _selectedSource, ...rest } = this.state
    this.publish({
      ...rest,
      open: false,
      surfaceOpen: this.state.surfaceOpen,
      mode: 'login',
      authRevision: this.state.authRevision + 1,
    })
  }

  chatChanged(): void {
    this.publish({ ...this.state, chatRevision: this.state.chatRevision + 1 })
  }

  showLogin(): void {
    const { selectedSource: _selectedSource, ...rest } = this.state
    this.publish({ ...rest, open: true, surfaceOpen: true, mode: 'login' })
  }

  showLoginSurface(): void {
    const { selectedSource: _selectedSource, ...rest } = this.state
    this.publish({ ...rest, open: false, surfaceOpen: true, mode: 'login' })
  }

  showRecordings(): void {
    const { selectedSource: _selectedSource, recordingTarget: _recordingTarget, ...rest } = this.state
    this.publish({ ...rest, open: true, surfaceOpen: true, mode: 'recordings' })
  }

  showRecordingTarget(dateStamp: number, startAtMillis: number): void {
    const { selectedSource: _selectedSource, ...rest } = this.state
    this.publish({ ...rest, open: true, surfaceOpen: true, mode: 'recordings', recordingTarget: { dateStamp, startAtMillis } })
  }

  showSearch(): void {
    const { selectedSource: _selectedSource, ...rest } = this.state
    this.publish({ ...rest, open: true, surfaceOpen: true, mode: 'search' })
  }

  showArko(): void {
    const { selectedSource: _selectedSource, ...rest } = this.state
    this.publish({ ...rest, open: true, surfaceOpen: true, mode: 'arko' })
  }

  selectSource(source: ArkmeSourceItem): void {
    this.publish({ ...this.state, open: true, mode: 'source', selectedSource: source })
  }

  private publish(next: ArkmeUiState): void {
    if (next.open === this.state.open && next.surfaceOpen === this.state.surfaceOpen
      && next.authRevision === this.state.authRevision
      && next.chatRevision === this.state.chatRevision
      && next.mode === this.state.mode
      && next.recordingTarget?.dateStamp === this.state.recordingTarget?.dateStamp
      && next.recordingTarget?.startAtMillis === this.state.recordingTarget?.startAtMillis
      && sameSource(next.selectedSource, this.state.selectedSource)) return
    this.state = next
    for (const listener of this.listeners) listener()
  }
}

export const arkmeUi = new ArkmeUiController()
