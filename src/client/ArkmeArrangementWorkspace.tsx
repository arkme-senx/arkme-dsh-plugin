import { ArkmeArrangementRestore } from './ArkmeArrangementRestore.js'
import { ArkmeArrangementSources } from './ArkmeArrangementSources.js'
import { useOccurrenceReviewCount } from './use-arrangement-occurrences.js'
import { ArkmeArrangementOccurrenceTimeline } from "./ArkmeArrangementOccurrenceTimeline.js"
import { ArkmeArrangementReviewInbox } from "./ArkmeArrangementOccurrenceActions.js"
import { ArkmeArrangementRecognitionSettings, ArkmeArrangementRecognitionProcess } from "./ArkmeArrangementRecognitionInspector.js"
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Square } from '@phosphor-icons/react/dist/icons/Square'
import { CheckSquare } from '@phosphor-icons/react/dist/icons/CheckSquare'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { SpeakerHigh } from '@phosphor-icons/react/dist/icons/SpeakerHigh'
import { SpeakerSlash } from '@phosphor-icons/react/dist/icons/SpeakerSlash'
import { ArrowsClockwise } from '@phosphor-icons/react/dist/icons/ArrowsClockwise'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import type { ArkmeArrangementDetail, ArkmeArrangementItem, ArkmeArrangementMutationResult, ArkmeArrangementReminderToggleResult } from '../types.js'
import { callArkme } from './api.js'
import { arkmeIntlLocale, tr, useArkmeLocale } from './locale.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { moveArrangement } from './arrangement-board-model.js'
import { ArkmeArrangementContent } from './ArkmeArrangementContent.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { ArkmeArrangementRecognition } from './ArkmeArrangementRecognition.js'
import { useArrangementWorkspace } from './use-arrangement-workspace.js'
import { prepareArrangementCompletionSound } from './arrangement-completion-sound.js'
import { arrangementViews, arrangementViewLabels, nextArrangementMidnight, type ArrangementView, type ArrangementWorkspaceItem } from './arrangement-workspace-model.js'

