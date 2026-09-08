import { useEffect, useId, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ArkmeSourceItem } from '../../../types.js'
import { ArkmeContactAddSurface } from '../../ArkmeContactAddSurface.js'
import { arkmeTheme } from '../../arkme-theme.js'

const styles: Record<string, CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 1000, padding: 16, boxSizing: 'border-box',
    display: 'grid', placeItems: 'center',
    background: 'var(--dsw-alias-bg-mask-1, rgba(19, 22, 26, 0.34))',
    backdropFilter: 'var(--dsw-mask-blur, blur(2px))', WebkitBackdropFilter: 'var(--dsw-mask-blur, blur(2px))',
  },
  dialog: {
    width: 'min(620px, 100%)', height: 'min(620px, calc(100% - 4px))', minHeight: 0,
    display: 'flex', flexDirection: 'column', overflow: 'hidden', border: `1px solid ${arkmeTheme.border}`,
    borderRadius: 14, background: arkmeTheme.base, boxShadow: '0 22px 64px rgba(20, 23, 31, .22)',
  },
  header: {
    height: 58, minHeight: 58, padding: '0 16px 0 20px', boxSizing: 'border-box', display: 'flex',
    alignItems: 'center', borderBottom: `1px solid ${arkmeTheme.border}`, background: arkmeTheme.base,
  },
  title: { flex: 1, minWidth: 0, margin: 0, color: arkmeTheme.text, fontSize: 18, lineHeight: '24px', fontWeight: 600 },
  close: {
    width: 32, height: 32, padding: 0, border: 0, borderRadius: 8, background: 'transparent',
    color: arkmeTheme.secondary, cursor: 'pointer', fontSize: 25, lineHeight: 1,
  },
  body: { flex: 1, minHeight: 0, overflow: 'auto' },
}

/** A Contacts-owned overlay: opening it must not replace the current product route. */
export function ContactDirectoryAddDialog({ shareWebsite, onClose, onAdded }: {
  shareWebsite: string
  onClose(): void
  onAdded(source: ArkmeSourceItem): void
}) {
  const id = useId()
  const dialogRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement : undefined
    dialogRef.current?.querySelector<HTMLInputElement>('input:not([type="file"])')?.focus({ preventScroll: true })
    return () => { if (previous?.isConnected === true) previous.focus({ preventScroll: true }) }
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
    if (event.key !== 'Tab' || typeof document === 'undefined') return
    const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]):not([type="file"]), [tabindex="0"]')
    const focusable = Array.from(nodes ?? []).filter(node => node.getClientRects().length > 0)
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (first === undefined) { event.preventDefault(); return }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  const dialog = <div style={styles.backdrop} role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose()
  }}>
    <section ref={dialogRef} style={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onKeyDown={onKeyDown}>
      <header style={styles.header}>
        <h2 id={`${id}-title`} style={styles.title}>添加联系人</h2>
        <button type="button" style={styles.close} aria-label="关闭添加联系人" onClick={onClose}>×</button>
      </header>
      <div style={styles.body}>
        <ArkmeContactAddSurface compact shareWebsite={shareWebsite} submitLabel="添加联系人" onSourceActivated={onAdded} />
      </div>
    </section>
  </div>
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}
