import {
  Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { XIcon } from '@phosphor-icons/react/dist/csr/X'
import type {
  ArkmeConversationMemberItem,
  ArkmeConversationMemberRecordMode,
  ArkmeConversationMemberRecordPage,
  ArkmeGroupAvatarFallback,
  ArkmeSourceItem,
  ArkmeTimelineItem,
} from '../types.js'
import { callArkme } from './api.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmeMessageContent } from './ArkmeRichContent.js'
import { arkmeTheme } from './arkme-theme.js'
import { useArkmeAvatarImage } from './use-arkme-avatar-image.js'

const MENU_WIDTH = 188
const MENU_ROW_HEIGHT = 44
const MENU_EDGE_PADDING = 8
const MENU_ANCHOR_GAP = 4
const RECORD_TIME_GAP_MILLIS = 30 * 60 * 1000
export const ARKME_MEMBER_RECORDS_DEFAULT_WIDTH = 428
export const ARKME_MEMBER_RECORDS_RESIZE_HANDLE_WIDTH = 10
export const ARKME_MEMBER_RECORDS_RESIZE_INDICATOR_WIDTH = 3
export const ARKME_MEMBER_RECORDS_MAX_WIDTH_FACTOR = 0.6
export const ARKME_MEMBER_RECORD_OTHER_BUBBLE = arkmeTheme.memberRecordOther
export const ARKME_MEMBER_RECORDS_LOAD_MORE_THRESHOLD = 120
const MEMBER_RECORDS_WIDTH_STORAGE_KEY = 'arkme.member-records-sidebar-width.v1'
let cachedMemberRecordsWidth: number | undefined

export function shouldLoadOlderArkmeMemberRecords(
  scrollTop: number,
  hasMore: boolean,
  cursor: number | undefined,
  loading: boolean,
): boolean {
  return hasMore && cursor !== undefined && !loading
    && Number.isFinite(scrollTop) && scrollTop <= ARKME_MEMBER_RECORDS_LOAD_MORE_THRESHOLD
}

export function retainArkmeMemberRecordsScrollTop(
  previousScrollTop: number,
  previousScrollHeight: number,
  currentScrollHeight: number,
): number {
  return Math.max(0, previousScrollTop + currentScrollHeight - previousScrollHeight)
}

export function clampArkmeMemberRecordsWidth(preferredWidth: number, availableWidth: number): number {
  const available = Number.isFinite(availableWidth) ? Math.max(0, availableWidth) : 0
  if (available === 0) return 0
  if (available < ARKME_MEMBER_RECORDS_DEFAULT_WIDTH) return available
  const maximum = Math.min(
    available,
    Math.max(ARKME_MEMBER_RECORDS_DEFAULT_WIDTH, available * ARKME_MEMBER_RECORDS_MAX_WIDTH_FACTOR),
  )
  const preferred = Number.isFinite(preferredWidth) && preferredWidth > 0
    ? preferredWidth
    : ARKME_MEMBER_RECORDS_DEFAULT_WIDTH
  return Math.min(maximum, Math.max(ARKME_MEMBER_RECORDS_DEFAULT_WIDTH, preferred))
}

function readPreferredMemberRecordsWidth(): number {
  if (cachedMemberRecordsWidth !== undefined) return cachedMemberRecordsWidth
  if (typeof window === 'undefined') return ARKME_MEMBER_RECORDS_DEFAULT_WIDTH
  try {
    const stored = Number(window.localStorage.getItem(MEMBER_RECORDS_WIDTH_STORAGE_KEY))
    cachedMemberRecordsWidth = Number.isFinite(stored) && stored > 0
      ? stored
      : ARKME_MEMBER_RECORDS_DEFAULT_WIDTH
  } catch {
    cachedMemberRecordsWidth = ARKME_MEMBER_RECORDS_DEFAULT_WIDTH
  }
  return cachedMemberRecordsWidth
}

export function arkmeMemberConversationAction(
  member: Pick<ArkmeConversationMemberItem, 'isSelf'>,
): 'send_to_self' | 'private_chat' {
  return member.isSelf ? 'send_to_self' : 'private_chat'
}

function persistPreferredMemberRecordsWidth(width: number): void {
  if (!Number.isFinite(width) || width <= 0) return
  cachedMemberRecordsWidth = width
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(MEMBER_RECORDS_WIDTH_STORAGE_KEY, String(width))
  } catch {
    // Local storage is best-effort; an unavailable store must not block the drawer.
  }
}

