import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { CaretLeft } from '@phosphor-icons/react/dist/icons/CaretLeft'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { ArrowClockwise } from '@phosphor-icons/react/dist/icons/ArrowClockwise'
import { formatAiPoints, groupPointsConsumption, nanoCnyToPoints, pointsUnits, type ArkmeAiPointsPage } from '../ai-points.js'
import { callArkme } from './api.js'
import { PointsConsumptionRows } from './ArkmePointsConsumption.js'
import { PointsHistoryError, PointsHistoryReader, pointsBusinessLabel, pointsCategory, pointsCategoryLabel, pointsWindow, type PointsCategory, type PointsGrain, type PointsPeriod, type PointsStatistics } from './ai-points-history.js'
import { arkmeIntlLocale, tr, useArkmeLocale } from './locale.js'
import { suspendArkmeVisibleReadIntent } from './read-intent-visibility.js'
import css from './points-history.css?inline'

function dateLabel(time: number, month = false): string {
  return new Intl.DateTimeFormat(arkmeIntlLocale(), { year: month ? 'numeric' : undefined, month: month ? 'long' : 'numeric', day: month ? undefined : 'numeric', timeZone: 'Asia/Shanghai' }).format(time)
}
function periodLabel(period: PointsPeriod, grain: PointsGrain): string {
  return grain === 'month' ? dateLabel(period.from, true) : grain === 'week' ? `${dateLabel(period.from)}–${dateLabel(period.until - 1)}` : dateLabel(period.from)
}
const ratio = (part: string, total: string) => pointsUnits(total) === 0n ? 0 : Number(pointsUnits(part) * 10_000n / pointsUnits(total)) / 100
function axisLabel(value: string): string {
  const number = Number(pointsUnits(value)) / 10_000_000
  if (number > 0 && number < .01) return '< 0.01'
  return new Intl.NumberFormat(arkmeIntlLocale(), { notation: number >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: number >= 100 ? 0 : number >= 1 ? 1 : 2 }).format(number)
}
type Result = { key: string; windowKey: string; value?: PointsStatistics; error?: unknown }

