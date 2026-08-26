import type { ArkmeBotSummary, ArkmeSourceItem } from '../types.js'
import { arkmeContactsTab } from './redesign/contacts/contacts-tab-store.js'
import type { ArkmeExtensionShareAction } from './extension-share-deeplink.js'

function sameSource(left: ArkmeSourceItem | undefined, right: ArkmeSourceItem | undefined): boolean {
  if (left === undefined || right === undefined) return left === right
  return left.sourceRef === right.sourceRef && left.kind === right.kind && left.displayName === right.displayName
    && left.latestPreview === right.latestPreview && left.activeAtMillis === right.activeAtMillis
    && left.unreadCount === right.unreadCount && left.hasUnreadMention === right.hasUnreadMention
    && left.isMuted === right.isMuted
    && left.latestSequence === right.latestSequence
    && left.avatarRef === right.avatarRef && (left.avatarRefs ?? []).join('|') === (right.avatarRefs ?? []).join('|')
    && JSON.stringify(left.groupAvatar) === JSON.stringify(right.groupAvatar)
}

function sameBot(left: ArkmeBotSummary | undefined, right: ArkmeBotSummary | undefined): boolean {
  if (left === undefined || right === undefined) return left === right
  return left.botRef === right.botRef && left.name === right.name && left.provider === right.provider
    && left.description === right.description && left.status === right.status && left.avatarRef === right.avatarRef
    && left.createdAtMillis === right.createdAtMillis && left.latestMessageAtMillis === right.latestMessageAtMillis
    && left.latestMessagePreview === right.latestMessagePreview
}

export interface ArkmeUiState {
  authRevision: number
  chatRevision: number
  recordRevision: number
  mode: 'login' | 'source' | 'bot' | 'calls' | 'recordings' | 'world' | 'search' | 'extensions' | 'voiceprint' | 'contact-add' | 'arko'
    | 'harness'
  productMode?: 'conversations' | 'contacts'
  selectedSource?: ArkmeSourceItem
  selectedBot?: ArkmeBotSummary
  conversationTarget?: { revision: number; itemUid: string; sendAtMillis: number }
  recordingTarget?: { dateStamp: number; startAtMillis: number }
  extensionShareRef?: string
  extensionShareAction?: ArkmeExtensionShareAction
  extensionDetailId?: string
  extensionAuthorFilter?: ArkmeExtensionAuthorFilter
  calendarOpen?: boolean
  worldTarget?: ArkmeWorldTarget
}

export interface ArkmeExtensionAuthorFilter {
  ownerUserId: number
  ownerName: string
}

export interface ArkmeWorldTarget {
  userId: number
  displayName: string
  avatarRef?: string
  avatarFallback?: { kind: 'phone_default'; colorIndex: number; label: string }
}

type ArkmeConversationDestination =
  | { kind: 'harness' }
  | { kind: 'send_to_self' }
  | { kind: 'source'; source: ArkmeSourceItem }
  | { kind: 'bot'; bot: ArkmeBotSummary }

function sameWorldTarget(left: ArkmeWorldTarget | undefined, right: ArkmeWorldTarget | undefined): boolean {
  if (left === undefined || right === undefined) return left === right
  return left.userId === right.userId && left.displayName === right.displayName
    && left.avatarRef === right.avatarRef && JSON.stringify(left.avatarFallback) === JSON.stringify(right.avatarFallback)
}

