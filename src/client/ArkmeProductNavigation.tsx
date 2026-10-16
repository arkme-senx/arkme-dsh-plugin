import { ExploreNavigation } from './explore/ExploreNavigation.js'
import { usePhoneBindingStatus, socialAccessStore } from './social-access-store.js'
import { tr, useArkmeLocale } from './locale.js'
import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ChatCircleText } from '@phosphor-icons/react/dist/icons/ChatCircleText'
import { CalendarBlank } from '@phosphor-icons/react/dist/icons/CalendarBlank'
import { ListChecks } from '@phosphor-icons/react/dist/icons/ListChecks'
import { PhoneCall } from '@phosphor-icons/react/dist/icons/PhoneCall'
import { PuzzlePiece } from '@phosphor-icons/react/dist/icons/PuzzlePiece'
import { Waveform } from '@phosphor-icons/react/dist/icons/Waveform'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { Database } from '@phosphor-icons/react/dist/icons/Database'
import { GearSix } from '@phosphor-icons/react/dist/icons/GearSix'
import { GlobeHemisphereWest } from '@phosphor-icons/react/dist/icons/GlobeHemisphereWest'
import { AddressBook } from '@phosphor-icons/react/dist/icons/AddressBook'
import type { Icon } from '@phosphor-icons/react/lib'
import type { ArkmeUserProfile, ArkmeUserProfileSnapshot } from '../types.js'
import pluginManifest from '../../package.json' with { type: 'json' }
import { useArkmeBrand } from './product-brand.js'
import { ArkmeJiwoBrandMark } from './ArkmeJiwoBrandMark.js'
import { useProfileRevision } from './profile-change-store.js'
import { ArkmeMembershipDialog } from './ArkmeMembershipDialog.js'
import { ArkmeAccountUsage } from './ArkmeAccountUsage.js'
import { membershipLabel, membershipDescription, useMembership } from './arkme-membership.js'
import { callArkme } from './api.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmePersonalDayCalendar } from './ArkmePersonalDayCalendar.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeChatDirectory } from './chat-directory-store.js'
import { arkmeUi } from './ui-controller.js'
import { currentClientVersionCode, formatProductVersion } from './product-version.js'
import { ARKME_NAVIGATION_WIDTH, ARKME_PROFILE_AVATAR_SIZE } from './arkme-layout.js'
import { arkmeTheme as theme } from './arkme-theme.js'
import { directRecordingStore } from './recordings/direct-recording-store.js'
import { ArkmeRecordingNavigationHint } from './recordings/ArkmeRecordingNavigationHint.js'
import { useRecordingBreathStyle } from './recordings/recording-breath.js'
import { useArkmeNavigationTooltip } from './ArkmeNavigationTooltip.js'

export interface ArkmeProductNavigationProps {
  compact: boolean
  hosted?: boolean
  taskExpanded?: boolean
  hidden?: boolean
  locked?: boolean
  currentSessionId?: string | undefined
}

type NavigationItem = {
  id: 'conversations' | 'contacts' | 'calls' | 'recordings' | 'calendar' | 'arrangements' | 'explore' | 'extensions'
  label: string
  icon: Icon
}

const items: NavigationItem[] = [
  { id: 'conversations', get label() { return tr("对话") }, icon: ChatCircleText },
  { id: 'contacts', get label() { return tr("联系人") }, icon: AddressBook },
  { id: 'calls', get label() { return tr("通话") }, icon: PhoneCall },
  { id: 'recordings', get label() { return tr("录音") }, icon: Waveform },
  { id: 'calendar', get label() { return tr("日历") }, icon: CalendarBlank },
  { id: 'arrangements', get label() { return tr("安排") }, icon: ListChecks },
  { id: 'explore', get label() { return tr("探索") }, icon: GlobeHemisphereWest },
  { id: 'extensions', get label() { return tr("市集") }, icon: PuzzlePiece },
]

