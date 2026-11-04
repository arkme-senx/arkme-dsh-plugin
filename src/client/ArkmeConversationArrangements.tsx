import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ListChecks } from '@phosphor-icons/react/dist/icons/ListChecks'
import { ArrowClockwise } from '@phosphor-icons/react/dist/icons/ArrowClockwise'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import type { ArkmeSourceItem } from '../types.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { arkmeUi } from './ui-controller.js'
import { useConversationArrangements } from './use-conversation-arrangements.js'
import { arkmeIntlLocale, tr } from './locale.js'
import css from './conversation-arrangements.css?inline'

function time(value?: number) {
  return value && Number.isFinite(new Date(value).getTime())
    ? new Intl.DateTimeFormat(arkmeIntlLocale(), { ...(new Date(value).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {}), month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(value) : tr('未定时间')
}
const normalize = (text: string) => text.trim().replace(/\s+/gu, ' ')
type Props = { source: ArkmeSourceItem; accountScope: string; active: boolean; refreshRevision: number }
export function ArkmeConversationArrangements(props: Props) {
  return <ConversationArrangements key={`${props.accountScope}:${props.source.conversationRef ?? props.source.sourceKey ?? props.source.sourceRef}`} {...props} />
}
function ConversationArrangements({ source, active, refreshRevision }: Props) {
  const [open, setOpen] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [host, setHost] = useState<Element | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const data = useConversationArrangements(source.conversationRef ?? source.sourceRef, active, refreshRevision)
  useEffect(() => { setHost(button.current?.closest('[data-arkme-active-conversation-identity]') ?? null) }, [])
  useEffect(() => { if (!active) setOpen(false) }, [active])
  const unfinished = data.items.filter(item => item.status !== 'completed')
  const finished = data.items.filter(item => item.status === 'completed')
  const rows = (completed ? finished : unfinished).slice().sort((a, b) => (a.dueAtMillis ?? Infinity) - (b.dueAtMillis ?? Infinity) || a.id.localeCompare(b.id))
  const initialLoading = data.loading && !data.hasLoaded
  const count = data.error && !data.hasLoaded ? ' !' : !data.hasLoaded ? ' …'
    : data.hasMore ? unfinished.length ? ` · ${unfinished.length}+` : '' : ` · ${unfinished.length}`
  const close = () => setOpen(false)
  const manage = (ref: string) => { close(); arkmeUi.showArrangements(ref) }
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
          <button type="button" className="arkme-related-arrangements-refresh" disabled={data.loading} onClick={data.refresh}
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
      onPointerDownOutside={event => { if (!(event.target instanceof Node) || !button.current?.contains(event.target)) close() }}
      bodyStyle={{ padding: '0 16px' }} footerHidden>
      <div className="arkme-related-arrangements">
        {initialLoading && <div className="arkme-related-arrangements-skeleton" role="status" aria-label={tr('正在读取相关安排…')}>
          {[0, 1, 2].map(n => <div key={n} aria-hidden><span /><span /></div>)}
        </div>}
        {data.error && data.failedKind !== 'more' && <div className="arkme-related-arrangements-error" role="alert">
          <span>{data.hasLoaded && <>{tr('刷新失败，保留上次结果')} · </>}{data.error}</span>
          <button type="button" onClick={() => { void data.retry() }}>{tr('重试')}</button>
        </div>}
        {!data.loading && !data.error && !rows.length && <p className="arkme-related-arrangements-empty">{tr(data.hasMore ? '已加载的结果中暂无此类安排，可以继续加载' : completed ? '我在当前对话中暂无已完成安排' : '我在当前对话中暂无未完成安排')}</p>}
        {rows.map(item => <article key={item.id}>
          <button type="button" className="arkme-related-arrangement-row" disabled={!item.arrangementRef}
            aria-label={item.title || tr('未命名安排')} onClick={() => { if (item.arrangementRef) manage(item.arrangementRef) }}>
            <span className="arkme-related-arrangement-title">{item.title || tr('未命名安排')}</span>
            <span className="arkme-related-arrangement-meta"><span>{time(item.dueAtMillis)}</span>
              {item.status === 'following' && <span className="arkme-related-arrangement-status">{tr('跟进中')}</span>}
              {item.status === 'unknown' && <span>{tr('状态未知')}</span>}
            </span>
            {normalize(item.description) && normalize(item.description) !== normalize(item.title) && <span className="arkme-related-arrangement-description">{item.description}</span>}
            {item.arrangementRef && <CaretRight className="arkme-related-arrangement-chevron" size={15} aria-hidden />}
          </button>
        </article>)}
        {data.error && data.failedKind === 'more' && <div className="arkme-related-arrangements-error" role="alert"><span>{data.error}</span>
          <button type="button" onClick={() => { void data.retry() }}>{tr('重试加载')}</button></div>}
        {data.hasLoaded && <div className="arkme-related-arrangements-pagination">
          <span>{tr('已加载{count}条', { count: data.items.length })}</span>
          {data.hasMore && !(data.error && data.failedKind === 'more') && <button type="button" disabled={data.loading} onClick={() => { void data.loadMore() }}>{tr(data.loadKind === 'more' ? '加载中…' : '加载更多')}</button>}
        </div>}
      </div>
    </ArkmeDetailShell>, host)}
  </>
}
