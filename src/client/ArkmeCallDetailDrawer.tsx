import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { XIcon } from '@phosphor-icons/react/dist/csr/X'
import { ClockIcon } from '@phosphor-icons/react/dist/csr/Clock'
import { TimerIcon } from '@phosphor-icons/react/dist/csr/Timer'
import type { ArkmeCallDetail, ArkmeTimelineItem } from '../types.js'
import { callArkme } from './api.js'
import { arkmeTheme } from './arkme-theme.js'
import { ArkmeCallTranscript } from './ArkmeCallTranscript.js'
import { ArkmeCallVideoClips } from './ArkmeCallVideoClips.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown'
import { CaretUpIcon } from '@phosphor-icons/react/dist/csr/CaretUp'

const styles: Record<string, CSSProperties> = {
  drawer: { position: 'absolute', inset: '0 0 0 auto', zIndex: 10, width: 'min(460px, 100%)', minWidth: 0, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', background: arkmeTheme.base, color: arkmeTheme.text, boxShadow: '-12px 0 28px rgba(29,32,40,.08)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 16px 12px', flex: 'none' },
  close: { display: 'grid', placeItems: 'center', width: 28, height: 28, padding: 0, border: 0, background: 'transparent', color: arkmeTheme.tertiary, cursor: 'pointer', flex: 'none' },
  overview: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, padding: '12px 16px 16px', fontSize: 12, flex: 'none' },
  cell: { display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, fontVariantNumeric: 'tabular-nums' },
  content: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '0 16px 20px' },
  state: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: arkmeTheme.tertiary, fontSize: 12, textAlign: 'center' },
  retry: { border: `1px solid ${arkmeTheme.border}`, borderRadius: 6, background: arkmeTheme.base, color: arkmeTheme.secondary, padding: '5px 10px', cursor: 'pointer', font: 'inherit' },
}

export function callDetailDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '--:--'
  const value = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

