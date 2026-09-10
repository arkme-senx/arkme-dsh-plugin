import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { PencilSimple } from '@phosphor-icons/react/PencilSimple'
import { ChatCircle } from '@phosphor-icons/react/ChatCircle'
import { Phone } from '@phosphor-icons/react/Phone'
import { VideoCamera } from '@phosphor-icons/react/VideoCamera'
import type { ArkmeOutgoingCallMediaType } from '../../../outgoing-call-contract.js'
import { outgoingCallUi } from '../../outgoing-call-ui-controller.js'
import { ContactRemarkDialog, type ContactRemarkSaver } from './ContactRemarkDialog.js'
import type {
  ArkmeDirectoryContactProfile,
  ArkmeOpenPrivateChatResult,
  ArkmeSourceItem,
  ArkmeWorldFeedPage,
} from '../../../types.js'
import { callArkme } from '../../api.js'
import { ArkmeUserAvatar } from '../../ArkmeAvatar.js'
import {
  ContactWorldList,
  contactDetailIdentityMatches,
  contactWorldReducer,
  createContactWorldState,
  isContactQuickNote,
  type ContactDetailIdentity,
  type ContactWorldAction,
  type ContactWorldLoadMode,
} from './ContactWorldList.js'

export type { ContactDetailIdentity } from './ContactWorldList.js'

export type ContactProfileStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface ContactProfileState {
  identity: ContactDetailIdentity
  status: ContactProfileStatus
  profile: ArkmeDirectoryContactProfile | undefined
  message: string | undefined
}

export type ContactProfileAction =
  | { type: 'profile-reset'; identity: ContactDetailIdentity }
  | { type: 'profile-start'; identity: ContactDetailIdentity }
  | { type: 'profile-success'; identity: ContactDetailIdentity; profile: ArkmeDirectoryContactProfile }
  | { type: 'profile-error'; identity: ContactDetailIdentity; message: string }

export type ContactMessageAction =
  | { type: 'message-start' }
  | { type: 'message-success' }
  | { type: 'message-error'; message: string }

export type ContactDetailAction = ContactProfileAction | ContactWorldAction | ContactMessageAction

export interface ContactMessageState {
  busy: boolean
  error: string | undefined
}

export function createContactProfileState(identity: ContactDetailIdentity): ContactProfileState {
  return { identity, status: 'idle', profile: undefined, message: undefined }
}

export function contactProfileReducer(
  state: ContactProfileState,
  action: ContactProfileAction,
): ContactProfileState {
  if (action.type === 'profile-reset') return createContactProfileState(action.identity)
  if (!contactDetailIdentityMatches(state.identity, action.identity)) return state
  switch (action.type) {
    case 'profile-start': return { ...state, status: 'loading', profile: undefined, message: undefined }
    case 'profile-success': return { ...state, status: 'ready', profile: action.profile, message: undefined }
    case 'profile-error': return { ...state, status: 'error', profile: undefined, message: action.message }
  }
}

function contactMessageReducer(state: ContactMessageState, action: ContactMessageAction): ContactMessageState {
  switch (action.type) {
    case 'message-start': return { busy: true, error: undefined }
    case 'message-success': return { busy: false, error: undefined }
    case 'message-error': return { busy: false, error: action.message }
  }
}

export type ContactProfileLoader = (
  contactRef: string,
  signal: AbortSignal,
) => Promise<ArkmeDirectoryContactProfile>

export type ContactWorldLoader = (
  contactRef: string,
  options: { limit: number; offset: number },
  signal: AbortSignal,
) => Promise<ArkmeWorldFeedPage>

export type ContactOpenChat = (
  contactRef: string,
  signal: AbortSignal,
) => Promise<ArkmeOpenPrivateChatResult>

export interface ContactDetailCoordinatorOptions {
  identity: ContactDetailIdentity
  loadProfile: ContactProfileLoader
  loadWorld: ContactWorldLoader
  openChat: ContactOpenChat
  isCurrent(identity: ContactDetailIdentity): boolean
  onAction(action: ContactDetailAction): void
  onSelectionCleared(): void
  onSourceActivated(source: ArkmeSourceItem): void
}

function detailErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : fallback
}

/** Owns one account/contact generation and rejects all completions after disposal or identity change. */
export class ContactDetailCoordinator {
  private active = true
  private profileController: AbortController | undefined
  private worldController: AbortController | undefined
  private messageController: AbortController | undefined
  private profileBusy = false
  private worldBusy = false
  private messageBusy = false

  constructor(private readonly options: ContactDetailCoordinatorOptions) {}

  start(): void {
    this.loadProfile()
    this.loadWorld('replace', 0)
  }

