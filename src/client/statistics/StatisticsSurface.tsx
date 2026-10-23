import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ChartBar } from '@phosphor-icons/react/dist/icons/ChartBar'
import { CaretLeft } from '@phosphor-icons/react/dist/icons/CaretLeft'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { ArrowClockwise } from '@phosphor-icons/react/dist/icons/ArrowClockwise'
import { statisticsDateKey, statisticsDuration, statisticsQuery, type StatisticsDetail, type StatisticsPoint, type StatisticsRecord, type StatisticsRecordPage, type StatisticsKeyword } from '../../statistics-contract.js'
import type { ArkmeCalendarBucketPage, ArkmeRecordSearchResult, ArkmeTimelineItem } from '../../types.js'
import { callArkme } from '../api.js'
import { withArkmeReadDeadline } from '../read-deadline.js'
import { ArkmeDetailShell } from '../ArkmeDetailShell.js'
import { ArkmeTimelineDetailDrawer } from '../ArkmeNoteDetails.js'
import { useMembership } from '../arkme-membership.js'
import { arkmeTheme as theme } from '../arkme-theme.js'
import { arkmeUi } from '../ui-controller.js'
import { tr, useArkmeLocale, arkmeIntlLocale } from '../locale.js'
import { statisticsError, useStatistics, type StatisticsResource } from './use-statistics.js'
import { StatisticsKeywordList, StatisticsKeywords } from './StatisticsKeywords.js'

const formatNumber = (v: number | null | undefined) => v == null ? '—' : v.toLocaleString(arkmeIntlLocale())
function Resource<T>({ resource, retry, children }: { resource: StatisticsResource<T>; retry(): void; children(value: T): ReactNode }) {
  if (resource.loading) return <p className="stats-status" role="status">{tr('正在读取…')}</p>
  if (resource.error) return <div className="stats-status" role="alert">{resource.error}<button onClick={retry}>{tr('重试')}</button></div>
  return resource.value === undefined ? null : children(resource.value)
}
function Change({ value }: { value: number | null | undefined }) {
  if (value == null) return null
  return <small className="stats-change">{tr('较上月')} {value > 0 ? '+' : ''}{(value * 100).toFixed(1)}%</small>
}
const palette = { '--stats-bg': theme.base, '--stats-layer': theme.layer1, '--stats-text': theme.text, '--stats-muted': theme.secondary,
  '--stats-border': theme.border, '--stats-accent': theme.info, '--stats-soft': theme.accentSoft, '--stats-hover': theme.hover } as CSSProperties

