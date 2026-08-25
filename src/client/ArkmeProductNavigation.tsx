import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ChatCircleText } from '@phosphor-icons/react/dist/icons/ChatCircleText'
import { CalendarBlank } from '@phosphor-icons/react/dist/icons/CalendarBlank'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { PuzzlePiece } from '@phosphor-icons/react/dist/icons/PuzzlePiece'
import { PhoneCall } from '@phosphor-icons/react/dist/icons/PhoneCall'
import { Waveform } from '@phosphor-icons/react/dist/icons/Waveform'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { Fingerprint } from '@phosphor-icons/react/dist/icons/Fingerprint'
import { GearSix } from '@phosphor-icons/react/dist/icons/GearSix'
import { GlobeHemisphereWest } from '@phosphor-icons/react/dist/icons/GlobeHemisphereWest'
import { UserCircle } from '@phosphor-icons/react/dist/icons/UserCircle'
import { AddressBook } from '@phosphor-icons/react/dist/icons/AddressBook'
import type { Icon } from '@phosphor-icons/react/lib'
import type { ArkmeUserProfile, ArkmeUserProfileSnapshot } from '../types.js'
import pluginManifest from '../../package.json' with { type: 'json' }
import arkmeNavigationLogoBase64 from '../../assets/branding/arkme-navigation-logo.png'
import arkmeNavigationLogoDarkBase64 from '../../assets/branding/arkme-navigation-logo-dark.png'
import { callArkme } from './api.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmeCalendarSurface } from './ArkmeCalendarSurface.js'
import { ArkmeUpdateRailSlot } from './ArkmeUpdateSurfaces.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmePluginUpdateStore } from './plugin-update-store.js'
import { arkmeUi } from './ui-controller.js'

export interface ArkmeProductNavigationProps {
  compact: boolean
  hosted?: boolean
  taskExpanded?: boolean
  currentSessionId?: string | undefined
}

type NavigationItem = {
  id: 'conversations' | 'contacts' | 'calls' | 'recordings' | 'search' | 'calendar' | 'world' | 'extensions'
  label: string
  icon: Icon
}

const items: NavigationItem[] = [
  { id: 'conversations', label: '对话', icon: ChatCircleText },
  { id: 'contacts', label: '联系人', icon: AddressBook },
  { id: 'calls', label: '通话', icon: PhoneCall },
  { id: 'recordings', label: '录音', icon: Waveform },
  { id: 'search', label: '搜索', icon: MagnifyingGlass },
  { id: 'calendar', label: '日历', icon: CalendarBlank },
  { id: 'world', label: '世界', icon: GlobeHemisphereWest },
  { id: 'extensions', label: '市集', icon: PuzzlePiece },
]

const styles: Record<string, CSSProperties> = {
  rail: {
    position: 'relative',
    width: 72,
    minWidth: 72,
    height: '100%',
    padding: '24px 8px 14px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 5,
    borderRight: '1px solid #e7e7e9',
    background: '#fff',
    color: '#3e4149',
  },
  compactRail: {
    width: '100%',
    minWidth: 0,
    height: 58,
    padding: '6px 10px',
    flexDirection: 'row',
    alignItems: 'center',
    borderRight: 0,
    borderBottom: '1px solid #e7e7e9',
  },
  hostedRail: {
    width: '100%', minWidth: 0, padding: '28px 4px 12px', borderRight: 0,
  },
  taskExpandedRail: { width: 72, minWidth: 72 },
  brand: {
    width: '100%', minHeight: 44, flex: 'none', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'flex-start', gap: 2,
    overflow: 'visible', borderRadius: 10, background: 'transparent',
  },
  brandImage: { display: 'block', width: 48, height: 28, objectFit: 'cover' },
  brandVersion: { color: '#a5a8af', fontSize: 10, lineHeight: '13px', whiteSpace: 'nowrap' },
  primary: { minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 5 },
  button: {
    position: 'relative',
    minHeight: 57,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    padding: '7px 4px',
    border: 0,
    borderRadius: 15,
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    font: 'inherit',
    boxShadow: 'none',
  },
  compactButton: { minHeight: 42, height: 42, flex: 1, flexDirection: 'row', gap: 6, padding: '0 8px', borderRadius: 12 },
  hostedButton: { minHeight: 52, padding: '6px 2px', borderRadius: 13 },
  activeButton: { background: '#f1f2f6', color: '#151722' },
  activeMarker: {
    position: 'absolute',
    left: -9,
    width: 3,
    height: 33,
    borderRadius: 3,
    background: '#9eadff',
  },
  compactMarker: { left: '50%', bottom: -6, width: 30, height: 3, transform: 'translateX(-50%)' },
  hostedMarker: { left: -5 },
  label: { fontSize: 11, lineHeight: '15px', whiteSpace: 'nowrap' },
}

