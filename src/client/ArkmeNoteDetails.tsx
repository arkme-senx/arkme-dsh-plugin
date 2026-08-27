import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react'
import { XIcon as X } from '@phosphor-icons/react/dist/csr/X'
import type { ArkmeForwardRecordPreviewItem, ArkmeTimelineItem } from '../types.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmeMessageContent } from './ArkmeRichContent.js'
import { arkmeTheme } from './arkme-theme.js'
import { ARKME_CONVERSATION_HEADER_HEIGHT } from './interwoven-moments.js'

const styles: Record<string, CSSProperties> = {
  drawer: { position: 'absolute', top: ARKME_CONVERSATION_HEADER_HEIGHT, right: 0, bottom: 0, zIndex: 10,
    width: 'min(372px, 100%)', minWidth: 0, boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
    background: arkmeTheme.base, color: arkmeTheme.text, borderLeft: `1px solid ${arkmeTheme.borderSoft}`,
    boxShadow: '-12px 0 28px rgba(29,32,40,.055)' },
  header: { flex: 'none', display: 'flex', alignItems: 'flex-start', gap: 10, padding: '22px 20px 0 22px' },
  heading: { flex: 1, minWidth: 0 },
  title: { margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 600, overflowWrap: 'anywhere' },
  subtitle: { marginTop: 8, color: arkmeTheme.tertiary, fontSize: 12, lineHeight: '18px' },
  close: { width: 30, height: 30, marginTop: -3, flex: 'none', display: 'grid', placeItems: 'center', padding: 0,
    border: 0, borderRadius: 8, background: 'transparent', color: arkmeTheme.tertiary, cursor: 'pointer' },
  body: { flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', padding: '24px 22px' },
  rows: { display: 'flex', flexDirection: 'column', gap: 23 },
  row: { display: 'flex', gap: 9, alignItems: 'flex-start' },
  content: { flex: 1, minWidth: 0 },
  meta: { display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 6 },
  name: { flex: 1, minWidth: 0, overflowWrap: 'anywhere', color: arkmeTheme.secondary, fontSize: 12, fontWeight: 600 },
  time: { flex: 'none', color: arkmeTheme.tertiary, fontSize: 11, lineHeight: '18px' },
  footer: { flex: 'none', textAlign: 'center', padding: '12px 22px 20px', color: arkmeTheme.tertiary, fontSize: 11, lineHeight: '18px' },
  notice: { margin: '12px 0 0', fontSize: 12, color: arkmeTheme.tertiary, lineHeight: '20px' },
  toggle: { margin: '14px 0', border: 0, borderRadius: 8, padding: '6px 9px', background: arkmeTheme.hover, color: arkmeTheme.secondary, cursor: 'pointer', fontSize: 12 },
}

function epoch(value: number): number {
  return Number.isFinite(value) && value > 0 && value < 8.64e15 ? value < 1e12 ? value * 1000 : value : 0
}

function dateLabel(value: number): string {
  const time = epoch(value)
  return time === 0 ? '' : new Date(time).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

function timeLabel(value: number): string {
  const time = epoch(value)
  return time === 0 ? '' : new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function offsetLabel(value: number): string {
  const seconds = Math.floor(Math.max(0, value) / 1000)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

/** Non-modal overlay: the conversation retains its width and scroll position. */
function NoteDetailShell({ title, label, subtitle, footer, onClose, children }: {
  title: string; label: string; subtitle?: string; footer?: string; onClose: () => void; children: ReactNode
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const titleId = useId()
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    closeRef.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      // A portal preview owns Escape until it is closed; do not close both layers.
      if (event.key !== 'Escape' || event.defaultPrevented
        || document.querySelector('[data-arkme-image-preview-viewport], [aria-modal="true"]') !== null) return
      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current()
    }
    const panel = panelRef.current
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const active = document.activeElement
      if (trigger?.isConnected && (active === document.body || active === null || panel?.contains(active))) trigger.focus({ preventScroll: true })
    }
  }, [])
  return <aside ref={panelRef} role="dialog" aria-label={label} aria-labelledby={titleId} style={styles.drawer} data-arkme-note-detail="true">
    <header style={styles.header}>
      <div style={styles.heading}><h3 id={titleId} style={styles.title}>{title}</h3>
        {subtitle && <div style={styles.subtitle}>{subtitle}</div>}
      </div>
      <button ref={closeRef} type="button" style={styles.close} aria-label="关闭详情" onClick={onClose}><X size={18} /></button>
    </header>
    <div style={styles.body}>{children}</div>
    {footer && <footer style={styles.footer}>{footer}</footer>}
  </aside>
}

export function arkmeTimelineDetailSenderText(item: ArkmeTimelineItem): string {
  return item.agentSource === undefined ? item.senderName : `${item.senderName} · ${item.agentSource.label}`
}

export function ArkmeTimelineDetailDrawer({
  item, sourceRef, showOriginal, onClose, onToggleOriginal, shareWebsite, onMessageCopyLinkOpen,
}: {
  item: ArkmeTimelineItem
  sourceRef?: string | undefined
  showOriginal: boolean
  onClose: () => void
  onToggleOriginal: () => void
  shareWebsite?: string
  onMessageCopyLinkOpen?: (sid: string) => void
}) {
  const textContent = showOriginal && item.aiPolish?.originalText !== undefined ? item.aiPolish.originalText
    : item.aiPolish?.state === 'polished' && item.aiPolish.polishedText !== undefined ? item.aiPolish.polishedText : item.textContent
  const canToggle = item.aiPolish?.state === 'polished' && item.aiPolish.originalText !== undefined && item.aiPolish.polishedText !== undefined
  return <NoteDetailShell title="快记详情" label="快记详情" onClose={onClose}>
    <div style={{ ...styles.row, alignItems: 'center', marginBottom: 20 }}>
      <ArkmeUserAvatar {...(item.avatarRef === undefined ? {} : { avatarRef: item.avatarRef })} size={40} label="作者头像" />
      <div style={styles.content}><div style={styles.name}>{arkmeTimelineDetailSenderText(item)}</div>
        <div style={{ ...styles.time, marginTop: 4 }}>{[dateLabel(item.sendAtMillis), timeLabel(item.sendAtMillis)].filter(Boolean).join(' ')}</div>
      </div>
    </div>
    {canToggle && <button type="button" style={styles.toggle} onClick={onToggleOriginal}>{showOriginal ? '显示润色' : '显示原文'}</button>}
    <div data-arkme-timeline-detail-rich-content>
      <ArkmeMessageContent
        presentation="detail"
        item={{ ...item, textContent }}
        {...(sourceRef === undefined ? {} : { sourceRef })}
        {...(shareWebsite === undefined ? {} : { shareWebsite })}
        {...(onMessageCopyLinkOpen === undefined ? {} : { onMessageCopyLinkOpen })}
      />
    </div>
  </NoteDetailShell>
}

function ForwardDetailRow({ name, time, avatarRef, segment = false, children }: {
  name: string; time: string; avatarRef?: string | undefined; segment?: boolean; children: ReactNode
}) {
  return <div style={styles.row} {...(segment ? { 'data-arkme-forward-segment': 'true' } : {})}>
    <ArkmeUserAvatar {...(avatarRef === undefined ? {} : { avatarRef })} size={30} label={segment ? '转写说话人头像' : '转发消息头像'} />
    <div style={styles.content}>
      <div style={styles.meta}><span style={styles.name}>{name}</span><span style={styles.time}>{time}</span></div>
      {children}
    </div>
  </div>
}

export function ForwardRecordsDetail({ item, onClose }: { item: ArkmeTimelineItem; onClose: () => void }) {
  const forward = item.forwardRecords
  if (forward === undefined) return null
  const dates = forward.items.map(value => epoch(value.sendAtMillis)).filter(value => value > 0)
  const firstDate = dateLabel(dates.length ? Math.min(...dates) : forward.createdAtMillis)
  const lastDate = dateLabel(dates.length ? Math.max(...dates) : forward.createdAtMillis)
  const rows: ArkmeForwardRecordPreviewItem[] = forward.items.length ? forward.items : forward.summaryLines.map(line => {
    const separator = line.search(/[：:]/u)
    return { senderName: separator > 0 ? line.slice(0, separator) : item.senderName, sendAtMillis: 0, title: '', textContent: separator > 0 ? line.slice(separator + 1) : line }
  })
  const renderRecord = (value: ArkmeForwardRecordPreviewItem, index: number) => {
    const segments = value.segments ?? []
    const joinedTranscript = segments.map(segment => segment.textContent).join('').replace(/\s/gu, '')
    const hasDistinctText = value.textContent.trim() !== '' && value.textContent.replace(/\s/gu, '') !== joinedTranscript
    const snapshot: ArkmeTimelineItem = {
      itemUid: `${item.itemUid}-forward-${String(index)}`, senderName: value.senderName, isMe: false, sendAtMillis: value.sendAtMillis,
      status: 1, title: value.title,
      textContent: value.textContent || ((value.contentBlocks?.length ?? 0) === 0 ? value.contentLabel ?? '' : ''),
      ...(value.contentBlocks === undefined ? {} : { contentBlocks: value.contentBlocks }),
      ...(value.mediaUnavailable === undefined ? {} : { mediaUnavailable: value.mediaUnavailable }),
    }
    const hasRecordBody = segments.length === 0 || hasDistinctText || (value.contentBlocks?.length ?? 0) > 0
    return <div key={index} style={styles.rows}>
      {hasRecordBody && <ForwardDetailRow name={value.senderName} avatarRef={value.avatarRef}
        time={`${firstDate !== lastDate ? `${dateLabel(value.sendAtMillis)} ` : ''}${timeLabel(value.sendAtMillis)}`}>
        {segments.length === 0 ? <ArkmeMessageContent item={snapshot} presentation="detail" /> : <>
          {hasDistinctText && <div style={{ marginBottom: 18 }}><ArkmeMessageContent item={{ ...snapshot, contentBlocks: [], mediaUnavailable: false }} presentation="detail" /></div>}
          {(value.contentBlocks?.length ?? 0) > 0 && <ArkmeMessageContent item={{ ...snapshot, title: '', textContent: '', mediaUnavailable: false }} presentation="detail" />}
        </>}
      </ForwardDetailRow>}
      {/* Snapshot speaker labels are not account identities. Never reuse the recording author's photo for another speaker. */}
      {segments.map((segment, segmentIndex) => <ForwardDetailRow key={segmentIndex} segment name={segment.speakerName}
        time={`${offsetLabel(segment.startMillis)}–${offsetLabel(segment.endMillis)}`}>
        <ArkmeMessageContent presentation="detail" item={{ ...snapshot, itemUid: `${snapshot.itemUid}-${String(segmentIndex)}`,
          senderName: segment.speakerName, title: '', textContent: segment.textContent,
          contentBlocks: segment.contentBlocks ?? [], mediaUnavailable: segment.mediaUnavailable === true }} />
      </ForwardDetailRow>)}
      {segments.length > 0 && value.mediaUnavailable && <p style={styles.notice}>部分媒体暂时无法加载，请刷新对话后重试</p>}
      {value.truncated && <p style={styles.notice}>内容较多，当前展示部分转发内容</p>}
    </div>
  }
  const forwardedAt = [dateLabel(forward.createdAtMillis), timeLabel(forward.createdAtMillis)].filter(Boolean).join(' ')
  return <NoteDetailShell title={forward.title || '转发快记'} label="转发快记详情"
    subtitle={firstDate === lastDate ? firstDate : `${firstDate} 至 ${lastDate}`}
    footer={forwardedAt ? `转发于 ${forwardedAt}` : '转发时间未知'} onClose={onClose}>
    <div style={styles.rows}>{rows.map(renderRecord)}</div>
    {rows.length === 0 && <p style={styles.notice}>原快记暂不可查看</p>}
    {forward.truncated && <p style={styles.notice}>内容较多，当前展示部分转发记录</p>}
  </NoteDetailShell>
}
