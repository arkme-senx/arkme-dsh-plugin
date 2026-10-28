import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { arkmeTheme as colors } from '../arkme-theme.js'
import { tr, useArkmeLocale, arkmeIntlLocale } from '../locale.js'
import { RecordingTranscriptButton } from './RecordingTranscriptButton.js'
import { recordingSpeakerColor } from './recording-speaker-presentation.js'

/** Presentation only. Source-level strategies and day-level enhancement retain their own data and command owners. */
export function RecordingComparisonView({ scope, description, notices, children, onClose }: {
  scope: string; description?: ReactNode; notices?: ReactNode; children: ReactNode; onClose(): void
}) {
  useArkmeLocale()
  const dialog = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    closeButton.current?.focus()
    return () => { if (previous instanceof HTMLElement) previous.focus() }
  }, [])
  useEffect(() => {
    // Completing an action can remove the focused button and leave focus on body.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
      if (event.key !== 'Tab' || !dialog.current) return
      const controls = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),summary,[tabindex="0"]'))
      const outside = !dialog.current.contains(document.activeElement)
      if (event.shiftKey && (outside || document.activeElement === controls[0])) { event.preventDefault(); controls.at(-1)?.focus() }
      else if (!event.shiftKey && (outside || document.activeElement === controls.at(-1))) { event.preventDefault(); controls[0]?.focus() }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])
  return createPortal(<div ref={dialog} role="dialog" aria-modal="true" aria-label={tr('转写对比')} style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', flexDirection: 'column', background: colors.layer2, color: colors.text }}>
    <header style={{ minHeight: 58, flex: 'none', padding: '0 20px', display: 'flex', alignItems: 'center', gap: 16, borderBottom: `1px solid ${colors.border}` }}>
      <strong style={{ fontSize: 18, fontWeight: 600, flexShrink: 0 }}>{tr('转写对比')}</strong>
      <span title={scope} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: colors.secondary, fontSize: 12 }}>{scope}</span>
      <RecordingTranscriptButton ref={closeButton} onClick={onClose} aria-label={tr('关闭转写对比')} style={{ border: 0, padding: 4, flexShrink: 0, display: 'grid', placeItems: 'center', background: 'transparent' }}><X size={20} /></RecordingTranscriptButton>
    </header>
    <div style={{ flex: 'none', padding: '8px 20px', display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 12, color: colors.secondary, borderBottom: `1px solid ${colors.border}` }}>
      {description}<span>{tr('双击发言播放，或选中后按回车键。')}</span>
    </div>
    {notices}
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', flex: 1, minHeight: 0 }}>{children}</div>
  </div>, document.body)
}

export function RecordingComparisonColumn({ title, kind, actions, children }: {
  title: string; kind: '正式结果' | '对比结果'; actions?: ReactNode; children: ReactNode
}) {
  return <section aria-label={`${title} · ${kind}`} style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, borderInlineEnd: `1px solid ${colors.border}` }}>
    <header style={{ minHeight: 46, flex: 'none', padding: '6px 20px', boxSizing: 'border-box', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h3>
      <small style={{ color: colors.secondary }}>{kind}</small>
      {actions}
    </header>
    {children}
  </section>
}

type ComparisonPagination = {
  cursor?: string | undefined
  loading: boolean
  error: string
  next(): Promise<unknown>
}

/** Only viewport loading is shared; each comparison keeps its own cursor and data owner. */
export function RecordingComparisonPane({ pagination, children }: { pagination?: ComparisonPagination; children: ReactNode }) {
  const pane = useRef<HTMLDivElement | null>(null)
  const requested = useRef<string>()
  const latest = useRef(pagination); latest.current = pagination
  const fill = () => {
    const element = pane.current, page = latest.current
    if (!element || element.clientHeight <= 0 || !page?.cursor || page.loading || page.error || requested.current === page.cursor) return
    if (element.scrollHeight - element.scrollTop - element.clientHeight >= 400) return
    // A pending page may return the same cursor. Do not busy-loop that cursor;
    // the result owner refreshes it when processing advances, or the user retries.
    requested.current = page.cursor
    void page.next().catch(() => undefined)
  }
  useEffect(() => { fill() })
  useEffect(() => {
    const element = pane.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(fill); observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return <div ref={pane} onScroll={fill} style={{ overflowY: 'auto', overflowWrap: 'anywhere', minWidth: 0, minHeight: 0, flex: 1, overscrollBehavior: 'contain', padding: '12px 20px 24px' }}>
    {children}
    {pagination?.loading && <p role="status" style={{ color: colors.secondary, fontSize: 12 }}>{tr('正在加载…')}</p>}
    {pagination?.error && <div role="alert" style={{ color: colors.danger, fontSize: 12 }}>{pagination.error} <RecordingTranscriptButton disabled={pagination.loading} onClick={() => { requested.current = undefined; void pagination.next().catch(() => undefined) }}>{tr('重试')}</RecordingTranscriptButton></div>}
  </div>
}

export function RecordingComparisonRow({ speaker, colorIndex, startAtMillis, endAtMillis, text, active, background, playLabel, onPlay }: {
  speaker: string; colorIndex: number; startAtMillis: number; endAtMillis: number; text: string; active: boolean; background?: boolean; playLabel: string; onPlay(): void
}) {
  const time = new Date(startAtMillis).toLocaleTimeString(arkmeIntlLocale(), { hour12: false })
  const duration = Math.max(0, (endAtMillis - startAtMillis) / 1000)
  return <div role="button" tabIndex={0} aria-label={playLabel} title={tr('双击播放')} data-transcript-time={startAtMillis}
    onDoubleClick={onPlay} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onPlay() } }}
    style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '4px 10px', marginBottom: 6, padding: 4, borderRadius: 6, background: active ? colors.active : 'transparent', cursor: 'default', fontSize: 14, lineHeight: '22px' }}>
    <span style={{ display: 'flex', gap: 8, flex: 'none', maxWidth: '100%', alignItems: 'flex-start' }}>
      <span aria-hidden style={{ width: 12, height: 12, flexShrink: 0, marginTop: 5, borderRadius: '50%', background: recordingSpeakerColor(colorIndex) }} />
      <span title={speaker} style={{ width: 78, minWidth: 0, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{speaker}</span>
    </span>
    {background && <small style={{ flex: 'none', color: colors.secondary }}>{tr('背景音')}</small>}
    <span style={{ flex: '1 1 120px', minWidth: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</span>
    <time style={{ flex: 'none', fontSize: 12, color: colors.secondary }}>{time} · {duration > 0 && duration < 1 ? '<1' : Math.floor(duration)}{tr('秒')}</time>
  </div>
}
