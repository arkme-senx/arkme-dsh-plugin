import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type {
  ArkmeAuthSnapshot, ArkmeSourceDirectory, ArkmeSourceItem, ArkmeSourceList, ArkmeTopicCreateResult,
} from '../types.js'
import { callArkme } from './api.js'
import { ArkmeSourceAvatar, clearArkmeAvatarCache } from './ArkmeAvatar.js'
import { ArkmeMark } from './ArkmeFooterAction.js'
import { ArkmeOfficialCommunityEntry } from './ArkmeOfficialCommunityEntry.js'
import { arkmeAuthStore } from './auth-store.js'
import { ArkmeTopicCreateDialog } from './ArkmeTopicCreateDialog.js'
import {
  cachedSelectedSource, clearLastNavigationCache, readLastNavigationCache,
  readNavigationCache, reconcileSelectedSource, writeNavigationCache, type ArkmeNavigationCache,
} from './navigation-cache.js'
import { arkmeUi } from './ui-controller.js'
import { arkmeChatDirectory } from './chat-directory-store.js'
import { arkmeSourceTimeLabel, sortArkmeSources, type ArkmeSourceSort } from './source-list.js'
import {
  buildArkmeSourceTree, flattenVisibleArkmeSourceTree, type ArkmeSourceTreeRow,
} from './source-tree.js'

export interface ArkmeNavigationProps {
  wide?: boolean
  onClose?: () => void
  onActivateSurface?: () => void
}

export const ARKME_TOPIC_HIERARCHY_MAX_LEVEL = 5

const colors = {
  panel: 'var(--dsw-specific-sidebar-fill, #f8f9fa)',
  text: 'var(--dsw-alias-label-primary, #242629)',
  secondary: 'var(--dsw-alias-label-secondary, #8a9099)',
  caption: 'var(--dsw-alias-label-caption, #b0b5bc)',
  border: 'var(--dsw-alias-border-l1, #eceef0)',
  active: '#def3e8',
  accent: '#20c66a',
}

