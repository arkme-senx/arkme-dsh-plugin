import { useCallback, useEffect, useRef, useState } from 'react'
import { DAY_REVIEW_LABELS, DAY_REVIEW_SOURCES, type DayReviewQuery, type DayReviewResult, type DayReviewSource, type DayReviewState } from '../calendar-day-review.js'
import type { DayReviewOpenSource } from '../services/calendar-day-review-service.js'
import { callArkme } from './api.js'
import { ArkmeClientError } from '../sdk/index.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { tr, useArkmeLocale } from './locale.js'
import { arkmeUi } from './ui-controller.js'
import { ArkmeTimelineDetailDrawer } from './ArkmeNoteDetails.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { ArkmeCallDetailContent } from './ArkmeCallDetailContent.js'
import { ExploreRecordingSource } from './explore/ExploreSurface.js'
import { CalendarDayReviewPromptEditor, DayReviewPromptSnapshot, useDayReviewPrompts } from './CalendarDayReviewPrompts.js'
import { promptConfigOnly, sameReviewPrompts } from '../calendar-day-review-prompts.js'

export type CalendarDayView = 'activity' | 'summary' | 'timeline'
export function CalendarDayTabs({ view, onChange }: { view: CalendarDayView; onChange(view: CalendarDayView): void }) {
  return <nav className="calendar-day-tabs" aria-label={tr('当天视图')}>
    {(['activity', 'summary', 'timeline'] as const).map(key => <button type="button" key={key} aria-pressed={view === key}
      onClick={() => onChange(key)}>{tr({ activity: '活动', summary: '日总结', timeline: '时间轴' }[key])}</button>)}
  </nav>
}
const errorText = (e: unknown) => e instanceof Error ? e.message : tr('暂时无法读取日历回顾，请重试')
const stages = { queued: '等待生成', collecting: '收集资料', organizing: '整理内容', generating: '生成回顾', failed: '生成未完成' }
const coverageLabels = { complete: '已覆盖', partial: '部分覆盖', unavailable: '暂不可用', empty: '当天无内容' }
const running = (state: DayReviewState | undefined) => !!state?.job && state.job.status !== 'failed'

