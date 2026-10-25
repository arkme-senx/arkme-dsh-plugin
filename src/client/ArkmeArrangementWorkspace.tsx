import { useEffect, useRef, useState } from 'react'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { SpeakerHigh } from '@phosphor-icons/react/dist/icons/SpeakerHigh'
import { SpeakerSlash } from '@phosphor-icons/react/dist/icons/SpeakerSlash'
import { ArrowsClockwise } from '@phosphor-icons/react/dist/icons/ArrowsClockwise'
import type { ArkmeArrangementItem, ArkmeArrangementMutationResult, ArkmeArrangementReminderToggleResult } from '../types.js'
import { callArkme } from './api.js'
import { arkmeUi } from './ui-controller.js'
import { arkmeIntlLocale, tr, useArkmeLocale } from './locale.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { moveArrangement } from './arrangement-board-model.js'
import { ArkmeArrangementContent } from './ArkmeArrangementContent.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
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

export function ArkmeArrangementWorkspace(props: { accountScope: string; onAddArrangement(): void; createdItems?: ArkmeArrangementItem[] }) {
  return <ArrangementWorkspace key={props.accountScope} {...props} />
}
function ArrangementWorkspace({ accountScope, onAddArrangement, createdItems }: { accountScope: string; onAddArrangement(): void; createdItems?: ArkmeArrangementItem[] }) {
  useArkmeLocale()
  const [view, setView] = useState<ArrangementView>('today')
  const [now, setNow] = useState(Date.now)
  const data = useArrangementWorkspace(accountScope, view, now)
  const [selected, setSelected] = useState<ArrangementWorkspaceItem>()
  type Pending = 'completing' | 'restoring' | 'deleting' | 'reminder' | 'saved'
  const [pending, setPending] = useState(new Map<string, Pending>())
  const writes = useRef(new Set<string>())
  const [notice, setNotice] = useState<{ text: string; undo?: ArkmeArrangementItem; error?: boolean }>()
  const [sound, setSound] = useState(() => readSound(accountScope))
  const [deleting, setDeleting] = useState<ArkmeArrangementItem>()
  const lifetime = useRef<AbortController>()
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const sounds = useRef(new Set<{ play(): void; cancel(): void }>())
  const latestData = useRef(data); latestData.current = data
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => { controller.abort(); for (const timer of timers.current) clearTimeout(timer); for (const sound of sounds.current) sound.cancel() } }, [])
  useEffect(() => {
    const refreshClock = () => setNow(Date.now())
    const timer = setTimeout(refreshClock, nextArrangementMidnight(now))
    window.addEventListener('focus', refreshClock)
    return () => { clearTimeout(timer); window.removeEventListener('focus', refreshClock) }
  }, [now])
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
      setSelected(previous => previous?.arrangementRef === item.arrangementRef ? result : previous)
      setNotice({ text: tr(completing ? '已完成' : '已恢复为未完成'), ...(completing ? { undo: result } : {}) })
      if (completing) {
        feedback?.play(); if (feedback) sounds.current.delete(feedback); markPending(item.arrangementRef, 'saved')
        const timer = setTimeout(() => { timers.current.delete(timer); if (!signal.aborted) { apply(result); writes.current.delete(item.arrangementRef); markPending(item.arrangementRef) } }, 420)
        timers.current.add(timer)
      } else { apply(result); writes.current.delete(item.arrangementRef); markPending(item.arrangementRef) }
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
        <button type="button" onClick={() => arkmeUi.openDshSettings('arkme-usage')}>{tr('自动识别设置')}</button>
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
      {notice && <div className="arkme-arrangement-feedback" role={notice.error ? 'alert' : 'status'}><span>{notice.text}</span>
        {notice.undo && <button type="button" disabled={pending.has(notice.undo.arrangementRef)} onClick={() => { void toggleComplete(notice.undo!) }}>{tr('撤销')}</button>}
        <button type="button" aria-label={tr('关闭提示')} onClick={() => setNotice(undefined)}><X size={14} /></button></div>}
      <div className="arkme-arrangement-directory-scroll" onScroll={event => { const el = event.currentTarget; if (el.scrollHeight - el.scrollTop - el.clientHeight < 160 && data.hasMore && !data.loading && !data.error && !pending.size) void data.loadMore() }}>
        {!accountScope ? <p className="arkme-arrangement-workspace-empty">{tr('请先登录')}</p> : <>
          {data.loading && !data.rows.length && <div className="arkme-arrangement-workspace-skeletons" role="status" aria-label={tr('正在加载安排')}>
            {[0,1,2,3,4].map(index => <div key={index}><span /><span /></div>)}
          </div>}
          {data.rows.map(item => {
            const operation = pending.get(item.arrangementRef)
            const checked = operation === 'restoring' ? false : item.status === 'completed' || operation === 'completing' || operation === 'saved'
            return <div key={item.arrangementRef} className="arkme-arrangement-task" data-arrangement-task={item.arrangementRef} data-selected={selected?.arrangementRef === item.arrangementRef} data-completed={checked} data-saved={operation === 'saved'}>
              {item.status !== 'deleted' && <button type="button" role="checkbox" aria-checked={checked} aria-label={tr(item.status === 'completed' ? '取消完成：{title}' : '完成：{title}', { title: item.title })}
                className="arkme-arrangement-checkbox" disabled={!!operation || item.status === 'unknown'} aria-busy={!!operation && operation !== 'saved'} onClick={() => { void toggleComplete(item) }}>{checked && <Check size={14} weight="bold" />}</button>}
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
      {!!data.rows.length && <footer>{data.total === undefined ? tr('已加载 {count} 项', { count: data.rows.length }) : tr('已加载 {count} / {total} 项', { count: data.rows.length, total: data.total })}</footer>}
    </section>
    {selected ? <ArrangementDetailPane key={selected.arrangementRef} item={selected} busy={busy} onClose={() => setSelected(undefined)} onComplete={toggleComplete} onDelete={setDeleting} onReminder={toggleReminder} />
      : <aside className="arkme-arrangement-detail-empty"><p>{tr('选择一个安排查看详情')}</p></aside>}
    {deleting && <ArkmeConfirmDialog titleId="arkme-arrangement-delete-title" title={tr('删除安排')}
      description={tr('将「{title}」移入已删除？', { title: deleting.title })} busy={pending.has(deleting.arrangementRef)}
      confirmLabel={tr('删除')} busyLabel={tr('正在删除…')} confirmTone="danger" onClose={() => setDeleting(undefined)} onConfirm={() => { void deleteArrangement(deleting) }} />}
  </div>
}

function ArrangementDetailPane({ item, busy, onClose, onComplete, onDelete, onReminder }: {
  item: ArrangementWorkspaceItem; busy: boolean; onClose(): void; onComplete(item: ArkmeArrangementItem): Promise<void>; onDelete(item: ArkmeArrangementItem): void; onReminder(item: ArkmeArrangementItem): Promise<void>
}) {
  const [detail, setDetail] = useState<ArrangementWorkspaceItem>()
  const [loading, setLoading] = useState(true), [error, setError] = useState(false), [attempt, setAttempt] = useState(0)
  const current = detail && detail.updatedAtMillis >= item.updatedAtMillis ? detail : item
  const lifetime = useRef<AbortController>()
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller; setLoading(true); setError(false)
    void withArkmeReadDeadline(signal => callArkme<ArrangementWorkspaceItem>(item.status === 'deleted' ? 'arrangements.deleted.detail' : 'arrangements.detail', { arrangementRef: item.arrangementRef }, signal), controller.signal)
      .then(value => { if (!controller.signal.aborted) { if (value.arrangementRef !== item.arrangementRef) throw new Error('Arrangement identity mismatch'); setDetail(value) } })
      .catch(() => { if (!controller.signal.aborted) setError(true) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [item.arrangementRef, item.status, item.updatedAtMillis, attempt])
  return <aside className="arkme-arrangement-detail" aria-label={tr('安排详情')}>
    <header><span>{tr('安排详情')}</span><button type="button" aria-label={tr('关闭安排详情')} onClick={onClose}><X size={20} /></button></header>
    <div className="arkme-arrangement-detail-scroll">
      <h2>{current.title || tr('未命名安排')}</h2>
      {current.description.trim() && <p className="arkme-arrangement-detail-description">{current.description}</p>}
      <dl><div><dt>{tr('状态')}</dt><dd>{tr(statusLabels[current.status])}</dd></div>
        <div><dt>{tr('安排时间')}</dt><dd>{fullTime(current.dueAtMillis)}</dd></div>
        <div><dt>{tr('提醒时间')}</dt><dd>{fullTime(current.remindAtMillis)}</dd></div>
        <div><dt>{tr('提醒')}</dt><dd>{current.status === 'deleted' ? tr(current.reminderEnabled ? '已开启' : '已关闭') : <button type="button" role="switch" aria-checked={current.reminderEnabled} aria-label={tr('安排提醒')} disabled={busy} onClick={() => { void onReminder(current) }}>{tr(current.reminderEnabled ? '已开启' : '已关闭')}</button>}</dd></div>
        <div><dt>{tr('创建时间')}</dt><dd>{fullTime(current.createdAtMillis)}</dd></div>
        <div><dt>{tr('更新时间')}</dt><dd>{fullTime(current.updatedAtMillis)}</dd></div></dl>
      {current.status !== 'deleted' && <div className="arkme-arrangement-detail-actions"><button type="button" disabled={busy || current.status === 'unknown'} onClick={() => { void onComplete(current) }}>{tr(busy ? '正在保存…' : current.status === 'completed' ? '恢复为未完成' : '完成安排')}</button><button type="button" disabled={busy || current.status === 'unknown'} onClick={() => onDelete(current)}>{tr('删除')}</button></div>}
      {loading && <p role="status" className="arkme-arrangement-detail-progress">{tr('正在补充详情…')}</p>}
      {error && <div role="alert" className="arkme-arrangement-list-error">{tr('详情加载失败，已保留当前信息')} <button type="button" onClick={() => setAttempt(value => value + 1)}>{tr('重试')}</button></div>}
      <section className="arkme-arrangement-detail-sources" aria-label={tr('安排来源')}>
        {current.status === 'deleted' ? <><h3>{tr('来源')}</h3>{current.provenance?.map(evidence => <div key={evidence.id}><p>{tr(({record:'快记或聊天',audio_summary:'录音总结',call:'通话',input:'直接输入',voice_input:'语音输入',agent:'助手创建',manual:'手动创建'})[evidence.kind])}{evidence.sourceDate ? ` · ${evidence.sourceDate}` : ''}</p>{evidence.text && <p className="arkme-arrangement-detail-description">{evidence.text}</p>}</div>)}<p className="arkme-arrangement-detail-progress">{tr('已删除安排的恢复与来源原文访问，后端接口开发中。')}</p></>
          : <ArkmeArrangementContent item={current} expanded readDetail={false} />}
      </section>
    </div>
  </aside>
}