const styles: Record<string, CSSProperties> = {
  shell: {
    position: 'relative', width: '100%', height: '100%', minHeight: 0,
    display: 'flex', flexDirection: 'column', color: colors.text,
  },
  header: {
    position: 'relative', zIndex: 5, flex: 'none', height: 56, display: 'flex', alignItems: 'center', gap: 8,
    padding: '0 12px 0 14px', boxSizing: 'border-box', borderBottom: `1px solid ${colors.border}`,
  },
  headerTitle: { flex: 1, minWidth: 0, margin: 0, fontSize: 15, lineHeight: '22px', fontWeight: 500 },
  headerButton: {
    width: 30, height: 30, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, border: 0, borderRadius: 8, background: 'transparent', color: colors.text,
    fontSize: 20, cursor: 'pointer',
  },
  sortControl: {
    position: 'relative', flex: 'none', display: 'inline-flex', alignItems: 'center', color: colors.secondary,
  },
  sortTrigger: {
    height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
    padding: '0 4px 0 8px', border: 0, borderRadius: 24, outline: 0,
    background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer',
  },
  sortArrow: { width: 10, height: 10, flex: 'none', pointerEvents: 'none' },
  sortMenu: {
    position: 'absolute', zIndex: 30, top: 32, right: 0, width: 96, padding: 4,
    boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-inverted, #e2e4e7)',
    borderRadius: 10, background: 'var(--dsw-specific-menu, #fff)',
    boxShadow: 'var(--dsw-shadow-lv3, 0 4px 12px rgba(22, 26, 31, 0.12))', color: colors.text,
  },
  sortMenuItem: {
    width: '100%', height: 32, display: 'flex', alignItems: 'center', gap: 6,
    padding: '0 8px', border: 0, borderRadius: 7, background: 'transparent', color: 'inherit',
    textAlign: 'left', cursor: 'pointer', font: 'inherit', fontSize: 13, lineHeight: '20px',
  },
  sortMenuItemLabel: { flex: 1, minWidth: 0 },
  sortMenuCheck: { width: 14, height: 14, flex: 'none', color: colors.secondary },
  list: { flex: 1, minHeight: 0, margin: 0, padding: '6px 0 18px', overflowY: 'auto', listStyle: 'none' },
  topicList: { paddingBottom: 74 },
  topicCardList: { paddingTop: 0 },
  chatRow: {
    position: 'relative', width: '100%', minHeight: 60, display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 12px', boxSizing: 'border-box', border: 0, borderBottom: `1px solid ${colors.border}`,
    background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit',
  },
  chatRowActive: { background: colors.active, boxShadow: `inset 3px 0 ${colors.accent}` },
  chatContent: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  chatTop: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 },
  chatName: {
    flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    fontSize: 15, lineHeight: '20px', fontWeight: 500,
  },
  chatTime: { flex: 'none', color: colors.caption, fontSize: 11, lineHeight: '16px' },
  chatBottom: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 },
  preview: {
    flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    color: colors.secondary, fontSize: 12, lineHeight: '17px',
  },
  unread: {
    minWidth: 17, height: 17, padding: '0 5px', boxSizing: 'border-box', borderRadius: 999,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#ff5f57',
    color: '#fff', fontSize: 10, lineHeight: '17px',
  },
  privateBadge: { flex: 'none', padding: '1px 6px', borderRadius: 999, background: '#f0f1f2', color: '#777d85', fontSize: 10 },
  avatar: {
    width: 44, height: 44, flex: 'none', position: 'relative', overflow: 'hidden', borderRadius: 999,
    display: 'grid', placeItems: 'center', background: 'transparent', color: '#727982', fontSize: 15, fontWeight: 600,
  },
  selfAvatar: {
    width: 44, height: 44, flex: 'none', position: 'relative', borderRadius: 999,
    background: '#f0f1f2', border: '1px solid #e1e3e5', boxSizing: 'border-box',
  },
  selfBubbleBack: {
    position: 'absolute', left: 15, top: 11, width: 18, height: 14, borderRadius: 7,
    background: '#a9e8bb', boxShadow: '0 0 0 2px #f0f1f2',
  },
  selfBubbleFront: {
    position: 'absolute', left: 10, top: 17, width: 18, height: 14, borderRadius: 7,
    background: '#70d98d', boxShadow: '0 0 0 2px #f0f1f2',
  },
  topicRow: {
    position: 'relative', width: 'calc(100% - 16px)', minHeight: 38, margin: '1px 8px',
    display: 'flex', alignItems: 'center', boxSizing: 'border-box', overflow: 'hidden',
    borderRadius: 7, background: 'transparent', color: 'inherit',
  },
  topicActive: { background: colors.active, boxShadow: `inset 2px 0 ${colors.accent}` },
  topicGuide: { position: 'absolute', top: 0, bottom: 0, width: 1, background: colors.border, pointerEvents: 'none' },
  topicLead: {
    position: 'relative', zIndex: 1, width: 30, height: 38, flex: 'none', display: 'inline-flex',
    alignItems: 'center', justifyContent: 'center', padding: 0, border: 0, background: 'transparent',
    color: colors.caption, cursor: 'default', font: 'inherit',
  },
  topicToggle: { cursor: 'pointer' },
  topicChevron: { display: 'inline-block', fontSize: 17, lineHeight: 1, transformOrigin: '50% 50%' },
  topicDot: { width: 5, height: 5, flex: 'none', borderRadius: 999, background: '#d6d9dd' },
  topicSelect: {
    position: 'relative', zIndex: 1, minWidth: 0, minHeight: 38, flex: 1, display: 'flex',
    alignItems: 'center', gap: 10, padding: 0, border: 0, background: 'transparent',
    color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit',
  },
  topicName: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, lineHeight: '20px', fontWeight: 400 },
  topicTrailing: {
    width: 58, height: 22, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
    paddingRight: 10, boxSizing: 'border-box',
  },
  topicCount: {
    width: 20, flex: 'none', color: colors.caption, fontSize: 12, lineHeight: '22px', textAlign: 'center',
  },
  topicHover: { background: 'var(--dsw-alias-fill-secondary, #f3f4f5)' },
  topicCreated: { background: colors.active, boxShadow: 'none' },
  topicCreateMask: {
    position: 'absolute', zIndex: 3, top: 8, right: 0, width: 58, height: 22,
    display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 12,
    boxSizing: 'border-box', pointerEvents: 'none',
  },
  topicCreateIcon: {
    width: 20, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, border: 0, borderRadius: 5, background: 'transparent',
    color: colors.caption, opacity: 0.9,
    cursor: 'pointer', font: 'inherit', lineHeight: 1, pointerEvents: 'auto',
  },
  topicCreatePlus: { width: 16, height: 16 },
  topicCard: {
    position: 'relative', width: 'calc(100% - 24px)', minHeight: 56, margin: '0 12px 8px',
    boxSizing: 'border-box', overflow: 'hidden', borderRadius: 9,
    background: 'var(--dsw-alias-fill-secondary, #f6f6f6)', color: 'inherit',
  },
  topicCardButton: {
    width: '100%', minHeight: 56, display: 'flex', flexDirection: 'column', alignItems: 'stretch',
    justifyContent: 'center', gap: 2, padding: '8px 40px 8px 10px', boxSizing: 'border-box',
    border: 0, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit',
  },
  topicCardName: {
    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    fontSize: 14, lineHeight: '20px', fontWeight: 400,
  },
  topicCardMeta: {
    minWidth: 0, display: 'flex', alignItems: 'center', gap: 5,
    color: colors.secondary, fontSize: 12, lineHeight: '17px',
  },
  topicCardCount: {
    minWidth: 18, height: 17, padding: '0 4px', boxSizing: 'border-box', borderRadius: 4,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--dsw-specific-sidebar-fill, #fff)', color: colors.caption,
  },
  topicCardMetaText: { flex: 'none', whiteSpace: 'nowrap' },
  topicCardPreview: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  topicCardHover: { background: 'var(--dsw-alias-fill-tertiary, #f1f2f3)' },
  topicCreateFooter: {
    position: 'absolute', zIndex: 4, left: 0, right: 0, bottom: 0,
    display: 'flex', justifyContent: 'center', padding: '10px 12px 22px',
    boxSizing: 'border-box', background: 'transparent', pointerEvents: 'none',
  },
  topicCreateButton: {
    minWidth: 100, height: 36, padding: '0 16px', border: 0, borderRadius: 8,
    background: 'var(--dsw-alias-fill-tertiary, #eceeef)', color: colors.text,
    cursor: 'pointer', font: 'inherit', fontSize: 14, pointerEvents: 'auto',
  },
  status: { padding: '20px 18px', color: colors.secondary, fontSize: 12, textAlign: 'center' },
  loginButton: {
    margin: '16px', minHeight: 40, border: 0, borderRadius: 10, background: colors.active,
    color: '#176d3d', cursor: 'pointer', font: 'inherit', fontWeight: 600,
  },
  rail: { flex: 'none', display: 'flex', justifyContent: 'center', padding: '0 0 6px' },
  railButton: {
    width: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    border: 0, borderRadius: 8, outline: 0, background: 'transparent', cursor: 'pointer',
  },
}

