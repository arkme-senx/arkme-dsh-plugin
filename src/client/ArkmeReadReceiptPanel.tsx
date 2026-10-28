import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { tr } from './locale.js'
import { arkmeTheme } from './arkme-theme.js'

const ACCESSORY_WIDTH = 18
const PANEL_WIDTH = 286
const PANEL_MAX_CONTENT_HEIGHT = 36 * 8
const PANEL_MAX_HEIGHT = PANEL_MAX_CONTENT_HEIGHT + 18
const PANEL_EDGE_INSET = 8
const PANEL_ANCHOR_GAP = 10

export const readReceiptStyles: Record<string, CSSProperties> = {
  root: {
    width: ACCESSORY_WIDTH, minWidth: ACCESSORY_WIDTH, height: 40, alignSelf: 'flex-end', flex: 'none',
    position: 'relative', display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end',
    boxSizing: 'border-box', color: arkmeTheme.text,
  },
  status: {
    width: ACCESSORY_WIDTH, height: 40, padding: '0 6px 0 0', border: 0,
    display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
    boxSizing: 'border-box', background: 'transparent', color: arkmeTheme.text,
    font: 'inherit', lineHeight: 1,
  },
  interactive: { cursor: 'pointer' },
  placeholder: { width: 6, height: 6, flex: 'none' },
  unreadDot: {
    width: 6, height: 6, borderRadius: 999, background: arkmeTheme.info, opacity: 0.4, flex: 'none',
  },
  failureDot: {
    width: 6, height: 6, borderRadius: 999, border: `1px solid ${arkmeTheme.caption}`,
    boxSizing: 'border-box', flex: 'none',
  },
  indicator: {
    position: 'relative', width: 12, height: 12, display: 'grid', placeItems: 'center', flex: 'none',
  },
  indicatorIcon: { position: 'absolute', inset: 0 },
  indicatorCount: {
    position: 'relative', zIndex: 1, color: arkmeTheme.text, opacity: 0.16,
    fontSize: 7, lineHeight: '12px', letterSpacing: 0, textAlign: 'center',
  },
  panel: {
    position: 'fixed', zIndex: 1200, width: PANEL_WIDTH,
  },
  panelSurface: {
    width: PANEL_WIDTH, maxHeight: `min(${String(PANEL_MAX_HEIGHT)}px, calc(100vh - 16px))`,
    padding: '8px 0', overflow: 'hidden', boxSizing: 'border-box',
    border: `1px solid ${arkmeTheme.border}`, borderRadius: 12, background: arkmeTheme.base,
    boxShadow: '0 4px 10px rgba(0,0,0,.10)', color: arkmeTheme.text,
  },
  panelBody: {
    maxHeight: `min(${String(PANEL_MAX_CONTENT_HEIGHT)}px, calc(100vh - 34px))`, overflowY: 'auto',
  },
  panelState: {
    width: '100%', height: 36, padding: '0 14px', border: 0, boxSizing: 'border-box',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', color: arkmeTheme.text, textAlign: 'center', fontSize: 14, lineHeight: 1.2,
  },
  panelRetry: { cursor: 'pointer' },
  member: {
    minHeight: 36, padding: '7px 14px', boxSizing: 'border-box', display: 'flex', alignItems: 'center',
  },
  memberIdentity: {
    flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 4,
  },
  memberName: {
    flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    fontSize: 14, lineHeight: '22px', color: arkmeTheme.text,
  },
  memberStatus: {
    maxWidth: 84, marginLeft: 8, flex: 'none', overflow: 'hidden', textOverflow: 'ellipsis',
    whiteSpace: 'nowrap', color: arkmeTheme.secondary, fontSize: 12, lineHeight: 1.2, textAlign: 'right',
  },
  memberUnreadDot: {
    width: 6, height: 6, marginLeft: 8, borderRadius: 999, background: arkmeTheme.info,
    opacity: 0.4, flex: 'none',
  },
  arrowTop: {
    position: 'absolute', top: -8, width: 16, height: 8, pointerEvents: 'none',
  },
  arrowBottom: {
    position: 'absolute', bottom: -8, width: 16, height: 8, pointerEvents: 'none',
  },
  triangleTopBorder: {
    position: 'absolute', inset: 0, width: 0, height: 0,
    borderLeft: '8px solid transparent', borderRight: '8px solid transparent',
    borderBottom: `8px solid ${arkmeTheme.border}`,
  },
  triangleTopFill: {
    position: 'absolute', top: 1, left: 0, width: 0, height: 0,
    borderLeft: '8px solid transparent', borderRight: '8px solid transparent',
    borderBottom: `8px solid ${arkmeTheme.base}`,
  },
  triangleBottomBorder: {
    position: 'absolute', inset: 0, width: 0, height: 0,
    borderLeft: '8px solid transparent', borderRight: '8px solid transparent',
    borderTop: `8px solid ${arkmeTheme.border}`,
  },
  triangleBottomFill: {
    position: 'absolute', top: -1, left: 0, width: 0, height: 0,
    borderLeft: '8px solid transparent', borderRight: '8px solid transparent',
    borderTop: `8px solid ${arkmeTheme.base}`,
  },
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function readAtLabel(milliseconds: number): string {
  const value = new Date(milliseconds)
  const now = new Date()
  const today = startOfDay(now)
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  const dayBeforeYesterday = new Date(today); dayBeforeYesterday.setDate(today.getDate() - 2)
  const startOfWeek = new Date(today); startOfWeek.setDate(today.getDate() - ((now.getDay() + 6) % 7))
  const startOfLastWeek = new Date(startOfWeek); startOfLastWeek.setDate(startOfWeek.getDate() - 7)
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  const startOfLastYear = new Date(now.getFullYear() - 1, 0, 1)
  const startOfYearBeforeLast = new Date(now.getFullYear() - 2, 0, 1)
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  if (value > today) return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
  if (value > yesterday) return tr("昨天")
  if (value > dayBeforeYesterday) return tr("前天")
  if (value > startOfWeek) return tr("本周")
  if (value > startOfLastWeek) return tr("上周")
  if (value > startOfMonth) return tr("本月")
  if (value > startOfLastMonth) return tr("上月")
  if (value > startOfYear) return `${month}/${day}`
  if (value > startOfLastYear) return `去年/${month}/${day}`
  if (value > startOfYearBeforeLast) return `前年/${month}/${day}`
  return `${value.getFullYear()}/${month}/${day}`
}

interface DetailPanelLayout {
  left: number
  top: number
  arrowPlacement: 'top' | 'bottom'
  arrowOffset: number
}

export function arkmeMessageReadReceiptPanelLayout(
  rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'> | undefined,
  viewport: { width: number; height: number },
  measuredPanelHeight = PANEL_MAX_HEIGHT,
): DetailPanelLayout {
  if (rect === undefined) {
    return { left: 12, top: 12, arrowPlacement: 'top', arrowOffset: PANEL_WIDTH - 26 }
  }
  const viewportWidth = Number.isFinite(viewport.width) ? Math.max(0, viewport.width) : 0
  const viewportHeight = Number.isFinite(viewport.height) ? Math.max(0, viewport.height) : 0
  const panelHeight = Number.isFinite(measuredPanelHeight)
    ? Math.max(1, Math.min(PANEL_MAX_HEIGHT, measuredPanelHeight))
    : PANEL_MAX_HEIGHT
  const maxLeft = Math.max(PANEL_EDGE_INSET, viewportWidth - PANEL_WIDTH - PANEL_EDGE_INSET)
  const left = Math.max(PANEL_EDGE_INSET, Math.min(maxLeft, rect.right - PANEL_WIDTH))
  const maxTop = Math.max(PANEL_EDGE_INSET, viewportHeight - panelHeight - PANEL_EDGE_INSET)
  const belowTop = rect.bottom + PANEL_ANCHOR_GAP
  const aboveTop = rect.top - panelHeight - PANEL_ANCHOR_GAP
  const fitsBelow = belowTop <= maxTop
  const fitsAbove = aboveTop >= PANEL_EDGE_INSET
  const placeBelow = fitsBelow || (!fitsAbove
    && viewportHeight - rect.bottom >= rect.top)
  const top = Math.max(
    PANEL_EDGE_INSET,
    Math.min(maxTop, placeBelow ? belowTop : aboveTop),
  )
  return {
    left,
    top,
    arrowPlacement: placeBelow ? 'top' : 'bottom',
    arrowOffset: Math.max(10, Math.min(PANEL_WIDTH - 26, rect.left + rect.width / 2 - left - 8)),
  }
}

function detailPanelLayout(
  anchor: HTMLElement | null,
  panel: HTMLDivElement | null = null,
): DetailPanelLayout {
  return arkmeMessageReadReceiptPanelLayout(
    anchor?.getBoundingClientRect(),
    { width: window.innerWidth, height: window.innerHeight },
    panel?.getBoundingClientRect().height ?? PANEL_MAX_HEIGHT,
  )
}

function PanelArrow(props: Pick<DetailPanelLayout, 'arrowPlacement' | 'arrowOffset'>) {
  if (props.arrowPlacement === 'top') {
    return <span style={{ ...readReceiptStyles.arrowTop, left: props.arrowOffset }} aria-hidden>
      <span style={readReceiptStyles.triangleTopBorder} />
      <span style={readReceiptStyles.triangleTopFill} />
    </span>
  }
  return <span style={{ ...readReceiptStyles.arrowBottom, left: props.arrowOffset }} aria-hidden>
    <span style={readReceiptStyles.triangleBottomBorder} />
    <span style={readReceiptStyles.triangleBottomFill} />
  </span>
}


/** Shared receipt presentation; callers retain their business authority and loading. */
export function ArkmeReadReceiptPanel({ anchor, label, children, onClose }: {
  anchor: HTMLElement | null; label: string; children: ReactNode; onClose(): void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState(() => detailPanelLayout(anchor))
  const reposition = useCallback(() => {
    const next = detailPanelLayout(anchor, panelRef.current)
    setLayout(current => current.left === next.left && current.top === next.top
      && current.arrowPlacement === next.arrowPlacement && current.arrowOffset === next.arrowOffset ? current : next)
  }, [anchor])
  useLayoutEffect(() => { reposition() }, [reposition, children])
  useEffect(() => {
    const panel = panelRef.current
    if (!panel || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(reposition); observer.observe(panel)
    return () => { observer.disconnect() }
  }, [reposition])
  useEffect(() => {
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node) || panelRef.current?.contains(target) || anchor?.contains(target)) return
      onClose()
    }
    const closeOnScroll = (event: Event) => { if (!(event.target instanceof Node) || !panelRef.current?.contains(event.target)) onClose() }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', closeOnScroll, true)
    window.addEventListener('keydown', closeOnEscape)
    document.addEventListener('mousedown', closeOnOutside)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', closeOnScroll, true)
      window.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('mousedown', closeOnOutside)
    }
  }, [anchor, onClose, reposition])
  return createPortal(<div ref={panelRef} role="dialog" aria-label={label}
    data-arkme-read-receipt-panel-placement={layout.arrowPlacement === 'bottom' ? 'above' : 'below'}
    style={{ ...readReceiptStyles.panel, left: layout.left, top: layout.top }}>
    <PanelArrow arrowPlacement={layout.arrowPlacement} arrowOffset={layout.arrowOffset} />
    <div style={readReceiptStyles.panelSurface}><div style={readReceiptStyles.panelBody}>{children}</div></div>
  </div>, document.body)
}

export function ArkmeReadReceiptMember({ name, avatar, read, readAt }: {
  name: string; avatar: ReactNode; read: boolean; readAt?: number | undefined
}) {
  return <div style={readReceiptStyles.member}>
    <span style={{ ...readReceiptStyles.memberIdentity, opacity: read ? 1 : 0.5 }}>
      {avatar}<span style={readReceiptStyles.memberName}>{name}</span>
    </span>
    {read ? <span style={readReceiptStyles.memberStatus}>{readAt && readAt > 0 ? readAtLabel(readAt) : tr('已读')}</span>
      : <span style={readReceiptStyles.memberUnreadDot} aria-label={tr('未读')} />}
  </div>
}

export function ArkmeReadReceiptStatus({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return onClick ? <button type="button" style={{ ...readReceiptStyles.panelState, ...readReceiptStyles.panelRetry }} onClick={onClick}>{children}</button>
    : <div style={readReceiptStyles.panelState}>{children}</div>
}
