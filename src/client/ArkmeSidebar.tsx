import {
  Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties,
} from 'react'
import qrcode from 'qrcode-generator'
import type {
  ArkmeAuthSnapshot, ArkmeSourceReadResult, ArkmeSourceSendResult, ArkmeTimelineCursor,
  ArkmeTimelineItem, ArkmeTimelinePage, ArkmeUserProfileSnapshot,
} from '../types.js'
import { callArkme, ArkmeClientError } from './api.js'
import { verifyPhoneCaptcha } from './geetest.js'
import { loadArkmeImageDataUrl } from './ArkmeAvatar.js'
import { ArkmeMark } from './ArkmeFooterAction.js'
import { ArkmeLogin, type ArkmeLoginMode } from './ArkmeLogin.js'
import { ArkmePrivateCallMenu } from './ArkmePrivateCallMenu.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeChatTimelineDelta } from './chat-directory-store.js'
import { arkmeUi } from './ui-controller.js'

export interface ArkmeSurfaceProps {
  floating?: boolean
  initialAuth?: ArkmeAuthSnapshot | undefined
}

export type ArkmeAuthView = 'checking' | 'login' | 'content'
export type ArkmePhoneBindingGate = 'unknown' | 'checking' | 'ready' | 'required'

const colors = {
  panel: 'var(--dsw-alias-bg-base, #ffffff)',
  text: 'var(--dsw-alias-label-primary, #17191c)',
  secondary: 'var(--dsw-alias-label-secondary, #68707c)',
  border: 'var(--dsw-alias-border-l2, #e2e5e9)',
  danger: '#c2413b',
}

