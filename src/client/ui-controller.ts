import type { ArkmeSourceItem } from '../types.js'
import { arkmeContactsTab } from './redesign/contacts/contacts-tab-store.js'

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
  authRevision: number
  chatRevision: number
  recordRevision: number
  mode: 'login' | 'source' | 'calls' | 'recordings' | 'world' | 'search' | 'extensions' | 'voiceprint' | 'contact-add' | 'arko'
    | 'harness'
  productMode?: 'conversations' | 'contacts'
  selectedSource?: ArkmeSourceItem
  recordingTarget?: { dateStamp: number; startAtMillis: number }
  extensionShareRef?: string
  calendarOpen?: boolean
  worldTarget?: ArkmeWorldTarget
}

export interface ArkmeWorldTarget {
  userId: number
  displayName: string
  avatarRef?: string
  avatarFallback?: { kind: 'phone_default'; colorIndex: number; label: string }
}

function sameWorldTarget(left: ArkmeWorldTarget | undefined, right: ArkmeWorldTarget | undefined): boolean {
  if (left === undefined || right === undefined) return left === right
  return left.userId === right.userId && left.displayName === right.displayName
    && left.avatarRef === right.avatarRef && JSON.stringify(left.avatarFallback) === JSON.stringify(right.avatarFallback)
}

export class ArkmeUiController {
  private state: ArkmeUiState = { authRevision: 0, chatRevision: 0, recordRevision: 0, mode: 'login' }
  private lastConversationSource: ArkmeSourceItem | undefined
  private readonly listeners = new Set<() => void>()
  private settingsOpener: (() => void) | undefined

  readonly getSnapshot = (): ArkmeUiState => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  bindSettingsOpener(opener: () => void): () => void {
    this.settingsOpener = opener
    return () => { if (this.settingsOpener === opener) this.settingsOpener = undefined }
  }

  openDshSettings(): void {
    this.settingsOpener?.()
  }

  focusSendToSelf(): void {
    this.leaveContacts()
    this.lastConversationSource = undefined
    const { selectedSource: _selectedSource, calendarOpen: _calendarOpen, productMode: _productMode, ...rest } = this.state
    this.publish({ ...rest, mode: 'source' })
  }

  authChanged(authenticated = false, resetSelection = false): void {
    this.leaveContacts()
    if (authenticated) {
      if (resetSelection) this.lastConversationSource = undefined
      const { selectedSource: _selectedSource, calendarOpen: _calendarOpen, productMode: _productMode, ...stateWithoutSelection } = this.state
      const { calendarOpen: _activeCalendar, productMode: _activeProductMode, ...stateWithoutCalendar } = this.state
      const state = resetSelection ? stateWithoutSelection : stateWithoutCalendar
      this.publish({
        ...state,
        mode: state.mode === 'login' ? 'source' : state.mode,
        authRevision: this.state.authRevision + 1,
      })
      return
    }
    this.lastConversationSource = undefined
    const { selectedSource: _selectedSource, calendarOpen: _calendarOpen, productMode: _productMode, ...rest } = this.state
    this.publish({
      ...rest,
      mode: 'login',
      authRevision: this.state.authRevision + 1,
    })
  }

  chatChanged(): void {
    this.publish({ ...this.state, chatRevision: this.state.chatRevision + 1 })
  }

  recordChanged(): void {
    this.publish({ ...this.state, recordRevision: this.state.recordRevision + 1 })
  }

  showLogin(): void {
    this.leaveContacts()
    const { selectedSource: _selectedSource, calendarOpen: _calendarOpen, productMode: _productMode, ...rest } = this.state
    this.publish({ ...rest, mode: 'login' })
  }

  showRecordings(): void {
    this.leaveContacts()
    const { selectedSource: _selectedSource, recordingTarget: _recordingTarget, calendarOpen: _calendarOpen, productMode: _productMode, ...rest } = this.state
    this.publish({ ...rest, mode: 'recordings' })
  }

  showCalls(): void {
    this.leaveContacts()
    const { selectedSource: _selectedSource, recordingTarget: _recordingTarget, calendarOpen: _calendarOpen, productMode: _productMode, ...rest } = this.state
    this.publish({ ...rest, mode: 'calls' })
  }

  showCalendar(): void {
    this.leaveContacts()
    if (this.state.calendarOpen === true) {
      const { calendarOpen: _calendarOpen, productMode: _productMode, ...rest } = this.state
      this.publish(rest)
      return
    }
    const { productMode: _productMode, ...rest } = this.state
    this.publish({ ...rest, calendarOpen: true })
  }

  hideCalendar(): void {
    const { calendarOpen: _calendarOpen, ...rest } = this.state
    this.publish(rest)
  }

  showWorld(): void {
    this.leaveContacts()
    const { selectedSource: _selectedSource, recordingTarget: _recordingTarget, calendarOpen: _calendarOpen, worldTarget: _worldTarget, productMode: _productMode, ...rest } = this.state
    this.publish({ ...rest, mode: 'world' })
  }