const styles: Record<string, CSSProperties> = {
  rail: {
    position: 'relative',
    width: ARKME_NAVIGATION_WIDTH,
    minWidth: ARKME_NAVIGATION_WIDTH,
    height: '100%',
    padding: '24px 8px 14px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 5,
    borderRight: `1px solid ${theme.borderSoft}`,
    background: theme.sidebar,
    color: theme.text,
  },
  compactRail: {
    width: '100%',
    minWidth: 0,
    height: 58,
    padding: '6px 10px',
    flexDirection: 'row',
    alignItems: 'center',
    borderRight: 0,
    borderBottom: `1px solid ${theme.borderSoft}`,
  },
  hostedRail: {
    width: '100%', minWidth: 0, padding: '28px 4px 12px', borderRight: 0,
  },
  taskExpandedRail: { width: ARKME_NAVIGATION_WIDTH, minWidth: ARKME_NAVIGATION_WIDTH },
  brand: {
    width: '100%', minHeight: 44, flex: 'none', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'flex-start', gap: 2,
    overflow: 'visible', borderRadius: 10, background: 'transparent',
  },
  brandVersion: { color: theme.tertiary, fontSize: 10, lineHeight: '13px', whiteSpace: 'nowrap' },
  primary: {
    minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 5,
    // Keep the existing edge marker and focus outline inside the scroll viewport.
    margin: '-3px -8px', padding: '3px 8px', overflowY: 'auto', scrollbarWidth: 'none',
  },
  button: {
    position: 'relative',
    minHeight: 44,
    height: 44,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 4px',
    border: 0,
    borderRadius: 15,
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    font: 'inherit',
    boxShadow: 'none',
  },
  compactButton: { minHeight: 42, height: 42, flex: 1, flexDirection: 'row', gap: 6, padding: '0 8px', borderRadius: 12 },
  hostedButton: { padding: '0 2px', borderRadius: 13 },
  activeButton: { background: theme.active, color: theme.text },
  activeMarker: { left: -8 },
  compactMarker: { left: '50%', top: 'auto', bottom: -6, width: 30, height: 3, transform: 'translateX(-50%)' },
  hostedMarker: { left: -4 },
  icon: { position: 'relative', display: 'inline-flex' },
  unreadIndicator: {
    position: 'absolute', top: -7, right: -10, minWidth: 16, height: 16,
    padding: '0 4px', boxSizing: 'border-box', display: 'inline-flex',
    alignItems: 'center', justifyContent: 'center', borderRadius: 8,
    background: theme.danger, color: theme.onPrimaryAction, boxShadow: `0 0 0 2px ${theme.sidebar}`,
    fontSize: 10, fontWeight: 600, lineHeight: '16px', fontVariantNumeric: 'tabular-nums',
  },
  label: { fontSize: 11, lineHeight: '15px', whiteSpace: 'nowrap' },
}

