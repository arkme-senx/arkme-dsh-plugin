import { tr, useArkmeLocale, arkmeIntlLocale } from './locale.js'
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { ArrowLeft } from '@phosphor-icons/react/dist/icons/ArrowLeft'
import { PhoneCall } from '@phosphor-icons/react/dist/icons/PhoneCall'
import { VideoCamera } from '@phosphor-icons/react/dist/icons/VideoCamera'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type { ArkmeOutgoingCallMediaType, ArkmeShareCallLink } from '../outgoing-call-contract.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { arkmeTheme } from './arkme-theme.js'
import { callArkme } from './api.js'
import { copyText } from './clipboard-text.js'
import { outgoingCallUi } from './outgoing-call-ui-controller.js'

const styles = {
  body: { padding: 22, display: 'grid', gap: 18 },
  header: { display: 'flex', alignItems: 'center', gap: 8 },
  title: { flex: 1, margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 650 },
  icon: { width: 30, height: 30, border: 0, borderRadius: 8, background: 'transparent', color: arkmeTheme.secondary, display: 'grid', placeItems: 'center', cursor: 'pointer' },
  copy: { margin: 0, color: arkmeTheme.secondary, fontSize: 13, lineHeight: '21px' },
  choices: { display: 'flex', gap: 12 },
  choice: { flex: 1, padding: '20px 12px', display: 'grid', justifyItems: 'center', gap: 10, border: `1px solid ${arkmeTheme.border}`, borderRadius: 12, background: arkmeTheme.elevated, color: arkmeTheme.text, font: 'inherit', fontSize: 13, cursor: 'pointer' },
  active: { borderColor: arkmeTheme.primaryAction, background: arkmeTheme.layer1 },
  button: { minHeight: 38, padding: '8px 15px', flex: 1, border: `1px solid ${arkmeTheme.border}`, borderRadius: 10, background: arkmeTheme.elevated, color: arkmeTheme.text, font: 'inherit', fontSize: 13, cursor: 'pointer' },
  primary: { background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction, borderColor: 'transparent' },
  link: { width: '100%', minHeight: 76, resize: 'none', boxSizing: 'border-box', padding: 12, border: `1px solid ${arkmeTheme.border}`, borderRadius: 10, background: arkmeTheme.input, color: arkmeTheme.text, font: 'inherit', fontSize: 12, lineHeight: '20px', overflowWrap: 'anywhere' },
  meta: { display: 'grid', gap: 9, margin: 0, fontSize: 13 },
  row: { display: 'flex', justifyContent: 'space-between', gap: 12 },
  hint: { margin: 0, color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '19px' },
  error: { margin: 0, color: arkmeTheme.danger, fontSize: 13, lineHeight: '20px' },
} satisfies Record<string, CSSProperties>

function errorText(error: unknown): string { return error instanceof Error ? error.message : tr("操作失败，请重试") }