  showUserWorld(target: ArkmeWorldTarget): void {
    this.leaveContacts()
    if (!Number.isSafeInteger(target.userId) || target.userId <= 0) throw new TypeError('世界用户 ID 必须是正整数')
    const displayName = target.displayName.replace(/\s+/g, ' ').trim()
    if (displayName === '') throw new TypeError('世界用户名不能为空')
    const { selectedSource: _selectedSource, recordingTarget: _recordingTarget, calendarOpen: _calendarOpen, productMode: _productMode, ...rest } = this.state
    this.publish({
      ...rest,
      mode: 'world',
      worldTarget: { ...target, displayName },
    })
  }

  showRecordingTarget(dateStamp: number, startAtMillis: number): void {
    this.leaveContacts()
    const { selectedSource: _selectedSource, calendarOpen: _calendarOpen, productMode: _productMode, ...rest } = this.state
    this.publish({ ...rest, mode: 'recordings', recordingTarget: { dateStamp, startAtMillis } })
  }

  showSearch(): void {
    this.leaveContacts()
    const { selectedSource: _selectedSource, calendarOpen: _calendarOpen, productMode: _productMode, ...rest } = this.state
    this.publish({ ...rest, mode: 'search' })
  }

  showVoiceprint(): void {
    this.leaveContacts()
    const { selectedSource: _selectedSource, recordingTarget: _recordingTarget, calendarOpen: _calendarOpen, productMode: _productMode, ...rest } = this.state
    this.publish({ ...rest, mode: 'voiceprint' })
  }

  showExtensions(): void {
    this.leaveContacts()
    const { selectedSource: _selectedSource, recordingTarget: _recordingTarget, calendarOpen: _calendarOpen, productMode: _productMode, ...rest } = this.state
    const { extensionShareRef: _extensionShareRef, ...withoutShare } = rest
    this.publish({ ...withoutShare, mode: 'extensions' })
  }

  showConversations(): void {
    this.leaveContacts()
    const { recordingTarget: _recordingTarget, calendarOpen: _calendarOpen, productMode: _productMode, ...rest } = this.state
    this.publish({
      ...rest,
      mode: 'source',
      ...(this.lastConversationSource === undefined ? {} : { selectedSource: this.lastConversationSource }),
    })
  }

  showContacts(): void {
    const { recordingTarget: _recordingTarget, calendarOpen: _calendarOpen, ...rest } = this.state
    this.publish({ ...rest, mode: 'source', productMode: 'contacts' })
  }

  showContactAdd(): void {
    this.leaveContacts()
    const { productMode: _productMode, ...rest } = this.state
    this.publish({ ...rest, mode: 'contact-add' })
  }

  showArko(): void {
    this.leaveContacts()
    const { selectedSource: _selectedSource, calendarOpen: _calendarOpen, productMode: _productMode, ...rest } = this.state
    this.publish({ ...rest, mode: 'arko' })
  }

  showHarness(): void {
    this.leaveContacts()
    const { selectedSource: _selectedSource, recordingTarget: _recordingTarget, calendarOpen: _calendarOpen, productMode: _productMode, ...rest } = this.state
    this.publish({ ...rest, mode: 'harness' })
  }

  openExtensionShare(shareRef: string): void {
    this.leaveContacts()
    const { selectedSource: _selectedSource, recordingTarget: _recordingTarget, calendarOpen: _calendarOpen, productMode: _productMode, ...rest } = this.state
    this.publish({ ...rest, mode: 'extensions', extensionShareRef: shareRef })
  }

  dismissExtensionShare(): void {
    const { extensionShareRef: _extensionShareRef, ...rest } = this.state
    this.publish(rest)
  }

  selectSource(source: ArkmeSourceItem): void {
    this.leaveContacts()
    this.lastConversationSource = source
    const { calendarOpen: _calendarOpen, productMode: _productMode, ...rest } = this.state
    this.publish({ ...rest, mode: 'source', selectedSource: source })
  }

  private publish(next: ArkmeUiState): void {
    if (next.authRevision === this.state.authRevision
      && next.chatRevision === this.state.chatRevision
      && next.recordRevision === this.state.recordRevision
      && next.mode === this.state.mode
      && next.productMode === this.state.productMode
      && next.calendarOpen === this.state.calendarOpen
      && next.recordingTarget?.dateStamp === this.state.recordingTarget?.dateStamp
      && next.recordingTarget?.startAtMillis === this.state.recordingTarget?.startAtMillis
      && next.extensionShareRef === this.state.extensionShareRef
      && sameWorldTarget(next.worldTarget, this.state.worldTarget)
      && sameSource(next.selectedSource, this.state.selectedSource)) return
    this.state = next
    for (const listener of this.listeners) listener()
  }

  private leaveContacts(): void {
    if (this.state.productMode === 'contacts') arkmeContactsTab.clear()
  }
}

export const arkmeUi = new ArkmeUiController()
