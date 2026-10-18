import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { tr, useArkmeLocale } from '../../locale.js'

/** Shared focus, dismissal and sizing for the Team feature dialogs. */
export function TeamFeatureDialog({ title, teamName, className = '', children, footer, onClose }: {
  title: string; teamName: string; className?: string; children: ReactNode; footer?: ReactNode; onClose(): void
}) {
  useArkmeLocale()
  const titleId = useId()
  const dialog = useRef<HTMLElement>(null)
  useEffect(() => {
    if (typeof document === 'undefined') return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const focusDialog = () => dialog.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    focusDialog()
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.current?.contains(event.target)) focusDialog()
    }
    document.addEventListener('focusin', containFocus)
    return () => {
      document.removeEventListener('focusin', containFocus)
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  const keyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab' || typeof document === 'undefined') return
    const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary, [tabindex]') ?? [])]
      .filter(control => {
        if (control.tabIndex < 0 || control.matches(':disabled') || control.closest('[hidden], [inert]')) return false
        const closedDetails = control.closest('details:not([open])')
        if (closedDetails && control !== closedDetails.querySelector('summary')) return false
        const style = getComputedStyle(control)
        return style.display !== 'none' && style.visibility !== 'hidden'
      })
    const first = controls[0], last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }

  const content = <div className="arkme-contact-remark-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialog} className={`arkme-contact-remark-dialog arkme-team-sync-dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={keyDown}>
      <header className="arkme-contact-remark-header">
        <h2 id={titleId}>{title} <span>· {teamName}</span></h2>
        <button type="button" className="arkme-contact-remark-close" aria-label={tr('关闭')} onClick={onClose}>×</button>
      </header>
      <div className="arkme-team-sync-body">{children}</div>
      {footer && <footer className="arkme-team-sync-footer">{footer}</footer>}
    </section>
  </div>
  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}
