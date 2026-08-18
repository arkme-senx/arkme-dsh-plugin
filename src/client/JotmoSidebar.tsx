import {
  Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties,
} from 'react'
import qrcode from 'qrcode-generator'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { callJotmo, JotmoClientError } from './api.js'
import { verifyPhoneCaptcha } from './geetest.js'
import { JotmoMark } from './JotmoFooterAction.js'
import {
  chronologicalRecords, mergeRecordPages, recordDayKey, recordDayLabel, recordTimeLabel,
} from './record-presentation.js'
import { jotmoUi } from './ui-controller.js'
import type {
  JotmoAuthSnapshot,
  JotmoCachedSnapshot,
  JotmoClientConfig,
  JotmoCreateTextResult,
  JotmoPendingWrite,
  JotmoSelfRecordItem,
  JotmoSelfRecordList,
  JotmoSelfSummary,
} from '../types.js'

export type JotmoSurfaceProps = PropsRuntime<'main.surface'> & { matched: string }

const colors = {
  panel: 'var(--dsw-alias-bg-base, #ffffff)',
  subtle: 'var(--dsw-alias-bg-subtle, #f6f7f9)',
  text: 'var(--dsw-alias-label-primary, #17191c)',
  secondary: 'var(--dsw-alias-label-secondary, #68707c)',
  border: 'var(--dsw-alias-border-l2, #e2e5e9)',
  accent: '#2563eb',
  danger: '#c2413b',
}

