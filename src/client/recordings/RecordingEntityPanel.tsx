import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RecordingEntityDay, RecordingEntityOccurrence } from '../../recording-entity-contract.js'
import { ArkmeDetailShell } from '../ArkmeDetailShell.js'
import { ArkmeDirectoryWindow } from '../ArkmeDirectoryWindow.js'
import { arkmeIntlLocale, tr, useArkmeLocale } from '../locale.js'
import { RECORDING_ENTITY_STYLE } from './recording-entities-style.js'
import { entityOccurrenceSourceLabel, entityRelevanceLabel, isRelatedEntity, relatedEntitiesFirst } from './recording-entity-relevance.js'
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
  onClose(): void; onRefresh(): void; onLocate(value: RecordingEntityOccurrence, entityKey: string): boolean
}) {
  useArkmeLocale()
  const [type, setType] = useState(0), [expanded, setExpanded] = useState('')
  const [visited, setVisited] = useState(open)
  const [relatedOnly, setRelatedOnly] = useState(true), [showOther, setShowOther] = useState(false)
  const [feedbackKey, setFeedbackKey] = useState('')
  const feedback = useRecordingEntityFeedback(onRefresh)
  const [locateError, setLocateError] = useState(false)
  const body = useRef<HTMLDivElement>(null), sentinel = useRef<HTMLDivElement>(null)
  const scroll = useRef(0), expandedTitle = useRef<HTMLButtonElement>(null)
  const appliedReveal = useRef<typeof reveal>(), pendingReveal = useRef(false)
  const all = data?.entities ?? [], personalized = !!data?.personalization
  const typed = all.filter(item => !type || item.type === type)
  const related = personalized && relatedOnly
  const otherCount = typed.filter(item => !isRelatedEntity(item)).length
  const entities = personalized ? relatedEntitiesFirst(typed).filter(item => !related || showOther || isRelatedEntity(item)) : typed
  const entity = all.find(item => item.key === expanded)
  const mentions = useRecordingEntityOccurrences(entity, data?.version, open)
  const showStatus = data?.status !== 'succeeded' || error || paused || startError
    || (data.transcriptHealth?.failedUnits ?? 0) > 0 || (data.transcriptHealth?.unavailableUnits ?? 0) > 0
  useEffect(() => { if (open) setVisited(true) }, [open])
  useEffect(() => { setLocateError(false) }, [expanded, data?.version])
  useLayoutEffect(() => {
    if (open && body.current) body.current.scrollTop = scroll.current
  }, [open])
  useEffect(() => {
    if (!open || !reveal || appliedReveal.current === reveal) return
    const target = all.find(item => item.key === reveal.key)
    if (!target) return
    appliedReveal.current = reveal; pendingReveal.current = true
    if (type && type !== target.type) setType(0)
    if (!isRelatedEntity(target)) setShowOther(true)
    setExpanded(reveal.key)
  }, [open, reveal, all, type])
  useEffect(() => {
    if (!open || !pendingReveal.current || expanded !== reveal?.key || !expandedTitle.current) return
    expandedTitle.current.scrollIntoView?.({ block: 'start' })
    expandedTitle.current.focus({ preventScroll: true })
    pendingReveal.current = false
  }, [open, reveal, expanded, type, showOther])
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
      {showStatus && <div className="arkme-entity-status">
        <div className="arkme-entity-status-row">
          <span role="status" aria-live="polite" aria-atomic="true">
            {data ? tr(recordingEntityStatus(data)) : loading ? tr('正在读取实体…') : tr('暂时无法显示实体列表')}
            {data?.status === 'processing' && ['discovering', 'reviewing'].includes(data.stage) && data.totalUnits > 0 && <span> · {data.completedUnits}/{data.totalUnits}</span>}
          </span>
          {data?.status === 'not_started' && data.canStart !== false && onStart && <button type="button" disabled={starting} onClick={onStart}>{tr(starting ? '正在提交…' : '开始识别')}</button>}
          <button type="button" disabled={starting} onClick={() => { if (mentions.error) mentions.loadMore(); onRefresh() }}>{tr('刷新实体')}</button>
        </div>
        {startError && <p role="alert">{tr('未能确认识别已开始，请刷新后重试')}</p>}
        {error && <p role="alert">{tr('实体更新失败，请刷新重试')}</p>}
        {paused && <p>{tr('自动更新已暂停，请手动刷新')}</p>}
      </div>}
      <div className="arkme-entity-relevance" role="group" aria-label={tr('实体相关性')}>
        <button type="button" aria-pressed={related} disabled={!personalized} onClick={() => setRelatedOnly(true)}>{tr('与你相关')}</button>
        <button type="button" aria-pressed={!related} onClick={() => setRelatedOnly(false)}>{tr('全部')}</button>
      </div>
      {data && !personalized && <p className="arkme-entity-hint">{tr('暂未提供相关性信息，当前显示全部实体。')}</p>}
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
        {!loading && entities.length === 0 && <p role="status">{tr(related && typed.length ? '暂未发现与你相关的实体，可展开其他内容。' : type ? '当前类型下没有实体' : '暂无已识别实体')}</p>}
        <ArkmeDirectoryWindow active={open} scrollRootRef={body} activeKey={expanded}>
        {entities.map(item => <section key={item.key} className="arkme-entity-item">
          <button ref={expanded === item.key ? expandedTitle : undefined} type="button" className="arkme-entity-item-title" aria-expanded={expanded === item.key} onClick={() => setExpanded(expanded === item.key ? '' : item.key)}>
            <span><strong>{item.name}</strong><small>{item.type === 9 && item.typeLabel ? item.typeLabel : tr(TYPES[item.type] ?? '其他')}{personalized && <> · {tr(entityRelevanceLabel(item))}</>}{item.accuracy === 'needs_confirmation' && <> · {tr('待核实')}</>}</small></span>
            <span>{tr('{count} 次提及', { count: item.occurrenceCount })} {expanded === item.key ? '⌄' : '›'}</span>
          </button>
          {expanded === item.key && <div className="arkme-entity-occurrences">
            <ArkmeDirectoryWindow active={open} scrollRootRef={body}>
              {(mentions.detail?.items ?? []).map(occurrence => <div key={occurrence.key} className="arkme-entity-mention">
                <button className="arkme-entity-occurrence" type="button" disabled={!occurrence.target} onClick={() => { const located = onLocate(occurrence, item.key); setLocateError(!located); if (located && compact) onClose() }}>
                  <time>{new Date(occurrence.startAtMillis).toLocaleTimeString(arkmeIntlLocale(), { hour12: false })}</time>
                  {occurrence.context && <small>{tr(entityOccurrenceSourceLabel(occurrence.context))}{occurrence.context.speakerLabel && <> · {occurrence.context.speakerLabel}</>}{occurrence.context.accuracy === 'needs_confirmation' && <> · {tr('待核实')}</>}</small>}
                  <span>{occurrence.text}</span>{!occurrence.target && <small>{tr('原文位置已不可用')}</small>}
                </button>
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
        {related && otherCount > 0 && <button type="button" className="arkme-entity-other" aria-expanded={showOther} onClick={() => setShowOther(!showOther)}>{tr(showOther ? '收起其他内容 · {count}' : '其他内容 · {count}', { count: otherCount })}</button>}
      </div>
    </ArkmeDetailShell>
  </>
}