export function StatisticsSurface({ accountScope, initialMonth }: { accountScope: string; initialMonth?: string | undefined }) {
  useArkmeLocale()
  const [month, setMonth] = useState(initialMonth ?? ''), [revision, setRevision] = useState(0)
  const [view, setView] = useState<'day' | 'week'>('day'), [keyword, setKeyword] = useState<StatisticsKeyword>(), [showAll, setShowAll] = useState(false)
  const [showKeywordList, setShowKeywordList] = useState(false)
  const [detail, setDetail] = useState<ArkmeTimelineItem>(), [original, setOriginal] = useState(false), [sourceError, setSourceError] = useState(''), [opening, setOpening] = useState('')
  const sourceRequest = useRef<AbortController>()
  const userId = Number(accountScope.split(':').at(-1)), membership = useMembership(accountScope, userId, false)
  const memberReady = membership.state.status === 'ready', paid = membership.state.status === 'ready' && membership.state.value.memberType > 0
  const enabled = !month || paid
  const query = useMemo(() => statisticsQuery(accountScope, month), [accountScope, month, revision])
  const overview = useStatistics<StatisticsDetail>('detail', query, enabled, revision)
  const keywords = useStatistics<import('../../analytics-contract.js').PersonalKeywordSummary>('keywords', query, enabled, revision)
  const active = useStatistics<StatisticsPoint[]>('active', query, enabled, revision)
  const records = useStatistics<StatisticsRecordPage>('long', query, enabled, revision)
  const currentMonth = statisticsDateKey(new Date()).slice(0, 7)
  const earliest = overview.value?.firstRecordAt ? statisticsDateKey(new Date(overview.value.firstRecordAt)).slice(0, 7) : undefined
  const retry = () => setRevision(v => v + 1)
  const selectMonth = (value: string) => { if (value && (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value) || value > currentMonth)) return
    sourceRequest.current?.abort(); setMonth(value); setKeyword(undefined); setShowKeywordList(false); setShowAll(false); setDetail(undefined); setSourceError(''); setOpening('') }
  const stepMonth = (delta: number) => { const [y, m] = month.split('-').map(Number); selectMonth(statisticsDateKey(new Date(y!, m! - 1 + delta, 1)).slice(0, 7)) }
  useEffect(() => () => sourceRequest.current?.abort(), [])
  async function openRecord(uid: string) {
    sourceRequest.current?.abort(); const c = new AbortController(); sourceRequest.current = c
    setOpening(uid); setSourceError('')
    try { const item = await withArkmeReadDeadline(signal => callArkme<ArkmeTimelineItem>('record.app.detail', { recordUid: uid }, signal), c.signal)
      if (!c.signal.aborted) { setDetail(item); setOriginal(false) }
    } catch (error) { if (!c.signal.aborted) setSourceError(statisticsError(error)) }
    finally { if (!c.signal.aborted) setOpening('') }
  }
  return <section className="arkme-statistics" style={palette} aria-label={tr('统计与分析')}>
    <header className="stats-header"><div className="stats-title"><ChartBar size={23}/><div><h1>{tr('统计与分析')}</h1><small>{tr('个人快记 · 沿用移动端统计口径')}</small></div></div>
      <div className="stats-controls"><div className="stats-switch" aria-label={tr('统计范围')}><button aria-pressed={!month} onClick={() => selectMonth('')}>{tr('全部')}</button><button aria-pressed={!!month} onClick={() => selectMonth(month || currentMonth)}>{tr('按月')}</button></div>
      {month && <div className="stats-month"><button title={tr('上个月')} aria-label={tr('上个月')} disabled={!!earliest && month <= earliest} onClick={() => stepMonth(-1)}><CaretLeft/></button><input type="month" aria-label={tr('统计月份')} value={month} max={currentMonth} onInput={e => { if (e.currentTarget.value) selectMonth(e.currentTarget.value) }} onChange={e => { if (e.target.value) selectMonth(e.target.value) }}/><button title={tr('下个月')} aria-label={tr('下个月')} disabled={month >= currentMonth} onClick={() => stepMonth(1)}><CaretRight/></button></div>}
      <button className="stats-icon" aria-label={tr('刷新统计')} title={tr('刷新统计')} onClick={retry}><ArrowClockwise size={18}/></button></div>
    </header>
    {!enabled ? <div className="stats-status">{tr(!memberReady ? membership.state.status === 'error' ? '会员状态读取失败' : '正在确认会员状态…' : '按月统计为会员权益')}{!memberReady && membership.state.status === 'error' && <button onClick={membership.refresh}>{tr('重试')}</button>}{memberReady && <button onClick={() => arkmeUi.openDshSettings('arkme-account')}>{tr('查看账户')}</button>}</div> :
    <div className="stats-scroll">
      <Resource resource={overview} retry={retry}>{data => <>
        <div className="stats-metrics">{([
          ['记录天数', formatNumber(data.days), '天', null], ['快记数量', formatNumber(data.recordCount), '条', data.recordCountIncr],
          ['记录字数', formatNumber(data.wordsCount), '字', data.wordsCountIncr], ['记录用时', statisticsDuration(data.recordMin === null ? null : data.recordMin * 60), '', data.recordMinIncr], ['涉及主题', formatNumber(data.subjectCount), '个', null],
        ] as const).map(([label, value, unit, change]) => <div className="stats-metric" key={label}><span title={label === '记录用时' ? tr('快记编辑与记录行为的用时，非录音时长') : undefined}>{tr(label)}</span><strong>{value}<small>{tr(unit)}</small></strong>{month && <Change value={change}/>}</div>)}</div>
        <div className="stats-secondary">{tr('搜索')} {formatNumber(data.searchCount)} {tr('次')}<span>·</span>{tr('回顾查阅')} {formatNumber(data.viewCount)} {tr('次')}<span>·</span>{tr('分享')} {formatNumber(data.shareCount)} {tr('次')}</div>
      </>}</Resource>
      <StatisticsHeatmap key={`${accountScope}:${month}`} accountScope={accountScope} month={month} revision={revision} firstRecordAt={overview.value?.firstRecordAt ?? null}/>
      <div className="stats-columns"><section className="stats-card"><header><div><h2>{tr('活跃时间分布')}</h2><small>{tr('每个点代表一次记录 · 纵轴为记录用时')}</small></div><div className="stats-switch"><button aria-pressed={view === 'day'} onClick={() => setView('day')}>{tr('一天内')}</button><button aria-pressed={view === 'week'} onClick={() => setView('week')}>{tr('每周')}</button></div></header>
        {view === 'week' && !paid ? <p className="stats-status">{tr(memberReady ? '每周分布为会员权益' : membership.state.status === 'error' ? '会员状态读取失败' : '正在确认会员状态…')}{membership.state.status === 'error' && <button onClick={membership.refresh}>{tr('重试')}</button>}</p> : <Resource resource={active} retry={retry}>{points => <ActivityChart points={points} weekly={view === 'week'}/>}</Resource>}
      </section><StatisticsKeywords resource={keywords} onSelect={item => { setShowAll(false); setShowKeywordList(false); setKeyword(item); setSourceError('') }} onRetry={retry} onOpenList={() => { setShowAll(false); setKeyword(undefined); setShowKeywordList(true); setSourceError('') }}/></div>
      <section className="stats-card"><header><div><h2>{tr('耗时较久的记录')}</h2><small>{tr('按记录用时排序')}</small></div><button onClick={() => setShowAll(true)}>{tr('查看全部')} <CaretRight size={12}/></button></header>
        <Resource resource={records} retry={retry}>{page => <RecordRows items={page.items.slice(0, 5)} opening={opening} onOpen={openRecord}/>}</Resource>
      </section>
      {sourceError && <p role="alert" className="stats-status">{sourceError}</p>}
    </div>}
    {showAll && <LongRecords key={JSON.stringify(query)} query={query} initial={records.value} opening={opening} onOpen={openRecord} onClose={() => setShowAll(false)} sourceError={sourceError}/>}
    {showKeywordList && <ArkmeDetailShell className="stats-keyword-detail" open={!keyword} title={tr('关键词词频')} label={tr('词频详情')} subtitle={`${month || tr('全部')} · ${tr('个人快记')}`} style={{ top: 0 }} onClose={() => setShowKeywordList(false)}>
      <p className="stats-status">{tr('按出现次数排序 · 点击查看相关快记')}</p>
      <Resource resource={keywords} retry={retry}>{data => data.keywords ? <StatisticsKeywordList items={data.keywords} onSelect={item => { setKeyword(item); setSourceError('') }}/> : <p className="stats-status">{tr('关键词词频尚未接通')}</p>}</Resource>
    </ArkmeDetailShell>}
    {keyword && <KeywordRecords key={`${accountScope}:${keyword.text}:${month}`} keyword={keyword} query={query} onClose={() => { setKeyword(undefined); setShowKeywordList(false) }} onBack={showKeywordList ? () => setKeyword(undefined) : undefined} onOpen={openRecord} sourceError={sourceError}/>}
    {detail && <ArkmeTimelineDetailDrawer item={detail} canExtend={false} showOriginal={original} onToggleOriginal={() => setOriginal(v => !v)} onClose={() => setDetail(undefined)}/>}
  </section>
}

