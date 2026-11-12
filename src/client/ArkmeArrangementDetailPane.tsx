import { CheckCircle } from '@phosphor-icons/react/dist/icons/CheckCircle'
import { PencilSimple } from '@phosphor-icons/react/dist/icons/PencilSimple'
import { arrangementColumns, arrangementColumnLabels, moveArrangement, readArrangementForTransition, type ArrangementColumn } from './arrangement-board-model.js'
import { ArrangementTitleEditor, ArrangementReminderTimeEditor } from './ArkmeArrangementInlineEditors.js'
import { Lightbulb } from '@phosphor-icons/react/dist/icons/Lightbulb'
import { ClipboardText } from '@phosphor-icons/react/dist/icons/ClipboardText'
import { Clock } from '@phosphor-icons/react/dist/icons/Clock'
import { Alarm } from '@phosphor-icons/react/dist/icons/Alarm'
import { Bell } from '@phosphor-icons/react/dist/icons/Bell'
import { CalendarPlus } from '@phosphor-icons/react/dist/icons/CalendarPlus'
import { ArrowsClockwise } from '@phosphor-icons/react/dist/icons/ArrowsClockwise'
import { ArkmeCloseButton } from './ArkmeCloseButton.js'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import type { ArkmeArrangementDetail, ArkmeArrangementItem } from '../types.js'
import { ArkmeArrangementRestore } from './ArkmeArrangementRestore.js'
import { ArkmeArrangementSources } from './ArkmeArrangementSources.js'
import { ArkmeArrangementOccurrenceTimeline } from './ArkmeArrangementOccurrenceTimeline.js'
import { ArkmeArrangementRecognitionProcess } from './ArkmeArrangementRecognitionInspector.js'
import { ArkmeArrangementContent } from './ArkmeArrangementContent.js'
import { ArkmeActionMenu, ArkmeDshMenu } from './ArkmeDshMenu.js'
import { callArkme } from './api.js'
import { arkmeIntlLocale, tr } from './locale.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import type { ArrangementWorkspaceItem } from './arrangement-workspace-model.js'
const statusIcons = { identified: Lightbulb, following: ArrowsClockwise, completed: CheckCircle, deleted: undefined, unknown: undefined }
const statusLabels = { identified: '已识别', following: '跟进中', completed: '已完成', deleted: '已删除', unknown: '状态待确认' }
function fullTime(value?: number) { return value && Number.isFinite(new Date(value).getTime()) ? new Intl.DateTimeFormat(arkmeIntlLocale(), { dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(value) : tr('未设置') }

export function ArkmeArrangementDetailPane({ accountScope, onSettings, onApplied, onRedirect, onRestored, item, busy, onClose, onComplete, onDelete, onReminder, onEdited, readDetail = true }: {
  onEdited?(): void; onRestored?(): void; readDetail?: boolean; accountScope: string; onSettings(): void; onApplied(item: ArkmeArrangementItem): void; onRedirect(item: ArkmeArrangementItem): void;
  item: ArrangementWorkspaceItem; busy: boolean; onClose(): void; onComplete(item: ArkmeArrangementItem): Promise<void>; onDelete(item: ArkmeArrangementItem): void; onReminder(item: ArkmeArrangementItem): Promise<void>
}) {
  const [savingEdit, setSavingEdit] = useState(false), [editError, setEditError] = useState('')
  const editLifetime = useRef<AbortController>(), editingWrite = useRef(false)
  useEffect(() => { const controller = new AbortController(); editLifetime.current = controller; return () => controller.abort() }, [])
  const [detail, setDetail] = useState<ArrangementWorkspaceItem>()
  const [loading, setLoading] = useState(true), [error, setError] = useState(false), [attempt, setAttempt] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)
  const menuTrigger = useRef<HTMLButtonElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const titleId = useId()
  const [titleExpanded, setTitleExpanded] = useState(false), [titleOverflows, setTitleOverflows] = useState(false)
  const current = detail && detail.updatedAtMillis >= item.updatedAtMillis ? detail : item
  const StatusIcon = statusIcons[current.status]
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
    if (!readDetail) { setLoading(false); setError(false); return }
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
  }, [item.arrangementRef, item.status, item.updatedAtMillis, attempt, readDetail])
  useEffect(() => {
    if (busy || current.status === 'deleted' || current.status === 'unknown') setMenuOpen(false)
  }, [busy, current.status])
  const actionDisabled = busy || savingEdit || current.status === 'unknown'
  const editable = current.status !== 'deleted' && current.status !== 'unknown'
  const saveEdit = async (patch: { title?: string; remindAtMillis?: number }): Promise<boolean> => {
    if (busy || editingWrite.current || !editable) return false
    if (current.version === undefined) { setEditError(tr('当前服务暂不支持安排编辑，请刷新后重试')); return false }
    const signal = editLifetime.current?.signal
    if (!signal || signal.aborted) return false
    editingWrite.current = true; setSavingEdit(true); setEditError('')
    try {
      const result = await callArkme<import('../types.js').ArkmeArrangementEditResult>('arrangements.edit', {
        arrangementRef: current.arrangementRef, expectedVersion: current.version, ...patch,
      }, signal)
      if (signal.aborted) return false
      if (result.item.arrangementRef !== current.arrangementRef) throw new Error('identity mismatch')
      setDetail(result.item); onApplied(result.item)
      if (result.state === 'conflict') { setEditError(tr('安排已在其他位置更新，输入已保留，请核对后重试')); return false }
      onEdited?.()
      return true
    } catch {
      if (!signal.aborted) setEditError(tr('保存未确认，输入已保留；请刷新核对或重试'))
      return false
    } finally {
      editingWrite.current = false
      if (!signal.aborted) setSavingEdit(false)
    }
  }
  const changeStatus = async (target: ArrangementColumn) => {
    setStatusMenuOpen(false)
    if (!editable || busy || editingWrite.current || current.status === target) return
    const signal = editLifetime.current?.signal
    if (!signal || signal.aborted) return
    editingWrite.current = true; setSavingEdit(true); setEditError('')
    try {
      const latest = await readArrangementForTransition(current.arrangementRef, signal)
      const result = await moveArrangement(latest, target, signal)
      if (signal.aborted) return
      setDetail(result); onApplied(result); onEdited?.()
    } catch {
      if (!signal.aborted) {
        setEditError(tr('未能确认安排状态，请刷新后重试'))
        onEdited?.()
      }
    } finally {
      editingWrite.current = false
      if (!signal.aborted) setSavingEdit(false)
    }
  }
  useEffect(() => { if (busy || savingEdit || !editable) setStatusMenuOpen(false) }, [busy, savingEdit, editable])
  const reminderDisabled = busy || savingEdit || current.status !== 'following'
  const selectAction = (action: () => void) => {
    setMenuOpen(false)
    menuTrigger.current?.focus({ preventScroll: true })
    action()
  }
  return <aside className="arkme-arrangement-detail" aria-label={tr('安排详情')}>
    <header>
      <div className="arkme-arrangement-detail-heading">
        <div className="arkme-arrangement-title-line">
        <h2 ref={titleRef} id={titleId} data-expanded={titleExpanded} tabIndex={titleExpanded ? 0 : undefined}>{current.title || tr('未命名安排')}</h2>
        {editable && <ArrangementTitleEditor title={current.title} disabled={busy || savingEdit} onSave={title => saveEdit({title})} />}
        </div>
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
        <ArkmeCloseButton type="button" aria-label={tr('关闭安排详情')} onClick={onClose} />
      </div>
    </header>
    <div className="arkme-arrangement-detail-scroll">
      {current.description.trim() && <div className="arkme-arrangement-detail-description"><Lightbulb size={18} aria-hidden /><p>{current.description}</p></div>}
      <dl className="arkme-arrangement-detail-facts"><div><dt><ClipboardText size={16} aria-hidden />{tr('状态')}</dt><dd className="arkme-arrangement-status-value"><span className="arkme-arrangement-status" data-status={current.status}>{StatusIcon && <StatusIcon size={16} weight="regular" aria-hidden />}{tr(statusLabels[current.status])}</span>
          {editable && <ArkmeDshMenu label={tr('编辑状态')} open={statusMenuOpen} side="bottom" align="start" portal
            selectedIds={[current.status]} items={arrangementColumns.map(status => { const Icon = statusIcons[status]; return { id: status, label: tr(arrangementColumnLabels[status]), icon: <Icon size={16} weight="regular" aria-hidden /> } })}
            onClose={() => setStatusMenuOpen(false)} onSelect={id => { if (arrangementColumns.includes(id as ArrangementColumn)) void changeStatus(id as ArrangementColumn) }}
            anchor={<button type="button" className="arkme-arrangement-time-edit" aria-label={tr('编辑状态')} title={tr('编辑状态')} aria-haspopup="menu" aria-expanded={statusMenuOpen} disabled={actionDisabled}
              onClick={() => setStatusMenuOpen(open => !open)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setStatusMenuOpen(true) } }}><PencilSimple size={16} aria-hidden /></button>} />}
        </dd></div>
        <div><dt><Clock size={16} aria-hidden />{tr('安排时间')}</dt><dd data-unset={!current.dueAtMillis}>{fullTime(current.dueAtMillis)}</dd></div>
        {current.status === 'following' && <div><dt><Bell size={16} aria-hidden />{tr('提醒')}</dt><dd><span className="arkme-arrangement-reminder-switch-row"><button type="button" className="arkme-arrangement-reminder-switch" data-arkme-hover="none" role="switch" aria-checked={current.reminderEnabled} aria-label={tr('安排提醒')} disabled={reminderDisabled} onClick={() => { void onReminder(current) }}><span aria-hidden /></button></span></dd></div>}
        {current.status === 'following' && current.reminderEnabled && <div><dt><Alarm size={16} aria-hidden />{tr('提醒时间')}</dt><dd className="arkme-arrangement-reminder-value" data-unset={!current.remindAtMillis}><span>{fullTime(current.remindAtMillis)}</span>{editable && <ArrangementReminderTimeEditor at={current.remindAtMillis} disabled={busy || savingEdit} onSave={remindAtMillis => saveEdit({remindAtMillis})} />}</dd></div>}
        <div><dt><CalendarPlus size={16} aria-hidden />{tr('创建时间')}</dt><dd>{fullTime(current.createdAtMillis)}</dd></div>
        <div><dt><ArrowsClockwise size={16} aria-hidden />{tr('更新时间')}</dt><dd>{fullTime(current.updatedAtMillis)}</dd></div></dl>
      {savingEdit && <p role="status" className="arkme-arrangement-detail-progress">{tr('正在保存…')}</p>}
      {editError && <p role="alert" className="arkme-arrangement-edit-error">{editError}</p>}
      {loading && <p role="status" className="arkme-arrangement-detail-progress">{tr('正在补充详情…')}</p>}
      {error && <div role="alert" className="arkme-arrangement-list-error">{tr('详情加载失败，已保留当前信息')} <button type="button" onClick={() => setAttempt(value => value + 1)}>{tr('重试')}</button></div>}
      {current.status === 'deleted' && <ArkmeArrangementRestore key={`${current.arrangementRef}:${current.restore?.expectedVersion ?? 'unsupported'}`} item={current} disabled={loading || error || busy}
        onRestored={next => { onApplied(next); onRedirect(next); onRestored?.() }} onRefresh={() => setAttempt(value => value + 1)} />}
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