export class ArkmeUiController {
  private state: ArkmeUiState = { authRevision: 0, chatRevision: 0, recordRevision: 0, mode: 'login' }
  /** Runtime-only conversation memory. A fresh client always starts in Harness. */
  private lastConversationDestination: ArkmeConversationDestination | undefined
  private readonly listeners = new Set<() => void>()
  private settingsOpener: (() => void) | undefined
  private conversationTargetRevision = 0

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
    this.lastConversationDestination = { kind: 'send_to_self' }
    const { selectedSource: _selectedSource, calendarOpen: _calendarOpen, productMode: _productMode, ...rest } = this.state
    this.publish({ ...rest, mode: 'source' })
  }

  authChanged(authenticated = false, resetSelection = false): void {
    this.leaveContacts()
    if (authenticated) {
      if (resetSelection) this.lastConversationDestination = undefined
      const { selectedSource: _selectedSource, calendarOpen: _calendarOpen, productMode: _productMode, ...stateWithoutSelection } = this.state
      const { calendarOpen: _activeCalendar, productMode: _activeProductMode, ...stateWithoutCalendar } = this.state
      const state = resetSelection ? stateWithoutSelection : stateWithoutCalendar
      const startsClientConversation = state.mode === 'login'
      if (startsClientConversation) this.lastConversationDestination = { kind: 'harness' }
      this.publish({
        ...state,
        mode: startsClientConversation ? 'harness' : state.mode,
        authRevision: this.state.authRevision + 1,
      })
      return
    }
    this.lastConversationDestination = undefined
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
    const { extensionShareRef: _extensionShareRef, extensionShareAction: _extensionShareAction, extensionDetailId: _extensionDetailId, extensionAuthorFilter: _extensionAuthorFilter, ...withoutExtensionIntent } = rest
    this.publish({ ...withoutExtensionIntent, mode: 'extensions' })
  }

  showAuthorExtensions(ownerUserId: number, ownerName: string): void {
    this.leaveContacts()
    if (!Number.isSafeInteger(ownerUserId) || ownerUserId <= 0) throw new TypeError('插件作者用户 ID 必须是正整数')
    const normalizedOwnerName = ownerName.replace(/\s+/g, ' ').trim()
    if (normalizedOwnerName === '') throw new TypeError('插件作者名称不能为空')
    const {
      selectedSource: _selectedSource,
      recordingTarget: _recordingTarget,
      calendarOpen: _calendarOpen,
      productMode: _productMode,
      extensionShareRef: _extensionShareRef,
      extensionShareAction: _extensionShareAction,
      extensionDetailId: _extensionDetailId,
      ...rest
    } = this.state
    this.publish({
      ...rest,
      mode: 'extensions',
      extensionAuthorFilter: { ownerUserId, ownerName: normalizedOwnerName },
    })
  }

  showExtensionDetail(extensionId: string): void {
    this.leaveContacts()
    const normalized = extensionId.trim()
    if (normalized === '') throw new TypeError('插件 ID 不能为空')
    const { selectedSource: _selectedSource, recordingTarget: _recordingTarget, calendarOpen: _calendarOpen, productMode: _productMode, extensionShareRef: _extensionShareRef, extensionShareAction: _extensionShareAction, extensionAuthorFilter: _extensionAuthorFilter, ...rest } = this.state
    this.publish({ ...rest, mode: 'extensions', extensionDetailId: normalized })
  }

  showConversations(): void {
    this.leaveContacts()
    const { selectedSource: _selectedSource, recordingTarget: _recordingTarget, calendarOpen: _calendarOpen, productMode: _productMode, ...rest } = this.state
    const destination = this.lastConversationDestination
    this.publish({
      ...rest,
      mode: destination?.kind === 'harness' ? 'harness' : destination?.kind === 'bot' ? 'bot' : 'source',
      ...(destination?.kind === 'source' ? { selectedSource: destination.source } : {}),
      ...(destination?.kind === 'bot' ? { selectedBot: destination.bot } : {}),
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
    this.lastConversationDestination = { kind: 'harness' }
    const { selectedSource: _selectedSource, recordingTarget: _recordingTarget, calendarOpen: _calendarOpen, productMode: _productMode, ...rest } = this.state
    this.publish({ ...rest, mode: 'harness' })
  }

  openExtensionShare(shareRef: string, action?: ArkmeExtensionShareAction): void {
    this.leaveContacts()
    const { selectedSource: _selectedSource, recordingTarget: _recordingTarget, calendarOpen: _calendarOpen, productMode: _productMode, ...rest } = this.state
    const { extensionDetailId: _extensionDetailId, extensionAuthorFilter: _extensionAuthorFilter, extensionShareAction: _extensionShareAction, ...withoutDetail } = rest
    this.publish({
      ...withoutDetail,
      mode: 'extensions',
      extensionShareRef: shareRef,
      ...(action === undefined ? {} : { extensionShareAction: action }),
    })
  }

  dismissExtensionShare(): void {
    const { extensionShareRef: _extensionShareRef, extensionShareAction: _extensionShareAction, ...rest } = this.state
    this.publish(rest)
  }

  selectSource(source: ArkmeSourceItem): void {
    this.leaveContacts()
    this.lastConversationDestination = { kind: 'source', source }
    const { selectedBot: _selectedBot, calendarOpen: _calendarOpen, conversationTarget: _conversationTarget, productMode: _productMode, ...rest } = this.state
    this.publish({ ...rest, mode: 'source', selectedSource: source })
  }

  openBotConversation(bot: ArkmeBotSummary): void {
    this.leaveContacts()
    this.lastConversationDestination = { kind: 'bot', bot }
    const { selectedSource: _selectedSource, calendarOpen: _calendarOpen, conversationTarget: _conversationTarget, productMode: _productMode, ...rest } = this.state
    this.publish({ ...rest, mode: 'bot', selectedBot: bot })
  }

  showConversationTarget(source: ArkmeSourceItem, itemUid: string, sendAtMillis: number): void {
    this.leaveContacts()
    const normalizedItemUid = itemUid.trim()
    if (normalizedItemUid === '') throw new TypeError('会话消息定位标识不能为空')
    this.lastConversationDestination = { kind: 'source', source }
    const { calendarOpen: _calendarOpen, productMode: _productMode, ...rest } = this.state
    this.publish({
      ...rest,
      mode: 'source',
      selectedSource: source,
      conversationTarget: {
        revision: ++this.conversationTargetRevision,
        itemUid: normalizedItemUid,
        sendAtMillis: Number.isFinite(sendAtMillis) ? sendAtMillis : 0,
      },
    })
  }

  consumeConversationTarget(revision: number): void {
    if (this.state.conversationTarget?.revision !== revision) return
    const { conversationTarget: _conversationTarget, ...rest } = this.state
    this.publish(rest)
  }

  private publish(next: ArkmeUiState): void {
    if (next.authRevision === this.state.authRevision
      && next.chatRevision === this.state.chatRevision
      && next.recordRevision === this.state.recordRevision
      && next.mode === this.state.mode
      && next.productMode === this.state.productMode
      && next.calendarOpen === this.state.calendarOpen
      && next.conversationTarget?.revision === this.state.conversationTarget?.revision
      && next.conversationTarget?.itemUid === this.state.conversationTarget?.itemUid
      && next.conversationTarget?.sendAtMillis === this.state.conversationTarget?.sendAtMillis
      && next.recordingTarget?.dateStamp === this.state.recordingTarget?.dateStamp
      && next.recordingTarget?.startAtMillis === this.state.recordingTarget?.startAtMillis
      && next.extensionShareRef === this.state.extensionShareRef
      && next.extensionShareAction === this.state.extensionShareAction
      && next.extensionDetailId === this.state.extensionDetailId
      && next.extensionAuthorFilter?.ownerUserId === this.state.extensionAuthorFilter?.ownerUserId
      && next.extensionAuthorFilter?.ownerName === this.state.extensionAuthorFilter?.ownerName
      && sameWorldTarget(next.worldTarget, this.state.worldTarget)
      && sameSource(next.selectedSource, this.state.selectedSource)
      && sameBot(next.selectedBot, this.state.selectedBot)) return
    this.state = next
    for (const listener of this.listeners) listener()
  }

  private leaveContacts(): void {
    if (this.state.productMode === 'contacts') arkmeContactsTab.clear()
  }
}

export const arkmeUi = new ArkmeUiController()
