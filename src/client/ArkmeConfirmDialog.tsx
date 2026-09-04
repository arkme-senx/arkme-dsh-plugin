import {
  useEffect, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { arkmeTheme } from './arkme-theme.js'

const styles = {
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 10_300, display: 'grid', placeItems: 'center', padding: 16,
    boxSizing: 'border-box', background: 'var(--dsw-alias-bg-mask-1, rgba(19, 22, 26, 0.34))',
    backdropFilter: 'var(--dsw-mask-blur, blur(2px))', WebkitBackdropFilter: 'var(--dsw-mask-blur, blur(2px))',
  },
  dialog: {
    width: 'min(420px, 100%)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', boxSizing: 'border-box',
    border: `1px solid ${arkmeTheme.border}`, borderRadius: 14, padding: 22,
    background: arkmeTheme.base, color: arkmeTheme.text, boxShadow: arkmeTheme.shadow,
  },
  title: { margin: 0, fontSize: 18, lineHeight: '25px', fontWeight: 650 },
  description: { margin: '10px 0 0', color: arkmeTheme.secondary, fontSize: 13, lineHeight: '21px' },
  preview: {
    margin: '16px 0 0', padding: '10px 12px', borderRadius: 10, background: arkmeTheme.layer1,
    color: arkmeTheme.secondary, fontSize: 12, lineHeight: '18px', overflow: 'hidden',
    whiteSpace: 'nowrap', textOverflow: 'ellipsis',
  },
  error: {
    marginTop: 12, padding: '9px 11px', borderRadius: 8, background: arkmeTheme.dangerSoft,
    color: arkmeTheme.danger, fontSize: 12, lineHeight: '18px',
  },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 },
  button: {
    minWidth: 82, height: 36, padding: '0 16px', border: `1px solid ${arkmeTheme.border}`,
    borderRadius: 9, background: arkmeTheme.elevated, color: arkmeTheme.text,
    cursor: 'pointer', font: 'inherit', fontSize: 13,
  },
  primary: { borderColor: 'transparent', background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction },
  danger: { borderColor: 'transparent', background: arkmeTheme.danger, color: arkmeTheme.onPrimaryAction },
  disabled: { cursor: 'not-allowed', opacity: .45 },
} satisfies Record<string, CSSProperties>

export function ArkmeConfirmDialogPreview({ children, title }: { children: ReactNode; title?: string }) {
  return <p style={styles.preview} title={title}>{children}</p>
}

export function ArkmeConfirmDialog(props: {
  titleId: string
  title: string
  description: ReactNode
  children?: ReactNode
  error?: string
  busy: boolean
  confirmLabel: string
  busyLabel: string
  confirmTone?: 'primary' | 'danger'
  onClose: () => void
  onConfirm: () => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement>()

  useEffect(() => {
    if (typeof document === 'undefined') return
    previousFocusRef.current = typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined
    cancelRef.current?.focus({ preventScroll: true })
    return () => {
      const previousFocus = previousFocusRef.current
      if (previousFocus?.isConnected === true) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || props.busy) return
      event.preventDefault()
      props.onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [props.busy, props.onClose])

  const trapFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab' || typeof document === 'undefined') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )
    if (focusable === undefined || focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  const dialog = <div style={styles.backdrop} role="presentation" data-arkme-confirm-dialog-backdrop="true" onMouseDown={event => {
    if (event.target === event.currentTarget && !props.busy) props.onClose()
  }}>
    <section
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={props.titleId}
      aria-busy={props.busy || undefined}
      data-arkme-confirm-dialog="true"
      style={styles.dialog}
      onKeyDown={trapFocus}
    >
      <h2 id={props.titleId} style={styles.title}>{props.title}</h2>
      <p style={styles.description}>{props.description}</p>
      {props.children}
      {props.error === undefined || props.error === '' ? null : <div role="alert" style={styles.error}>{props.error}</div>}
      <footer style={styles.footer}>
        <button ref={cancelRef} type="button" style={{ ...styles.button, ...(props.busy ? styles.disabled : {}) }} disabled={props.busy} onClick={props.onClose}>取消</button>
        <button
          type="button"
          style={{ ...styles.button, ...styles[props.confirmTone ?? 'primary'], ...(props.busy ? styles.disabled : {}) }}
          disabled={props.busy}
          onClick={props.onConfirm}
        >{props.busy ? props.busyLabel : props.confirmLabel}</button>
      </footer>
    </section>
  </div>
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}
