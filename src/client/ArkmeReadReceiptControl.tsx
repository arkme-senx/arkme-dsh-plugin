import type { CSSProperties, ReactNode, Ref } from 'react'
import { ArkmeReadReceiptIcon } from './ArkmeReadReceiptIcon.js'
import { readReceiptStyles as styles } from './ArkmeReadReceiptPanel.js'

export const readReceiptLineStyle: CSSProperties = {
  maxWidth: '100%', minWidth: 0, display: 'flex', alignItems: 'flex-end',
}

/** Shared accessory geometry and interaction; receipt truth belongs to the caller. */
export function ArkmeReadReceiptControl({ state, status, count, label, onClick, onEscape, hostRef, buttonRef, children, placement = 'before' }: {
  state: 'unread' | 'all-read' | 'partial-read' | 'error' | 'placeholder'
  status?: string; count?: number; label: string; onClick?: () => void; onEscape?: () => void
  placement?: 'before' | 'after'
  hostRef?: Ref<HTMLSpanElement>; buttonRef?: Ref<HTMLButtonElement>; children?: ReactNode
}) {
  const boundedCount = count === undefined ? undefined : Math.min(999, Math.max(0, count))
  const statusStyle: CSSProperties = { ...styles.status, ...(placement === 'after' ? { padding: '0 0 0 6px', justifyContent: 'flex-start' } : {}) }
  const indicator = state === 'all-read' || state === 'partial-read'
    ? <span style={styles.indicator} data-arkme-read-receipt-indicator={state}>
        <ArkmeReadReceiptIcon checked={state === 'all-read'} style={styles.indicatorIcon} />
        {boundedCount !== undefined && <span style={{ ...styles.indicatorCount, fontSize: boundedCount > 99 ? 4.5 : 7 }}>{boundedCount}</span>}
      </span>
    : <span style={state === 'unread' ? styles.unreadDot : state === 'error' ? styles.failureDot : styles.placeholder} data-arkme-read-receipt-indicator={state} />
  return <span ref={hostRef} style={styles.root} data-arkme-read-receipt={status}>
    {onClick ? <button ref={buttonRef} type="button" style={{ ...statusStyle, ...styles.interactive }} aria-label={label}
      onClick={onClick} onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing && onEscape) { event.stopPropagation(); onEscape() } }}
    >{indicator}</button> : <span style={statusStyle} aria-label={label}>{indicator}</span>}
    {children}
  </span>
}
