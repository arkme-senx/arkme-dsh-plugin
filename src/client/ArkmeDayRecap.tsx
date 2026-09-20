import { tr, useArkmeLocale, arkmeIntlLocale } from './locale.js'
import { useEffect, useRef, useState } from 'react'
import type { DayRecapResult } from '../day-recap.js'
import { parseDayRecapPoints } from '../day-recap.js'
import type { DayActivityEntry, DayActivityPage, DayActivityQuery } from './calendar-activity-model.js'
import { buildDayRecapInput, type DayRecapGenerator } from './day-recap-input.js'
import type { ArkmeRecordingSection, ArkmeRecordingVersion } from '../types.js'

export function ArkmeDayRecap({ query, entries, generate, onSource }: {
  query: DayActivityQuery; entries: DayActivityEntry[]; generate: DayRecapGenerator; onSource(id: string): void
}) {
  useArkmeLocale()
  const candidate = buildDayRecapInput(query, entries)
  const current = useRef(candidate.key); current.current = candidate.key
  const request = useRef<AbortController>()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cached, setCached] = useState<{ key: string; result: DayRecapResult }>()
  const [expanded, setExpanded] = useState(true)
  // No disk/browser storage: account/date unmount drops both source excerpts and the cached result.
  useEffect(() => {
    request.current?.abort(); request.current = undefined; setBusy(false); setError(''); setConfirming(false)
    return () => { request.current?.abort(); request.current = undefined }
  }, [candidate.key, generate])
  const result = cached?.key === candidate.key ? cached.result : undefined
  const start = async () => {
    if (request.current || !candidate.input.items.length || result) return
    const controller = new AbortController(); request.current = controller
    setBusy(true); setError(''); setConfirming(false)
    try {
      const value = await generate(candidate.input, controller.signal)
      if (controller.signal.aborted || current.current !== candidate.key) return
      if (!Number.isFinite(value.generatedAtMillis) || typeof value.modelName !== 'string') throw new Error('AI 小结返回格式无效，请手动重试')
      const points = parseDayRecapPoints(JSON.stringify(value), candidate.input)
      setCached({ key: candidate.key, result: { ...value, points } }); setExpanded(true)
    } catch (error) {
      if (!controller.signal.aborted && current.current === candidate.key) setError(error instanceof Error ? error.message : '小结生成失败，请手动重试')
    } finally { if (request.current === controller) { request.current = undefined; setBusy(false) } }
  }
  return <section className="arkme-day-recap" aria-label={tr("AI 小结")}>
    <div className="arkme-day-recap-heading"><span>{tr("AI 小结")} <small>{tr("仅基于已加载内容")}</small></span>
      {busy ? <button type="button" onClick={() => { request.current?.abort(); request.current = undefined; setBusy(false); setError('已取消；若请求已提交，可能已消耗部分额度。') }}>{tr("取消生成")}</button>
        : result ? <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起小结' : '展开小结'}</button>
          : <button type="button" disabled={!candidate.input.items.length} onClick={() => setConfirming(value => !value)}>{cached ? '更新 AI 小结' : '生成 AI 小结'}</button>}
    </div>
    {!result && cached && <p className="arkme-day-recap-note">{tr("内容或范围已变化，可手动更新小结。")}</p>}
    {confirming && <div className="arkme-day-recap-consent">
      <p>{tr("将向账号的云端 AI 发送当前筛选下")} {candidate.input.items.length} {tr("段活动预览摘录（最多 24 段 / 6000 字符），可能消耗额度。不额外读取历史，不发送位置字段、原始音视频，不创建 Arko 对话。")}</p>
      <details><summary>{tr("查看本次发送的摘录")}</summary><ul>{candidate.input.items.map(item => <li key={item.id}><strong>{item.time} · {item.title}</strong><p>{item.excerpt || '无文字预览'}</p></li>)}</ul></details>
      <button type="button" onClick={() => { void start() }}>{tr("确认生成")}</button><button type="button" onClick={() => setConfirming(false)}>{tr("暂不生成")}</button>
    </div>}
    {busy && <p role="status" className="arkme-day-recap-note">{tr("正在整理摘录，不会执行其他任务…")}</p>}
    {error && <p role="alert" className="arkme-day-recap-note">{error}</p>}
    {result && expanded && <><ul className="arkme-day-recap-points">{result.points.map((point, index) => <li key={index}>
      <span>{point.text}</span><div>{point.sourceIds.map((id, sourceIndex) => {
        const source = candidate.sources.get(id)!
        return <button type="button" key={id} title={source.title} aria-label={tr("查看小结来源：{v0}", { v0: source.title })}
          onClick={() => onSource(source.activityId)}>{tr("来源")}{sourceIndex + 1}</button>
    })}</div></li>)}</ul><p className="arkme-day-recap-note">{tr("基于")} {candidate.input.items.length} {tr("段活动摘录，非完整全天回顾。AI 生成，可能有误，请核对来源。")}{result.modelName} · {new Intl.DateTimeFormat(arkmeIntlLocale(), { timeZone: query.timezone, hour: '2-digit', minute: '2-digit' }).format(result.generatedAtMillis)}</p></>}
  </section>
}

export function latestDayRecordingReview(section: ArkmeRecordingSection<ArkmeRecordingVersion> | undefined) {
  return (section?.items ?? []).filter(item => item.status === 'done' && item.selectable && (item.content.trim() || item.timelineEvents.length))
    .sort((a, b) => b.generatedAtMillis - a.generatedAtMillis)[0]
}

export function DayRecordingReview({ page }: { page: DayActivityPage }) {
  const review = page.recordingReview
  if (!review) return null
  const summary = latestDayRecordingReview(review.summary), timeline = latestDayRecordingReview(review.timeline)
  const failed = [review.summary, review.timeline].some(section => section?.state === 'error' || section?.state === 'failed')
  if (!summary && !timeline && !failed) return null
  return <details className="arkme-day-recording-review">
    <summary>{tr("已有录音回顾")} <small>{failed ? '部分回顾暂不可用' : '无需重新生成'}</small></summary>
    <p className="arkme-day-recap-note">{page.query.bucketDate} {tr("的录音来源回顾，不代表全天全部活动，也不对应某一小段录音。")}</p>
    {failed && <p role="status">{tr("部分录音回顾读取失败，可刷新当天活动重试。")}</p>}
    {([['录音摘要', summary], ['录音时间线', timeline]] as const).map(([label, version]) => version && <section key={label}>
      <h3>{label}</h3><p className="arkme-day-recap-note">{version.modelDisplayName} · {version.generatedAtMillis > 0 ? new Intl.DateTimeFormat(arkmeIntlLocale(), {
        timeZone: page.query.timezone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      }).format(version.generatedAtMillis) : '生成时间未提供'}</p>
      {label === '录音时间线' && version.timelineEvents.length ? <ul>{version.timelineEvents.slice(0, 30).map((event, index) => <li key={`${event.eventId}:${index}`}>
        <strong>{event.timeRange || `${event.startAt}–${event.endAt}`} · {event.title}</strong><p>{event.description}</p></li>)}</ul>
        : <p className="arkme-day-recording-review-text">{version.content.slice(0, 10000)}</p>}
      {(version.content.length > 10000 || version.timelineEvents.length > 30) && <p className="arkme-day-recap-note">{tr("此处展示部分回顾，完整内容可在录音板块查看。")}</p>}
    </section>)}
  </details>
}
