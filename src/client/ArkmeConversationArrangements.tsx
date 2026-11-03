import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ListChecks } from '@phosphor-icons/react/dist/icons/ListChecks'
import type { ArkmeConversationArrangement, ArkmeSourceItem } from '../types.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { arkmeUi } from './ui-controller.js'
import { arkmeTheme } from './arkme-theme.js'
import { callArkme } from './api.js'
import { withArkmeReadDeadline } from './read-deadline.js'
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
  const [selected, setSelected] = useState<ArkmeConversationArrangement>()
  const [host, setHost] = useState<Element | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const data = useConversationArrangements(source.conversationRef ?? source.sourceRef, active, refreshRevision)
  useEffect(() => { setHost(button.current?.closest('[data-arkme-active-conversation-identity]') ?? null) }, [])
  useEffect(() => { if (!active) setOpen(false); if (!active || data.error) setSelected(undefined) }, [active, data.error])
  useEffect(() => {
    if (data.loading || data.error || !selected) return
    const fresh = data.items.find(item => item.id === selected.id)
    if (!fresh || fresh.relatedRef !== selected.relatedRef) setSelected(fresh)
  }, [data.items, data.loading, data.error, selected])
  const unfinished = data.items.filter(item => item.status !== 'completed')
  const finished = data.items.filter(item => item.status === 'completed')
  const rows = (completed ? finished : unfinished).slice().sort((a, b) => (a.dueAtMillis ?? Infinity) - (b.dueAtMillis ?? Infinity) || a.id.localeCompare(b.id))
  const count = data.error ? ' !' : data.loading && !data.items.length ? ' …'
    : data.hasMore ? unfinished.length ? ` · ${unfinished.length}+` : '' : ` · ${unfinished.length}`
  const close = () => { setOpen(false); setSelected(undefined) }
  const locate = (e: ArkmeConversationArrangement['sources'][number]) => {
    close(); arkmeUi.showConversationTarget(source, e.itemUid, e.sendAtMillis, e.recordOwnerUserId, undefined, true)
  }
  return <>
    <style>{css}</style>
    <button ref={button} type="button" className="arkme-related-arrangements-entry" aria-haspopup="dialog" aria-expanded={open}
      aria-label={tr('相关安排')} title={data.error || tr('查看当前对话识别出的安排')}
      onMouseDown={event => { event.preventDefault() }}
      onClick={event => { event.stopPropagation(); setOpen(value => !value) }}>
      <ListChecks size={16} aria-hidden /><span>{tr('相关安排')}{count}</span>
    </button>
    {open && host && createPortal(<ArkmeDetailShell title={`${tr('相关安排')} · ${source.displayName}`} label={tr('相关安排')}
      widthPreferenceKey="conversation-arrangements" onClose={close} returnFocusRef={button}
      onPointerDownOutside={event => { if (!(event.target instanceof Node) || !button.current?.contains(event.target)) close() }}
      {...(selected ? { onBack: () => setSelected(undefined), backLabel: tr('返回相关安排') } : {})}
      bodyStyle={{ padding: 18 }} footerHidden>
      {selected ? <ConversationArrangementDetail key={selected.relatedRef} item={selected} source={source} onLocate={locate}
        onManage={ref => { close(); arkmeUi.showArrangements(ref) }} /> : <div className="arkme-related-arrangements">
        <div className="arkme-related-arrangements-tabs">
          <button type="button" aria-pressed={!completed} onClick={() => setCompleted(false)}>{tr('未完成')} {data.error || data.loading ? '—' : `${unfinished.length}${data.hasMore ? '+' : ''}`} </button>
          <button type="button" aria-pressed={completed} onClick={() => setCompleted(true)}>{tr('已完成')} {data.error || data.loading ? '—' : `${finished.length}${data.hasMore ? '+' : ''}`} </button>
          <button type="button" disabled={data.loading} onClick={data.refresh}>{tr('刷新')}</button>
        </div>
        {data.loading && <p role="status">{tr('正在读取相关安排…')}</p>}
        {data.error && <p role="alert">{data.error} <button type="button" onClick={data.refresh}>{tr('重试')}</button></p>}
        {!data.loading && !data.error && !rows.length && <p className="arkme-related-arrangements-empty">{tr(data.hasMore ? '已加载的结果中暂无此类安排，可以继续加载' : completed ? '当前对话暂无已完成安排' : '当前对话暂无未完成安排')}</p>}
        {rows.map(item => <article key={item.id}>
          <button type="button" className="arkme-related-arrangement-title" onClick={() => setSelected(item)}>{item.title || tr('未命名安排')}</button>
          <div className="arkme-related-arrangement-meta"><span>{time(item.dueAtMillis)}</span><span>{tr(status[item.status])}</span></div>
          {item.sources[0] && <><small>{item.sources[0].sender || tr('会话成员')} · {time(item.sources[0].sendAtMillis)}</small>
            <blockquote>{item.sources[0].text}</blockquote>
            <button type="button" className="arkme-related-arrangement-link" onClick={() => locate(item.sources[0]!)}>{tr('定位原消息')} ↗</button></>}
        </article>)}
        {data.hasMore && <button type="button" disabled={data.loading} onClick={() => { void data.loadMore() }}>{tr('加载更多')}</button>}
        <p className="arkme-related-arrangements-footnote">{tr('仅展示当前对话产生的安排内容。个人补充和提醒在自己的安排中管理。')}</p>
      </div>}
    </ArkmeDetailShell>, host)}
  </>
}