function startTime(millis: number): string {
  if (!Number.isFinite(millis) || millis <= 0) return '--:--'
  return new Date(millis).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function ArkmeCallDetailDrawer({ item, onClose }: { item: ArkmeTimelineItem; onClose: () => void }) {
  const [detail, setDetail] = useState<ArkmeCallDetail>()
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [participantsOpen, setParticipantsOpen] = useState(true)
  const closeButton = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const callRef = item.callRecord?.callRef
  useEffect(() => {
    const controller = new AbortController()
    setDetail(undefined)
    setError('')
    setLoading(true)
    if (!callRef) {
      setError('通话详情暂不可用，请刷新对话后重试')
      setLoading(false)
      return () => { controller.abort() }
    }
    void callArkme<ArkmeCallDetail>('calls.history.detail', { callRef }, controller.signal).then(value => {
      if (!controller.signal.aborted) setDetail(value)
    }).catch(() => {
      if (!controller.signal.aborted) setError('通话详情加载失败')
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => { controller.abort() }
  }, [callRef, item.itemUid, revision])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    closeButton.current?.focus({ preventScroll: true })
    const element = panel.current
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      onCloseRef.current()
    }
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('keydown', escape)
      if (trigger?.isConnected && (document.activeElement === document.body || element?.contains(document.activeElement))) trigger.focus({ preventScroll: true })
    }
  }, [])

  const mediaType = detail?.mediaType === 'unknown' ? item.callRecord?.mediaType : detail?.mediaType ?? item.callRecord?.mediaType
  const video = mediaType === 'video'
  const icon = `${video ? 'video' : 'call'}-${item.callRecord?.direction ?? (item.isMe ? 'outgoing' : 'incoming')}-linear.svg`
  const iconColor = (detail?.acceptedAtMillis ?? 0) > 0 ? arkmeTheme.accent : arkmeTheme.danger
  const segments = detail?.transcriptSegments ?? []
  return <aside ref={panel} role="dialog" aria-label="通话详情" data-arkme-call-detail="true" style={styles.drawer}>
    <header style={styles.header}>
      <h3 style={{ margin: 0, fontSize: 18, lineHeight: '26px', fontWeight: 600 }}>通话详情</h3>
      <button ref={closeButton} type="button" aria-label="关闭通话详情" title="关闭" style={styles.close} onClick={onClose}><XIcon size={24} /></button>
    </header>
    <div style={styles.overview}>
      <span style={styles.cell}><span aria-hidden style={{ width: 12, height: 12, flex: '0 0 12px', background: iconColor, mask: `url("/arkme-self/api/call/${icon}") center / contain no-repeat`, WebkitMask: `url("/arkme-self/api/call/${icon}") center / contain no-repeat` }} />{video ? '视频通话' : '语音通话'}</span>
      <span style={{ ...styles.cell, justifyContent: 'center' }}><ClockIcon size={14} color={arkmeTheme.tertiary} aria-hidden />{startTime(detail?.startedAtMillis || item.callRecord?.startedAtMillis || item.sendAtMillis)}</span>
      <span style={{ ...styles.cell, justifyContent: 'flex-end' }}><TimerIcon size={14} color={arkmeTheme.tertiary} aria-hidden />{callDetailDuration(detail?.durationSeconds ?? item.callRecord?.durationSeconds)}</span>
    </div>
    <div style={styles.content} aria-busy={loading}>
      {loading ? <div role="status" style={styles.state}>加载中…</div>
        : error ? <div role="alert" style={styles.state}>{error}{callRef && <button type="button" style={styles.retry} onClick={() => { setRevision(value => value + 1) }}>重试</button>}</div>
          : <>
            {detail?.summaryText && <p data-arkme-call-summary="true" style={{ margin: '4px 0 0', padding: '10px 12px', border: `1px solid ${arkmeTheme.borderSoft}`, borderRadius: 12, background: arkmeTheme.layer1, color: arkmeTheme.secondary, fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>AI 摘要：{detail.summaryText}</p>}
            {detail && <ArkmeCallVideoClips key={detail.callRef} detail={detail} />}
            {segments.length > 0 && detail ? <ArkmeCallTranscript detail={detail} /> : <div role="status" style={styles.state}>{detail?.transcriptFailed ? '转写失败' : detail?.transcriptPending ? '转写处理中' : '暂无转写内容'}
              {(detail?.transcriptFailed || detail?.transcriptPending) && <button type="button" style={styles.retry} onClick={() => { setRevision(value => value + 1) }}>刷新</button>}
            </div>}
          </>}
    </div>
    {!loading && !error && detail && detail.participants.length > 0 && <footer style={{ flex: 'none', borderRadius: '18px 18px 0 0', background: arkmeTheme.base, boxShadow: '0 -8px 24px rgba(29,32,40,.08)', padding: '0 16px 14px' }}>
      <button type="button" aria-label={participantsOpen ? '收起参与者' : '展开参与者'} title={participantsOpen ? '收起参与者' : '展开参与者'} aria-expanded={participantsOpen} onClick={() => { setParticipantsOpen(value => !value) }} style={{ display: 'grid', placeItems: 'center', width: '100%', height: 24, padding: 0, border: 0, background: 'transparent', color: arkmeTheme.tertiary, cursor: 'pointer' }}>{participantsOpen ? <CaretDownIcon size={18} /> : <CaretUpIcon size={18} />}</button>
      {participantsOpen && <ul aria-label="通话参与者" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 120, overflowY: 'auto' }}>
        {detail.participants.map((participant, index) => <li key={participant.userId ?? `${participant.displayName}:${index}`} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px 4px 4px', minWidth: 0, maxWidth: '100%', border: `1px solid ${arkmeTheme.borderSoft}`, borderRadius: 20, background: arkmeTheme.layer1, color: arkmeTheme.secondary, fontSize: 12 }}>
          <ArkmeUserAvatar size={24} label={`${participant.displayName}的头像`} {...(participant.avatarRef ? { avatarRef: participant.avatarRef } : {})} />
          <span style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{participant.displayName}</span>
        </li>)}
      </ul>}
    </footer>}
  </aside>
}
