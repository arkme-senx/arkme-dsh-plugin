import { ArkmeRichText } from './ArkmeRichText.js'
import { tr, useArkmeLocale, arkmeIntlLocale } from './locale.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ArkmeCalendarBucketDay, ArkmeRecordingCalendarMonth, ArkmeTimelineItem } from '../types.js'
import { isRecordingLocalDateOnOrAfterMinimum } from '../recording-time.js'
import { ArkmeDayArrangements } from './ArkmeDayArrangements.js'
import { ArkmeArrangementCreate, ArkmeArrangementCreationStatus, useCreatedArrangements } from './ArkmeArrangementCreate.js'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { ArkmeCalendarLunarDate } from './ArkmeCalendarLunarDate.js'
import { useCalendarAutoRefresh } from './use-calendar-auto-refresh.js'
import { ArkmeDayTimeline } from './ArkmeDayTimeline.js'
import { openReactionHistory } from './ArkmeReactionNotification.js'
import { ArkmeCalendarMonthView } from './ArkmeCalendarSurface.js'
import { ArkmeMessageContent } from './ArkmeRichContent.js'
import { ArkmeTimelineDetailDrawer, ForwardRecordsDetail } from './ArkmeNoteDetails.js'
import { ArkmeDayLocationMap } from './ArkmeDayLocationMap.js'
import type { ArkmeRecordLocationObservation } from '../types.js'
import { personalDateKey } from './existing-day-activity-reader.js'
import { createDocumentedDayActivityReader } from './documented-day-activity-reader.js'
import { useDocumentedDayMonth } from './use-documented-day-month.js'
import { ArkmeCallDetailContent } from './ArkmeCallDetailContent.js'
import { ArkmeCallDetailDrawer } from './ArkmeCallDetailDrawer.js'
import { ArkmeMarkdownBody } from './ArkmeMarkdownBody.js'
import type { DayActivityQuery } from './calendar-activity-model.js'
import { useCalendarMonth } from './use-calendar-month.js'
import { callArkme } from './api.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { arkmeUi } from './ui-controller.js'
import { ARKME_NAVIGATION_WIDTH } from './arkme-layout.js'
import { ArkmeCalendarDayReview, CalendarDayTabs, type CalendarDayView } from './ArkmeCalendarDayReview.js'

export function ArkmePersonalDayCalendar(props: { accountScope?: string | undefined; onClose(): void }) {
  return <PersonalDayCalendar key={props.accountScope ?? 'signed-out'} {...props} />
}