function StatisticsHeatmap({ accountScope, month, revision, firstRecordAt }: { accountScope: string; month: string; revision: number; firstRecordAt: number | null }) {
  const [year, setYear] = useState(new Date().getFullYear()), [retry, setRetry] = useState(0)
  const key = `${accountScope}:${month}:${year}:${revision}:${retry}`
  const [result, setResult] = useState<{ key: string; counts: Map<string, number>; pending: boolean; error: string }>()
  const start = month ? new Date(`${month}-01T00:00:00`) : new Date(year, 0, 1)
  const end = month ? new Date(start.getFullYear(), start.getMonth() + 1, 0) : new Date(year, 11, 31)
  const today = statisticsDateKey(new Date()), startKey = statisticsDateKey(start), endKey = statisticsDateKey(end)
  useEffect(() => {
    const c = new AbortController(), counts = new Map<string, number>()
    setResult({ key, counts, pending: true, error: '' })
    const months = month ? [start] : Array.from({ length: 12 }, (_, i) => new Date(year, i, 1)).filter(date => statisticsDateKey(date) <= today)
    let cursor = 0
    void Promise.all(Array.from({ length: Math.min(3, months.length) }, async () => {
      while (cursor < months.length) {
        const date = months[cursor++]!
        const page = await withArkmeReadDeadline(signal => callArkme<ArkmeCalendarBucketPage>('calendar.buckets', { startDate: statisticsDateKey(date), endDate: statisticsDateKey(new Date(date.getFullYear(), date.getMonth() + 1, 0)), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }, signal), c.signal)
        for (const day of page.days) counts.set(day.bucketDate, day.count)
      }
    })).then(() => { if (!c.signal.aborted) setResult({ key, counts, pending: false, error: '' }) }).catch(error => { if (!c.signal.aborted) { setResult({ key, counts: new Map(), pending: false, error: statisticsError(error) }); c.abort() } })
    return () => c.abort()
  }, [key])
  const days: string[] = []
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(statisticsDateKey(d))
  const state = result?.key === key ? result : undefined, max = Math.max(1, ...state?.counts.values() ?? [])
  return <section className="stats-card"><header><div><h2>{tr('记录情况')}</h2><small>{month || `${year} 年`} · {tr('颜色越深，快记越多')}</small></div><div className="stats-controls">{!month && <><button aria-label={tr('上一年')} disabled={!!firstRecordAt && year <= new Date(firstRecordAt).getFullYear()} onClick={() => setYear(y => y - 1)}><CaretLeft/></button><span>{year}</span><button aria-label={tr('下一年')} disabled={year >= new Date().getFullYear()} onClick={() => setYear(y => y + 1)}><CaretRight/></button></>}<button onClick={() => arkmeUi.openCalendarDate(month ? `${month}-01` : today)}>{tr('进入日历')}</button></div></header>
    {!state || state.pending ? <p className="stats-status" role="status">{tr('正在读取日期分布…')}</p> : state.error ? <p className="stats-status" role="alert">{state.error}<button onClick={() => setRetry(v => v + 1)}>{tr('重试')}</button></p> : <>
      {month && <div className="stats-weekday-labels">{['一', '二', '三', '四', '五', '六', '日'].map(d => <span key={d}>{tr(d)}</span>)}</div>}
      <div className={`stats-heatmap ${month ? 'is-month' : ''}`} style={{ '--stats-weeks': Math.ceil((days.length + (start.getDay() + 6) % 7) / 7) } as CSSProperties} aria-label={tr('每日快记数量')}>
        {Array.from({ length: (start.getDay() + 6) % 7 }, (_, i) => <span key={`pad${i}`}/>)}
        {days.map(date => { const count = state.counts.get(date) ?? 0, level = count ? Math.max(1, Math.ceil(count / max * 4)) : 0
          return <button key={date} data-level={level} disabled={date > today} aria-label={`${date} · ${count} 条快记`} title={`${date} · ${count} 条快记`} onClick={() => arkmeUi.openCalendarDate(date)}>{month ? Number(date.slice(-2)) : null}</button> })}
      </div><div className="stats-heatmap-legend"><span>{startKey}</span><span>{endKey}</span><span className="stats-scale">{tr('少')}{[0, 1, 2, 3, 4].map(level => <i key={level} data-level={level}/>)}{tr('多')}</span></div>
    </>}
  </section>
}

