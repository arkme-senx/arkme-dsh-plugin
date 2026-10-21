import { ArkmeRichText } from './ArkmeRichText.js'
import { ReactionLabel } from './ReactionLabel.js'
import { tr, useArkmeLocale, arkmeIntlLocale } from './locale.js'
import { useDayTimelineData, type DayTimelineData } from './use-day-timeline-data.js'
import type { ReactionExpression, ReactionOriginalMessage } from '../reaction-contract.js'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArkmeDayRecap, DayRecordingReview } from './ArkmeDayRecap.js'
import type { DayRecapGenerator } from './day-recap-input.js'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { Info } from '@phosphor-icons/react/dist/icons/Info'
import { ArkmeCalendarLunarDate } from './ArkmeCalendarLunarDate.js'
import { MapPin } from '@phosphor-icons/react/dist/icons/MapPin'
import { ChatCircle } from '@phosphor-icons/react/dist/icons/ChatCircle'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import { NotePencil } from '@phosphor-icons/react/dist/icons/NotePencil'
import { Microphone } from '@phosphor-icons/react/dist/icons/Microphone'
import { Robot } from '@phosphor-icons/react/dist/icons/Robot'
import { Phone } from '@phosphor-icons/react/dist/icons/Phone'
import { TerminalWindow } from '@phosphor-icons/react/dist/icons/TerminalWindow'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { ArkmeSourceAvatar } from './ArkmeAvatar.js'
import { dayActivityMetadata, dayExcerptAuthor, isDayConversation, selectDayActivityExcerpts } from './day-activity-presentation.js'
import type { ArkmeRecordLocationObservation } from '../types.js'
import { useDayActivityLocation } from './use-day-activity-location.js'
import {
  dayActivityDisplayName, dayActivityFilters, dayActivityInterval, dayActivityLabels, dayActivityMatchesFilter, dayActivityOverview, dayActivityPeriod, dayActivityQueryKey, dayActivityTime, dayActivityTitle,
  type DayActivityDetailPage, type DayActivityEntry, type DayActivityPage, type DayActivityQuery, type DayActivityReader,
} from './calendar-activity-model.js'
import { useDayActivityDetail } from './use-day-activities.js'

export interface ArkmeDayTimelineProps {
  query: DayActivityQuery
  /** Intentionally no default adapter: no unconfirmed routes or synthetic production data. */
  reader?: DayActivityReader
  data?: DayTimelineData
  onQueryChange(query: DayActivityQuery): void
  onOpenSource?(sourceRef: string): void
  onOpenReactionSource?(message: ReactionOriginalMessage, expression?: ReactionExpression): void
  refreshVersion?: number
  renderRecord?(record: DayActivityDetailPage['items'][number]): ReactNode
  renderCallDetail?(call: NonNullable<DayActivityDetailPage['call']>): ReactNode
  onDetailChange?(): void
  arrangementsActive?: boolean
  onArrangementsChange?(active: boolean): void
  onAddArrangement?(): void
  arrangementsContent?: ReactNode
  onOpenLocations?(location?: ArkmeRecordLocationObservation): void
  generateRecap?: DayRecapGenerator
  headerNavigation?: ReactNode
}

export function ArkmeDayTimeline(props: ArkmeDayTimelineProps) {
  // The view never reuses expanded details across account/date/timezone/filter changes.
  return props.data ? <DayTimelineContent key={dayActivityQueryKey(props.query)} {...props} data={props.data} />
    : <DayTimelineReader key={dayActivityQueryKey(props.query)} {...props} />
}

function DayTimelineReader(props: ArkmeDayTimelineProps) {
  const data = useDayTimelineData(props.query, props.reader, props.refreshVersion)
  return <DayTimelineContent {...props} data={data} />
}

