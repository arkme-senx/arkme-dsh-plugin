import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { ArkmeRightPanelHeader } from './ArkmeRightPanelHeader.js'
import {
  Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type {
  ArkmeConversationMemberItem,
  ArkmeConversationMemberRecordMode,
  ArkmeConversationMemberRecordPage,
  ArkmeGroupAvatarFallback,
  ArkmeGroupMemberRemoveResult,
  ArkmeSourceItem,
  ArkmeTimelineItem,
} from '../types.js'
import { ArkmeClientError, callArkme } from './api.js'
import { mergeRecordItems, readMemberRecordWindow } from './member-records-loader.js'
import { memberRecordsViewport, restoreMemberRecordsViewport } from './member-records-viewport.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
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
  canRemove = false,
): number {
  return menuRows(member, sourceKind) + (canRemove ? 1 : 0)
}

export function ArkmeMemberActionMenu(props: {
  member: ArkmeConversationMemberItem
  sourceKind: ArkmeSourceItem['kind']
  position: ArkmeMemberMenuPosition
  hoverAnchor?: HTMLElement | undefined
  hoverSide?: 'left' | 'right' | undefined
  onMention: () => void
  onRecords: (mode: ArkmeConversationMemberRecordMode) => void
  canRemove?: boolean
  onRemove?: () => void
  onClose: () => void
}) {
  const ownerLabel = props.member.isSelf ? '看我的快记' : '看TA的快记'
  const mentionedLabel = props.member.isSelf ? '@我的快记' : '@TA的快记'
  const countLabel = (label: string, count: number) => <span style={{ display: 'flex', gap: 16, justifyContent: 'space-between' }}>
    <span>{label}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{props.member.statsKnown === false ? '' : count}</span>
  </span>
  return <ArkmeActionMenu label={`${props.member.displayName} 的成员操作`}
    hoverAnchor={props.hoverAnchor} align={props.hoverSide === 'left' ? 'end' : 'start'}
    autoFocus={props.hoverAnchor === undefined}
    point={{ x: props.position.left, y: props.position.top }} onClose={props.onClose} actions={[
      !props.member.isSelf && props.sourceKind === 'group_chat' && { id: 'mention', label: `@${props.member.displayName}`, onSelect: props.onMention },
      props.sourceKind === 'group_chat' && { id: 'mentioned-records', label: countLabel(mentionedLabel, props.member.mentionCount), onSelect: () => props.onRecords('mentioned') },
      { id: 'owner-records', label: countLabel(ownerLabel, props.member.recordCount), onSelect: () => props.onRecords('owner') },
      props.canRemove === true && props.onRemove !== undefined && { id: 'remove', label: '移出群聊', danger: true, onSelect: props.onRemove },
    ]} />
}

