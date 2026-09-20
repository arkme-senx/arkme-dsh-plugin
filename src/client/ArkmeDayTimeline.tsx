import { tr, useArkmeLocale, arkmeIntlLocale } from './locale.js'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArkmeDayRecap, DayRecordingReview } from './ArkmeDayRecap.js'
import type { DayRecapGenerator } from './day-recap-input.js'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { ArrowClockwise } from '@phosphor-icons/react/dist/icons/ArrowClockwise'
import { MapPin } from '@phosphor-icons/react/dist/icons/MapPin'
import type { ArkmeRecordLocationObservation } from '../types.js'
import { useDayActivityLocation } from './use-day-activity-location.js'
import {
  dayActivityDisplayName, dayActivityFilters, dayActivityInterval, dayActivityLabels, dayActivityMatchesFilter, dayActivityOverview, dayActivityPeriod, dayActivityQueryKey, dayActivityTime, dayActivityTitle,
  type DayActivityDetailPage, type DayActivityEntry, type DayActivityPage, type DayActivityQuery, type DayActivityReader,
} from './calendar-activity-model.js'
import { useDayActivities, useDayActivityDetail } from './use-day-activities.js'

export interface ArkmeDayTimelineProps {
  query: DayActivityQuery
  /** Intentionally no default adapter: no unconfirmed routes or synthetic production data. */
  reader?: DayActivityReader
  onQueryChange(query: DayActivityQuery): void
  onOpenSource?(sourceRef: string): void
  onClose?(): void
  renderRecord?(record: DayActivityDetailPage['items'][number]): ReactNode
  renderCallDetail?(call: NonNullable<DayActivityDetailPage['call']>): ReactNode
  onRefresh?(): void
  onDetailChange?(): void
  generateRecap?: DayRecapGenerator
}

export function ArkmeDayTimeline(props: ArkmeDayTimelineProps) {
  // The view never reuses expanded details across account/date/timezone/filter changes.
  return <DayTimelineContent key={dayActivityQueryKey(props.query)} {...props} />
}

