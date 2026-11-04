import { ArkmeCloseButton } from './ArkmeCloseButton.js'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import type { ArkmeArrangementDetail, ArkmeArrangementItem } from '../types.js'
import { ArkmeArrangementRestore } from './ArkmeArrangementRestore.js'
import { ArkmeArrangementSources } from './ArkmeArrangementSources.js'
import { ArkmeArrangementOccurrenceTimeline } from './ArkmeArrangementOccurrenceTimeline.js'
import { ArkmeArrangementRecognitionProcess } from './ArkmeArrangementRecognitionInspector.js'
import { ArkmeArrangementContent } from './ArkmeArrangementContent.js'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { callArkme } from './api.js'
import { arkmeIntlLocale, tr } from './locale.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import type { ArrangementWorkspaceItem } from './arrangement-workspace-model.js'
const statusLabels = { identified: '已识别', following: '跟进中', completed: '已完成', deleted: '已删除', unknown: '状态待确认' }
function fullTime(value?: number) { return value && Number.isFinite(new Date(value).getTime()) ? new Intl.DateTimeFormat(arkmeIntlLocale(), { dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(value) : tr('未设置') }

export function ArkmeArrangementDetailPane({ accountScope, onSettings, onApplied, onRedirect, item, busy, onClose, onComplete, onDelete, onReminder, readDetail = true }: {
  readDetail?: boolean; accountScope: string; onSettings(): void; onApplied(item: ArkmeArrangementItem): void; onRedirect(item: ArkmeArrangementItem): void;
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
        <ArkmeCloseButton type="button" aria-label={tr('关闭安排详情')} onClick={onClose} />
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