function PersonalDayCalendar({ accountScope = '', onClose }: { accountScope?: string | undefined; onClose(): void }) {
  useArkmeLocale()
  const [today] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate()) })
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [query, setQuery] = useState<DayActivityQuery>(() => ({ accountScope, bucketDate: personalDateKey(today),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, kind: 'all', mode: 'activities', includeBackground: false }))
  const [revision, setRevision] = useState(0)
  const [hardRevision, setHardRevision] = useState(0)
  const [monthRevision, setMonthRevision] = useState(0)
  const [dayArrangementsOpen, setDayArrangementsOpen] = useState(false)
  const [dayView, setDayView] = useState<CalendarDayView>('activity')
  const [createOpen, setCreateOpen] = useState(false)
  const created = useCreatedArrangements()
  const [locationMap, setLocationMap] = useState<{ initialLocation?: ArkmeRecordLocationObservation }>()
  const [richDetail, setRichDetail] = useState<ArkmeTimelineItem>()
  const [showOriginal, setShowOriginal] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const reader = useMemo(() => createDocumentedDayActivityReader(accountScope), [accountScope])
  const hasHistoryMonth = visibleMonth <= today
  const isFuture = query.bucketDate > personalDateKey(today)
  const documentedMonth = useDocumentedDayMonth(accountScope, visibleMonth, query.timezone, hasHistoryMonth, monthRevision)
  const monthEnd = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0)
  const nextMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1).getTime()
  const month = useCalendarMonth({ scopeKey: 'global', timezone: query.timezone,
    startDate: personalDateKey(visibleMonth), endDate: personalDateKey(monthEnd) }, !!accountScope && hasHistoryMonth, accountScope)
  const monthKey = `${accountScope}:${visibleMonth.getTime()}:${monthRevision}`
  const [audioIndex, setAudioIndex] = useState<{ key: string; dates: Set<string>; error: boolean }>()
  const selected = query.bucketDate.split('-').map(Number)
  const selectedDate = new Date(selected[0]!, selected[1]! - 1, selected[2]!)

  useEffect(() => {
    if (typeof document === 'undefined') return
    const previous = document.activeElement
    root.current?.focus({ preventScroll: true })
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  useCalendarAutoRefresh(accountScope, query.bucketDate, hard => {
    if (hard) { setRichDetail(undefined); setLocationMap(undefined); setHardRevision(value => value + 1) }
    setRevision(value => value + 1); setMonthRevision(value => value + 1)
  })
  useEffect(() => {
    if (!accountScope || !hasHistoryMonth || !isRecordingLocalDateOnOrAfterMinimum(visibleMonth.getTime())) return
    const controller = new AbortController()
    void withArkmeReadDeadline(requestSignal => callArkme<ArkmeRecordingCalendarMonth>('recordings.calendar', { fromStamp: visibleMonth.getTime(), toStamp: nextMonth }, requestSignal), controller.signal)
      .then(value => {
        if (!controller.signal.aborted) setAudioIndex({ key: monthKey, error: false,
          dates: new Set(value.days.filter(day => day.hasRecording).map(day => personalDateKey(new Date(day.dateStamp)))) })
      }).catch(() => { if (!controller.signal.aborted) setAudioIndex({ key: monthKey, error: true, dates: new Set() }) })
    return () => controller.abort()
  }, [accountScope, monthKey, nextMonth, visibleMonth, hasHistoryMonth])
  const refreshMonth = () => { if (hasHistoryMonth) void month.retry(); setMonthRevision(value => value + 1); setRichDetail(undefined) }

  const markerDays = new Map(documentedMonth.markers)
  if (audioIndex?.key === monthKey) for (const date of audioIndex.dates) {
    markerDays.set(date, { ...(markerDays.get(date) ?? {}), recording: true })
  }
  const calendarDayMap = new Map((month.value?.days ?? []).map(day => [day.bucketDate, day]))
  for (const [bucketDate, activityMarkers] of markerDays) {
    const existing = calendarDayMap.get(bucketDate)
    if (existing) calendarDayMap.set(bucketDate, { ...existing, hasRecords: existing.hasRecords || Object.values(activityMarkers).some(Boolean), activityMarkers: { ...(existing.activityMarkers ?? {}), ...activityMarkers } })
    else calendarDayMap.set(bucketDate, { bucketDate, count: 0, protectedCount: 0, hasRecords: true, activityMarkers } satisfies ArkmeCalendarBucketDay)
  }
  const calendarDays = [...calendarDayMap.values()].sort((left, right) => left.bucketDate.localeCompare(right.bucketDate))
  const navigation = <CalendarDayTabs view={dayView} onChange={view => { setDayView(view); setRichDetail(undefined); setLocationMap(undefined) }} />
  return <div ref={root} tabIndex={-1} role="region" aria-label={tr("个人活动日历")} className="arkme-personal-day-calendar"
    data-arkme-notification-blocking-overlay="true" style={{ left: ARKME_NAVIGATION_WIDTH }}
    onKeyDown={event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault(); event.stopPropagation()
      if (locationMap) { setLocationMap(undefined); return }
      if (createOpen) { setCreateOpen(false); return }
      if (richDetail) setRichDetail(undefined); else onClose()
    }}>
    <aside className="arkme-personal-day-month" aria-label={tr("选择活动日期")}>
      <div className="arkme-personal-day-month-content">
      <ArkmeCalendarMonthView visibleMonth={visibleMonth} selectedDate={selectedDate} today={today} allowFuture
        days={calendarDays} loading={hasHistoryMonth && (month.loading || documentedMonth.loading)} error={hasHistoryMonth ? month.error : ''}
        recordingDates={audioIndex?.key === monthKey ? audioIndex.dates : new Set()}
        onVisibleMonthChange={setVisibleMonth} onSelectDate={date => { setLocationMap(undefined); setCreateOpen(false); setRichDetail(undefined); setQuery(current => ({ ...current, bucketDate: personalDateKey(date) })) }} />
      <p className="arkme-personal-day-caption">{tr("数字为个人记录数，圆点为录音索引。录音归属与覆盖范围以当天结果为准。")}</p>
      {audioIndex?.key === monthKey && audioIndex.error && <p role="status" className="arkme-personal-day-caption">{tr("录音月历暂不可用，仍可点选日期查看。")}</p>}
      <div className="arkme-personal-day-links"><button type="button" onClick={refreshMonth}>{tr("刷新月历")}</button>
      </div>
      </div>
    </aside>
    <div className="arkme-personal-day-body" key={query.bucketDate}>
      {isFuture ? <section className="arkme-day-timeline" aria-label={tr('未来安排')}>
        <header className="arkme-day-heading"><div><h2>{query.bucketDate}</h2><p>{new Intl.DateTimeFormat(arkmeIntlLocale(), { weekday: 'long' }).format(selectedDate)}<ArkmeCalendarLunarDate date={query.bucketDate} /></p></div>
          <div className="arkme-day-heading-actions">
            <button type="button" className="arkme-day-source" onClick={() => setCreateOpen(true)}><Plus size={15} aria-hidden /> {tr('添加安排')}</button>
          </div>
        </header>
        <ArkmeDayArrangements key={hardRevision} refreshVersion={revision} scheduledOnly recentItems={created.items} accountScope={accountScope} bucketDate={query.bucketDate} timezone={query.timezone} />
      </section> : dayView !== 'activity' ? <section className="arkme-day-timeline" aria-label={tr('我的一天')}>
        <header className="arkme-day-heading"><div className="arkme-day-heading-label"><h2>{tr('我的一天')}</h2><p>{query.bucketDate}<ArkmeCalendarLunarDate date={query.bucketDate} /> · {query.timezone}</p></div>
          <div className="arkme-day-heading-actions"><button type="button" className="arkme-day-source" onClick={() => setCreateOpen(true)}><Plus size={15} aria-hidden /> {tr('添加安排')}</button>
            <button type="button" className="arkme-day-source" onClick={() => setLocationMap({})}>{tr('当天位置')}</button></div>{navigation}</header>
        <ArkmeCalendarDayReview key={hardRevision} query={query} view={dayView} refreshVersion={revision} />
      </section> : <ArkmeDayTimeline headerNavigation={navigation} onAddArrangement={() => setCreateOpen(true)} onOpenLocations={location => setLocationMap(location ? { initialLocation: location } : {})} key={hardRevision} refreshVersion={revision} arrangementsActive={dayArrangementsOpen} onArrangementsChange={setDayArrangementsOpen}
        arrangementsContent={<ArkmeDayArrangements refreshVersion={revision} recentItems={created.items} accountScope={accountScope} bucketDate={query.bucketDate} timezone={query.timezone} />} query={query} reader={reader} onDetailChange={() => setRichDetail(undefined)}
        onQueryChange={next => { setRichDetail(undefined); setQuery(next) }}
        onOpenReactionSource={(message, expression) => {
          onClose()
          openReactionHistory(message, expression)
        }}
        onOpenSource={ref => {
          const target = reader.resolveTarget(ref)
          if (!target) return
          onClose()
          if (target.kind === 'recording') arkmeUi.showRecordingTarget(target.dateStamp, target.startAtMillis)
          else if (target.kind === 'arko') arkmeUi.showArko()
          else if (target.kind === 'bot') arkmeUi.openBotConversation(target.bot)
          else arkmeUi.selectSource(target.source)
        }} renderCallDetail={call => <ArkmeCallDetailContent key={call.item.callRef} compact selectedItem={call.item}
          detail={call.detail} detailState="ready" />}
        renderRecord={record => record.content ? <div className="arkme-day-rich-record">
          <ArkmeMessageContent item={record.content} onArticleOpen={() => setRichDetail(record.content)} onCallDetailOpen={() => setRichDetail(record.content)} />
          <button type="button" className="arkme-day-source" onClick={() => { setShowOriginal(false); setRichDetail(record.content) }}>{tr("查看完整快记")}</button>
        </div> : record.textFormat === 'markdown' ? <div className="arkme-day-rich-record"><ArkmeMarkdownBody text={record.text} highlightMentions={false} /></div> : <p><ArkmeRichText text={record.text} presentation="preview" /></p>} />}
      <ArkmeArrangementCreationStatus created={created} />
    </div>
    <ArkmeArrangementCreate accountScope={accountScope} open={createOpen} dateContext={{ defaultDate: query.bucketDate, timezone: query.timezone }} onClose={() => setCreateOpen(false)}
      onSaved={items => { created.merge(items); setDayArrangementsOpen(true); setDayView('activity') }} />
    {locationMap && <ArkmeDayLocationMap key={`${accountScope}:${query.bucketDate}:${query.timezone}`} query={query} {...locationMap} onClose={() => setLocationMap(undefined)} />}
    {richDetail && <aside className="arkme-personal-day-rich-detail" aria-label={tr("完整快记详情")}>
      {richDetail.callRecord ? <ArkmeCallDetailDrawer item={richDetail} onClose={() => setRichDetail(undefined)} />
        : richDetail.forwardRecords ? <ForwardRecordsDetail item={richDetail}
          onPrivateChatOpened={source => { setRichDetail(undefined); onClose(); arkmeUi.selectSource(source) }}
          onClose={() => setRichDetail(undefined)} />
        : <ArkmeTimelineDetailDrawer key={richDetail.itemUid} item={richDetail} canExtend={false} showOriginal={showOriginal}
          onToggleOriginal={() => setShowOriginal(value => !value)} onClose={() => setRichDetail(undefined)} />}
    </aside>}
  </div>
}