/** Arkme-owned navigation rendered wholly inside the plugin surface. */
export function ArkmeProductNavigation({
  compact, hosted = false, taskExpanded = false, currentSessionId,
}: ArkmeProductNavigationProps) {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot, arkmeUi.getSnapshot)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const pluginUpdateState = useSyncExternalStore(
    arkmePluginUpdateStore.subscribe,
    arkmePluginUpdateStore.getSnapshot,
    arkmePluginUpdateStore.getSnapshot,
  )
  const [profileOpen, setProfileOpen] = useState(false)
  const [profile, setProfile] = useState<ArkmeUserProfile>()
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
  }, [authState.auth?.status, authState.auth?.status === 'authenticated' ? authState.auth.userId : undefined])
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
  const activeId = ui.mode === 'settings' || ui.mode === 'login' ? undefined
    : ui.calendarOpen === true ? 'calendar'
    : ui.mode === 'extensions' ? 'extensions'
    : ui.mode === 'world' ? 'world'
    : ui.mode === 'calls' ? 'calls'
    : ui.mode === 'recordings' ? 'recordings'
      : ui.mode === 'search' ? 'search'
        : ui.mode === 'source' && ui.productMode === 'contacts' ? 'contacts' : 'conversations'
  const pluginUpdate = pluginUpdateState.status
  const installedPluginVersion = pluginUpdate?.installedVersion ?? pluginManifest.version

  const activate = (id: NavigationItem['id']) => {
    if (id === 'extensions') {
      arkmeUi.showExtensions()
      return
    }
    if (id === 'contacts') arkmeUi.showContacts()
    else if (id === 'calls') arkmeUi.showCalls()
    else if (id === 'recordings') arkmeUi.showRecordings()
    else if (id === 'world') arkmeUi.showWorld()
    else if (id === 'calendar') arkmeUi.showCalendar()
    else if (id === 'search') arkmeUi.showSearch()
    else arkmeUi.showConversations()
  }

  return <nav
      data-arkme-owned="product-navigation"
      aria-label="Arkme 功能导航"
      style={{
        ...styles.rail,
        ...(compact ? styles.compactRail : {}),
        ...(hosted ? styles.hostedRail : {}),
        ...(taskExpanded ? styles.taskExpandedRail : {}),
      }}
    >
      {!compact && <div data-arkme-owned="product-brand" style={styles.brand}>
        <img
          src={`data:image/png;base64,${arkmeNavigationLogoBase64}`}
          alt="Arkme"
          data-arkme-theme-image="light"
          draggable={false}
          style={styles.brandImage}
        />
        <img
          src={`data:image/png;base64,${arkmeNavigationLogoDarkBase64}`}
          alt="Arkme"
          data-arkme-theme-image="dark"
          draggable={false}
          style={styles.brandImage}
        />
        <span data-arkme-plugin-version={installedPluginVersion} style={styles.brandVersion}>
          v{installedPluginVersion}
        </span>
      </div>}
      <div style={{ ...styles.primary, ...(compact ? { flexDirection: 'row' as const } : {}) }}>
      {items.map(item => {
        const ItemIcon = item.icon
        const active = item.id === activeId
        return <button
          key={item.id}
          type="button"
          aria-current={active ? 'page' : undefined}
          style={{
            ...styles.button,
            ...(compact ? styles.compactButton : {}),
            ...(hosted ? styles.hostedButton : {}),
            ...(active ? styles.activeButton : {}),
          }}
          onClick={() => { activate(item.id) }}
        >
          {active && <span aria-hidden style={{
            ...styles.activeMarker,
            ...(compact ? styles.compactMarker : {}),
            ...(hosted ? styles.hostedMarker : {}),
          }} />}
          <ItemIcon size={22} weight="regular" aria-hidden />
          <span style={styles.label}>{item.label}</span>
        </button>
      })}
      </div>
      {ui.calendarOpen === true && typeof document !== 'undefined' && createPortal(<ArkmeCalendarSurface
        anchor="product-rail"
        onClose={() => { arkmeUi.hideCalendar() }}
      />, document.body)}
      {!compact && <div className="arkme-redesign-rail-footer">
        <ArkmeUpdateRailSlot />
        {authState.auth?.status === 'authenticated' && <>
        {profileOpen && typeof document !== 'undefined' && createPortal(<div ref={profilePopoverRef} className="arkme-redesign-profile-popover" role="menu" aria-label="个人菜单">
          <div className="arkme-redesign-profile-head">
            <ArkmeUserAvatar {...(profile?.avatarRef ? { avatarRef: profile.avatarRef } : {})} size={40} label="当前用户头像" />
            <span><strong>{profile?.displayName || profile?.nickname || 'Arkme 用户'}</strong><small>{profile?.arkmeId ? `@${profile.arkmeId}` : 'Arkme 账号'}</small></span>
          </div>
          <div className="arkme-redesign-profile-menu">
            <button type="button" role="menuitem" onClick={() => { setProfileOpen(false); arkmeUi.showWorld() }}><GlobeHemisphereWest size={19} /><span><strong>我的世界</strong><small>管理你的个人内容</small></span><CaretRight size={15} /></button>
            <button type="button" role="menuitem" onClick={() => { setProfileOpen(false); arkmeUi.showVoiceprint() }}><Fingerprint size={19} /><span><strong>声纹管理</strong><small>设置声音识别</small></span><CaretRight size={15} /></button>
            <button type="button" role="menuitem" onClick={() => { setProfileOpen(false); arkmeUi.showSettings() }}><UserCircle size={19} /><span><strong>我的账户</strong><small>个人资料与登录安全</small></span><CaretRight size={15} /></button>
            <button type="button" role="menuitem" onClick={() => { setProfileOpen(false); arkmeUi.openDshSettings() }}><GearSix size={19} /><span><strong>设置</strong><small>打开 DSH 应用设置</small></span><CaretRight size={15} /></button>
          </div>
        </div>, document.body)}
        <button ref={profileTriggerRef} type="button" className={`arkme-redesign-profile${profileOpen ? ' is-active' : ''}`} aria-label="个人资料" onClick={() => { setProfileOpen(value => !value) }}>
          <ArkmeUserAvatar {...(profile?.avatarRef ? { avatarRef: profile.avatarRef } : {})} size={32} label="当前用户头像" />
        </button>
        </>}
      </div>}
    </nav>
}
