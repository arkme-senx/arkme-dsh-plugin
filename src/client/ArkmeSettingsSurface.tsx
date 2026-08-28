import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import { CaretRight } from '@phosphor-icons/react/CaretRight'
import { CircleNotch } from '@phosphor-icons/react/CircleNotch'
import { Copy } from '@phosphor-icons/react/Copy'
import { IdentificationCard } from '@phosphor-icons/react/IdentificationCard'
import { Phone } from '@phosphor-icons/react/Phone'
import { WarningCircle } from '@phosphor-icons/react/WarningCircle'
import { WechatLogo } from '@phosphor-icons/react/WechatLogo'
import { X } from '@phosphor-icons/react/X'
import qrcode from 'qrcode-generator'
import type {
  ArkmeAuthSnapshot,
  ArkmeClientConfig,
  ArkmeIdAvailabilitySnapshot,
  ArkmeIdMutationResult,
  ArkmePluginUpdateStatus,
  ArkmeUserProfile,
  ArkmeUserProfileSnapshot,
} from '../types.js'
import { callArkme } from './api.js'
import { ArkmeBillingSettings } from './ArkmeBillingSettings.js'
import { arkmeAppUpdateStore, type ArkmeAppUpdateSnapshot } from './app-update-store.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeDesktopNotifications } from './desktop-notification-runtime.js'
import { clearLastNavigationCache } from './navigation-cache.js'
import { arkmePluginUpdateStore, type ArkmePluginUpdateStoreSnapshot } from './plugin-update-store.js'
import { derivePluginUpdateItem } from './update-presentation.js'
import { arkmeUi } from './ui-controller.js'
import { arkmeUpdateUi } from './update-ui-controller.js'
import { verifyPhoneCaptcha } from './geetest.js'

interface SettingsRowProps {
  title: string
  description: string
  href?: string
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
}

function SettingsRow({ title, description, href, onClick, danger = false, disabled = false }: SettingsRowProps) {
  const interactive = href !== undefined || onClick !== undefined
  const body: ReactNode = <>
    <strong className={danger ? 'is-danger' : ''}>{title}</strong>
    <span className="arkme-redesign-setting-summary">{description}</span>
    {interactive ? <CaretRight size={15} aria-hidden /> : <span className="arkme-redesign-trailing-slot" aria-hidden />}
  </>

  if (href !== undefined) {
    return <a className="arkme-redesign-setting-row" href={href} target="_blank" rel="noreferrer">{body}</a>
  }
  if (onClick !== undefined) {
    return <button type="button" className="arkme-redesign-setting-row" disabled={disabled} onClick={onClick}>{body}</button>
  }
  return <div className="arkme-redesign-setting-row">{body}</div>
}

interface VersionSettingsRowProps {
  title: string
  version: string
  feedback?: string
  actionLabel?: '检查更新' | '检查中…' | '立即更新'
  disabled?: boolean
  loading?: boolean
  onAction?: () => void
}

export function VersionSettingsRow({
  title,
  version,
  feedback,
  actionLabel,
  disabled = false,
  loading = false,
  onAction,
}: VersionSettingsRowProps) {
  const hasAction = actionLabel !== undefined && onAction !== undefined
  return <div className={`arkme-redesign-setting-row arkme-redesign-version-row${hasAction ? '' : ' is-without-action'}`}>
    <span className="arkme-redesign-version-copy">
      <strong>{title}</strong>
      {feedback === undefined ? null : <small>{feedback}</small>}
    </span>
    {hasAction ?
      <span className="arkme-redesign-version-action-slot">
      <button
        type="button"
        className="arkme-redesign-update-button"
        aria-label={loading ? `正在检查 ${title}更新` : actionLabel === '检查更新' ? `检查 ${title}更新` : `${actionLabel}：${title}`}
        aria-busy={loading}
        disabled={disabled}
        onClick={onAction}
      >
        {loading ? <CircleNotch className="arkme-icon-spin" size={13} aria-hidden /> : null}
        {actionLabel}
      </button>
      </span> : null}
    <span className="arkme-redesign-version-value">{version}</span>
    <span className="arkme-redesign-trailing-slot" aria-hidden />
  </div>
}