/** No local material collection or synthetic summaries: durable owner jobs only. */
export function ArkmeCalendarDayReview({ query, view, refreshVersion = 0 }: { query: DayReviewQuery; view: 'summary' | 'timeline'; refreshVersion?: number }) {
  return <DayReviewContent key={`${query.accountScope}:${query.bucketDate}:${query.timezone}`} query={query} view={view} refreshVersion={refreshVersion} />
}
function DayReviewContent({ query, view, refreshVersion }: { query: DayReviewQuery; view: 'summary' | 'timeline'; refreshVersion: number }) {
  useArkmeLocale()
  const [state, setState] = useState<DayReviewState>(), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [sources, setSources] = useState<DayReviewSource[]>([...DAY_REVIEW_SOURCES]), [submitting, setSubmitting] = useState(false)
  const [selectedVersion, updateSelectedVersion] = useState(''), [historical, setHistorical] = useState<DayReviewResult>(), [versionLoading, setVersionLoading] = useState(false)
  const [source, setSource] = useState<DayReviewOpenSource>(), [sourceLoading, setSourceLoading] = useState(''), [sourceError, setSourceError] = useState('')
  const [showOriginal, setShowOriginal] = useState(false), [uncertain, setUncertain] = useState(false)
  const readRequest = useRef<AbortController>(), writeRequest = useRef<AbortController>(), sourceRequest = useRef<AbortController>()
  const refreshPending = useRef(false)
  const readFailed = useRef(false)
  const versionRequest = useRef<AbortController>(), mounted = useRef(true), submittingRef = useRef(false)
  const selectionTouched = useRef(false), requestId = useRef('')
  const q = useRef(query).current
  const prompts = useDayReviewPrompts(q)
  const [reuse, setReuse] = useState<DayReviewResult>()
  const pendingSubmission = useRef<Record<string, unknown>>()
  const selectedVersionRef = useRef('')
  const sourceTarget = useRef<{ resultId: string; sourceRef: string }>()
  const setSelectedVersion = useCallback((id: string) => { selectedVersionRef.current = id; updateSelectedVersion(id) }, [])
  const clearSource = useCallback(() => { sourceTarget.current = undefined; setSource(undefined); setSourceLoading('') }, [])
  const apply = useCallback((value: DayReviewState) => {
    readFailed.current = false
    setState(value)
    if (value.resultError) {
      setReuse(undefined); clearSource(); setHistorical(undefined); setSelectedVersion(''); setVersionLoading(false)
      sourceRequest.current?.abort(); versionRequest.current?.abort()
    }
    setUncertain(!!value.pendingRequestId)
    if (value.pendingRequestId) requestId.current = value.pendingRequestId
    if (!selectionTouched.current && value.result) setSources(value.result.sourceKinds)
    // A refreshed job may belong to another client; only the matching create reply acknowledges this submission.
  }, [clearSource, setSelectedVersion])
  const read = useCallback(async function readLatest(retryAfterFailure = false): Promise<void> {
    if (submittingRef.current || (readFailed.current && !retryAfterFailure)) return
    if (!q.accountScope) { setLoading(false); setError(tr('账号范围尚未确认，请重新打开日历')); return }
    // Ordinary realtime hints must not keep cancelling a slow read or restarting
    // its deadline. Retain one follow-up; privacy/date/account changes still
    // remount this component and immediately abort through the effect cleanup.
    if (readRequest.current && !readRequest.current.signal.aborted) { refreshPending.current = true; return }
    refreshPending.current = false
    readFailed.current = false
    const controller = new AbortController(); readRequest.current = controller
    setLoading(true); setError('')
    try {
      const version = selectedVersionRef.current, original = sourceTarget.current
      // Refresh open content through the same authorized read endpoints. Progress
      // polling must neither close the reader nor keep revoked history visible.
      const [next, history, evidence] = await Promise.allSettled([
        withArkmeReadDeadline(signal => callArkme<DayReviewState>('calendar.day-review.state', { ...q }, signal), controller.signal),
        version ? withArkmeReadDeadline(signal => callArkme<DayReviewResult>('calendar.day-review.result', { ...q, resultId: version }, signal), controller.signal) : Promise.resolve(undefined),
        original ? withArkmeReadDeadline(signal => callArkme<DayReviewOpenSource>('calendar.day-review.source', { ...q, ...original }, signal), controller.signal) : Promise.resolve(undefined),
      ])
      if (controller.signal.aborted) return
      if (next.status === 'rejected') throw next.reason
      apply(next.value)
      if (version && selectedVersionRef.current === version) {
        if (history.status === 'rejected') { readFailed.current = true; clearSource(); setHistorical(undefined); setSelectedVersion(''); versionRequest.current?.abort(); sourceRequest.current?.abort(); setError(errorText(history.reason)) }
        else setHistorical(history.value)
      }
      if (original && sourceTarget.current === original) {
        if (evidence.status === 'rejected') { readFailed.current = true; clearSource(); setHistorical(undefined); setSelectedVersion(''); setState(undefined); versionRequest.current?.abort(); sourceRequest.current?.abort(); setError(errorText(evidence.reason)) }
        else setSource(evidence.value)
      }
    } catch (e) { if (!controller.signal.aborted) { readFailed.current = true; setError(errorText(e)); setState(undefined); clearSource(); setHistorical(undefined); setSelectedVersion(''); sourceRequest.current?.abort(); versionRequest.current?.abort() } }
    finally {
      if (readRequest.current === controller) readRequest.current = undefined
      if (!controller.signal.aborted) {
        setLoading(false)
        // A failed read must leave its error and manual retry available. Realtime
        // hints are not retries; only successful reads consume queued hints.
        if (readFailed.current) refreshPending.current = false
        else if (refreshPending.current) void readLatest()
      }
    }
  }, [q, apply, clearSource, setSelectedVersion])
  useEffect(() => {
    mounted.current = true; void read()
    return () => {
      mounted.current = false
      readRequest.current?.abort(); writeRequest.current?.abort(); sourceRequest.current?.abort(); versionRequest.current?.abort()
    }
  }, [read])
  // The calendar owns foreground/data invalidations; hard privacy changes remount this view.
  const lastRevision = useRef(refreshVersion)
  useEffect(() => {
    if (lastRevision.current === refreshVersion) return
    lastRevision.current = refreshVersion
    void read()
  }, [refreshVersion, read])
  const active = running(state)
  useEffect(() => {
    if (!active || loading || submitting || error) return
    const timer = setTimeout(() => { if (typeof document === 'undefined' || document.visibilityState === 'visible') void read() }, 5000)
    return () => clearTimeout(timer)
  }, [active, loading, submitting, error, read])
  const generate = async () => {
    if (submittingRef.current || (active && !uncertain) || !state?.supported || !sources.length || (!uncertain && prompts.block)) return
    submittingRef.current = true; setSubmitting(true); setError(''); setLoading(false)
    readRequest.current?.abort(); versionRequest.current?.abort(); setVersionLoading(false)
    const controller = new AbortController(); writeRequest.current = controller
    let refreshAccepted = false
    // Retain the same id after a lost acknowledgement; do not start a second billable job.
    requestId.current ||= crypto.randomUUID()
    const config = prompts.draft.saved ?? prompts.support?.defaults
    pendingSubmission.current ??= { ...q, sourceKinds: reuse?.sourceKinds ?? [...sources], requestId: requestId.current,
      ...(config ? { promptConfig: promptConfigOnly(config) } : {}), ...(reuse ? { reuseResultId: reuse.id } : {}) }
    try {
      const value = await withArkmeReadDeadline(signal => uncertain ? callArkme<DayReviewState>('calendar.day-review.reconcile', { ...q }, signal) : callArkme<DayReviewState>('calendar.day-review.create', pendingSubmission.current!, signal), controller.signal)
      if (controller.signal.aborted) return
      refreshAccepted = !value.result && !!value.job
      apply(value); setSelectedVersion(''); setHistorical(undefined); setUncertain(false); requestId.current = ''; pendingSubmission.current = undefined; setReuse(undefined)
    } catch (e) {
      if (!controller.signal.aborted) {
        const notSubmitted = e instanceof ArkmeClientError && ['calendar-review-prompt-unsupported', 'calendar-review-unavailable', 'calendar-review-not-accepted', 'calendar-review-storage'].includes(e.body.code)
        if (notSubmitted) {
          setUncertain(false); requestId.current = ''; pendingSubmission.current = undefined; setError(errorText(e)); void prompts.read()
        } else { setUncertain(true); setError(`${tr('提交结果尚未确认，请先检查更新。再次提交会核对同一次请求。')} ${errorText(e)}`) }
      }
    } finally {
      submittingRef.current = false
      if (mounted.current && !controller.signal.aborted) { setSubmitting(false); if (refreshAccepted) void read() }
    }
  }
  const resume = async () => {
    if (!state?.job || submittingRef.current) return
    submittingRef.current = true; setSubmitting(true); setError(''); readRequest.current?.abort()
    const controller = new AbortController(); writeRequest.current = controller
    try {
      const value = await withArkmeReadDeadline(signal => callArkme<DayReviewState>('calendar.day-review.resume', { ...q, jobId: state.job!.id }, signal), controller.signal)
      if (!controller.signal.aborted) apply(value)
    } catch (e) { if (!controller.signal.aborted) setError(errorText(e)) }
    finally { submittingRef.current = false; if (mounted.current && !controller.signal.aborted) setSubmitting(false) }
  }
  const selectVersion = async (id: string) => {
    readFailed.current = false
    versionRequest.current?.abort(); sourceRequest.current?.abort(); clearSource(); setSourceError(''); setSourceLoading('')
    setReuse(undefined); setSelectedVersion(id); setHistorical(undefined); setError('')
    if (!id) { setVersionLoading(false); return }
    const controller = new AbortController(); versionRequest.current = controller; setVersionLoading(true)
    try {
      const value = await withArkmeReadDeadline(signal => callArkme<DayReviewResult>('calendar.day-review.result', { ...q, resultId: id }, signal), controller.signal)
      if (!controller.signal.aborted) setHistorical(value)
    } catch (e) { if (!controller.signal.aborted) setError(errorText(e)) }
    finally { if (!controller.signal.aborted) setVersionLoading(false) }
  }
  const result = selectedVersion ? historical : state?.result
  const openSource = async (ref: string) => {
    if (!result) return
    sourceRequest.current?.abort(); const controller = new AbortController(); sourceRequest.current = controller
    clearSource(); setSourceLoading(ref); setSourceError('')
    try {
      const value = await withArkmeReadDeadline(signal => callArkme<DayReviewOpenSource>('calendar.day-review.source', { ...q, resultId: result.id, sourceRef: ref }, signal), controller.signal)
      if (controller.signal.aborted) return
      if (value.kind === 'conversation') arkmeUi.showConversationTarget(value.source, value.itemUid, value.sendAtMillis, undefined, undefined, true)
      else { sourceTarget.current = { resultId: result.id, sourceRef: ref }; setShowOriginal(false); setSource(value) }
    } catch (e) { if (!controller.signal.aborted) { setError(errorText(e)); setState(undefined); setHistorical(undefined); setSelectedVersion(''); clearSource(); versionRequest.current?.abort() } }
    finally { if (!controller.signal.aborted) setSourceLoading('') }
  }
  const stamp = (at: number) => new Intl.DateTimeFormat('zh-CN', { timeZone: q.timezone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(at)
  const time = (at: number | null) => at === null ? tr('时间未知') : new Intl.DateTimeFormat('zh-CN', { timeZone: q.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(at)
  const citations = (refs: string[]) => <div className="day-review-citations">{refs.map(ref => {
    const evidence = result?.sources.find(x => x.ref === ref)
    return evidence && <button type="button" key={ref} className="arkme-day-source" disabled={sourceLoading === ref}
      onClick={() => void openSource(ref)}>{sourceLoading === ref ? tr('正在打开…') : evidence.label}</button>
  })}</div>
  return <div className="calendar-day-review" aria-label={tr(view === 'summary' ? '日总结内容' : '时间轴内容')}>
    <div className="day-review-controls">
      <fieldset disabled={submitting || active || uncertain || !!reuse}><legend>{tr('生成范围')}</legend>
        {DAY_REVIEW_SOURCES.map(kind => <label key={kind}><input type="checkbox" checked={sources.includes(kind)} onChange={event => {
          selectionTouched.current = true; requestId.current = ''
          setSources(current => event.target.checked ? DAY_REVIEW_SOURCES.filter(x => x === kind || current.includes(x)) : current.filter(x => x !== kind))
        }} />{tr(DAY_REVIEW_LABELS[kind])}</label>)}
      </fieldset>
      <div className="day-review-actions">
        <button type="button" className="arkme-day-source" aria-expanded={prompts.open} onClick={prompts.toggle}>{tr('提示词')}{prompts.draft.editing ? ' · ' + tr('未保存') : prompts.draft.saved ? ' · ' + tr('自定义') : ''}</button>
        <button type="button" className="arkme-day-source" disabled={loading || submitting} onClick={() => void read(true)}>{tr('检查更新')}</button>
        <button type="button" className="day-review-generate" disabled={!state?.supported || !sources.length || submitting || (active && !uncertain) || loading || (!uncertain && !!prompts.block)} onClick={() => void generate()}>
          {tr(submitting ? '正在提交…' : uncertain ? '核对提交' : active ? '正在生成…' : state?.result ? '更新回顾' : '生成当天回顾')}</button>
      </div>
    </div>
    <p className="day-review-hint">{tr('按所选来源整理当天可用内容，同时生成日总结和时间轴。')}</p>
    <CalendarDayReviewPromptEditor controller={prompts} view={view} locked={submitting || active || uncertain} />
    {prompts.block && <p className="day-review-status">{tr(prompts.block)}</p>}
    {!prompts.block && prompts.draft.saved && <p className="day-review-status">{tr('将使用已保存的自定义提示词，重新生成后生效')}</p>}
    {prompts.storageError && !prompts.open && <p role="alert" className="day-review-error">{prompts.storageError}</p>}
    {prompts.support?.snapshotReuse && result && <label className="day-review-reuse"><input type="checkbox" checked={!!reuse} disabled={submitting || active || uncertain}
      onChange={event => setReuse(event.target.checked ? result : undefined)} />{tr('沿用当前版本的资料重新生成（便于比较提示词效果）')}</label>}
    {loading && !state && <p role="status" className="day-review-status">{tr('正在读取当天回顾…')}</p>}
    {state?.resultError === 'source_revoked' && <p role="alert" className="day-review-error">{tr('旧结果的来源权限已变化，请重新选择可用资料生成回顾')}</p>}
    {state?.resultError === 'source_changed' && <p role="alert" className="day-review-error">{tr('原始资料已更正，旧回顾已失效，请重新生成')}</p>}
    {error && <p role="alert" className="day-review-error">{error}</p>}
    {state && !state.supported && <div className="day-review-empty"><strong>{tr('日历回顾服务尚未接通')}</strong>
      <p>{tr('接通后，可将当天的对话、位置、个人记录、通话和录音整理在一起。')}</p><p>{tr('目前仍可在“活动”中查看原始内容。')}</p></div>}
    {state?.job && <div className="day-review-progress" role="status" data-failed={state.job.status === 'failed'}>
      <strong>{tr(stages[state.job.status])}</strong>
      {active && <span>{tr('收集资料 → 整理内容 → 生成回顾')}</span>}
      {state.job.message && <span>{state.job.message}</span>}
      {state.job.resumable && <button type="button" className="arkme-day-source" disabled={submitting || loading || uncertain} onClick={() => void resume()}>{tr('继续生成')}</button>}
      {state.result && <span>{tr('下方保留上一次生成的结果')}</span>}
    </div>}
    {state?.freshness === 'changed' && !active && <p className="day-review-status">{tr('有新内容可更新')}</p>}
    {state?.versions.length ? <label className="day-review-version">{tr('查看版本')} <select value={selectedVersion} disabled={submitting} onChange={e => void selectVersion(e.target.value)}>
      <option value="">{tr('最新结果')}</option>{state.versions.map(version => <option key={version.id} value={version.id}>{stamp(version.generatedAtMillis)}</option>)}
    </select></label> : null}
    {versionLoading && <p role="status">{tr('正在读取历史版本…')}</p>}
    {result && <>
      <div className="day-review-result-meta">{tr('生成于')} {stamp(result.generatedAtMillis)} · {result.modelName}</div>
      {result.promptSnapshot ? <DayReviewPromptSnapshot snapshot={result.promptSnapshot} view={view} /> : <p className="day-review-hint">{tr('此版本未提供提示词快照')}</p>}
      {result.promptSnapshot && !prompts.block && (prompts.draft.saved || prompts.support?.defaults) && !sameReviewPrompts(prompts.draft.saved ?? prompts.support?.defaults, result.promptSnapshot) && <p className="day-review-status">{tr('提示词已修改，重新生成后生效')}</p>}
      <details className="day-review-coverage"><summary>{tr('资料覆盖')} · {result.sourceKinds.map(kind => tr(DAY_REVIEW_LABELS[kind])).join('、')}
        {result.coverage.some(x => x.status === 'partial' || x.status === 'unavailable') && <span> · {tr('部分资料未覆盖')}</span>}</summary>
        {result.coverage.map(item => <p key={item.kind}>{tr(DAY_REVIEW_LABELS[item.kind])} · {tr(coverageLabels[item.status])} · {item.count} {tr('条')}{item.note ? ` · ${item.note}` : ''}</p>)}
      </details>
      {sourceError && <p role="alert" className="day-review-error">{sourceError}</p>}
      {view === 'summary' ? <div className="day-review-points">{result.summary.map((point, i) => <article key={`${result.id}:${i}`}>
        <p>{point.text}</p>{citations(point.sourceRefs)}</article>)}{!result.summary.length && <p className="day-review-status">{tr('所选资料中没有可归纳的内容')}</p>}</div>
        : <div className="day-review-events">{result.timeline.map((event, i) => <article key={`${result.id}:${i}`}>
          <time>{time(event.startAtMillis)}{event.startAtMillis !== null && event.endAtMillis !== null && event.endAtMillis > event.startAtMillis && <>–{time(event.endAtMillis)}</>}</time>
          <div><h3>{event.title}</h3><p>{event.text}</p>{citations(event.sourceRefs)}</div>
        </article>)}{!result.timeline.length && <p className="day-review-status">{tr('所选资料中没有可确定时间的事件')}</p>}</div>}
    </>}
    {state?.supported && !result && !active && !state.job && !selectedVersion && <div className="day-review-empty"><strong>{tr('把这一天串起来')}</strong>
      <p>{tr('综合不同来源，回顾发生了什么、形成了哪些结论。')}</p><p>{tr('每条内容都可以打开原始出处。')}</p></div>}
    {source && <div onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); clearSource() } }}>
      {source.kind === 'record' && <ArkmeTimelineDetailDrawer item={source.item} canExtend={false} showOriginal={showOriginal} onToggleOriginal={() => setShowOriginal(v => !v)} onClose={() => clearSource()} />}
      {source.kind === 'recording' && <ExploreRecordingSource source={source} onClose={() => clearSource()} />}
      {source.kind === 'evidence' && <ArkmeDetailShell title={source.evidence.label} label={tr('原始来源')} onClose={() => clearSource()}><p>{time(source.evidence.startAtMillis)}</p><p style={{ whiteSpace: 'pre-wrap' }}>{source.evidence.text}</p></ArkmeDetailShell>}
      {source.kind === 'call' && <ArkmeDetailShell title={tr('通话来源')} label={tr('通话来源')} onClose={() => clearSource()}><ArkmeCallDetailContent compact
        detail={source.detail} detailState="ready" selectedItem={{ callRef: source.detail.callRef, peerDisplayName: source.detail.title, mediaType: source.detail.mediaType,
          durationSeconds: source.detail.durationSeconds, acceptedAtMillis: source.detail.acceptedAtMillis, summaryPreview: source.detail.summaryText ?? '' }} /></ArkmeDetailShell>}
    </div>}
  </div>
}