export interface ArkmeMemberMenuPosition {
  left: number
  top: number
  placement: 'above' | 'below'
}

export function positionArkmeMemberMenu(
  anchorRect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
  hostRect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  rowCount: number,
): ArkmeMemberMenuPosition {
  const height = Math.max(1, rowCount) * MENU_ROW_HEIGHT
  const preferredLeft = anchorRect.left - hostRect.left
  const left = Math.max(
    MENU_EDGE_PADDING,
    Math.min(hostRect.width - MENU_WIDTH - MENU_EDGE_PADDING, preferredLeft),
  )
  const below = anchorRect.bottom - hostRect.top + MENU_ANCHOR_GAP
  const above = anchorRect.top - hostRect.top - height - MENU_ANCHOR_GAP
  if (below + height <= hostRect.height - MENU_EDGE_PADDING || above < MENU_EDGE_PADDING) {
    return {
      left,
      top: Math.max(MENU_EDGE_PADDING, Math.min(hostRect.height - height - MENU_EDGE_PADDING, below)),
      placement: 'below',
    }
  }
  return {
    left,
    top: Math.max(MENU_EDGE_PADDING, above),
    placement: 'above',
  }
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

const styles: Record<string, CSSProperties> = {
  menu: {
    position: 'absolute', zIndex: 42, width: MENU_WIDTH, overflow: 'hidden', boxSizing: 'border-box',
    border: `1px solid ${arkmeTheme.border}`, borderRadius: 12,
    background: arkmeTheme.menu,
    backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
    boxShadow: '0 12px 34px rgba(24, 29, 36, .16)',
  },
  menuRow: {
    width: '100%', height: MENU_ROW_HEIGHT, padding: '0 12px', border: 0, background: 'transparent',
    display: 'flex', alignItems: 'center', gap: 10, boxSizing: 'border-box', cursor: 'pointer',
    color: arkmeTheme.text, fontSize: 14, lineHeight: '20px', textAlign: 'left',
  },
  menuLabel: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  menuCount: { flex: 'none', color: arkmeTheme.text, fontVariantNumeric: 'tabular-nums' },
  divider: { height: 1, margin: '0 12px', background: arkmeTheme.border },
  cardScrim: {
    position: 'absolute', inset: 0, zIndex: 40, display: 'grid', placeItems: 'center', padding: 20,
    background: 'rgba(25, 28, 34, .12)', boxSizing: 'border-box',
  },
  card: {
    position: 'relative', width: 300, height: 340, maxWidth: '100%', overflow: 'hidden',
    borderRadius: 9, background: arkmeTheme.layer2, boxShadow: '0 18px 48px rgba(22, 26, 32, .28)',
  },
  cardBackdrop: {
    position: 'absolute', left: -18, right: -18, top: -22, height: 170,
    backgroundPosition: 'center', backgroundSize: 'cover', filter: 'blur(15px)', opacity: .28,
    maskImage: 'linear-gradient(to bottom, #000 46%, transparent 100%)',
    WebkitMaskImage: 'linear-gradient(to bottom, #000 46%, transparent 100%)',
    transform: 'scale(1.12)',
  },
  cardContent: {
    position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column',
    alignItems: 'center', padding: '64px 18px 18px', boxSizing: 'border-box',
  },
  cardName: {
    margin: '10px 0 0', color: arkmeTheme.text, fontSize: 20, lineHeight: '28px', fontWeight: 600,
    maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  cardSecondaryName: {
    margin: '4px 0 0', color: arkmeTheme.secondary, fontSize: 13, lineHeight: '20px',
    maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  cardButton: {
    width: '100%', height: 50, marginTop: 'auto', border: `1px solid ${arkmeTheme.border}`, borderRadius: 8,
    background: arkmeTheme.elevated, color: arkmeTheme.text, fontSize: 16, fontWeight: 600, cursor: 'pointer',
    transition: 'background-color 120ms ease, border-color 120ms ease, opacity 120ms ease',
  },
  drawer: {
    position: 'absolute', zIndex: 36, top: 68, right: 0, bottom: 0, width: ARKME_MEMBER_RECORDS_DEFAULT_WIDTH,
    display: 'flex', flexDirection: 'column', background: arkmeTheme.layer2,
    borderLeft: `1px solid ${arkmeTheme.border}`, borderRadius: '12px 0 0 0', overflow: 'hidden',
    boxShadow: '-8px 14px 28px rgba(24, 29, 36, .1)',
  },
  drawerDismiss: { position: 'absolute', inset: 0, zIndex: 35, background: 'transparent' },
  drawerResizeHandle: {
    position: 'absolute', zIndex: 37, top: 68, bottom: 0,
    width: ARKME_MEMBER_RECORDS_RESIZE_HANDLE_WIDTH, cursor: 'col-resize', touchAction: 'none',
  },
  drawerResizeIndicator: {
    position: 'absolute', top: 0, bottom: 0, width: ARKME_MEMBER_RECORDS_RESIZE_INDICATOR_WIDTH,
    background: arkmeTheme.accent, transition: 'opacity 120ms ease', pointerEvents: 'none',
  },
  drawerHeader: {
    minHeight: 88, flex: 'none', display: 'flex', alignItems: 'flex-start', gap: 10, padding: '16px 12px 14px 20px',
    borderBottom: `1px solid ${arkmeTheme.border}`, boxSizing: 'border-box',
  },
  drawerHeading: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  drawerTitle: {
    margin: 0, minWidth: 0, color: arkmeTheme.text, fontSize: 18, lineHeight: '25px',
    fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  drawerCount: { color: arkmeTheme.secondary, fontSize: 12, lineHeight: '18px', fontVariantNumeric: 'tabular-nums' },
  drawerClose: {
    width: 30, height: 30, flex: 'none', border: 0, borderRadius: 6, background: 'transparent',
    color: arkmeTheme.secondary, cursor: 'pointer', fontSize: 22,
  },
  drawerBody: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 8px 24px', boxSizing: 'border-box' },
  state: { padding: '42px 12px', color: arkmeTheme.secondary, fontSize: 13, textAlign: 'center' },
  retry: {
    height: 32, marginTop: 10, padding: '0 14px', border: `1px solid ${arkmeTheme.border}`, borderRadius: 7,
    background: arkmeTheme.foreground, color: arkmeTheme.text, cursor: 'pointer',
  },
  recordTime: { margin: '16px 0 10px', color: arkmeTheme.caption, fontSize: 12, lineHeight: '18px', textAlign: 'center' },
  recordRow: { width: '100%', display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 12, boxSizing: 'border-box' },
  recordMain: { minWidth: 0, maxWidth: 'calc(100% - 44px)', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' },
  recordName: { margin: '0 0 4px', color: arkmeTheme.secondary, fontSize: 12, lineHeight: '18px' },
  recordBubble: {
    minWidth: 0, maxWidth: '100%', padding: '10px 13px', border: '1px solid rgba(29,32,40,.035)',
    borderRadius: '5px 14px 14px 14px', background: ARKME_MEMBER_RECORD_OTHER_BUBBLE,
    color: arkmeTheme.text, fontSize: 14, lineHeight: '22px', overflowWrap: 'anywhere',
    '--arkme-bubble-fade': ARKME_MEMBER_RECORD_OTHER_BUBBLE,
  } as CSSProperties,
  recordBubbleSelf: {
    borderRadius: '14px 5px 14px 14px', background: arkmeTheme.messageOwn,
    '--arkme-bubble-fade': arkmeTheme.messageOwn,
  } as CSSProperties,
  loadMoreState: {
    minHeight: 32, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 8, color: arkmeTheme.secondary, fontSize: 12, lineHeight: '18px', textAlign: 'center',
  },
  loadMoreRetry: {
    height: 28, padding: '0 10px', border: `1px solid ${arkmeTheme.border}`, borderRadius: 7,
    background: arkmeTheme.foreground, color: arkmeTheme.text, cursor: 'pointer', fontSize: 12,
  },
}

function menuRows(member: ArkmeConversationMemberItem, sourceKind: ArkmeSourceItem['kind']): number {
  if (sourceKind !== 'group_chat') return 1
  return member.isSelf ? 2 : 3
}

export function arkmeMemberActionMenuRowCount(
  member: ArkmeConversationMemberItem,
  sourceKind: ArkmeSourceItem['kind'],
): number {
  return menuRows(member, sourceKind)
}

export function ArkmeMemberActionMenu(props: {
  member: ArkmeConversationMemberItem
  sourceKind: ArkmeSourceItem['kind']
  position: ArkmeMemberMenuPosition
  onMention: () => void
  onRecords: (mode: ArkmeConversationMemberRecordMode) => void
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target) === true) return
      props.onClose()
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') props.onClose() }
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [props.onClose])
  const ownerLabel = props.member.isSelf ? '看我的快记' : '看TA的快记'
  const mentionedLabel = props.member.isSelf ? '@我的快记' : '@TA的快记'
  return <div
    ref={menuRef}
    role="menu"
    aria-label={`${props.member.displayName} 的成员操作`}
    data-arkme-member-action-menu="true"
    data-placement={props.position.placement}
    style={{ ...styles.menu, left: props.position.left, top: props.position.top }}
    onContextMenu={event => { event.preventDefault() }}
  >
    {!props.member.isSelf && props.sourceKind === 'group_chat' && <>
      <button type="button" role="menuitem" style={styles.menuRow} onClick={props.onMention}
        onMouseEnter={event => { event.currentTarget.style.background = arkmeTheme.subtle }}
        onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}>
        <span style={styles.menuLabel}>@{props.member.displayName}</span>
      </button>
      <div style={styles.divider} />
    </>}
    {props.sourceKind === 'group_chat' && <>
      <button type="button" role="menuitem" style={styles.menuRow} onClick={() => { props.onRecords('mentioned') }}
        onMouseEnter={event => { event.currentTarget.style.background = arkmeTheme.subtle }}
        onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}>
        <span style={styles.menuLabel}>{mentionedLabel}</span><span style={styles.menuCount}>{props.member.mentionCount}</span>
      </button>
      <div style={styles.divider} />
    </>}
    <button type="button" role="menuitem" style={styles.menuRow} onClick={() => { props.onRecords('owner') }}
      onMouseEnter={event => { event.currentTarget.style.background = arkmeTheme.subtle }}
      onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}>
      <span style={styles.menuLabel}>{ownerLabel}</span><span style={styles.menuCount}>{props.member.recordCount}</span>
    </button>
  </div>
}