function DayTimelineContent({ query, reader, onQueryChange, onOpenSource, onClose, renderRecord, renderCallDetail, onRefresh, onDetailChange, generateRecap }: ArkmeDayTimelineProps) {
  useArkmeLocale()
  const data = useDayActivities(query, reader)
  const [selectedId, setSelectedId] = useState<string>()
  const [locationRequestedId, setLocationRequestedId] = useState<string>()
  const [placesOnly, setPlacesOnly] = useState(false)
  const root = useRef<HTMLElement>(null)
  const attemptedLocations = useRef<{ snapshotId?: string; ids: Set<string> }>({ ids: new Set() })
  const [locations, setLocations] = useState<{ snapshotId?: string; values: Record<string, ArkmeRecordLocationObservation | undefined> }>({ values: {} })
  const [restrictedIds, setRestrictedIds] = useState<ReadonlySet<string>>(() => new Set())
  const selected = data.page?.items.find(item => item.id === selectedId && item.access === 'available' && !restrictedIds.has(item.id))
  const detail = useDayActivityDetail(query, selected?.id, data.page?.snapshotId, reader)
  const location = useDayActivityLocation(query, selected?.canLoadLocation && selected.id === locationRequestedId && !detail.error ? selected.id : undefined, data.page?.snapshotId, reader)
  useEffect(() => {
    const value = location.value
    if (!value) return
    if (value.access === 'restricted') setRestrictedIds(current => new Set([...current, value.activityId]))
    setLocations(current => ({ snapshotId: value.snapshotId,
      values: { ...(current.snapshotId === value.snapshotId ? current.values : {}), [value.activityId]: value.access === 'available' ? value.location : undefined } }))
  }, [location.value])
  const knownLocation = (item: DayActivityEntry) => locations.snapshotId === data.page?.snapshotId && Object.hasOwn(locations.values, item.id)
    ? locations.values[item.id] : item.location
  useEffect(() => {
    const page = data.page, limit = reader?.capabilities?.autoLocationLimit ?? 0
    if (!page || !reader?.loadLocation || !limit) return
    if (attemptedLocations.current.snapshotId !== page.snapshotId) attemptedLocations.current = { snapshotId: page.snapshotId, ids: new Set() }
    const controller = new AbortController(), attempted = attemptedLocations.current.ids
    let running = 0
    const queue: string[] = []
    const pump = () => {
      while (!controller.signal.aborted && running < 2 && queue.length) {
        const id = queue.shift()!; running += 1
        void reader.loadLocation!(query, id, { signal: controller.signal, snapshotId: page.snapshotId }).then(value => {
          if (controller.signal.aborted || value.snapshotId !== page.snapshotId || value.activityId !== id
            || dayActivityQueryKey(value.query) !== dayActivityQueryKey(query)) return
          if (value.access === 'restricted') setRestrictedIds(current => new Set([...current, id]))
          setLocations(current => ({ snapshotId: page.snapshotId, values: {
            ...(current.snapshotId === page.snapshotId ? current.values : {}), [id]: value.access === 'available' ? value.location : undefined } }))
        }).catch(() => { /* Explicit location read keeps its visible error/retry path. */ }).finally(() => { running -= 1; pump() })
      }
    }
    const enqueue = (id: string) => {
      if (attempted.has(id) || attempted.size >= limit || controller.signal.aborted) return
      attempted.add(id); queue.push(id); pump()
    }
    const candidates = new Set(page.items.filter(item => item.access === 'available' && item.canLoadLocation && !item.location).map(item => item.id))
    const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        const id = (entry.target as HTMLElement).dataset.activityId
        if (id && candidates.has(id)) enqueue(id)
      }
    })
    if (observer) root.current?.querySelectorAll('[data-activity-id]').forEach(element => observer.observe(element))
    else [...candidates].slice(0, limit).forEach(enqueue)
    return () => { observer?.disconnect(); controller.abort() }
  }, [data.page, reader, query])
  useEffect(() => {
    if (detail.page?.access === 'restricted') {
      const id = detail.page.activityId
      setRestrictedIds(current => new Set([...current, id]))
    }
  }, [detail.page])
  const change = (next: Partial<DayActivityQuery>) => onQueryChange({ ...query, ...next })
  const filteredOut = (entry: DayActivityEntry) => !dayActivityMatchesFilter(query.kind, entry.kind)
    || !query.includeBackground && entry.participation === 'background'
  const items = data.page?.items.filter(entry => !filteredOut(entry) && (!placesOnly || knownLocation(entry))).map(entry => restrictedIds.has(entry.id)
    ? { ...entry, access: 'restricted' as const } : entry) ?? []
  const incomplete = data.page?.completeness === 'partial' || (data.page?.missingKinds.length ?? 0) > 0
  const missing = data.page?.missingKinds.filter(kind => !reader?.capabilities || reader.capabilities.kinds.includes(kind)) ?? []
  const empty = reader && !data.loading && !data.error && data.page && items.length === 0

  return <section ref={root} className="arkme-day-timeline" aria-label={tr("我的一天")}>
    <header className="arkme-day-heading">
      <div><h2>{tr("我的一天")}</h2><p>{query.bucketDate} · {query.timezone}</p></div>
      <div className="arkme-day-heading-actions">
        {(!reader?.capabilities || reader.capabilities.modes.length > 1) && <div className="arkme-day-modes" aria-label={tr("显示方式")}>
          <button type="button" aria-pressed={query.mode === 'activities'} onClick={() => change({ mode: 'activities' })}>{tr("活动片段")}</button>
          <button type="button" aria-pressed={query.mode === 'records'} onClick={() => change({ mode: 'records', includeBackground: true })}>{tr("原始明细")}</button>
        </div>}
        <button type="button" aria-label={tr("刷新当天活动")} disabled={!reader || data.loading} className="arkme-day-icon"
          onClick={() => { setSelectedId(undefined); setLocationRequestedId(undefined); setLocations({ values: {} }); setRestrictedIds(new Set()); data.refresh(); onRefresh?.() }}><ArrowClockwise size={18} aria-hidden /></button>
        {onClose && <button type="button" className="arkme-day-icon" aria-label={tr("关闭我的一天")} onClick={onClose}><X size={18} aria-hidden /></button>}
      </div>
    </header>

    {data.page && <>
      <p className="arkme-day-overview">{dayActivityOverview(items, query.mode)}</p>
      <details className="arkme-day-scope-details"><summary>{incomplete ? '部分来源已加载' : '当前来源已加载'} <span>{tr("查看范围")}</span></summary>
        {reader?.capabilities && <p>{reader.capabilities.notice}</p>}
        {data.page.notice && <p>{data.page.notice}</p>}
        {incomplete && <p>{tr("当前仅显示部分来源。")}{missing.length > 0 ? `${missing.map(kind => dayActivityLabels[kind]).join('、')}尚未完整覆盖；有更多页面时可继续加载。` : '部分数据尚未完整同步。'}</p>}
        <p>{tr("概览只统计当前筛选下已加载、可查看的内容，不是全天总量。")}</p>
      </details>
      <RecordingCoverage page={data.page} />
    </>}

    <div className="arkme-day-filters" aria-label={tr("活动类型")}>
      {dayActivityFilters.filter(({ kind }) => kind === 'all' || !reader?.capabilities
        || reader.capabilities.kinds.some(source => dayActivityMatchesFilter(kind, source))).map(({ kind, label }) => <button type="button" key={kind}
        aria-pressed={query.kind === kind}
        onClick={() => change({ kind })}>{label}</button>)}
      {reader?.loadLocation && <button type="button" aria-pressed={placesOnly} onClick={() => setPlacesOnly(value => !value)}>{tr("地点")}</button>}
      {reader?.capabilities?.background !== false && (!reader?.capabilities || reader.capabilities.kinds.includes('group_chat')) && query.mode === 'activities' && dayActivityMatchesFilter(query.kind, 'group_chat') && <label className="arkme-day-background">
        <input type="checkbox" checked={query.includeBackground} onChange={event => change({ includeBackground: event.target.checked })} />{tr("其他群动态")}</label>}
    </div>

    {!reader && <p className="arkme-day-status" role="status">{tr("多维活动数据尚未接入，原有日历仍可使用。")}</p>}
    {reader && data.loading && <p className="arkme-day-status" role="status">{tr("正在加载当天活动…")}</p>}
    {data.error && <div className="arkme-day-status" role="alert">{data.error}<button type="button" onClick={data.refresh}>{tr("重试")}</button></div>}
    {!!data.page?.warnings?.length && <div className="arkme-day-warning" role="alert">
      {data.page.warnings.map(warning => <p key={warning}>{warning}</p>)}<button type="button" disabled={data.loading} onClick={data.refresh}>{tr("重试加载")}</button>
    </div>}
    {placesOnly && <p className="arkme-day-scope">{tr("仅筛选已确认地点的活动。列表自动补读最多 8 个可见活动的地点，其他活动可展开后手动查看；没有地点标签不代表当时没有位置。")}</p>}
    {empty && <p className="arkme-day-status">{placesOnly ? '已加载活动中暂无已确认地点；可取消地点筛选后展开活动查看。' : data.page!.hasMore ? '本页没有匹配内容，可继续加载。'
      : incomplete ? '已加载来源中暂无匹配内容。' : '这一天暂无匹配内容。'}</p>}

    {generateRecap && <ArkmeDayRecap query={query} entries={data.error || data.loading ? [] : items} generate={generateRecap}
      onSource={id => { onDetailChange?.(); setSelectedId(id); setLocationRequestedId(undefined)
        requestAnimationFrame(() => root.current?.querySelector('.arkme-day-detail')?.scrollIntoView({ block: 'nearest' })) }} />}
    {data.page && (query.kind === 'all' || query.kind === 'recording') && !placesOnly && <DayRecordingReview page={data.page} />}

    <div className="arkme-day-columns" data-detail-open={!!selected}>
      <div className="arkme-day-list" aria-label={query.mode === 'activities' ? '当天活动片段' : '当天原始明细'}>
        {items.map((item, index) => <Fragment key={item.id}>
          {(index === 0 || dayActivityPeriod(Math.max(items[index - 1]!.startAtMillis, data.page!.dayStartMillis), query.timezone)
            !== dayActivityPeriod(Math.max(item.startAtMillis, data.page!.dayStartMillis), query.timezone)) && <h3 className="arkme-day-period">
            {dayActivityPeriod(Math.max(item.startAtMillis, data.page!.dayStartMillis), query.timezone)}</h3>}
          <article className="arkme-day-entry" data-activity-id={item.id}>
          <time>{dayActivityTime(Math.max(item.startAtMillis, data.page!.dayStartMillis), query.timezone)}</time>
          <div className="arkme-day-entry-body">
          <button type="button" className="arkme-day-entry-content" disabled={item.access !== 'available'}
            aria-expanded={selected?.id === item.id} onClick={() => { onDetailChange?.(); setLocationRequestedId(undefined); setSelectedId(current => current === item.id ? undefined : item.id) }}>
            <div className="arkme-day-entry-title"><strong>{dayActivityTitle(item)}</strong><span>{dayActivityLabels[item.kind]}</span></div>
            {item.access === 'available' && <>
              {item.preview && <p>{item.kind === 'call' && '已有摘要：'}{item.preview}</p>}
              <div className="arkme-day-entry-meta">
                {item.startAtMillis < data.page!.dayStartMillis && '始于前一天 · '}
                {item.endAtMillis > data.page!.dayEndMillis && '延续至下一天 · '}
                {item.endAtMillis > item.startAtMillis && `${dayActivityTime(item.startAtMillis, query.timezone)}–${dayActivityTime(item.endAtMillis, query.timezone)} · `}
                {item.statusLabel && `${item.statusLabel} · `}
                {item.kind === 'call' ? tr("通话记录") : query.mode === 'activities' ? tr("{v0} 条原始记录", { v0: item.recordCount }) : '原始记录'}
                {item.kind !== 'private_chat' && item.sourceName ? ` · ${item.sourceName}` : ''}
              </div>
            </>}
          </button>
          {item.access === 'available' && knownLocation(item) && !(selected?.id === item.id && location.error) && <button type="button"
            className="arkme-day-location-tag" aria-label={tr("查看地点：{v0}", { v0: knownLocation(item)!.label || '设备采集位置' })}
            onClick={() => { onDetailChange?.(); setSelectedId(item.id); setLocationRequestedId(item.id) }}>
            <MapPin size={14} aria-hidden /><span>{knownLocation(item)!.label || '已记录设备位置'}</span>
          </button>}
          </div>
        </article></Fragment>)}
        {data.page?.hasMore && <button type="button" className="arkme-day-more" disabled={data.loadingMore}
          onClick={() => { void data.loadMore() }}>{data.loadingMore ? tr("正在加载…") : tr("加载更多")}</button>}
      </div>

      {selected && <aside className="arkme-day-detail" aria-label={tr("活动详情")}>
        <header><h3>{detail.page?.access === 'restricted' || detail.error ? tr("活动详情") : dayActivityTitle(selected)}</h3>
          <button type="button" aria-label={tr("关闭活动详情")} className="arkme-day-icon" onClick={() => { onDetailChange?.(); setLocationRequestedId(undefined); setSelectedId(undefined) }}><X size={18} aria-hidden /></button>
        </header>
        {detail.loading && <p className="arkme-day-status" role="status">{tr("正在加载原始记录…")}</p>}
        {detail.error && <div className="arkme-day-status" role="alert">{detail.error}<button type="button" onClick={detail.retry}>{tr("重试详情")}</button></div>}
        {detail.page?.access === 'restricted' ? <p className="arkme-day-status">{tr("内容已不可访问，请刷新当天活动。")}</p>
          : !detail.error && detail.page && <>
            {detail.page.call && (renderCallDetail ? renderCallDetail(detail.page.call) : <p>{detail.page.call.detail.summaryText || detail.page.call.detail.resultLabel}</p>)}
            {!detail.page.call && detail.page.items.length === 0 && <p className="arkme-day-status">{detail.page.hasMore ? '可继续加载原始记录。' : '暂无可查看的原始记录。'}</p>}
            {detail.page.items.map(item => <article key={item.id} className="arkme-day-message">
              <div>{dayActivityDisplayName(item.author)} · <time>{dayActivityTime(item.occurredAtMillis, query.timezone)}</time></div>
              {renderRecord ? renderRecord(item) : <p>{item.text}</p>}
            </article>)}
            {(selected.canLoadLocation && reader?.loadLocation || knownLocation(selected)) && <section className="arkme-day-location" aria-label={tr("记录地点")}>
              {locationRequestedId !== selected.id ? <button type="button" className="arkme-day-source"
                onClick={() => setLocationRequestedId(selected.id)}>{knownLocation(selected) ? '查看地点详情' : '查看地点'}</button> : <>
                {location.loading ? <p role="status">{tr("正在读取地点…")}</p> : location.error ? <div role="alert">{location.error}
                  <button type="button" className="arkme-day-source" onClick={location.retry}>{tr("重试地点")}</button></div>
                  : <LocationObservation location={location.value?.location ?? (!selected.canLoadLocation ? knownLocation(selected) : undefined)} timezone={query.timezone} />}
              </>}
            </section>}
            {detail.page.hasMore && <button type="button" className="arkme-day-more" disabled={detail.loading}
              onClick={detail.loadMore}>{tr("加载更多原始记录")}</button>}
            {detail.page.sourceRef && onOpenSource && <button type="button" className="arkme-day-source"
              onClick={() => onOpenSource(detail.page!.sourceRef!)}>{tr("前往原始来源")}</button>}
          </>}
      </aside>}
    </div>
    <p className="arkme-day-footnote">{tr("查看活动及其预览不会更改会话已读状态。地点仅来自已加载记录的位置线索，不是全天完整轨迹。")}</p>
  </section>
}

