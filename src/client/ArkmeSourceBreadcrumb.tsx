import { arkmeSourceAllowsUserWrite } from '../topic-policy.js'
import { Button, IconNewChatOutline16, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { conversationMenuLayer, conversationMenuPosition } from './conversation-menu-layer.js'
import type { ArkmeEnvironment, ArkmeSourceItem, ArkmeTopicDissolveProgress, ArkmeTopicDissolveTask } from '../types.js'
import { arkmeSelfDirectorySources } from './source-list.js'
import { ArkmeTopicDissolveDialog, ArkmeTopicRenameDialog } from './ArkmeTopicManagementDialog.js'
import {
  aggregateArkmeSourceTreeRecordCounts, buildArkmeSourceTree, canMoveArkmeTopicToParent,
  flattenVisibleArkmeSourceTree, sortArkmeSourceTree,
} from './source-tree.js'
import {
  readSelfTopicSortPreference, writeSelfTopicSortPreference, type ArkmeSelfTopicSort,
} from './self-topic-sort-preference.js'
import { ARKME_TOPIC_HIERARCHY_MAX_LEVEL, toggleTopicCollapsedState } from './ArkmeVirtualWorkspace.js'
import { ArkmeDshViewOptionsMenu } from './ArkmeDshMenu.js'
import { CONVERSATION_MENU_COLORS, CONVERSATION_MENU_LAYOUT as menuLayout, CONVERSATION_MENU_SURFACE, CONVERSATION_SELECTOR_CSS } from './conversation-selector-style.js'
import { watchConversationMenuScrollbars } from './conversation-menu-scrollbars.js'
import { useSelfTopicExpansion } from './self-topic-expansion-preference.js'
import {
  SELF_TOPIC_MENU_CLOSE, SELF_TOPIC_MENU_OPEN, SELF_TOPIC_MENU_POSITION,
  type SelfTopicMenuRequest,
} from './self-topic-menu-bridge.js'

export interface ArkmeSourceBreadcrumbSegment {
  key: string
  label: string
  source?: ArkmeSourceItem
  trailIndex?: number
  root: boolean
  current: boolean
}

export interface ArkmeSelfTopicOption {
  source: ArkmeSourceItem
  depth: number
}

/** Matches the three topic-order choices offered by the mobile topic list. */
export type { ArkmeSelfTopicSort } from './self-topic-sort-preference.js'

export type ArkmeSelfTopicChildCreator = (parent: ArkmeSourceItem, parentLevel: number) => void
export type ArkmeSelfTopicRenamer = (topic: ArkmeSourceItem, title: string) => Promise<ArkmeSourceItem>
export type ArkmeSelfTopicDissolver = (
  topic: ArkmeSourceItem,
  parent: ArkmeSourceItem | undefined,
  children: readonly ArkmeSourceItem[],
  onProgress: (progress: ArkmeTopicDissolveProgress) => void,
) => Promise<void>

interface ArkmeTopicMovePlan {
  parent: ArkmeSourceItem | undefined
  insertBefore: ArkmeSourceItem | undefined
  indicatorSourceRef: string
  indicatorDepth: number
  before: boolean
  into: boolean
}

export type ArkmeTopicDropPosition = 'before' | 'into' | 'after'

/** Split a topic row into a narrow reorder edge and a generous nesting center. */
export function arkmeTopicDropPosition(
  clientY: number,
  rect: Pick<DOMRect, 'top' | 'height'>,
): ArkmeTopicDropPosition {
  if (rect.height <= 0) return 'into'
  const ratio = (clientY - rect.top) / rect.height
  if (ratio < 0.22) return 'before'
  if (ratio > 0.78) return 'after'
  return 'into'
}

/** Return one frame of proportional list scrolling while a drag hugs an edge. */
export function arkmeTopicDragAutoScrollDelta(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
  edgeSize = 44,
  minimumSpeed = 4,
  maximumSpeed = 18,
): number {
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return 0
  const safeEdgeSize = Math.max(1, Math.min(edgeSize, (rect.bottom - rect.top) / 2))
  const speed = (distance: number): number => Math.round(
    minimumSpeed + (maximumSpeed - minimumSpeed) * Math.min(1, Math.max(0, distance / safeEdgeSize)),
  )
  if (clientY < rect.top + safeEdgeSize) return -speed(rect.top + safeEdgeSize - clientY)
  if (clientY > rect.bottom - safeEdgeSize) return speed(clientY - (rect.bottom - safeEdgeSize))
  return 0
}

const colors = {
  text: '#171923', secondary: '#6f747d', border: '#e1e2e5', surface: '#fff',
  selected: CONVERSATION_MENU_COLORS.selected,
}

const dshSidebarSurface = CONVERSATION_MENU_SURFACE.background

const styles: Record<string, CSSProperties> = {
  breadcrumb: { position: 'relative', minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 10 },
  fixedTitle: { flex: 'none', color: colors.text, fontSize: 15, lineHeight: '24px', fontWeight: 600, whiteSpace: 'nowrap' },
  selector: { maxWidth: 'min(420px, 50vw)' },
  selectorText: { minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap' },
  selectorPathRoot: { minWidth: 0, flex: '1 1 42%', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--dsw-alias-label-secondary, #626872)' },
  selectorPathCurrent: { minWidth: 0, flex: '1 1 58%', overflow: 'hidden', textOverflow: 'ellipsis', color: 'inherit' },
  selectorPathSeparator: { flex: 'none', padding: '0 3px', color: '#a0a5af' },
  selectorPathEllipsis: { flex: 'none', padding: '0 2px', color: '#a0a5af' },
  menu: {
    ...CONVERSATION_MENU_SURFACE,
    position: 'absolute', zIndex: 100, top: 36, left: 0, width: menuLayout.width,
    maxWidth: `min(calc(100vw - 24px), var(--arkme-topic-menu-available-width, ${menuLayout.width}px))`,
    maxHeight: `min(${menuLayout.maxHeight}px, calc(100vh - 116px))`,
    display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: `${menuLayout.paddingY}px ${menuLayout.paddingX}px`,
    boxSizing: 'border-box',
    color: 'var(--dsw-alias-label-primary, #171923)', fontSize: menuLayout.titleFontSize, lineHeight: menuLayout.lineHeight,
  },
  menuListViewport: { position: 'relative', minHeight: 0, display: 'flex', flexDirection: 'column', marginRight: -menuLayout.paddingX },
  menuList: { minHeight: 0, overflowY: 'auto', paddingBottom: menuLayout.listBottomPadding },
  menuListFade: {
    position: 'absolute', left: 0, right: menuLayout.paddingX, bottom: 0, height: menuLayout.fadeHeight, pointerEvents: 'none',
    background: `linear-gradient(to bottom, transparent, ${dshSidebarSurface})`,
  },
  option: {
    width: '100%', minHeight: menuLayout.rowHeight, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', border: 0,
    borderRadius: 8, background: 'transparent', color: 'inherit', font: 'inherit', fontSize: menuLayout.titleFontSize,
    lineHeight: menuLayout.lineHeight, textAlign: 'left', cursor: 'pointer',
  },
  aggregateOption: { gap: 2, padding: '0 8px 0 0' },
  optionSelected: { background: colors.selected, fontWeight: 600 },
  optionLabel: { minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  topicRow: { position: 'relative', minHeight: menuLayout.rowHeight, display: 'flex', alignItems: 'center', gap: 2, borderRadius: 8 },
  topicRowHover: { background: CONVERSATION_MENU_COLORS.hover },
  topicRowSelected: { background: colors.selected, fontWeight: 600 },
  topicHierarchyGuide: {
    position: 'absolute', top: -menuLayout.rowGap, bottom: 0, width: 1, background: '#e7e9ed', pointerEvents: 'none',
  },
  topicRowDropInto: { background: '#eef2ff', outline: '1px solid #8295e5', outlineOffset: -1 },
  topicDropLine: {
    position: 'absolute', zIndex: 2, right: 4, height: 2, borderRadius: 0, background: '#5870d8', pointerEvents: 'none',
  },
  topicDropIntoBadge: {
    position: 'absolute', zIndex: 3, right: 6, top: 5, height: 22, display: 'inline-flex', alignItems: 'center',
    padding: '0 6px', borderRadius: 5, background: '#dce4ff', color: '#445bbd', fontSize: 10, fontWeight: 600,
    pointerEvents: 'none',
  },
  topicToggle: {
    width: 24, height: 28, flex: 'none', display: 'grid', placeItems: 'center', padding: 0, border: 0,
    borderRadius: 6, background: 'transparent', color: colors.secondary, cursor: 'pointer',
  },
  topicSpacer: { width: 24, height: 28, flex: 'none', display: 'grid', placeItems: 'center', color: '#c1c5cd' },
  topicSelect: {
    minWidth: 0, minHeight: menuLayout.rowHeight, flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px 0 2px',
    border: 0, borderRadius: 8, background: 'transparent', color: 'inherit', font: 'inherit', fontSize: menuLayout.titleFontSize,
    lineHeight: menuLayout.lineHeight, textAlign: 'left', cursor: 'pointer',
  },
  topicName: { minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  topicCount: { flex: 'none', minWidth: 18, color: 'var(--dsw-alias-label-tertiary, #9298a3)', fontSize: menuLayout.secondaryFontSize, lineHeight: menuLayout.lineHeight, fontWeight: 400, textAlign: 'right' },
  topicCountHidden: { visibility: 'hidden' },
  childCreate: {
    width: 28, height: 28, flex: 'none', display: 'grid', placeItems: 'center', padding: 0, border: 0,
    borderRadius: 6, background: 'transparent', color: '#69717e', cursor: 'pointer', font: 'inherit',
  },
  childCreateIcon: { width: 16, height: 16 },
  topicMore: {
    width: 28, height: 28, flex: 'none', display: 'grid', placeItems: 'center', padding: 0, border: 0,
    borderRadius: 6, background: 'transparent', color: '#69717e', cursor: 'pointer', font: 'inherit',
  },
  topicMoreIcon: { width: 16, height: 16 },
  topicManageMenu: {
    position: 'absolute', zIndex: 6, top: 29, right: 2, width: 112, padding: 4, boxSizing: 'border-box',
    border: `1px solid ${colors.border}`, borderRadius: 8, background: colors.surface,
    boxShadow: '0 8px 20px rgba(23,25,35,.14)',
  },
  topicManageAction: {
    width: '100%', height: 30, display: 'flex', alignItems: 'center', padding: '0 8px', border: 0, borderRadius: 5,
    background: 'transparent', color: colors.text, cursor: 'pointer', font: 'inherit', fontSize: 12, textAlign: 'left',
  },
  topicManageActionHover: { background: '#f3f4f7' },
  topicManageDanger: { color: '#d74646' },
  currentPath: { flex: 'none', padding: '5px 8px 6px', borderBottom: `1px solid ${colors.border}`, color: 'var(--dsw-alias-label-secondary, #6f747d)', fontSize: menuLayout.secondaryFontSize, lineHeight: menuLayout.lineHeight, overflowWrap: 'anywhere' },
  createFooter: {
    flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0 0',
    background: dshSidebarSurface,
  },
  dissolveProgressTrigger: {
    marginLeft: 'auto', minWidth: 0, height: 28, display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '0 9px', border: '1px solid #dce2f5', borderRadius: 14, background: '#f7f9ff', color: '#4b5fbb',
    font: 'inherit', fontSize: 12, whiteSpace: 'nowrap', cursor: 'pointer',
  },
  dissolveProgressIcon: { width: 11, height: 11, border: '1.5px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%' },
  loadingRow: { minHeight: 28, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', color: colors.secondary, fontSize: 11 },
  childLoadingRow: { minHeight: 26, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px 0 34px', color: colors.secondary, fontSize: 11 },
  loadingIcon: { width: 12, height: 12, flex: 'none', color: '#7587d3' },
  retry: {
    marginLeft: 'auto', padding: 0, border: 0, background: 'transparent', color: '#5870d8',
    font: 'inherit', fontSize: 11, cursor: 'pointer',
  },
  rootDropZone: {
    minHeight: 28, display: 'grid', placeItems: 'center', margin: '4px 4px 0', border: '1px dashed #aebaea',
    borderRadius: 7, color: '#5870d8', fontSize: 11,
  },
  rootDropZoneActive: { background: '#f3f5ff', borderColor: '#7187df' },
}

function ArkmeSelfTopicMenuPortal({ external, children }: { external: boolean; children: ReactNode }) {
  return external && typeof document !== 'undefined' ? createPortal(children, conversationMenuLayer(document)) : children
}

function ArkmeTopicLoadingIcon() {
  return <svg aria-hidden viewBox="0 0 12 12" style={styles.loadingIcon}>
    <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="1.2" />
    <path d="M6 1.75a4.25 4.25 0 0 1 4.25 4.25" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <animateTransform attributeName="transform" type="rotate" from="0 6 6" to="360 6 6" dur=".9s" repeatCount="indefinite" />
    </path>
  </svg>
}

function reconcileBreadcrumbSource(source: ArkmeSourceItem, sources: readonly ArkmeSourceItem[]): ArkmeSourceItem {
  const exact = sources.find(candidate => candidate.sourceRef === source.sourceRef)
  if (exact !== undefined) return exact
  const equivalent = sources.filter(candidate => candidate.kind === source.kind && candidate.displayName === source.displayName)
  return equivalent.length === 1 ? equivalent[0]! : source
}

/** Move one visited personal destination to the end without keeping an older duplicate. */
export function appendArkmeSourceBreadcrumbTrail(
  trail: ArkmeSourceItem[], selectedSource: ArkmeSourceItem | undefined, sources: readonly ArkmeSourceItem[],
): ArkmeSourceItem[] {
  if (selectedSource === undefined || selectedSource.kind === 'send_to_self') return trail.length === 0 ? trail : []
  if (selectedSource.kind !== 'default_category' && selectedSource.kind !== 'topic') return trail
  const resolved = reconcileBreadcrumbSource(selectedSource, sources)
  const last = trail.at(-1)
  const uniqueNamedDestination = sources.filter(source => source.kind === resolved.kind && source.displayName === resolved.displayName).length === 1
  const sameDestination = (source: ArkmeSourceItem): boolean => source.sourceRef === resolved.sourceRef
    || (uniqueNamedDestination && source.kind === resolved.kind && source.displayName === resolved.displayName)
  if (last !== undefined && sameDestination(last)) return last === resolved ? trail : [...trail.slice(0, -1), resolved]
  return [...trail.filter(source => !sameDestination(source)), resolved]
}

/** Return to one visited destination and discard everything visited after it. */
export function truncateArkmeSourceBreadcrumbTrail(trail: readonly ArkmeSourceItem[], trailIndex: number): ArkmeSourceItem[] {
  return trail.slice(0, Math.max(0, trailIndex + 1))
}

/** Keep this data helper for existing consumers while the header itself uses a topic selector. */
export function arkmeSourceBreadcrumb(
  trail: readonly ArkmeSourceItem[], sources: readonly ArkmeSourceItem[],
): ArkmeSourceBreadcrumbSegment[] {
  const sourcesByRef = new Map(sources.map(source => [source.sourceRef, source]))
  const aggregateSource = sources.find(source => source.kind === 'send_to_self')
  const root: ArkmeSourceBreadcrumbSegment = {
    key: aggregateSource?.sourceRef ?? 'arkme:send-to-self', label: '发给自己',
    ...(aggregateSource === undefined ? {} : { source: aggregateSource }), root: true, current: trail.length === 0,
  }
  return [root, ...trail.map((trailSource, index) => {
    const source = sourcesByRef.get(trailSource.sourceRef) ?? reconcileBreadcrumbSource(trailSource, sources)
    return { key: `${String(index)}:${source.sourceRef}`, label: source.displayName, source, trailIndex: index, root: false, current: index === trail.length - 1 }
  })]
}

/** Flatten the existing personal-topic tree for the compact header selector. */
export function arkmeSelfTopicOptions(
  sources: readonly ArkmeSourceItem[], sort: ArkmeSelfTopicSort = 'latest',
): ArkmeSelfTopicOption[] {
  return arkmeSelfTopicTreeRows(sources, new Set(), sort).map(row => ({ source: row.source, depth: row.depth }))
}

/** Keep the same expandable hierarchy used by the full topic directory. */
export function arkmeSelfTopicTreeRows(
  sources: readonly ArkmeSourceItem[],
  collapsedSourceRefs: ReadonlySet<string>,
  sort: ArkmeSelfTopicSort = 'latest',
) {
  const roots = sortArkmeSourceTree(buildArkmeSourceTree(arkmeSelfDirectorySources(sources)), sort)
  return flattenVisibleArkmeSourceTree(roots, collapsedSourceRefs)
}

export function arkmeSelfTopicSelectionPath(
  selectedSource: ArkmeSourceItem | undefined,
  sources: readonly ArkmeSourceItem[] = [],
): string[] {
  if (selectedSource === undefined || selectedSource.kind === 'send_to_self') return []
  const sourceByRef = new Map(sources.map(source => [source.sourceRef, source]))
  const sourceByHierarchyKey = new Map(
    sources.flatMap(source => source.topicHierarchyKey === undefined ? [] : [[source.topicHierarchyKey, source] as const]),
  )
  const path: ArkmeSourceItem[] = []
  const visited = new Set<string>()
  let current: ArkmeSourceItem | undefined = sourceByRef.get(selectedSource.sourceRef) ?? selectedSource
  while (current !== undefined && !visited.has(current.sourceRef)) {
    visited.add(current.sourceRef)
    path.unshift(current)
    const parentReference: string | undefined = current.parentTopicHierarchyKey ?? current.parentSourceRef
    current = parentReference === undefined
      ? undefined
      : current.parentTopicHierarchyKey === undefined
        ? sourceByRef.get(parentReference)
        : sourceByHierarchyKey.get(parentReference)
  }
  return path.map(source => source.displayName)
}

export function arkmeSelfTopicSelectionLabel(
  selectedSource: ArkmeSourceItem | undefined,
  sources: readonly ArkmeSourceItem[] = [],
): string {
  const path = arkmeSelfTopicSelectionPath(selectedSource, sources)
  return path.length === 0 ? '全部' : path.join(' / ')
}

function topicDirectRecordCount(source: ArkmeSourceItem | undefined): number {
  return Math.max(0, source?.recordCount ?? 0)
}

function topicCountLabel(count: number | undefined): string {
  return count === undefined ? '正在加载数量' : count.toLocaleString('zh-CN')
}

function ArkmeTopicCount({ count, error, hidden }: { count: number | undefined; error?: string | undefined; hidden?: boolean }) {
  return <span style={{ ...styles.topicCount, ...(hidden ? styles.topicCountHidden : {}) }} data-arkme-topic-count=""
    aria-label={count === undefined ? error ? '数量暂不可用' : '正在加载数量' : `${topicCountLabel(count)} 条快记或消息`}
    title={count === undefined && error ? '数量加载失败，请重试' : undefined}>
    {count !== undefined ? topicCountLabel(count) : error ? '—'
      : <span role="status" aria-label="正在加载数量"><ArkmeTopicLoadingIcon /></span>}
  </span>
}

export function ArkmeSourceBreadcrumb({
  userId, environment = 'prod', selectedSource, sources, loading = false, countsReady, error, onSelect, onSelectAggregate,
  onCreateTopic, onCreateChildTopic, onRenameTopic, onDissolveTopic, onRetry, onMoveTopic, activeDissolve,
  tourOpen, trigger = 'visible', onOpen,
}: {
  userId?: number | undefined
  environment?: ArkmeEnvironment
  selectedSource: ArkmeSourceItem | undefined
  sources: readonly ArkmeSourceItem[]
  loading?: boolean
  countsReady?: boolean | undefined
  error?: string
  tourOpen?: boolean | undefined
  trigger?: 'visible' | 'none'
  onSelect(source: ArkmeSourceItem): void
  onSelectAggregate(): void
  onOpen?(): void
  onCreateTopic?(): void
  onCreateChildTopic?: ArkmeSelfTopicChildCreator
  onRenameTopic?: ArkmeSelfTopicRenamer
  onDissolveTopic?: ArkmeSelfTopicDissolver
  onRetry?(): void
  onMoveTopic?(
    source: ArkmeSourceItem,
    currentParent: ArkmeSourceItem | undefined,
    nextParent: ArkmeSourceItem | undefined,
    insertBefore: ArkmeSourceItem | undefined,
  ): Promise<void>
  activeDissolve?: ArkmeTopicDissolveTask
}) {
  const [manualOpen, setManualOpen] = useState(false)
  const [externalRequest, setExternalRequest] = useState<SelfTopicMenuRequest>()
  const open = tourOpen ?? (manualOpen || externalRequest !== undefined)
  const [collapsedSourceRefs, setCollapsedSourceRefs] = useSelfTopicExpansion(userId, environment, sources)
  const [sort, setSort] = useState<ArkmeSelfTopicSort>(() => readSelfTopicSortPreference(userId))
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [draggingSourceRef, setDraggingSourceRef] = useState<string>()
  const [hoveredSourceRef, setHoveredSourceRef] = useState<string>()
  const [topicMenuSource, setTopicMenuSource] = useState<ArkmeSourceItem>()
  const [hoveredTopicMenuAction, setHoveredTopicMenuAction] = useState<string>()
  const [renameTopic, setRenameTopic] = useState<ArkmeSourceItem>()
  const [dissolveTopic, setDissolveTopic] = useState<ArkmeSourceItem>()
  const [dissolveDialogOpen, setDissolveDialogOpen] = useState(false)
  const [topicMutationSubmitting, setTopicMutationSubmitting] = useState(false)
  const [topicMutationError, setTopicMutationError] = useState('')
  const [topicDissolveProgress, setTopicDissolveProgress] = useState<ArkmeTopicDissolveProgress>()
  const [dropPlan, setDropPlan] = useState<ArkmeTopicMovePlan>()
  const [movingTopic, setMovingTopic] = useState(false)
  const [moveError, setMoveError] = useState('')
  const selectorRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuListRef = useRef<HTMLDivElement>(null)
  const revealSelectedTopicRef = useRef<() => void>(() => {})
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  const externalRequestRef = useRef<SelfTopicMenuRequest>()
  externalRequestRef.current = externalRequest
  const [externalMenuPosition, setExternalMenuPosition] = useState({ left: 12, top: 12 })
  const pendingSelectedFocusRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragPointerRef = useRef<{ clientX: number, clientY: number }>()
  const dragAutoScrollFrameRef = useRef<number>()
  const dragAutoExpandTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const dragAutoExpandSourceRef = useRef<string>()
  const observedActiveDissolveRef = useRef(false)
  const topicRoots = useMemo(
    () => sortArkmeSourceTree(buildArkmeSourceTree(arkmeSelfDirectorySources(sources)), sort),
    [sort, sources],
  )
  const rows = useMemo(() => flattenVisibleArkmeSourceTree(topicRoots, collapsedSourceRefs), [collapsedSourceRefs, topicRoots])
  const aggregateTopicCounts = useMemo(() => aggregateArkmeSourceTreeRecordCounts(topicRoots), [topicRoots])
  const selectedPath = arkmeSelfTopicSelectionPath(selectedSource, sources)
  const compactSelectedPath = selectedPath.length <= 2
    ? selectedPath
    : [selectedPath[0]!, '…', selectedPath.at(-1)!]
  const label = arkmeSelfTopicSelectionLabel(selectedSource, sources)
  const selectedRef = selectedSource?.kind === 'send_to_self' || selectedSource === undefined ? undefined : selectedSource.sourceRef
  const countsComplete = countsReady ?? (!loading && error === undefined)
  const allTopicsCount = countsComplete
    ? arkmeSelfDirectorySources(sources).reduce((total, source) => total + topicDirectRecordCount(source), 0)
    : undefined
  const sourceByRef = useMemo(() => new Map(sources.map(source => [source.sourceRef, source])), [sources])
  const sourceByHierarchyKey = useMemo(() => new Map(
    sources.flatMap(source => source.topicHierarchyKey === undefined ? [] : [[source.topicHierarchyKey, source] as const]),
  ), [sources])
  const currentParentOf = (source: ArkmeSourceItem): ArkmeSourceItem | undefined => (
    source.parentTopicHierarchyKey === undefined
      ? source.parentSourceRef === undefined ? undefined : sourceByRef.get(source.parentSourceRef)
      : sourceByHierarchyKey.get(source.parentTopicHierarchyKey)
  )
  const directChildrenOf = (source: ArkmeSourceItem): ArkmeSourceItem[] => sources.filter(candidate => (
    candidate.kind === 'topic' && currentParentOf(candidate)?.sourceRef === source.sourceRef
  ))
  const activeDissolveTopic = activeDissolve === undefined ? undefined : sourceByRef.get(activeDissolve.sourceRef)
  const activeDissolveRunning = activeDissolve !== undefined
    && activeDissolve.stage !== 'completed' && activeDissolve.stage !== 'failed'
  const activeDissolveLabel = activeDissolve?.stage === 'reading'
    ? `读取 ${String(activeDissolve.completedRecordCount)}/${String(activeDissolve.totalRecordCount)}`
    : activeDissolve?.stage === 'migrating'
      ? `解散中 ${String(activeDissolve.completedRecordCount)}/${String(activeDissolve.totalRecordCount)}`
      : '解散中'
  const openActiveDissolve = () => {
    if (activeDissolveTopic === undefined || activeDissolve === undefined) return
    setDissolveTopic(activeDissolveTopic)
    setTopicDissolveProgress(activeDissolve)
    setTopicMutationSubmitting(true)
    setTopicMutationError('')
    setDissolveDialogOpen(true)
  }
  useEffect(() => {
    setSort(readSelfTopicSortPreference(userId))
    setSortMenuOpen(false)
  }, [userId])
  useEffect(() => {
    if (!open) setSortMenuOpen(false)
  }, [open])
  useEffect(() => {
    if (activeDissolveRunning && activeDissolve !== undefined) {
      observedActiveDissolveRef.current = true
      setTopicDissolveProgress(activeDissolve)
      return
    }
    if (!observedActiveDissolveRef.current) return
    observedActiveDissolveRef.current = false
    setTopicMutationSubmitting(false)
    setDissolveDialogOpen(false)
    setDissolveTopic(undefined)
    setTopicDissolveProgress(undefined)
  }, [activeDissolve, activeDissolveRunning])
  const draggingSource = draggingSourceRef === undefined ? undefined : sourceByRef.get(draggingSourceRef)
  const customDragEnabled = sort === 'custom' && !loading && !movingTopic && onMoveTopic !== undefined
  const nextSiblingOf = (source: ArkmeSourceItem, parent: ArkmeSourceItem | undefined): ArkmeSourceItem | undefined => {
    const peers = rows
      .filter(row => row.source.kind === 'topic' && currentParentOf(row.source)?.sourceRef === parent?.sourceRef)
      .map(row => row.source)
    const index = peers.findIndex(peer => peer.sourceRef === source.sourceRef)
    return index < 0 ? undefined : peers[index + 1]
  }
  const canMoveTo = (nextParent: ArkmeSourceItem | undefined, insertBefore: ArkmeSourceItem | undefined): boolean => {
    if (draggingSource === undefined || !canMoveArkmeTopicToParent(draggingSource, nextParent, sources)) return false
    if (insertBefore !== undefined && !arkmeSourceAllowsUserWrite(insertBefore)) return false
    if (nextParent?.sourceRef === draggingSource.sourceRef || insertBefore?.sourceRef === draggingSource.sourceRef) return false
    const currentParent = currentParentOf(draggingSource)
    return currentParent?.sourceRef !== nextParent?.sourceRef || nextSiblingOf(draggingSource, currentParent)?.sourceRef !== insertBefore?.sourceRef
  }
  const stopTopicDragAutoScroll = () => {
    dragPointerRef.current = undefined
    if (dragAutoScrollFrameRef.current !== undefined) cancelAnimationFrame(dragAutoScrollFrameRef.current)
    dragAutoScrollFrameRef.current = undefined
  }
  const runTopicDragAutoScroll = () => {
    dragAutoScrollFrameRef.current = undefined
    const list = menuListRef.current
    const pointer = dragPointerRef.current
    if (list === null || pointer === undefined) return
    const delta = arkmeTopicDragAutoScrollDelta(pointer.clientX, pointer.clientY, list.getBoundingClientRect())
    if (delta === 0) return
    const before = list.scrollTop
    list.scrollTop += delta
    if (list.scrollTop === before) return
    dragAutoScrollFrameRef.current = requestAnimationFrame(runTopicDragAutoScroll)
  }
  const updateTopicDragAutoScroll = (clientX: number, clientY: number) => {
    dragPointerRef.current = { clientX, clientY }
    if (dragAutoScrollFrameRef.current === undefined) {
      dragAutoScrollFrameRef.current = requestAnimationFrame(runTopicDragAutoScroll)
    }
  }
  const stopTopicAutoExpand = () => {
    if (dragAutoExpandTimerRef.current !== undefined) clearTimeout(dragAutoExpandTimerRef.current)
    dragAutoExpandTimerRef.current = undefined
    dragAutoExpandSourceRef.current = undefined
  }
  const scheduleTopicAutoExpand = (row: (typeof rows)[number], plan: ArkmeTopicMovePlan | undefined) => {
    const expandable = row.hasChildren || row.source.hasPendingChildren === true
    if (plan?.into !== true || !expandable || row.expanded) {
      stopTopicAutoExpand()
      return
    }
    if (dragAutoExpandSourceRef.current === row.source.sourceRef) return
    stopTopicAutoExpand()
    dragAutoExpandSourceRef.current = row.source.sourceRef
    dragAutoExpandTimerRef.current = setTimeout(() => {
      setCollapsedSourceRefs(current => {
        if (!current.has(row.source.sourceRef)) return current
        const next = new Set(current)
        next.delete(row.source.sourceRef)
        return next
      })
      dragAutoExpandTimerRef.current = undefined
      dragAutoExpandSourceRef.current = undefined
    }, 500)
  }
  const planMoveAtRow = (
    row: (typeof rows)[number], clientX: number, clientY: number, rect: DOMRect,
  ): ArkmeTopicMovePlan | undefined => {
    if (row.source.kind === 'default_category' || !arkmeSourceAllowsUserWrite(row.source)) return undefined
    if (draggingSource === undefined) return undefined
    const horizontalDelta = clientX - dragStartXRef.current
    const position = arkmeTopicDropPosition(clientY, rect)
    const targetParent = currentParentOf(row.source)
    const outdenting = horizontalDelta <= -24 && targetParent !== undefined
    if (position === 'into' && !outdenting) {
      if (!canMoveTo(row.source, undefined)) return undefined
      return {
        parent: row.source, insertBefore: undefined, indicatorSourceRef: row.source.sourceRef,
        indicatorDepth: row.depth + 1, before: false, into: true,
      }
    }
    const parent = outdenting ? currentParentOf(targetParent!) : targetParent
    const before = position === 'before'
    // When outdenting, the row itself is not a sibling at the new depth. Anchor
    // against its parent instead, which is the target's peer at that depth.
    const anchor = outdenting ? targetParent! : row.source
    const insertBefore = before ? anchor : nextSiblingOf(anchor, parent)
    if (!canMoveTo(parent, insertBefore)) return undefined
    return {
      parent, insertBefore, indicatorSourceRef: row.source.sourceRef,
      indicatorDepth: outdenting ? Math.max(0, row.depth - 1) : row.depth, before, into: false,
    }
  }
  const finishTopicMove = (plan: ArkmeTopicMovePlan | undefined) => {
    if (plan === undefined || !canMoveTo(plan.parent, plan.insertBefore) || draggingSource === undefined || onMoveTopic === undefined) return
    const movedSource = draggingSource
    stopTopicDragAutoScroll()
    stopTopicAutoExpand()
    if (plan.into && plan.parent !== undefined) {
      setCollapsedSourceRefs(current => {
        if (!current.has(plan.parent!.sourceRef)) return current
        const next = new Set(current)
        next.delete(plan.parent!.sourceRef)
        return next
      })
    }
    setMovingTopic(true)
    setMoveError('')
    setDropPlan(undefined)
    setDraggingSourceRef(undefined)
    void onMoveTopic(movedSource, currentParentOf(movedSource), plan.parent, plan.insertBefore).catch(caught => {
      setMoveError(caught instanceof Error ? caught.message : '主题层级调整失败，请重试')
    }).finally(() => { setMovingTopic(false) })
  }

  useEffect(() => () => {
    stopTopicDragAutoScroll()
    stopTopicAutoExpand()
  }, [])
  const revealSelectedTopic = () => {
    if (selectedRef === undefined) {
      menuListRef.current?.scrollTo({ top: 0 })
      pendingSelectedFocusRef.current = false
      return
    }
    // Opening a selector must not override the user's saved collapsed branches.
    // Only reveal the selected row if it is already visible in the saved tree.
    pendingSelectedFocusRef.current = true
  }
  revealSelectedTopicRef.current = revealSelectedTopic
  const closeMenu = useCallback((focusExternalTrigger = false) => {
    setManualOpen(false)
    setSortMenuOpen(false)
    setTopicMenuSource(undefined)
    const request = externalRequestRef.current
    if (request !== undefined) {
      externalRequestRef.current = undefined
      setExternalRequest(undefined)
      request.onClose(focusExternalTrigger)
    }
  }, [])
  const positionExternalMenu = useCallback(() => {
    const request = externalRequestRef.current
    const menu = menuRef.current
    const doc = menu?.ownerDocument ?? (typeof document === 'undefined' ? undefined : document)
    const win = doc?.defaultView
    if (request === undefined || win === null || win === undefined) return
    const anchor = request.anchor()
    const width = menu?.offsetWidth ?? menuLayout.width
    const height = Math.min(menu?.offsetHeight ?? menuLayout.maxHeight, Math.max(0, win.innerHeight - 24))
    setExternalMenuPosition(conversationMenuPosition(anchor, width, height, { width: win.innerWidth, height: win.innerHeight }))
  }, [])
  useEffect(() => {
    if (typeof document === 'undefined') return
    const openExternal = (event: Event) => {
      if (tourOpen !== undefined) return
      const request = (event as CustomEvent<SelfTopicMenuRequest>).detail
      if (request === undefined) return
      const previous = externalRequestRef.current
      if (previous !== undefined && previous !== request) previous.onClose(false)
      request.accepted = true
      onOpenRef.current?.()
      externalRequestRef.current = request
      setExternalRequest(request)
      setManualOpen(false)
      setSortMenuOpen(false)
      setTopicMenuSource(undefined)
      revealSelectedTopicRef.current()
    }
    const closeExternal = () => {
      if (externalRequestRef.current !== undefined) closeMenu()
    }
    document.addEventListener(SELF_TOPIC_MENU_OPEN, openExternal)
    document.addEventListener(SELF_TOPIC_MENU_CLOSE, closeExternal)
    document.addEventListener(SELF_TOPIC_MENU_POSITION, positionExternalMenu)
    return () => {
      document.removeEventListener(SELF_TOPIC_MENU_OPEN, openExternal)
      document.removeEventListener(SELF_TOPIC_MENU_CLOSE, closeExternal)
      document.removeEventListener(SELF_TOPIC_MENU_POSITION, positionExternalMenu)
      const request = externalRequestRef.current
      if (request !== undefined) request.onClose(false)
      externalRequestRef.current = undefined
    }
  }, [closeMenu, positionExternalMenu, tourOpen])
  useLayoutEffect(() => {
    const request = externalRequestRef.current
    if (!open) return
    if (request === undefined) {
      const menu = menuRef.current
      const anchor = menu?.parentElement
      const win = menu?.ownerDocument.defaultView
      if (!menu || !anchor || !win) return
      // The inline header sits to the right of the conversation list. Limit its
      // width to the actual remaining viewport, not the entire window width.
      const resize = () => {
        menu.style.setProperty('--arkme-topic-menu-available-width', `${Math.max(0, win.innerWidth - anchor.getBoundingClientRect().left - 12)}px`)
      }
      resize()
      const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize)
      observer?.observe(anchor)
      win.addEventListener('resize', resize)
      return () => {
        observer?.disconnect()
        win.removeEventListener('resize', resize)
      }
    }
    positionExternalMenu()
    if (!request.focusMenu) return
    const frame = requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>('[role="treeitem"]')?.focus({ preventScroll: true })
    })
    return () => { cancelAnimationFrame(frame) }
  }, [externalRequest, open, positionExternalMenu, rows])
  useLayoutEffect(() => {
    if (!open || !menuRef.current || !menuListRef.current) return
    return watchConversationMenuScrollbars(menuRef.current, menuListRef.current)
  }, [open, externalRequest])
  const toggleTopicExpansion = (sourceRef: string) => {
    // A user-driven expand/collapse must preserve the clicked row's viewport
    // position. This also cancels a stale one-time focus request from opening.
    pendingSelectedFocusRef.current = false
    const list = menuListRef.current
    const rowTop = (): number | undefined => {
      const row = [...(list?.querySelectorAll<HTMLElement>('[data-arkme-self-topic-tree-row="true"]') ?? [])]
        .find(element => element.dataset.arkmeSelfTopicTreeRowRef === sourceRef)
      return row?.getBoundingClientRect().top
    }
    const beforeTop = rowTop()
    setCollapsedSourceRefs(current => toggleTopicCollapsedState(sourceRef, current))
    requestAnimationFrame(() => {
      const afterTop = rowTop()
      if (list === null || list === undefined || beforeTop === undefined || afterTop === undefined) return
      list.scrollTop += afterTop - beforeTop
    })
  }

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      // The tour owns visibility, including pointer interaction with its portal.
      if (tourOpen !== undefined) return
      if (!(event.target instanceof Node)) return
      if (selectorRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return
      if (sortMenuOpen && event.target instanceof Element && event.target.closest('[role="menu"]') !== null) return
      closeMenu()
    }
    const closeEscape = (event: KeyboardEvent) => {
      if (tourOpen !== undefined) return
      if (event.key !== 'Escape') return
      if (topicMenuSource !== undefined) setTopicMenuSource(undefined)
      else if (sortMenuOpen) setSortMenuOpen(false)
      else closeMenu(externalRequestRef.current !== undefined)
    }
    document.addEventListener('pointerdown', closeOutside, true)
    document.addEventListener('keydown', closeEscape, true)
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true)
      document.removeEventListener('keydown', closeEscape, true)
    }
  }, [closeMenu, open, sortMenuOpen, topicMenuSource, tourOpen])

  useEffect(() => {
    if (!open || !pendingSelectedFocusRef.current) return
    if (selectedRef === undefined) {
      menuListRef.current?.scrollTo({ top: 0 })
      pendingSelectedFocusRef.current = false
      return
    }
    const selectedRow = menuListRef.current?.querySelector<HTMLElement>(
      `[data-arkme-self-topic-tree-row="true"][aria-selected="true"]`,
    )
    if (selectedRow === null || selectedRow === undefined) {
      pendingSelectedFocusRef.current = false
      return
    }
    selectedRow.scrollIntoView({ block: 'center' })
    pendingSelectedFocusRef.current = false
  }, [open, rows, selectedRef, sort])

  const acceptExternalSelection = () => { externalRequestRef.current?.onSelect() }
  const selectAggregate = () => { acceptExternalSelection(); closeMenu(); onSelectAggregate() }
  const selectTopic = (source: ArkmeSourceItem) => { acceptExternalSelection(); closeMenu(); onSelect(source) }
  const closeTopicDialog = () => {
    if (topicMutationSubmitting) return
    setRenameTopic(undefined)
    setDissolveTopic(undefined)
    setDissolveDialogOpen(false)
    setTopicMutationError('')
    setTopicDissolveProgress(undefined)
  }
  const submitTopicRename = (title: string) => {
    if (renameTopic === undefined || onRenameTopic === undefined || topicMutationSubmitting) return
    const topic = renameTopic
    setTopicMutationSubmitting(true)
    setTopicMutationError('')
    void onRenameTopic(topic, title).then(renamed => {
      if (selectedRef === topic.sourceRef) onSelect(renamed)
      setRenameTopic(undefined)
    }).catch(caught => {
      setTopicMutationError(caught instanceof Error ? caught.message : '主题重命名失败，请重试')
    }).finally(() => { setTopicMutationSubmitting(false) })
  }
  const submitTopicDissolve = () => {
    if (dissolveTopic === undefined || onDissolveTopic === undefined || topicMutationSubmitting) return
    const topic = dissolveTopic
    setTopicMutationSubmitting(true)
    setTopicMutationError('')
    setTopicDissolveProgress({ requestId: '', stage: 'reading', completedRecordCount: 0, totalRecordCount: Math.max(0, topic.recordCount ?? 0) })
    setDissolveDialogOpen(true)
    void onDissolveTopic(topic, currentParentOf(topic), directChildrenOf(topic), setTopicDissolveProgress).then(() => {
      if (selectedRef === topic.sourceRef) onSelectAggregate()
      setDissolveTopic(undefined)
      setDissolveDialogOpen(false)
      closeMenu()
    }).catch(caught => {
      setTopicMutationError(caught instanceof Error ? caught.message : '主题解散失败，请重试')
    }).finally(() => { setTopicMutationSubmitting(false) })
  }

  return <nav aria-label="发给自己主题" style={trigger === 'visible' ? styles.breadcrumb : {
    ...styles.breadcrumb, position: 'absolute', width: 0, height: 0, minWidth: 0, overflow: 'visible',
  }}>
    <style>{CONVERSATION_SELECTOR_CSS}</style>
    {trigger === 'visible' && <><span data-arkme-self-topic-root="true" style={styles.fixedTitle}>发给自己</span>
    <button
      ref={selectorRef}
      type="button" aria-label="选择主题" aria-haspopup="tree" aria-expanded={open}
      data-arkme-self-topic-selector="true" title={label}
      data-arkme-conversation-selector=""
      style={styles.selector}
      onClick={() => {
        if (externalRequestRef.current !== undefined) closeMenu()
        if (manualOpen) { closeMenu(); return }
        revealSelectedTopic()
        onOpenRef.current?.()
        setManualOpen(true)
      }}
    >
      <span style={styles.selectorText}>
        {compactSelectedPath.length === 0 ? '全部' : compactSelectedPath.map((segment, index) => <Fragment key={`${String(index)}:${segment}`}>
          {index > 0 && <span aria-hidden style={styles.selectorPathSeparator}>/</span>}
          {segment === '…'
            ? <span aria-hidden style={styles.selectorPathEllipsis}>…</span>
            : <span style={index === 0 && compactSelectedPath.length > 1 ? styles.selectorPathRoot : styles.selectorPathCurrent}>{segment}</span>}
        </Fragment>)}
      </span>
      <span aria-hidden><svg viewBox="0 0 16 16" width="14" height="14" fill="none">
        <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg></span>
    </button></>}
    {trigger === 'visible' && activeDissolveRunning && activeDissolveTopic !== undefined && <button
      type="button" aria-label="查看解散进度" style={styles.dissolveProgressTrigger} onClick={openActiveDissolve}
    ><span aria-hidden style={styles.dissolveProgressIcon}><ArkmeTopicLoadingIcon /></span>{activeDissolveLabel}</button>}
    {open && <ArkmeSelfTopicMenuPortal external={externalRequest !== undefined}><div ref={menuRef} role="tree" aria-label="主题" data-arkme-self-topic-menu style={{ ...styles.menu,
      ...(externalRequest !== undefined ? {
        position: 'fixed', zIndex: 10020, top: externalMenuPosition.top, left: externalMenuPosition.left,
      } : {}),
      ...(tourOpen ? { maxHeight: `min(${menuLayout.maxHeight}px, calc(100vh - 116px), var(--arkme-self-tour-menu-max-height, ${menuLayout.maxHeight}px))` } : {}),
    }} onPointerEnter={() => { externalRequestRef.current?.keepOpen() }}
      onPointerLeave={() => { externalRequestRef.current?.scheduleClose() }}>
      {selectedPath.length > 0 && <div aria-label="当前主题路径" title={label} style={styles.currentPath}>当前：{label}</div>}
      <div style={styles.menuListViewport}>
      <div ref={menuListRef} style={styles.menuList}
        onDragOver={event => {
          if (!customDragEnabled || draggingSource === undefined) return
          updateTopicDragAutoScroll(event.clientX, event.clientY)
        }}
        onDragLeave={event => {
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
          stopTopicDragAutoScroll()
          stopTopicAutoExpand()
          setDropPlan(undefined)
        }}
        onDrop={() => {
          stopTopicDragAutoScroll()
          stopTopicAutoExpand()
        }}
      >
      <button type="button" role="treeitem" aria-level={1} aria-selected={selectedRef === undefined}
        style={{ ...styles.option, ...styles.aggregateOption, ...(selectedRef === undefined ? styles.optionSelected : {}) }} onClick={selectAggregate}
      ><span aria-hidden style={styles.topicSpacer} /><span style={styles.optionLabel}>全部</span><ArkmeTopicCount count={allTopicsCount} error={error} /></button>
      {rows.map(row => {
        const isSelected = selectedRef === row.source.sourceRef
        const isHovered = hoveredSourceRef === row.source.sourceRef
        const isDefaultCategory = row.source.kind === 'default_category'
        const canDragTopic = customDragEnabled && !isDefaultCategory && arkmeSourceAllowsUserWrite(row.source)
        const canCreateChild = arkmeSourceAllowsUserWrite(row.source) && !isDefaultCategory && onCreateChildTopic !== undefined && row.depth + 1 < ARKME_TOPIC_HIERARCHY_MAX_LEVEL
        const canManageTopic = arkmeSourceAllowsUserWrite(row.source) && !isDefaultCategory && (canCreateChild || onRenameTopic !== undefined || onDissolveTopic !== undefined)
        const showActions = isHovered && canManageTopic && draggingSource === undefined
        const manageMenuOpen = topicMenuSource?.sourceRef === row.source.sourceRef
        const rowDropPlan = dropPlan?.indicatorSourceRef === row.source.sourceRef ? dropPlan : undefined
        const displayedCount = (row.hasChildren || row.source.hasPendingChildren === true) && !countsComplete
          ? undefined
          : aggregateTopicCounts.get(row.source.sourceRef) ?? topicDirectRecordCount(row.source)
        const depthInset = row.depth * 16
        return <div key={row.source.sourceRef} style={{ marginTop: menuLayout.rowGap }}>
        <div
          role="treeitem" aria-level={row.depth + 1}
          aria-selected={selectedRef === row.source.sourceRef}
          {...(row.hasChildren ? { 'aria-expanded': row.expanded } : {})}
          draggable={canDragTopic}
          data-arkme-self-topic-tree-row="true"
          data-arkme-self-topic-tree-row-ref={row.source.sourceRef}
          data-arkme-self-topic-hit-region="true"
          style={{
            ...styles.topicRow, marginLeft: depthInset, width: `calc(100% - ${String(depthInset)}px)`,
            ...(isHovered && !isSelected ? styles.topicRowHover : {}),
            ...(isSelected ? styles.topicRowSelected : {}),
            ...(rowDropPlan?.into === true ? styles.topicRowDropInto : {}),
            ...(canDragTopic ? { cursor: 'grab' } : {}),
          }}
          onClick={() => { selectTopic(row.source) }}
          onMouseEnter={() => { setHoveredSourceRef(row.source.sourceRef) }}
          onMouseLeave={() => {
            setHoveredSourceRef(current => current === row.source.sourceRef ? undefined : current)
            setTopicMenuSource(current => current?.sourceRef === row.source.sourceRef ? undefined : current)
            setHoveredTopicMenuAction(current => current?.startsWith(`${row.source.sourceRef}:`) ? undefined : current)
          }}
          onDragOver={event => {
            const plan = planMoveAtRow(row, event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
            if (plan === undefined) {
              setDropPlan(undefined)
              stopTopicAutoExpand()
              return
            }
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            setDropPlan(plan)
            scheduleTopicAutoExpand(row, plan)
          }}
          onDragStart={event => {
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', row.source.sourceRef)
            dragStartXRef.current = event.clientX
            stopTopicDragAutoScroll()
            stopTopicAutoExpand()
            setMoveError('')
            setDropPlan(undefined)
            setDraggingSourceRef(row.source.sourceRef)
          }}
          onDragEnd={() => {
            stopTopicDragAutoScroll()
            stopTopicAutoExpand()
            setDraggingSourceRef(undefined)
            setDropPlan(undefined)
          }}
          onDrop={event => {
            event.preventDefault()
            finishTopicMove(planMoveAtRow(row, event.clientX, event.clientY, event.currentTarget.getBoundingClientRect()))
          }}
        >
          {Array.from({ length: row.depth }, (_, guideDepth) => <span
            key={`guide-${String(guideDepth)}`}
            aria-hidden
            data-arkme-self-topic-hierarchy-guide={guideDepth}
            style={{ ...styles.topicHierarchyGuide, left: (guideDepth - row.depth) * 16 + 12 }}
          />)}
          {rowDropPlan !== undefined && !rowDropPlan.into && <span
            aria-hidden data-arkme-self-topic-drop-line={rowDropPlan.before ? 'before' : 'after'}
            style={{
              ...styles.topicDropLine,
              left: (rowDropPlan.indicatorDepth - row.depth) * 16 + 4,
              ...(rowDropPlan.before ? { top: -1 } : { bottom: -1 }),
            }}
          />}
          {rowDropPlan?.into === true && <span aria-hidden data-arkme-self-topic-drop-into="true" style={styles.topicDropIntoBadge}>移入</span>}
          {row.hasChildren ? <button
            type="button" aria-label={`${row.expanded ? '收起' : '展开'}${row.source.displayName}`}
            title={row.expanded ? '收起子主题' : '展开子主题'} style={styles.topicToggle}
            onClick={event => { event.stopPropagation(); toggleTopicExpansion(row.source.sourceRef) }}
          ><svg aria-hidden viewBox="0 0 12 12" width="12" height="12" style={{ transform: row.expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .16s ease' }}>
            <path d="m4 2.5 3.5 3.5L4 9.5" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
          </svg></button> : <span aria-hidden style={styles.topicSpacer}>{isDefaultCategory ? '' : '·'}</span>}
          <button type="button" style={styles.topicSelect}
            onClick={event => { event.stopPropagation(); selectTopic(row.source) }}
          ><span style={styles.topicName}>{row.source.displayName}</span><ArkmeTopicCount count={displayedCount} error={error} hidden={showActions} /></button>
          {isHovered && canManageTopic && <button
            type="button" style={styles.topicMore} title="主题操作" aria-label={`${row.source.displayName}主题操作`}
            aria-haspopup="menu" aria-expanded={manageMenuOpen}
            onClick={event => {
              event.stopPropagation()
              setTopicMenuSource(current => current?.sourceRef === row.source.sourceRef ? undefined : row.source)
            }}
          ><svg aria-hidden viewBox="0 0 16 16" style={styles.topicMoreIcon}>
            <circle cx="8" cy="3.25" r="1.1" fill="currentColor" />
            <circle cx="8" cy="8" r="1.1" fill="currentColor" />
            <circle cx="8" cy="12.75" r="1.1" fill="currentColor" />
          </svg></button>}
          {isHovered && manageMenuOpen && <div role="menu" aria-label={`${row.source.displayName}主题操作`} style={styles.topicManageMenu} onClick={event => { event.stopPropagation() }}>
            {canCreateChild && onCreateChildTopic !== undefined && <button type="button" role="menuitem"
              style={{ ...styles.topicManageAction, ...(hoveredTopicMenuAction === `${row.source.sourceRef}:create` ? styles.topicManageActionHover : {}) }}
              onMouseEnter={() => { setHoveredTopicMenuAction(`${row.source.sourceRef}:create`) }}
              onMouseLeave={() => { setHoveredTopicMenuAction(current => current === `${row.source.sourceRef}:create` ? undefined : current) }}
              onClick={() => {
              setTopicMenuSource(undefined)
              setHoveredTopicMenuAction(undefined)
              onCreateChildTopic(row.source, row.depth + 1)
            }}>新建子主题</button>}
            {onRenameTopic !== undefined && <button type="button" role="menuitem"
              style={{ ...styles.topicManageAction, ...(hoveredTopicMenuAction === `${row.source.sourceRef}:rename` ? styles.topicManageActionHover : {}) }}
              onMouseEnter={() => { setHoveredTopicMenuAction(`${row.source.sourceRef}:rename`) }}
              onMouseLeave={() => { setHoveredTopicMenuAction(current => current === `${row.source.sourceRef}:rename` ? undefined : current) }}
              onClick={() => {
              setTopicMenuSource(undefined)
              setHoveredTopicMenuAction(undefined)
              setTopicMutationError('')
              setRenameTopic(row.source)
            }}>重命名</button>}
            {onDissolveTopic !== undefined && <button type="button" role="menuitem"
              style={{ ...styles.topicManageAction, ...styles.topicManageDanger, ...(hoveredTopicMenuAction === `${row.source.sourceRef}:dissolve` ? styles.topicManageActionHover : {}) }}
              onMouseEnter={() => { setHoveredTopicMenuAction(`${row.source.sourceRef}:dissolve`) }}
              onMouseLeave={() => { setHoveredTopicMenuAction(current => current === `${row.source.sourceRef}:dissolve` ? undefined : current) }}
              onClick={() => {
              setTopicMenuSource(undefined)
              setHoveredTopicMenuAction(undefined)
              setTopicMutationError('')
              setDissolveTopic(row.source)
              setDissolveDialogOpen(true)
            }}>解散主题</button>}
          </div>}
        </div>
        {loading && row.source.hasPendingChildren === true && <div role="status" data-arkme-self-topic-children-loading="true"
          style={{ ...styles.childLoadingRow, paddingLeft: 34 + row.depth * 16 }}
        ><ArkmeTopicLoadingIcon />加载子主题</div>}
      </div>
      })}
      {customDragEnabled && draggingSource !== undefined && <div
        role="status" data-arkme-self-topic-root-drop-zone="true"
        style={{ ...styles.rootDropZone, ...(dropPlan?.indicatorSourceRef === 'root' ? styles.rootDropZoneActive : {}) }}
        onDragOver={event => {
          if (!canMoveTo(undefined, undefined)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          stopTopicAutoExpand()
          setDropPlan({ parent: undefined, insertBefore: undefined, indicatorSourceRef: 'root', indicatorDepth: 0, before: false, into: false })
        }}
        onDrop={event => {
          event.preventDefault()
          finishTopicMove({ parent: undefined, insertBefore: undefined, indicatorSourceRef: 'root', indicatorDepth: 0, before: false, into: false })
        }}
      >拖到这里，变为一级主题</div>}
      {moveError !== '' && <div role="alert" style={styles.loadingRow}>{moveError}</div>}
      {loading && <div role="status" data-arkme-self-topic-loading="true" style={styles.loadingRow}><ArkmeTopicLoadingIcon />加载更多主题</div>}
      {!loading && error !== undefined && <div role="alert" style={styles.loadingRow}>
        加载失败
        {onRetry !== undefined && <button type="button" style={styles.retry} onClick={onRetry}>重试</button>}
      </div>}
      </div>
      <div aria-hidden="true" data-arkme-self-topic-fade style={styles.menuListFade} />
      </div>
      <div data-arkme-self-topic-footer="true" style={styles.createFooter}>
        {onCreateTopic !== undefined && <Button type="button" variant="outline" size="md" aria-label="新主题"
          className="arkme-self-topic-create-button" icon={<IconNewChatOutline16 size={14} />} onClick={() => {
          acceptExternalSelection()
          closeMenu()
          onCreateTopic()
        }}>新主题</Button>}
        <ArkmeDshViewOptionsMenu
          open={sortMenuOpen}
          items={([
            { type: 'label', id: 'sort-label', text: '排序方式' },
            { id: 'latest', label: <span className="arkme-self-topic-sort-option" aria-label="最新">
              <span className="arkme-self-topic-sort-option-title">最新</span>
              <span className="arkme-self-topic-sort-option-description">有最新内容的主题靠前</span>
            </span> },
            { id: 'most', label: <span className="arkme-self-topic-sort-option" aria-label="最多">
              <span className="arkme-self-topic-sort-option-title">最多</span>
              <span className="arkme-self-topic-sort-option-description">最多内容的主题靠前</span>
            </span> },
            { id: 'custom', label: <span className="arkme-self-topic-sort-option" aria-label="自定义">
              <span className="arkme-self-topic-sort-option-title">自定义</span>
              <span className="arkme-self-topic-sort-option-description">可按住主题拖动排序</span>
            </span> },
          ] satisfies MenuEntry[])}
          selectedIds={[sort]}
          onOpen={() => { setSortMenuOpen(true) }}
          onClose={() => { setSortMenuOpen(false) }}
          onSelect={id => {
            if (id !== 'latest' && id !== 'most' && id !== 'custom') return
            setSort(id)
            writeSelfTopicSortPreference(userId, id)
            setSortMenuOpen(false)
            revealSelectedTopic()
          }}
          ariaLabel={`主题排序方式：${sort === 'latest' ? '最新' : sort === 'most' ? '最多' : '自定义'}`}
          dataArkmeSelfTopicSortTrigger="true"
        />
      </div>
    </div></ArkmeSelfTopicMenuPortal>}
    {renameTopic !== undefined && <ArkmeTopicRenameDialog
      topic={renameTopic} submitting={topicMutationSubmitting} error={topicMutationError}
      onCancel={closeTopicDialog} onConfirm={submitTopicRename}
    />}
    {dissolveTopic !== undefined && dissolveDialogOpen && <ArkmeTopicDissolveDialog
      topic={dissolveTopic} parent={currentParentOf(dissolveTopic)} recordCount={dissolveTopic.recordCount}
      childCount={directChildrenOf(dissolveTopic).length}
      submitting={topicMutationSubmitting} error={topicMutationError}
      {...(topicDissolveProgress === undefined ? {} : { progress: topicDissolveProgress })}
      onCancel={closeTopicDialog} onConfirm={submitTopicDissolve}
      {...(topicMutationSubmitting ? { onMinimize: () => { setDissolveDialogOpen(false) } } : {})}
    />}
  </nav>
}
