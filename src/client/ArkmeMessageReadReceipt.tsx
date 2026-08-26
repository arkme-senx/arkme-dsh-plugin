import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import type {
  ArkmeMessageReadReceiptDetail,
  ArkmeMessageReadReceiptSummary,
  ArkmeSourceItem,
  ArkmeTimelineItem,
} from '../types.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { arkmeTheme } from './arkme-theme.js'
import {
  arkmeMessageReadReceipts,
  type ArkmeMessageReadReceiptTarget,
} from './message-read-receipt-store.js'

const ACCESSORY_WIDTH = 18
const PANEL_WIDTH = 286
const PANEL_MAX_CONTENT_HEIGHT = 36 * 8
const PANEL_MAX_HEIGHT = PANEL_MAX_CONTENT_HEIGHT + 18
const PANEL_EDGE_INSET = 8
const PANEL_ANCHOR_GAP = 10

const styles: Record<string, CSSProperties> = {
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
  indicatorIcon: { position: 'absolute', inset: 0, width: 12, height: 12, opacity: 0.16 },
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
  if (value > yesterday) return '昨天'
  if (value > dayBeforeYesterday) return '前天'
  if (value > startOfWeek) return '本周'
  if (value > startOfLastWeek) return '上周'
  if (value > startOfMonth) return '本月'
  if (value > startOfLastMonth) return '上月'
  if (value > startOfYear) return `${month}/${day}`
  if (value > startOfLastYear) return `去年/${month}/${day}`
  if (value > startOfYearBeforeLast) return `前年/${month}/${day}`
  return `${value.getFullYear()}/${month}/${day}`
}

function summaryLabel(summary: ArkmeMessageReadReceiptSummary): string {
  return `已读 ${summary.readCount} / 未读 ${summary.unreadCount}`
}

function ReceiptCircle(props: { checked?: boolean; count?: number }) {
  const count = props.count === undefined ? undefined : Math.min(999, Math.max(0, props.count))
  return <span style={styles.indicator} data-arkme-read-receipt-indicator={props.checked === true ? 'all-read' : 'partial-read'}>
    <svg style={styles.indicatorIcon} viewBox="0 0 12 12" fill="none" aria-hidden>
      <circle cx="6" cy="6" r="5.4" stroke="currentColor" strokeWidth="1.2" />
      {props.checked === true && <path
        d="M5.17 7.15 8.37 4.1a.37.37 0 0 1 .52.5L5.43 7.9a.37.37 0 0 1-.52 0L3.1 6.18a.35.35 0 0 1 .52-.5l1.54 1.47Z"
        fill="currentColor"
      />}
    </svg>
    {count !== undefined && <span style={{ ...styles.indicatorCount, fontSize: count > 99 ? 4.5 : 7 }}>{count}</span>}
  </span>
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : '加载失败'
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
  anchor: HTMLButtonElement | null,
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
    return <span style={{ ...styles.arrowTop, left: props.arrowOffset }} aria-hidden>
      <span style={styles.triangleTopBorder} />
      <span style={styles.triangleTopFill} />
    </span>
  }
  return <span style={{ ...styles.arrowBottom, left: props.arrowOffset }} aria-hidden>
    <span style={styles.triangleBottomBorder} />
    <span style={styles.triangleBottomFill} />
  </span>
}