const styles: Record<string, CSSProperties> = {
  surface: {
    width: '100%', height: '100%', minWidth: 0,
    display: 'flex', background: colors.panel, color: colors.text,
  },
  panel: {
    width: '100%', height: '100%', minWidth: 0,
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    borderLeft: `1px solid ${colors.border}`, background: colors.panel, color: colors.text,
  },
  header: {
    flex: 'none', height: 56, display: 'flex', alignItems: 'center', boxSizing: 'border-box',
    padding: '12px 28px 12px 20px',
    borderBottom: `1px solid ${colors.border}`,
  },
  title: {
    minWidth: 0, margin: 0, padding: '4px 8px', overflow: 'hidden', textOverflow: 'ellipsis',
    whiteSpace: 'nowrap', fontSize: 14, lineHeight: '20px', fontWeight: 500,
  },
  body: {
    flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
    padding: '16px 32px 24px',
  },
  button: {
    border: `1px solid ${colors.border}`, borderRadius: 9, padding: '8px 12px',
    background: colors.panel, color: colors.text, cursor: 'pointer', fontSize: 13,
  },
  primaryButton: {
    border: 0, borderRadius: 9, padding: '9px 14px', background: colors.accent,
    color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600,
  },
  error: {
    padding: '10px 12px', borderRadius: 9, background: 'rgba(194, 65, 59, .1)',
    color: colors.danger, fontSize: 13, marginBottom: 12,
  },
  empty: { padding: '56px 16px', textAlign: 'center', color: colors.secondary },
  login: {
    minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '28px 16px', boxSizing: 'border-box',
  },
  loginCard: {
    width: 'min(620px, 100%)', minHeight: 560, display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 18, padding: '42px clamp(24px, 6vw, 58px)', boxSizing: 'border-box',
    border: '1px solid rgba(72, 116, 84, .20)', borderRadius: 28,
    background: 'radial-gradient(circle at 92% 5%, rgba(62, 139, 91, .08), transparent 28%), rgba(252, 255, 252, .98)',
    boxShadow: '0 16px 50px rgba(39, 78, 54, .08)', textAlign: 'center',
  },
  loginBrand: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 18, marginBottom: 8,
    color: '#122018', textAlign: 'left',
  },
  loginTitle: { margin: 0, fontSize: 34, lineHeight: '42px', fontWeight: 750, letterSpacing: '-0.03em' },
  loginHint: { margin: '14px 0 2px', fontSize: 20, lineHeight: '28px', fontWeight: 650, color: '#1c2a21' },
  loginNote: { margin: 0, maxWidth: 460, color: '#68756d', fontSize: 13, lineHeight: '21px' },
  loginError: {
    width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 9,
    background: 'rgba(194, 65, 59, .1)', color: colors.danger, fontSize: 13,
  },
  qr: {
    width: 220, height: 220, padding: 10, borderRadius: 14, background: '#fff',
    border: `1px solid ${colors.border}`,
  },
  agreement: { maxWidth: 440, fontSize: 12, lineHeight: '20px', color: colors.secondary },
  loginModes: {
    display: 'flex', gap: 4, width: 'min(420px, 100%)', padding: 5,
    borderRadius: 999, background: '#edf5ef', boxSizing: 'border-box',
  },
  loginModeButton: {
    flex: 1, border: 0, borderRadius: 999, padding: '10px 14px',
    background: 'transparent', color: '#647069', cursor: 'pointer', fontSize: 14,
  },
  loginModeActive: {
    background: '#fff', color: '#172219', fontWeight: 650,
    boxShadow: '0 3px 12px rgba(37, 88, 53, .08)',
  },
  loginForm: { width: 'min(420px, 100%)', display: 'grid', gap: 12 },
  input: {
    width: '100%', boxSizing: 'border-box', border: `1px solid ${colors.border}`,
    borderRadius: 12, padding: '12px 14px', background: '#fff', color: colors.text,
    font: 'inherit', fontSize: 14, outline: 'none',
  },
  codeRow: { display: 'flex', gap: 8 },
  records: {
    width: 'min(748px, 100%)', listStyle: 'none', margin: '0 auto', padding: 0,
    display: 'flex', flexDirection: 'column', gap: 16,
  },
  dateDivider: {
    alignSelf: 'center', margin: '16px 0 4px', padding: '4px 9px', borderRadius: 999,
    color: 'var(--dsw-alias-label-tertiary, #9097a1)', fontSize: 12,
    background: 'var(--dsw-alias-bg-subtle, #f6f7f9)',
  },
  recordRow: {
    alignSelf: 'stretch', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6,
  },
  recordStack: {
    minWidth: 0, maxWidth: 'min(525px, 82%)', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6,
  },
  record: {
    maxWidth: '100%', padding: '10px 16px', boxSizing: 'border-box',
    border: 0, borderRadius: 22, background: 'var(--dsw-specific-bubble, #f0f2f5)',
  },
  recordText: { margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 16, lineHeight: '24px' },
  recordMeta: { color: 'var(--dsw-alias-label-caption, #adb2b8)', fontSize: 11, lineHeight: '16px', textAlign: 'right' },
  paginationSentinel: { width: '100%', height: 1, pointerEvents: 'none' },
  paginationStatus: {
    width: 'min(748px, 100%)', margin: '0 auto 8px', padding: '4px 0',
    color: colors.secondary, fontSize: 12, lineHeight: '18px', textAlign: 'center',
  },
  composer: {
    flex: 'none', display: 'flex', justifyContent: 'center', padding: '0 16px 8px',
    background: colors.panel,
  },
  composerColumn: { width: 'min(780px, 100%)' },
  composerInner: {
    width: '100%', minHeight: 88, display: 'flex', flexDirection: 'column', gap: 12,
    paddingTop: 10, boxSizing: 'border-box',
    border: '1px solid var(--dsw-alias-border-l2-darkmode-thin, rgba(0, 0, 0, .1))',
    borderRadius: 22, background: 'var(--dsw-specific-input-major, #fff)',
    boxShadow: 'var(--dsw-shadow-lv2, 0 4px 16px rgba(0, 0, 0, .08))',
    fontSize: 16, lineHeight: '24px',
  },
  textarea: {
    width: '100%', minWidth: 0, minHeight: 28, maxHeight: 336, resize: 'none', boxSizing: 'border-box',
    overflowY: 'auto', border: 0, outline: 0, padding: '4px 12px 0 16px',
    background: 'transparent', color: colors.text, font: 'inherit', fontSize: 'inherit', lineHeight: 'inherit',
  },
  composerTools: {
    minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
    padding: '2px 8px 6px',
  },
  sendButton: {
    width: 34, height: 34, flex: 'none', display: 'grid', placeItems: 'center',
    border: 0, borderRadius: 999, background: 'var(--dsw-alias-button-info-fill, #3964fe)',
    color: '#fff', cursor: 'pointer', transform: 'translateY(-2px)',
  },
  outbox: { width: 'min(748px, 100%)', margin: '0 auto 14px', display: 'grid', gap: 8 },
  pending: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px',
    borderRadius: 10, background: 'rgba(217, 119, 6, .10)', fontSize: 12,
  },
}