const styles: Record<string, CSSProperties> = {
  surface: { width: '100%', height: '100%', minWidth: 0, display: 'flex', background: colors.panel, color: colors.text },
  floatingSurface: { background: 'transparent' },
  panel: { width: '100%', height: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: {
    flex: 'none', height: 56, display: 'flex', alignItems: 'center', padding: '12px 64px 12px 20px',
    boxSizing: 'border-box', borderBottom: `1px solid ${colors.border}`, position: 'relative', gap: 2,
  },
  title: { margin: 0, padding: '4px 8px', fontSize: 14, lineHeight: '20px', fontWeight: 500 },
  body: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 32px 24px' },
  error: { padding: '10px 12px', borderRadius: 9, background: 'rgba(194,65,59,.1)', color: colors.danger, fontSize: 13 },
  records: { width: 'min(780px,100%)', listStyle: 'none', margin: '0 auto', padding: 0, display: 'flex', flexDirection: 'column', gap: 16 },
  date: { alignSelf: 'center', padding: '4px 9px', borderRadius: 999, color: '#9097a1', fontSize: 12, background: '#f6f7f9' },
  row: { width: '100%', display: 'flex' },
  rowMe: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  messageLine: { maxWidth: '88%', display: 'flex', alignItems: 'flex-start', gap: 9 },
  messageLineMe: { flexDirection: 'row-reverse' },
  messageBody: { minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 5 },
  messageBodyMe: { alignItems: 'flex-end' },
  messageAvatar: {
    width: 32, height: 32, flex: 'none', overflow: 'hidden', borderRadius: 999,
    display: 'grid', placeItems: 'center', background: 'transparent', color: '#737982', fontSize: 11, fontWeight: 600,
  },
  messageAvatarImage: { width: '100%', height: '100%', display: 'block', objectFit: 'cover' },
  sender: { color: colors.secondary, fontSize: 11 },
  bubble: { maxWidth: 560, padding: '10px 16px', borderRadius: 22, boxSizing: 'border-box' },
  bubbleMe: { background: 'var(--dsw-specific-bubble, #eef3ff)' },
  bubbleOther: { background: 'var(--dsw-alias-bg-subtle, #f0f2f5)' },
  text: { margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 16, lineHeight: '24px' },
  meta: { color: '#adb2b8', fontSize: 11 },
  sentinel: { width: '100%', height: 1 },
  loading: { textAlign: 'center', color: colors.secondary, fontSize: 12, padding: 6 },
  composer: { flex: 'none', display: 'flex', justifyContent: 'center', padding: '0 24px 15px 16px' },
  composerInner: {
    position: 'relative', width: 'min(780px,100%)', overflow: 'hidden', boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 10,
    border: '1px solid var(--dsw-alias-border-l2-darkmode-thin, rgba(0,0,0,.1))', borderRadius: 22,
    background: 'var(--dsw-specific-input-major, #fff)', boxShadow: 'var(--dsw-shadow-lv2, 0 4px 16px rgba(0,0,0,.08))',
  },
  textarea: {
    width: '100%', minHeight: 28, maxHeight: 336, resize: 'none', overflowY: 'auto',
    boxSizing: 'border-box', border: 0, outline: 0, padding: '4px 12px 0 16px',
    background: 'transparent', color: colors.text, boxShadow: 'none', appearance: 'none', WebkitAppearance: 'none',
    fontFamily: 'var(--dsw-font-family, inherit)', fontSize: 16, lineHeight: '24px',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere',
    caretColor: 'var(--dsw-alias-state-business-primary, #3964fe)',
  },
  tools: {
    display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minWidth: 0,
    padding: '2px 8px 6px',
  },
  send: {
    width: 34, height: 34, flex: 'none', display: 'grid', placeItems: 'center',
    border: 0, borderRadius: 999, background: 'var(--dsw-alias-button-info-fill, #3964fe)',
    color: '#fff', cursor: 'pointer', transform: 'translateY(-2px)', transition: 'background-color 100ms ease',
  },
  loginBody: { flex: 1, minHeight: 0, overflowY: 'auto' },
  authChecking: {
    flex: 1, minHeight: 0, display: 'grid', placeItems: 'center',
    color: colors.secondary, fontSize: 13,
  },
}

export function arkmeAuthView(
  auth: ArkmeAuthSnapshot | undefined,
  phoneBindingGate: ArkmePhoneBindingGate = 'ready',
): ArkmeAuthView {
  if (auth === undefined) return 'checking'
  if (auth.status === 'binding-required') return 'login'
  if (auth.status !== 'authenticated') return 'login'
  if (phoneBindingGate === 'ready') return 'content'
  if (phoneBindingGate === 'required') return 'login'
  return 'checking'
}

export function arkmeProfileHasBoundPhone(snapshot: ArkmeUserProfileSnapshot): boolean {
  return (snapshot.profile?.contact.phoneMasked?.trim() ?? '') !== ''
}

export function arkmeLoginNeedsPhoneBinding(
  auth: ArkmeAuthSnapshot | undefined,
  phoneBindingGate: ArkmePhoneBindingGate,
): boolean {
  return auth?.status === 'binding-required' || phoneBindingGate === 'required'
}

export function arkmeShouldBeginWechat(
  auth: ArkmeAuthSnapshot | undefined,
  authView: ArkmeAuthView,
  loginMode: ArkmeLoginMode,
  agreed: boolean,
  qr: string,
  qrRequestStarted: boolean,
): boolean {
  return authView === 'login'
    && auth !== undefined
    && ['logged-out', 'expired'].includes(auth.status)
    && loginMode === 'wechat'
    && agreed
    && qr === ''
    && !qrRequestStarted
}

function errorMessage(error: unknown): string {
  if (error instanceof ArkmeClientError) return error.body.message
  return error instanceof Error ? error.message : String(error)
}

function qrDataUrl(content: string): string {
  const qr = qrcode(0, 'M'); qr.addData(content); qr.make(); return qr.createDataURL(6, 12)
}

function initialPhoneBindingGate(auth: ArkmeAuthSnapshot | undefined): ArkmePhoneBindingGate {
  return auth?.status === 'binding-required' ? 'required' : 'unknown'
}

function dayKey(value: number): string {
  const date = new Date(value); return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function dayLabel(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(value))
}

function timeLabel(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

function mergeItems(current: ArkmeTimelineItem[], incoming: ArkmeTimelineItem[]): ArkmeTimelineItem[] {
  const map = new Map(current.map(item => [item.itemUid, item]))
  for (const item of incoming) map.set(item.itemUid, item)
  return [...map.values()].sort((a, b) => a.sendAtMillis - b.sendAtMillis || a.itemUid.localeCompare(b.itemUid))
}

function MessageAvatar({ item }: { item: ArkmeTimelineItem }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let active = true
    setSrc('')
    if (item.avatarRef === undefined) return () => { active = false }
    void loadArkmeImageDataUrl(item.avatarRef)
      .then(value => { if (active) setSrc(value) })
      .catch(() => undefined)
    return () => { active = false }
  }, [item.avatarRef])
  return <span style={styles.messageAvatar} aria-hidden>
    {src === '' ? <ArkmeMark size={32} /> : <img src={src} alt="" draggable={false} style={styles.messageAvatarImage} />}
  </span>
}