  retryProfile(): void {
    if (!this.active || this.profileBusy) return
    this.loadProfile()
  }

  retryWorld(): void {
    if (!this.active || this.worldBusy) return
    this.loadWorld('replace', 0)
  }

  loadMore(offset: number): void {
    if (!this.active || this.worldBusy) return
    this.loadWorld('append', Math.max(0, Math.trunc(offset)))
  }

  openMessage(): void { this.openConversation() }

  openCall(mediaType: ArkmeOutgoingCallMediaType): void { this.openConversation(mediaType) }

  private openConversation(mediaType?: ArkmeOutgoingCallMediaType): void {
    if (!this.active || this.messageBusy || !this.options.isCurrent(this.options.identity)) return
    this.messageBusy = true
    this.messageController?.abort()
    const controller = new AbortController()
    this.messageController = controller
    this.commit({ type: 'message-start' })
    void this.options.openChat(this.options.identity.contactRef, controller.signal)
      .then(result => {
        if (!this.accepts(controller)) return
        if (mediaType === undefined) {
          this.options.onSelectionCleared()
          this.options.onSourceActivated(result.source)
        } else {
          if (result.source.kind !== 'private_chat') throw new Error('仅支持向私聊联系人发起通话')
          outgoingCallUi.request({ sourceRef: result.source.sourceRef, displayName: result.source.displayName, mediaType })
        }
        this.messageBusy = false
        this.commit({ type: 'message-success' })
      })
      .catch(error => {
        if (!this.accepts(controller)) return
        this.messageBusy = false
        this.commit({ type: 'message-error', message: detailErrorMessage(error, mediaType === undefined ? '打开会话失败' : '发起通话失败') })
      })
  }

  dispose(): void {
    if (!this.active) return
    this.active = false
    this.profileController?.abort()
    this.worldController?.abort()
    this.messageController?.abort()
    this.profileBusy = false
    this.worldBusy = false
    this.messageBusy = false
  }

  private loadProfile(): void {
    this.profileBusy = true
    this.profileController?.abort()
    const controller = new AbortController()
    this.profileController = controller
    this.commit({ type: 'profile-start', identity: this.options.identity })
    void this.options.loadProfile(this.options.identity.contactRef, controller.signal)
      .then(profile => {
        if (!this.accepts(controller)) return
        this.profileBusy = false
        this.commit({ type: 'profile-success', identity: this.options.identity, profile })
      })
      .catch(error => {
        if (!this.accepts(controller)) return
        this.profileBusy = false
        this.commit({
          type: 'profile-error', identity: this.options.identity,
          message: detailErrorMessage(error, '联系人资料加载失败'),
        })
      })
  }

  private loadWorld(mode: ContactWorldLoadMode, offset: number): void {
    this.worldBusy = true
    this.worldController?.abort()
    const controller = new AbortController()
    this.worldController = controller
    this.commit({ type: 'world-start', identity: this.options.identity, mode })
    void this.options.loadWorld(this.options.identity.contactRef, { limit: 20, offset }, controller.signal)
      .then(async page => {
        // Keep looking past comments and articles for the latest quick note.
        let currentOffset = offset
        page = { ...page, items: page.items.filter(isContactQuickNote) }
        while (page.items.length === 0 && page.hasMore) {
          if (!this.accepts(controller)) return
          const nextOffset = page.nextOffset
          if (nextOffset === undefined || !Number.isSafeInteger(nextOffset) || nextOffset <= currentOffset) {
            throw new Error('世界分页响应不完整，请重试')
          }
          currentOffset = nextOffset
          page = await this.options.loadWorld(this.options.identity.contactRef, { limit: 20, offset: currentOffset }, controller.signal)
          page = { ...page, items: page.items.filter(isContactQuickNote) }
        }
        if (!this.accepts(controller)) return
        this.worldBusy = false
        this.commit({ type: 'world-success', identity: this.options.identity, mode, page })
      })
      .catch(error => {
        if (!this.accepts(controller)) return
        this.worldBusy = false
        this.commit({
          type: 'world-error', identity: this.options.identity,
          message: detailErrorMessage(error, mode === 'append' ? '加载更多失败' : '世界加载失败'),
        })
      })
  }

  private accepts(controller: AbortController): boolean {
    return this.active
      && !controller.signal.aborted
      && this.options.isCurrent(this.options.identity)
  }

  private commit(action: ContactDetailAction): void {
    if (!this.active || !this.options.isCurrent(this.options.identity)) return
    this.options.onAction(action)
  }
}

