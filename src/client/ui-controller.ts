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
  mode: 'login' | 'source' | 'calls' | 'recordings' | 'calendar' | 'world' | 'search' | 'extensions' | 'contact-add' | 'arko' | 'settings'
  settingsSection?: 'account' | 'general' | 'about'
  selectedSource?: ArkmeSourceItem
  recordingTarget?: { dateStamp: number; startAtMillis: number }
  extensionShareRef?: string
}

export class ArkmeUiController {
  private state: ArkmeUiState = { open: false, surfaceOpen: false, authRevision: 0, chatRevision: 0, mode: 'login' }
  private lastConversationSource: ArkmeSourceItem | undefined
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
    this.lastConversationSource = undefined
    const { selectedSource: _selectedSource, ...rest } = this.state
    this.publish({ ...rest, open: true, surfaceOpen: true, mode: 'source' })
  }

  close(): void {
    const { extensionShareRef: _extensionShareRef, ...rest } = this.state
    this.publish({ ...rest, open: false, surfaceOpen: false })
  }

  authChanged(authenticated = false, resetSelection = false): void {
    if (authenticated) {
      const { selectedSource: _selectedSource, ...stateWithoutSelection } = this.state
      const state = resetSelection ? stateWithoutSelection : this.state
      this.publish({
        ...state,
        open: true,
        surfaceOpen: true,
        mode: state.mode === 'login' ? 'source' : state.mode,
        authRevision: this.state.authRevision + 1,
      })
      return
    }
    this.lastConversationSource = undefined
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

  showCalls(): void {
    const { selectedSource: _selectedSource, recordingTarget: _recordingTarget, ...rest } = this.state
    this.publish({ ...rest, open: true, surfaceOpen: true, mode: 'calls' })
  }

  showCalendar(): void {
    const { recordingTarget: _recordingTarget, ...rest } = this.state
    this.publish({ ...rest, open: true, surfaceOpen: true, mode: 'calendar' })
  }

  showWorld(): void {
    const { selectedSource: _selectedSource, recordingTarget: _recordingTarget, ...rest } = this.state
    this.publish({ ...rest, open: true, surfaceOpen: true, mode: 'world' })
  }

  showRecordingTarget(dateStamp: number, startAtMillis: number): void {
    const { selectedSource: _selectedSource, ...rest } = this.state
    this.publish({ ...rest, open: true, surfaceOpen: true, mode: 'recordings', recordingTarget: { dateStamp, startAtMillis } })
  }

  showSearch(): void {
    const { selectedSource: _selectedSource, ...rest } = this.state
    this.publish({ ...rest, open: true, surfaceOpen: true, mode: 'search' })
  }

  showExtensions(): void {
    const { selectedSource: _selectedSource, recordingTarget: _recordingTarget, ...rest } = this.state
    const { extensionShareRef: _extensionShareRef, ...withoutShare } = rest
    this.publish({ ...withoutShare, open: true, surfaceOpen: true, mode: 'extensions' })
  }

  showConversations(): void {
    const { recordingTarget: _recordingTarget, ...rest } = this.state
    this.publish({
      ...rest,
      open: true,
      surfaceOpen: true,
      mode: 'source',
      ...(this.lastConversationSource === undefined ? {} : { selectedSource: this.lastConversationSource }),
    })
  }

  showContactAdd(): void {
    this.publish({ ...this.state, open: true, surfaceOpen: true, mode: 'contact-add' })
  }

  showArko(): void {
    const { selectedSource: _selectedSource, ...rest } = this.state
    this.publish({ ...rest, open: true, surfaceOpen: true, mode: 'arko' })
  }

  showSettings(section: 'account' | 'general' | 'about' = 'account'): void {
    const { selectedSource: _selectedSource, recordingTarget: _recordingTarget, ...rest } = this.state
    this.publish({ ...rest, open: true, surfaceOpen: true, mode: 'settings', settingsSection: section })
  }

  openExtensionShare(shareRef: string): void {
    const { selectedSource: _selectedSource, recordingTarget: _recordingTarget, ...rest } = this.state
    this.publish({ ...rest, open: true, surfaceOpen: true, mode: 'extensions', extensionShareRef: shareRef })
  }

  dismissExtensionShare(): void {
    const { extensionShareRef: _extensionShareRef, ...rest } = this.state
    this.publish(rest)
  }

  selectSource(source: ArkmeSourceItem): void {
    this.lastConversationSource = source
    this.publish({ ...this.state, open: true, mode: 'source', selectedSource: source })
  }

  private publish(next: ArkmeUiState): void {
    if (next.open === this.state.open && next.surfaceOpen === this.state.surfaceOpen
      && next.authRevision === this.state.authRevision
      && next.chatRevision === this.state.chatRevision
      && next.mode === this.state.mode
      && next.settingsSection === this.state.settingsSection
      && next.recordingTarget?.dateStamp === this.state.recordingTarget?.dateStamp
      && next.recordingTarget?.startAtMillis === this.state.recordingTarget?.startAtMillis
      && next.extensionShareRef === this.state.extensionShareRef
      && sameSource(next.selectedSource, this.state.selectedSource)) return
    this.state = next
    for (const listener of this.listeners) listener()
  }
}

export const arkmeUi = new ArkmeUiController()
