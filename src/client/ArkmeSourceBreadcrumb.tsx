import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { ArkmeSourceItem, ArkmeTopicDissolveProgress, ArkmeTopicDissolveTask } from '../types.js'
import { arkmeSelfDirectorySources } from './source-list.js'
import { ArkmeTopicDissolveDialog, ArkmeTopicRenameDialog } from './ArkmeTopicManagementDialog.js'
import {
  aggregateArkmeSourceTreeRecordCounts, buildArkmeSourceTree, canMoveArkmeTopicToParent,
  flattenVisibleArkmeSourceTree, sortArkmeSourceTree,
} from './source-tree.js'
import { ARKME_TOPIC_HIERARCHY_MAX_LEVEL, toggleTopicCollapsedState } from './ArkmeVirtualWorkspace.js'

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
export type ArkmeSelfTopicSort = 'latest' | 'most' | 'custom'

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
  before: boolean
  into: boolean
}

const colors = {
  text: '#171923', secondary: '#6f747d', border: '#e1e2e5', surface: '#fff',
  selected: '#eef1f8',
}

const styles: Record<string, CSSProperties> = {
  breadcrumb: { position: 'relative', minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 10 },
  fixedTitle: { flex: 'none', color: colors.text, fontSize: 15, lineHeight: '24px', fontWeight: 600, whiteSpace: 'nowrap' },
  selector: {
    minWidth: 0, maxWidth: 'min(420px, 50vw)', height: 30, display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '0 9px 0 10px', border: `1px solid ${colors.border}`, borderRadius: 8,
    background: colors.surface, color: colors.text, font: 'inherit', fontSize: 12, cursor: 'pointer',
  },
  selectorOpen: { borderColor: '#b9c4e8', background: '#f8f9ff' },
  selectorText: { minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap' },
  selectorPathRoot: { minWidth: 0, flex: '1 1 42%', overflow: 'hidden', textOverflow: 'ellipsis', color: colors.secondary },
  selectorPathCurrent: { minWidth: 0, flex: '1 1 58%', overflow: 'hidden', textOverflow: 'ellipsis', color: colors.text },
  selectorPathSeparator: { flex: 'none', padding: '0 3px', color: '#a0a5af' },
  selectorPathEllipsis: { flex: 'none', padding: '0 2px', color: '#a0a5af' },
  caret: { width: 12, height: 12, flex: 'none', color: colors.secondary, transition: 'transform .16s ease' },
  menu: {
    position: 'absolute', zIndex: 100, top: 36, left: 0, width: 260, maxHeight: 'min(680px, calc(100vh - 116px))',
    display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 5, boxSizing: 'border-box', border: `1px solid ${colors.border}`, borderRadius: 10,
    background: colors.surface, boxShadow: '0 14px 32px rgba(23,25,35,.12)',
  },
  menuList: { minHeight: 0, overflowY: 'auto', paddingBottom: 44 },
  option: {
    width: '100%', minHeight: 32, display: 'flex', alignItems: 'center', gap: 8, padding: '0 9px', border: 0,
    borderRadius: 7, background: 'transparent', color: colors.text, font: 'inherit', fontSize: 12, textAlign: 'left', cursor: 'pointer',
  },
  aggregateOption: { gap: 2, padding: '0 9px 0 0' },
  optionSelected: { background: colors.selected, fontWeight: 600 },
  optionLabel: { minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  topicRow: { position: 'relative', minHeight: 32, display: 'flex', alignItems: 'center', gap: 2, borderRadius: 7 },
  topicRowHover: { background: '#f3f4f7' },
  topicRowDropTarget: { background: '#f3f5ff' },
  topicRowDropBefore: { boxShadow: 'inset 0 2px 0 #5870d8' },
  topicRowDropAfter: { boxShadow: 'inset 0 -2px 0 #5870d8' },
  topicRowDropInto: { outline: '1px solid #8fa0e9' },
  topicToggle: {
    width: 24, height: 28, flex: 'none', display: 'grid', placeItems: 'center', padding: 0, border: 0,
    borderRadius: 6, background: 'transparent', color: colors.secondary, cursor: 'pointer',
  },
  topicSpacer: { width: 24, height: 28, flex: 'none', display: 'grid', placeItems: 'center', color: '#c1c5cd' },
  topicSelect: {
    minWidth: 0, minHeight: 32, flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px 0 2px',
    border: 0, borderRadius: 7, background: 'transparent', color: colors.text, font: 'inherit', fontSize: 12,
    textAlign: 'left', cursor: 'pointer',
  },
  topicSelectSelected: { background: colors.selected, fontWeight: 600 },
  topicName: { minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  topicCount: { flex: 'none', minWidth: 18, color: '#9298a3', fontSize: 11, fontWeight: 400, textAlign: 'right' },
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
  sortGroup: { display: 'flex', alignItems: 'center', gap: 3, padding: '3px 4px 6px', borderBottom: `1px solid ${colors.border}` },
  sortButton: {
    minWidth: 0, height: 24, flex: 1, padding: '0 6px', border: 0, borderRadius: 6, background: 'transparent',
    color: colors.secondary, font: 'inherit', fontSize: 11, cursor: 'pointer',
  },
  sortButtonActive: { background: '#eef1f8', color: '#38466f', fontWeight: 600 },
  currentPath: { padding: '5px 8px 6px', borderBottom: `1px solid ${colors.border}`, color: colors.secondary, fontSize: 11, lineHeight: '16px', overflowWrap: 'anywhere' },
  createFooter: { position: 'absolute', right: 0, bottom: 9, left: 0, zIndex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' },
  createButton: {
    width: 'auto', height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
    padding: '0 10px', border: `1px solid ${colors.border}`, borderRadius: 14, background: 'rgba(255,255,255,.94)',
    boxShadow: '0 4px 12px rgba(23,25,35,.12)', color: '#4b62c6', font: 'inherit', fontSize: 12, whiteSpace: 'nowrap', cursor: 'pointer',
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
  return count === undefined ? '…' : count.toLocaleString('zh-CN')
}

export function ArkmeSourceBreadcrumb({
  selectedSource, sources, loading = false, error, onSelect, onSelectAggregate,
  onCreateTopic, onCreateChildTopic, onRenameTopic, onDissolveTopic, onRetry, onMoveTopic, activeDissolve,
}: {
  selectedSource: ArkmeSourceItem | undefined
  sources: readonly ArkmeSourceItem[]
  loading?: boolean
  error?: string
  onSelect(source: ArkmeSourceItem): void
  onSelectAggregate(): void
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
  const [open, setOpen] = useState(false)
  const [collapsedSourceRefs, setCollapsedSourceRefs] = useState<Set<string>>(() => new Set())
  const [sort, setSort] = useState<ArkmeSelfTopicSort>('latest')
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
  const rootRef = useRef<HTMLElement>(null)
  const menuListRef = useRef<HTMLDivElement>(null)
  const pendingSelectedFocusRef = useRef(false)
  const dragStartXRef = useRef(0)
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
  const countsComplete = !loading && error === undefined
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
    if (nextParent?.sourceRef === draggingSource.sourceRef || insertBefore?.sourceRef === draggingSource.sourceRef) return false
    const currentParent = currentParentOf(draggingSource)
    return currentParent?.sourceRef !== nextParent?.sourceRef || nextSiblingOf(draggingSource, currentParent)?.sourceRef !== insertBefore?.sourceRef
  }
  const planMoveAtRow = (
    row: (typeof rows)[number], clientX: number, clientY: number, rect: DOMRect,
  ): ArkmeTopicMovePlan | undefined => {
    if (row.source.kind === 'default_category') return undefined
    if (draggingSource === undefined) return undefined
    const horizontalDelta = clientX - dragStartXRef.current
    if (horizontalDelta >= 24) {
      if (!canMoveTo(row.source, undefined)) return undefined
      return { parent: row.source, insertBefore: undefined, indicatorSourceRef: row.source.sourceRef, before: false, into: true }
    }
    const targetParent = currentParentOf(row.source)
    const outdenting = horizontalDelta <= -24 && targetParent !== undefined
    const parent = outdenting ? currentParentOf(targetParent!) : targetParent
    const before = clientY < rect.top + rect.height / 2
    // When outdenting, the row itself is not a sibling at the new depth. Anchor
    // against its parent instead, which is the target's peer at that depth.
    const anchor = outdenting ? targetParent! : row.source
    const insertBefore = before ? anchor : nextSiblingOf(anchor, parent)
    if (!canMoveTo(parent, insertBefore)) return undefined
    return { parent, insertBefore, indicatorSourceRef: row.source.sourceRef, before, into: false }
  }
  const finishTopicMove = (plan: ArkmeTopicMovePlan | undefined) => {
    if (plan === undefined || !canMoveTo(plan.parent, plan.insertBefore) || draggingSource === undefined || onMoveTopic === undefined) return
    const movedSource = draggingSource
    setMovingTopic(true)
    setMoveError('')
    setDropPlan(undefined)
    setDraggingSourceRef(undefined)
    void onMoveTopic(movedSource, currentParentOf(movedSource), plan.parent, plan.insertBefore).catch(caught => {
      setMoveError(caught instanceof Error ? caught.message : '主题层级调整失败，请重试')
    }).finally(() => { setMovingTopic(false) })
  }
  const revealSelectedTopic = () => {
    if (selectedRef === undefined) {
      menuListRef.current?.scrollTo({ top: 0 })
      pendingSelectedFocusRef.current = false
      return
    }
    setCollapsedSourceRefs(current => {
      const next = new Set(current)
      const visited = new Set<string>()
      let ancestor = sourceByRef.get(selectedRef)
      while (ancestor !== undefined && !visited.has(ancestor.sourceRef)) {
        visited.add(ancestor.sourceRef)
        const parent = currentParentOf(ancestor)
        if (parent === undefined) break
        next.delete(parent.sourceRef)
        ancestor = parent
      }
      return next
    })
    pendingSelectedFocusRef.current = true
  }
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
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false)
        setTopicMenuSource(undefined)
      }
    }
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (topicMenuSource !== undefined) setTopicMenuSource(undefined)
      else setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside, true)
    document.addEventListener('keydown', closeEscape, true)
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true)
      document.removeEventListener('keydown', closeEscape, true)
    }
  }, [open, topicMenuSource])

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

  const selectAggregate = () => { setOpen(false); onSelectAggregate() }
  const selectTopic = (source: ArkmeSourceItem) => { setOpen(false); onSelect(source) }
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
      setOpen(false)
    }).catch(caught => {
      setTopicMutationError(caught instanceof Error ? caught.message : '主题解散失败，请重试')
    }).finally(() => { setTopicMutationSubmitting(false) })
  }

  return <nav ref={rootRef} aria-label="发给自己主题" style={styles.breadcrumb}>
    <span data-arkme-self-topic-root="true" style={styles.fixedTitle}>发给自己</span>
    <button
      type="button" aria-label="选择主题" aria-haspopup="tree" aria-expanded={open}
      data-arkme-self-topic-selector="true" title={label}
      style={{ ...styles.selector, ...(open ? styles.selectorOpen : {}) }}
      onClick={() => {
        if (open) { setOpen(false); return }
        revealSelectedTopic()
        setOpen(true)
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
      <svg aria-hidden viewBox="0 0 12 12" style={{ ...styles.caret, transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>
        <path d="m2.5 4.5 3.5 3.25 3.5-3.25" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
    {activeDissolveRunning && activeDissolveTopic !== undefined && <button
      type="button" aria-label="查看解散进度" style={styles.dissolveProgressTrigger} onClick={openActiveDissolve}
    ><span aria-hidden style={styles.dissolveProgressIcon}><ArkmeTopicLoadingIcon /></span>{activeDissolveLabel}</button>}
    {open && <div role="tree" aria-label="主题" style={styles.menu}>
      <div role="group" aria-label="主题排序" style={styles.sortGroup}>
        {([
          ['latest', '最新'],
          ['most', '最多'],
          ['custom', '自定义'],
        ] as const).map(([value, label]) => <button
          key={value} type="button" aria-pressed={sort === value}
          style={{ ...styles.sortButton, ...(sort === value ? styles.sortButtonActive : {}) }}
          onClick={() => {
            setSort(value)
            revealSelectedTopic()
          }}
        >{label}</button>)}
      </div>
      {selectedPath.length > 0 && <div aria-label="当前主题路径" title={label} style={styles.currentPath}>当前：{label}</div>}
      <div ref={menuListRef} style={styles.menuList}>
      <button type="button" role="treeitem" aria-level={1} aria-selected={selectedRef === undefined}
        style={{ ...styles.option, ...styles.aggregateOption, ...(selectedRef === undefined ? styles.optionSelected : {}) }} onClick={selectAggregate}
      ><span aria-hidden style={styles.topicSpacer} /><span style={styles.optionLabel}>全部</span><span aria-label={`${topicCountLabel(allTopicsCount)} 条快记或消息`} style={styles.topicCount}>{topicCountLabel(allTopicsCount)}</span></button>
      {rows.map(row => {
        const isSelected = selectedRef === row.source.sourceRef
        const isHovered = hoveredSourceRef === row.source.sourceRef
        const isDefaultCategory = row.source.kind === 'default_category'
        const canCreateChild = !isDefaultCategory && onCreateChildTopic !== undefined && row.depth + 1 < ARKME_TOPIC_HIERARCHY_MAX_LEVEL
        const canManageTopic = !isDefaultCategory && (canCreateChild || onRenameTopic !== undefined || onDissolveTopic !== undefined)
        const showActions = isHovered && canManageTopic
        const manageMenuOpen = topicMenuSource?.sourceRef === row.source.sourceRef
        const displayedCount = (row.hasChildren || row.source.hasPendingChildren === true) && !countsComplete
          ? undefined
          : aggregateTopicCounts.get(row.source.sourceRef) ?? topicDirectRecordCount(row.source)
        return <div key={row.source.sourceRef}>
        <div
          role="treeitem" aria-level={row.depth + 1}
          aria-selected={selectedRef === row.source.sourceRef}
          {...(row.hasChildren ? { 'aria-expanded': row.expanded } : {})}
          data-arkme-self-topic-tree-row="true"
          data-arkme-self-topic-tree-row-ref={row.source.sourceRef}
          style={{
            ...styles.topicRow, paddingLeft: row.depth * 16,
            ...(isHovered && !isSelected ? styles.topicRowHover : {}),
            ...(dropPlan?.indicatorSourceRef === row.source.sourceRef ? styles.topicRowDropTarget : {}),
            ...(dropPlan?.indicatorSourceRef === row.source.sourceRef && dropPlan.into
              ? styles.topicRowDropInto
              : dropPlan?.indicatorSourceRef === row.source.sourceRef && dropPlan.before ? styles.topicRowDropBefore :
                dropPlan?.indicatorSourceRef === row.source.sourceRef ? styles.topicRowDropAfter : {}),
          }}
          onMouseEnter={() => { setHoveredSourceRef(row.source.sourceRef) }}
          onMouseLeave={() => {
            setHoveredSourceRef(current => current === row.source.sourceRef ? undefined : current)
            setTopicMenuSource(current => current?.sourceRef === row.source.sourceRef ? undefined : current)
            setHoveredTopicMenuAction(current => current?.startsWith(`${row.source.sourceRef}:`) ? undefined : current)
          }}
          onDragOver={event => {
            const plan = planMoveAtRow(row, event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
            if (plan === undefined) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            setDropPlan(plan)
          }}
          onDrop={event => {
            event.preventDefault()
            finishTopicMove(planMoveAtRow(row, event.clientX, event.clientY, event.currentTarget.getBoundingClientRect()))
          }}
        >
          {row.hasChildren ? <button
            type="button" aria-label={`${row.expanded ? '收起' : '展开'}${row.source.displayName}`}
            title={row.expanded ? '收起子主题' : '展开子主题'} style={styles.topicToggle}
            onClick={() => { toggleTopicExpansion(row.source.sourceRef) }}
          ><svg aria-hidden viewBox="0 0 12 12" width="12" height="12" style={{ transform: row.expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .16s ease' }}>
            <path d="m4 2.5 3.5 3.5L4 9.5" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
          </svg></button> : <span aria-hidden style={styles.topicSpacer}>{isDefaultCategory ? '' : '·'}</span>}
          <button type="button" draggable={customDragEnabled && !isDefaultCategory}
            style={{ ...styles.topicSelect, ...(isSelected ? styles.topicSelectSelected : {}) }}
            onDragStart={event => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', row.source.sourceRef)
              dragStartXRef.current = event.clientX
              setMoveError('')
              setDraggingSourceRef(row.source.sourceRef)
            }}
            onDragEnd={() => { setDraggingSourceRef(undefined); setDropPlan(undefined) }}
            onClick={() => { selectTopic(row.source) }}
          ><span style={styles.topicName}>{row.source.displayName}</span><span
            aria-label={`${topicCountLabel(displayedCount)} 条快记或消息`}
            style={{ ...styles.topicCount, ...(showActions ? styles.topicCountHidden : {}) }}
          >{topicCountLabel(displayedCount)}</span></button>
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
          setDropPlan({ parent: undefined, insertBefore: undefined, indicatorSourceRef: 'root', before: false, into: false })
        }}
        onDrop={event => {
          event.preventDefault()
          finishTopicMove({ parent: undefined, insertBefore: undefined, indicatorSourceRef: 'root', before: false, into: false })
        }}
      >拖到这里，变为一级主题</div>}
      {moveError !== '' && <div role="alert" style={styles.loadingRow}>{moveError}</div>}
      {loading && <div role="status" data-arkme-self-topic-loading="true" style={styles.loadingRow}><ArkmeTopicLoadingIcon />加载更多主题</div>}
      {!loading && error !== undefined && <div role="alert" style={styles.loadingRow}>
        加载失败
        {onRetry !== undefined && <button type="button" style={styles.retry} onClick={onRetry}>重试</button>}
      </div>}
      </div>
      {onCreateTopic !== undefined && <div style={styles.createFooter}>
        <button type="button" aria-label="创建主题" style={styles.createButton} onClick={() => {
          setOpen(false)
          onCreateTopic()
        }}><span aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>＋</span>创建主题</button>
      </div>}
    </div>}
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