function SelfAvatar() {
  return <span style={styles.selfAvatar} aria-hidden>
    <span style={styles.selfBubbleBack} />
    <span style={styles.selfBubbleFront} />
  </span>
}

export function ArkmeRecordingsRow({ selected, onClick }: { selected: boolean; onClick(): void }) {
  return <button
    type="button"
    role="treeitem"
    aria-selected={selected}
    style={{ ...styles.chatRow, ...(selected ? styles.chatRowActive : {}) }}
    onClick={onClick}
  >
    <span style={styles.avatar} aria-hidden><ArkmeMark size={44} /></span>
    <span style={styles.chatContent}>
      <span style={styles.chatTop}><span style={styles.chatName}>全天候录音</span></span>
      <span style={styles.chatBottom}><span style={styles.preview}>转写、日总结与时间轴</span></span>
    </span>
  </button>
}

function timeLabel(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
  if (day === start) return time
  if (day === start - 86_400_000) return `昨天 ${time}`
  if (day > start - 7 * 86_400_000) return new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date)
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date)
}

function isSendToSelfSource(source: ArkmeSourceItem | undefined): boolean {
  return source?.kind === 'default_category' || source?.kind === 'topic'
}

export interface ArkmeTopicTreeRowProps {
  row: ArkmeSourceTreeRow
  selected: boolean
  hovered: boolean
  createdHighlightActive?: boolean
  createdHighlightVisible?: boolean
  rowRef?: (node: HTMLDivElement | null) => void
  onHoverChange: (hovered: boolean) => void
  onToggle: () => void
  onSelect: () => void
  onCreateChild: () => void
}

