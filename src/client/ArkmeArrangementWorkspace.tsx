import { ArkmeArrangementDetailPane } from './ArkmeArrangementDetailPane.js'
import { useOccurrenceReviewCount } from './use-arrangement-occurrences.js'
import { ArkmeArrangementReviewInbox } from "./ArkmeArrangementOccurrenceActions.js"
import { ArkmeArrangementRecognitionSettings } from "./ArkmeArrangementRecognitionInspector.js"
import { useEffect, useRef, useState } from 'react'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { SpeakerHigh } from '@phosphor-icons/react/dist/icons/SpeakerHigh'
import { SpeakerSlash } from '@phosphor-icons/react/dist/icons/SpeakerSlash'
import { ArrowsClockwise } from '@phosphor-icons/react/dist/icons/ArrowsClockwise'
import type { ArkmeArrangementItem, ArkmeArrangementMutationResult, ArkmeArrangementReminderToggleResult } from '../types.js'
import { callArkme } from './api.js'
import { arkmeIntlLocale, tr, useArkmeLocale } from './locale.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { ArkmeArrangementRecognition } from './ArkmeArrangementRecognition.js'
import { useArrangementWorkspace } from './use-arrangement-workspace.js'
import { useArrangementCompletion } from './use-arrangement-completion.js'
import { ArkmeArrangementCompletionControl, arrangementCompletionChecked } from './ArkmeArrangementCompletionControl.js'
import { arrangementViews, arrangementViewLabels, nextArrangementMidnight, type ArrangementView, type ArrangementWorkspaceItem } from './arrangement-workspace-model.js'

