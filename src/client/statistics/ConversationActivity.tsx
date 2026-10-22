import { useEffect, useRef, useState } from 'react'
import { ChartBar } from '@phosphor-icons/react/dist/icons/ChartBar'
import type { ArkmeSourceItem } from '../../types.js'
import type { ConversationWordsQuery } from '../../conversation-word-frequency.js'
import type { ConversationActivityBucket, ConversationActivityMessage, ConversationActivityMessages, ConversationActivityResult, ConversationActivitySelection } from '../../conversation-activity.js'
import { arkmeTheme } from '../arkme-theme.js'
import { arkmeIntlLocale, tr } from '../locale.js'
import { callArkme } from '../api.js'
import { withArkmeReadDeadline } from '../read-deadline.js'
import { arkmeUi } from '../ui-controller.js'
import { useConversationActivity } from './use-conversation-activity.js'

export const conversationActivityStyles = `
.ca-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:16px 0}
.ca-metrics strong{display:block;font-size:21px;line-height:1.5;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.ca-bars{height:156px;display:grid;grid-template-columns:repeat(24,minmax(0,1fr));gap:3px;border-bottom:1px solid ${arkmeTheme.borderSoft};padding-top:10px}
.conversation-words .ca-bar{display:flex;flex-direction:column;justify-content:end;border:0;padding:0;border-radius:3px 3px 0 0;background:transparent;position:relative}
.ca-bar>span{width:100%;display:flex;flex-direction:column;border-radius:3px 3px 0 0;overflow:hidden;min-height:2px}
.ca-bar i{display:block;width:100%}.ca-user{background:${arkmeTheme.accent}}.ca-system{background:${arkmeTheme.tertiary}}
.conversation-words .ca-bar[aria-pressed=true]{outline:2px solid ${arkmeTheme.accent};outline-offset:1px}
.ca-axis{display:flex;justify-content:space-between;font-size:10px;color:${arkmeTheme.secondary};margin:7px 0}
.ca-week{display:grid;grid-template-columns:25px repeat(24,minmax(0,1fr));gap:3px;align-items:center;margin-top:12px}
.ca-week>span{font-size:11px;color:${arkmeTheme.secondary}}
.conversation-words .ca-cell{height:20px;border:0;border-radius:3px;padding:0;min-width:0;position:relative;background:color-mix(in srgb,${arkmeTheme.accent} var(--ca-density),${arkmeTheme.subtle})}
.ca-cell i{display:block;position:absolute;bottom:0;left:0;right:0;background:${arkmeTheme.tertiary};border-radius:0 0 3px 3px}
.conversation-words .ca-cell:disabled{opacity:1;background:${arkmeTheme.subtle}}
.ca-hint{min-height:42px;margin:10px 0;font-size:12px;color:${arkmeTheme.secondary}}
.ca-legend{display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:11px;color:${arkmeTheme.secondary};margin-top:10px}
.ca-legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px}
.ca-peak{font-size:12px;line-height:1.6;margin:12px 0 20px}
`
const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00–${String(hour + 1).padStart(2, '0')}:00`
const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const bucketLabel = (b: ConversationActivitySelection) => `${b.weekday === null ? '' : `${tr(weekdays[b.weekday - 1]!)} `}${hourLabel(b.hour)}`
const localTime = (at: number, timezone: string) => new Intl.DateTimeFormat(arkmeIntlLocale(), { timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(at)
const kindLabels: Record<ConversationActivityMessage['kind'], string> = { text: '文字', image: '图片', voice: '语音', video: '视频', file: '文件', call: '通话', mixed: '混合消息', card: '卡片', system: '系统通知', other: '其他消息' }

export function ConversationActivity({ query, source, refreshRevision, onSupport, onClose }: {
  query: ConversationWordsQuery; source: ArkmeSourceItem; refreshRevision: string; onSupport(value: boolean): void; onClose(): void
}) {
  const owner = useConversationActivity(query, refreshRevision), [view, setView] = useState<'day' | 'week'>('day'), [selected, setSelected] = useState<ConversationActivitySelection>()
  const result = owner.state?.result
  useEffect(() => { onSupport(owner.state?.supported === true); return () => onSupport(false) }, [owner.state?.supported, onSupport])
  useEffect(() => setSelected(undefined), [result?.id])
  return <><style>{conversationActivityStyles}</style>
    <div className="cw-controls"><span className="cw-muted" style={{ marginRight: 'auto' }}>{tr('所有消息类型 · 按发送时间统计')}</span><button disabled={owner.loading} onClick={() => void owner.read()}>{tr(owner.loading ? '读取中…' : '刷新统计')}</button></div>
    {owner.error && <p role="alert">{owner.error}</p>}
    {owner.loading && !owner.state && <p role="status">{tr('正在读取活跃时间…')}</p>}
    {owner.state && !owner.state.supported && <div className="cw-empty"><ChartBar size={36}/><strong>{tr('会话活跃时间服务尚未接通')}</strong><p>{tr('接通后，可查看完整聊天历史中各时段的消息量，包括文字、图片、语音、视频和文件等。')}</p></div>}
    {owner.state?.progress && <p role="status">{tr('正在整理历史消息')} · {owner.state.progress.completed.toLocaleString()} / {owner.state.progress.total.toLocaleString()}</p>}
    {owner.state?.stale && <p role="status">{tr('会话已有更新，当前显示上次统计结果。')}</p>}
    {result && <>
      <div className="ca-metrics"><div><span className="cw-muted">{tr('消息总量')}</span><strong>{result.totalMessages.toLocaleString()}</strong></div><div><span className="cw-muted">{tr('活跃天数')}</span><strong>{result.activeDays.toLocaleString()}</strong></div><div><span className="cw-muted">{tr('参与人数')}</span><strong>{result.participants.toLocaleString()}</strong></div></div>
      <p className="cw-muted">{result.fromAt !== null && result.toAt !== null && <>{localTime(result.fromAt, query.timezone)} — {localTime(result.toAt, query.timezone)}<br/></>}{query.timezone}{result.systemMessages > 0 && ` · ${tr('含系统通知')} ${result.systemMessages} ${tr('条')}`}</p>
      {selected ? <ActivityMessages key={`${result.id}:${selected.weekday}:${selected.hour}`} query={query} selection={selected} resultId={result.id} source={source} onBack={() => setSelected(undefined)} onClose={onClose}/>
        : result.totalMessages === 0 ? <p className="cw-empty">{tr('此范围暂无消息活动')}</p> : <>
          <div className="cw-controls" role="group" aria-label={tr('活跃分布视图')}><button aria-pressed={view === 'day'} onClick={() => setView('day')}>{tr('一天内')}</button><button aria-pressed={view === 'week'} onClick={() => setView('week')}>{tr('一周内')}</button></div>
          <ActivityChart key={view} result={result} weekly={view === 'week'} onSelect={setSelected}/>
        </>}
    </>}
  </>
}

export function ActivityChart({ result, weekly, onSelect }: { result: ConversationActivityResult; weekly: boolean; onSelect(b: ConversationActivitySelection): void }) {
  const [hovered, setHovered] = useState<ConversationActivityBucket>()
  const bins = weekly ? result.weekly : result.hourly, max = Math.max(1, ...bins.map(b => b.messages))
  const peaks = bins.filter(b => b.messages === max)
  const description = (b: ConversationActivityBucket) => `${bucketLabel(b)} · ${b.messages.toLocaleString()} ${tr('条消息')} · ${(b.messages / Math.max(1, result.totalMessages) * 100).toFixed(1)}% · ${b.participants} ${tr('人')}${b.systemMessages ? ` · ${tr('系统通知')} ${b.systemMessages} ${tr('条')}` : ''}`
  const props = (b: ConversationActivityBucket) => ({ 'aria-label': description(b), disabled: b.messages === 0, onMouseEnter: () => setHovered(b), onFocus: () => setHovered(b), onClick: () => onSelect({ hour: b.hour, weekday: b.weekday }) })
  return <div onMouseLeave={() => setHovered(undefined)}>
    {weekly ? <><div className="ca-week" aria-label={tr('每周时段消息热力图')}>{weekdays.map((day, index) => <div key={day} style={{ display: 'contents' }}><span>{tr(day)}</span>{bins.filter(b => b.weekday === index + 1).map(b => <button key={b.hour} className="ca-cell" {...props(b)} style={{ '--ca-density': `${b.messages ? 20 + 80 * b.messages / max : 0}%` } as React.CSSProperties}>{b.systemMessages > 0 && <i style={{ height: `${b.systemMessages / b.messages * 100}%` }}/>}</button>)}</div>)}</div><div className="ca-axis" style={{ paddingLeft: 28 }}>{['00', '06', '12', '18', '24'].map(h => <span key={h}>{h}</span>)}</div></>
      : <><div className="ca-bars" aria-label={tr('一天内各小时消息量')}>{bins.map(b => <button key={b.hour} className="ca-bar" {...props(b)}><span style={{ height: `${b.messages / max * 100}%` }}>{b.systemMessages > 0 && <i className="ca-system" style={{ height: `${b.systemMessages / b.messages * 100}%` }}/>}<i className="ca-user" style={{ flex: 1 }}/></span></button>)}</div><div className="ca-axis">{['00:00', '06:00', '12:00', '18:00', '24:00'].map(h => <span key={h}>{h}</span>)}</div></>}
    <div className="ca-legend"><span><i className="ca-user"/>{tr('聊天消息')}</span>{result.systemMessages > 0 && <span><i className="ca-system"/>{tr('系统通知')}</span>}{weekly && <span>{tr('颜色越深，消息越多')}</span>}</div>
    <div className="ca-hint" aria-live="polite">{hovered ? description(hovered) : tr('悬浮查看数量，点击时段查看原消息')}</div>
    {peaks.length > 0 && <p className="ca-peak">{tr('最活跃时段')}：{peaks.slice(0, 3).map(bucketLabel).join('、')}{peaks.length > 3 && ` ${tr('等')} ${peaks.length} ${tr('个并列时段')}`} · {tr('各')} {max.toLocaleString()} {tr('条')}</p>}
  </div>
}

function ActivityMessages({ query, resultId, selection, source, onBack, onClose }: { query: ConversationWordsQuery; resultId: string; selection: ConversationActivitySelection; source: ArkmeSourceItem; onBack(): void; onClose(): void }) {
  const [data, setData] = useState<ConversationActivityMessages>(), [loading, setLoading] = useState(false), [error, setError] = useState(''), [sourceError, setSourceError] = useState(''), [opening, setOpening] = useState('')
  const controller = useRef<AbortController>(), sourceController = useRef<AbortController>(), busy = useRef(false)
  const load = async (cursor: string | null = null) => {
    if (busy.current) return
    busy.current = true; const c = new AbortController(); controller.current = c; setLoading(true); setError('')
    try {
      const page = await withArkmeReadDeadline(signal => callArkme<ConversationActivityMessages>('chat.activity.messages', { ...query, resultId, ...selection, cursor }, signal), c.signal)
      if (cursor && page.nextCursor === cursor) throw new Error(tr('消息分页未推进，请重新打开时段'))
      if (!c.signal.aborted) setData(old => ({ ...page, items: cursor ? [...new Map([...(old?.items ?? []), ...page.items].map(m => [m.key, m])).values()] : page.items }))
    } catch (e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : tr('时段消息读取失败')) }
    finally { busy.current = false; if (!c.signal.aborted) setLoading(false) }
  }
  useEffect(() => { void load(); return () => { controller.current?.abort(); sourceController.current?.abort() } }, [])
  const locate = async (message: ConversationActivityMessage) => {
    if (!message.sourceRef) return
    sourceController.current?.abort(); const c = new AbortController(); sourceController.current = c; setOpening(message.key); setSourceError('')
    try {
      const target = await withArkmeReadDeadline(signal => callArkme<{ messageUid: string; sendAtMillis: number; recordOwnerUserId: import('../../record-owner-id.js').RecordOwnerId }>('chat.activity.source', { ...query, resultId, ...selection, messageSourceRef: message.sourceRef }, signal), c.signal)
      if (!c.signal.aborted) { onClose(); arkmeUi.showConversationTarget(source, target.messageUid, target.sendAtMillis, target.recordOwnerUserId) }
    } catch (e) { if (!c.signal.aborted) setSourceError(e instanceof Error ? e.message : tr('原消息不可查看')) }
    finally { if (!c.signal.aborted) setOpening('') }
  }
  return <section aria-label={tr('活跃时段消息')}><button onClick={onBack}>{tr('返回分布')}</button><h3>{bucketLabel(selection)}</h3><p className="cw-muted">{tr('当前筛选范围内的消息')}{data && ` · ${data.total} ${tr('条')}`}</p>
    {sourceError && <p role="alert">{sourceError}</p>}
    {data?.items.map(m => <article className="cw-message" key={m.key}><strong>{m.senderName}</strong><div className="cw-muted"><time>{localTime(m.sentAt, query.timezone)}</time> · {tr(kindLabels[m.kind])}</div><p>{m.preview || `[${tr(kindLabels[m.kind])}]`}</p><button disabled={!m.sourceRef || !!opening} onClick={() => void locate(m)}>{tr(opening === m.key ? '正在定位…' : '定位消息')}</button>{!m.sourceRef && <small className="cw-muted"> {tr('原消息暂不可用')}</small>}</article>)}
    {loading && <p role="status">{tr('正在读取时段消息…')}</p>}{error && <p role="alert">{error}<button onClick={() => void load(data?.nextCursor ?? null)}>{tr('重试')}</button></p>}
    {!loading && !error && data?.items.length === 0 && <p>{tr('暂无可查看的消息，请刷新统计核对。')}</p>}
    {data?.nextCursor && !error && <button disabled={loading} onClick={() => void load(data.nextCursor)}>{tr('加载更多消息')}</button>}
  </section>
}