export function arkmeMemberProfileNames(
  member: Pick<ArkmeConversationMemberItem, 'displayName' | 'memberName' | 'secondaryName'>,
  showTopicNickname: boolean,
): { displayName: string; topicNickname: string } {
  const fallbackDisplayName = member.displayName.trim() || '群成员'
  if (!showTopicNickname) return { displayName: fallbackDisplayName, topicNickname: '' }
  const memberName = member.memberName?.trim() ?? ''
  const secondaryName = member.secondaryName?.trim() ?? ''
  const displayName = memberName !== ''
    && fallbackDisplayName === memberName
    && secondaryName !== ''
    && secondaryName !== memberName
    ? secondaryName
    : fallbackDisplayName
  return {
    displayName,
    topicNickname: memberName !== '' && memberName !== displayName ? memberName : '',
  }
}

export type ArkmeMemberProfileIdentity = Pick<
  ArkmeConversationMemberItem,
  'displayName' | 'memberName' | 'secondaryName' | 'avatarRef'
> & { avatarFallback?: ArkmeGroupAvatarFallback }

export function ArkmeMemberProfileCard(props: {
  member: ArkmeMemberProfileIdentity
  showTopicNickname?: boolean
  busy: boolean
  onClose: () => void
  onSend: () => void
}) {
  const backdrop = useArkmeAvatarImage(props.member.avatarRef) ?? ''
  const [buttonState, setButtonState] = useState<'idle' | 'hover' | 'active'>('idle')
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') props.onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [props.onClose])
  const visualButtonState = props.busy ? 'loading' : buttonState
  const buttonBackground = props.busy
    ? arkmeTheme.layer1
    : buttonState === 'active'
      ? arkmeTheme.active
      : buttonState === 'hover'
        ? arkmeTheme.hover
        : arkmeTheme.elevated
  const names = arkmeMemberProfileNames(props.member, props.showTopicNickname === true)
  return <div style={styles.cardScrim} role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget) props.onClose()
  }}>
    <section style={styles.card} role="dialog" aria-modal="true" aria-label={`${names.displayName} 的用户卡片`}>
      {backdrop !== '' && <div aria-hidden style={{ ...styles.cardBackdrop, backgroundImage: `url(${JSON.stringify(backdrop).slice(1, -1)})` }} />}
      <div style={styles.cardContent}>
        <ArkmeUserAvatar {...(props.member.avatarRef === undefined ? {} : { avatarRef: props.member.avatarRef })}
          {...(props.member.avatarFallback === undefined ? {} : { fallback: props.member.avatarFallback })}
          size={100} label={`${names.displayName} 的头像`} />
        <h3 style={styles.cardName}>{names.displayName}</h3>
        {names.topicNickname !== '' && <p style={styles.cardSecondaryName}>主题内昵称：{names.topicNickname}</p>}
        <button
          type="button"
          style={{
            ...styles.cardButton,
            background: buttonBackground,
            borderColor: buttonState === 'idle' || props.busy ? arkmeTheme.border : arkmeTheme.accent,
            cursor: props.busy ? 'default' : 'pointer',
            opacity: props.busy ? .55 : 1,
          }}
          disabled={props.busy}
          aria-busy={props.busy}
          data-arkme-profile-send-state={visualButtonState}
          onPointerEnter={() => { if (!props.busy) setButtonState('hover') }}
          onPointerLeave={() => { setButtonState('idle') }}
          onPointerDown={() => { if (!props.busy) setButtonState('active') }}
          onPointerUp={() => { if (!props.busy) setButtonState('hover') }}
          onClick={props.onSend}
        >
          {props.busy ? '正在打开…' : '发送消息'}
        </button>
      </div>
    </section>
  </div>
}