function SettingsGroup({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return <section className="arkme-redesign-settings-group" {...(id === undefined ? {} : { id })}>
    <h2>{title}</h2>
    <div>{children}</div>
  </section>
}

interface AccountInfoRowProps {
  icon: ReactNode
  title: string
  value: string
  action?: string
  disabled?: boolean
  onClick?: (() => void) | undefined
}

function AccountInfoRow({ icon, title, value, action, disabled = false, onClick }: AccountInfoRowProps) {
  const content = <>
    <span className="arkme-account-info-icon" aria-hidden>{icon}</span>
    <span className="arkme-account-info-copy">
      <strong>{title}</strong>
      <small>{value}</small>
    </span>
    {action === undefined ? null : <span className="arkme-account-info-action">{action}</span>}
    {onClick === undefined ? <span className="arkme-redesign-trailing-slot" aria-hidden /> : <CaretRight size={15} aria-hidden />}
  </>
  if (onClick === undefined) return <div className="arkme-account-info-row">{content}</div>
  return <button type="button" className="arkme-account-info-row" disabled={disabled} onClick={onClick}>{content}</button>
}

function WorldShareQrIcon({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M2 16.9C2 15.5906 2 14.9359 2.29472 14.455C2.45963 14.1859 2.68589 13.9596 2.955 13.7947C3.43594 13.5 4.09063 13.5 5.4 13.5H6.5C8.38562 13.5 9.32843 13.5 9.91421 14.0858C10.5 14.6716 10.5 15.6144 10.5 17.5V18.6C10.5 19.9094 10.5 20.5641 10.2053 21.045C10.0404 21.3141 9.81411 21.5404 9.545 21.7053C9.06406 22 8.40937 22 7.1 22C5.13594 22 4.15391 22 3.4325 21.5579C3.02884 21.3106 2.68945 20.9712 2.44208 20.5675" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M22 7.1C22 8.40937 22 9.06406 21.7053 9.545C21.5404 9.81411 21.3141 10.0404 21.045 10.2053C20.5641 10.5 19.9094 10.5 18.6 10.5H17.5C15.6144 10.5 14.6716 10.5 14.0858 9.91421C13.5 9.32843 13.5 8.38562 13.5 6.5V5.4C13.5 4.09063 13.5 3.43594 13.7947 2.955C13.9596 2.68589 14.1859 2.45963 14.455 2.29472C14.9359 2 15.5906 2 16.9 2C18.8641 2 19.8461 2 20.5675 2.44208C20.9712 2.68945 21.3106 3.02884 21.5579 3.4325" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M16.5 6.25C16.5 5.73459 16.5 5.47689 16.6291 5.29493C16.6747 5.23072 16.7307 5.17466 16.7949 5.12911C16.9769 5 17.2346 5 17.75 5C18.2654 5 18.5231 5 18.7051 5.12911C18.7693 5.17466 18.8253 5.23072 18.8709 5.29493C19 5.47689 19 5.73459 19 6.25C19 6.76541 19 7.02311 18.8709 7.20507C18.8253 7.26928 18.7693 7.32534 18.7051 7.37089C18.5231 7.5 18.2654 7.5 17.75 7.5C17.2346 7.5 16.9769 7.5 16.7949 7.37089C16.7307 7.32534 16.6747 7.26928 16.6291 7.20507C16.5 7.02311 16.5 6.76541 16.5 6.25Z" fill="currentColor" />
    <path d="M12.75 22C12.75 22.4142 13.0858 22.75 13.5 22.75C13.9142 22.75 14.25 22.4142 14.25 22H12.75ZM14.3889 13.8371L14.8055 14.4607L14.3889 13.8371ZM13.8371 14.3889L13.2135 13.9722L13.8371 14.3889ZM19 12.75H17V14.25H19V12.75ZM12.75 19V22H14.25V19H12.75ZM17 12.75C16.3134 12.75 15.742 12.7491 15.281 12.796C14.8075 12.8441 14.3682 12.9489 13.9722 13.2135L14.8055 14.4607C14.914 14.3882 15.078 14.3244 15.4328 14.2883C15.8002 14.2509 16.2822 14.25 17 14.25V12.75ZM14.25 17C14.25 16.2822 14.2509 15.8002 14.2883 15.4328C14.3244 15.078 14.3882 14.914 14.4607 14.8055L13.2135 13.9722C12.9489 14.3682 12.8441 14.8075 12.796 15.281C12.7491 15.742 12.75 16.3134 12.75 17H14.25ZM13.9722 13.2135C13.6719 13.4141 13.4141 13.6719 13.2135 13.9722L14.4607 14.8055C14.5519 14.669 14.669 14.5519 14.8055 14.4607L13.9722 13.2135Z" fill="currentColor" />
    <path d="M22.75 13.5C22.75 13.0858 22.4142 12.75 22 12.75C21.5858 12.75 21.25 13.0858 21.25 13.5H22.75ZM20.7654 21.8478L21.0524 22.5407L20.7654 21.8478ZM21.8478 20.7654L21.1548 20.4784V20.4784L21.8478 20.7654ZM17 22.75H19V21.25H17V22.75ZM22.75 17V13.5H21.25V17H22.75ZM19 22.75C19.4557 22.75 19.835 22.7504 20.1454 22.7292C20.4625 22.7076 20.762 22.661 21.0524 22.5407L20.4784 21.1548C20.4012 21.1868 20.284 21.2163 20.0433 21.2327C19.7958 21.2496 19.4762 21.25 19 21.25V22.75ZM21.25 19C21.25 19.4762 21.2496 19.7958 21.2327 20.0433C21.2163 20.284 21.1868 20.4012 21.1548 20.4784L22.5407 21.0524C22.661 20.762 22.7076 20.4625 22.7292 20.1454C22.7504 19.835 22.75 19.4557 22.75 19H21.25ZM21.0524 22.5407C21.7262 22.2616 22.2616 21.7262 22.5407 21.0524L21.1548 20.4784C21.028 20.7846 20.7846 21.028 20.4784 21.1549L21.0524 22.5407Z" fill="currentColor" />
    <path d="M2 7.1C2 5.13594 2 4.15391 2.44208 3.4325C2.68945 3.02884 3.02884 2.68945 3.4325 2.44208C4.15391 2 5.13594 2 7.1 2C8.40937 2 9.06406 2 9.545 2.29472C9.81411 2.45963 10.0404 2.68589 10.2053 2.955C10.5 3.43594 10.5 4.09063 10.5 5.4V6.5C10.5 8.38562 10.5 9.32843 9.91421 9.91421C9.32843 10.5 8.38562 10.5 6.5 10.5H5.4C4.09063 10.5 3.43594 10.5 2.955 10.2053C2.68589 10.0404 2.45963 9.81411 2.29472 9.545C2 9.06406 2 8.40937 2 7.1Z" stroke="currentColor" strokeWidth="1.5" />
    <path d="M5 6.25C5 5.73459 5 5.47689 5.12911 5.29493C5.17466 5.23072 5.23072 5.17466 5.29493 5.12911C5.47689 5 5.73459 5 6.25 5C6.76541 5 7.02311 5 7.20507 5.12911C7.26928 5.17466 7.32534 5.23072 7.37089 5.29493C7.5 5.47689 7.5 5.73459 7.5 6.25C7.5 6.76541 7.5 7.02311 7.37089 7.20507C7.32534 7.26928 7.26928 7.5 7.20507 7.5C7.02311 7.5 6.76541 7.5 6.25 7.5C5.73459 7.5 5.47689 7.5 5.29493 7.37089C5.23072 7.32534 5.17466 7.26928 5.12911 7.20507C5 7.02311 5 6.76541 5 6.25Z" fill="currentColor" />
    <path d="M5 17.75C5 17.2346 5 16.9769 5.12911 16.7949C5.17466 16.7307 5.23072 16.6747 5.29493 16.6291C5.47689 16.5 5.73459 16.5 6.25 16.5C6.76541 16.5 7.02311 16.5 7.20507 16.6291C7.26928 16.6747 7.32534 16.7307 7.37089 16.7949C7.5 16.9769 7.5 17.2346 7.5 17.75C7.5 18.2654 7.5 18.5231 7.37089 18.7051C7.32534 18.7693 7.26928 18.8253 7.20507 18.8709C7.02311 19 6.76541 19 6.25 19C5.73459 19 5.47689 19 5.29493 18.8709C5.23072 18.8253 5.17466 18.7693 5.12911 18.7051C5 18.5231 5 18.2654 5 17.75Z" fill="currentColor" />
    <path d="M16 17.75C16 17.0478 16 16.6967 16.1685 16.4444C16.2415 16.3352 16.3352 16.2415 16.4444 16.1685C16.6967 16 17.0478 16 17.75 16C18.4522 16 18.8033 16 19.0556 16.1685C19.1648 16.2415 19.2585 16.3352 19.3315 16.4444C19.5 16.6967 19.5 17.0478 19.5 17.75C19.5 18.4522 19.5 18.8033 19.3315 19.0556C19.2585 19.1648 19.1648 19.2585 19.0556 19.3315C18.8033 19.5 18.4522 19.5 17.75 19.5C17.0478 19.5 16.6967 19.5 16.4444 19.3315C16.3352 19.2585 16.2415 19.1648 16.1685 19.0556C16 18.8033 16 18.4522 16 17.75Z" fill="currentColor" />
  </svg>
}

function normalizedWorldShareBase(shareWebsite: string | undefined): string {
  const raw = shareWebsite?.trim() || 'https://jiwo.cc'
  try {
    const url = new URL(raw)
    return `${url.protocol}//${url.host}`
  } catch {
    return 'https://jiwo.cc'
  }
}

export function buildProfileShareUrl(shareWebsite: string | undefined, arkmeId: string): string {
  const id = arkmeId.trim()
  const base = normalizedWorldShareBase(shareWebsite)
  return id === '' ? base : `${base}/${encodeURIComponent(id)}`
}

export function profileQrDataUrlFromShareUrl(shareUrl: string): string {
  const code = qrcode(0, 'M')
  code.addData(shareUrl)
  code.make()
  return code.createDataURL(5, 8)
}

function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText !== undefined) return navigator.clipboard.writeText(value)
  return Promise.reject(new Error('clipboard unavailable'))
}