function DayTimelineContent({ data: { activities: data, reactions: reactionData }, headerNavigation, onOpenLocations, query, reader, onQueryChange, onOpenSource, onOpenReactionSource, renderRecord, renderCallDetail, onDetailChange, generateRecap, arrangementsActive, onArrangementsChange, arrangementsContent, onAddArrangement }: ArkmeDayTimelineProps & { data: DayTimelineData }) {
  useArkmeLocale()
  const reactionEvents = reactionData.events
  const [selectedId, setSelectedId] = useState<string>()
  const [locationRequestedId, setLocationRequestedId] = useState<string>()
  const [placesOnly, setPlacesOnly] = useState(false)
  const root = useRef<HTMLElement>(null)
  const attemptedLocations = useRef<{ snapshotId?: string; ids: Set<string> }>({ ids: new Set() })
  const [locations, setLocations] = useState<{ snapshotId?: string; values: Record<string, ArkmeRecordLocationObservation | undefined> }>({ values: {} })
  const [restrictedIds, setRestrictedIds] = useState<ReadonlySet<string>>(() => new Set())
  const selected = data.page?.items.find(item => item.id === selectedId && item.access === 'available' && !restrictedIds.has(item.id))
  const detail = useDayActivityDetail(query, selected?.id, data.page?.snapshotId, reader, selected?.detailRevision)
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
  const hasLocationHint = (item: DayActivityEntry) => Boolean(knownLocation(item) || item.locationSummary)
  useEffect(() => {
    const page = data.page, limit = reader?.capabilities?.autoLocationLimit ?? 0
    if (!page || data.loading || !reader?.loadLocation || !limit) return
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
    const candidates = new Set(page.items.filter(item => item.access === 'available' && item.canLoadLocation && !item.location?.label && !item.locationSummary?.label).map(item => item.id))
    const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        const id = (entry.target as HTMLElement).dataset.activityId
        if (id && candidates.has(id)) enqueue(id)
      }
    })
    if (observer) root.current?.querySelectorAll('[data-activity-id]').forEach(element => observer.observe(element))
    else [...candidates].slice(0, limit).forEach(enqueue)
    return () => { observer?.disconnect(); controller.abort() }
  }, [data.page, data.loading, reader, query])
  useEffect(() => {
    if (detail.page?.access === 'restricted') {
      const id = detail.page.activityId
      setRestrictedIds(current => new Set([...current, id]))
    }
  }, [detail.page])
  const change = (next: Partial<DayActivityQuery>) => onQueryChange({ ...query, ...next })
  const filteredOut = (entry: DayActivityEntry) => !dayActivityMatchesFilter(query.kind, entry.kind)
    || !query.includeBackground && entry.participation === 'background'
  const items = data.page?.items.filter(entry => !filteredOut(entry) && (!placesOnly || hasLocationHint(entry))).map(entry => restrictedIds.has(entry.id)
    ? { ...entry, access: 'restricted' as const } : entry) ?? []
  const incomplete = data.page?.completeness === 'partial' || (data.page?.missingKinds.length ?? 0) > 0
  const missing = data.page?.missingKinds.filter(kind => !reader?.capabilities || reader.capabilities.kinds.includes(kind)) ?? []
  const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: query.timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
  const visibleReactions = !placesOnly
    ? reactionEvents.map((event, index) => ({ event, index: event.eventId ?? String(index) })).filter(({ event }) => dateFormat.format(new Date(event.at)) === query.bucketDate
      && (query.kind === 'all' || event.sourceKind !== undefined && dayActivityMatchesFilter(query.kind,
        event.sourceKind === 'private_chat' || event.sourceKind === 'group_chat' ? event.sourceKind : 'note'))) : []
  const timeline = [
    ...items.map(item => ({ type: 'activity' as const, at: item.startAtMillis, item })),
    ...visibleReactions.map(({ event, index }) => ({ type: 'reaction' as const, at: event.at, event, index })),
  ].sort((a, b) => data.page?.order === 'ascending' ? a.at - b.at : b.at - a.at)
  const selectedReaction = timeline.find(entry => entry.type === 'reaction' && selectedId === `reaction:${entry.index}`)
  const reactionDetail = selectedReaction?.type === 'reaction' ? selectedReaction : undefined
  const reactionHistory = reactionDetail ? reactionEvents.map((event, index) => ({ event, index: event.eventId ?? String(index) })).filter(({ event }) => event.id === reactionDetail.event.id).sort((a, b) => a.event.at - b.event.at || a.index.localeCompare(b.index)) : []
  const empty = visibleReactions.length === 0 && reader && !data.loading && !data.error && !reactionData.busy && !reactionData.error && data.page && items.length === 0

  return <section ref={root} className="arkme-day-timeline" aria-label={tr("我的一天")}>
    <header className="arkme-day-heading">
      <div className="arkme-day-heading-label">
        <div className="arkme-day-heading-title"><h2>{tr("我的一天")}</h2>
          {!arrangementsActive && data.page && <DayActivityScopeInfo incomplete={incomplete}>
            <p>{tr('数量按当前列表统计；还有内容时，可点击“加载更多”。')}</p>
            {incomplete && <p>{missing.length > 0
              ? tr('尚未全部显示：{v0}。', { v0: missing.map(kind => tr(dayActivityLabels[kind])).join('、') })
              : tr('部分内容尚未显示。')}</p>}
            <p>{tr('在这里浏览，不会把聊天标为已读。')}</p>
          </DayActivityScopeInfo>}
        </div>
        <p>{query.bucketDate}<ArkmeCalendarLunarDate date={query.bucketDate} /> · {query.timezone}</p>
      </div>
      <div className="arkme-day-heading-actions">
        {onAddArrangement && <button type="button" className="arkme-day-source" onClick={onAddArrangement}><Plus size={15} aria-hidden /> {tr('添加安排')}</button>}
        {onOpenLocations && <button type="button" className="arkme-day-source" onClick={() => onOpenLocations()}><MapPin size={15} aria-hidden /> {tr("当天位置")}</button>}
      </div>
      {headerNavigation}
    </header>

    {!arrangementsActive && reactionData.error && <p role="alert">{reactionData.error} <button type="button" onClick={() => void reactionData.load()}>重试表态记录</button></p>}
    {!arrangementsActive && reactionData.hasMore && <button type="button" disabled={reactionData.busy} onClick={() => void reactionData.load(true)}>加载更多表态记录</button>}
    {!arrangementsActive && data.page && <>
      {(items.length > 0 || visibleReactions.length > 0) && <p className="arkme-day-overview">{dayActivityOverview(items, query.mode, visibleReactions.length)}</p>}
      {(query.kind === 'all' || query.kind === 'recording') && !placesOnly && <RecordingCoverage page={data.page} />}
    </>}

    <div className="arkme-day-filters" aria-label={tr("活动类型")}>
      {dayActivityFilters.filter(({ kind }) => kind === 'all' || !reader?.capabilities
        || reader.capabilities.kinds.some(source => dayActivityMatchesFilter(kind, source))).map(({ kind, label }) => <Fragment key={kind}>
        {kind === 'call' && onArrangementsChange && <button type="button" data-day-arrangements-tab aria-pressed={!!arrangementsActive} onClick={() => { onDetailChange?.(); onArrangementsChange(true) }}>{tr('安排')}</button>}
        <button type="button" aria-pressed={!arrangementsActive && query.kind === kind}
          onClick={() => { onArrangementsChange?.(false); change({ kind }) }}>{label}</button></Fragment>)}
      {!arrangementsActive && reader?.loadLocation && <button type="button" aria-pressed={placesOnly} onClick={() => setPlacesOnly(value => !value)}>{tr("地点")}</button>}
      {!arrangementsActive && reader?.capabilities?.background !== false && (!reader?.capabilities || reader.capabilities.kinds.includes('group_chat')) && query.mode === 'activities' && dayActivityMatchesFilter(query.kind, 'group_chat') && <label className="arkme-day-background">
        <input type="checkbox" checked={query.includeBackground} onChange={event => change({ includeBackground: event.target.checked })} />{tr("其他群动态")}</label>}
    </div>

    {arrangementsActive ? arrangementsContent : <>
    {!reader && <p className="arkme-day-status" role="status">{tr("暂时无法读取当天活动。")}</p>}
    {reader && (data.loading || reactionData.busy && !reactionData.events.length) && <p className="arkme-day-status" role="status">{tr(
      items.length || visibleReactions.length ? '正在加载更多活动…' : '正在加载当天活动…')}</p>}
    {data.error && <div className="arkme-day-status" role="alert">{data.error}<button type="button" onClick={data.refresh}>{tr("重试")}</button></div>}
    {!!data.page?.warnings?.length && <div className="arkme-day-warning" role="alert">
      {data.page.warnings.map(warning => <p key={warning}>{warning}</p>)}<button type="button" disabled={data.loading} onClick={data.refresh}>{tr("重试加载")}</button>
    </div>}
    {placesOnly && <p className="arkme-day-scope">{tr("显示带有地点信息的活动。")}</p>}
    {empty && <p className="arkme-day-status">{placesOnly ? '当前列表没有地点信息，可取消“地点”筛选查看其他活动。' : data.page!.hasMore ? '当前没有匹配的活动，可点击“加载更多”。'
      : incomplete ? '暂未找到匹配的活动，部分内容还未加载完成。' : '这一天暂无匹配内容。'}</p>}

    {generateRecap && <ArkmeDayRecap query={query} entries={data.error || data.loading ? [] : items} generate={generateRecap}
      onSource={id => { onDetailChange?.(); setSelectedId(id); setLocationRequestedId(undefined)
        requestAnimationFrame(() => root.current?.querySelector('.arkme-day-detail')?.scrollIntoView({ block: 'nearest' })) }} />}
    {data.page && (query.kind === 'all' || query.kind === 'recording') && !placesOnly && <DayRecordingReview page={data.page} />}

    <div className="arkme-day-columns" data-detail-open={!!selected || !!reactionDetail}>
      <div className="arkme-day-list" aria-label={query.mode === 'activities' ? '当天活动片段' : '当天原始明细'}>
        {timeline.map((entry, index) => {
          const period = dayActivityPeriod(Math.max(entry.at, data.page?.dayStartMillis ?? entry.at), query.timezone)
          const previous = timeline[index - 1]
          const heading = !previous || dayActivityPeriod(Math.max(previous.at, data.page?.dayStartMillis ?? previous.at), query.timezone) !== period
            ? <h3 className="arkme-day-period">{period}</h3> : null
          if (entry.type === 'reaction') return <Fragment key={`reaction:${entry.index}`}>
            {heading}
            <article className="arkme-day-entry" aria-label="表态动态">
              <DayActivityTimestamp at={entry.at} timezone={query.timezone} />
              <div className="arkme-day-entry-body">
                <button type="button" className="arkme-day-entry-content" aria-expanded={selectedId === `reaction:${entry.index}`}
                  onClick={() => { onDetailChange?.(); setLocationRequestedId(undefined); setSelectedId(current => current === `reaction:${entry.index}` ? undefined : `reaction:${entry.index}`) }}>
                  <div className="arkme-day-entry-title">
                    <span className="arkme-day-identity-icon" aria-hidden><DayActivityAvatar item={{ kind: entry.event.sourceKind === 'group_chat' || entry.event.sourceKind === 'private_chat' ? entry.event.sourceKind : 'note', access: 'available', ...(entry.event.avatar ? { avatar: entry.event.avatar } : {}) }} /></span>
                    <strong>{entry.event.sourceName || entry.event.source}</strong><span className="arkme-day-kind">表态</span>
                    <span className="arkme-day-entry-meta arkme-day-entry-heading-meta">
                      <span className="arkme-day-expand">{selectedId === `reaction:${entry.index}` ? tr('收起') : tr('展开')}<CaretRight size={12} aria-hidden /></span>
                    </span>
                  </div>
                  <div className="arkme-day-excerpts"><p><span className="arkme-day-excerpt-author">我：</span><ReactionAction added={entry.event.added} label={entry.event.label} /></p>
                    <p><span className="arkme-day-excerpt-author">{entry.event.authorName || '原消息'}：</span><ArkmeRichText text={entry.event.text || (entry.event.restricted ? '原消息已不可访问' : '暂无文字内容')} presentation="preview" /></p>
                    </div>
                </button>
              </div>
            </article>
          </Fragment>
          const item = entry.item
          return <Fragment key={item.id}>
          {heading}
          <article className="arkme-day-entry" data-activity-id={item.id}>
          <DayActivityTimestamp at={Math.max(item.startAtMillis, data.page!.dayStartMillis)} timezone={query.timezone} />
          <div className="arkme-day-entry-body">
          <button type="button" className="arkme-day-entry-content" disabled={item.access !== 'available'}
            aria-expanded={selected?.id === item.id} onClick={() => { onDetailChange?.(); setLocationRequestedId(undefined); setSelectedId(current => current === item.id ? undefined : item.id) }}>
            <div className="arkme-day-entry-title">
              <span className="arkme-day-identity-icon" aria-hidden><DayActivityAvatar item={item} /></span>
              <strong>{dayActivityTitle(item)}</strong><span className="arkme-day-kind">{tr(dayActivityLabels[item.kind])}</span>
              {item.access === 'available' && <span className="arkme-day-entry-meta arkme-day-entry-heading-meta">
                <span>{dayActivityMetadata(item, query.timezone, data.page!.dayStartMillis, data.page!.dayEndMillis)}</span>
                <span className="arkme-day-expand">{selected?.id === item.id ? tr('收起') : tr('展开')}<CaretRight size={12} aria-hidden /></span>
              </span>}
            </div>
            {item.access === 'available' && <DayActivityPreview item={item} />}
          </button>
          {item.access === 'available' && hasLocationHint(item) && !(selected?.id === item.id && location.error) && <button type="button"
            className="arkme-day-location-tag" aria-label={tr("查看地点：{v0}", { v0: knownLocation(item)?.label || item.locationSummary?.label || '设备采集位置' })}
            onClick={() => { if (onOpenLocations) { onOpenLocations(knownLocation(item)); return }; onDetailChange?.(); setSelectedId(item.id); setLocationRequestedId(item.id) }}>
            <MapPin size={14} aria-hidden /><span>{knownLocation(item)?.label || item.locationSummary?.label || tr("地址暂不可用")}</span>
          </button>}
          </div>
        </article></Fragment>
        })}
        {data.page?.hasMore && <button type="button" className="arkme-day-more" disabled={data.loading || data.loadingMore}
          onClick={() => { void data.loadMore() }}>{data.loadingMore ? tr("正在加载…") : tr("加载更多")}</button>}
      </div>

      {reactionDetail && <aside className="arkme-day-detail" aria-label={tr("活动详情")}>
        <header><h3>{reactionDetail.event.sourceName || reactionDetail.event.source}</h3>
          <button type="button" aria-label={tr("关闭活动详情")} className="arkme-day-icon" onClick={() => { onDetailChange?.(); setSelectedId(undefined) }}><X size={18} aria-hidden /></button>
        </header>
        <article className="arkme-day-message">
          <div>{reactionDetail.event.authorName || tr('原消息')}{reactionDetail.event.originalMessage && <> · <DayActivityTimestamp at={reactionDetail.event.originalMessage.sendAtMillis} timezone={query.timezone} /></>}</div>
          <p><ArkmeRichText text={reactionDetail.event.text || (reactionDetail.event.restricted ? '原消息已不可访问' : '暂无文字内容')} presentation="preview" /></p>
        </article>
        <div className="arkme-day-entry-meta">{tr('表态记录')}</div>
        {reactionHistory.map(({ event, index }) => <article key={index} className="arkme-day-message" aria-current={index === reactionDetail.index ? 'true' : undefined}>
          <div>我 · <DayActivityTimestamp at={event.at} timezone={query.timezone} /></div>
          <p><ReactionAction added={event.added} label={event.label} /></p>
        </article>)}
        {reactionDetail.event.originalMessage && !reactionDetail.event.restricted && onOpenReactionSource && <button type="button" className="arkme-day-source"
          onClick={() => onOpenReactionSource(reactionDetail.event.originalMessage!, reactionDetail.event.expression)}>{tr('前往原始来源')}</button>}
      </aside>}
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
              <div>{dayActivityDisplayName(item.author)} · <DayActivityTimestamp at={item.occurredAtMillis} timezone={query.timezone} /></div>
              {renderRecord ? renderRecord(item) : <p><ArkmeRichText text={item.text} presentation="preview" /></p>}
            </article>)}
            {(selected.canLoadLocation && reader?.loadLocation || hasLocationHint(selected)) && <section className="arkme-day-location" aria-label={tr("记录地点")}>
              {locationRequestedId !== selected.id ? <button type="button" className="arkme-day-source"
                onClick={() => setLocationRequestedId(selected.id)}>{knownLocation(selected) ? '查看地点详情' : '查看地点'}</button> : <>
                {location.loading ? <p role="status">{tr("正在读取地点…")}</p> : location.error ? <div role="alert">{location.error}
                  <button type="button" className="arkme-day-source" onClick={location.retry}>{tr("重试地点")}</button></div>
                  : <LocationObservation location={location.value?.location ?? (!selected.canLoadLocation ? knownLocation(selected) : undefined)} summary={selected.locationSummary} timezone={query.timezone} />}
              </>}
            </section>}
            {detail.page.hasMore && <button type="button" className="arkme-day-more" disabled={detail.loading}
              onClick={detail.loadMore}>{tr("加载更多原始记录")}</button>}
            {detail.page.sourceRef && onOpenSource && <button type="button" className="arkme-day-source"
              onClick={() => onOpenSource(detail.page!.sourceRef!)}>{tr("前往原始来源")}</button>}
          </>}
      </aside>}
    </div>
    </>}
  </section>
}