function mergeRecordItems(current: readonly ArkmeTimelineItem[], incoming: readonly ArkmeTimelineItem[]): ArkmeTimelineItem[] {
  const merged = new Map(current.map(item => [item.itemUid, item]))
  for (const item of incoming) merged.set(item.itemUid, item)
  return [...merged.values()].sort((left, right) => right.sendAtMillis - left.sendAtMillis)
}

export function arkmeMemberRecordTotal(
  member: ArkmeConversationMemberItem,
  mode: ArkmeConversationMemberRecordMode,
): number {
  return Math.max(0, Math.trunc(mode === 'mentioned' ? member.mentionCount : member.recordCount))
}

export function formatArkmeMemberRecordTime(timestamp: number, nowMillis = Date.now()): string {
  const value = new Date(timestamp)
  const now = new Date(nowMillis)
  const pad = (part: number) => String(part).padStart(2, '0')
  const time = `${pad(value.getHours())}:${pad(value.getMinutes())}`
  const valueDay = new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const dayDistance = Math.round((nowDay - valueDay) / 86_400_000)
  if (dayDistance === 0) return time
  if (dayDistance === 1) return `昨天 ${time}`
  if (dayDistance === 2) return `前天 ${time}`
  if (value.getFullYear() === now.getFullYear()) return `${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${time}`
  return `${String(value.getFullYear())}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${time}`
}