function LocationObservation({ location, timezone }: { location: ArkmeRecordLocationObservation | undefined; timezone: string }) {
  if (!location) return <p>{tr("这条记录没有可确认的设备采集位置，不代表当时没有外出。")}</p>
  const captured = location.capturedAtMillis
  const capturedLabel = captured === undefined ? '采集时间未知' : new Intl.DateTimeFormat(arkmeIntlLocale(), {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(captured)
  return <>
    <strong><MapPin size={14} aria-hidden /> {location.label || '设备采集位置'}</strong>
    <dl><dt>{tr("采集时间")}</dt><dd>{capturedLabel}</dd>
      <dt>{tr("来源设备")}</dt><dd>{location.deviceLabel || '未记录设备名称'}</dd>
      <dt>{tr("坐标")}</dt><dd>{location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}</dd>
      {location.accuracyMeters !== undefined && <><dt>{tr("定位精度")}</dt><dd>{tr("约")} {Math.round(location.accuracyMeters)} {tr("米")}</dd></>}
    </dl>
    <p>{tr("这是一次设备定位，不代表连续轨迹、停留时长或整段录音的地点。")}</p>
  </>
}

function RecordingCoverage({ page }: { page: DayActivityPage }) {
  const coverage = page.coverage
  if (!coverage || coverage.state === 'error') return <p className="arkme-day-coverage-status">{tr("录音覆盖范围暂不可用，不代表当天没有录音。")}</p>
  const known = coverage.intervals.map(interval => ({ interval, style: dayActivityInterval(interval, page.dayStartMillis, page.dayEndMillis) }))
    .filter(value => value.style !== undefined)
  // Human-speech spans must stay inside known owned physical recording intervals.
  const speech = (page.speechIntervals ?? []).flatMap(interval => known.flatMap(({ interval: physical }) => {
    const style = dayActivityInterval({ startAtMillis: Math.max(interval.startAtMillis, physical.startAtMillis),
      endAtMillis: Math.min(interval.endAtMillis, physical.endAtMillis) }, page.dayStartMillis, page.dayEndMillis)
    return style ? [style] : []
  }))
  return <section className="arkme-day-coverage" aria-label={tr("全天录音覆盖")}>
    <div className="arkme-day-track" role="img" aria-label={coverage.state === 'partial'
      ? tr("录音范围尚不完整，已知 {v0} 个音频区间", { v0: known.length }) : known.length ? tr("已有录音，共 {v0} 个音频区间", { v0: known.length }) : '无已知录音'}>
      {known.map(({ style }, index) => <span key={index} className="arkme-day-recorded" style={style} />)}
      {speech.map((style, index) => <span key={index} className="arkme-day-speech" style={style} />)}
    </div>
    <div className="arkme-day-ticks"><span>{tr("当天开始")}</span><span>{tr("当天结束")}</span></div>
    <div className="arkme-day-legend"><span><i />{coverage.state === 'partial' ? '范围待确认' : '无已知录音'}</span><span><i className="arkme-day-recorded" />{tr("已有录音")}</span><span><i className="arkme-day-speech" />{tr("已识别人声")}</span></div>
    {coverage.state === 'partial' && <p className="arkme-day-coverage-status">{tr("录音覆盖数据不完整，未覆盖区间不能断言为无录音。")}</p>}
    {known.length > 0 && speech.length === 0 && <p className="arkme-day-coverage-status">{tr("已有录音，暂无已识别人声信息；不代表静音。")}</p>}
  </section>
}