function ReactionAction({ added, label }: { added: boolean; label: string }) {
  return added ? <>表态「<ReactionLabel label={label} />」</> : <>取消表态<del className="arkme-reaction-cancelled">「<ReactionLabel label={label} />」</del></>
}

function DayActivityScopeInfo({ incomplete, children }: { incomplete: boolean; children: ReactNode }) {
  const root = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const element = root.current
    if (!element) return
    const closeOutside = (event: PointerEvent) => {
      if (element.open && event.target instanceof Node && !element.contains(event.target)) element.open = false
    }
    element.ownerDocument.addEventListener('pointerdown', closeOutside)
    return () => element.ownerDocument.removeEventListener('pointerdown', closeOutside)
  }, [])
  const status = incomplete ? tr('部分内容尚未显示') : tr('关于活动')
  return <details ref={root} className="arkme-day-scope-info" onKeyDown={event => {
    if (event.key !== 'Escape' || !root.current?.open) return
    event.preventDefault(); event.stopPropagation(); root.current.open = false
    root.current.querySelector('summary')?.focus({ preventScroll: true })
  }}>
    <summary aria-label={tr('查看范围')} title={`${status} · ${tr('查看范围')}`}><Info size={17} aria-hidden /></summary>
    <div className="arkme-day-scope-panel"><strong>{status}</strong>{children}</div>
  </details>
}

