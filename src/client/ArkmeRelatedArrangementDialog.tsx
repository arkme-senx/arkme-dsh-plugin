import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type { ArkmeArrangementDetail, ArkmeArrangementItem } from '../types.js'
import { ArkmeArrangementDetailPane } from './ArkmeArrangementDetailPane.js'
import { ArkmeArrangementRecognitionSettings } from './ArkmeArrangementRecognitionInspector.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { callArkme } from './api.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { tr } from './locale.js'

type Props = {
  arrangementRef: string; accountScope: string; busy: boolean; latestItem?: ArkmeArrangementItem | undefined
  notice: ReactNode; onClose(): void; onApplied(item: ArkmeArrangementItem): void
  onComplete(item: ArkmeArrangementItem): Promise<unknown>; onDelete(item: ArkmeArrangementItem): Promise<boolean>
  onReminder(item: ArkmeArrangementItem): Promise<unknown>
}

/** The conversation list stays mounted behind this dialog, including its cursor and scroll. */
export function ArkmeRelatedArrangementDialog(props: Props) {
  const [item, setItem] = useState<ArkmeArrangementDetail>(), [error, setError] = useState(false), [attempt, setAttempt] = useState(0)
  const [settings, setSettings] = useState(false), [deleting, setDeleting] = useState<ArkmeArrangementItem>()
  const panel = useRef<HTMLElement>(null), latest = useRef(props); latest.current = props
  useEffect(() => {
    const controller = new AbortController(); setItem(undefined); setError(false)
    void withArkmeReadDeadline(signal => callArkme<ArkmeArrangementDetail>('arrangements.detail', { arrangementRef: props.arrangementRef }, signal), controller.signal)
      .then(value => {
        if (controller.signal.aborted) return
        if (value.arrangementRef !== props.arrangementRef && value.resolvedFromRef !== props.arrangementRef) throw new Error('安排引用已变化')
        setItem(value)
        if (value.arrangementRef !== props.arrangementRef) latest.current.onApplied(value)
      }).catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => controller.abort()
  }, [props.arrangementRef, attempt])
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = panel.current
    root?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !root) return
      // A portaled menu, source preview or nested settings dialog owns Escape first.
      if ([...document.querySelectorAll('[aria-modal="true"], [role="menu"], [data-arkme-image-preview-viewport]')]
        .some(layer => layer !== root && !layer.contains(root))) return
      event.preventDefault(); event.stopPropagation(); latest.current.onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (document.activeElement === document.body || root?.contains(document.activeElement)) {
        const target = previous?.isConnected ? previous : document.querySelector<HTMLElement>('.arkme-related-arrangements-refresh')
        target?.focus({ preventScroll: true })
      }
    }
  }, [])
  const current = props.latestItem && item && props.latestItem.arrangementRef === item.arrangementRef && props.latestItem.updatedAtMillis >= item.updatedAtMillis ? props.latestItem : item
  const close = () => { if (!settings && !deleting) props.onClose() }
  return createPortal(<div className="arkme-related-detail-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={tr('安排详情')}
      className="arkme-arrangement-workspace arkme-related-detail-dialog" onKeyDown={event => {
        if (event.key !== 'Tab' || event.defaultPrevented || settings || deleting) return
        const nodes = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),[tabindex="0"]') ?? [])]
          .filter(node => node.getClientRects().length > 0 && !node.closest('[hidden],[inert]'))
        const first = nodes[0], last = nodes.at(-1)
        if (!first) { event.preventDefault(); panel.current?.focus() }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus() }
      }}>
      {current ? <ArkmeArrangementDetailPane key={current.arrangementRef} item={current} accountScope={props.accountScope} readDetail={false}
        busy={props.busy} onClose={close} onSettings={() => setSettings(true)} onApplied={props.onApplied} onRedirect={props.onApplied}
        onComplete={async item => { await props.onComplete(item) }} onDelete={setDeleting} onReminder={async item => { await props.onReminder(item) }} />
        : <><header className="arkme-related-detail-loading-header"><h2>{tr('安排详情')}</h2><button type="button" aria-label={tr('关闭安排详情')} onClick={close}><X size={20} /></button></header>
          {error ? <p className="arkme-related-detail-loading" role="alert">{tr('详情加载失败')} <button type="button" onClick={() => setAttempt(n => n + 1)}>{tr('重试')}</button></p>
            : <p className="arkme-related-detail-loading" role="status">{tr('正在补充详情…')}</p>}</>}
      {props.notice}
      {settings && <ArkmeArrangementRecognitionSettings accountScope={props.accountScope} onClose={() => setSettings(false)} />}
      {deleting && <ArkmeConfirmDialog titleId="arkme-related-delete-title" title={tr('删除安排')} description={tr('将「{title}」移入已删除？', { title: deleting.title })}
        busy={props.busy} confirmLabel={tr('删除')} busyLabel={tr('正在删除…')} confirmTone="danger" onClose={() => setDeleting(undefined)}
        onConfirm={() => { void props.onDelete(deleting).then(done => { if (done) { setDeleting(undefined); props.onClose() } }) }} />}
    </section>
  </div>, document.body)
}