function ArkmeMessageReadReceiptDetailPanel(props: {
  anchor: HTMLButtonElement | null
  target: ArkmeMessageReadReceiptTarget
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState(() => detailPanelLayout(props.anchor))
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'ready'; detail: ArkmeMessageReadReceiptDetail } | { status: 'error'; message: string }
  >({ status: 'loading' })

  const load = useCallback((force = false) => {
    setState({ status: 'loading' })
    void arkmeMessageReadReceipts.detail(props.target, force)
      .then(detail => { setState({ status: 'ready', detail }) })
      .catch(error => { setState({ status: 'error', message: errorText(error) }) })
  }, [props.target])

  const reposition = useCallback(() => {
    const next = detailPanelLayout(props.anchor, panelRef.current)
    setLayout(current => current.left === next.left && current.top === next.top
      && current.arrowPlacement === next.arrowPlacement && current.arrowOffset === next.arrowOffset
      ? current
      : next)
  }, [props.anchor])

  useEffect(() => { load() }, [load])
  useLayoutEffect(() => { reposition() }, [reposition, state.status])
  useEffect(() => {
    const panel = panelRef.current
    if (panel === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(reposition)
    observer.observe(panel)
    return () => { observer.disconnect() }
  }, [reposition])
  useEffect(() => {
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node) || panelRef.current?.contains(target) === true || props.anchor?.contains(target) === true) return
      props.onClose()
    }
    const closeOnOutsideScroll = (event: Event) => {
      const target = event.target
      if (target instanceof Node && panelRef.current?.contains(target) === true) return
      props.onClose()
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') props.onClose() }
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', closeOnOutsideScroll, true)
    window.addEventListener('keydown', closeOnEscape)
    document.addEventListener('mousedown', closeOnOutside)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', closeOnOutsideScroll, true)
      window.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('mousedown', closeOnOutside)
    }
  }, [props.anchor, props.onClose])

  return createPortal(<div
    ref={panelRef}
    role="dialog"
    aria-label="群消息已读详情"
    data-arkme-read-receipt-panel-placement={layout.arrowPlacement === 'bottom' ? 'above' : 'below'}
    style={{ ...styles.panel, left: layout.left, top: layout.top }}
  >
    <PanelArrow arrowPlacement={layout.arrowPlacement} arrowOffset={layout.arrowOffset} />
    <div style={styles.panelSurface}>
      <div style={styles.panelBody}>
        {state.status === 'loading' && <div role="status" style={styles.panelState}>加载中...</div>}
        {state.status === 'error' && <button
          type="button" role="alert" title={state.message} style={{ ...styles.panelState, ...styles.panelRetry }}
          onClick={() => { load(true) }}
        >加载失败</button>}
        {state.status === 'ready' && state.detail.items.length === 0 && <div style={styles.panelState}>暂无更多人员信息</div>}
        {state.status === 'ready' && state.detail.items.map(member => {
          const isRead = member.readStatus === 'read'
            && member.readAtMillis !== undefined && Number.isFinite(member.readAtMillis) && member.readAtMillis > 0
          return <div key={member.memberRef} style={styles.member}>
            <span style={{ ...styles.memberIdentity, opacity: isRead ? 1 : 0.5 }}>
              <ArkmeUserAvatar
                {...(member.avatarRef === undefined ? {} : { avatarRef: member.avatarRef })}
                size={20}
                label={`${member.displayName} 的头像`}
              />
              <span style={styles.memberName}>{member.displayName}</span>
            </span>
            {isRead
              ? <span style={styles.memberStatus}>{readAtLabel(member.readAtMillis as number)}</span>
              : <span style={styles.memberUnreadDot} aria-label="未读" />}
          </div>
        })}
      </div>
    </div>
  </div>, document.body)
}