export function ArkmeTopicTreeRow({
  row, selected, hovered, createdHighlightActive = false, createdHighlightVisible = false, rowRef,
  onHoverChange, onToggle, onSelect, onCreateChild,
}: ArkmeTopicTreeRowProps) {
  const source = row.source
  return <div
    ref={rowRef}
    role="treeitem" aria-level={row.depth + 1} aria-selected={selected}
    aria-expanded={row.hasChildren ? row.expanded : undefined}
    style={{
      ...styles.topicRow,
      ...(createdHighlightActive ? {
        transition: `background-color ${createdHighlightVisible ? 140 : 800}ms ease, box-shadow ${createdHighlightVisible ? 140 : 800}ms ease`,
      } : {}),
      ...(selected ? styles.topicActive : {}),
      ...(hovered && !selected ? styles.topicHover : {}),
      ...(createdHighlightVisible ? styles.topicCreated : {}),
    }}
    onMouseEnter={() => { onHoverChange(true) }} onMouseLeave={() => { onHoverChange(false) }}
  >
    {Array.from({ length: row.depth }, (_, index) => <span
      key={index} aria-hidden style={{ ...styles.topicGuide, left: 21 + index * 20 }}
    />)}
    {row.hasChildren ? <button
      type="button"
      style={{ ...styles.topicLead, ...styles.topicToggle, marginLeft: 6 + row.depth * 20 }}
      aria-label={`${row.expanded ? '收起' : '展开'}${source.displayName}`}
      title={row.expanded ? '收起子主题' : '展开子主题'}
      onClick={onToggle}
    ><span aria-hidden style={{ ...styles.topicChevron, transform: row.expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>›</span></button> : <span
      aria-hidden style={{ ...styles.topicLead, marginLeft: 6 + row.depth * 20 }}
    ><span style={styles.topicDot} /></span>}
    <button type="button" style={styles.topicSelect} onClick={onSelect}>
      <span style={styles.topicName}>{source.displayName}</span>
      <span style={styles.topicTrailing}>
        {source.recordCount !== undefined && !(source.kind === 'topic' && hovered) && <span style={styles.topicCount}>{source.recordCount}</span>}
      </span>
    </button>
    {source.kind === 'topic' && hovered && <span
      style={styles.topicCreateMask}
    >
      <button
        type="button" style={styles.topicCreateIcon}
        aria-label={`在${source.displayName}下创建子主题`} title="创建子主题"
        onClick={event => { event.stopPropagation(); onCreateChild() }}
      ><svg aria-hidden viewBox="0 0 16 16" style={styles.topicCreatePlus}>
        <path d="M8 2.5v11M2.5 8h11" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      </svg></button>
    </span>}
  </div>
}

export interface ArkmeTopicCardProps {
  source: ArkmeSourceItem
  selected: boolean
  hovered: boolean
  createdHighlightActive?: boolean
  createdHighlightVisible?: boolean
  rowRef?: (node: HTMLDivElement | null) => void
  onHoverChange: (hovered: boolean) => void
  onSelect: () => void
}

export function ArkmeTopicCard({
  source, selected, hovered, createdHighlightActive = false, createdHighlightVisible = false, rowRef,
  onHoverChange, onSelect,
}: ArkmeTopicCardProps) {
  const time = arkmeSourceTimeLabel(source.activeAtMillis)
  const preview = source.latestPreview?.trim() ?? ''
  return <div
    ref={rowRef} role="listitem"
    style={{
      ...styles.topicCard,
      ...(createdHighlightActive ? {
        transition: `background-color ${createdHighlightVisible ? 140 : 800}ms ease, box-shadow ${createdHighlightVisible ? 140 : 800}ms ease`,
      } : {}),
      ...(selected ? styles.topicActive : {}),
      ...(hovered && !selected ? styles.topicCardHover : {}),
      ...(createdHighlightVisible ? styles.topicCreated : {}),
    }}
    onMouseEnter={() => { onHoverChange(true) }} onMouseLeave={() => { onHoverChange(false) }}
  >
    <button type="button" aria-pressed={selected} style={styles.topicCardButton} onClick={onSelect}>
      <span style={styles.topicCardName}>{source.displayName}</span>
      <span style={styles.topicCardMeta}>
        <span style={styles.topicCardCount}>{source.recordCount ?? 0}</span>
        {time !== '' && <span style={styles.topicCardMetaText}>{time}{preview === '' ? '' : '：'}</span>}
        {preview !== '' && <span style={styles.topicCardPreview}>{preview}</span>}
      </span>
    </button>
  </div>
}

export function expandAncestorsForReveal(
  sources: readonly ArkmeSourceItem[],
  sourceRef: string,
  collapsedSourceRefs: ReadonlySet<string>,
): Set<string> {
  const next = new Set(collapsedSourceRefs)
  const sourcesByRef = new Map(sources.map(source => [source.sourceRef, source]))
  const visited = new Set<string>()
  let parentRef = sourcesByRef.get(sourceRef)?.parentSourceRef
  while (parentRef !== undefined && !visited.has(parentRef)) {
    visited.add(parentRef)
    next.delete(parentRef)
    parentRef = sourcesByRef.get(parentRef)?.parentSourceRef
  }
  return next
}

export function isTopicRowFullyVisible(
  rowRect: Pick<DOMRect, 'top' | 'bottom'>,
  listRect: Pick<DOMRect, 'top' | 'bottom'>,
): boolean {
  return rowRect.top >= listRect.top && rowRect.bottom <= listRect.bottom
}

export function mergeCreatedTopicSource(
  sources: readonly ArkmeSourceItem[],
  createdSource: ArkmeSourceItem,
): ArkmeSourceItem[] {
  return [...sources.filter(source => source.sourceRef !== createdSource.sourceRef), createdSource]
}

export function canCreateChildTopicAtParentLevel(parentLevel: number | undefined): boolean {
  return parentLevel !== undefined && Number.isInteger(parentLevel)
    && parentLevel >= 1 && parentLevel < ARKME_TOPIC_HIERARCHY_MAX_LEVEL
}

export function expandTopicFromRowClick(
  row: ArkmeSourceTreeRow,
  collapsedSourceRefs: Set<string>,
): Set<string> {
  if (!row.hasChildren || row.expanded || !collapsedSourceRefs.has(row.source.sourceRef)) {
    return collapsedSourceRefs
  }
  const next = new Set(collapsedSourceRefs)
  next.delete(row.source.sourceRef)
  return next
}

export function toggleTopicCollapsedState(
  sourceRef: string,
  collapsedSourceRefs: ReadonlySet<string>,
): Set<string> {
  const next = new Set(collapsedSourceRefs)
  if (next.has(sourceRef)) next.delete(sourceRef)
  else next.add(sourceRef)
  return next
}

export function ArkmeTopicCreateFooter({ onCreate }: { onCreate: () => void }) {
  return <div style={styles.topicCreateFooter}>
    <button type="button" style={styles.topicCreateButton} onClick={onCreate}>新建主题</button>
  </div>
}

const arkmeSourceSortOptions: ReadonlyArray<{ value: ArkmeSourceSort, label: string }> = [
  { value: 'latest', label: '最新' },
  { value: 'most', label: '最多' },
  { value: 'default', label: '默认' },
]

export function ArkmeSourceSortMenu({
  value, onSelect,
}: { value: ArkmeSourceSort, onSelect: (value: ArkmeSourceSort) => void }) {
  return <div role="menu" aria-label="排序方式" style={styles.sortMenu}>
    {arkmeSourceSortOptions.map(option => <button
      key={option.value} type="button" role="menuitemradio" aria-checked={option.value === value}
      style={{ ...styles.sortMenuItem, fontWeight: option.value === value ? 500 : 400 }}
      onClick={() => { onSelect(option.value) }}
    >
      <span style={styles.sortMenuItemLabel}>{option.label}</span>
      {option.value === value && <svg aria-hidden viewBox="0 0 14 14" style={styles.sortMenuCheck}>
        <path d="m2.5 7.2 2.8 2.8 6.2-6.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>}
    </button>)}
  </div>
}

export function ArkmeSourceSortControl({
  value, onChange,
}: { value: ArkmeSourceSort, onChange: (value: ArkmeSourceSort) => void }) {
  const [open, setOpen] = useState(false)
  const controlRef = useRef<HTMLDivElement>(null)
  const label = arkmeSourceSortOptions.find(option => option.value === value)?.label ?? '默认'

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const closeFromOutside = (event: PointerEvent) => {
      if (controlRef.current !== null && !controlRef.current.contains(event.target as Node)) setOpen(false)
    }
    const closeFromKeyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeFromOutside)
    document.addEventListener('keydown', closeFromKeyboard)
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside)
      document.removeEventListener('keydown', closeFromKeyboard)
    }
  }, [open])

  return <div ref={controlRef} style={styles.sortControl}>
    <button
      type="button" style={styles.sortTrigger} aria-label={`发给自己排序：${label}`}
      aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(current => !current) }}
    >
      <span>{label}</span>
      <svg aria-hidden viewBox="0 0 10 10" style={styles.sortArrow}>
        <path d="m2 3.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
    {open && <ArkmeSourceSortMenu value={value} onSelect={next => {
      onChange(next)
      setOpen(false)
    }} />}
  </div>
}