function ConversationArrangementDetail({ item, source, onLocate, onManage }: {
  item: ArkmeConversationArrangement; source: ArkmeSourceItem;
  onLocate(e: ArkmeConversationArrangement['sources'][number]): void; onManage(ref: string): void
}) {
  const [detail, setDetail] = useState<ArkmeConversationArrangement>()
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [expanded, setExpanded] = useState(false)
  useEffect(() => {
    const controller = new AbortController(); setDetail(undefined); setError('')
    void withArkmeReadDeadline(signal => callArkme<ArkmeConversationArrangement>('arrangements.conversation.detail', {
      sourceRef: source.conversationRef ?? source.sourceRef, relatedRef: item.relatedRef,
    }, signal), controller.signal).then(value => {
      if (!controller.signal.aborted) { if (value.relatedRef !== item.relatedRef || value.id !== item.id) throw new Error('相关安排已变化，请返回刷新'); setDetail(value) }
    }).catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : tr('安排加载失败')) })
    return () => controller.abort()
  }, [source.sourceRef, item.relatedRef, attempt])
  if (error) return <p role="alert">{error} <button type="button" onClick={() => setAttempt(n => n + 1)}>{tr('重试')}</button></p>
  if (!detail) return <p role="status">{tr('正在读取安排详情…')}</p>
  return <div className="arkme-related-arrangement-detail">
    <h2 data-expanded={expanded}>{detail.title}</h2>
    {detail.title.length > 40 && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{tr(expanded ? '收起标题' : '展开完整标题')}</button>}
    <div className="arkme-related-arrangement-meta"><span>{time(detail.dueAtMillis)}</span><span>{tr(status[detail.status])}</span></div>
    {detail.description && <p>{detail.description}</p>}
    <h3>{tr('来源对话')}</h3>
    <strong>{tr(source.kind === 'group_chat' ? '群聊' : '私聊')} · {source.displayName}</strong>
    {detail.sources.map((e, index) => <section key={`${e.itemUid}:${index}`}>
      <small>{e.sender || tr('会话成员')} · {time(e.sendAtMillis)}</small><blockquote>{e.text}</blockquote>
      <button type="button" className="arkme-related-arrangement-link" onClick={() => onLocate(e)}>{tr('定位原消息')} ↗</button>
    </section>)}
    {detail.arrangementRef && <button type="button" onClick={() => onManage(detail.arrangementRef!)}>{tr('管理我的安排')} ↗</button>}
    <p style={{ color: arkmeTheme.tertiary, fontSize: 12 }}>{tr('此处展示对话识别内容，修改和完成沿用原安排权限。')}</p>
  </div>
}