export function ArkmeMessageReadReceipt(props: {
  source: ArkmeSourceItem
  item: ArkmeTimelineItem
}) {
  const hostRef = useRef<HTMLSpanElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const target = useMemo<ArkmeMessageReadReceiptTarget | undefined>(() => {
    if (!props.item.isMe || props.item.sequence === undefined || props.item.sequence <= 0
      || (props.source.kind !== 'private_chat' && props.source.kind !== 'group_chat')) return undefined
    return {
      sourceRef: props.source.sourceRef,
      sourceKey: props.source.sourceKey ?? props.source.sourceRef,
      conversationKind: props.source.kind,
      itemUid: props.item.itemUid,
      sequence: props.item.sequence,
    }
  }, [props.item.isMe, props.item.itemUid, props.item.sequence, props.source.kind, props.source.sourceKey, props.source.sourceRef])
  useSyncExternalStore(
    arkmeMessageReadReceipts.subscribe,
    arkmeMessageReadReceipts.getSnapshot,
    arkmeMessageReadReceipts.getSnapshot,
  )

  useEffect(() => {
    if (target === undefined) return
    const unregister = arkmeMessageReadReceipts.register(target)
    const element = hostRef.current
    if (element === null || typeof IntersectionObserver === 'undefined') {
      arkmeMessageReadReceipts.setVisible(target, true)
      return () => {
        arkmeMessageReadReceipts.setVisible(target, false)
        unregister()
      }
    }
    const observer = new IntersectionObserver(entries => {
      const visible = entries.some(entry => entry.target === element && entry.isIntersecting)
      arkmeMessageReadReceipts.setVisible(target, visible)
    }, { rootMargin: '120px 0px' })
    observer.observe(element)
    return () => {
      observer.disconnect()
      arkmeMessageReadReceipts.setVisible(target, false)
      unregister()
    }
  }, [target])

  if (target === undefined) return null
  const entry = arkmeMessageReadReceipts.get(target)
  const summary = entry?.summary
  const hasTruth = summary !== undefined && summary.totalMemberCount > 0
  const canOpen = hasTruth && target.conversationKind === 'group_chat'
  const isFailure = entry?.status === 'error' && summary === undefined
  const isProvisional = entry?.status === 'provisional'
  let indicator: JSX.Element
  let label: string
  if (isFailure) {
    indicator = <span style={styles.failureDot} data-arkme-read-receipt-indicator="error" />
    label = '已读状态同步失败，点击重试'
  } else if (isProvisional || (hasTruth && summary.readCount <= 0 && summary.unreadCount > 0)) {
    indicator = <span style={styles.unreadDot} data-arkme-read-receipt-indicator="unread" />
    label = '未读'
  } else if (hasTruth && summary.unreadCount <= 0 && summary.readCount > 0) {
    indicator = <ReceiptCircle checked />
    label = target.conversationKind === 'group_chat' ? summaryLabel(summary) : '已读'
  } else if (hasTruth && summary.readCount > 0) {
    indicator = <ReceiptCircle count={summary.readCount} />
    label = summaryLabel(summary)
  } else {
    indicator = <span style={styles.placeholder} data-arkme-read-receipt-indicator="placeholder" />
    label = '已读状态同步中'
  }

  const content = canOpen || isFailure
    ? <button
        ref={buttonRef}
        type="button"
        style={{ ...styles.status, ...styles.interactive }}
        aria-label={canOpen ? `${label}，查看成员已读详情` : label}
        onClick={() => {
          if (isFailure) {
            arkmeMessageReadReceipts.retry(target)
            return
          }
          setDetailOpen(current => !current)
        }}
      >{indicator}</button>
    : <span style={styles.status} aria-label={label}>{indicator}</span>

  return <span ref={hostRef} style={styles.root} data-arkme-read-receipt={entry?.status ?? 'unknown'}>
    {content}
    {detailOpen && canOpen && <ArkmeMessageReadReceiptDetailPanel
      anchor={buttonRef.current}
      target={target}
      onClose={() => { setDetailOpen(false) }}
    />}
  </span>
}

export function ArkmeMessageReadReceiptLine(props: {
  source: ArkmeSourceItem
  item: ArkmeTimelineItem
  wide?: boolean
  children: ReactNode
}) {
  return <div
    data-arkme-message-content-line={props.item.itemUid}
    style={{
      maxWidth: '100%', minWidth: 0, display: 'flex', alignItems: 'flex-end',
      // A self-message body may occupy the full available width for long content.
      // Keep its bubble/receipt pair pinned to the right edge in that case.
      justifyContent: props.item.isMe ? 'flex-end' : 'flex-start',
      ...(props.wide === true ? { width: '100%' } : {}),
    }}
  >
    {props.item.isMe && <ArkmeMessageReadReceipt source={props.source} item={props.item} />}
    {props.children}
  </div>
}