export function ArkmeGroupMemberRemoveDialog(props: {
  sourceRef: string
  member: ArkmeConversationMemberItem
  onClose: () => void
  onRemoved: (result: ArkmeGroupMemberRemoveResult) => void
}) {
  const [preventRejoin, setPreventRejoin] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const requestRef = useRef<AbortController>()
  const busyRef = useRef(false)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestRef.current?.abort()
    }
  }, [])
  return <ArkmeConfirmDialog
    titleId="arkme-member-remove-title"
    title="移出群聊？"
    description={`${props.member.displayName} 将无法继续查看或发送群消息。`}
    error={error}
    busy={busy}
    confirmLabel="确认移除"
    busyLabel="移除中…"
    confirmTone="danger"
    onClose={props.onClose}
    onConfirm={() => {
          if (busyRef.current) return
          const controller = new AbortController()
          requestRef.current = controller
          busyRef.current = true
          setBusy(true)
          setError('')
          void callArkme<ArkmeGroupMemberRemoveResult>('group.member-remove', {
            sourceRef: props.sourceRef,
            memberRef: props.member.memberRef,
            preventRejoin,
          }, controller.signal).then(result => {
            if (mountedRef.current) props.onRemoved(result)
          }).catch(caught => {
            if (mountedRef.current && !controller.signal.aborted) setError(errorMessage(caught) || '移除失败，请稍后重试')
          }).finally(() => {
            if (requestRef.current === controller) requestRef.current = undefined
            busyRef.current = false
            if (mountedRef.current) setBusy(false)
          })
        }}
  >
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 18, color: arkmeTheme.text, fontSize: 13, lineHeight: '20px', cursor: busy ? 'default' : 'pointer' }}>
      <input
        type="checkbox"
        checked={preventRejoin}
        disabled={busy}
        style={{ width: 16, height: 16, flex: 'none', margin: '3px 0 0', accentColor: arkmeTheme.info }}
        onChange={event => { setPreventRejoin(event.currentTarget.checked); setError('') }}
      />
      <span><strong style={{ display: 'block', fontWeight: 600 }}>禁止再次加入此群</strong><span style={{ display: 'block', marginTop: 2, color: arkmeTheme.secondary }}>开启后，后续邀请、添加或入群审批都会被拒绝，可在群聊设置中解除。</span></span>
    </label>
  </ArkmeConfirmDialog>
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
        <button data-arkme-feedback="neutral"
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
  sourceIdentityKey?: string
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
  const queryRef = useRef<{ sourceKey: string; memberRef: string; mode: ArkmeConversationMemberRecordMode }>()
  const lastLoadRef = useRef<{ beforeSequence: number | undefined; refresh: boolean }>({ beforeSequence: undefined, refresh: false })
  const loadingRef = useRef(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const dismissRef = useRef<HTMLDivElement>(null)
  const initialScrollRef = useRef(false)
  const pendingScrollAnchorRef = useRef<ReturnType<typeof memberRecordsViewport>>()
  const preferredWidthRef = useRef(readPreferredMemberRecordsWidth())
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number }>()
  const [preferredWidth, setPreferredWidth] = useState(preferredWidthRef.current)
  const [availableWidth, setAvailableWidth] = useState<number>()
  const [resizeHovered, setResizeHovered] = useState(false)
  const [resizing, setResizing] = useState(false)

  const load = (beforeSequence?: number, refresh = false) => {
    const isLoadingOlder = beforeSequence !== undefined
    if (isLoadingOlder && loadingRef.current) return
    pendingScrollAnchorRef.current = !initialScrollRef.current || bodyRef.current === null ? undefined : memberRecordsViewport(bodyRef.current)
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    lastLoadRef.current = { beforeSequence, refresh }
    loadingRef.current = true
    setLoading(true)
    setError('')
    const readPage = (before?: number) => callArkme<ArkmeConversationMemberRecordPage>('source.member-records', {
      sourceRef: props.sourceRef,
      memberRef: props.member.memberRef,
      mode: props.mode,
      limit: 30,
      ...(before === undefined ? {} : { beforeSequence: before }),
    }, controller.signal)
    void readMemberRecordWindow(readPage, {
      ...(beforeSequence === undefined ? {} : { beforeSequence }),
      refresh,
      ...(cursor === undefined ? {} : { loadedCursor: cursor }),
      signal: controller.signal,
    }).then(page => {
      if (controller.signal.aborted || requestRef.current !== controller) return
      // Capture at commit time so user scrolling while the request was pending wins.
      pendingScrollAnchorRef.current = !initialScrollRef.current || bodyRef.current === null ? undefined : memberRecordsViewport(bodyRef.current)
      setItems(current => beforeSequence === undefined ? page.items : mergeRecordItems(current, page.items))
      const nextCursor = page.nextCursor?.beforeSequence
      const canLoadMore = page.hasMore && nextCursor !== undefined && nextCursor !== beforeSequence
      setCursor(canLoadMore ? nextCursor : undefined)
      setHasMore(canLoadMore)
      setLoading(false)
    })
      .catch(caught => {
        if (requestRef.current !== controller || controller.signal.aborted) return
        pendingScrollAnchorRef.current = !initialScrollRef.current || bodyRef.current === null ? undefined : memberRecordsViewport(bodyRef.current)
        // An invalid member query is no longer viewable; transient refresh failures retain the loaded range.
        if (caught instanceof ArkmeClientError && caught.body.code === 'chat-member-ref-stale') {
          setItems([])
          setCursor(undefined)
          setHasMore(false)
        }
        setError(errorMessage(caught))
        setLoading(false)
      })
      .finally(() => {
        if (requestRef.current !== controller) return
        loadingRef.current = false
      })
  }

  useEffect(() => {
    const query = { sourceKey: props.sourceIdentityKey ?? props.sourceRef, memberRef: props.member.memberRef, mode: props.mode }
    const previous = queryRef.current
    const sameQuery = previous?.sourceKey === query.sourceKey && previous.memberRef === query.memberRef && previous.mode === query.mode
    queryRef.current = query
    if (!sameQuery) {
      initialScrollRef.current = false
      setItems([])
      setCursor(undefined)
      setHasMore(false)
    }
    load(undefined, sameQuery && items.length > 0)
    return () => {
      requestRef.current?.abort()
      loadingRef.current = false
      pendingScrollAnchorRef.current = undefined
    }
  }, [props.sourceIdentityKey, props.sourceRef, props.member.memberRef, props.mode])

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
      restoreMemberRecordsViewport(body, anchor)
      return
    }
    if (initialScrollRef.current) return
    initialScrollRef.current = true
    body.scrollTop = body.scrollHeight
  }, [items, loading, error])

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
  const total = props.member.statsKnown === false ? undefined : arkmeMemberRecordTotal(props.member, props.mode)
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
    <ArkmeRightPanelHeader title={title} subtitle={total === undefined ? undefined : String(total) + '条'}
      onClose={props.onClose} closeLabel="关闭成员快记" />
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
        <div>{error}</div><button data-arkme-feedback="neutral" type="button" style={styles.retry} onClick={() => { load() }}>重试</button>
      </div>}
      {!loading && error === '' && items.length === 0 && <div style={styles.state}>暂无快记</div>}
      {loading && items.length > 0 && <div style={styles.loadMoreState} role="status" aria-live="polite">
        正在加载快记…
      </div>}
      {error !== '' && items.length > 0 && <div style={styles.loadMoreState} role="alert" title={error}>
        <span>加载快记失败</span>
        <button data-arkme-feedback="neutral" type="button" style={styles.loadMoreRetry} onClick={() => { load(lastLoadRef.current.beforeSequence, lastLoadRef.current.refresh) }}>
          重试
        </button>
      </div>}
      {timeline.map(entry => entry.kind === 'time'
        ? <div key={entry.key} style={styles.recordTime} data-arkme-record-time={entry.timestamp}>{entry.label}</div>
        : <Fragment key={entry.key}>
          <article
            style={{ ...styles.recordRow, justifyContent: entry.item.isMe ? 'flex-end' : 'flex-start' }}
            data-arkme-member-record-row={entry.item.isMe ? 'self' : 'other'}
            data-arkme-member-record-id={entry.item.itemUid}
          >
            {!entry.item.isMe && <ArkmeUserAvatar
              {...(entry.item.avatarRef === undefined ? {} : { avatarRef: entry.item.avatarRef })}
              size={36}
              label={`${entry.item.senderName} 的头像`}
            />}
            <div style={{ ...styles.recordMain, alignItems: entry.item.isMe ? 'flex-end' : 'flex-start' }}>
              <div style={styles.recordName}>{entry.item.senderName}</div>
              <div style={{ ...styles.recordBubble, ...(entry.item.isMe ? styles.recordBubbleSelf : {}) }}>
                <ArkmeMessageContent item={entry.item} sourceRef={props.sourceRef}
                  {...(props.sourceIdentityKey === undefined ? {} : { sourceIdentityKey: props.sourceIdentityKey })} highlightMentions />
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
