import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { GearSix } from '@phosphor-icons/react/dist/icons/GearSix'
import { Info } from '@phosphor-icons/react/dist/icons/Info'
import { UserCircle } from '@phosphor-icons/react/dist/icons/UserCircle'
import type { ArkmeUserProfile, ArkmeUserProfileSnapshot } from '../types.js'
import { callArkme } from './api.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { arkmeUi } from './ui-controller.js'

const styles: Record<string, CSSProperties> = {
  anchor: { position: 'relative', marginTop: 'auto', display: 'flex', justifyContent: 'center' },
  compactAnchor: { marginTop: 0, marginLeft: 'auto' },
  trigger: {
    width: 42, height: 42, display: 'grid', placeItems: 'center', padding: 0,
    border: 0, borderRadius: 14, background: 'transparent', cursor: 'pointer', font: 'inherit',
  },
  triggerActive: { background: '#f1f2f6' },
  menu: {
    position: 'absolute', zIndex: 80, left: 52, bottom: 0, width: 264, padding: 10,
    boxSizing: 'border-box', border: '1px solid #e3e4e8', borderRadius: 18,
    background: 'rgba(255,255,255,.98)', color: '#1a1c21',
    boxShadow: '0 20px 56px rgba(30,34,43,.16), 0 2px 8px rgba(30,34,43,.08)',
    WebkitBackdropFilter: 'blur(18px)', backdropFilter: 'blur(18px)',
  },
  compactMenu: { left: 'auto', right: 0, bottom: 52 },
  profile: { display: 'flex', alignItems: 'center', gap: 11, minWidth: 0, padding: '6px 7px 12px' },
  profileText: { minWidth: 0, flex: 1 },
  name: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, lineHeight: '20px', fontWeight: 650 },
  id: { marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#858a94', fontSize: 11, lineHeight: '16px' },
  divider: { height: 1, margin: '0 4px 6px', background: '#ececef' },
  item: {
    width: '100%', minHeight: 50, display: 'grid', gridTemplateColumns: '28px minmax(0,1fr) 16px',
    alignItems: 'center', gap: 9, padding: '6px 8px', border: 0, borderRadius: 12,
    background: 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'left', font: 'inherit',
  },
  itemIcon: { display: 'grid', placeItems: 'center', color: '#6f747e' },
  itemCopy: { minWidth: 0 },
  itemTitle: { display: 'block', fontSize: 13, lineHeight: '18px', fontWeight: 550 },
  itemDescription: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#9297a0', fontSize: 10, lineHeight: '15px' },
  caret: { color: '#a8acb4' },
}

function AccountMenuItem({
  title, description, icon, onClick,
}: { title: string; description: string; icon: React.ReactNode; onClick(): void }) {
  return <button
    type="button" style={styles.item} onClick={onClick}
    onMouseEnter={event => { event.currentTarget.style.background = '#f4f4f6' }}
    onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}
  >
    <span style={styles.itemIcon}>{icon}</span>
    <span style={styles.itemCopy}>
      <span style={styles.itemTitle}>{title}</span>
      <span style={styles.itemDescription}>{description}</span>
    </span>
    <CaretRight size={14} style={styles.caret} aria-hidden />
  </button>
}

export function ArkmeAccountMenu({ compact }: { compact: boolean }) {
  const [open, setOpen] = useState(false)
  const [profile, setProfile] = useState<ArkmeUserProfile>()
  const anchorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    void callArkme<ArkmeUserProfileSnapshot>('user.profile')
      .then(async snapshot => snapshot.profile === null
        ? await callArkme<ArkmeUserProfileSnapshot>('user.profile.refresh')
        : snapshot)
      .then(snapshot => { if (active && snapshot.profile !== null) setProfile(snapshot.profile) })
      .catch(() => undefined)
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && anchorRef.current?.contains(event.target) !== true) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const show = (section: 'account' | 'general' | 'about') => {
    setOpen(false)
    arkmeUi.showSettings(section)
  }
  const displayName = profile?.displayName.trim() || profile?.nickname.trim() || '我的账户'
  const arkmeId = profile?.arkmeId.trim() || '加载账户信息中…'

  return <div ref={anchorRef} style={{ ...styles.anchor, ...(compact ? styles.compactAnchor : {}) }}>
    <button
      type="button" style={{ ...styles.trigger, ...(open ? styles.triggerActive : {}) }}
      aria-label="账户菜单" aria-haspopup="menu" aria-expanded={open}
      onClick={() => { setOpen(value => !value) }}
    >
      <ArkmeUserAvatar {...(profile?.avatarRef ? { avatarRef: profile.avatarRef } : {})} size={32} label="当前用户头像" />
    </button>
    {open && <div role="menu" aria-label="Arkme 账户菜单" style={{ ...styles.menu, ...(compact ? styles.compactMenu : {}) }}>
      <div style={styles.profile}>
        <ArkmeUserAvatar {...(profile?.avatarRef ? { avatarRef: profile.avatarRef } : {})} size={44} label="当前用户头像" />
        <div style={styles.profileText}>
          <div style={styles.name}>{displayName}</div>
          <div style={styles.id}>Arkme ID {arkmeId}</div>
        </div>
      </div>
      <div style={styles.divider} />
      <AccountMenuItem title="账户" description="个人资料与登录安全" icon={<UserCircle size={19} aria-hidden />} onClick={() => { show('account') }} />
      <AccountMenuItem title="设置" description="通用偏好与 Arkme 权限" icon={<GearSix size={19} aria-hidden />} onClick={() => { show('general') }} />
      <AccountMenuItem title="关于" description="版本、协议与隐私" icon={<Info size={19} aria-hidden />} onClick={() => { show('about') }} />
    </div>}
  </div>
}