export function ArkmePointsHistoryDialog({ scope, revision, onClose, returnFocusRef }: {
  scope: string; revision: number; onClose(): void; returnFocusRef?: RefObject<HTMLElement>
}) {
  useArkmeLocale()
  const dialog = useRef<HTMLDialogElement>(null), id = useId()
  const [tab, setTab] = useState<'statistics' | 'details'>('statistics')
  const [grain, setGrain] = useState<PointsGrain>('day'), [offset, setOffset] = useState(0)
  const [now, setNow] = useState(Date.now), [reload, setReload] = useState(0)
  const window = useMemo(() => pointsWindow(grain, offset, now), [grain, offset, now])
  const [selection, setSelection] = useState<string | null | undefined>()
  const selected = selection === null ? null : window.periods.some(period => period.key === selection) ? selection! : window.periods.at(-1)!.key
  const [category, setCategory] = useState<PointsCategory>(), [limit, setLimit] = useState(20)
  const [result, setResult] = useState<Result>()
  const reader = useMemo(() => new PointsHistoryReader(scope, (month, beforeId, signal, limit) => callArkme<ArkmeAiPointsPage>('account.points.consumption', {
    expectedAccountScope: scope, month, limit, ...(beforeId ? { beforeId } : {}),
  }, signal)), [scope, revision, reload])
  const windowKey = `${scope}:${revision}:${reload}:${grain}:${window.from}`
  const key = `${windowKey}:${selected}`
  useLayoutEffect(suspendArkmeVisibleReadIntent, [])
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => { element?.close(); queueMicrotask(() => { if (returnFocusRef?.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true }) }) }
  }, [returnFocusRef])
  useEffect(() => {
    const controller = new AbortController()
    void reader.statistics(window, selected, controller.signal).then(value => {
      if (!controller.signal.aborted) setResult({ key, windowKey, value })
    }).catch(error => { if (!controller.signal.aborted) setResult({ key, windowKey, error }) })
    return () => controller.abort()
  }, [reader, window, selected, key, windowKey])
  const data = result?.key === key ? result.value : undefined
  const chart = result?.windowKey === windowKey ? result.value : undefined
  const failed = result?.key === key && result.error !== undefined
  const selectedPeriod = window.periods.find(period => period.key === selected)
  const label = selectedPeriod ? periodLabel(selectedPeriod, grain) : tr('全部时段')
  const items = data?.items.filter(item => !category || pointsCategory(item.businessCode) === category) ?? []
  const detailTotal = nanoCnyToPoints(items.reduce((sum, item) => sum + pointsUnits(item.chargedPoints), 0n).toString())
  const max = chart?.buckets.reduce((max, bucket) => pointsUnits(bucket.chargedPoints) > max ? pointsUnits(bucket.chargedPoints) : max, 0n) ?? 0n
  const maximum = max > 0n ? nanoCnyToPoints(max.toString()) : '1'
  const changeGrain = (value: PointsGrain) => { setGrain(value); setOffset(0); setSelection(undefined); setCategory(undefined); setLimit(20) }
  const moveWindow = (delta: number) => { setOffset(value => value + delta); setSelection(undefined); setCategory(undefined); setLimit(20) }
  const choosePeriod = (value: string | null) => { setSelection(value); setCategory(undefined); setLimit(20) }
  const rangeFormat = new Intl.DateTimeFormat(arkmeIntlLocale(), { timeZone: 'Asia/Shanghai', year: grain === 'month' || new Date(window.from + 28_800_000).getUTCFullYear() !== new Date(window.until - 1 + 28_800_000).getUTCFullYear() ? 'numeric' : undefined, month: 'numeric', day: grain === 'month' ? undefined : 'numeric' })
  const refresh = () => { setNow(Date.now()); setReload(value => value + 1) }
  const status = failed ? <div className="arkme-points-history-state" role="alert"><p>{tr(result?.error instanceof PointsHistoryError && result.error.reason === 'too-large'
    ? '记录较多，当前无法完成统计。请按天查看或选择单个时段。'
    : result?.error instanceof PointsHistoryError && result.error.reason === 'changed' ? '账单正在更新，暂时无法确认完整统计，请重试。' : '暂时无法读取消费统计，请重试。')}</p><button type="button" onClick={refresh}>{tr('重试')}</button></div>
    : <p className="arkme-points-history-state" role="status">{tr('正在核对完整消费记录…')}</p>
  const core = new Set<PointsCategory>(['dsh', 'arko', 'arrangement', 'profile', 'summary', 'timeline', 'goal'])
  const categories = data?.categories.filter(item => core.has(item.category) || pointsUnits(item.chargedPoints) > 0n) ?? []
  return createPortal(<dialog ref={dialog} className="arkme-points-history-dialog" aria-labelledby={`${id}-title`}
    data-arkme-notification-blocking-overlay="true" onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose() }}
    onKeyDown={event => event.stopPropagation()} onClick={event => {
      if (event.target !== event.currentTarget) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
    }}>
    <style>{css}</style>
    <header className="arkme-points-history-header"><h2 id={`${id}-title`}>{tr('AI 额度消费记录')}</h2><div>
      <button type="button" aria-label={tr('刷新消费记录')} disabled={!data && !failed} onClick={refresh}><ArrowClockwise size={18} aria-hidden /></button>
      <button type="button" autoFocus aria-label={tr('关闭消费记录')} onClick={onClose}><X size={20} aria-hidden /></button>
    </div></header>
    <div className="arkme-points-history-tabs" role="tablist" aria-label={tr('消费记录视图')} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const next = event.key === 'Home' ? 'statistics' : event.key === 'End' ? 'details' : tab === 'statistics' ? 'details' : 'statistics'
      setTab(next); document.getElementById(`${id}-${next}-tab`)?.focus()
    }}>{(['statistics', 'details'] as const).map(value => <button key={value} type="button" role="tab" id={`${id}-${value}-tab`}
      aria-controls={`${id}-${value}-panel`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1}
      onClick={() => { setTab(value); setCategory(undefined); setLimit(20) }}>{tr(value === 'statistics' ? '统计' : '明细')}</button>)}</div>
    <div className="arkme-points-history-body">
      <div className="arkme-points-history-toolbar"><div className="arkme-points-history-grain" role="group" aria-label={tr('统计粒度')}>
        {(['day', 'week', 'month'] as const).map(value => <button key={value} type="button" aria-pressed={grain === value} onClick={() => changeGrain(value)}>{tr(value === 'day' ? '按天' : value === 'week' ? '按周' : '按月')}</button>)}
      </div><div className="arkme-points-history-range">
        <button type="button" disabled={offset >= 500} aria-label={tr('上一段时间')} onClick={() => moveWindow(1)}><CaretLeft size={14} aria-hidden /></button>
        <span>{rangeFormat.format(window.from)}–{rangeFormat.format(window.until - 1)}</span>
        <button type="button" disabled={offset === 0} aria-label={tr('下一段时间')} onClick={() => moveWindow(-1)}><CaretRight size={14} aria-hidden /></button>
      </div></div>
      <section id={`${id}-statistics-panel`} role="tabpanel" aria-labelledby={`${id}-statistics-tab`} hidden={tab !== 'statistics'}>
        {chart && <><div className="arkme-points-history-overview"><div><p>{tr(offset ? '所选时段消费' : grain === 'day' ? '近15天消费' : grain === 'week' ? '近8周消费' : '近12个月消费')}</p><strong>{formatAiPoints(chart.chargedPoints)} <small>{tr('积分')}</small></strong></div><span>{tr('按时间 · 积分')}</span></div>
          <div className="arkme-points-history-chart" role="group" aria-label={tr('消费积分时间趋势')}><div className="arkme-points-history-axis" aria-hidden><span>{axisLabel(maximum)}</span><span>{axisLabel(nanoCnyToPoints((pointsUnits(maximum) / 2n).toString()))}</span><span>0</span></div>
            <div className="arkme-points-history-columns">{chart.buckets.map((bucket, index) => <button type="button" key={bucket.key} aria-pressed={selected === bucket.key}
              aria-label={tr('{v0}，消费 {v1} 积分', { v0: periodLabel(bucket, grain), v1: formatAiPoints(bucket.chargedPoints) })}
              title={`${periodLabel(bucket, grain)} · ${formatAiPoints(bucket.chargedPoints)} ${tr('积分')}`} onClick={() => choosePeriod(bucket.key)}>
              <span className="arkme-points-history-bar-area"><span className="arkme-points-history-bar" style={{ height: `${pointsUnits(bucket.chargedPoints) > 0n ? Math.max(.8, ratio(bucket.chargedPoints, maximum)) : 0}%` }} /></span>
              <span className="arkme-points-history-tick" data-optional={index !== 0 && index !== chart.buckets.length - 1 && index % 3 !== 0 ? 'true' : undefined}>{grain === 'month' ? new Intl.DateTimeFormat(arkmeIntlLocale(), { month: 'short', timeZone: 'Asia/Shanghai' }).format(bucket.from) : dateLabel(bucket.from)}</span>
            </button>)}</div>
          </div></>}
        {!chart && status}
        <div className="arkme-points-history-categories"><div className="arkme-points-history-section-heading"><h3>{tr('按类型')}</h3>
          <button type="button" onClick={() => choosePeriod(selected === null ? window.periods.at(-1)!.key : null)}>{tr(selected === null ? '查看当前时段' : '查看全部时段')}</button></div>
          <p className="arkme-points-history-selection" aria-live="polite">{label}{data && <> · <strong>{formatAiPoints(data.selectedPoints)} {tr('积分')}</strong></>}{selected === window.periods.at(-1)!.key && offset === 0 && <> · {tr('截至当前')}</>}</p>
          {data ? <>{categories.map(item => <button type="button" className="arkme-points-history-category" key={item.category} aria-label={tr('查看{v0}消费明细', { v0: tr(pointsCategoryLabel(item.category)) })}
            onClick={() => { setCategory(item.category); setTab('details'); setLimit(20) }}><span>{tr(pointsCategoryLabel(item.category))}</span>
            <span className="arkme-points-history-track" aria-hidden><span style={{ width: `${ratio(item.chargedPoints, data.selectedPoints)}%` }} /></span>
            <span>{formatAiPoints(item.chargedPoints)}</span><small>{pointsUnits(item.chargedPoints) > 0n && ratio(item.chargedPoints, data.selectedPoints) < .1 ? '<0.1' : ratio(item.chargedPoints, data.selectedPoints).toFixed(1)}%</small><CaretRight size={13} aria-hidden /></button>)}
            {pointsUnits(data.selectedPoints) === 0n && <p className="arkme-points-history-empty">{tr('该时段暂无积分消费')}</p>}</> : chart ? status : null}
        </div>
      </section>
      <section id={`${id}-details-panel`} role="tabpanel" aria-labelledby={`${id}-details-tab`} hidden={tab !== 'details'}>
        <div className="arkme-points-history-detail-toolbar"><select aria-label={tr('明细时间范围')} value={selected ?? 'all'} onChange={event => choosePeriod(event.target.value === 'all' ? null : event.target.value)}>
          <option value="all">{tr('全部时段')}</option>{window.periods.map(period => <option key={period.key} value={period.key}>{periodLabel(period, grain)}</option>)}
        </select>{data && <span>{tr('合计')} {formatAiPoints(detailTotal)} {tr('积分')}</span>}</div>
        {category && <div className="arkme-points-history-filter">{tr(pointsCategoryLabel(category))}<button type="button" aria-label={tr('清除类型筛选')} onClick={() => setCategory(undefined)}><X size={12} aria-hidden /></button></div>}
        {!data ? status : <div className="arkme-usage-breakdown" data-usage-detail="points">
          {items.length === 0 ? <p className="arkme-points-history-empty">{tr('该时段暂无积分消费')}</p> : <PointsConsumptionRows items={items} limit={limit} label={pointsBusinessLabel} />}
          {groupPointsConsumption(items).length > limit && <button type="button" className="arkme-points-history-more" onClick={() => setLimit(value => value + 20)}>{tr('加载更多')}</button>}
        </div>}
      </section>
    </div>
    <footer className="arkme-points-history-footer"><span>{tr('仅统计已结算的 AI 积分消费')}</span><span>{tr('北京时间')}{data && ` · ${tr('截至')} ${new Intl.DateTimeFormat(arkmeIntlLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' }).format(data.observedAt)}`}</span></footer>
  </dialog>, document.body)
}