export function ArkmeCallInviteDialog({ onBack, onClose }: { onBack(): void; onClose(): void }) {
  useArkmeLocale()
  const titleId = useId()
  const [mediaType, setMediaType] = useState<ArkmeOutgoingCallMediaType>('audio')
  const [link, setLink] = useState<ArkmeShareCallLink>()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now)
  const request = useRef<AbortController>()
  const alive = useRef(true)
  const expired = link !== undefined && now >= link.expiresAtMillis
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; request.current?.abort() }
  }, [])
  useEffect(() => {
    if (link === undefined) return
    const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [link])

  const create = async () => {
    if (request.current !== undefined) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setError(''); setStatus('正在连接通话服务…')
    try {
      await outgoingCallUi.ensureReceiver()
      if (controller.signal.aborted) return
      setStatus('正在生成邀请链接…')
      const result = await callArkme<ArkmeShareCallLink>('calls.invite.create', { mediaType }, controller.signal)
      if (controller.signal.aborted) return
      setNow(Date.now()); setLink(result); setStatus('')
      try {
        await copyText(result.callUrl)
        if (alive.current) setStatus('链接已复制，可粘贴给对方')
      } catch {
        if (alive.current) setStatus('自动复制失败，请点击复制链接或手动选择链接')
      }
    } catch (cause) {
      if (!controller.signal.aborted) { setError(errorText(cause)); setStatus('') }
    } finally {
      request.current = undefined
      if (alive.current) setBusy(false)
    }
  }

  const share = async (systemShare: boolean) => {
    if (link === undefined) return
    if (Date.now() >= link.expiresAtMillis) { setNow(Date.now()); setError('链接已过期，请重新生成'); return }
    setError(''); setStatus('')
    const invitation = `${link.sharerDisplayName}邀请你发起${link.mediaType === 'video' ? '视频' : '语音'}通话`
    try {
      if (systemShare && typeof navigator !== 'undefined' && navigator.share !== undefined) {
        await navigator.share({ title: 'Arkme 通话', text: invitation, url: link.callUrl })
      } else {
        await copyText(systemShare ? `Arkme 通话\n${invitation}\n${link.callUrl}` : link.callUrl)
        if (alive.current) setStatus(systemShare ? '邀请文案和链接已复制，可粘贴分享' : '链接已复制，可粘贴给对方')
      }
    } catch (cause) {
      if (alive.current && !(cause instanceof Error && cause.name === 'AbortError')) setError(errorText(cause))
    }
  }
  const title = link === undefined ? '邀请他人向我发起通话' : '通话邀请已生成'
  return <ArkmeConfirmDialog layout="picker" titleId={titleId} title={title} busy={busy} closeWhileBusy onClose={onClose}>
    <div style={styles.body}>
      <header style={styles.header}>
        <button type="button" style={styles.icon} aria-label={tr("返回联系人选择")} onClick={onBack}><ArrowLeft size={17} /></button>
        <h3 style={styles.title}>{title}</h3>
        <button type="button" style={styles.icon} aria-label={tr("关闭通话邀请")} onClick={onClose}><X size={18} /></button>
      </header>
      {link === undefined ? <>
        <p style={styles.copy}>{tr("生成邀请链接，分享给对方后，对方可向你发起通话。")}</p>
        <div style={styles.choices} role="group" aria-label={tr("邀请通话类型")}>
          {(['audio', 'video'] as const).map(type => <button key={type} type="button" aria-pressed={mediaType === type} disabled={busy}
            style={{ ...styles.choice, ...(mediaType === type ? styles.active : {}) }} onClick={() => { setMediaType(type); setError('') }}>
            {type === 'audio' ? <PhoneCall size={24} /> : <VideoCamera size={24} />}{type === 'audio' ? tr("语音通话") : tr("视频通话")}
          </button>)}
        </div>
        <button type="button" disabled={busy} style={{ ...styles.button, ...styles.primary, opacity: busy ? .6 : 1 }} onClick={() => { void create() }}>{busy ? '正在准备邀请…' : '生成邀请链接'}</button>
      </> : <>
        <dl style={styles.meta}>
          <div style={styles.row}><dt>{tr("通话类型")}</dt><dd style={{ margin: 0 }}>{link.mediaType === 'video' ? tr("视频通话") : tr("语音通话")}</dd></div>
          <div style={styles.row}><dt>{tr("有效期")}</dt><dd style={{ margin: 0 }}>{expired ? '已过期' : '30 分钟内可重复呼叫'}</dd></div>
          <div style={styles.row}><dt>{tr("失效时间")}</dt><dd style={{ margin: 0 }}>{new Date(link.expiresAtMillis).toLocaleString(arkmeIntlLocale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</dd></div>
        </dl>
        <textarea aria-label={tr("通话邀请链接")} style={styles.link} readOnly value={link.callUrl} onFocus={event => { event.currentTarget.select() }} />
        {expired ? <button type="button" disabled={busy} style={{ ...styles.button, ...styles.primary }} onClick={() => { void create() }}>{busy ? '正在生成…' : '重新生成邀请链接'}</button>
          : <div style={styles.choices}>
            <button type="button" style={styles.button} onClick={() => { void share(false) }}>{tr("复制链接")}</button>
            <button type="button" style={{ ...styles.button, ...styles.primary }} onClick={() => { void share(true) }}>{tr("分享邀请")}</button>
          </div>}
        <p style={styles.hint}>{tr("可关闭此弹窗。保持桌面端登录并运行，即可接听对方来电。")}</p>
      </>}
      {status !== '' && <p role="status" style={styles.hint}>{status}</p>}
      {error !== '' && <p role="alert" style={styles.error}>{error}</p>}
    </div>
  </ArkmeConfirmDialog>
}