const defaultLoadProfile: ContactProfileLoader = async (contactRef, signal) => await callArkme(
  'directory.contact.profile', { contactRef }, signal,
)

const defaultLoadWorld: ContactWorldLoader = async (contactRef, options, signal) => await callArkme(
  'directory.contact.world', { contactRef, limit: options.limit, offset: options.offset }, signal,
)

const defaultOpenChat: ContactOpenChat = async (contactRef, signal) => await callArkme(
  'directory.contact.open-chat', { contactRef }, signal,
)

const defaultSaveRemark: ContactRemarkSaver = async (contactRef, remark, signal) => await callArkme(
  'directory.contact.remark.update', { contactRef, remark }, signal,
)

export function ContactProfileContent({
  state,
  messageBusy,
  messageError,
  onRetry,
  onOpenMessage,
  onOpenCall,
  onEditRemark,
  children,
}: {
  state: ContactProfileState
  messageBusy: boolean
  messageError?: string
  onRetry?(): void
  onOpenMessage(): void
  onOpenCall?(mediaType: ArkmeOutgoingCallMediaType): void
  onEditRemark?(): void
  children?: ReactNode
}) {
  const profile = state.status === 'ready' ? state.profile : undefined
  const remark = profile?.remark.trim() || ''
  const displayName = remark || profile?.nickname.trim() || profile?.accountName?.trim() || profile?.displayName || '联系人'
  return <section className="arkme-contact-profile" aria-label="联系人资料">
    {state.status === 'loading' && <div role="status" className="arkme-contact-profile-status">正在加载联系人资料…</div>}
    {profile !== undefined && <>
      <header className="arkme-contact-profile-main">
        <span className="arkme-contact-profile-avatar">
          <ArkmeUserAvatar
            {...(profile.avatarRef === undefined ? {} : { avatarRef: profile.avatarRef })}
            size={72}
            label={`${displayName}的头像`}
          />
        </span>
        <div className="arkme-contact-profile-identity">
          <h1 className="arkme-contact-profile-name">{displayName}</h1>
          <dl className="arkme-contact-profile-fields">
            <div aria-label={`昵称：${profile.nickname.trim() || '未设置'}`}><dt>昵称</dt><dd>{profile.nickname.trim() || '未设置'}</dd></div>
            <div aria-label={`即我号：${profile.accountName?.trim() || '未设置'}`}><dt>即我号</dt><dd>{profile.accountName?.trim() || '未设置'}</dd></div>
          </dl>
        </div>
      </header>
      <section className="arkme-contact-profile-section">
        <h2 className="arkme-contact-profile-section-title">联系人资料</h2>
        <dl className="arkme-contact-profile-row" aria-label={`备注：${remark || '未设置'}`}>
          <dt>备注</dt><dd className="arkme-contact-profile-remark">
            <span>{remark || '未设置'}</span>
            <button type="button" className="arkme-contact-remark-edit" onClick={onEditRemark} disabled={onEditRemark === undefined} aria-label="编辑备注">
              <PencilSimple size={15} aria-hidden /><span>编辑</span>
            </button>
          </dd>
        </dl>
      </section>
    </>}
    {state.status === 'error' && <div role="alert" className="arkme-contact-profile-error">
      <span>{state.message ?? '联系人资料加载失败'}</span>
      {onRetry !== undefined && <button type="button" onClick={onRetry}>重试</button>}
    </div>}
    {children}
    <footer className="arkme-contact-profile-actions" aria-label="联系操作" aria-busy={messageBusy}>
      <button type="button" className="arkme-contact-profile-action" disabled={messageBusy} onClick={onOpenMessage}>
        <ChatCircle size={28} weight="regular" aria-hidden /><span>{messageBusy ? '正在打开…' : '发消息'}</span>
      </button>
      <button type="button" className="arkme-contact-profile-action" disabled={messageBusy || onOpenCall === undefined} onClick={() => { onOpenCall?.('audio') }}>
        <Phone size={28} weight="regular" aria-hidden /><span>语音聊天</span>
      </button>
      <button type="button" className="arkme-contact-profile-action" disabled={messageBusy || onOpenCall === undefined} onClick={() => { onOpenCall?.('video') }}>
        <VideoCamera size={28} weight="regular" aria-hidden /><span>视频聊天</span>
      </button>
    </footer>
    {messageError !== undefined && <div role="alert" className="arkme-contact-profile-message-error">{messageError}</div>}
  </section>
}

export interface ContactProfileDetailProps {
  accountKey: string
  contactRef: string
  onSelectionCleared(): void
  onSourceActivated(source: ArkmeSourceItem): void
  loadProfile?: ContactProfileLoader
  loadWorld?: ContactWorldLoader
  saveRemark?: ContactRemarkSaver
  onProfileUpdated?(profile: ArkmeDirectoryContactProfile): void
  openChat?: ContactOpenChat
}

