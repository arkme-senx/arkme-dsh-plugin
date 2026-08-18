import {
  Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties,
} from 'react'
import qrcode from 'qrcode-generator'
import type {
  JotmoAuthSnapshot, JotmoClientConfig, JotmoSourceSendResult, JotmoTimelineCursor,
  JotmoTimelineItem, JotmoTimelinePage,
} from '../types.js'
import { callJotmo, JotmoClientError } from './api.js'
import { verifyPhoneCaptcha } from './geetest.js'
import { JotmoCallHistorySurface } from './JotmoCallHistorySurface.js'
import { JotmoMark } from './JotmoFooterAction.js'
import { loadJotmoImageDataUrl } from './JotmoVirtualWorkspace.js'
import { jotmoUi } from './ui-controller.js'

export interface JotmoSurfaceProps {}

const colors = {
  panel: 'var(--dsw-alias-bg-base, #ffffff)',
  text: 'var(--dsw-alias-label-primary, #17191c)',
  secondary: 'var(--dsw-alias-label-secondary, #68707c)',
  border: 'var(--dsw-alias-border-l2, #e2e5e9)',
  accent: '#3964fe',
  danger: '#c2413b',
}

const styles: Record<string, CSSProperties> = {
  surface: { width: '100%', height: '100%', minWidth: 0, display: 'flex', background: colors.panel, color: colors.text },
  panel: { width: '100%', height: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: {
    flex: 'none', height: 56, display: 'flex', alignItems: 'center', padding: '12px 28px 12px 20px',
    boxSizing: 'border-box', borderBottom: `1px solid ${colors.border}`,
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
  composer: { flex: 'none', display: 'flex', justifyContent: 'center', padding: '0 16px 8px' },
  composerInner: {
    position: 'relative', width: 'min(780px,100%)', minHeight: 96, overflow: 'hidden',
    border: '1px solid var(--dsw-alias-border-l2-darkmode-thin, rgba(0,0,0,.1))', borderRadius: 22,
    background: 'var(--dsw-specific-input-major, #fff)', boxShadow: 'var(--dsw-shadow-lv2, 0 4px 16px rgba(0,0,0,.08))',
  },
  textarea: {
    width: '100%', minHeight: 96, maxHeight: 336, resize: 'none', overflowY: 'auto',
    boxSizing: 'border-box', border: 0, outline: 0, borderRadius: 22, padding: '14px 58px 44px 16px',
    background: 'transparent', color: colors.text, boxShadow: 'none', appearance: 'none', WebkitAppearance: 'none',
    font: 'inherit', fontSize: 16, lineHeight: '24px', caretColor: 'var(--dsw-alias-state-business-primary, #3964fe)',
  },
  tools: { position: 'absolute', right: 10, bottom: 10, display: 'flex', padding: 0 },
  send: { width: 34, height: 34, border: 0, borderRadius: 999, background: colors.accent, color: '#fff', cursor: 'pointer' },
  login: { minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28, boxSizing: 'border-box' },
  loginCard: {
    width: 'min(620px,100%)', minHeight: 560, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
    padding: '42px clamp(24px,6vw,58px)', boxSizing: 'border-box', border: '1px solid rgba(72,116,84,.2)', borderRadius: 28,
    background: 'radial-gradient(circle at 92% 5%, rgba(62,139,91,.08), transparent 28%), rgba(252,255,252,.98)',
  },
  brand: { width: '100%', display: 'flex', alignItems: 'center', gap: 18 },
  loginTitle: { margin: 0, fontSize: 34, fontWeight: 750 },
  modes: { display: 'flex', width: 'min(420px,100%)', padding: 5, borderRadius: 999, background: '#edf5ef' },
  mode: { flex: 1, border: 0, borderRadius: 999, padding: 10, background: 'transparent', cursor: 'pointer' },
  modeActive: { background: '#fff', fontWeight: 650 },
  form: { width: 'min(420px,100%)', display: 'grid', gap: 12 },
  input: { width: '100%', boxSizing: 'border-box', border: `1px solid ${colors.border}`, borderRadius: 12, padding: '12px 14px', font: 'inherit' },
  codeRow: { display: 'flex', gap: 8 },
  button: { border: `1px solid ${colors.border}`, borderRadius: 9, padding: '8px 12px', background: '#fff', cursor: 'pointer' },
  primary: { border: 0, borderRadius: 12, padding: 12, background: '#16a34a', color: '#fff', fontWeight: 650, cursor: 'pointer' },
  agreement: { maxWidth: 440, fontSize: 12, color: colors.secondary },
  qr: { width: 220, height: 220, padding: 10, borderRadius: 14, background: '#fff', border: `1px solid ${colors.border}` },
}

function errorMessage(error: unknown): string {
  if (error instanceof JotmoClientError) return error.body.message
  return error instanceof Error ? error.message : String(error)
}

function qrDataUrl(content: string): string {
  const qr = qrcode(0, 'M'); qr.addData(content); qr.make(); return qr.createDataURL(6, 12)
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

function mergeItems(current: JotmoTimelineItem[], incoming: JotmoTimelineItem[]): JotmoTimelineItem[] {
  const map = new Map(current.map(item => [item.itemUid, item]))
  for (const item of incoming) map.set(item.itemUid, item)
  return [...map.values()].sort((a, b) => a.sendAtMillis - b.sendAtMillis || a.itemUid.localeCompare(b.itemUid))
}

function MessageAvatar({ item }: { item: JotmoTimelineItem }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let active = true
    setSrc('')
    if (item.avatarRef === undefined) return () => { active = false }
    void loadJotmoImageDataUrl(item.avatarRef)
      .then(value => { if (active) setSrc(value) })
      .catch(() => undefined)
    return () => { active = false }
  }, [item.avatarRef])
  return <span style={styles.messageAvatar} aria-hidden>
    {src === '' ? <JotmoMark size={32} /> : <img src={src} alt="" draggable={false} style={styles.messageAvatarImage} />}
  </span>
}

export function JotmoSurface(_props: JotmoSurfaceProps = {}) {
  const ui = useSyncExternalStore(jotmoUi.subscribe, jotmoUi.getSnapshot)
  const source = ui.mode === 'source' ? ui.selectedSource : undefined
  const bodyRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [auth, setAuth] = useState<JotmoAuthSnapshot>()
  const [items, setItems] = useState<JotmoTimelineItem[]>([])
  const [nextCursor, setNextCursor] = useState<JotmoTimelineCursor>()
  const [hasMore, setHasMore] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [error, setError] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [loginMode, setLoginMode] = useState<'phone' | 'wechat'>('phone')
  const [phone, setPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [smsCountdown, setSmsCountdown] = useState(0)
  const [captchaId, setCaptchaId] = useState('')
  const [qr, setQr] = useState('')
  const authenticated = auth?.status === 'authenticated'

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (textarea === null) return
    textarea.style.height = 'auto'; textarea.style.height = `${Math.min(textarea.scrollHeight, 336)}px`
  }, [draft])

  const refreshAuth = useCallback(async () => {
    setBusy(true); setError('')
    try {
      const [snapshot, config] = await Promise.all([
        callJotmo<JotmoAuthSnapshot>('auth.status'), callJotmo<JotmoClientConfig>('auth.config'),
      ])
      setAuth(snapshot); setCaptchaId(config.captchaId)
    } catch (caught) { setError(errorMessage(caught)) }
    finally { setBusy(false) }
  }, [])

  const loadTimeline = useCallback(async (cursor?: JotmoTimelineCursor, preserve = false) => {
    if (source === undefined) return
    const body = bodyRef.current
    const oldHeight = body?.scrollHeight ?? 0
    const oldTop = body?.scrollTop ?? 0
    const page = await callJotmo<JotmoTimelinePage>('source.timeline', {
      sourceRef: source.sourceRef, limit: 40, ...(cursor === undefined ? {} : { cursor }),
    })
    setItems(current => cursor === undefined ? mergeItems([], page.items) : mergeItems(current, page.items))
    setHasMore(page.hasMore); setNextCursor(page.nextCursor)
    requestAnimationFrame(() => {
      const target = bodyRef.current
      if (target === null) return
      target.scrollTop = preserve ? oldTop + (target.scrollHeight - oldHeight) : target.scrollHeight
    })
  }, [source])

  useEffect(() => { void refreshAuth() }, [refreshAuth, ui.authRevision])
  useEffect(() => {
    setItems([]); setNextCursor(undefined); setHasMore(false); setError('')
    if (authenticated && source !== undefined) {
      setBusy(true)
      void loadTimeline().catch(caught => { setError(errorMessage(caught)) }).finally(() => { setBusy(false) })
    }
  }, [authenticated, loadTimeline, source?.sourceRef])

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
    if (auth?.status !== 'pending' || auth.attemptId === undefined) return
    let stopped = false; let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const snapshot = await callJotmo<JotmoAuthSnapshot>('auth.poll', { attemptId: auth.attemptId })
        if (stopped) return
        setAuth(snapshot)
        if (snapshot.status === 'authenticated') { setQr(''); jotmoUi.authChanged(true); return }
      } catch (caught) { if (!stopped) setError(errorMessage(caught)) }
      if (!stopped) timer = setTimeout(() => { void poll() }, 1200)
    }
    timer = setTimeout(() => { void poll() }, 800)
    return () => { stopped = true; clearTimeout(timer) }
  }, [auth?.attemptId, auth?.status])

  const beginWechat = async () => {
    if (!agreed) { setError('请先阅读并同意即我用户协议和隐私政策'); return }
    setBusy(true); setError('')
    try { const snapshot = await callJotmo<JotmoAuthSnapshot>('auth.begin'); setAuth(snapshot); setQr(snapshot.qrContent === undefined ? '' : qrDataUrl(snapshot.qrContent)) }
    catch (caught) { setError(errorMessage(caught)) } finally { setBusy(false) }
  }

  const sendCode = async () => {
    if (!agreed) { setError('请先阅读并同意即我用户协议和隐私政策'); return }
    setBusy(true); setError('')
    try { const captcha = await verifyPhoneCaptcha(captchaId, phone); await callJotmo('auth.phone.send', { phone, captcha }); setSmsCountdown(60) }
    catch (caught) { setError(errorMessage(caught)) } finally { setBusy(false) }
  }

  const verifyCode = async () => {
    if (!agreed) { setError('请先阅读并同意即我用户协议和隐私政策'); return }
    setBusy(true); setError('')
    try {
      const snapshot = await callJotmo<JotmoAuthSnapshot>('auth.phone.verify', { phone, code: smsCode })
      setAuth(snapshot); if (snapshot.status === 'authenticated') jotmoUi.authChanged(true)
    } catch (caught) { setError(errorMessage(caught)) } finally { setBusy(false) }
  }

  const send = async () => {
    if (source === undefined) return
    const textContent = draft.trim(); if (textContent === '') return
    const recordUid = crypto.randomUUID(); const relationUid = crypto.randomUUID(); const now = Date.now()
    const optimistic: JotmoTimelineItem = {
      itemUid: recordUid, senderName: '我', isMe: true, sendAtMillis: now,
      title: '', textContent, status: 0,
    }
    setItems(current => mergeItems(current, [optimistic])); setDraft(''); setBusy(true); setError('')
    requestAnimationFrame(() => { if (bodyRef.current !== null) bodyRef.current.scrollTop = bodyRef.current.scrollHeight })
    try {
      const result = await callJotmo<JotmoSourceSendResult>('source.send-text', {
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
    <div style={styles.surface}>
      <section style={styles.panel} role="region" aria-label={source?.displayName ?? '即我'}>
        <header style={styles.header}><h2 style={styles.title}>{source?.displayName ?? '即我'}</h2></header>
        {!authenticated ? (
          <div style={styles.body}><div style={styles.login}><div style={styles.loginCard}>
            <div style={styles.brand}><JotmoMark size={58} /><h3 style={styles.loginTitle}>登录即我</h3></div>
            {error !== '' && <div style={styles.error} role="alert">{error}</div>}
            <div style={styles.modes}>
              <button style={{ ...styles.mode, ...(loginMode === 'phone' ? styles.modeActive : {}) }} onClick={() => { setLoginMode('phone') }}>手机号登录</button>
              <button style={{ ...styles.mode, ...(loginMode === 'wechat' ? styles.modeActive : {}) }} onClick={() => { setLoginMode('wechat') }}>微信扫码</button>
            </div>
            {loginMode === 'phone' ? <div style={styles.form}>
              <input style={styles.input} value={phone} placeholder="中国大陆手机号" aria-label="手机号" onChange={event => { setPhone(event.target.value) }} />
              <div style={styles.codeRow}>
                <input style={{ ...styles.input, flex: 1 }} value={smsCode} placeholder="短信验证码" aria-label="短信验证码" maxLength={6} onChange={event => { setSmsCode(event.target.value.replace(/\D/g, '')) }} />
                <button style={styles.button} disabled={busy || smsCountdown > 0} onClick={() => { void sendCode() }}>{smsCountdown > 0 ? `${smsCountdown}s` : '获取验证码'}</button>
              </div>
              <button style={styles.primary} disabled={busy || phone.trim() === '' || smsCode.length !== 6} onClick={() => { void verifyCode() }}>{busy ? '正在登录…' : '登录'}</button>
            </div> : auth?.status === 'pending' && qr !== '' ? <img src={qr} alt="微信扫码登录即我" style={styles.qr} />
              : <button style={styles.primary} disabled={busy} onClick={() => { void beginWechat() }}>获取登录二维码</button>}
            <label style={styles.agreement}><input type="checkbox" checked={agreed} onChange={event => { setAgreed(event.target.checked) }} /> 我已阅读并同意
              <a href="https://www.jiwo.cc/article/user-aggrement-v1.html" target="_blank" rel="noreferrer">《用户协议》</a>、
              <a href="https://www.jiwo.cc/article/privacy-aggrement-v1.html" target="_blank" rel="noreferrer">《隐私政策》</a>
            </label>
          </div></div></div>
        ) : ui.mode === 'calls' ? <JotmoCallHistorySurface /> : source === undefined ? <div style={styles.body} /> : <>
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
            <div style={styles.tools}><button type="button" style={{ ...styles.send, opacity: busy || draft.trim() === '' ? .4 : 1 }} disabled={busy || draft.trim() === ''} onClick={() => { void send() }} aria-label="发送">↑</button></div>
          </div></footer>
        </>}
      </section>
    </div>
  )
}
