import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ListChecks } from '@phosphor-icons/react/dist/icons/ListChecks'
import { ArrowClockwise } from '@phosphor-icons/react/dist/icons/ArrowClockwise'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type { ArkmeArrangementItem, ArkmeSourceItem } from '../types.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { ArkmeArrangementCompletionControl, arrangementCompletionChecked } from './ArkmeArrangementCompletionControl.js'
import { ArkmeRelatedArrangementDialog } from './ArkmeRelatedArrangementDialog.js'
import { useRelatedArrangementActions } from './use-related-arrangement-actions.js'
import { useConversationArrangements } from './use-conversation-arrangements.js'
import { arkmeIntlLocale, tr } from './locale.js'
import css from './conversation-arrangements.css?inline'

function time(value?: number) {
  return value && Number.isFinite(new Date(value).getTime())
    ? new Intl.DateTimeFormat(arkmeIntlLocale(), { ...(new Date(value).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {}), month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(value) : ''
}
const normalize = (text: string) => text.trim().replace(/\s+/gu, ' ')
type Props = { source: ArkmeSourceItem; accountScope: string; active: boolean; refreshRevision: number }
export function ArkmeConversationArrangements(props: Props) {
  return <ConversationArrangements key={`${props.accountScope}:${props.source.conversationRef ?? props.source.sourceKey ?? props.source.sourceRef}`} {...props} />
}
function ConversationArrangements({ source, accountScope, active, refreshRevision }: Props) {
  const [open, setOpen] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [host, setHost] = useState<Element | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const [selected, setSelected] = useState<string>(), [latestItem, setLatestItem] = useState<ArkmeArrangementItem>()
  const [now, setNow] = useState(Date.now)
  const actions = useRelatedArrangementActions(active, accountScope, item => { data.updateItem(item); setLatestItem(item) },
    ref => { data.removeItem(ref); if (selected === ref) setSelected(undefined) })
  const data = useConversationArrangements(source.conversationRef ?? source.sourceRef, active, refreshRevision, !!selected || !!actions.pending)
  useEffect(() => { setHost(button.current?.closest('[data-arkme-active-conversation-identity]') ?? null) }, [])
  useEffect(() => { if (!active) { setOpen(false); setSelected(undefined) } }, [active])
  useEffect(() => {
    if (!active || !open) return
    const tick = () => setNow(Date.now()); tick()
    const timer = setInterval(tick, 60_000); window.addEventListener('focus', tick)
    return () => { clearInterval(timer); window.removeEventListener('focus', tick) }
  }, [active, open])
  const unfinished = data.items.filter(item => item.status !== 'completed')
  const finished = data.items.filter(item => item.status === 'completed')
  const rows = (completed ? finished : unfinished).slice().sort((a, b) => (a.dueAtMillis ?? Infinity) - (b.dueAtMillis ?? Infinity) || a.id.localeCompare(b.id))
  const initialLoading = data.loading && !data.hasLoaded
  const count = data.error && !data.hasLoaded ? ' !' : !data.hasLoaded ? ' …'
    : data.hasMore ? unfinished.length ? ` · ${unfinished.length}+` : '' : ` · ${unfinished.length}`
  const close = () => setOpen(false)
  const notice = actions.notice && <div className="arkme-related-arrangements-notice" role={actions.notice.error ? 'alert' : 'status'}>
    <span>{actions.notice.text}</span>
    {actions.notice.undo && <button type="button" disabled={!!actions.pending} onClick={() => { void actions.undo() }}>{tr('撤销')}</button>}
    <button type="button" aria-label={tr('关闭提示')} onClick={actions.dismissNotice}><X size={14} /></button>
  </div>
  return <>
    <style>{css}</style>
    <button ref={button} type="button" className="arkme-related-arrangements-entry" aria-haspopup="dialog" aria-expanded={open}
      aria-label={tr('相关安排')} title={data.error || tr('查看我在当前对话中的安排')}
      onMouseDown={event => { event.preventDefault() }}
      onClick={event => { event.stopPropagation(); setOpen(value => !value) }}>
      <ListChecks size={16} aria-hidden /><span>{tr('相关安排')}{count}</span>
    </button>
    {open && host && createPortal(<ArkmeDetailShell title={tr('相关安排')} label={tr('相关安排')}
      className="arkme-conversation-arrangements-panel"
      headerContent={<div className="arkme-related-arrangements-header">
        <div className="arkme-related-arrangements-heading">
          <h3>{tr('相关安排')}</h3>
          <button type="button" className="arkme-related-arrangements-refresh" disabled={data.loading || !!actions.pending} onClick={data.refresh}
            aria-label={tr('刷新相关安排')} title={tr('刷新')}>
            <ArrowClockwise size={17} aria-hidden className={data.loading && data.loadKind !== 'more' ? 'arkme-related-arrangements-spinning' : undefined} />
          </button>
        </div>
        <p className="arkme-related-arrangements-scope" title={source.displayName}>{source.displayName} · {tr('仅显示我在此对话中的安排')}</p>
        <div className="arkme-related-arrangements-tabs" role="group" aria-label={tr('安排状态')}>
          <button type="button" aria-pressed={!completed} onClick={() => setCompleted(false)}>{tr('未完成')}</button>
          <button type="button" aria-pressed={completed} onClick={() => setCompleted(true)}>{tr('已完成')}</button>
        </div>
      </div>}
      widthPreferenceKey="conversation-arrangements" onClose={close} returnFocusRef={button}
      onPointerDownOutside={event => { if (!selected && (!(event.target instanceof Node) || !button.current?.contains(event.target))) close() }}
      bodyStyle={{ padding: '0 16px' }} footerHidden>
      <div className="arkme-related-arrangements">
        {!selected && notice}
        {initialLoading && <div className="arkme-related-arrangements-skeleton" role="status" aria-label={tr('正在读取相关安排…')}>
          {[0, 1, 2].map(n => <div key={n} aria-hidden><span /><span /></div>)}
        </div>}
        {data.error && data.failedKind !== 'more' && <div className="arkme-related-arrangements-error" role="alert">
          <span>{data.hasLoaded && <>{tr('刷新失败，保留上次结果')} · </>}{data.error}</span>
          <button type="button" onClick={() => { void data.retry() }}>{tr('重试')}</button>
        </div>}
        {!data.loading && !data.error && !rows.length && <p className="arkme-related-arrangements-empty">{tr(data.hasMore ? '已加载的结果中暂无此类安排，可以继续加载' : completed ? '我在当前对话中暂无已完成安排' : '我在当前对话中暂无未完成安排')}</p>}
        {rows.map(item => {
          const date = time(item.dueAtMillis)
          const overdue = !!date && item.status !== 'completed' && item.dueAtMillis! < now
          const working = actions.pending === item.arrangementRef
          const phase = working ? actions.phase : undefined
          return <article key={item.id} className="arkme-arrangement-completion-row" data-completed={arrangementCompletionChecked(item.status, phase)}>
          <span className="arkme-related-arrangement-completion-slot"><ArkmeArrangementCompletionControl title={item.title} status={item.status} phase={phase}
            disabled={!item.arrangementRef || !!actions.pending || data.loading} busy={working}
            onToggle={() => { if (item.arrangementRef) void actions.toggleComplete({ arrangementRef: item.arrangementRef, status: item.status }) }} /></span>
          <button type="button" className="arkme-related-arrangement-row" disabled={!item.arrangementRef}
            aria-label={item.title || tr('未命名安排')} onClick={() => { if (item.arrangementRef) { setLatestItem(undefined); setSelected(item.arrangementRef) } }}>
            <span className="arkme-related-arrangement-heading"><span className="arkme-related-arrangement-title arkme-arrangement-completion-title">{item.title || tr('未命名安排')}</span>
              {date && <time dateTime={new Date(item.dueAtMillis!).toISOString()} data-overdue={overdue} title={overdue ? tr('已过期') : undefined}
                aria-label={overdue ? `${date}，${tr('已过期')}` : undefined}>{date}</time>}
            </span>
            {(item.status === 'following' || item.status === 'unknown') && <span className="arkme-related-arrangement-meta">
              {item.status === 'following' && <span className="arkme-related-arrangement-status">{tr('跟进中')}</span>}
              {item.status === 'unknown' && <span>{tr('状态未知')}</span>}
            </span>}
            {normalize(item.description) && normalize(item.description) !== normalize(item.title) && <span className="arkme-related-arrangement-description">{item.description}</span>}
          </button>
        </article>})}
        {data.error && data.failedKind === 'more' && <div className="arkme-related-arrangements-error" role="alert"><span>{data.error}</span>
          <button type="button" onClick={() => { void data.retry() }}>{tr('重试加载')}</button></div>}
        {data.hasLoaded && <div className="arkme-related-arrangements-pagination">
          <span>{tr('已加载{count}条', { count: data.items.length })}</span>
          {data.hasMore && !(data.error && data.failedKind === 'more') && <button type="button" disabled={data.loading || !!actions.pending} onClick={() => { void data.loadMore() }}>{tr(data.loadKind === 'more' ? '加载中…' : '加载更多')}</button>}
        </div>}
      </div>
    </ArkmeDetailShell>, host)}
    {selected && active && <ArkmeRelatedArrangementDialog key={`${accountScope}:${selected}`} arrangementRef={selected} accountScope={accountScope}
      latestItem={latestItem} busy={!!actions.pending} notice={notice} onClose={() => setSelected(undefined)}
      onApplied={item => { data.updateItem(item, selected); setLatestItem(item); if (item.arrangementRef !== selected) setSelected(item.arrangementRef) }}
      onComplete={actions.toggleComplete} onDelete={actions.deleteItem} onReminder={actions.toggleReminder} />}
  </>
}