function localArkmeIdValidation(text: string, minLength: number): string | undefined {
  const value = text.trim()
  if (value === '') return undefined
  if (!/^[A-Za-z]/.test(value)) return '即我号不能以数字或符号开头'
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return '即我号仅支持字母、数字、下划线或减号'
  const length = [...value].length
  if (length < minLength || length > 20) return minLength === 5 ? '即我号需要5-20个字符' : '即我号需要6-20个字符'
  return undefined
}

function arkmeIdAvailabilityText(availability: ArkmeIdAvailabilitySnapshot | undefined): string {
  if (availability === undefined) return ''
  if (availability.available) return '✅ 当前即我号可设置'
  switch (availability.reason) {
    case 'modify_limited': return '❌ 即我号仅可设置一次'
    case 'invalid': return '❌ 即我号格式不正确'
    case 'taken': return '❌ 该即我号已被占用'
    default: return '服务器繁忙，请稍后重试'
  }
}

function SettingsDialog({
  title,
  children,
  onClose,
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  return <div className="arkme-account-dialog-backdrop" role="presentation" onClick={onClose}>
    <section className="arkme-account-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={event => { event.stopPropagation() }}>
      <header>
        <h3>{title}</h3>
        <button type="button" aria-label="关闭" onClick={onClose}><X size={20} aria-hidden /></button>
      </header>
      {children}
    </section>
  </div>
}

function ProfileQrDialog({
  profile,
  shareWebsite,
  onClose,
}: {
  profile: ArkmeUserProfile
  shareWebsite: string | undefined
  onClose: () => void
}) {
  const shareUrl = buildProfileShareUrl(shareWebsite, profile.arkmeId)
  const [status, setStatus] = useState('')
  const qrDataUrl = useMemo(() => profileQrDataUrlFromShareUrl(shareUrl), [shareUrl])
  return <SettingsDialog title="我的二维码" onClose={onClose}>
    <div className="arkme-account-qr-card">
      <ArkmeUserAvatar {...(profile.avatarRef ? { avatarRef: profile.avatarRef } : {})} size={52} label="当前用户头像" />
      <strong>{profile.displayName || '即我用户'}</strong>
      <span>即我号：{profile.arkmeId || '-'}</span>
      <img src={qrDataUrl} alt="我的即我二维码" />
      <small>扫描二维码，进入我的世界</small>
    </div>
    <div className="arkme-account-dialog-actions">
      <button type="button" onClick={() => {
        void copyText(shareUrl).then(() => { setStatus('链接已复制') }).catch(() => { setStatus('复制失败，请稍后重试') })
      }}><Copy size={16} aria-hidden />复制链接</button>
    </div>
    {status !== '' ? <p className="arkme-account-dialog-status" role="status">{status}</p> : null}
  </SettingsDialog>
}

function ArkmeIdDialog({
  profile,
  onClose,
  onUpdated,
}: {
  profile: ArkmeUserProfile
  onClose: () => void
  onUpdated: (snapshot: ArkmeUserProfileSnapshot) => void
}) {
  const minLength = profile.accountType === 2 ? 5 : 6
  const [value, setValue] = useState(profile.arkmeId)
  const [availability, setAvailability] = useState<ArkmeIdAvailabilitySnapshot>()
  const [checking, setChecking] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const normalized = value.trim()
  const localError = localArkmeIdValidation(value, minLength)
  const canSubmit = !submitting && localError === undefined
    && (normalized === profile.arkmeId || availability?.available === true)

  useEffect(() => {
    setError('')
    setAvailability(undefined)
    if (normalized === '' || normalized === profile.arkmeId || localError !== undefined) {
      setChecking(false)
      return
    }
    let active = true
    setChecking(true)
    const timer = window.setTimeout(() => {
      void callArkme<ArkmeIdAvailabilitySnapshot>('user.arkme-id.check', { arkmeId: normalized })
        .then(result => { if (active) setAvailability(result) })
        .catch(caught => {
          if (active) setError(caught instanceof Error ? caught.message : String(caught))
        })
        .finally(() => { if (active) setChecking(false) })
    }, 600)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [localError, normalized, profile.arkmeId])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return
    if (normalized === profile.arkmeId) {
      onClose()
      return
    }
    if (!window.confirm('即我号仅可设置一次，创建成功后不可修改，是否继续？')) return
    setSubmitting(true)
    setError('')
    try {
      await callArkme<ArkmeIdMutationResult>('user.arkme-id.set', { arkmeId: normalized })
      const snapshot = await callArkme<ArkmeUserProfileSnapshot>('user.profile.refresh')
      onUpdated(snapshot)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSubmitting(false)
    }
  }

  const statusText = localError ?? (checking ? '加载中…' : arkmeIdAvailabilityText(availability))
  return <SettingsDialog title="设置即我号" onClose={onClose}>
    <form className="arkme-account-form" onSubmit={event => { void submit(event) }}>
      <label>
        <span>即我号</span>
        <input value={value} maxLength={20} autoFocus placeholder="请输入即我号" onChange={event => { setValue(event.target.value) }} />
      </label>
      <p className="arkme-account-rule">需字母开头 · 最少{minLength}位 · 暂仅可设置一次</p>
      {statusText !== '' ? <p className={`arkme-account-dialog-status${localError !== undefined || availability?.available === false || error !== '' ? ' is-error' : ''}`} role="status">{statusText}</p> : null}
      {error !== '' ? <p className="arkme-account-dialog-status is-error" role="alert">{error}</p> : null}
      <div className="arkme-account-dialog-actions">
        <button type="button" onClick={onClose}>取消</button>
        <button type="submit" disabled={!canSubmit}>{submitting ? <CircleNotch className="arkme-icon-spin" size={16} aria-hidden /> : null}确认创建</button>
      </div>
    </form>
  </SettingsDialog>
}

function PhoneBindDialog({
  config,
  profile,
  onClose,
  onUpdated,
}: {
  config: ArkmeClientConfig | undefined
  profile: ArkmeUserProfile
  onClose: () => void
  onUpdated: (snapshot: ArkmeUserProfileSnapshot, auth: ArkmeAuthSnapshot) => void
}) {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [phoneBusy, setPhoneBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [countdown, setCountdown] = useState(0)
  const phoneValid = /^1[3-9][0-9]{9}$/.test(phone.replace(/[\s-]/g, ''))
  const codeValid = /^[0-9]{6}$/.test(code.trim())
  const actionLabel = profile.contact.phoneMasked === undefined ? '绑定手机号' : '更换手机号'

  useEffect(() => {
    if (countdown <= 0) return
    const timer = window.setTimeout(() => { setCountdown(countdown - 1) }, 1000)
    return () => { window.clearTimeout(timer) }
  }, [countdown])

  const sendCode = async () => {
    if (!phoneValid) {
      setStatus('请输入正确的手机号')
      return
    }
    setPhoneBusy(true)
    setStatus('')
    try {
      const captcha = await verifyPhoneCaptcha(config?.captchaId ?? '', phone)
      await callArkme('auth.phone.send', { phone, captcha })
      setCountdown(60)
      setStatus('已发送验证码')
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setPhoneBusy(false)
    }
  }

  const verify = async (event: FormEvent) => {
    event.preventDefault()
    if (!phoneValid || !codeValid) {
      setStatus('请输入正确的手机号和验证码')
      return
    }
    setPhoneBusy(true)
    setStatus('')
    try {
      const auth = await callArkme<ArkmeAuthSnapshot>('auth.phone.verify', { phone, code })
      arkmeAuthStore.setAuth(auth)
      const snapshot = await callArkme<ArkmeUserProfileSnapshot>('user.profile.refresh')
      onUpdated(snapshot, auth)
      onClose()
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setPhoneBusy(false)
    }
  }

  return <SettingsDialog title={actionLabel} onClose={onClose}>
    <form className="arkme-account-form" onSubmit={event => { void verify(event) }}>
      {profile.contact.phoneMasked !== undefined ? <p className="arkme-account-rule">当前绑定的手机号码为 {profile.contact.phoneMasked}</p> : null}
      <label>
        <span>手机号</span>
        <input value={phone} autoFocus inputMode="tel" placeholder="请输入手机号" onChange={event => { setPhone(event.target.value) }} />
      </label>
      <label>
        <span>验证码</span>
        <span className="arkme-account-code-row">
          <input value={code} inputMode="numeric" maxLength={6} placeholder="请输入验证码" onChange={event => { setCode(event.target.value) }} />
          <button type="button" disabled={phoneBusy || !phoneValid || countdown > 0} onClick={() => { void sendCode() }}>
            {countdown > 0 ? `${countdown}s` : '发送验证码'}
          </button>
        </span>
      </label>
      {status !== '' ? <p className={`arkme-account-dialog-status${status.includes('失败') || status.includes('错误') || status.includes('请输入') || status.includes('已绑定') ? ' is-error' : ''}`} role="status">{status}</p> : null}
      <div className="arkme-account-dialog-actions">
        <button type="button" onClick={onClose}>取消</button>
        <button type="submit" disabled={phoneBusy || !phoneValid || !codeValid}>{phoneBusy ? <CircleNotch className="arkme-icon-spin" size={16} aria-hidden /> : null}{profile.contact.phoneMasked === undefined ? '绑 定' : '更 换'}</button>
      </div>
    </form>
  </SettingsDialog>
}

type OverflowYReader = (element: HTMLElement) => string

function browserOverflowY(element: HTMLElement): string {
  return typeof window === 'undefined' ? '' : window.getComputedStyle(element).overflowY
}

export function scrollArkmeSettingsSurface(
  surface: HTMLElement | null,
  readOverflowY: OverflowYReader = browserOverflowY,
): void {
  if (surface === null) return
  let scrollOwner = surface.parentElement
  while (scrollOwner !== null && !['auto', 'scroll', 'overlay'].includes(readOverflowY(scrollOwner))) {
    scrollOwner = scrollOwner.parentElement
  }
  const target = scrollOwner ?? surface
  target.scrollTop = 0
}

export interface ArkmePluginUpdateRow {
  label: string
  current: string
  latest: string
  action: 'check' | 'install' | 'busy' | 'view'
  feedback?: string
}

export interface ArkmeAppUpdateRow {
  label: string
  current: string
  latest: string
  action: 'check' | 'download' | 'open' | 'busy'
  feedback?: string
  downloadedFilePath?: string
}

function versionLabel(version: string | undefined): string {
  return `v${version?.trim() || '…'}`
}

interface ArkmeDesktopScope {
  readonly arkmeDesktop?: Readonly<{
    appVersion?: string
    harnessVersion?: string
    runtimeManaged?: boolean
  }>
}

export function desktopRuntimeManaged(
  scope: ArkmeDesktopScope = globalThis as unknown as ArkmeDesktopScope,
): boolean {
  return scope.arkmeDesktop?.runtimeManaged === true
}

export function aboutArkmeVersion(
  currentVersion: string | undefined,
  scope: ArkmeDesktopScope = globalThis as unknown as ArkmeDesktopScope,
): string {
  return versionLabel(scope.arkmeDesktop?.appVersion ?? currentVersion)
}

export function aboutHarnessVersion(
  scope: ArkmeDesktopScope = globalThis as unknown as ArkmeDesktopScope,
): string {
  return versionLabel(scope.arkmeDesktop?.harnessVersion)
}

export function updateVersionText(current: string, latest: string): string {
  if (current === 'v…') return '当前版本读取中…'
  if (latest === 'v…') return `当前 ${current}`
  return current === latest ? `当前 ${current} · 已是最新版本` : `当前 ${current} → 最新 ${latest}`
}

export function buildArkmeAppUpdateRow(input: {
  app?: Pick<ArkmeAppUpdateSnapshot, 'status' | 'currentVersion' | 'noUpdateAvailable' | 'latestVersion' | 'error' | 'downloadedFilePath'>
  appError?: string
}): ArkmeAppUpdateRow {
  const status = input.app?.status
  const unavailable = input.app === undefined && input.appError?.trim() !== undefined && input.appError.trim() !== ''
  const busy = status === 'checking' || status === 'downloading'
  const feedback = input.appError?.trim()
    ? `检查失败：${input.appError.trim()}`
    : status === 'checking'
      ? '正在检查更新…'
      : status === 'current'
        ? input.app?.noUpdateAvailable === true ? '已检查 · 暂无可用版本' : '已检查 · 当前已是最新版本'
        : status === 'available'
          ? '发现新版本，可以下载更新包'
          : status === 'downloading'
            ? '正在下载更新包'
            : status === 'downloaded'
              ? '下载完成，可打开所在文件夹定位安装包'
              : status === 'failed'
                ? `检查失败：${input.app?.error || '请稍后重试'}`
                : undefined
  return {
    label: 'APP',
    current: versionLabel(input.app?.currentVersion),
    latest: versionLabel(input.app?.latestVersion ?? input.app?.currentVersion),
    action: unavailable || busy ? 'busy' : status === 'downloaded' ? 'open' : status === 'available' ? 'download' : 'check',
    ...(feedback === undefined ? {} : { feedback }),
    ...(input.app?.downloadedFilePath === undefined ? {} : { downloadedFilePath: input.app.downloadedFilePath }),
  }
}

export function buildArkmePluginUpdateRow(input: {
  snapshot?: ArkmePluginUpdateStoreSnapshot
  plugin?: Pick<ArkmePluginUpdateStatus, 'availability' | 'installedVersion' | 'latestVersion' | 'checking' | 'checkFailed'>
  pluginBusy?: boolean
  pluginError?: string
  runtimeManaged?: boolean
}): ArkmePluginUpdateRow {
  if (input.runtimeManaged === true) {
    const current = versionLabel(input.snapshot?.status?.installedVersion ?? input.plugin?.installedVersion)
    return {
      label: '核心插件',
      current,
      latest: current,
      action: 'busy',
      feedback: '由 Arkme 桌面端统一管理',
    }
  }
  if (input.snapshot !== undefined) {
    const snapshot = input.snapshot
    const item = derivePluginUpdateItem(snapshot)
    if (item?.active || item?.uncertain || item?.failed) return {
      label: '核心插件', current: item.currentVersion, latest: item.latestVersion, action: 'view',
      feedback: item.uncertain ? `${item.checkingStatus ? '正在检查更新状态…' : '更新状态待确认'} · 查看状态`
        : item.failed ? '更新未完成 · 查看结果' : `${item.phaseMessage} · 查看进度`,
    }
    return buildArkmePluginUpdateRow({
      ...(snapshot.status === undefined ? {} : { plugin: { ...snapshot.status,
        ...(item === undefined && snapshot.install?.phase === 'succeeded' ? { availability: 'current' as const } : {}),
      } }),
      pluginBusy: snapshot.busy || snapshot.installStatusChecking === true,
      pluginError: snapshot.error,
    })
  }
  const pluginAvailable = input.plugin?.availability === 'available'
  const pluginBusy = input.pluginBusy === true || input.plugin?.checking === true
  const pluginFeedback = pluginBusy
    ? '正在检查更新…'
    : input.pluginError?.trim()
      ? `检查失败：${input.pluginError.trim()}`
      : input.plugin?.checkFailed === true
        ? '检查失败：请稍后重试'
        : input.plugin?.availability === 'current'
          ? '已检查 · 当前已是最新版本'
          : input.plugin?.availability === 'available'
            ? '发现新版本，可以立即更新'
            : undefined
  const row: ArkmePluginUpdateRow = {
    label: '核心插件',
    current: versionLabel(input.plugin?.installedVersion),
    latest: versionLabel(input.plugin?.latestVersion),
    action: pluginBusy ? 'busy' : pluginAvailable ? 'install' : 'check',
    ...(pluginFeedback === undefined ? {} : { feedback: pluginFeedback }),
  }
  return row
}

export function ArkmeSettingsSurface() {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const updateState = useSyncExternalStore(arkmePluginUpdateStore.subscribe, arkmePluginUpdateStore.getSnapshot, arkmePluginUpdateStore.getSnapshot)
  const appUpdateState = useSyncExternalStore(arkmeAppUpdateStore.subscribe, arkmeAppUpdateStore.getSnapshot, arkmeAppUpdateStore.getSnapshot)
  const [profile, setProfile] = useState<ArkmeUserProfile>()
  const [clientConfig, setClientConfig] = useState<ArkmeClientConfig>()
  const [logoutBusy, setLogoutBusy] = useState(false)
  const [notificationBusy, setNotificationBusy] = useState(false)
  const [error, setError] = useState('')
  const [accountFeedback, setAccountFeedback] = useState('')
  const [activeAccountDialog, setActiveAccountDialog] = useState<'qr' | 'arkme-id' | 'phone' | null>(null)
  const [notificationPermission, setNotificationPermission] = useState(() => arkmeDesktopNotifications.permission())

  const applyProfileSnapshot = useCallback((snapshot: ArkmeUserProfileSnapshot) => {
    if (snapshot.profile !== null) setProfile(snapshot.profile)
  }, [])

  const loadProfile = useCallback((signal?: AbortSignal) => {
    if (authState.auth?.status !== 'authenticated') {
      setProfile(undefined)
      setError('')
      return
    }
    setProfile(undefined)
    setError('')
    void callArkme<ArkmeUserProfileSnapshot>('user.profile', undefined, signal)
      .then(async snapshot => snapshot.profile === null
        ? await callArkme<ArkmeUserProfileSnapshot>('user.profile.refresh', undefined, signal)
        : snapshot)
      .then(snapshot => { if (!signal?.aborted) applyProfileSnapshot(snapshot) })
      .catch(caught => {
        if (!signal?.aborted) setError(caught instanceof Error ? caught.message : String(caught))
      })
  }, [applyProfileSnapshot, authState.auth])

  useEffect(() => {
    const controller = new AbortController()
    void callArkme<ArkmeClientConfig>('auth.config', undefined, controller.signal)
      .then(config => { if (!controller.signal.aborted) setClientConfig(config) })
      .catch(() => undefined)
    return () => { controller.abort() }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    loadProfile(controller.signal)
    return () => { controller.abort() }
  }, [loadProfile])

  useLayoutEffect(() => {
    scrollArkmeSettingsSurface(surfaceRef.current)
  }, [])

  const logout = async () => {
    setLogoutBusy(true)
    setError('')
    try {
      const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.logout')
      arkmeAuthStore.setAuth(snapshot)
      clearLastNavigationCache()
      arkmeUi.authChanged(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLogoutBusy(false)
    }
  }

  const enableNotifications = async () => {
    setNotificationBusy(true)
    try {
      setNotificationPermission(await arkmeDesktopNotifications.requestPermission())
    } finally {
      setNotificationBusy(false)
    }
  }

  const authenticated = authState.auth?.status === 'authenticated'
  const bindingRequired = authState.auth?.status === 'binding-required'
  const displayName = authenticated
    ? profile?.displayName.trim() || profile?.nickname.trim() || '我的账户'
    : bindingRequired ? '待完成登录' : authState.checked ? '当前未登录' : '我的账户'
  const accountDescription = authenticated
    ? profile?.arkmeId ? `即我号 ${profile.arkmeId}` : '即我号读取中…'
    : bindingRequired ? '请完成手机号绑定' : authState.checked ? '登录后显示账户信息' : '正在读取账户状态…'
  const notificationLabel = notificationPermission === 'granted'
    ? '已开启'
    : notificationPermission === 'denied' ? '已阻止' : notificationPermission === 'default' ? '未开启' : '不可用'
  const harnessVersion = aboutHarnessVersion()
  const appUpdateRow = buildArkmeAppUpdateRow({
    ...(appUpdateState.status === undefined ? {} : { app: appUpdateState.status }),
    ...(appUpdateState.error === '' ? {} : { appError: appUpdateState.error }),
  })
  const pluginUpdateRow = buildArkmePluginUpdateRow({
    snapshot: updateState,
    runtimeManaged: desktopRuntimeManaged(),
  })

  const runPluginUpdateAction = (row: ArkmePluginUpdateRow) => {
    if (row.action === 'busy') return
    if (row.action === 'install' || row.action === 'view') arkmeUpdateUi.open('plugin')
    else void arkmePluginUpdateStore.checkInstallStatus()
  }

  const runAppUpdateAction = (row: ArkmeAppUpdateRow) => {
    if (row.action === 'busy') return
    if (row.action === 'download') arkmeUpdateUi.open('app')
    else if (row.action === 'open') void arkmeAppUpdateStore.showDownloadedFile()
    else void arkmeAppUpdateStore.refresh(true)
  }

  const currentArkmeId = profile?.arkmeId.trim() ?? ''
  const phoneMasked = profile?.contact.phoneMasked
  const wechatName = profile?.bindingNames?.wechat?.trim()
  const accountActionUnavailable = (message: string) => {
    setAccountFeedback(message)
    window.setTimeout(() => {
      setAccountFeedback(current => current === message ? '' : current)
    }, 3600)
  }

  return <div ref={surfaceRef} className="arkme-redesign-settings-surface" data-arkme-settings-surface aria-label="Arkme 设置">
    <div className="arkme-redesign-settings-shell">
      <div className="arkme-redesign-settings-profile">
        <ArkmeUserAvatar {...(profile?.avatarRef ? { avatarRef: profile.avatarRef } : {})} size={56} label="当前用户头像" />
        <div>
          <h1>{displayName}</h1>
          <p>
            <span>{accountDescription}</span>
            {authenticated ? <button
              type="button"
              className="arkme-account-profile-qr"
              aria-label="查看我的二维码"
              disabled={profile === undefined || currentArkmeId === ''}
              onClick={() => { setActiveAccountDialog('qr'); setAccountFeedback('') }}
            >
              <WorldShareQrIcon />
            </button> : null}
          </p>
        </div>
      </div>

      {!authenticated && <SettingsGroup title="账户">
        <SettingsRow
          title={bindingRequired ? '待完成登录' : authState.checked ? '当前未登录' : '正在读取登录状态…'}
          description={bindingRequired ? '完成手机号绑定后即可登录' : '登录 Arkme 后可管理账户'}
        />
      </SettingsGroup>}

      {authenticated && <SettingsGroup title="账户">
        <ArkmeBillingSettings />
      </SettingsGroup>}

      {authenticated && <SettingsGroup title="账号信息">
        <AccountInfoRow
          icon={<IdentificationCard size={18} />}
          title="即我号"
          value={currentArkmeId === '' ? '暂未获取到即我号' : currentArkmeId}
          action={profile?.canUpdateArkmeId === false ? '不可修改' : '修改'}
          disabled={profile === undefined || profile.canUpdateArkmeId === false}
          onClick={profile !== undefined && profile.canUpdateArkmeId !== false ? () => { setActiveAccountDialog('arkme-id'); setAccountFeedback('') } : undefined}
        />
        <AccountInfoRow
          icon={<Phone size={18} />}
          title="手机号"
          value={phoneMasked ?? '未绑定'}
          action={phoneMasked === undefined ? '绑定' : '换绑'}
          disabled={profile === undefined}
          onClick={profile !== undefined ? () => { setActiveAccountDialog('phone'); setAccountFeedback('') } : undefined}
        />
        <AccountInfoRow
          icon={<WechatLogo size={18} />}
          title="微信"
          value={profile?.bindings?.wechat === true ? (wechatName || '已绑定') : '未绑定'}
          action={profile?.bindings?.wechat === true ? '换绑' : '绑定'}
          disabled={profile === undefined}
          onClick={profile !== undefined ? () => {
            accountActionUnavailable('Flutter 客户端通过本机微信授权完成微信绑定；当前 DSH 插件暂不具备微信 AppBridge，不能在插件内换绑。')
          } : undefined}
        />
        {accountFeedback !== '' ? <p className="arkme-account-feedback" role="status"><WarningCircle size={14} aria-hidden />{accountFeedback}</p> : null}
      </SettingsGroup>}

      <SettingsGroup title="通用">
        <SettingsRow
          title="通知"
          description={notificationLabel}
          disabled={notificationBusy}
          {...(notificationPermission === 'default' ? { onClick: () => { void enableNotifications() } } : {})}
        />
      </SettingsGroup>

      <SettingsGroup title="更新" id="arkme-settings-about">
        <SettingsRow
          title="ArkME 客户端"
          description={`${updateVersionText(appUpdateRow.current, appUpdateRow.latest)} · ${appUpdateRow.feedback ?? '尚未检查'}`
            + (appUpdateRow.downloadedFilePath === undefined ? '' : ` · ${appUpdateRow.downloadedFilePath}`)}
          disabled={appUpdateRow.action === 'busy'}
          {...(appUpdateRow.action === 'busy' ? {} : { onClick: () => { runAppUpdateAction(appUpdateRow) } })}
        />
        <SettingsRow
          title="ArkME 插件"
          description={`${updateVersionText(pluginUpdateRow.current, pluginUpdateRow.latest)} · ${pluginUpdateRow.feedback ?? '尚未检查'}`}
          disabled={pluginUpdateRow.action === 'busy'}
          {...(pluginUpdateRow.action === 'busy' ? {} : { onClick: () => { runPluginUpdateAction(pluginUpdateRow) } })}
        />
        <VersionSettingsRow title="DeepSeek Harness" version={harnessVersion} />
        <SettingsRow title="用户协议" description="查看 Arkme 用户协议" href="https://www.arkme.ai/article/user-aggrement-v1.html" />
        <SettingsRow title="隐私条款" description="查看 Arkme 隐私条款" href="https://www.arkme.ai/article/privacy-aggrement-v1.html" />
      </SettingsGroup>

      {authenticated && <SettingsGroup title="账户操作">
        <SettingsRow danger title={logoutBusy ? '正在退出…' : '退出登录'} description="退出当前 Arkme 账户" disabled={logoutBusy} onClick={() => { void logout() }} />
      </SettingsGroup>}

      {error !== '' && <div className="arkme-redesign-settings-error" role="alert">{error}</div>}
    </div>
    {activeAccountDialog === 'qr' && profile !== undefined
      ? <ProfileQrDialog profile={profile} shareWebsite={clientConfig?.shareWebsite} onClose={() => { setActiveAccountDialog(null) }} />
      : null}
    {activeAccountDialog === 'arkme-id' && profile !== undefined
      ? <ArkmeIdDialog profile={profile} onClose={() => { setActiveAccountDialog(null) }} onUpdated={applyProfileSnapshot} />
      : null}
    {activeAccountDialog === 'phone' && profile !== undefined
      ? <PhoneBindDialog
          config={clientConfig}
          profile={profile}
          onClose={() => { setActiveAccountDialog(null) }}
          onUpdated={(snapshot) => { applyProfileSnapshot(snapshot); arkmeUi.authChanged(true) }}
        />
      : null}
  </div>
}