export function ArkmeSurface({ floating = false, initialAuth }: ArkmeSurfaceProps = {}) {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot)
  const authStoreSnapshot = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot)
  const chatDelta = useSyncExternalStore(arkmeChatTimelineDelta.subscribe, arkmeChatTimelineDelta.getSnapshot)
  const source = ui.mode === 'source' ? ui.selectedSource : undefined
  const bodyRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const auth = authStoreSnapshot.auth ?? initialAuth
  const [items, setItems] = useState<ArkmeTimelineItem[]>([])
  const [nextCursor, setNextCursor] = useState<ArkmeTimelineCursor>()
  const [hasMore, setHasMore] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitBusy, setSubmitBusy] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [error, setError] = useState(initialAuth?.status === 'binding-required' ? '请先绑定手机号，再继续使用 Arkme' : '')
  const [agreed, setAgreed] = useState(true)
  const [loginMode, setLoginMode] = useState<ArkmeLoginMode>(initialAuth?.status === 'binding-required' ? 'phone' : 'wechat')
  const [phone, setPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [smsCountdown, setSmsCountdown] = useState(0)
  const [captchaId, setCaptchaId] = useState('')
  const [testLoginEnabled, setTestLoginEnabled] = useState(false)
  const [testUserId, setTestUserId] = useState('')
  const [qr, setQr] = useState('')
  const [phoneBindingGate, setPhoneBindingGate] = useState<ArkmePhoneBindingGate>(initialPhoneBindingGate(initialAuth))
  const [phoneCheckRevision, setPhoneCheckRevision] = useState(0)
  const qrRequestStartedRef = useRef(false)
  const lastReadAckRef = useRef('')
  const checkedUserIdRef = useRef<number | undefined>()
  const notifiedUserIdRef = useRef<number | undefined>()
  const bindingNotifiedUserIdRef = useRef<number | undefined>()
  const ignoreStaleBindingAuthRef = useRef(false)
  const authenticated = auth?.status === 'authenticated' && phoneBindingGate === 'ready'
  const authView = arkmeAuthView(auth, phoneBindingGate)
  const phoneBindingRequired = arkmeLoginNeedsPhoneBinding(auth, phoneBindingGate)

  const acceptAuthSnapshot = useCallback((snapshot: ArkmeAuthSnapshot, options: { forcePhoneCheck?: boolean } = {}) => {
    arkmeAuthStore.setAuth(snapshot)
    if (snapshot.status === 'binding-required') {
      checkedUserIdRef.current = snapshot.userId
      notifiedUserIdRef.current = undefined
      setPhoneBindingGate('required')
      setLoginMode('phone')
      setAgreed(true)
      setQr('')
      setSmsCode('')
      setError('请先绑定手机号，再继续使用 Arkme')
      if (bindingNotifiedUserIdRef.current !== snapshot.userId) {
        bindingNotifiedUserIdRef.current = snapshot.userId
        arkmeUi.authChanged(false)
      }
      return
    }
    bindingNotifiedUserIdRef.current = undefined
    if (options.forcePhoneCheck === true || snapshot.status !== 'authenticated' || checkedUserIdRef.current !== snapshot.userId) {
      checkedUserIdRef.current = undefined
      notifiedUserIdRef.current = undefined
      bindingNotifiedUserIdRef.current = undefined
      setPhoneBindingGate('unknown')
      setPhoneCheckRevision(value => value + 1)
    }
  }, [])

  useEffect(() => {
    if (initialAuth === undefined) return
    if (ignoreStaleBindingAuthRef.current && initialAuth.status !== 'logged-out') return
    ignoreStaleBindingAuthRef.current = false
    if (auth?.status === 'binding-required' && initialAuth.status === 'logged-out') return
    acceptAuthSnapshot(initialAuth)
  }, [acceptAuthSnapshot, auth?.status, initialAuth])
  useEffect(() => {
    if (authStoreSnapshot.auth === undefined) return
    if (ignoreStaleBindingAuthRef.current && authStoreSnapshot.auth.status !== 'logged-out') return
    ignoreStaleBindingAuthRef.current = false
    if (auth?.status === 'binding-required' && authStoreSnapshot.auth.status === 'logged-out') return
    acceptAuthSnapshot(authStoreSnapshot.auth)
  }, [acceptAuthSnapshot, auth?.status, authStoreSnapshot.auth])
  useEffect(() => {
    if (authStoreSnapshot.config === undefined) return
    setCaptchaId(authStoreSnapshot.config.captchaId)
    setTestLoginEnabled(authStoreSnapshot.config.testLoginEnabled)
  }, [authStoreSnapshot.config])

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (textarea === null) return
    textarea.style.height = 'auto'; textarea.style.height = `${Math.min(textarea.scrollHeight, 336)}px`
  }, [draft])

  const refreshAuth = useCallback(async () => {
    setBusy(true); setError('')
    try {
      const snapshot = await arkmeAuthStore.refresh()
      const config = arkmeAuthStore.getSnapshot().config
      acceptAuthSnapshot(snapshot)
      if (config !== undefined) {
        setCaptchaId(config.captchaId)
        setTestLoginEnabled(config.testLoginEnabled)
      }
      if (!['authenticated', 'binding-required'].includes(snapshot.status) && config?.testLoginEnabled === true) setLoginMode('test')
    } catch (caught) { setError(errorMessage(caught)) }
    finally { setBusy(false) }
  }, [acceptAuthSnapshot])

  useEffect(() => {
    if (auth?.status !== 'authenticated') {
      if (auth?.status !== 'binding-required') {
        if (phoneBindingGate !== 'unknown') setPhoneBindingGate('unknown')
        checkedUserIdRef.current = undefined
        notifiedUserIdRef.current = undefined
      }
      return
    }
    let active = true
    const userId = auth.userId
    setPhoneBindingGate('checking'); setBusy(true); setError('')
    void callArkme<ArkmeUserProfileSnapshot>('user.profile.refresh')
      .then(snapshot => {
        if (!active) return
        checkedUserIdRef.current = userId
        if (arkmeProfileHasBoundPhone(snapshot)) {
          setPhoneBindingGate('ready')
          if (notifiedUserIdRef.current !== userId) {
            notifiedUserIdRef.current = userId
            arkmeUi.authChanged(true)
          }
          return
        }
        setPhoneBindingGate('required')
        setLoginMode('phone')
        setAgreed(true)
        setQr('')
        setSmsCode('')
        setError('请先绑定手机号，再继续使用 Arkme')
      })
      .catch(caught => {
        if (!active) return
        checkedUserIdRef.current = userId
        setPhoneBindingGate('required')
        setLoginMode('phone')
        setAgreed(true)
        setQr('')
        setError(errorMessage(caught))
      })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [auth?.status, auth?.userId, phoneCheckRevision])

  const acknowledgeRead = useCallback(async (nextItems: ArkmeTimelineItem[]) => {
    if (source === undefined || source.unreadCount <= 0 || nextItems.length === 0
      || (source.kind !== 'private_chat' && source.kind !== 'group_chat')) return
    const visibleLatest = nextItems.reduce((latest, item) => Math.max(latest, item.sequence ?? 0), 0)
    const readSequence = Math.max(source.latestSequence ?? 0, visibleLatest)
    const readAckKey = `${source.sourceRef}:${String(readSequence)}`
    if (readSequence <= 0 || lastReadAckRef.current === readAckKey) return
    lastReadAckRef.current = readAckKey
    await new Promise<void>(resolve => { requestAnimationFrame(() => { resolve() }) })
    try {
      await callArkme<ArkmeSourceReadResult>('source.mark-read', {
        sourceRef: source.sourceRef,
        readSequence,
      })
    } catch {
      if (lastReadAckRef.current === readAckKey) lastReadAckRef.current = ''
    }
  }, [source])

  const loadTimeline = useCallback(async (cursor?: ArkmeTimelineCursor, preserve = false) => {
    if (source === undefined) return
    const body = bodyRef.current
    const oldHeight = body?.scrollHeight ?? 0
    const oldTop = body?.scrollTop ?? 0
    const page = await callArkme<ArkmeTimelinePage>('source.timeline', {
      sourceRef: source.sourceRef, limit: 40, ...(cursor === undefined ? {} : { cursor }),
    })
    setItems(current => cursor === undefined ? mergeItems([], page.items) : mergeItems(current, page.items))
    setHasMore(page.hasMore); setNextCursor(page.nextCursor)
    requestAnimationFrame(() => {
      const target = bodyRef.current
      if (target === null) return
      target.scrollTop = preserve ? oldTop + (target.scrollHeight - oldHeight) : target.scrollHeight
    })
    if (cursor === undefined) await acknowledgeRead(page.items)
  }, [acknowledgeRead, source])

  useEffect(() => { void refreshAuth() }, [refreshAuth, ui.authRevision])
  useEffect(() => {
    if (ui.surfaceOpen) void refreshAuth()
  }, [refreshAuth, ui.surfaceOpen])
  useEffect(() => {
    setItems([]); setNextCursor(undefined); setHasMore(false); setError('')
    if (authenticated && source !== undefined) {
      setBusy(true)
      void loadTimeline().catch(caught => { setError(errorMessage(caught)) }).finally(() => { setBusy(false) })
    }
  }, [authenticated, source?.sourceRef])
  useEffect(() => {
    if (!authenticated || source === undefined) return
    const deltaItems = chatDelta.itemsBySourceRef[source.sourceRef] ?? []
    if (deltaItems.length === 0) return
    setItems(current => mergeItems(current, deltaItems))
    void acknowledgeRead(deltaItems)
    requestAnimationFrame(() => {
      if (bodyRef.current !== null) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    })
  }, [acknowledgeRead, authenticated, chatDelta, source?.sourceRef])

  useEffect(() => {
    const root = bodyRef.current; const sentinel = sentinelRef.current
    if (!authenticated || root === null || sentinel === null || !hasMore || nextCursor === undefined) return
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting !== true || loadingOlder) return
      setLoadingOlder(true)
      void loadTimeline(nextCursor, true).catch(caught => { setError(errorMessage(caught)) }).finally(() => { setLoadingOlder(false) })
    }, { root, rootMargin: '120px 0px 0px' })
    observer.observe(sentinel); return () => { observer.disconnect() }
  }, [authenticated, hasMore, loadTimeline, loadingOlder, nextCursor])

  useEffect(() => {
    if (smsCountdown <= 0) return
    const timer = setTimeout(() => { setSmsCountdown(value => Math.max(0, value - 1)) }, 1000)
    return () => { clearTimeout(timer) }
  }, [smsCountdown])

  useEffect(() => {
    if (loginMode !== 'wechat' || !agreed || auth?.status !== 'pending' || auth.attemptId === undefined) return
    let stopped = false; let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.poll', { attemptId: auth.attemptId })
        if (stopped) return
        acceptAuthSnapshot(snapshot)
        if (snapshot.status === 'authenticated') { setQr(''); return }
      } catch (caught) { if (!stopped) setError(errorMessage(caught)) }
      if (!stopped) timer = setTimeout(() => { void poll() }, 1200)
    }
    timer = setTimeout(() => { void poll() }, 800)
    return () => { stopped = true; clearTimeout(timer) }
  }, [agreed, auth?.attemptId, auth?.status, loginMode])

  const beginWechat = async () => {
    if (!agreed) { setError('请阅读并同意用户协议和隐私条款'); return }
    setBusy(true); setError('')
    try { const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.begin'); acceptAuthSnapshot(snapshot); setQr(snapshot.qrContent === undefined ? '' : qrDataUrl(snapshot.qrContent)) }
    catch (caught) { setError(errorMessage(caught)) } finally { setBusy(false) }
  }

  const sendCode = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) { setError('请输入正确的 11 位手机号'); return }
    setBusy(true); setError('')
    try { const captcha = await verifyPhoneCaptcha(captchaId, phone); await callArkme('auth.phone.send', { phone, captcha }); setSmsCountdown(60) }
    catch (caught) { setError(errorMessage(caught)) } finally { setBusy(false) }
  }

  const verifyCode = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) { setError('请输入正确的手机号'); return }
    if (!/^\d{6}$/.test(smsCode)) { setError('请输入验证码'); return }
    if (!agreed) { setError('请阅读并同意用户协议和隐私条款'); return }
    setBusy(true); setSubmitBusy(true); setError('')
    try {
      const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.phone.verify', { phone, code: smsCode })
      acceptAuthSnapshot(snapshot, { forcePhoneCheck: true })
    } catch (caught) { setError(errorMessage(caught)) } finally { setSubmitBusy(false); setBusy(false) }
  }

  const testLogin = async () => {
    const userId = Number(testUserId)
    if (!Number.isSafeInteger(userId) || userId <= 0) { setError('请输入有效的测试账号 user_id'); return }
    if (!agreed) { setError('请阅读并同意用户协议和隐私条款'); return }
    setBusy(true); setError('')
    try {
      const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.test.login', { userId })
      acceptAuthSnapshot(snapshot, { forcePhoneCheck: true })
    } catch (caught) { setError(errorMessage(caught)) } finally { setBusy(false) }
  }

  const cancelBinding = async () => {
    setBusy(true); setError('')
    try {
      const snapshot = await callArkme<ArkmeAuthSnapshot>('auth.logout')
      ignoreStaleBindingAuthRef.current = true
      arkmeAuthStore.setAuth(snapshot)
      checkedUserIdRef.current = undefined
      notifiedUserIdRef.current = undefined
      setPhoneBindingGate('unknown')
      setPhoneCheckRevision(value => value + 1)
      setPhone('')
      setSmsCode('')
      setQr('')
      setSubmitBusy(false)
      qrRequestStartedRef.current = false
      setLoginMode(testLoginEnabled ? 'test' : 'wechat')
      arkmeUi.authChanged(false)
    } catch (caught) { setError(errorMessage(caught)) } finally { setBusy(false) }
  }

  useEffect(() => {
    if (!arkmeShouldBeginWechat(auth, authView, loginMode, agreed, qr, qrRequestStartedRef.current)) return
    qrRequestStartedRef.current = true
    void beginWechat()
  }, [agreed, auth, authView, loginMode, qr])

  const changeLoginMode = (mode: ArkmeLoginMode) => {
    setLoginMode(mode)
    setError('')
    if (mode !== 'wechat') qrRequestStartedRef.current = false
  }

  const send = async () => {
    if (source === undefined) return
    const textContent = draft.trim(); if (textContent === '') return
    const recordUid = crypto.randomUUID(); const relationUid = crypto.randomUUID(); const now = Date.now()
    const optimistic: ArkmeTimelineItem = {
      itemUid: recordUid, senderName: '我', isMe: true, sendAtMillis: now,
      title: '', textContent, status: 0,
    }
    setItems(current => mergeItems(current, [optimistic])); setDraft(''); setBusy(true); setError('')
    requestAnimationFrame(() => { if (bodyRef.current !== null) bodyRef.current.scrollTop = bodyRef.current.scrollHeight })
    try {
      const result = await callArkme<ArkmeSourceSendResult>('source.send-text', {
        sourceRef: source.sourceRef, textContent, recordUid, relationUid,
      })
      setItems(current => current.map(item => item.itemUid === recordUid
        ? { ...item, itemUid: result.itemUid, status: result.status, ...(result.sequence === undefined ? {} : { sequence: result.sequence }) }
        : item))
      if (result.localState === 'failed') setError(result.error ?? '内容已保存在本地，远端同步失败')
    } catch (caught) {
      setItems(current => current.filter(item => item.itemUid !== recordUid)); setDraft(textContent); setError(errorMessage(caught))
    } finally { setBusy(false) }
  }

  const displayItems = useMemo(() => [...items].sort((a, b) => a.sendAtMillis - b.sendAtMillis), [items])
  const showMessageAvatars = source?.kind === 'private_chat' || source?.kind === 'group_chat'

  return (
    <div style={{ ...styles.surface, ...(floating ? styles.floatingSurface : {}) }}>
      <section style={styles.panel} role="region" aria-label={source?.displayName ?? 'Arkme'}>
        <header style={styles.header}>
          <h2 style={styles.title}>{source?.displayName ?? 'Arkme'}</h2>
          {authenticated && ui.mode === 'source' && source?.kind === 'private_chat' && <ArkmePrivateCallMenu
            sourceRef={source.sourceRef}
            displayName={source.displayName}
            assetBasePath={authStoreSnapshot.config?.callAssetBasePath ?? '/arkme-self/api/call'}
          />}
        </header>
        {authView === 'checking' ? <div style={styles.authChecking} role="status">
          {error === '' ? '正在确认 Arkme 登录状态…' : error}
        </div> : authView === 'login' ? <div style={styles.loginBody}><ArkmeLogin
          mode={loginMode}
          phoneBindingRequired={phoneBindingRequired}
          agreed={agreed}
          busy={busy}
          submitBusy={submitBusy}
          error={error}
          phone={phone}
          smsCode={smsCode}
          smsCountdown={smsCountdown}
          testLoginEnabled={testLoginEnabled}
          testUserId={testUserId}
          qrDataUrl={qr}
          onModeChange={changeLoginMode}
          onAgreementChange={setAgreed}
          onPhoneChange={setPhone}
          onSmsCodeChange={setSmsCode}
          onTestUserIdChange={setTestUserId}
          onSendCode={() => { void sendCode() }}
          onVerifyCode={() => { void verifyCode() }}
          onTestLogin={() => { void testLogin() }}
          onCancelBinding={() => { void cancelBinding() }}
        /></div> : source === undefined ? <div style={styles.body} /> : <>
          <div ref={bodyRef} style={styles.body}>
            {error !== '' && <div style={styles.error}>{error}</div>}
            <div ref={sentinelRef} style={styles.sentinel} />
            {loadingOlder && <div style={styles.loading}>正在加载更早内容…</div>}
            {displayItems.length > 0 && <ul style={styles.records}>
              {displayItems.map((item, index) => {
                const previous = index === 0 ? undefined : displayItems[index - 1]
                const startsDay = previous === undefined || dayKey(previous.sendAtMillis) !== dayKey(item.sendAtMillis)
                return <Fragment key={item.itemUid}>
                  {startsDay && <li style={styles.date}>{dayLabel(item.sendAtMillis)}</li>}
                  <li style={{ ...styles.row, ...(item.isMe ? styles.rowMe : styles.rowOther) }}>
                    <div style={{ ...styles.messageLine, ...(item.isMe ? styles.messageLineMe : {}) }}>
                      {showMessageAvatars && <MessageAvatar item={item} />}
                      <div style={{ ...styles.messageBody, ...(item.isMe ? styles.messageBodyMe : {}) }}>
                        {!item.isMe && <span style={styles.sender}>{item.senderName}</span>}
                        <div style={{ ...styles.bubble, ...(item.isMe ? styles.bubbleMe : styles.bubbleOther) }}><p style={styles.text}>{item.textContent || item.title || '非文本内容'}</p></div>
                        <span style={styles.meta}>{timeLabel(item.sendAtMillis)}</span>
                      </div>
                    </div>
                  </li>
                </Fragment>
              })}
            </ul>}
          </div>
          <footer style={styles.composer}><div style={styles.composerInner}>
            <textarea ref={textareaRef} rows={1} style={styles.textarea} value={draft} maxLength={20000} placeholder={`发送到${source.displayName}…`} aria-label={`发送到${source.displayName}`} disabled={busy}
              onChange={event => { setDraft(event.target.value) }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy && draft.trim() !== '') void send() } }} />
            <div style={styles.tools}><button
              type="button"
              style={{ ...styles.send, opacity: busy || draft.trim() === '' ? .4 : 1 }}
              disabled={busy || draft.trim() === ''}
              aria-label="发送消息"
              onMouseDown={event => { event.preventDefault() }}
              onMouseEnter={event => {
                if (!event.currentTarget.disabled) {
                  event.currentTarget.style.background = 'var(--dsw-alias-button-info-hover, #2f57df)'
                }
              }}
              onMouseLeave={event => {
                event.currentTarget.style.background = 'var(--dsw-alias-button-info-fill, #3964fe)'
              }}
              onClick={() => { void send() }}
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                <path d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z" fill="currentColor" />
              </svg>
            </button></div>
          </div></footer>
        </>}
      </section>
    </div>
  )
}
