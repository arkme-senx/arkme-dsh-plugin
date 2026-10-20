import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RecordingEntityDay, RecordingEntityOccurrence } from '../../recording-entity-contract.js'
import { ArkmeDetailShell } from '../ArkmeDetailShell.js'
import { ArkmeDirectoryWindow } from '../ArkmeDirectoryWindow.js'
import { arkmeIntlLocale, tr, useArkmeLocale } from '../locale.js'
import { RECORDING_ENTITY_STYLE } from './recording-entities-style.js'
import { entityOccurrenceSourceLabel, entityRelevanceLabel, relatedEntitiesFirst } from './recording-entity-relevance.js'
import { useRecordingEntityFeedback } from './use-recording-entity-feedback.js'
import { useRecordingEntityOccurrences } from './use-recording-entity-occurrences.js'

const TYPES = ['全部', '人物', '组织', '地点', '宠物', '事件', '项目', '作品', '品牌', '其他']
export function recordingEntityStatus(data: RecordingEntityDay): string {
  if (data.status === 'source_mismatch') return '录音内容已更新，请刷新实体列表'
  if ((data.transcriptHealth?.failedUnits ?? 0) > 0 || (data.transcriptHealth?.unavailableUnits ?? 0) > 0) return data.entities?.length ? '部分转写异常，已有实体可查看' : (data.transcriptHealth?.readyUnits ?? 0) > 0 ? '部分转写异常' : '转写异常，暂无法继续识别'
  if (data.status === 'failed') return '识别未完成，已有结果仅供参考'
  if (data.status === 'not_started') return '尚未识别实体'
  if (data.status === 'processing') {
    switch (data.stage) {
      case 'queued': return '等待实体识别'
      case 'preparing': return '正在准备识别'
      case 'waiting_transcript': return '等待转写完成'
      case 'waiting_more_transcript': return '等待剩余转写完成'
      case 'reviewing': return '正在核对实体'
      case 'publishing': return '正在保存结果'
      case 'recovering': return '正在恢复识别'
      case 'discovering': return '正在识别实体'
      default: return '正在处理实体'
    }
  }
  return '当天识别结果'
}