function validTime(value?: number): value is number { return !!value && Number.isFinite(new Date(value).getTime()) }
function fullTime(value?: number) { return validTime(value) ? new Intl.DateTimeFormat(arkmeIntlLocale(), { dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(value) : tr('未设置') }
function rowTime(value: number | undefined, now: number) {
  if (!validTime(value)) return tr('未定时间')
  return new Intl.DateTimeFormat(arkmeIntlLocale(), new Date(value).toDateString() === new Date(now).toDateString()
    ? { hour: '2-digit', minute: '2-digit', hour12: false }
    : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(value)
}

export function ArkmeArrangementWorkspace(props: { initialArrangementRef?: string | undefined; accountScope: string; onAddArrangement(): void; createdItems?: ArkmeArrangementItem[] }) {
  return <ArrangementWorkspace key={props.accountScope} {...props} />
}
function ArrangementWorkspace({ initialArrangementRef, accountScope, onAddArrangement, createdItems }: { initialArrangementRef?: string | undefined; accountScope: string; onAddArrangement(): void; createdItems?: ArkmeArrangementItem[] }) {
  useArkmeLocale()
  const [recognitionSettings, setRecognitionSettings] = useState(false)
  const [reviewInbox,setReviewInbox]=useState(false)
  const reviewCount = useOccurrenceReviewCount(accountScope)
  const [view, setView] = useState<ArrangementView>('today')
  const [now, setNow] = useState(Date.now)
  const data = useArrangementWorkspace(accountScope, view, now)
  const [selected, setSelected] = useState<ArrangementWorkspaceItem>()
  const [targetError, setTargetError] = useState(false)
  const [targetAttempt, setTargetAttempt] = useState(0)
  useEffect(() => {
    if (!initialArrangementRef) return
    const controller = new AbortController()
    setTargetError(false)
    void withArkmeReadDeadline(signal => callArkme<ArkmeArrangementItem>('arrangements.detail', { arrangementRef: initialArrangementRef }, signal), controller.signal)
      .then(item => { if (!controller.signal.aborted) { if (item.arrangementRef !== initialArrangementRef) throw new Error('安排引用已变化'); setSelected(item) } })
      .catch(() => { if (!controller.signal.aborted) setTargetError(true) })
    return () => controller.abort()
  }, [initialArrangementRef, targetAttempt])
  type Pending = 'completing' | 'restoring' | 'deleting' | 'reminder'
  const [pending, setPending] = useState(new Map<string, Pending>())
  const writes = useRef(new Set<string>())
  const [notice, setNotice] = useState<{ text: string; undo?: ArkmeArrangementItem; error?: boolean }>()
  const completion = useArrangementCompletion(accountScope)
  const { sound, setSound } = completion
  const [deleting, setDeleting] = useState<ArkmeArrangementItem>()
  const lifetime = useRef<AbortController>()
  const latestData = useRef(data); latestData.current = data
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => { controller.abort() } }, [])
  useEffect(() => {
    const refreshClock = () => setNow(Date.now())
    const timer = setTimeout(refreshClock, nextArrangementMidnight(now))
    window.addEventListener('focus', refreshClock)
    return () => { clearTimeout(timer); window.removeEventListener('focus', refreshClock) }
  }, [now])
  useEffect(()=>{const refresh=()=>{void latestData.current.refresh()};window.addEventListener('arkme-arrangement-occurrences-changed',refresh);return()=>window.removeEventListener('arkme-arrangement-occurrences-changed',refresh)},[])

  const previousCreated = useRef(createdItems)
  useEffect(() => {
    if (previousCreated.current === createdItems) return
    previousCreated.current = createdItems
    if (createdItems?.length && !writes.current.size) void latestData.current.refresh()
  }, [createdItems])
  function markPending(ref: string, value?: Pending) {
    setPending(previous => { const next = new Map(previous); if (value) next.set(ref, value); else next.delete(ref); return next })
  }
  function apply(item: ArrangementWorkspaceItem) {
    latestData.current.updateItem(item)
    setSelected(previous => previous?.arrangementRef === item.arrangementRef ? item : previous)
  }
  async function toggleComplete(item: ArkmeArrangementItem) {
    const signal = lifetime.current?.signal
    if (!signal || writes.current.has(item.arrangementRef) || item.status === 'unknown') return
    const completing = item.status !== 'completed'
    writes.current.add(item.arrangementRef); markPending(item.arrangementRef, completing ? 'completing' : 'restoring'); setNotice(undefined)
    try {
      const { result } = await completion.transition(item, completing ? 'completed' : 'following', signal)
      if (signal.aborted) return
      latestData.current.updateItem(result)
      setSelected(undefined)
      writes.current.delete(item.arrangementRef); markPending(item.arrangementRef)
      setNotice({ text: tr(completing ? '已完成' : '已恢复为未完成'), ...(completing ? { undo: result } : {}) })
    } catch {
      if (!signal.aborted) {
        writes.current.delete(item.arrangementRef); markPending(item.arrangementRef)
        setNotice({ text: tr('未能确认安排状态，请刷新后重试'), error: true })
      }
    }
  }
  async function deleteArrangement(item: ArkmeArrangementItem) {
    if (writes.current.has(item.arrangementRef)) return
    const signal = lifetime.current!.signal
    writes.current.add(item.arrangementRef); markPending(item.arrangementRef, 'deleting')
    try {
      const result = await callArkme<ArkmeArrangementMutationResult>('arrangements.mutate', { arrangementRef: item.arrangementRef, intent: 'delete' }, signal)
      if (signal.aborted) return
      if (result.deleted !== true) throw new Error('Deletion not confirmed')
      apply({ ...item, status: 'deleted' }); setSelected(undefined); setDeleting(undefined)
      setNotice({ text: tr('已移入已删除') })
    } catch { if (!signal.aborted) setNotice({ text: tr('删除未确认，请刷新后重试'), error: true }) }
    finally { if (!signal.aborted) { writes.current.delete(item.arrangementRef); markPending(item.arrangementRef) } }
  }
  async function toggleReminder(item: ArkmeArrangementItem) {
    if (writes.current.has(item.arrangementRef)) return
    const signal = lifetime.current!.signal
    writes.current.add(item.arrangementRef); markPending(item.arrangementRef, 'reminder')
    try {
      const enabled = !item.reminderEnabled
      const result = await callArkme<ArkmeArrangementReminderToggleResult>('arrangements.reminder-enabled', { arrangementRef: item.arrangementRef, enabled }, signal)
      if (signal.aborted) return
      if (!result.item || result.item.arrangementRef !== item.arrangementRef || result.item.reminderEnabled !== enabled) throw new Error('Reminder not confirmed')
      apply(result.item)
    } catch { if (!signal.aborted) setNotice({ text: tr('提醒状态未能确认，请重试'), error: true }) }
    finally { if (!signal.aborted) { writes.current.delete(item.arrangementRef); markPending(item.arrangementRef) } }
  }
  const busy = selected ? pending.has(selected.arrangementRef) : false
  return <div className="arkme-arrangement-workspace" data-detail-open={!!selected}>
    <nav className="arkme-arrangement-navigation" aria-label={tr('安排分类')}>
      <h2>{tr('安排')}</h2>
      <div className="arkme-arrangement-view-links">{arrangementViews.map(key => <button key={key} type="button" aria-current={view === key ? 'page' : undefined}
        onClick={() => { setView(key); setSelected(undefined); setDeleting(undefined) }}>{tr(arrangementViewLabels[key])}</button>)}</div>
      <div className="arkme-arrangement-navigation-footer">
        <button type="button" onClick={() => setReviewInbox(true)}>{tr('待确认识别')}{reviewCount ? ` (${reviewCount})` : ''}</button>
        <button type="button" onClick={() => setRecognitionSettings(true)}>{tr('自动识别设置')}</button>
        <button type="button" aria-label={tr('完成提示音')} aria-pressed={sound} title={tr(sound ? '关闭完成提示音' : '开启完成提示音')}
          onClick={() => setSound(!sound)}>
          {sound ? <SpeakerHigh size={17} /> : <SpeakerSlash size={17} />}<span>{tr('完成提示音')}</span>
        </button>
      </div>
    </nav>
    <section className="arkme-arrangement-directory" aria-label={tr('安排列表')}>
      <header><div><h3>{tr(arrangementViewLabels[view])}</h3>{view === 'week' && <small>{tr('今天起未来7天')}</small>}</div>
        <div className="arkme-arrangement-directory-tools"><button type="button" aria-label={tr('刷新安排')} title={tr('刷新')} disabled={data.loading || !!pending.size} onClick={() => { void data.refresh() }}><ArrowsClockwise size={18} /></button>
          <button type="button" aria-label={tr('添加安排')} title={tr('添加安排')} onClick={onAddArrangement}><Plus size={20} /></button></div>
      </header>
      <div className="arkme-arrangement-directory-scroll" onScroll={event => { const el = event.currentTarget; if (el.scrollHeight - el.scrollTop - el.clientHeight < 160 && data.hasMore && !data.loading && !data.error && !pending.size) void data.loadMore() }}>
        {!accountScope ? <p className="arkme-arrangement-workspace-empty">{tr('请先登录')}</p> : <>
          {data.loading && !data.rows.length && <div className="arkme-arrangement-workspace-skeletons" role="status" aria-label={tr('正在加载安排')}>
            {[0,1,2,3,4].map(index => <div key={index}><span /><span /></div>)}
          </div>}
          {data.rows.map(item => {
            const operation = pending.get(item.arrangementRef)
            const phase = operation === 'completing' || operation === 'restoring' ? operation : undefined
            const checked = arrangementCompletionChecked(item.status === 'deleted' ? 'unknown' : item.status, phase)
            return <div key={item.arrangementRef} className="arkme-arrangement-task arkme-arrangement-completion-row" data-arrangement-task={item.arrangementRef} data-selected={selected?.arrangementRef === item.arrangementRef} data-completed={checked}>
              {item.status !== 'deleted' && <ArkmeArrangementCompletionControl title={item.title} status={item.status} phase={phase}
                busy={!!operation} onToggle={() => { void toggleComplete(item) }} />}
              <button type="button" className="arkme-arrangement-task-body" aria-pressed={selected?.arrangementRef === item.arrangementRef} onClick={() => { setSelected(item); setDeleting(undefined) }}>
                <div className="arkme-arrangement-task-copy"><div className="arkme-arrangement-task-title">{item.recognitionState === 'recognizing' && <ArkmeArrangementRecognition />}<strong className="arkme-arrangement-completion-title" title={item.title}>{item.title || tr('未命名安排')}</strong></div>
                  {item.description.trim() && <p>{item.description}</p>}</div>
                <time dateTime={validTime(item.dueAtMillis) ? new Date(item.dueAtMillis).toISOString() : undefined} title={validTime(item.dueAtMillis) ? fullTime(item.dueAtMillis) : undefined}>{rowTime(item.dueAtMillis, now)}</time>
              </button>
            </div>
          })}
          {!data.loading && !data.error && !data.rows.length && <p className="arkme-arrangement-workspace-empty">{tr(view === 'deleted' ? '暂无已删除安排' : view === 'completed' ? '暂无已完成安排' : view === 'today' ? '今天暂无待完成安排' : view === 'week' ? '最近7天暂无待完成安排' : '暂无待完成安排')}</p>}
          {data.error && <div className="arkme-arrangement-list-error" role="alert"><p>{tr(data.rows.length ? '更新失败，已保留当前内容' : '安排加载失败，请重试')}</p><button type="button" disabled={!!pending.size} onClick={() => { void data.refresh() }}>{tr('重试')}</button></div>}
          {data.loading && !!data.rows.length && <p role="status" className="arkme-arrangement-list-progress">{tr('正在加载…')}</p>}
          {data.hasMore && !data.loading && !data.error && <button type="button" className="arkme-arrangement-load-more" disabled={!!pending.size} onClick={() => { void data.loadMore() }}>{tr('加载更多')}</button>}
        </>}
      </div>
      {notice && <div className="arkme-arrangement-feedback" role={notice.error ? 'alert' : 'status'}><span>{notice.text}</span>
        {notice.undo && <button type="button" disabled={pending.has(notice.undo.arrangementRef)} onClick={() => { void toggleComplete(notice.undo!) }}>{tr('撤销')}</button>}
        <button type="button" aria-label={tr('关闭提示')} onClick={() => setNotice(undefined)}><X size={14} /></button></div>}
      {!!data.rows.length && <footer>{data.total === undefined ? tr('已加载 {count} 项', { count: data.rows.length }) : tr('已加载 {count} / {total} 项', { count: data.rows.length, total: data.total })}</footer>}
    </section>
    {targetError && <div role="alert">{tr('指定安排加载失败')} <button type="button" onClick={() => setTargetAttempt(n => n + 1)}>{tr('重试')}</button></div>}
    {selected ? <ArkmeArrangementDetailPane accountScope={accountScope} onSettings={() => setRecognitionSettings(true)} onApplied={apply} onRedirect={next => { setSelected(next); void latestData.current.refresh() }} key={selected.arrangementRef} item={selected} busy={busy} onClose={() => setSelected(undefined)} onComplete={toggleComplete} onDelete={setDeleting} onReminder={toggleReminder} />
      : <aside className="arkme-arrangement-detail-empty"><p>{tr('选择一个安排查看详情')}</p></aside>}
    {reviewInbox && <ArkmeArrangementReviewInbox key={accountScope} accountScope={accountScope} onClose={()=>setReviewInbox(false)} onApplied={apply}/>}
    {recognitionSettings && <ArkmeArrangementRecognitionSettings key={accountScope} accountScope={accountScope} onClose={() => setRecognitionSettings(false)} />}
    {deleting && <ArkmeConfirmDialog titleId="arkme-arrangement-delete-title" title={tr('删除安排')}
      description={tr('将「{title}」移入已删除？', { title: deleting.title })} busy={pending.has(deleting.arrangementRef)}
      confirmLabel={tr('删除')} busyLabel={tr('正在删除…')} confirmTone="danger" onClose={() => setDeleting(undefined)} onConfirm={() => { void deleteArrangement(deleting) }} />}
  </div>
}