export function ContactProfileDetail({
  accountKey,
  contactRef,
  onSelectionCleared,
  onSourceActivated,
  loadProfile = defaultLoadProfile,
  loadWorld = defaultLoadWorld,
  openChat = defaultOpenChat,
  saveRemark = defaultSaveRemark,
  onProfileUpdated,
}: ContactProfileDetailProps) {
  const generationRef = useRef(0)
  const identityKeyRef = useRef('')
  const identityRef = useRef<ContactDetailIdentity>({ accountKey, contactRef, generation: 0 })
  const identityKey = `${accountKey}\u0000${contactRef}`
  if (identityKeyRef.current !== identityKey) {
    identityKeyRef.current = identityKey
    generationRef.current += 1
    identityRef.current = { accountKey, contactRef, generation: generationRef.current }
  }
  const identity = identityRef.current
  const [profileState, dispatchProfile] = useReducer(contactProfileReducer, identity, createContactProfileState)
  const [worldState, dispatchWorld] = useReducer(contactWorldReducer, identity, createContactWorldState)
  const [messageState, dispatchMessage] = useReducer(contactMessageReducer, { busy: false, error: undefined })
  const [editingIdentity, setEditingIdentity] = useState<ContactDetailIdentity>()
  const coordinatorRef = useRef<ContactDetailCoordinator>()
  const callbacksRef = useRef({ onSelectionCleared, onSourceActivated })
  callbacksRef.current = { onSelectionCleared, onSourceActivated }

  useEffect(() => {
    dispatchMessage({ type: 'message-success' })
    dispatchProfile({ type: 'profile-reset', identity })
    dispatchWorld({ type: 'world-reset', identity })
    const coordinator = new ContactDetailCoordinator({
      identity,
      loadProfile,
      loadWorld,
      openChat,
      isCurrent: candidate => contactDetailIdentityMatches(identityRef.current, candidate),
      onAction: action => {
        if (action.type.startsWith('profile-')) dispatchProfile(action as ContactProfileAction)
        else if (action.type.startsWith('world-')) dispatchWorld(action as ContactWorldAction)
        else dispatchMessage(action as ContactMessageAction)
      },
      onSelectionCleared: () => { callbacksRef.current.onSelectionCleared() },
      onSourceActivated: source => { callbacksRef.current.onSourceActivated(source) },
    })
    coordinatorRef.current = coordinator
    coordinator.start()
    return () => {
      coordinator.dispose()
      if (coordinatorRef.current === coordinator) coordinatorRef.current = undefined
    }
  }, [identity, loadProfile, loadWorld, openChat])

  const visibleProfile = contactDetailIdentityMatches(profileState.identity, identity)
    ? profileState
    : { ...createContactProfileState(identity), status: 'loading' as const }
  const visibleWorld = contactDetailIdentityMatches(worldState.identity, identity)
    ? worldState
    : { ...createContactWorldState(identity), status: 'loading' as const, loadingMode: 'replace' as const }

  return <div className="arkme-contact-detail" data-contact-ref={contactRef}>
    <ContactProfileContent
      state={visibleProfile}
      messageBusy={messageState.busy}
      {...(messageState.error === undefined ? {} : { messageError: messageState.error })}
      onRetry={() => { coordinatorRef.current?.retryProfile() }}
      onOpenMessage={() => { coordinatorRef.current?.openMessage() }}
      onOpenCall={mediaType => { coordinatorRef.current?.openCall(mediaType) }}
      onEditRemark={() => { setEditingIdentity(identity) }}
    >
      <ContactWorldList
        state={visibleWorld}
        onRetry={() => { coordinatorRef.current?.retryWorld() }}
        onLoadMore={() => {
          coordinatorRef.current?.loadMore(visibleWorld.nextOffset ?? visibleWorld.items.length)
        }}
      />
    </ContactProfileContent>
    {editingIdentity !== undefined && contactDetailIdentityMatches(editingIdentity, identity) && visibleProfile.profile !== undefined && <ContactRemarkDialog
      key={identityKey}
      profile={visibleProfile.profile}
      saveRemark={saveRemark}
      onClose={() => { setEditingIdentity(undefined) }}
      onSaved={profile => {
        if (!contactDetailIdentityMatches(identityRef.current, identity)) return
        dispatchProfile({ type: 'profile-success', identity, profile })
        setEditingIdentity(undefined)
        onProfileUpdated?.(profile)
      }}
    />}
  </div>
}