export function ArkmeNavigation({ wide = true, onClose, onActivateSurface }: ArkmeNavigationProps) {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot)
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot)
  const chatDirectory = useSyncExternalStore(arkmeChatDirectory.subscribe, arkmeChatDirectory.getSnapshot)
  const [initialCache] = useState(readLastNavigationCache)
  const cacheRef = useRef<ArkmeNavigationCache | undefined>(initialCache)
  const authenticatedUserIdRef = useRef<number | undefined>(initialCache?.userId)
  const avatarCacheUserIdRef = useRef<number | undefined>(initialCache?.userId)
  const directoryRequestAbortRef = useRef<AbortController>()
  const topicCreateRequestRef = useRef(false)
  const topicRowElementsRef = useRef(new Map<string, HTMLDivElement>())
  const createdHighlightTimeoutsRef = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const createdHighlightFramesRef = useRef<number[]>([])
  const auth = authState.auth
  const [directory, setDirectory] = useState<ArkmeSourceDirectory>(initialCache?.directory ?? 'send_to_self')
  const [sources, setSources] = useState<ArkmeSourceItem[]>(
    initialCache?.sources[initialCache.directory] ?? [],
  )
  const [collapsedSourceRefs, setCollapsedSourceRefs] = useState<Set<string>>(() => new Set())
  const [sourceSort, setSourceSort] = useState<ArkmeSourceSort>('default')
  const [hoveredSourceRef, setHoveredSourceRef] = useState<string>()
  const [topicCreateParent, setTopicCreateParent] = useState<ArkmeSourceItem | null>()
  const [topicCreateParentLevel, setTopicCreateParentLevel] = useState<number>()
  const [topicCreateError, setTopicCreateError] = useState('')
  const [topicCreateSubmitting, setTopicCreateSubmitting] = useState(false)
  const [pendingRevealSourceRef, setPendingRevealSourceRef] = useState<string>()
  const [createdHighlight, setCreatedHighlight] = useState<{ sourceRef: string, visible: boolean }>()
  const [error, setError] = useState('')
  const authenticated = auth?.status === 'authenticated'
  const sourceTree = useMemo(() => buildArkmeSourceTree(sources), [sources])
  const visibleSourceRows = useMemo(
    () => flattenVisibleArkmeSourceTree(sourceTree, collapsedSourceRefs),
    [collapsedSourceRefs, sourceTree],
  )
  const cardSources = useMemo(
    () => sourceSort === 'default' ? [] : sortArkmeSources(sources, sourceSort),
    [sourceSort, sources],
  )
  const cardMode = sourceSort !== 'default'
  const bindingRequired = auth?.status === 'binding-required'

  const stopCreatedHighlightAnimation = useCallback(() => {
    createdHighlightTimeoutsRef.current.forEach(timer => { clearTimeout(timer) })
    createdHighlightTimeoutsRef.current = []
    if (typeof window !== 'undefined') {
      createdHighlightFramesRef.current.forEach(frame => { window.cancelAnimationFrame(frame) })
    }
    createdHighlightFramesRef.current = []
  }, [])

  const persistCache = useCallback((patch: {
    directory?: ArkmeSourceDirectory
    sources?: Partial<Record<ArkmeSourceDirectory, ArkmeSourceItem[]>>
    selectedSourceRef?: string
  }) => {
    const userId = authenticatedUserIdRef.current
    if (userId === undefined) return
    const current = cacheRef.current?.userId === userId
      ? cacheRef.current
      : { version: 1, userId, directory: 'send_to_self', sources: {}, updatedAtMillis: 0 } satisfies ArkmeNavigationCache
    const next: ArkmeNavigationCache = {
      ...current,
      directory: patch.directory ?? current.directory,
      sources: { ...current.sources, ...patch.sources },
      updatedAtMillis: Date.now(),
      ...(patch.selectedSourceRef === undefined
        ? (current.selectedSourceRef === undefined ? {} : { selectedSourceRef: current.selectedSourceRef })
        : { selectedSourceRef: patch.selectedSourceRef }),
    }
    cacheRef.current = next
    writeNavigationCache(next)
  }, [])

  const reconcileAuth = useCallback((snapshot: ArkmeAuthSnapshot | undefined) => {
      if (snapshot?.status !== 'authenticated' || snapshot.userId === undefined) {
        if (avatarCacheUserIdRef.current !== undefined) clearArkmeAvatarCache()
        avatarCacheUserIdRef.current = undefined
        authenticatedUserIdRef.current = undefined
        cacheRef.current = undefined
        clearLastNavigationCache()
        setDirectory('send_to_self'); setSources([])
        return
      }
    if (avatarCacheUserIdRef.current !== snapshot.userId) clearArkmeAvatarCache()
    avatarCacheUserIdRef.current = snapshot.userId
    authenticatedUserIdRef.current = snapshot.userId
    const cached = readNavigationCache(snapshot.userId) ?? {
      version: 1, userId: snapshot.userId, directory: 'send_to_self', sources: {}, updatedAtMillis: 0,
    } satisfies ArkmeNavigationCache
    cacheRef.current = cached
    writeNavigationCache(cached)
    setDirectory(cached.directory)
    setSources(cached.sources[cached.directory] ?? [])
  }, [])

  const loadDirectory = useCallback(async (
    next: ArkmeSourceDirectory,
    ensuredSource?: ArkmeSourceItem,
  ) => {
    const controller = new AbortController()
    directoryRequestAbortRef.current?.abort()
    directoryRequestAbortRef.current = controller
    setError('')
    try {
      const loaded: ArkmeSourceItem[] = []
      let cursor: string | undefined
      for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
        const page = await callArkme<ArkmeSourceList>('sources.list', {
          directory: next,
          limit: next === 'root' ? 50 : 100,
          ...(cursor === undefined ? {} : { cursor }),
        }, controller.signal)
        const known = new Set(loaded.map(item => item.sourceRef))
        loaded.push(...page.items.filter(item => !known.has(item.sourceRef)))
        if (!page.hasMore || page.nextCursor === undefined) break
        cursor = page.nextCursor
      }
      if (controller.signal.aborted) return
      if (next === 'send_to_self' && ensuredSource !== undefined) {
        const ensuredIndex = loaded.findIndex(item => item.sourceRef === ensuredSource.sourceRef)
        if (ensuredIndex === -1) loaded.push(ensuredSource)
        else loaded[ensuredIndex] = { ...loaded[ensuredIndex], ...ensuredSource }
      }
      setSources(loaded)
      const uiSnapshot = arkmeUi.getSnapshot()
      const selected = uiSnapshot.mode === 'recordings' ? undefined : uiSnapshot.selectedSource
      const cachedSelected = cacheRef.current === undefined ? undefined : cachedSelectedSource(cacheRef.current)
      const restored = uiSnapshot.mode === 'recordings'
        ? undefined
        : reconcileSelectedSource(selected ?? cachedSelected, loaded)
        ?? (next === 'send_to_self' ? loaded.find(source => source.kind === 'default_category') : undefined)
      if (restored !== undefined) arkmeUi.selectSource(restored)
      persistCache({
        directory: next,
        sources: { [next]: loaded },
        ...(restored === undefined ? {} : { selectedSourceRef: restored.sourceRef }),
      })
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      if (directoryRequestAbortRef.current === controller) directoryRequestAbortRef.current = undefined
    }
  }, [persistCache])

  useEffect(() => {
    void arkmeAuthStore.refresh().catch(() => undefined)
  }, [ui.authRevision])
  useEffect(() => { reconcileAuth(auth) }, [auth, reconcileAuth])
  useEffect(() => {
    if (authenticated) void loadDirectory(directory)
    else { directoryRequestAbortRef.current?.abort(); setSources([]) }
    return () => { directoryRequestAbortRef.current?.abort() }
  }, [authenticated, directory, loadDirectory])
  useEffect(() => {
    if (!authenticated || directory !== 'root' || chatDirectory.revision === 0) return
    const loaded = chatDirectory.sources
    setSources(loaded)
    const selected = ui.mode === 'recordings' ? undefined : arkmeUi.getSnapshot().selectedSource
    const cachedSelected = cacheRef.current === undefined ? undefined : cachedSelectedSource(cacheRef.current)
    const restored = ui.mode === 'recordings'
      ? undefined
      : reconcileSelectedSource(selected ?? cachedSelected, loaded)
    if (restored !== undefined) arkmeUi.selectSource(restored)
    persistCache({
      directory: 'root',
      sources: { root: loaded },
      ...(restored === undefined ? {} : { selectedSourceRef: restored.sourceRef }),
    })
  }, [authenticated, chatDirectory, directory, persistCache, ui.mode])
  useEffect(() => {
    if (!authenticated || directory !== 'send_to_self') return
    const defaultCategory = sources.find(source => source.kind === 'default_category')
    if (defaultCategory !== undefined && !isSendToSelfSource(ui.selectedSource)) {
      arkmeUi.selectSource(defaultCategory)
      persistCache({ directory, selectedSourceRef: defaultCategory.sourceRef })
      onActivateSurface?.()
    }
  }, [authenticated, directory, onActivateSurface, persistCache, sources, ui.selectedSource])
  useEffect(() => {
    const sourcesByRef = new Map(sources.map(source => [source.sourceRef, source]))
    setCollapsedSourceRefs(current => {
      const next = new Set([...current].filter(sourceRef => sourcesByRef.has(sourceRef)))
      let parentRef = ui.selectedSource === undefined
        ? undefined
        : sourcesByRef.get(ui.selectedSource.sourceRef)?.parentSourceRef
      const visited = new Set<string>()
      while (parentRef !== undefined && !visited.has(parentRef)) {
        visited.add(parentRef)
        next.delete(parentRef)
        parentRef = sourcesByRef.get(parentRef)?.parentSourceRef
      }
      if (next.size === current.size && [...next].every(sourceRef => current.has(sourceRef))) return current
      return next
    })
  }, [sources, ui.selectedSource])
  useEffect(() => {
    if (directory !== 'send_to_self' || pendingRevealSourceRef === undefined || typeof window === 'undefined') return
    const element = topicRowElementsRef.current.get(pendingRevealSourceRef)
    if (element === undefined) return
    const sourceRef = pendingRevealSourceRef
    setPendingRevealSourceRef(undefined)
    stopCreatedHighlightAnimation()
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    const listElement = element.parentElement
    const alreadyVisible = listElement !== null && isTopicRowFullyVisible(
      element.getBoundingClientRect(),
      listElement.getBoundingClientRect(),
    )
    if (!alreadyVisible) {
      element.scrollIntoView?.({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' })
    }
    setCreatedHighlight({ sourceRef, visible: reducedMotion })

    const beginHold = () => {
      setCreatedHighlight({ sourceRef, visible: true })
      const holdTimer = setTimeout(() => {
        setCreatedHighlight(current => current?.sourceRef === sourceRef ? { sourceRef, visible: false } : current)
        const clearTimer = setTimeout(() => {
          setCreatedHighlight(current => current?.sourceRef === sourceRef ? undefined : current)
        }, reducedMotion ? 0 : 800)
        createdHighlightTimeoutsRef.current.push(clearTimer)
      }, reducedMotion ? 500 : 1100)
      createdHighlightTimeoutsRef.current.push(holdTimer)
    }

    if (reducedMotion) beginHold()
    else {
      const firstFrame = window.requestAnimationFrame(() => {
        const secondFrame = window.requestAnimationFrame(beginHold)
        createdHighlightFramesRef.current.push(secondFrame)
      })
      createdHighlightFramesRef.current.push(firstFrame)
    }
  }, [directory, pendingRevealSourceRef, stopCreatedHighlightAnimation, visibleSourceRows])
  useEffect(() => () => { stopCreatedHighlightAnimation() }, [stopCreatedHighlightAnimation])

  const showLogin = () => { arkmeUi.showLogin(); onActivateSurface?.() }
  const showRecordings = () => { arkmeUi.showRecordings(); onActivateSurface?.() }
  const changeDirectory = (next: ArkmeSourceDirectory) => {
    directoryRequestAbortRef.current?.abort()
    stopCreatedHighlightAnimation()
    setPendingRevealSourceRef(undefined)
    setCreatedHighlight(undefined)
    setDirectory(next)
    setSources(cacheRef.current?.sources[next] ?? [])
    persistCache({ directory: next })
  }
  const selectSource = (source: ArkmeSourceItem) => {
    arkmeUi.selectSource(source)
    persistCache({ directory, selectedSourceRef: source.sourceRef })
    onActivateSurface?.()
  }
  const selectTopicSource = (row: ArkmeSourceTreeRow) => {
    setCollapsedSourceRefs(current => expandTopicFromRowClick(row, current))
    selectSource(row.source)
  }
  const toggleSource = (sourceRef: string) => {
    setCollapsedSourceRefs(current => toggleTopicCollapsedState(sourceRef, current))
  }
  const openTopicCreate = (parent: ArkmeSourceItem | null, parentLevel?: number) => {
    setTopicCreateParent(parent)
    setTopicCreateParentLevel(parentLevel)
    setTopicCreateError('')
    setTopicCreateSubmitting(false)
  }
  const cancelTopicCreate = () => {
    if (topicCreateRequestRef.current) return
    setTopicCreateParent(undefined)
    setTopicCreateParentLevel(undefined)
    setTopicCreateError('')
  }
  const submitTopicCreate = async (title: string) => {
    if (topicCreateParent === undefined || topicCreateRequestRef.current) return
    const parent = topicCreateParent
    if (parent !== null && !canCreateChildTopicAtParentLevel(topicCreateParentLevel)) {
      setTopicCreateError('主题最多支持五级层级，无法继续创建子主题')
      return
    }
    topicCreateRequestRef.current = true
    setTopicCreateSubmitting(true)
    setTopicCreateError('')
    try {
      const result = await callArkme<ArkmeTopicCreateResult>('topic.create', {
        title,
        ...(parent === null ? {} : { parentSourceRef: parent.sourceRef }),
      })
      const nextSources = mergeCreatedTopicSource(sources, result.source)
      setSources(nextSources)
      persistCache({ directory: 'send_to_self', sources: { send_to_self: nextSources } })
      setCollapsedSourceRefs(current => expandAncestorsForReveal(nextSources, result.source.sourceRef, current))
      setHoveredSourceRef(undefined)
      setTopicCreateParent(undefined)
      setTopicCreateParentLevel(undefined)
      setPendingRevealSourceRef(result.source.sourceRef)
      if (result.warning !== undefined) setError(result.warning)
    } catch (caught) {
      setTopicCreateError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      topicCreateRequestRef.current = false
      setTopicCreateSubmitting(false)
    }
  }
  const joinedOfficialCommunity = async (source: ArkmeSourceItem): Promise<void> => {
    const sharedSources = arkmeChatDirectory.getSnapshot().sources
    const currentSources = sharedSources.length > 0 ? sharedSources : sources
    const nextSources = [source, ...currentSources.filter(item => item.sourceRef !== source.sourceRef)]
    setSources(nextSources)
    arkmeChatDirectory.publish(nextSources)
    arkmeUi.selectSource(source)
    persistCache({ directory: 'root', sources: { root: nextSources }, selectedSourceRef: source.sourceRef })
    onActivateSurface?.()
    await loadDirectory('root')
  }

  if (!wide) {
    return <div style={styles.rail}><button
      type="button" style={styles.railButton} aria-label={authenticated ? 'Arkme' : bindingRequired ? 'Arkme · 待绑定' : 'Arkme · 未登录'}
      title={authenticated ? 'Arkme' : bindingRequired ? 'Arkme · 待绑定' : 'Arkme · 未登录'} onClick={() => { if (!authenticated) showLogin() }}
    ><ArkmeMark size={20} /></button></div>
  }

  return <section style={styles.shell} aria-label="Arkme 会话列表">
    {directory === 'send_to_self' && <header style={styles.header}>
      <button
        type="button" style={styles.headerButton} aria-label="返回 Arkme 会话列表" title="返回"
        onClick={() => { changeDirectory('root') }}
      >‹</button>
      <h2 style={styles.headerTitle}>发给自己</h2>
      <ArkmeSourceSortControl value={sourceSort} onChange={value => {
        setSourceSort(value)
        setHoveredSourceRef(undefined)
      }} />
      {onClose !== undefined && <button type="button" style={styles.headerButton} aria-label="关闭 Arkme" title="关闭 Arkme" onClick={onClose}>×</button>}
    </header>}

    {!authenticated && auth !== undefined ? <button type="button" style={styles.loginButton} onClick={showLogin}>
      {bindingRequired ? '完成登录' : '登录 Arkme'}
    </button> : <>
    <div
      style={{
        ...styles.list,
        ...(directory === 'send_to_self' ? styles.topicList : {}),
        ...(directory === 'send_to_self' && cardMode ? styles.topicCardList : {}),
      }}
      role={directory === 'send_to_self' && cardMode ? 'list' : 'tree'}
      aria-label={directory === 'send_to_self' ? '发给自己分类' : 'Arkme 会话'}
    >
      {directory === 'root' && <>
        {authenticated && <ArkmeOfficialCommunityEntry onJoined={joinedOfficialCommunity} />}
        <button
          type="button" role="treeitem" aria-selected={ui.mode === 'source' && isSendToSelfSource(ui.selectedSource)}
          style={{ ...styles.chatRow, ...(ui.mode === 'source' && isSendToSelfSource(ui.selectedSource) ? styles.chatRowActive : {}) }}
          onClick={() => {
            changeDirectory('send_to_self')
            if (ui.mode === 'source' && isSendToSelfSource(ui.selectedSource)) onActivateSurface?.()
          }}
        >
          <SelfAvatar />
          <span style={styles.chatContent}>
            <span style={styles.chatTop}><span style={styles.chatName}>发给自己</span><span style={styles.privateBadge}>私密</span></span>
            <span style={styles.chatBottom}><span style={styles.preview}>默认分类与主题</span></span>
          </span>
        </button>
        <ArkmeRecordingsRow selected={ui.mode === 'recordings'} onClick={showRecordings} />
        {sources.map(source => {
          const selected = ui.mode === 'source' && ui.selectedSource?.sourceRef === source.sourceRef
          return <button
            key={source.sourceRef} type="button" role="treeitem" aria-selected={selected}
            style={{ ...styles.chatRow, ...(selected ? styles.chatRowActive : {}) }} onClick={() => { selectSource(source) }}
          >
            <ArkmeSourceAvatar
              {...(source.avatarRef === undefined ? {} : { avatarRef: source.avatarRef })}
              {...(source.avatarRefs === undefined ? {} : { avatarRefs: source.avatarRefs })}
            />
            <span style={styles.chatContent}>
              <span style={styles.chatTop}>
                <span style={styles.chatName}>{source.displayName}</span>
                <span style={styles.chatTime}>{timeLabel(source.activeAtMillis)}</span>
              </span>
              <span style={styles.chatBottom}>
                <span style={styles.preview}>{source.latestPreview ?? (source.kind === 'group_chat' ? '群聊' : '')}</span>
                {source.unreadCount > 0 && <span style={styles.unread}>{source.unreadCount > 99 ? '99+' : source.unreadCount}</span>}
              </span>
            </span>
          </button>
        })}
      </>}

      {directory === 'send_to_self' && !cardMode && visibleSourceRows.map(row => {
        const source = row.source
        const selected = ui.mode === 'source' && ui.selectedSource?.sourceRef === source.sourceRef
        return <ArkmeTopicTreeRow
          key={source.sourceRef} row={row} selected={selected}
          hovered={hoveredSourceRef === source.sourceRef}
          createdHighlightActive={createdHighlight?.sourceRef === source.sourceRef}
          createdHighlightVisible={createdHighlight?.sourceRef === source.sourceRef && createdHighlight.visible}
          rowRef={node => {
            if (node === null) topicRowElementsRef.current.delete(source.sourceRef)
            else topicRowElementsRef.current.set(source.sourceRef, node)
          }}
          onHoverChange={hovered => { setHoveredSourceRef(hovered ? source.sourceRef : undefined) }}
          onToggle={() => { toggleSource(source.sourceRef) }}
          onSelect={() => { selectTopicSource(row) }}
          onCreateChild={() => { openTopicCreate(source, row.depth + 1) }}
        />
      })}

      {directory === 'send_to_self' && cardMode && cardSources.map(source => {
        const selected = ui.mode === 'source' && ui.selectedSource?.sourceRef === source.sourceRef
        return <ArkmeTopicCard
          key={source.sourceRef} source={source} selected={selected}
          hovered={hoveredSourceRef === source.sourceRef}
          createdHighlightActive={createdHighlight?.sourceRef === source.sourceRef}
          createdHighlightVisible={createdHighlight?.sourceRef === source.sourceRef && createdHighlight.visible}
          rowRef={node => {
            if (node === null) topicRowElementsRef.current.delete(source.sourceRef)
            else topicRowElementsRef.current.set(source.sourceRef, node)
          }}
          onHoverChange={hovered => { setHoveredSourceRef(hovered ? source.sourceRef : undefined) }}
          onSelect={() => { selectSource(source) }}
        />
      })}

      {error !== '' && <div style={{ ...styles.status, color: '#c2413b' }}>{error}</div>}
    </div>
    {directory === 'send_to_self' && authenticated && <ArkmeTopicCreateFooter onCreate={() => { openTopicCreate(null) }} />}
    </>}
    {topicCreateParent !== undefined && <ArkmeTopicCreateDialog
      key={topicCreateParent?.sourceRef ?? 'root'}
      mode={topicCreateParent === null ? 'topic' : 'child'}
      submitting={topicCreateSubmitting} error={topicCreateError}
      onCancel={cancelTopicCreate} onConfirm={title => { void submitTopicCreate(title) }}
    />}
  </section>
}