function ActivityChart({ points, weekly }: { points: StatisticsPoint[]; weekly: boolean }) {
  if (!points.length) return <p className="stats-status">{tr('此范围暂无记录活动')}</p>
  const max = Math.max(1, ...points.map(p => p.costSec)), plot = (rows: StatisticsPoint[], height: number) => <svg viewBox={`0 0 600 ${height}`} role="img" aria-label={tr('记录用时分布')}>
    {[0, 6, 12, 18, 24].map(hour => <line key={hour} x1={hour * 25} x2={hour * 25} y1="0" y2={height} stroke="currentColor" opacity=".08"/>)}
    {rows.map((p, i) => { const date = new Date(p.stamp), x = (date.getHours() + date.getMinutes() / 60) * 25, y = height - 6 - p.costSec / max * (height - 12)
      return <circle key={`${p.stamp}:${i}`} cx={Math.max(3, Math.min(597, x))} cy={y} r="3" fill="var(--stats-accent)" opacity=".55"><title>{date.toLocaleString(arkmeIntlLocale())} · {statisticsDuration(p.costSec)}</title></circle> })}
  </svg>
  return <div className="stats-chart"><small>{tr('最长记录用时')} {statisticsDuration(max)}</small>{weekly ? [1, 2, 3, 4, 5, 6, 7].map(day => <div className="stats-week" key={day}><span>{tr(['周一', '周二', '周三', '周四', '周五', '周六', '周日'][day - 1]!)}</span>{plot(points.filter(p => p.weekday === day), 35)}</div>) : plot(points, 180)}<div className="stats-axis">{['00:00', '06:00', '12:00', '18:00', '24:00'].map(h => <span key={h}>{h}</span>)}</div></div>
}
function RecordRows({ items, opening, onOpen }: { items: StatisticsRecord[]; opening: string; onOpen(uid: string): void }) {
  return !items.length ? <p className="stats-status">{tr('此范围暂无记录')}</p> : <div className="stats-records">{items.map(item => <button key={item.uid} onClick={() => onOpen(item.uid)} disabled={opening === item.uid}><span>{item.title || item.text || tr('查看快记原文')}{item.title && item.text && <small>{item.text}</small>}</span><time>{new Date(item.sendAt).toLocaleDateString(arkmeIntlLocale())}</time><strong>{opening === item.uid ? tr('读取中…') : statisticsDuration(item.costSec)}</strong><CaretRight size={14}/></button>)}</div>
}
function LongRecords({ query, initial, opening, sourceError, onOpen, onClose }: { query: ReturnType<typeof statisticsQuery>; initial: StatisticsRecordPage | undefined; opening: string; sourceError: string; onOpen(uid: string): void; onClose(): void }) {
  const [page, setPage] = useState(initial), [loading, setLoading] = useState(false), [error, setError] = useState(''), controller = useRef<AbortController>()
  const load = async () => {
    controller.current?.abort(); const c = new AbortController(); controller.current = c; setLoading(true); setError('')
    try { const next = await withArkmeReadDeadline(signal => callArkme<StatisticsRecordPage>('statistics.long', { ...query, offset: page?.nextOffset ?? 0 }, signal), c.signal)
      if (!c.signal.aborted) setPage(old => ({ ...next, items: [...old?.items ?? [], ...next.items.filter(item => !old?.items.some(p => p.uid === item.uid))] }))
    } catch (e) { if (!c.signal.aborted) setError(statisticsError(e)) } finally { if (!c.signal.aborted) setLoading(false) }
  }
  useEffect(() => { if (!initial) void load(); return () => controller.current?.abort() }, [])
  return <ArkmeDetailShell title={tr('耗时较久的记录')} label={tr('耗时记录列表')} onClose={onClose} style={{ width: 'min(760px, 100%)', top: 0 }}><RecordRows items={page?.items ?? []} opening={opening} onOpen={onOpen}/>{sourceError && <p role="alert">{sourceError}</p>}{error && <p role="alert">{error}</p>}{(!page || page.nextOffset !== null || error) && <button className="stats-more" disabled={loading} onClick={() => void load()}>{tr(loading ? '正在加载…' : error ? '重试' : '加载更多')}</button>}</ArkmeDetailShell>
}
function KeywordRecords({ keyword, query, sourceError, onClose, onBack, onOpen }: { keyword: StatisticsKeyword; query: import('../../statistics-contract.js').StatisticsQuery; sourceError: string; onClose(): void; onBack?: (() => void) | undefined; onOpen(uid: string): void }) {
  const [result, setResult] = useState<import('../../analytics-contract.js').PersonalKeywordRecords>(), [error, setError] = useState(''), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0)
  useEffect(() => { const c = new AbortController(); setLoading(true); setError('')
    void withArkmeReadDeadline(signal => callArkme<import('../../analytics-contract.js').PersonalKeywordRecords>('statistics.keyword-records', { ...query, keywordId: keyword.keywordId, snapshotId: keyword.snapshotId, ...(result?.nextCursor && revision ? { cursor: result.nextCursor } : {}) }, signal), c.signal)
      .then(next => { if (!c.signal.aborted) setResult(old => ({ ...next, items: [...old?.items ?? [], ...next.items.filter(i => !old?.items.some(p => p.recordUid === i.recordUid))] })) }).catch(e => { if (!c.signal.aborted) setError(statisticsError(e)) }).finally(() => { if (!c.signal.aborted) setLoading(false) })
    return () => c.abort()
  }, [keyword.keywordId, keyword.snapshotId, revision])
  const items = result?.items ?? []
  return <ArkmeDetailShell title={keyword.text} label={tr('关键词相关快记')} onClose={onClose} {...(onBack ? { onBack } : {})} backLabel={tr('返回词频列表')} style={{ top: 0 }}><p className="stats-status">{tr('当前时间范围内的个人快记搜索结果')}<small className="stats-keyword-note">{tr('搜索结果条数与词语出现次数不同。')}</small></p>{items.map(item => <button className="stats-keyword-record" key={item.recordUid} onClick={() => onOpen(item.recordUid)}>{item.title || item.textContent}<small>{new Date(item.sendAtMillis).toLocaleString(arkmeIntlLocale())}</small></button>)}{!loading && !error && !items.length && <p>{tr('当前已检索记录中暂无匹配')}</p>}{(error || sourceError) && <p role="alert">{error || sourceError}</p>}{(loading || error || result?.hasMore) && <button className="stats-more" disabled={loading} onClick={() => setRevision(v => v + 1)}>{tr(loading ? '正在读取…' : error ? '重试' : '继续查找')}</button>}</ArkmeDetailShell>
}
