import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ListChecks } from '@phosphor-icons/react/dist/icons/ListChecks'
import type { ArkmeSourceItem } from '../types.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { arkmeUi } from './ui-controller.js'
import { useConversationArrangements } from './use-conversation-arrangements.js'
import { arkmeIntlLocale, tr } from './locale.js'
import css from './conversation-arrangements.css?inline'

const status = { identified: '已识别', following: '跟进中', completed: '已完成', unknown: '状态未知' }
function time(value?: number) {
  return value && Number.isFinite(new Date(value).getTime())
    ? new Intl.DateTimeFormat(arkmeIntlLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(value) : tr('未定时间')
}
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
  const count = data.error ? ' !' : data.loading && !data.items.length ? ' …'
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
    {open && host && createPortal(<ArkmeDetailShell title={`${tr('相关安排')} · ${source.displayName}`} label={tr('相关安排')}
      widthPreferenceKey="conversation-arrangements" onClose={close} returnFocusRef={button}
      onPointerDownOutside={event => { if (!(event.target instanceof Node) || !button.current?.contains(event.target)) close() }}
      bodyStyle={{ padding: 18 }} footerHidden>
      <div className="arkme-related-arrangements">
        <p className="arkme-related-arrangements-footnote">{tr('仅显示我在此对话中的安排')}</p>
        <div className="arkme-related-arrangements-tabs">
          <button type="button" aria-pressed={!completed} onClick={() => setCompleted(false)}>{tr('未完成')} {data.error || data.loading ? '—' : `${unfinished.length}${data.hasMore ? '+' : ''}`} </button>
          <button type="button" aria-pressed={completed} onClick={() => setCompleted(true)}>{tr('已完成')} {data.error || data.loading ? '—' : `${finished.length}${data.hasMore ? '+' : ''}`} </button>
          <button type="button" disabled={data.loading} onClick={data.refresh}>{tr('刷新')}</button>
        </div>
        {data.loading && <p role="status">{tr('正在读取相关安排…')}</p>}
        {data.error && <p role="alert">{data.error} <button type="button" onClick={data.refresh}>{tr('重试')}</button></p>}
        {!data.loading && !data.error && !rows.length && <p className="arkme-related-arrangements-empty">{tr(data.hasMore ? '已加载的结果中暂无此类安排，可以继续加载' : completed ? '我在当前对话中暂无已完成安排' : '我在当前对话中暂无未完成安排')}</p>}
        {rows.map(item => <article key={item.id}>
          <button type="button" className="arkme-related-arrangement-title" onClick={() => { if (item.arrangementRef) manage(item.arrangementRef) }}>{item.title || tr('未命名安排')}</button>
          <div className="arkme-related-arrangement-meta"><span>{time(item.dueAtMillis)}</span><span>{tr(status[item.status])}</span></div>
          {item.description && <p className="arkme-related-arrangement-description">{item.description}</p>}
          {item.arrangementRef && <button type="button" className="arkme-related-arrangement-link" onClick={() => manage(item.arrangementRef!)}>{tr('查看详情与来源')} ↗</button>}
        </article>)}
        {data.hasMore && <button type="button" disabled={data.loading} onClick={() => { void data.loadMore() }}>{tr('加载更多')}</button>}
      </div>
    </ArkmeDetailShell>, host)}
  </>
}
