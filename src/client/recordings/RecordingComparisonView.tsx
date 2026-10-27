import { useEffect, useRef, type ReactNode, type Ref, type UIEvent } from 'react'
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
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    closeButton.current?.focus()
    return () => { if (previous instanceof HTMLElement) previous.focus() }
  }, [])
  return createPortal(<div role="dialog" aria-modal="true" aria-label={tr('转写对比')} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose() }
    if (event.key === 'Tab') {
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),[tabindex="0"]'))
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
    }
  }} style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', flexDirection: 'column', background: colors.layer2, color: colors.text }}>
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

export function RecordingComparisonPane({ paneRef, onScroll, children }: { paneRef?: Ref<HTMLDivElement>; onScroll?(event: UIEvent<HTMLDivElement>): void; children: ReactNode }) {
  return <div ref={paneRef} onScroll={onScroll} style={{ overflowY: 'auto', overflowWrap: 'anywhere', minWidth: 0, minHeight: 0, flex: 1, overscrollBehavior: 'contain', padding: '12px 20px 24px' }}>{children}</div>
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

/** Align the visible time, never speaker numbers or row indexes from independent algorithms. */
export function useRecordingComparisonScroll() {
  const columns = useRef<Array<HTMLDivElement | null>>([])
  const synchronized = useRef<{ element: HTMLDivElement; top: number }>()
  const synchronize = (event: UIEvent<HTMLDivElement>, column: number) => {
    const element = event.currentTarget
    if (synchronized.current?.element === element && Math.abs(synchronized.current.top - element.scrollTop) < 2) return
    const top = element.getBoundingClientRect().top
    const first = Array.from(element.querySelectorAll<HTMLElement>('[data-transcript-time]')).find(row => row.getBoundingClientRect().bottom > top)
    const other = columns.current[1 - column]
    if (!first || !other) return
    const time = Number(first.dataset.transcriptTime)
    const nearest = Array.from(other.querySelectorAll<HTMLElement>('[data-transcript-time]')).reduce<HTMLElement | undefined>((best, row) => !best || Math.abs(Number(row.dataset.transcriptTime) - time) < Math.abs(Number(best.dataset.transcriptTime) - time) ? row : best, undefined)
    if (!nearest) return
    const nextTop = Math.max(0, Math.min(other.scrollHeight - other.clientHeight, other.scrollTop + nearest.getBoundingClientRect().top - other.getBoundingClientRect().top))
    synchronized.current = { element: other, top: nextTop }; other.scrollTop = nextTop
  }
  return { columns, synchronize }
}