const statusLabels = { identified: '已识别', following: '跟进中', completed: '已完成', deleted: '已删除', unknown: '状态待确认' }
function validTime(value?: number): value is number { return !!value && Number.isFinite(new Date(value).getTime()) }
function fullTime(value?: number) { return validTime(value) ? new Intl.DateTimeFormat(arkmeIntlLocale(), { dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(value) : tr('未设置') }
function rowTime(value: number | undefined, now: number) {
  if (!validTime(value)) return tr('未定时间')
  return new Intl.DateTimeFormat(arkmeIntlLocale(), new Date(value).toDateString() === new Date(now).toDateString()
    ? { hour: '2-digit', minute: '2-digit', hour12: false }
    : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(value)
}
function readSound(scope: string) { try { return localStorage.getItem(`arkme:arrangements:sound:${scope}`) !== 'off' } catch { return true } }

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
  const [sound, setSound] = useState(() => readSound(accountScope))
  const [deleting, setDeleting] = useState<ArkmeArrangementItem>()
  const lifetime = useRef<AbortController>()
  const sounds = useRef(new Set<{ play(): void; cancel(): void }>())
  const latestData = useRef(data); latestData.current = data
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => { controller.abort(); for (const sound of sounds.current) sound.cancel() } }, [])
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
    const feedback = completing && sound ? prepareArrangementCompletionSound() : undefined
    if (feedback) sounds.current.add(feedback)
    writes.current.add(item.arrangementRef); markPending(item.arrangementRef, completing ? 'completing' : 'restoring'); setNotice(undefined)
    try {
      const result = await moveArrangement(item, completing ? 'completed' : 'following', signal)
      if (signal.aborted) return
      latestData.current.updateItem(result)
      setSelected(undefined)
      writes.current.delete(item.arrangementRef); markPending(item.arrangementRef)
      setNotice({ text: tr(completing ? '已完成' : '已恢复为未完成'), ...(completing ? { undo: result } : {}) })
      if (completing) {
        feedback?.play(); if (feedback) sounds.current.delete(feedback)
      }
    } catch {
      feedback?.cancel(); if (feedback) sounds.current.delete(feedback)
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
          onClick={() => { const next = !sound; setSound(next); try { localStorage.setItem(`arkme:arrangements:sound:${accountScope}`, next ? 'on' : 'off') } catch {} }}>
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
            const checked = operation === 'restoring' ? false : item.status === 'completed' || operation === 'completing'
            return <div key={item.arrangementRef} className="arkme-arrangement-task" data-arrangement-task={item.arrangementRef} data-selected={selected?.arrangementRef === item.arrangementRef} data-completed={checked}>
              {item.status !== 'deleted' && <button type="button" role="checkbox" aria-checked={checked} aria-label={tr(item.status === 'completed' ? '取消完成：{title}' : '完成：{title}', { title: item.title })}
                className="arkme-arrangement-checkbox" disabled={!!operation || item.status === 'unknown'} aria-busy={!!operation} onClick={() => { void toggleComplete(item) }}>
                  {checked ? <CheckSquare size={20} weight="fill" className="arkme-arrangement-checkbox-icon" aria-hidden /> : <Square size={20} className="arkme-arrangement-checkbox-icon" aria-hidden />}
              </button>}
              <button type="button" className="arkme-arrangement-task-body" aria-pressed={selected?.arrangementRef === item.arrangementRef} onClick={() => { setSelected(item); setDeleting(undefined) }}>
                <div className="arkme-arrangement-task-copy"><div className="arkme-arrangement-task-title">{item.recognitionState === 'recognizing' && <ArkmeArrangementRecognition />}<strong title={item.title}>{item.title || tr('未命名安排')}</strong></div>
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
    {selected ? <ArrangementDetailPane accountScope={accountScope} onSettings={() => setRecognitionSettings(true)} onApplied={apply} onRedirect={next => { setSelected(next); void latestData.current.refresh() }} key={selected.arrangementRef} item={selected} busy={busy} onClose={() => setSelected(undefined)} onComplete={toggleComplete} onDelete={setDeleting} onReminder={toggleReminder} />
      : <aside className="arkme-arrangement-detail-empty"><p>{tr('选择一个安排查看详情')}</p></aside>}
    {reviewInbox && <ArkmeArrangementReviewInbox key={accountScope} accountScope={accountScope} onClose={()=>setReviewInbox(false)} onApplied={apply}/>}
    {recognitionSettings && <ArkmeArrangementRecognitionSettings key={accountScope} accountScope={accountScope} onClose={() => setRecognitionSettings(false)} />}
    {deleting && <ArkmeConfirmDialog titleId="arkme-arrangement-delete-title" title={tr('删除安排')}
      description={tr('将「{title}」移入已删除？', { title: deleting.title })} busy={pending.has(deleting.arrangementRef)}
      confirmLabel={tr('删除')} busyLabel={tr('正在删除…')} confirmTone="danger" onClose={() => setDeleting(undefined)} onConfirm={() => { void deleteArrangement(deleting) }} />}
  </div>
}

function ArrangementDetailPane({ accountScope, onSettings, onApplied, onRedirect, item, busy, onClose, onComplete, onDelete, onReminder }: {
  accountScope: string; onSettings(): void; onApplied(item: ArkmeArrangementItem): void; onRedirect(item: ArkmeArrangementItem): void;
  item: ArrangementWorkspaceItem; busy: boolean; onClose(): void; onComplete(item: ArkmeArrangementItem): Promise<void>; onDelete(item: ArkmeArrangementItem): void; onReminder(item: ArkmeArrangementItem): Promise<void>
}) {
  const [detail, setDetail] = useState<ArrangementWorkspaceItem>()
  const [loading, setLoading] = useState(true), [error, setError] = useState(false), [attempt, setAttempt] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuTrigger = useRef<HTMLButtonElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const titleId = useId()
  const [titleExpanded, setTitleExpanded] = useState(false), [titleOverflows, setTitleOverflows] = useState(false)
  const current = detail && detail.updatedAtMillis >= item.updatedAtMillis ? detail : item
  const lifetime = useRef<AbortController>()
  useLayoutEffect(() => {
    const heading = titleRef.current
    if (!heading) return
    heading.scrollTop = 0
    setTitleExpanded(false)
    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(heading).lineHeight)
      setTitleOverflows(Number.isFinite(lineHeight) && lineHeight > 0 && heading.scrollHeight > lineHeight * 2 + 1)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(heading)
    return () => observer?.disconnect()
  }, [current.title])
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller; setLoading(true); setError(false)
    void withArkmeReadDeadline(signal => callArkme<ArrangementWorkspaceItem & Pick<ArkmeArrangementDetail, 'resolvedFromRef'>>(item.status === 'deleted' ? 'arrangements.deleted.detail' : 'arrangements.detail', { arrangementRef: item.arrangementRef }, signal), controller.signal)
      .then(value => {
        if (controller.signal.aborted) return
        if (value.arrangementRef !== item.arrangementRef) {
          if (item.status === 'deleted' || value.status === 'deleted' || value.resolvedFromRef !== item.arrangementRef) throw new Error('Arrangement identity mismatch')
          onRedirect(value)
        } else setDetail(value)
      })
      .catch(() => { if (!controller.signal.aborted) setError(true) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [item.arrangementRef, item.status, item.updatedAtMillis, attempt])
  useEffect(() => {
    if (busy || current.status === 'deleted' || current.status === 'unknown') setMenuOpen(false)
  }, [busy, current.status])
  const actionDisabled = busy || current.status === 'unknown'
  const selectAction = (action: () => void) => {
    setMenuOpen(false)
    menuTrigger.current?.focus({ preventScroll: true })
    action()
  }
  return <aside className="arkme-arrangement-detail" aria-label={tr('安排详情')}>
    <header>
      <div className="arkme-arrangement-detail-heading">
        <h2 ref={titleRef} id={titleId} data-expanded={titleExpanded} tabIndex={titleExpanded ? 0 : undefined}>{current.title || tr('未命名安排')}</h2>
        {(titleOverflows || titleExpanded) && <button type="button" className="arkme-arrangement-title-toggle" aria-expanded={titleExpanded} aria-controls={titleId}
          onClick={() => { if (titleRef.current) titleRef.current.scrollTop = 0; setTitleExpanded(expanded => !expanded) }}>{tr(titleExpanded ? '收起标题' : '展开完整标题')}</button>}
      </div>
      <div className="arkme-arrangement-detail-header-actions">
        {current.status !== 'deleted' && <ArkmeActionMenu label={tr('安排操作')} open={menuOpen} autoFocus align="end"
          onClose={() => setMenuOpen(false)}
          anchor={<button ref={menuTrigger} type="button" aria-label={tr('安排操作')} aria-haspopup="menu" aria-expanded={menuOpen} disabled={actionDisabled}
            onClick={() => setMenuOpen(open => !open)}
            onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setMenuOpen(true) } }}>
            <DotsThree size={20} aria-hidden />
          </button>}
          actions={[
            { id: 'complete', label: tr(current.status === 'completed' ? '恢复为未完成' : '完成安排'), disabled: actionDisabled,
              onSelect: () => selectAction(() => { void onComplete(current) }) },
            { id: 'delete', label: tr('删除'), danger: true, disabled: actionDisabled,
              onSelect: () => selectAction(() => onDelete(current)) },
          ]} />}
        <button type="button" aria-label={tr('关闭安排详情')} onClick={onClose}><X size={20} /></button>
      </div>
    </header>
    <div className="arkme-arrangement-detail-scroll">
      {current.description.trim() && <p className="arkme-arrangement-detail-description">{current.description}</p>}
      <dl><div><dt>{tr('状态')}</dt><dd>{tr(statusLabels[current.status])}</dd></div>
        <div><dt>{tr('安排时间')}</dt><dd>{fullTime(current.dueAtMillis)}</dd></div>
        <div><dt>{tr('提醒时间')}</dt><dd>{fullTime(current.remindAtMillis)}</dd></div>
        <div><dt>{tr('提醒')}</dt><dd>{current.status === 'deleted' ? tr(current.reminderEnabled ? '已开启' : '已关闭') : <button type="button" role="switch" aria-checked={current.reminderEnabled} aria-label={tr('安排提醒')} disabled={busy} onClick={() => { void onReminder(current) }}>{tr(current.reminderEnabled ? '已开启' : '已关闭')}</button>}</dd></div>
        <div><dt>{tr('创建时间')}</dt><dd>{fullTime(current.createdAtMillis)}</dd></div>
        <div><dt>{tr('更新时间')}</dt><dd>{fullTime(current.updatedAtMillis)}</dd></div></dl>
      {loading && <p role="status" className="arkme-arrangement-detail-progress">{tr('正在补充详情…')}</p>}
      {error && <div role="alert" className="arkme-arrangement-list-error">{tr('详情加载失败，已保留当前信息')} <button type="button" onClick={() => setAttempt(value => value + 1)}>{tr('重试')}</button></div>}
      {current.status === 'deleted' && <ArkmeArrangementRestore key={`${current.arrangementRef}:${current.restore?.expectedVersion ?? 'unsupported'}`} item={current} disabled={loading || error || busy}
        onRestored={next => { onApplied(next); onRedirect(next) }} onRefresh={() => setAttempt(value => value + 1)} />}
      <section className="arkme-arrangement-detail-sources" aria-label={tr('安排来源')}>
        {current.status === 'deleted' ? <><h3>{tr('来源')}</h3>{current.provenance?.length
          ? <ArkmeArrangementSources arrangementRef={current.arrangementRef} sources={current.provenance} expanded />
          : <p className="arkme-arrangement-detail-progress">{tr('历史记录未保存定位信息')}</p>}</>
          : <ArkmeArrangementOccurrenceTimeline accountScope={accountScope} item={current} fallback={<ArkmeArrangementContent item={current} expanded readDetail={false} />} />}
      </section>
      {current.status !== 'deleted' && <ArkmeArrangementRecognitionProcess key={current.arrangementRef} accountScope={accountScope} item={current} onSettings={onSettings} onApplied={next => {setDetail(next);onApplied(next)}} />}
    </div>
  </aside>
}
