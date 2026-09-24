import { ArkmeArrangementRecognition } from './ArkmeArrangementRecognition.js'
import { useEffect, useState } from 'react'
import type { ArkmeArrangementItem, ArkmeArrangementPage } from '../types.js'
import { callArkme } from './api.js'
import { tr } from './locale.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { ArkmeArrangementContent } from './ArkmeArrangementContent.js'
import { ArkmeArrangementReminder } from './ArkmeArrangementReminder.js'
import { arrangementColumnLabels } from './arrangement-board-model.js'

type Props = { active?: boolean; recentItems?: ArkmeArrangementItem[]; accountScope: string; bucketDate: string; timezone: string }
export function ArkmeDayArrangements(props: Props) {
  return <DayArrangements key={`${props.accountScope}:${props.bucketDate}:${props.timezone}`} {...props} />
}
function DayArrangements({ active = true, accountScope, bucketDate, timezone, recentItems = [] }: Props) {
  const [rows, setRows] = useState<ArkmeArrangementItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [expanded, setExpanded] = useState(new Set<string>())
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!accountScope) { setLoading(false); return }
    if (!active) return
    const controller = new AbortController()
    setLoading(true); setError(false)
    async function read(status: 'identified' | 'following' | 'completed') {
      const items = new Map<string, ArkmeArrangementItem>()
      let offset = 0, version: string | undefined
      while (true) {
        const page = await withArkmeReadDeadline(signal => callArkme<ArkmeArrangementPage>('arrangements.list', {
          status, limit: 50, offset, order: 'board', ...(version ? { boardVersion: version } : {}),
        }, signal), controller.signal)
        controller.signal.throwIfAborted()
        if (version && page.board?.version !== version) throw new Error('Arrangement order changed')
        version = page.board?.version
        for (const item of page.items) if (item.status === status) items.set(item.arrangementRef, item)
        if (!page.hasMore) return [...items.values()]
        if (page.nextOffset === undefined || page.nextOffset <= offset) throw new Error('Invalid arrangement page')
        offset = page.nextOffset
      }
    }
    void Promise.all([read('identified'), read('following'), read('completed')]).then(pages => {
      if (!controller.signal.aborted) setRows(pages.flat())
    }).catch(() => { if (!controller.signal.aborted) setError(true) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [accountScope, bucketDate, timezone, attempt, active])
  const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
  const dateKey = (time: number) => {
    const parts = dateFormat.formatToParts(time)
    return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-')
  }
  const onDay = (time?: number) => typeof time === 'number' && Number.isFinite(time) && time > 0 && dateKey(time) === bucketDate
  const isToday = dateKey(now) === bucketDate
  // Live rows win ties: a session creation snapshot must not undo a later status change.
  const merged = new Map(rows.map(item => [item.arrangementRef, item]))
  for (const item of recentItems) {
    const live = merged.get(item.arrangementRef)
    if (!live || item.updatedAtMillis > live.updatedAtMillis) merged.set(item.arrangementRef, item)
  }
  const allRows = [...merged.values()]
  const directlyCreated = (item: ArkmeArrangementItem) => item.creationSource?.kind === 'input' || !!item.recognitionState || recentItems.some(recent => recent.arrangementRef === item.arrangementRef)
  const createdOnDay = allRows.filter(row => onDay(row.createdAtMillis)).sort((a,b) => b.createdAtMillis-a.createdAtMillis)
  const groups = [
    { key: 'due', title: isToday ? tr('今天到期') : tr('当天到期'), items: allRows.filter(row => onDay(row.dueAtMillis)).sort((a,b) => a.dueAtMillis!-b.dueAtMillis!) },
    { key: 'recent', title: isToday ? tr('今天创建') : tr('当天创建'), items: createdOnDay.filter(directlyCreated) },
    { key: 'identified', title: isToday ? tr('今天已识别') : tr('当天已识别'), items: createdOnDay.filter(row => !directlyCreated(row)) },
  ]
  return <div className="arkme-day-arrangements">
    {!accountScope ? <p role="status">{tr('请先登录')}</p> : <>
      {loading && <p role="status">{tr('正在加载当天安排…')}</p>}
      {error && <div role="alert">{tr('当天安排加载失败')}<button type="button" onClick={() => setAttempt(value => value + 1)}>{tr('重试')}</button></div>}
      {groups.map(group => <section key={group.key} data-day-arrangements={group.key}>
        <h3>{group.title}<span className="arkme-arrangement-count">{loading || error ? '—' : group.items.length}</span></h3>
        {!loading && !error && !group.items.length && <p className="arkme-day-status">{tr('暂无安排')}</p>}
        {group.items.map(item => <article key={item.arrangementRef} className="arkme-arrangement-card" data-arrangement-ref={item.arrangementRef}>
          <button type="button" className="arkme-day-arrangement-summary" data-arkme-hover="none" aria-expanded={expanded.has(item.arrangementRef)} onClick={() => {
            if (typeof window !== 'undefined' && window.getSelection()?.toString()) return
            setExpanded(previous => { const next = new Set(previous); if (next.has(item.arrangementRef)) next.delete(item.arrangementRef); else next.add(item.arrangementRef); return next })
          }}>
            <span className="arkme-day-arrangement-heading">
              <span className="arkme-arrangement-title-row">{item.recognitionState === 'recognizing' && <ArkmeArrangementRecognition />}<strong>{item.title}</strong></span>
              <span className="arkme-day-arrangement-status" data-arrangement-status={item.status}>{tr(arrangementColumnLabels[item.status as 'identified' | 'following' | 'completed'] ?? '安排')}</span>
            </span>
            
            {['failed','no_result','cancelled'].includes(item.recognitionState ?? '') && <small>{tr('安排已保存，未完成AI识别')}</small>}
            {item.status !== 'completed' && <ArkmeArrangementReminder atMillis={item.remindAtMillis} now={now} />}
          </button>
          <ArkmeArrangementContent item={item} expanded={expanded.has(item.arrangementRef)} />
        </article>)}
      </section>)}
    </>}
  </div>
}
