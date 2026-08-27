import { useEffect, useReducer, useRef } from 'react'
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

  openMessage(): void {
    if (!this.active || this.messageBusy) return
    this.messageBusy = true
    this.messageController?.abort()
    const controller = new AbortController()
    this.messageController = controller
    this.commit({ type: 'message-start' })
    void this.options.openChat(this.options.identity.contactRef, controller.signal)
      .then(result => {
        if (!this.accepts(controller)) return
        this.messageBusy = false
        this.commit({ type: 'message-success' })
        this.options.onSelectionCleared()
        this.options.onSourceActivated(result.source)
      })
      .catch(error => {
        if (!this.accepts(controller)) return
        this.messageBusy = false
        this.commit({ type: 'message-error', message: detailErrorMessage(error, '打开会话失败') })
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
      .then(page => {
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

export function ContactProfileContent({
  state,
  messageBusy,
  messageError,
  onRetry,
  onOpenMessage,
}: {
  state: ContactProfileState
  messageBusy: boolean
  messageError?: string
  onRetry?(): void
  onOpenMessage(): void
}) {
  return <section className="arkme-contact-profile" aria-label="联系人资料">
    {state.status === 'loading' && <div role="status" className="arkme-contact-profile-status">正在加载联系人资料…</div>}
    {state.status === 'ready' && state.profile !== undefined && <>
      <div className="arkme-contact-profile-main">
        <span className="arkme-contact-profile-avatar">
          <ArkmeUserAvatar
            {...(state.profile.avatarRef === undefined ? {} : { avatarRef: state.profile.avatarRef })}
            size={72}
            label={`${state.profile.displayName}的头像`}
          />
        </span>
        <div className="arkme-contact-profile-identity">
          <h1 className="arkme-contact-profile-name">{state.profile.displayName}</h1>
          <dl className="arkme-contact-profile-fields">
            <div aria-label={`昵称：${state.profile.nickname}`}><dt>昵称：</dt><dd>{state.profile.nickname}</dd></div>
            {state.profile.remark.trim() !== '' && <div aria-label={`备注：${state.profile.remark}`}><dt>备注：</dt><dd>{state.profile.remark}</dd></div>}
          </dl>
        </div>
        <button
          type="button"
          className="arkme-contact-profile-message"
          disabled={messageBusy}
          onClick={onOpenMessage}
        >{messageBusy ? '正在打开…' : '发消息'}</button>
      </div>
    </>}
    {state.status !== 'ready' && <button
      type="button"
      className="arkme-contact-profile-message"
      disabled={messageBusy}
      onClick={onOpenMessage}
    >{messageBusy ? '正在打开…' : '发消息'}</button>}
    {state.status === 'error' && <div role="alert" className="arkme-contact-profile-error">
      <span>{state.message ?? '联系人资料加载失败'}</span>
      {onRetry !== undefined && <button type="button" onClick={onRetry}>重试</button>}
    </div>}
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
  const coordinatorRef = useRef<ContactDetailCoordinator>()
  const callbacksRef = useRef({ onSelectionCleared, onSourceActivated })
  callbacksRef.current = { onSelectionCleared, onSourceActivated }

  useEffect(() => {
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
    />
    <ContactWorldList
      state={visibleWorld}
      onRetry={() => { coordinatorRef.current?.retryWorld() }}
      onLoadMore={() => {
        coordinatorRef.current?.loadMore(visibleWorld.nextOffset ?? visibleWorld.items.length)
      }}
    />
  </div>
}