export function RecordingEntityPanel({ data, loading, error, paused, compact, open = true, reveal, starting = false, startError = false, onStart, onClose, onRefresh, onLocate }: {
  data: RecordingEntityDay | undefined; loading: boolean; error: boolean; paused: boolean; compact: boolean; open?: boolean
  reveal?: { key: string; sequence: number }
  starting?: boolean; startError?: boolean; onStart?(): void
  onClose(): void; onRefresh(): void; onLocate(value: RecordingEntityOccurrence, entityKey: string): boolean | Promise<boolean>
}) {
  useArkmeLocale()
  const [type, setType] = useState(0), [expanded, setExpanded] = useState('')
  const [visited, setVisited] = useState(open)
  const [participantFilter, setParticipantFilter] = useState<{ entity: string; key: string }>()
  const [feedbackKey, setFeedbackKey] = useState('')
  const feedback = useRecordingEntityFeedback(onRefresh)
  const [locateError, setLocateError] = useState(false)
  const [sourceKey, setSourceKey] = useState('')
  const body = useRef<HTMLDivElement>(null), sentinel = useRef<HTMLDivElement>(null)
  const scroll = useRef(0), expandedTitle = useRef<HTMLButtonElement>(null)
  const appliedReveal = useRef<typeof reveal>(), pendingReveal = useRef(false)
  const all = data?.entities ?? [], personalized = !!data?.personalization
  const typed = all.filter(item => !type || item.type === type)
  const entities = relatedEntitiesFirst(typed)
  const entity = all.find(item => item.key === expanded)
  const participantKey = participantFilter?.entity === expanded && entity?.participation?.participants.some(p => p.key === participantFilter.key) ? participantFilter.key : undefined
  const mentions = useRecordingEntityOccurrences(entity, data?.version, open, participantKey)
  const showStatus = data?.status !== 'succeeded' || error || paused || startError
    || (data.transcriptHealth?.failedUnits ?? 0) > 0 || (data.transcriptHealth?.unavailableUnits ?? 0) > 0
  useEffect(() => { if (open) setVisited(true) }, [open])
  useEffect(() => { setLocateError(false); setSourceKey('') }, [expanded, data?.version])
  useLayoutEffect(() => {
    if (open && body.current) body.current.scrollTop = scroll.current
  }, [open])
  useEffect(() => {
    if (!open || !reveal || appliedReveal.current === reveal) return
    const target = all.find(item => item.key === reveal.key)
    if (!target) return
    appliedReveal.current = reveal; pendingReveal.current = true
    if (type && type !== target.type) setType(0)
    setParticipantFilter(undefined)
    setExpanded(reveal.key)
  }, [open, reveal, all, type])
  useEffect(() => {
    if (!open || !pendingReveal.current || expanded !== reveal?.key || !expandedTitle.current) return
    expandedTitle.current.scrollIntoView?.({ block: 'start' })
    expandedTitle.current.focus({ preventScroll: true })
    pendingReveal.current = false
  }, [open, reveal, expanded, type])
  useEffect(() => {
    if (!open || mentions.loading || mentions.error || !mentions.detail?.hasMore || !sentinel.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) mentions.loadMore()
    }, { root: body.current, rootMargin: '120px 0px' })
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [open, mentions.loading, mentions.error, mentions.detail, mentions.loadMore])
  if (!open && !visited) return null
  return <>
    <style>{RECORDING_ENTITY_STYLE}</style>
    <ArkmeDetailShell open={open} className="arkme-entity-panel" style={{ position: 'fixed', top: 0, bottom: 0, right: 0, zIndex: 1001 }}
      bodyStyle={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}
      widthPreferenceKey="arkme:recording-entities-width:v1" resizeLabel={tr('调整实体列表宽度')}
      title={`${tr('实体')} · ${all.length}`} label={tr('当天录音实体')} closeLabel={tr('关闭实体列表')} onClose={onClose}
      onPointerDownOutside={event => {
        // Entity links and the toolbar button own their reveal/toggle action.
        if (event.target instanceof Element && event.target.closest('[data-recording-entity-trigger], [data-recording-entity-key]')) return
        onClose()
      }}>
      <p className="arkme-entity-hint">{tr('仅支持手动识别，并且会消耗AI额度的积分')}</p>
      {showStatus && <div className="arkme-entity-status">
        <div className="arkme-entity-status-row">
          <span role="status" aria-live="polite" aria-atomic="true">
            {data ? tr(recordingEntityStatus(data)) : loading ? tr('正在读取实体…') : tr('暂时无法显示实体列表')}
            {data?.status === 'processing' && ['discovering', 'reviewing'].includes(data.stage) && data.totalUnits > 0 && <span> · {data.completedUnits}/{data.totalUnits}</span>}
          </span>
          {(data?.status === 'not_started' || data?.status === 'failed') && data.canStart !== false && onStart && <button type="button" disabled={starting} onClick={onStart}>{tr(starting ? '正在提交…' : data.status === 'failed' ? '重试识别' : '开始识别')}</button>}
          <button type="button" disabled={starting} onClick={() => { if (mentions.error) mentions.loadMore(); onRefresh() }}>{tr('刷新实体')}</button>
        </div>
        {startError && <p role="alert">{tr('未能确认识别已开始，请刷新后重试')}</p>}
        {error && <p role="alert">{tr('实体更新失败，请刷新重试')}</p>}
        {paused && <p>{tr('自动更新已暂停，请手动刷新')}</p>}
      </div>}
      {data && !all.some(item => item.participation) && <p className="arkme-entity-hint">{tr('当前显示全部实体，提及者汇总待补充。')}</p>}
      {(feedback.busy || feedback.notice || feedback.error) && <div className="arkme-entity-feedback-status" aria-live="polite">
        {feedback.busy && <span>{tr('正在提交反馈…')}</span>}
        {feedback.notice && <span>{tr(feedback.notice)}</span>}
        {feedback.receipt && <button type="button" disabled={feedback.busy || feedback.retryPending || Date.now() >= feedback.receipt.undoExpiresAt} onClick={feedback.undo}>{tr('撤销反馈')}</button>}
        {feedback.error && <p role="alert">{tr(feedback.error)} {feedback.retryPending && <button type="button" disabled={feedback.busy} onClick={feedback.retry}>{tr('重试这次反馈')}</button>}</p>}
      </div>}
      <div className="arkme-entity-types" role="group" aria-label={tr('实体类型')}>
        {TYPES.map((label, index) => <button key={label} type="button" aria-pressed={type === index} onClick={() => {
          if (type === index) return
          setType(index)
          if (entity && index && entity.type !== index) setExpanded('')
          scroll.current = 0; if (body.current) body.current.scrollTop = 0
        }}>{tr(label)}</button>)}
      </div>
      <div ref={body} className="arkme-entity-items" onScroll={event => { if (open) scroll.current = event.currentTarget.scrollTop }}>
        {!loading && entities.length === 0 && <p role="status">{tr(type ? '当前类型下没有实体' : '暂无已识别实体')}</p>}
        <ArkmeDirectoryWindow active={open} scrollRootRef={body} activeKey={expanded}>
        {entities.map(item => <section key={item.key} className="arkme-entity-item">
          <button ref={expanded === item.key ? expandedTitle : undefined} type="button" className="arkme-entity-item-title" aria-expanded={expanded === item.key} onClick={() => { setExpanded(expanded === item.key ? '' : item.key); setParticipantFilter(undefined) }}>
            <span><strong>{item.name}</strong><small>{item.type === 9 && item.typeLabel ? item.typeLabel : tr(TYPES[item.type] ?? '其他')}{personalized && !item.participation && <> · {tr(entityRelevanceLabel(item))}</>}{item.accuracy === 'needs_confirmation' && <> · {tr('待核实')}</>}</small></span>
            <span>{tr('{count} 次提及', { count: item.occurrenceCount })} {expanded === item.key ? '⌄' : '›'}</span>
          </button>
          {item.participation && <div className="arkme-entity-participants" role="group" aria-label={tr('{name}的提及者', { name: item.name })}>
            {[...item.participation.participants].sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || b.occurrenceCount - a.occurrenceCount)
              .slice(0, expanded === item.key ? undefined : 2).map(person => <button key={person.key} type="button"
                aria-pressed={expanded === item.key && participantKey === person.key}
                onClick={() => { setExpanded(item.key); setParticipantFilter(participantKey === person.key ? undefined : { entity: item.key, key: person.key }) }}>
                {tr('{name} {count} 次', { name: person.isSelf ? tr('你') : person.label, count: person.occurrenceCount })}
                {person.playbackCount > 0 && <small> · {tr('含 {count} 次播放', { count: person.playbackCount })}</small>}
              </button>)}
            {expanded !== item.key && item.participation.participants.length > 2 && <button type="button" onClick={() => { setExpanded(item.key); setParticipantFilter(undefined) }}>{tr('另 {count} 位说话人', { count: item.participation.participants.length - 2 })}</button>}
            {item.participation.unattributedCount > 0 && <span>{tr('{count} 次说话人待确认', { count: item.participation.unattributedCount })}</span>}
            {expanded === item.key && participantKey && <button type="button" onClick={() => setParticipantFilter(undefined)}>{tr('查看所有人的提及')}</button>}
          </div>}
          {expanded === item.key && <div className="arkme-entity-occurrences">
            <ArkmeDirectoryWindow active={open} scrollRootRef={body}>
              {(mentions.detail?.items ?? []).map(occurrence => <div key={occurrence.key} className="arkme-entity-mention">
                <button className="arkme-entity-occurrence" type="button" disabled={!occurrence.target}
                  {...(occurrence.target?.sourceText !== undefined ? { 'aria-expanded': sourceKey === occurrence.key } : {})}
                  onClick={() => {
                    if (occurrence.target?.sourceText !== undefined) { setSourceKey(sourceKey === occurrence.key ? '' : occurrence.key); setLocateError(false); return }
                    const located = onLocate(occurrence, item.key); setLocateError(!located); if (located && compact) onClose()
                  }}>
                  <time>{occurrence.target?.sourceText !== undefined
                    ? new Date(occurrence.startAtMillis).toLocaleString(arkmeIntlLocale(), { hour12: false })
                    : new Date(occurrence.startAtMillis).toLocaleTimeString(arkmeIntlLocale(), { hour12: false })}</time>
                  {occurrence.context && <small>{occurrence.context.speakerLabel && <>{occurrence.context.speakerLabel} · </>}{tr(entityOccurrenceSourceLabel(occurrence.context))}{occurrence.context.accuracy === 'needs_confirmation' && <> · {tr('待核实')}</>}</small>}
                  <span>{occurrence.text}</span>{!occurrence.target && <small>{tr('原文位置已不可用')}</small>}
                </button>
                {sourceKey === occurrence.key && occurrence.target?.sourceText !== undefined && <div className="arkme-entity-source" role="region" aria-label={tr('提及原文')}>
                  <small>{tr('原文')} · {new Date(occurrence.startAtMillis).toLocaleString(arkmeIntlLocale(), { hour12: false })}</small>
                  <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {Array.from(occurrence.target.sourceText).slice(0, occurrence.target.start).join('')}
                    <mark data-recording-entity-highlight>{Array.from(occurrence.target.sourceText).slice(occurrence.target.start, occurrence.target.start + occurrence.target.length).join('')}</mark>
                    {Array.from(occurrence.target.sourceText).slice(occurrence.target.start + occurrence.target.length).join('')}
                  </p>
                </div>}
                <button type="button" className="arkme-entity-feedback-toggle" aria-expanded={feedbackKey === occurrence.key} onClick={() => setFeedbackKey(feedbackKey === occurrence.key ? '' : occurrence.key)}>{tr('反馈')}</button>
                {feedbackKey === occurrence.key && <div className="arkme-entity-feedback-actions" role="group" aria-label={tr('这次提及的反馈')}>
                  <p>{tr(occurrence.feedbackRef ? '仅影响这次提及，保存后可撤销。' : '暂不支持保存反馈。')}</p>
                  {([['relevant', '与我有关'], ['playback', '播放内容'], ['incorrect', '识别有误']] as const).map(([action, label]) => <button key={action} type="button" disabled={!occurrence.feedbackRef || feedback.busy || feedback.retryPending} onClick={() => { if (occurrence.feedbackRef) feedback.apply(occurrence.feedbackRef, action) }}>{tr(label)}</button>)}
                </div>}
              </div>)}
            </ArkmeDirectoryWindow>
            {mentions.error && <p role="alert">{tr('提及位置不可用，请刷新实体列表')}</p>}
            {!mentions.error && !mentions.detail && <p role="status">{tr('正在读取提及…')}</p>}
            {mentions.detail?.items.length === 0 && <p>{tr('暂无可用提及')}</p>}
            {(mentions.detail?.hasMore || mentions.error) && <div ref={sentinel} className="arkme-entity-more">
              <button type="button" disabled={mentions.loading} onClick={mentions.loadMore}>{tr(mentions.error ? '重试' : mentions.loading ? '正在读取提及…' : '加载更多提及')}</button>
            </div>}
            {locateError && <p role="alert">{tr('原文已更新，请刷新录音后重试')}</p>}
          </div>}
        </section>)}
        </ArkmeDirectoryWindow>
      </div>
    </ArkmeDetailShell>
  </>
}