function errorMessage(error: unknown): string {
  if (error instanceof JotmoClientError) return error.body.message
  return error instanceof Error ? error.message : String(error)
}

function createQrDataUrl(content: string): string {
  const qr = qrcode(0, 'M')
  qr.addData(content)
  qr.make()
  return qr.createDataURL(6, 12)
}

function syncedRecord(item: JotmoSelfRecordItem, status = item.status): JotmoSelfRecordItem {
  const { lastError: _lastError, ...rest } = item
  return { ...rest, status, localState: 'synced' }
}

type ScrollIntent =
  | { kind: 'bottom' }
  | { kind: 'preserve'; scrollHeight: number; scrollTop: number }

export function JotmoSurface(_props: JotmoSurfaceProps) {
  const ui = useSyncExternalStore(jotmoUi.subscribe, jotmoUi.getSnapshot)
  const bodyRef = useRef<HTMLDivElement>(null)
  const activeUserIdRef = useRef<number>()
  const paginationSentinelRef = useRef<HTMLDivElement>(null)
  const paginationArmedRef = useRef(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollIntentRef = useRef<ScrollIntent | null>(null)
  const [auth, setAuth] = useState<JotmoAuthSnapshot>()
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [loginMode, setLoginMode] = useState<'phone' | 'wechat'>('phone')
  const [phone, setPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [smsCountdown, setSmsCountdown] = useState(0)
  const [captchaId, setCaptchaId] = useState('')
  const [records, setRecords] = useState<JotmoSelfRecordItem[]>([])
  const [nextCursor, setNextCursor] = useState<JotmoSelfRecordList['nextCursor']>()
  const [hasMore, setHasMore] = useState(false)
  const [outbox, setOutbox] = useState<JotmoPendingWrite[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [loginBusy, setLoginBusy] = useState(false)
  const [error, setError] = useState('')
  const displayRecords = useMemo(() => chronologicalRecords(records), [records])
  const authenticated = auth?.status === 'authenticated'

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (textarea === null) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 336)}px`
  }, [draft])

  useLayoutEffect(() => {
    const body = bodyRef.current
    const intent = scrollIntentRef.current
    if (body === null || intent === null) return
    scrollIntentRef.current = null
    if (intent.kind === 'bottom') {
      body.scrollTop = body.scrollHeight
      return
    }
    body.scrollTop = intent.scrollTop + (body.scrollHeight - intent.scrollHeight)
  }, [records])

  const loadCachedData = useCallback(async (): Promise<JotmoCachedSnapshot> => {
    scrollIntentRef.current = { kind: 'bottom' }
    const [cached, pending] = await Promise.all([
      callJotmo<JotmoCachedSnapshot>('records.cache'),
      callJotmo<JotmoPendingWrite[]>('records.outbox'),
    ])
    setRecords(cached.items)
    setHasMore(cached.hasMore)
    setNextCursor(cached.nextCursor)
    setOutbox(pending)
    return cached
  }, [])

  const loadData = useCallback(async (
    cursor?: JotmoSelfRecordList['nextCursor'],
    scroll: 'bottom' | 'preserve' | 'none' = 'none',
    pagination: 'replace' | 'preserve' = 'replace',
  ) => {
    const body = bodyRef.current
    scrollIntentRef.current = scroll === 'bottom'
      ? { kind: 'bottom' }
      : scroll === 'preserve' && body !== null
        ? { kind: 'preserve', scrollHeight: body.scrollHeight, scrollTop: body.scrollTop }
        : null
    try {
      const [, page, pending] = await Promise.all([
        callJotmo<JotmoSelfSummary>('records.summary'),
        callJotmo<JotmoSelfRecordList>('records.list', {
          limit: 30,
          ...(cursor !== undefined ? { cursor } : {}),
        }),
        callJotmo<JotmoPendingWrite[]>('records.outbox'),
      ])
      setRecords(current => mergeRecordPages(current, page.items))
      if (pagination === 'replace') {
        setHasMore(page.hasMore)
        setNextCursor(page.nextCursor)
      }
      setOutbox(pending)
    } catch (caught) {
      scrollIntentRef.current = null
      throw caught
    }
  }, [])

  const syncAccount = useCallback(async (userId: number): Promise<void> => {
    if (activeUserIdRef.current !== userId) {
      activeUserIdRef.current = userId
      setRecords([])
      setOutbox([])
      setHasMore(false)
      setNextCursor(undefined)
    }
    const cached = await loadCachedData()
    await loadData(
      undefined,
      'bottom',
      cached.items.length > 0 || cached.hasMore || cached.nextCursor !== undefined ? 'preserve' : 'replace',
    )
  }, [loadCachedData, loadData])

  const refresh = useCallback(async () => {
    paginationArmedRef.current = true
    setBusy(true)
    setError('')
    try {
      const [snapshot, clientConfig] = await Promise.all([
        callJotmo<JotmoAuthSnapshot>('auth.status'),
        callJotmo<JotmoClientConfig>('auth.config'),
      ])
      setAuth(snapshot)
      setCaptchaId(clientConfig.captchaId)
      if (snapshot.status === 'authenticated' && snapshot.userId !== undefined) {
        await syncAccount(snapshot.userId)
      } else {
        activeUserIdRef.current = undefined
        setRecords([])
        setOutbox([])
        setHasMore(false)
        setNextCursor(undefined)
      }
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }, [syncAccount])

  useEffect(() => {
    void refresh()
  }, [refresh, ui.authRevision])

  useEffect(() => {
    const root = bodyRef.current
    const sentinel = paginationSentinelRef.current
    if (!authenticated || root === null || sentinel === null || !hasMore || nextCursor === undefined) return
    const cursor = nextCursor
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (entry === undefined) return
      if (!entry.isIntersecting) {
        paginationArmedRef.current = true
        return
      }
      if (!paginationArmedRef.current || busy || loadingOlder) return
      paginationArmedRef.current = false
      setLoadingOlder(true)
      void loadData(cursor, 'preserve', 'replace').then(() => {
        paginationArmedRef.current = true
      }).catch((caught) => {
        setError(errorMessage(caught))
      }).finally(() => {
        setLoadingOlder(false)
      })
    }, { root, rootMargin: '160px 0px 0px 0px' })
    observer.observe(sentinel)
    return () => { observer.disconnect() }
  }, [authenticated, busy, hasMore, loadData, loadingOlder, nextCursor])

  useEffect(() => {
    if (auth?.status !== 'pending' || auth.attemptId === undefined) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const snapshot = await callJotmo<JotmoAuthSnapshot>('auth.poll', { attemptId: auth.attemptId })
        if (cancelled) return
        setAuth(snapshot)
        if (snapshot.status === 'authenticated' && snapshot.userId !== undefined) {
          setQrDataUrl('')
          await syncAccount(snapshot.userId)
          return
        }
        if (snapshot.status === 'expired') return
      } catch (caught) {
        if (!cancelled) setError(errorMessage(caught))
      }
      if (!cancelled) timer = setTimeout(() => { void poll() }, 1200)
    }
    timer = setTimeout(() => { void poll() }, 800)
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [auth?.attemptId, auth?.status, syncAccount])

  useEffect(() => {
    if (smsCountdown <= 0) return
    const timer = setTimeout(() => { setSmsCountdown(current => Math.max(0, current - 1)) }, 1000)
    return () => { clearTimeout(timer) }
  }, [smsCountdown])

  const beginLogin = async () => {
    if (!agreed) {
      setError('请先阅读并同意即我用户协议和隐私政策')
      return
    }
    setBusy(true)
    setError('')
    try {
      const snapshot = await callJotmo<JotmoAuthSnapshot>('auth.begin')
      setAuth(snapshot)
      setQrDataUrl(snapshot.qrContent === undefined ? '' : createQrDataUrl(snapshot.qrContent))
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const sendPhoneCode = async () => {
    if (!agreed) {
      setError('请先阅读并同意即我用户协议和隐私政策')
      return
    }
    setBusy(true)
    setError('')
    try {
      const captcha = await verifyPhoneCaptcha(captchaId, phone)
      await callJotmo('auth.phone.send', { phone, captcha })
      setSmsCountdown(60)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const verifyPhoneCode = async () => {
    if (!agreed) {
      setError('请先阅读并同意即我用户协议和隐私政策')
      return
    }
    setLoginBusy(true)
    setError('')
    try {
      const snapshot = await callJotmo<JotmoAuthSnapshot>('auth.phone.verify', { phone, code: smsCode })
      setAuth(snapshot)
      if (snapshot.status === 'authenticated' && snapshot.userId !== undefined) {
        setLoginBusy(false)
        void syncAccount(snapshot.userId).catch(caught => { setError(errorMessage(caught)) })
      }
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoginBusy(false)
    }
  }

  const send = async () => {
    const textContent = draft.trim()
    if (textContent === '') return
    const recordUid = crypto.randomUUID()
    const sendAtMillis = Date.now()
    const optimistic: JotmoSelfRecordItem = {
      recordUid,
      sendAtMillis,
      title: '',
      textContent,
      templateKind: 1,
      status: 0,
      version: 0,
      localState: 'pending',
    }
    scrollIntentRef.current = { kind: 'bottom' }
    setRecords(current => mergeRecordPages(current, [optimistic]))
    setDraft('')
    setBusy(true)
    setError('')
    try {
      const result = await callJotmo<JotmoCreateTextResult>('records.create', {
        recordUid,
        textContent,
      })
      setRecords(current => current.map(item => item.recordUid === recordUid
        ? syncedRecord(item, result.status)
        : item))
      await loadData(undefined, 'bottom', 'preserve')
    } catch (caught) {
      const message = errorMessage(caught)
      let durable = false
      try {
        const pending = await callJotmo<JotmoPendingWrite[]>('records.outbox')
        setOutbox(pending)
        durable = pending.some(item => item.recordUid === recordUid)
      } catch { /* keep primary error */ }
      if (durable) {
        setRecords(current => current.map(item => item.recordUid === recordUid
          ? { ...item, localState: 'failed', lastError: message }
          : item))
        setError(`${message}；内容已保存在本地待发送列表`)
      } else {
        setRecords(current => current.filter(item => item.recordUid !== recordUid))
        setDraft(textContent)
        setError(`${message}；本地缓存写入失败，内容已恢复到输入框`)
      }
    } finally {
      setBusy(false)
    }
  }

  const retry = async (recordUid: string) => {
    setBusy(true)
    setError('')
    try {
      const result = await callJotmo<JotmoCreateTextResult>('records.retry', { recordUid })
      setRecords(current => current.map(item => item.recordUid === recordUid
        ? syncedRecord(item, result.status)
        : item))
      await loadData(undefined, 'bottom', 'preserve')
    } catch (caught) {
      setError(errorMessage(caught))
      try { setOutbox(await callJotmo<JotmoPendingWrite[]>('records.outbox')) } catch { /* keep primary error */ }
    } finally {
      setBusy(false)
    }
  }

  return (
      <div style={styles.surface}>
        <section style={styles.panel} role="region" aria-label="即我默认分类">
          <header style={styles.header}>
            <h2 style={styles.title}>默认分类</h2>
          </header>

          {!authenticated ? (
            <div style={styles.body}>
              <div style={styles.login}>
                <div style={styles.loginCard}>
                  <div style={styles.loginBrand}>
                    <JotmoMark size={58} />
                    <h3 style={styles.loginTitle}>登录即我</h3>
                  </div>
                  {error !== '' && <div style={styles.loginError} role="alert">{error}</div>}
                  <div style={styles.loginModes}>
                    <button
                      type="button"
                      style={{ ...styles.loginModeButton, ...(loginMode === 'phone' ? styles.loginModeActive : {}) }}
                      onClick={() => { setLoginMode('phone'); setError('') }}
                    >手机号登录</button>
                    <button
                      type="button"
                      style={{ ...styles.loginModeButton, ...(loginMode === 'wechat' ? styles.loginModeActive : {}) }}
                      onClick={() => { setLoginMode('wechat'); setError('') }}
                    >微信扫码</button>
                  </div>
                  {loginMode === 'wechat' && auth?.status === 'pending' && qrDataUrl !== '' ? (
                    <>
                      <h4 style={styles.loginHint}>请使用微信扫码登录</h4>
                      <img src={qrDataUrl} alt="微信扫码登录即我" style={styles.qr} />
                      <p style={styles.loginNote}>二维码将在到期后失效</p>
                    </>
                  ) : loginMode === 'phone' ? (
                    <>
                      <h4 style={styles.loginHint}>使用手机号登录</h4>
                      <p style={styles.loginNote}>登录凭据仅保存在本机 Host Keychain，不会发送给浏览器或模型。</p>
                      <div style={styles.loginForm}>
                        <input
                          style={styles.input}
                          value={phone}
                          inputMode="tel"
                          autoComplete="tel"
                          maxLength={13}
                          placeholder="中国大陆手机号"
                          aria-label="手机号"
                          onChange={event => { setPhone(event.target.value) }}
                        />
                        <div style={styles.codeRow}>
                          <input
                            style={{ ...styles.input, flex: 1 }}
                            value={smsCode}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            placeholder="短信验证码"
                            aria-label="短信验证码"
                            onChange={event => { setSmsCode(event.target.value.replace(/\D/g, '')) }}
                          />
                          <button
                            type="button"
                            style={styles.button}
                            disabled={busy || smsCountdown > 0}
                            onClick={() => { void sendPhoneCode() }}
                          >{smsCountdown > 0 ? `${smsCountdown}s` : busy ? '安全验证中…' : '获取验证码'}</button>
                        </div>
                        <button
                          type="button"
                          style={{ ...styles.primaryButton, padding: '12px 14px', borderRadius: 12, background: '#16a34a' }}
                          disabled={loginBusy || phone.trim() === '' || smsCode.length !== 6}
                          onClick={() => { void verifyPhoneCode() }}
                        >{loginBusy ? '正在登录…' : '登录'}</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <h4 style={styles.loginHint}>请使用微信扫码登录</h4>
                      <button
                        type="button"
                        style={{ ...styles.primaryButton, padding: '12px 22px', borderRadius: 12, background: '#16a34a' }}
                        disabled={busy}
                        onClick={() => { void beginLogin() }}
                      >{busy ? '正在获取二维码…' : auth?.status === 'expired' ? '重新获取二维码' : '获取登录二维码'}</button>
                    </>
                  )}
                  <label style={styles.agreement}>
                    <input type="checkbox" checked={agreed} onChange={event => { setAgreed(event.target.checked) }} />{' '}
                    我已阅读并同意
                    <a href="https://www.jiwo.cc/article/user-aggrement-v1.html" target="_blank" rel="noreferrer">《用户协议》</a>
                    、
                    <a href="https://www.jiwo.cc/article/privacy-aggrement-v1.html" target="_blank" rel="noreferrer">《隐私政策》</a>
                  </label>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div ref={bodyRef} style={styles.body}>
                {error !== '' && <div style={styles.error}>{error}</div>}
                {outbox.length > 0 && (
                  <div style={styles.outbox}>
                    {outbox.map(item => (
                      <div key={item.recordUid} style={styles.pending}>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          待发送：{item.textContent}
                        </span>
                        <button type="button" style={styles.button} disabled={busy} onClick={() => { void retry(item.recordUid) }}>重试</button>
                      </div>
                    ))}
                  </div>
                )}
                <div ref={paginationSentinelRef} style={styles.paginationSentinel} aria-hidden />
                {loadingOlder && <div style={styles.paginationStatus} role="status">正在加载更早的快记…</div>}
                {records.length === 0
                  ? <div style={styles.empty}>{busy ? '正在读取默认分类…' : '还没有默认分类快记'}</div>
                  : (
                  <ul style={styles.records}>
                    {displayRecords.map((item, index) => {
                      const day = recordDayKey(item.sendAtMillis)
                      const previous = index === 0 ? undefined : displayRecords[index - 1]
                      const startsDay = previous === undefined || recordDayKey(previous.sendAtMillis) !== day
                      const localLabel = item.localState === 'pending'
                        ? '正在发送'
                        : item.localState === 'failed' ? '发送失败' : ''
                      const timeLabel = recordTimeLabel(item.sendAtMillis)
                      return (
                        <Fragment key={item.recordUid}>
                          {startsDay && <li style={styles.dateDivider}>{recordDayLabel(item.sendAtMillis)}</li>}
                          <li style={styles.recordRow}>
                            <div style={styles.recordStack}>
                              <div style={styles.record}>
                                <p style={styles.recordText}>{item.textContent || item.title || '非文本快记'}</p>
                              </div>
                              <div style={{ ...styles.recordMeta, ...(item.localState === 'failed' ? { color: colors.danger } : {}) }}>
                                {localLabel}{localLabel !== '' && timeLabel !== '' ? ' · ' : ''}{timeLabel}
                              </div>
                            </div>
                          </li>
                        </Fragment>
                      )
                    })}
                  </ul>
                )}
              </div>
              <footer style={styles.composer}>
                <div style={styles.composerColumn}>
                  <div style={styles.composerInner}>
                    <textarea
                      ref={textareaRef}
                      rows={1}
                      style={styles.textarea}
                      value={draft}
                      maxLength={20000}
                      placeholder="记录此刻想法…"
                      aria-label="写入即我默认分类"
                      disabled={busy}
                      onChange={event => { setDraft(event.target.value) }}
                      onKeyDown={event => {
                        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
                        event.preventDefault()
                        if (!busy && draft.trim() !== '') void send()
                      }}
                    />
                    <div style={styles.composerTools}>
                      <button
                        type="button"
                        style={{ ...styles.sendButton, opacity: busy || draft.trim() === '' ? 0.4 : 1 }}
                        aria-label={busy ? '发送中' : '发送'}
                        title={busy ? '发送中' : '发送'}
                        disabled={busy || draft.trim() === ''}
                        onMouseDown={event => { event.preventDefault(); textareaRef.current?.focus({ preventScroll: true }) }}
                        onClick={() => { void send() }}
                      >
                        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                          <path d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z" fill="currentColor" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </footer>
            </>
          )}
        </section>
      </div>
  )
}