export type ArkmeMemberRecordTimelineEntry =
  | { kind: 'time'; key: string; timestamp: number; label: string }
  | { kind: 'record'; key: string; item: ArkmeTimelineItem }

export function arkmeMemberRecordTimeline(
  items: readonly ArkmeTimelineItem[],
  nowMillis = Date.now(),
): ArkmeMemberRecordTimelineEntry[] {
  const sorted = [...items].sort((left, right) => left.sendAtMillis - right.sendAtMillis)
  const entries: ArkmeMemberRecordTimelineEntry[] = []
  let lastVisibleTimestamp: number | undefined
  for (const item of sorted) {
    const timestamp = item.sendAtMillis
    if (lastVisibleTimestamp === undefined || !Number.isFinite(timestamp)
      || Math.abs(timestamp - lastVisibleTimestamp) > RECORD_TIME_GAP_MILLIS) {
      if (Number.isFinite(timestamp) && timestamp > 0) {
        entries.push({
          kind: 'time',
          key: `time:${item.itemUid}:${String(timestamp)}`,
          timestamp,
          label: formatArkmeMemberRecordTime(timestamp, nowMillis),
        })
        lastVisibleTimestamp = timestamp
      }
    }
    entries.push({ kind: 'record', key: `record:${item.itemUid}`, item })
  }
  return entries
}