function DayActivityTimestamp({ at, timezone }: { at: number; timezone: string }) {
  return <time dateTime={new Date(at).toISOString()}>{dayActivityTime(at, timezone)}</time>
}

function DayActivityAvatar({ item }: { item: Pick<DayActivityEntry, 'kind' | 'access' | 'avatar'> }) {
  if (item.access === 'available' && item.avatar && (item.avatar.avatarRef || item.avatar.avatarRefs?.length || item.avatar.groupAvatar)) {
    return item.kind === 'group_chat' && (item.avatar.avatarRefs?.length || item.avatar.groupAvatar)
      ? <ArkmeSourceAvatar kind="group" avatarRefs={item.avatar.avatarRefs} groupAvatar={item.avatar.groupAvatar} size={24} />
      : <ArkmeSourceAvatar kind="single" avatarRef={item.avatar.avatarRef} size={24} />
  }
  const Icon = item.kind === 'note' ? NotePencil : item.kind === 'recording' ? Microphone : item.kind === 'call' ? Phone
    : item.kind === 'dsh' ? TerminalWindow : item.kind === 'arko' || item.kind === 'bot' ? Robot : item.kind === 'group_chat' ? Users : ChatCircle
  return <Icon size={18} aria-hidden />
}

function DayActivityPreview({ item }: { item: DayActivityEntry }) {
  if (isDayConversation(item)) {
    const excerpts = item.excerpts ?? selectDayActivityExcerpts([item])
    return <div className="arkme-day-excerpts">{excerpts.length ? excerpts.map(excerpt => <p key={excerpt.id}>
      <span className="arkme-day-excerpt-author">{dayExcerptAuthor(item, excerpt)}{dayExcerptAuthor(item, excerpt) ? '：' : ''}</span><ArkmeRichText text={excerpt.text} presentation="preview" />
    </p>) : <p>{tr('暂无内容预览，展开查看详情')}</p>}</div>
  }
  return item.preview ? <p>{item.kind === 'call' && tr('已有摘要：')}<ArkmeRichText text={item.preview} presentation="preview" /></p> : null
}

