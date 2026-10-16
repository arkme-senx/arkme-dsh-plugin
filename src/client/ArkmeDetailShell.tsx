import { ArkmeRightPanelHeader } from './ArkmeRightPanelHeader.js'
import { useEffect, useId, useRef, type CSSProperties, type ReactNode, type Ref, type RefObject } from 'react'
import { ArkmeRichText } from './ArkmeRichText.js'
import { arkmeTheme } from './arkme-theme.js'
import { ARKME_CONVERSATION_HEADER_HEIGHT } from './arkme-layout.js'
import { useResizableNoteDetail } from './use-resizable-note-detail.js'

export interface ArkmeDetailShellProps {
  title: string
  /** Retain view state while releasing focus and resize ownership when closed. */
  open?: boolean
  className?: string
  style?: CSSProperties
  bodyStyle?: CSSProperties
  closeLabel?: string
  widthPreferenceKey?: string
  label: string
  headerContent?: ReactNode
  subtitle?: string
  footer?: ReactNode
  /** Hide a subview's editor without discarding its draft or staged attachments. */
  footerHidden?: boolean
  onClose: () => void
  /** Opt in to outside-pointer dismissal without blocking the underlying control. */
  onPointerDownOutside?: (event: PointerEvent) => void
  children: ReactNode
  onBack?: () => void
  backLabel?: string
  bodyRef?: Ref<HTMLDivElement>
  returnFocusRef?: RefObject<HTMLElement>
  resizeLabel?: string
}

const styles: Record<string, CSSProperties> = {
  drawer: { position: 'absolute', top: ARKME_CONVERSATION_HEADER_HEIGHT, right: 0, bottom: 0, zIndex: 10,
    width: 'min(372px, 100%)', minWidth: 0, boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
    background: arkmeTheme.base, color: arkmeTheme.text, borderLeft: `1px solid ${arkmeTheme.borderSoft}`,
    boxShadow: '-12px 0 28px rgba(29,32,40,.055)' },
  body: { flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', padding: '24px 22px' },
  footer: { flex: 'none', textAlign: 'center', padding: '12px 22px 20px', color: arkmeTheme.tertiary, fontSize: 11, lineHeight: '18px' },
  extensionFooter: { flex: 'none', padding: 0, color: arkmeTheme.tertiary, fontSize: 11, lineHeight: '18px' },
}

/** Non-modal overlay: the conversation retains its width and scroll position. */
export function ArkmeDetailShell({ open = true, className, style, bodyStyle, closeLabel, widthPreferenceKey, title, label, headerContent, subtitle, footer, footerHidden = false, onClose, onPointerDownOutside, onBack, backLabel, bodyRef, children, resizeLabel, returnFocusRef }: ArkmeDetailShellProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const resize = useResizableNoteDetail(panelRef, widthPreferenceKey, resizeLabel, undefined, open)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const outsideRef = useRef(onPointerDownOutside)
  outsideRef.current = onPointerDownOutside
  const listensOutside = onPointerDownOutside !== undefined
  useEffect(() => {
    if (!open || !listensOutside) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Node) || panelRef.current?.contains(event.target)) return
      outsideRef.current?.(event)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open, listensOutside])
  const titleId = useId()
  useEffect(() => {
    if (!open) return
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    ;(onBack === undefined ? closeRef.current : backRef.current)?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      // A portal preview owns Escape until it is closed; do not close both layers.
      if (event.key !== 'Escape' || event.defaultPrevented
        || Array.from(document.querySelectorAll('[data-arkme-image-preview-viewport], [aria-modal="true"], [role="menu"]'))
          .some(overlay => !overlay.contains(panelRef.current))) return
      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current()
    }
    const panel = panelRef.current
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const active = document.activeElement
      const target = returnFocusRef === undefined ? trigger : returnFocusRef.current
      if (target?.isConnected && (active === document.body || active === null || panel?.contains(active))) target.focus({ preventScroll: true })
    }
  }, [open])
  const hasBack = onBack !== undefined
  useEffect(() => {
    if (!open) return
    if (hasBack) backRef.current?.focus({ preventScroll: true })
    else if (document.activeElement === document.body) closeRef.current?.focus({ preventScroll: true })
  }, [hasBack, open])
  return <aside ref={panelRef} hidden={!open} className={className} role="dialog" aria-label={label} aria-labelledby={headerContent === undefined ? titleId : undefined} style={{ ...styles.drawer, ...style, ...resize.style, ...(!open ? { display: 'none' } : {}) }} data-arkme-note-detail="true">
    {resize.handle}
    <ArkmeRightPanelHeader title={<ArkmeRichText text={title} presentation="preview" />} titleId={titleId} heading={headerContent}
      subtitle={subtitle} onClose={onClose} {...(closeLabel ? { closeLabel } : {})} closeRef={closeRef} onBack={onBack} backLabel={backLabel} backRef={backRef} />
    <div ref={bodyRef} style={{ ...styles.body, ...bodyStyle }}>{children}</div>
    {footer !== undefined && footer !== null && <footer hidden={footerHidden} style={typeof footer === 'string' ? styles.footer : styles.extensionFooter}>{footer}</footer>}
  </aside>
}
