import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type { ArkmeRecordingArrangementPage } from '../../types.js'
import { callArkme } from '../api.js'
import { ArkmeArrangementContent } from '../ArkmeArrangementContent.js'
import { arrangementColumnLabels } from '../arrangement-board-model.js'
import { arkmeIntlLocale, tr, useArkmeLocale } from '../locale.js'
import { withArkmeReadDeadline } from '../read-deadline.js'
import { arkmeUi } from '../ui-controller.js'
import '../arrangement-board.css'

type Props = { dateStamp: number; accountScope: string; active: boolean; refreshRevision: string }

export function RecordingDayArrangements(props: Props) {
  return <DayArrangements key={`${props.accountScope}:${props.dateStamp}`} {...props} />
}

function DayArrangements({ dateStamp, accountScope, active, refreshRevision }: Props) {
  useArkmeLocale()
  const [page, setPage] = useState<ArkmeRecordingArrangementPage>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<string>()
  const [query, setQuery] = useState({ offset: 0, revision: 0, snapshotVersion: '' })
  const refresh = () => setQuery(previous => ({ offset: 0, revision: previous.revision + 1, snapshotVersion: '' }))
  const tzOffsetMillis = -new Date(dateStamp).getTimezoneOffset() * 60_000
  useEffect(() => {
    if (!active || !accountScope) { setOpen(false); if (query.offset) refresh(); return }
    const controller = new AbortController()
    setLoading(true); setError(false)
    void withArkmeReadDeadline(signal => callArkme<ArkmeRecordingArrangementPage>('arrangements.recording-day', {
      dateStamp, tzOffsetMillis, limit: 20, offset: query.offset,
      ...(query.snapshotVersion ? { snapshotVersion: query.snapshotVersion } : {}),
    }, signal), controller.signal).then(next => {
      if (controller.signal.aborted) return
      setPage(previous => {
        if (!query.offset || !previous || previous.state === 'unavailable' || next.state === 'unavailable') return next
        const seen = new Set(previous.items.map(item => item.arrangementRef))
        return { ...next, items: [...previous.items, ...next.items.filter(item => !seen.has(item.arrangementRef))] }
      })
    }).catch(() => { if (!controller.signal.aborted) { setError(true); if (!query.offset) setPage(undefined) } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [accountScope, active, dateStamp, tzOffsetMillis, query, refreshRevision])
  useEffect(() => {
    if (!active || !accountScope) return
    // Returning from the arrangement board must reflect its current statuses.
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [active, accountScope])
  useEffect(() => {
    if (!active || loading || error || page?.state !== 'processing') return
    const timer = setTimeout(refresh, 15_000)
    return () => clearTimeout(timer)
  }, [active, loading, error, page])

  const value = !page ? (loading ? '—' : tr('暂不可用')) : page.state === 'unavailable' ? tr('暂不可用')
    : page.state === 'ready' ? tr('{count} 项', { count: page.total }) : page.total > 0 ? tr('已识别 {count} 项', { count: page.total }) : tr(page.state === 'processing' ? '处理中' : '暂不可用')
  return <>
    <button type="button" className="arkme-recording-arrangement-entry" aria-haspopup="dialog" title={tr('查看当天录音识别的安排')}
      onClick={() => { setOpen(true); refresh() }}>{tr('识别安排')} {value}<CaretRight size={12} aria-hidden /></button>
    {open && active && typeof document !== 'undefined' && createPortal(<RecordingArrangementDrawer dateStamp={dateStamp} page={page} loading={loading} error={error}
      expanded={expanded} onToggle={ref => setExpanded(current => current === ref ? undefined : ref)} onClose={() => setOpen(false)} onRefresh={refresh}
      onMore={() => { if (page && page.state !== 'unavailable' && page.hasMore && page.nextOffset !== undefined) setQuery(previous => ({ offset: page.nextOffset!, revision: previous.revision + 1, snapshotVersion: page.snapshotVersion })) }} />, document.body)}
  </>
}

function RecordingArrangementDrawer({ dateStamp, page, loading, error, expanded, onToggle, onClose, onRefresh, onMore }: {
  dateStamp: number; page: ArkmeRecordingArrangementPage | undefined; loading: boolean; error: boolean; expanded: string | undefined
  onToggle(ref: string): void; onClose(): void; onRefresh(): void; onMore(): void
}) {
  const panel = useRef<HTMLElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    close.current?.focus()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  const date = new Date(dateStamp).toLocaleDateString(arkmeIntlLocale(), { year: 'numeric', month: 'long', day: 'numeric' })
  return <div className="arkme-arrangement-create-overlay" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <aside ref={panel} role="dialog" aria-modal="true" aria-label={tr('当天录音识别的安排')} className="arkme-arrangement-create arkme-recording-arrangements" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
      if (event.key === 'Tab') {
        const nodes = panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
        const first = nodes?.[0], last = nodes?.[nodes.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}>
      <header><h2>{tr('识别安排')}</h2><button ref={close} type="button" aria-label={tr('关闭')} onClick={onClose}><X size={20} aria-hidden /></button></header>
      <div className="arkme-recording-arrangements-body">
        <p className="arkme-recording-arrangements-date">{date}</p>
        <p>{tr('由当天录音总结识别，与安排板块保持同步。')}</p>
        {page && page.state !== 'unavailable' && (page.state === 'ready' || page.total > 0) && <strong>{tr(page.state === 'ready' ? '共 {count} 项' : '已识别 {count} 项', { count: page.total })}</strong>}
        {loading && <p role="status">{tr('加载中…')}</p>}
        {error && <p role="alert">{tr('识别安排加载失败，请刷新重试。')}</p>}
        {page?.state === 'unavailable' && <p role="status">{tr('当天录音与安排的关联暂不可用，已有安排仍可在安排板块查看。')}</p>}
        {page?.state === 'processing' && <p role="status">{tr('录音安排仍在整理，当前数量可能不完整。')}</p>}
        {page?.state === 'partial' && <p role="status">{tr('历史录音来源尚不完整，当前仅显示已确认的安排。')}</p>}
        {!loading && page?.state === 'ready' && page.total === 0 && <p role="status">{tr('当天录音尚未识别出安排')}</p>}
        <div className="arkme-day-arrangements">{page?.items.map(item => <article className="arkme-arrangement-card" key={item.arrangementRef}>
          <button type="button" className="arkme-day-arrangement-summary" aria-expanded={expanded === item.arrangementRef} onClick={() => onToggle(item.arrangementRef)}>
            <span className="arkme-day-arrangement-heading"><strong>{item.title}</strong><span className="arkme-day-arrangement-status" data-arrangement-status={item.status}>{tr(item.status === 'unknown' ? '安排' : arrangementColumnLabels[item.status])}</span></span>
            {item.dueAtMillis !== undefined && <small>{tr('安排时间')}：{new Date(item.dueAtMillis).toLocaleString(arkmeIntlLocale())}</small>}
          </button>
          <ArkmeArrangementContent item={item} expanded={expanded === item.arrangementRef} onSourceNavigate={onClose} />
        </article>)}</div>
        {page?.hasMore && <button type="button" disabled={loading || error} onClick={onMore}>{tr('加载更多')}</button>}
      </div>
      <footer><button type="button" disabled={loading} onClick={onRefresh}>{tr('刷新')}</button><button type="button" onClick={() => { onClose(); arkmeUi.showArrangements() }}>{tr('前往安排')}</button></footer>
    </aside>
  </div>
}