function LocationObservation({ location, summary, timezone }: { location: ArkmeRecordLocationObservation | undefined; summary?: DayActivityEntry['locationSummary']; timezone: string }) {
  if (!location && summary) return <>
    <strong><MapPin size={14} aria-hidden /> {summary.label || '设备采集位置'}</strong>
    {summary.capturedAtMillis !== undefined && <p>{tr("采集时间")}：{new Intl.DateTimeFormat(arkmeIntlLocale(), { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(summary.capturedAtMillis)}</p>}
  </>
  if (!location) return <p>{tr("这条记录没有保存位置信息。")}</p>
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
    <p>{tr("这是记录关联的位置信息。")}</p>
  </>
}

function RecordingCoverage({ page }: { page: DayActivityPage }) {
  const coverage = page.coverage
  if (!coverage) return null
  if (coverage.state === 'error') return <p className="arkme-day-coverage-status" role="status">{tr('录音时段暂时无法显示。')}</p>
  const known = coverage.intervals.map(interval => ({ interval, style: dayActivityInterval(interval, page.dayStartMillis, page.dayEndMillis) }))
    .filter(value => value.style !== undefined)
  if (!known.length && coverage.state !== 'partial') return null
  // Human-speech spans must stay inside known owned physical recording intervals.
  const speech = (page.speechIntervals ?? []).flatMap(interval => known.flatMap(({ interval: physical }) => {
    const style = dayActivityInterval({ startAtMillis: Math.max(interval.startAtMillis, physical.startAtMillis),
      endAtMillis: Math.min(interval.endAtMillis, physical.endAtMillis) }, page.dayStartMillis, page.dayEndMillis)
    return style ? [style] : []
  }))
  return <section className="arkme-day-coverage" aria-label={tr("全天录音覆盖")}>
    <p className="arkme-day-coverage-status">{tr('录音时段')}</p>
    <div className="arkme-day-track" role="img" aria-label={coverage.state === 'partial'
      ? tr("录音范围尚不完整，已知 {v0} 个音频区间", { v0: known.length }) : known.length ? tr("已有录音，共 {v0} 个音频区间", { v0: known.length }) : '无已知录音'}>
      {known.map(({ style }, index) => <span key={index} className="arkme-day-recorded" style={style} />)}
      {speech.map((style, index) => <span key={index} className="arkme-day-speech" style={style} />)}
    </div>
    <div className="arkme-day-ticks"><span>{tr("当天开始")}</span><span>{tr("当天结束")}</span></div>
    {coverage.state === 'partial' && <p className="arkme-day-coverage-status">{tr('部分录音时段尚未显示。')}</p>}
  </section>
}