/** Arkme-owned navigation rendered wholly inside the plugin surface. */
export function ArkmeProductNavigation({
  compact, hosted = false, taskExpanded = false, hidden = false, locked = false, currentSessionId,
}: ArkmeProductNavigationProps) {
  useArkmeLocale()
  const brand = useArkmeBrand()
  usePhoneBindingStatus()
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getViewSnapshot, arkmeUi.getViewSnapshot)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const directory = useSyncExternalStore(
    arkmeChatDirectory.subscribe,
    arkmeChatDirectory.getConversationSnapshot,
    arkmeChatDirectory.getConversationSnapshot,
  )
  const [profileOpen, setProfileOpen] = useState(false)
  const navigationHint = useArkmeNavigationTooltip(!compact && !hidden)
  const [membershipOpenScope, setMembershipOpenScope] = useState<string>()
  const memberUserId = authState.auth?.status === 'authenticated' ? authState.auth.userId : undefined
  const memberScope = authState.auth?.status === 'authenticated' ? `${authState.auth.environment}:${memberUserId}` : undefined
  const recording = useSyncExternalStore(directRecordingStore.subscribe, directRecordingStore.getSnapshot, directRecordingStore.getSnapshot)
  const isRecording = !locked && !hidden && memberScope !== undefined
    && recording.accountKey === memberScope && recording.phase === 'recording'
  const recordingBreathStyle = useRecordingBreathStyle(isRecording, recording.startedAt)
  const recordingButtonRef = useRef<HTMLButtonElement>(null)
  const recordingHintId = useId()
  const [recordingHintOpen, setRecordingHintOpen] = useState(false)
  useEffect(() => { setRecordingHintOpen(false) }, [memberScope, isRecording])
  const membership = useMembership(memberScope, memberUserId, profileOpen)
  const [profile, setProfile] = useState<ArkmeUserProfile>()
  const profileRevision = useProfileRevision()
  const profileTriggerRef = useRef<HTMLButtonElement>(null)
  const profilePopoverRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (authState.auth?.status !== 'authenticated') { setProfile(undefined); return }
    let active = true
    const controller = new AbortController()
    void callArkme<ArkmeUserProfileSnapshot>('user.profile', undefined, controller.signal)
      .then(async snapshot => snapshot.profile === null
        ? await callArkme<ArkmeUserProfileSnapshot>('user.profile.refresh', undefined, controller.signal)
        : snapshot)
      .then(snapshot => { if (active && snapshot.profile !== null) setProfile(snapshot.profile) })
      .catch(() => undefined)
    return () => { active = false; controller.abort() }
  }, [authState.auth?.status, authState.auth?.status === 'authenticated' ? authState.auth.userId : undefined, profileRevision])
  useEffect(() => {
    if (!profileOpen) return
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return
      if (profileTriggerRef.current?.contains(event.target) || profilePopoverRef.current?.contains(event.target)) return
      setProfileOpen(false)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProfileOpen(false)
    }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [profileOpen])
  useEffect(() => {
    if ((ui.notificationActivationRevision ?? 0) > 0) setProfileOpen(false)
  }, [ui.notificationActivationRevision])
  const activeId = locked ? 'conversations'
    : ui.mode === 'login' ? undefined
    : ui.calendarOpen === true ? 'calendar'
    : ui.mode === 'arrangements' ? 'arrangements'
    : ui.mode === 'extensions' ? 'extensions'
    : ui.mode === 'world' || ui.mode === 'explore' || ui.mode === 'statistics' ? 'explore'
    : ui.mode === 'calls' ? 'calls'
    : ui.mode === 'recordings' || ui.mode === 'recognized-speakers' || ui.mode === 'voiceprint' ? 'recordings'
      : ui.mode === 'source' && ui.productMode === 'contacts' ? 'contacts' : 'conversations'
  // Utility pages also highlight Conversations, but hide its directory/header.
  // Only relinquish the native fallback when the adapted conversation UI is active.
  const conversationDragActive = !hidden && !locked && activeId === 'conversations'
    && (ui.mode === 'source' || ui.mode === 'bot' || ui.mode === 'arko' || ui.mode === 'harness' || ui.mode === 'codex')
  const windowDragMode = conversationDragActive ? 'conversation'
    : !hidden && !locked && activeId === 'extensions' ? 'marketplace' : 'fallback'
  const conversationUnreadCount = authState.auth?.status === 'authenticated'
    && directory.accountScope === `${authState.auth.environment}:${String(authState.auth.userId)}`
    ? directory.badgeCount
    : 0
  const conversationUnreadLabel = conversationUnreadCount > 99 ? '99+' : String(conversationUnreadCount)
  const navigationItems = items.map(item => ({ ...item, label: tr(item.label) }))
  const productVersion = formatProductVersion(pluginManifest.version, currentClientVersionCode())
  const profileHint = `${tr("个人资料")} · ${membershipLabel(membership.state)}\n${membershipDescription(membership.state)}`
  useEffect(() => { navigationHint.hide() }, [navigationHint.hide, memberScope, activeId, isRecording, profileOpen, locked])

  const activate = (id: NavigationItem['id']) => {
    if (locked) {
      if (id === 'conversations') arkmeUi.showHarness()
      else arkmeUi.openWebLoginDialog()
      return
    }
    if (id === 'extensions') {
      arkmeUi.showExtensions()
      return
    }
    if (id === 'contacts') arkmeUi.showContacts()
    else if (id === 'calls') arkmeUi.showCalls()
    else if (id === 'recordings') arkmeUi.showRecordings()
    else if (id === 'explore') arkmeUi.showExplore('profile')
    else if (id === 'calendar') arkmeUi.showCalendar()
    else if (id === 'arrangements') arkmeUi.showArrangements()
    else arkmeUi.showConversations()
  }

  return <nav
      data-arkme-owned="product-navigation"
      data-arkme-window-drag-mode={windowDragMode}
      aria-label={tr("Arkme 功能导航").replace('Arkme', brand.name)}
      aria-hidden={hidden ? true : undefined}
      style={{
        ...styles.rail,
        ...(compact ? styles.compactRail : {}),
        ...(hosted ? styles.hostedRail : {}),
        ...(taskExpanded ? styles.taskExpandedRail : {}),
        ...(hidden ? { display: 'none' } : {}),
      }}
    >
      {!compact && <div data-arkme-owned="product-brand"
        style={styles.brand} tabIndex={0} aria-label={`${brand.name} ${productVersion}`}
        aria-describedby={navigationHint.describedBy('brand')}
        onMouseEnter={event => { navigationHint.show(event.currentTarget, 'brand', `${brand.name} ${productVersion}`) }}
        onMouseLeave={navigationHint.hide}
        onFocus={event => { navigationHint.show(event.currentTarget, 'brand', `${brand.name} ${productVersion}`, true) }}
        onBlur={navigationHint.hide}>
        <ArkmeJiwoBrandMark />
        <span data-arkme-plugin-version={pluginManifest.version} style={styles.brandVersion}>{productVersion}</span>
      </div>}
      <div style={{ ...styles.primary,
        ...(compact ? { flexDirection: 'row' as const, margin: 0, padding: 0, overflowY: 'visible' as const }
          : hosted ? { margin: '-3px -4px', padding: '3px 4px' } : {}),
      }} data-arkme-home-tour-scroll-container="navigation">
      {navigationItems.map(item => {
        const ItemIcon = item.icon
        const active = item.id === activeId
        if (item.id === 'explore') return <ExploreNavigation key={item.id} active={active} current={ui.mode === 'statistics' ? 'statistics' : ui.mode === 'world' ? 'world' : ui.exploreModule} locked={locked} compact={compact} style={{...styles.button, ...(compact ? styles.compactButton : {}), ...(hosted ? styles.hostedButton : {}), ...(active ? styles.activeButton : {})}} />
        const showsUnread = item.id === 'conversations' && conversationUnreadCount > 0
        const showsRecording = item.id === 'recordings' && isRecording
        const hint = item.id === 'conversations' && !locked
          ? `${item.label}\n${tr("双击定位下一个未读对话")}（Shift+Enter）` : item.label
        return <button data-arkme-feedback="neutral"
          key={item.id}
          ref={item.id === 'recordings' ? recordingButtonRef : undefined}
          data-arkme-home-tour-target={item.id}
          data-arkme-hover="button"
          type="button"
          aria-current={active ? 'page' : undefined}
          aria-label={showsRecording ? tr("录音，本机正在录音，点击查看") : showsUnread ? tr("{v0}，{v1} 条未读", { v0: item.label, v1: String(conversationUnreadCount) }) : item.label}
          aria-describedby={showsRecording && recordingHintOpen ? recordingHintId : navigationHint.describedBy(item.id)}
          {...(showsRecording ? { 'data-arkme-navigation-recording': 'local' } : {})}
          {...(showsUnread ? { 'data-arkme-conversation-unread': conversationUnreadCount } : {})}
          style={{
            ...styles.button,
            ...(compact ? styles.compactButton : {}),
            ...(hosted ? styles.hostedButton : {}),
            ...(active ? styles.activeButton : {}),
            ...(showsRecording ? recordingBreathStyle : {}),
          }}
          onClick={() => { void socialAccessStore.refreshIfStale(); navigationHint.hide(); setRecordingHintOpen(false); activate(item.id) }}
          onMouseEnter={event => {
            if (showsRecording) { navigationHint.hide(); setRecordingHintOpen(true) }
            else navigationHint.show(event.currentTarget, item.id, hint)
          }}
          onMouseLeave={() => { navigationHint.hide(); setRecordingHintOpen(false) }}
          onFocus={event => {
            if (showsRecording) { navigationHint.hide(); setRecordingHintOpen(true) }
            else navigationHint.show(event.currentTarget, item.id, hint, true)
          }}
          onBlur={() => { navigationHint.hide(); setRecordingHintOpen(false) }}
          onDoubleClick={item.id === 'conversations' && !locked ? () => { arkmeUi.locateNextUnreadConversation() } : undefined}
          title={compact && item.id === 'conversations' && !locked ? '双击定位下一个未读对话（Shift+Enter）' : undefined}
          aria-keyshortcuts={item.id === 'conversations' && !locked ? 'Shift+Enter' : undefined}
          onKeyDown={event => {
            if (item.id === 'recordings' && event.key === 'Escape') setRecordingHintOpen(false)
            if (item.id === 'conversations' && !locked && event.shiftKey && event.key === 'Enter') {
              event.preventDefault()
              arkmeUi.locateNextUnreadConversation()
            }
          }}
        >
          {showsRecording && <span data-arkme-recording-breath="surface" aria-hidden />}
          {active && <span aria-hidden data-arkme-selection-marker style={{
            ...styles.activeMarker,
            ...(compact ? styles.compactMarker : {}),
            ...(hosted ? styles.hostedMarker : {}),
          }} />}
          <span style={styles.icon}>
            <ItemIcon size={22} weight="regular" aria-hidden />
            {showsRecording && <span data-arkme-recording-indicator data-arkme-recording-breath="dot" aria-hidden style={{
              position: 'absolute', top: -3, right: -5, width: 7, height: 7, borderRadius: '50%', background: theme.danger,
            }} />}
            {showsUnread && <span
              data-arkme-unread-indicator
              data-arkme-unread-count={conversationUnreadCount}
              aria-hidden
              style={styles.unreadIndicator}
            >{conversationUnreadLabel}</span>}
          </span>
          {compact && <span style={styles.label}>{showsRecording ? tr("录音中") : item.label}</span>}
        </button>
      })}
      </div>
      {navigationHint.tooltip}
      {isRecording && recordingHintOpen && <ArkmeRecordingNavigationHint anchor={recordingButtonRef} elapsedMillis={recording.elapsedMillis} startedAt={recording.startedAt} id={recordingHintId} />}
      {ui.calendarOpen === true && typeof document !== 'undefined' && createPortal(<ArkmePersonalDayCalendar
        accountScope={authState.auth?.status === 'authenticated' ? `${authState.auth.environment}:${authState.auth.userId}` : undefined}
        initialDate={ui.calendarInitialDate}
        onClose={() => { arkmeUi.hideCalendar() }}
      />, document.body)}
      {!compact && !locked && <div className="arkme-redesign-rail-footer">
        {authState.auth?.status === 'authenticated' && <>
        {profileOpen && typeof document !== 'undefined' && createPortal(<div
          ref={profilePopoverRef}
          className="arkme-redesign-profile-popover"
          data-arkme-notification-blocking-overlay="true"
          role="dialog"
          aria-label={tr("个人菜单")}
        >
          <div className="arkme-profile-identity-row">
            <button type="button" className="arkme-redesign-profile-head" aria-label={tr("我的账户")} onClick={() => { setProfileOpen(false); arkmeUi.openDshSettings('arkme-account') }}>
              <ArkmeUserAvatar {...(profile?.avatarRef ? { avatarRef: profile.avatarRef } : {})} size={40} label={tr("当前用户头像")} />
              <span className="arkme-profile-identity-copy"><strong><span>{profile?.displayName || profile?.nickname || tr("Arkme 用户")}</span><CaretRight size={14} aria-hidden /></strong><small>{profile?.arkmeId ? `@${profile.arkmeId}` : tr('Arkme 账号')}</small></span>
            </button>
            <button type="button" className="arkme-profile-world-entry" onClick={() => { setProfileOpen(false); arkmeUi.showWorld('mine') }}>{tr("我的世界")}<CaretRight size={13} aria-hidden /></button>
          </div>
          <button type="button" className="arkme-member-entry" aria-label={tr("查看会员权益")} onClick={() => { setProfileOpen(false); setMembershipOpenScope(memberScope) }}>
            <span><strong>{membershipLabel(membership.state)}</strong><small>{membershipDescription(membership.state)}</small></span>
            <span>{tr(membership.state.status === 'ready' && membership.state.value.memberType === 0 ? '升级会员' : '查看权益')} ›</span>
          </button>
          {memberScope && <ArkmeAccountUsage key={memberScope} accountScope={memberScope} onOpenDetails={() => { setProfileOpen(false); arkmeUi.openDshSettings('arkme-usage') }} />}
          <div className="arkme-redesign-profile-menu">
            <button data-arkme-feedback="neutral" type="button" onClick={() => { setProfileOpen(false); arkmeUi.openDshSettings('arkme-data') }}><Database size={19} /><span><strong>{tr("数据管理")}</strong></span><CaretRight size={15} /></button>
            <button data-arkme-feedback="neutral" type="button" onClick={() => { setProfileOpen(false); arkmeUi.openDshSettings() }}><GearSix size={19} /><span><strong>{tr("设置")}</strong></span><CaretRight size={15} /></button>
          </div>
        </div>, document.body)}
        <button ref={profileTriggerRef} type="button" className={`arkme-redesign-profile${profileOpen ? ' is-active' : ''}`} aria-label={tr("个人资料")}
          aria-describedby={navigationHint.describedBy('profile')}
          onMouseEnter={event => { if (!profileOpen) navigationHint.show(event.currentTarget, 'profile', profileHint) }}
          onMouseLeave={navigationHint.hide}
          onFocus={event => { if (!profileOpen) navigationHint.show(event.currentTarget, 'profile', profileHint, true) }}
          onBlur={navigationHint.hide}
          onClick={() => { navigationHint.hide(); setProfileOpen(value => !value) }}>
          <span className="arkme-member-label" data-tier={membership.state.status === 'ready' ? membership.state.value.memberType : undefined}>{membershipLabel(membership.state)}</span>
          <ArkmeUserAvatar {...(profile?.avatarRef ? { avatarRef: profile.avatarRef } : {})} size={ARKME_PROFILE_AVATAR_SIZE} label={tr("当前用户头像")} />
        </button>
        {memberScope && memberUserId !== undefined && membershipOpenScope === memberScope && <ArkmeMembershipDialog key={memberScope} userId={memberUserId} state={membership.state} onRefresh={membership.refresh} returnFocusRef={profileTriggerRef} onClose={() => { setMembershipOpenScope(undefined) }} />}
        </>}
      </div>}
    </nav>
}
