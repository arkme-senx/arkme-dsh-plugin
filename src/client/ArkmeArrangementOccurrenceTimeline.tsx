import { FileText } from '@phosphor-icons/react/dist/icons/FileText'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { useEffect, useState, type ReactNode } from 'react'
import type { ArkmeArrangementItem } from '../types.js'
import type {
  ArrangementOccurrenceEvent,
  ArrangementOccurrenceResponse,
} from '../arrangement-occurrence.js'
import { ArkmeArrangementSources } from './ArkmeArrangementSources.js'
import { callArkme } from './api.js'
import { tr } from './locale.js'
import css from './arrangement-occurrence.css?inline'
const sourceLabels: Record<string, string> = {
  note: '个人快记',
  private: '私聊',
  group: '群聊',
  audio: '录音',
  call: '通话',
  manual: '手动创建',
  other: '其他来源',
}
export { occurrenceTime, inspectArrangementTrace } from './arrangement-occurrence-ui.js'
import { occurrenceTime, inspectArrangementTrace } from './arrangement-occurrence-ui.js'
export function ArkmeArrangementOccurrenceTimeline({
  accountScope,
  item,
  fallback,
}: {
  accountScope: string
  item: ArkmeArrangementItem
  fallback: ReactNode
}) {
  const [expanded, setExpanded] = useState(new Set<string>()),
    [events, setEvents] = useState<ArrangementOccurrenceEvent[]>(),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    setEvents(undefined)
    void (async () => {
      try {
        const r = await callArkme<ArrangementOccurrenceResponse>(
          'arrangements.occurrences.events',
          { expectedAccountScope: accountScope, arrangementRef: item.arrangementRef },
          controller.signal,
        )
        if (!controller.signal.aborted && r.accountScope === accountScope && r.state === 'ready') {
          setEvents(r.events ?? [])
          setExpanded(new Set(r.events?.[0] ? [r.events[0].id] : []))
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : tr('无法读取识别记录'))
      }
    })()

    return () => controller.abort()
  }, [accountScope, item.arrangementRef, item.updatedAtMillis, attempt])
  const sources = item.provenance ?? [],
    covered = new Set(events?.flatMap((event) => event.evidence_ids)),
    legacy = sources.filter((e) => !covered.has(e.id))
  if (!events)
    return (
      <>
        <style>{css}</style>
        {fallback}
        {error && (
          <p className="arkme-occurrence-muted">
            {error}{' '}
            <button type="button" onClick={() => setAttempt((n) => n + 1)}>
              {tr('重试识别记录')}
            </button>
          </p>
        )}
      </>
    )
  return (
    <section className="arkme-occurrence-timeline" aria-label={tr('识别记录')}>
      <style>{css}</style>
      <h3><FileText className="arkme-arrangement-section-icon" size={18} aria-hidden />{tr('识别记录')}</h3>
      {!events.length && (
        <p className="arkme-occurrence-muted">
          {tr('历史安排尚未记录实际识别时间，以下原文时间不代表识别时间。')}
        </p>
      )}
      {events.map((event) => (
        <article key={event.id}>
          <header>
            <strong>{tr(sourceLabels[event.source] ?? event.source)}</strong>
            <span data-disposition={event.disposition}>
              {tr(
                event.disposition === 'new'
                  ? '首次识别'
                  : event.disposition === 'historical-merge'
                    ? '历史归并'
                    : '已归并到此安排',
              )}
            </span>
          </header>
          <p>
            {tr('识别时间')}：{occurrenceTime(event.recognized_at)}
          </p>
          {event.disposition === 'historical-merge' && (
            <p>
              {tr('归并时间')}：{occurrenceTime(event.attached_at)}
            </p>
          )}
          {event.reason && <p className="arkme-occurrence-muted">{event.reason}</p>}
          <details
            open={expanded.has(event.id)}
            onToggle={(e) => {
              const open = e.currentTarget.open
              setExpanded((old) => {
                if (old.has(event.id) === open) return old
                const next = new Set(old)
                if (open) next.add(event.id)
                else next.delete(event.id)
                return next
              })
            }}
          >
            <summary>
              <CaretRight className="arkme-arrangement-disclosure-icon" size={16} aria-hidden />{tr('识别来源')} ({event.evidence_ids.length})
            </summary>
            {expanded.has(event.id) &&
              event.evidence_ids
                .map((id) => sources.find((e) => e.id === id))
                .filter((e) => !!e)
                .map((e) => (
                  <div key={e.id}>
                    <p className="arkme-occurrence-muted">
                      {tr('原文时间')}：{occurrenceTime(e.createdAtMillis)}
                    </p>
                    <ArkmeArrangementSources
                      arrangementRef={item.arrangementRef}
                      sources={[e]}
                      expanded
                      hideHeadings
                    />
                  </div>
                ))}
          </details>
          {event.trace_id && (
            <button
              type="button"
              onClick={() =>
                inspectArrangementTrace(accountScope, item.arrangementRef, event.trace_id!)
              }
            >
              {tr('查看此次识别过程')}
            </button>
          )}
        </article>
      ))}
      {!!legacy.length && (
        <div className="arkme-occurrence-legacy">
          <h4>{tr('其他来源')}</h4>
          <p className="arkme-occurrence-muted">
            {tr('这些来源的识别记录未载入，或历史未记录识别时间')}
          </p>
          <ArkmeArrangementSources arrangementRef={item.arrangementRef} sources={legacy} expanded />
        </div>
      )}
      {!events.length && !sources.length && fallback}
    </section>
  )
}
