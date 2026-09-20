import { tr, useArkmeLocale } from './locale.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ArkmeRecordingCalendarMonth, ArkmeTimelineItem } from '../types.js'
import { isRecordingLocalDateOnOrAfterMinimum } from '../recording-time.js'
import { ArkmeDayTimeline } from './ArkmeDayTimeline.js'
import { ArkmeCalendarMonthView, ArkmeCalendarSurface } from './ArkmeCalendarSurface.js'
import { ArkmeMessageContent } from './ArkmeRichContent.js'
import { ArkmeTimelineDetailDrawer, ForwardRecordsDetail } from './ArkmeNoteDetails.js'
import { personalDateKey } from './existing-day-activity-reader.js'
import { createMultisourceDayActivityReader } from './multisource-day-activity-reader.js'
import { ArkmeCallDetailContent } from './ArkmeCallDetailContent.js'
import { ArkmeCallDetailDrawer } from './ArkmeCallDetailDrawer.js'
import { ArkmeMarkdownBody } from './ArkmeMarkdownBody.js'
import type { DayActivityQuery } from './calendar-activity-model.js'
import { useCalendarMonth } from './use-calendar-month.js'
import { arkmeCalendarInvalidations } from './calendar-invalidation-store.js'
import { callArkme } from './api.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { arkmeUi } from './ui-controller.js'
import { ARKME_NAVIGATION_WIDTH } from './arkme-layout.js'
import type { DayRecapGenerator } from './day-recap-input.js'

const generateDayRecap: DayRecapGenerator = (input, signal) => callArkme('calendar.day-recap', { ...input }, signal)

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
  const [monthRevision, setMonthRevision] = useState(0)
  const [legacy, setLegacy] = useState(false)
  const [richDetail, setRichDetail] = useState<ArkmeTimelineItem>()
  const [showOriginal, setShowOriginal] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const reader = useMemo(() => createMultisourceDayActivityReader(accountScope), [accountScope])
  const monthEnd = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0)
  const nextMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1).getTime()
  const month = useCalendarMonth({ scopeKey: 'global', timezone: query.timezone,
    startDate: personalDateKey(visibleMonth), endDate: personalDateKey(monthEnd) }, !!accountScope, accountScope)
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
  useEffect(() => arkmeCalendarInvalidations.subscribeDate(query.bucketDate, () => {
    setRichDetail(undefined); setRevision(value => value + 1); setMonthRevision(value => value + 1)
  }), [query.bucketDate])
  useEffect(() => {
    if (!accountScope || !isRecordingLocalDateOnOrAfterMinimum(visibleMonth.getTime())) return
    const controller = new AbortController()
    void withArkmeReadDeadline(requestSignal => callArkme<ArkmeRecordingCalendarMonth>('recordings.calendar', { fromStamp: visibleMonth.getTime(), toStamp: nextMonth }, requestSignal), controller.signal)
      .then(value => {
        if (!controller.signal.aborted) setAudioIndex({ key: monthKey, error: false,
          dates: new Set(value.days.filter(day => day.hasRecording).map(day => personalDateKey(new Date(day.dateStamp)))) })
      }).catch(() => { if (!controller.signal.aborted) setAudioIndex({ key: monthKey, error: true, dates: new Set() }) })
    return () => controller.abort()
  }, [accountScope, monthKey, nextMonth, visibleMonth])
  const refreshMonth = () => { void month.retry(); setMonthRevision(value => value + 1); setRichDetail(undefined) }

  if (legacy) return <ArkmeCalendarSurface anchor="product-rail" accountScope={accountScope} onClose={() => setLegacy(false)} />
  return <div ref={root} tabIndex={-1} role="region" aria-label={tr("个人活动日历")} className="arkme-personal-day-calendar"
    data-arkme-notification-blocking-overlay="true" style={{ left: ARKME_NAVIGATION_WIDTH }}
    onKeyDown={event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault(); event.stopPropagation()
      if (richDetail) setRichDetail(undefined); else onClose()
    }}>
    <aside className="arkme-personal-day-month" aria-label={tr("选择活动日期")}>
      <ArkmeCalendarMonthView visibleMonth={visibleMonth} selectedDate={selectedDate} today={today}
        days={month.value?.days ?? []} loading={month.loading} error={month.error}
        recordingDates={audioIndex?.key === monthKey ? audioIndex.dates : new Set()}
        onVisibleMonthChange={setVisibleMonth} onSelectDate={date => { setRichDetail(undefined); setQuery(current => ({ ...current, bucketDate: personalDateKey(date) })) }} />
      <p className="arkme-personal-day-caption">{tr("数字为个人记录数，圆点为录音索引。录音归属与覆盖范围以当天结果为准。")}</p>
      {audioIndex?.key === monthKey && audioIndex.error && <p role="status" className="arkme-personal-day-caption">{tr("录音月历暂不可用，仍可点选日期查看。")}</p>}
      <div className="arkme-personal-day-links"><button type="button" onClick={refreshMonth}>{tr("刷新月历")}</button>
        <button type="button" onClick={() => setLegacy(true)}>{tr("原版日历")}</button></div>
    </aside>
    <div className="arkme-personal-day-body" key={query.bucketDate}>
      <ArkmeDayTimeline key={revision} query={query} reader={reader} generateRecap={generateDayRecap} onClose={onClose} onRefresh={refreshMonth} onDetailChange={() => setRichDetail(undefined)}
        onQueryChange={next => { setRichDetail(undefined); setQuery(next) }}
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
        </div> : record.textFormat === 'markdown' ? <div className="arkme-day-rich-record"><ArkmeMarkdownBody text={record.text} highlightMentions={false} /></div> : <p>{record.text}</p>} />
    </div>
    {richDetail && <aside className="arkme-personal-day-rich-detail" aria-label={tr("完整快记详情")}>
      {richDetail.callRecord ? <ArkmeCallDetailDrawer item={richDetail} onClose={() => setRichDetail(undefined)} />
        : richDetail.forwardRecords ? <ForwardRecordsDetail item={richDetail} onClose={() => setRichDetail(undefined)} />
        : <ArkmeTimelineDetailDrawer key={richDetail.itemUid} item={richDetail} canExtend={false} showOriginal={showOriginal}
          onToggleOriginal={() => setShowOriginal(value => !value)} onClose={() => setRichDetail(undefined)} />}
    </aside>}
  </div>
}