export function ArkmeMemberRecordsPanel(props: {
  sourceRef: string
  member: ArkmeConversationMemberItem
  mode: ArkmeConversationMemberRecordMode
  onClose: () => void
}) {
  const [items, setItems] = useState<ArkmeTimelineItem[]>([])
  const [cursor, setCursor] = useState<number>()
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestRef = useRef<AbortController>()
  const loadingRef = useRef(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const dismissRef = useRef<HTMLDivElement>(null)
  const initialScrollRef = useRef(false)
  const pendingScrollAnchorRef = useRef<{ scrollHeight: number; scrollTop: number }>()
  const preferredWidthRef = useRef(readPreferredMemberRecordsWidth())
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number }>()
  const [preferredWidth, setPreferredWidth] = useState(preferredWidthRef.current)
  const [availableWidth, setAvailableWidth] = useState<number>()
  const [resizeHovered, setResizeHovered] = useState(false)
  const [resizing, setResizing] = useState(false)

  const load = (beforeSequence?: number) => {
    const isLoadingOlder = beforeSequence !== undefined
    if (isLoadingOlder && loadingRef.current) return
    if (isLoadingOlder && bodyRef.current !== null) {
      pendingScrollAnchorRef.current = {
        scrollHeight: bodyRef.current.scrollHeight,
        scrollTop: bodyRef.current.scrollTop,
      }
    } else {
      pendingScrollAnchorRef.current = undefined
    }
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    loadingRef.current = true
    setLoading(true)
    setError('')
    void callArkme<ArkmeConversationMemberRecordPage>('source.member-records', {
      sourceRef: props.sourceRef,
      memberRef: props.member.memberRef,
      mode: props.mode,
      limit: 30,
      ...(beforeSequence === undefined ? {} : { beforeSequence }),
    }, controller.signal)
      .then(page => {
        if (requestRef.current !== controller) return
        setItems(current => beforeSequence === undefined ? page.items : mergeRecordItems(current, page.items))
        const nextCursor = page.nextCursor?.beforeSequence
        const canLoadMore = page.hasMore && nextCursor !== undefined && nextCursor !== beforeSequence
        setCursor(canLoadMore ? nextCursor : undefined)
        setHasMore(canLoadMore)
      })
      .catch(caught => {
        if (requestRef.current !== controller || controller.signal.aborted) return
        pendingScrollAnchorRef.current = undefined
        setError(errorMessage(caught))
      })
      .finally(() => {
        if (requestRef.current !== controller) return
        loadingRef.current = false
        setLoading(false)
      })
  }

  useEffect(() => {
    initialScrollRef.current = false
    setItems([])
    setCursor(undefined)
    setHasMore(false)
    load()
    return () => {
      requestRef.current?.abort()
      loadingRef.current = false
      pendingScrollAnchorRef.current = undefined
    }
  }, [props.sourceRef, props.member.memberRef, props.mode])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') props.onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [props.onClose])

  useEffect(() => {
    const host = dismissRef.current?.parentElement
    if (host === undefined || host === null) return
    const measure = () => { setAvailableWidth(host.getBoundingClientRect().width) }
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure)
      observer.observe(host)
      return () => { observer.disconnect() }
    }
    window.addEventListener('resize', measure)
    return () => { window.removeEventListener('resize', measure) }
  }, [])

  useLayoutEffect(() => {
    const body = bodyRef.current
    if (items.length === 0 || body === null) return
    const anchor = pendingScrollAnchorRef.current
    if (anchor !== undefined) {
      pendingScrollAnchorRef.current = undefined
      body.scrollTop = retainArkmeMemberRecordsScrollTop(
        anchor.scrollTop,
        anchor.scrollHeight,
        body.scrollHeight,
      )
      return
    }
    if (initialScrollRef.current) return
    initialScrollRef.current = true
    body.scrollTop = body.scrollHeight
  }, [items])

  useEffect(() => {
    if (loading || error !== '') return
    const frame = window.requestAnimationFrame(() => {
      const body = bodyRef.current
      if (body !== null && shouldLoadOlderArkmeMemberRecords(body.scrollTop, hasMore, cursor, loadingRef.current)) {
        load(cursor)
      }
    })
    return () => { window.cancelAnimationFrame(frame) }
  }, [cursor, error, hasMore, items.length, loading])

  const title = props.mode === 'mentioned'
    ? (props.member.isSelf ? '@我的快记' : `@${props.member.displayName}的快记`)
    : (props.member.isSelf ? '我的快记' : `${props.member.displayName}的快记`)
  const total = arkmeMemberRecordTotal(props.member, props.mode)
  const timeline = useMemo(() => arkmeMemberRecordTimeline(items), [items])
  const effectiveWidth = availableWidth === undefined
    ? preferredWidth
    : clampArkmeMemberRecordsWidth(preferredWidth, availableWidth)
  const drawerUsesAllAvailableWidth = availableWidth !== undefined && effectiveWidth >= availableWidth
  const handleRight = drawerUsesAllAvailableWidth
    ? Math.max(0, (availableWidth ?? 0) - ARKME_MEMBER_RECORDS_RESIZE_HANDLE_WIDTH)
    : effectiveWidth
  const updatePreferredWidth = (width: number) => {
    const nextWidth = availableWidth === undefined
      ? width
      : clampArkmeMemberRecordsWidth(width, availableWidth)
    preferredWidthRef.current = nextWidth
    setPreferredWidth(nextWidth)
  }
  const finishResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = undefined
    setResizing(false)
    persistPreferredMemberRecordsWidth(preferredWidthRef.current)
  }
  return <>
    <div ref={dismissRef} style={styles.drawerDismiss} data-arkme-member-records-dismiss="true" onPointerDown={props.onClose} />
    <div
      role="separator"
      aria-label="调整成员快记侧栏宽度"
      aria-orientation="vertical"
      aria-valuenow={Math.round(effectiveWidth)}
      tabIndex={0}
      data-arkme-member-records-resize-handle="true"
      data-resizing={resizing ? 'true' : 'false'}
      style={{ ...styles.drawerResizeHandle, right: handleRight }}
      onPointerEnter={() => { setResizeHovered(true) }}
      onPointerLeave={() => { if (!resizing) setResizeHovered(false) }}
      onPointerDown={event => {
        event.preventDefault()
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: effectiveWidth }
        preferredWidthRef.current = effectiveWidth
        setResizing(true)
      }}
      onPointerMove={event => {
        const drag = dragRef.current
        if (drag === undefined || drag.pointerId !== event.pointerId) return
        event.preventDefault()
        event.stopPropagation()
        updatePreferredWidth(drag.startWidth + drag.startX - event.clientX)
      }}
      onPointerUp={finishResize}
      onPointerCancel={finishResize}
      onKeyDown={event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        event.stopPropagation()
        updatePreferredWidth(preferredWidth + (event.key === 'ArrowLeft' ? 16 : -16))
        persistPreferredMemberRecordsWidth(preferredWidthRef.current)
      }}
    >
      <span aria-hidden style={{
        ...styles.drawerResizeIndicator,
        ...(drawerUsesAllAvailableWidth ? { left: 0 } : { right: 0 }),
        opacity: resizeHovered || resizing ? 1 : 0,
      }} />
    </div>
    <aside style={{ ...styles.drawer, width: effectiveWidth }} role="dialog" aria-modal="true" aria-label={title}
      data-arkme-member-records-panel="true" data-mode={props.mode} data-total={total}
      data-width={Math.round(effectiveWidth)} data-resizing={resizing ? 'true' : 'false'}>
    <header style={styles.drawerHeader}>
      <div style={styles.drawerHeading}>
        <h3 style={styles.drawerTitle}>{title}</h3>
        <div style={styles.drawerCount}>{total}条</div>
      </div>
      <button type="button" style={styles.drawerClose} aria-label="关闭成员快记" onClick={props.onClose}>
        <XIcon size={18} weight="regular" aria-hidden />
      </button>
    </header>
    <div ref={bodyRef} style={styles.drawerBody} onScroll={event => {
      if (shouldLoadOlderArkmeMemberRecords(
        event.currentTarget.scrollTop,
        hasMore,
        cursor,
        loadingRef.current,
      )) {
        load(cursor)
      }
    }}>
      {loading && items.length === 0 && <div style={styles.state}>正在加载快记…</div>}
      {error !== '' && items.length === 0 && <div style={styles.state} role="alert">
        <div>{error}</div><button type="button" style={styles.retry} onClick={() => { load() }}>重试</button>
      </div>}
      {!loading && error === '' && items.length === 0 && <div style={styles.state}>暂无快记</div>}
      {loading && items.length > 0 && <div style={styles.loadMoreState} role="status" aria-live="polite">
        正在加载更早快记…
      </div>}
      {error !== '' && items.length > 0 && <div style={styles.loadMoreState} role="alert" title={error}>
        <span>加载更早快记失败</span>
        <button type="button" style={styles.loadMoreRetry} onClick={() => { if (cursor !== undefined) load(cursor) }}>
          重试
        </button>
      </div>}
      {timeline.map(entry => entry.kind === 'time'
        ? <div key={entry.key} style={styles.recordTime} data-arkme-record-time={entry.timestamp}>{entry.label}</div>
        : <Fragment key={entry.key}>
          <article
            style={{ ...styles.recordRow, justifyContent: entry.item.isMe ? 'flex-end' : 'flex-start' }}
            data-arkme-member-record-row={entry.item.isMe ? 'self' : 'other'}
          >
            {!entry.item.isMe && <ArkmeUserAvatar
              {...(entry.item.avatarRef === undefined ? {} : { avatarRef: entry.item.avatarRef })}
              size={36}
              label={`${entry.item.senderName} 的头像`}
            />}
            <div style={{ ...styles.recordMain, alignItems: entry.item.isMe ? 'flex-end' : 'flex-start' }}>
              <div style={styles.recordName}>{entry.item.senderName}</div>
              <div style={{ ...styles.recordBubble, ...(entry.item.isMe ? styles.recordBubbleSelf : {}) }}>
                <ArkmeMessageContent item={entry.item} sourceRef={props.sourceRef} highlightMentions />
              </div>
            </div>
            {entry.item.isMe && <ArkmeUserAvatar
              {...(entry.item.avatarRef === undefined ? {} : { avatarRef: entry.item.avatarRef })}
              size={36}
              label={`${entry.item.senderName} 的头像`}
            />}
          </article>
        </Fragment>)}
    </div>
  </aside>
  </>
}
