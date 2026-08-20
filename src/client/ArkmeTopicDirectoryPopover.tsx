import {
  useCallback, useEffect, useMemo, useRef, useState, type CSSProperties,
} from 'react'
import type {
  ArkmeSourceItem, ArkmeSourceList, ArkmeTopicCreateResult,
} from '../types.js'
import { callArkme } from './api.js'
import { ArkmeTopicCreateDialog } from './ArkmeTopicCreateDialog.js'
import {
  ArkmeSourceSortControl, ArkmeTopicCard, ArkmeTopicCreateFooter, ArkmeTopicTreeRow,
  canCreateChildTopicAtParentLevel,
  expandAncestorsForReveal, expandTopicFromRowClick, mergeCreatedTopicSource,
  toggleTopicCollapsedState,
} from './ArkmeVirtualWorkspace.js'
import {
  readNavigationCache, reconcileSelectedSource, writeNavigationCache,
  type ArkmeNavigationCache,
} from './navigation-cache.js'
import {
  buildArkmeSourceTree, flattenVisibleArkmeSourceTree,
} from './source-tree.js'
import { arkmeSelfDirectorySources, sortArkmeSources, type ArkmeSourceSort } from './source-list.js'

export interface ArkmeTopicDirectoryPopoverProps {
  userId: number
  selectedSource: ArkmeSourceItem | undefined
  onSelect(source: ArkmeSourceItem): void
  onSelectionInvalidated(): void
  onSelfSourcesResolution(userId: number, resolution: ArkmeSelfSourcesResolution): void
  retryRevision: number
}

export type ArkmeSelfSourcesResolution =
  | { status: 'loading' }
  | { status: 'ready'; aggregateSource: ArkmeSourceItem; defaultCategorySource: ArkmeSourceItem }
  | { status: 'error'; message: string }

export type ArkmeTopicSelectionReconciliation =
  | { status: 'aggregate' }
  | { status: 'selected'; source: ArkmeSourceItem }
  | { status: 'invalid' }

export function reconcileArkmeTopicSelection(
  selectedSource: ArkmeSourceItem | undefined,
  loaded: ArkmeSourceItem[],
): ArkmeTopicSelectionReconciliation {
  if (selectedSource === undefined) return { status: 'aggregate' }
  const source = reconcileSelectedSource(selectedSource, loaded)
  return source === undefined ? { status: 'invalid' } : { status: 'selected', source }
}

const colors = {
  text: 'var(--dsw-alias-label-primary, #242629)',
  secondary: 'var(--dsw-alias-label-secondary, #8a9099)',
  caption: 'var(--dsw-alias-label-caption, #b0b5bc)',
  border: 'var(--dsw-alias-border-l1, #eceef0)',
  surface: 'var(--dsw-alias-bg-base, rgba(255,255,255,.97))',
}

export const ARKME_TOPIC_DIRECTORY_POPOVER_MAX_HEIGHT = 'min(550px, calc(100vh - 112px))'

const styles: Record<string, CSSProperties> = {
  trigger: {
    zIndex: 3, width: 28, height: 28, flex: 'none', marginLeft: 'auto',
    display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: 8,
    background: 'transparent', color: colors.secondary, cursor: 'pointer',
  },
  triggerActive: {
    color: 'var(--dsw-alias-state-success, #176d3d)',
    background: 'var(--dsw-alias-fill-secondary, rgba(23,109,61,.08))',
  },
  popover: {
    position: 'absolute', zIndex: 12, top: 48, right: 48,
    width: 'min(340px, calc(100% - 32px))', maxHeight: ARKME_TOPIC_DIRECTORY_POPOVER_MAX_HEIGHT,
    display: 'grid', gridTemplateRows: 'auto auto minmax(0, 1fr)', overflow: 'hidden',
    boxSizing: 'border-box', border: `1px solid ${colors.border}`, borderRadius: 16,
    background: colors.surface,
    boxShadow: '0 24px 64px rgba(20,24,31,.18), 0 2px 10px rgba(20,24,31,.06)',
    backdropFilter: 'blur(24px) saturate(1.08)', WebkitBackdropFilter: 'blur(24px) saturate(1.08)',
  },
  head: {
    minHeight: 48, display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 10px 6px 16px', boxSizing: 'border-box',
  },
  heading: { flex: 1, margin: 0, fontSize: 14, lineHeight: '20px', fontWeight: 500 },
  close: {
    width: 28, height: 28, display: 'grid', placeItems: 'center', padding: 0,
    border: 0, borderRadius: 8, background: 'transparent', color: colors.secondary,
    cursor: 'pointer', font: 'inherit', fontSize: 20,
  },
  search: {
    height: 34, display: 'flex', alignItems: 'center', gap: 8,
    margin: '0 14px 10px', padding: '0 10px', boxSizing: 'border-box', borderRadius: 9,
    background: 'var(--dsw-alias-fill-secondary, #f3f4f5)', color: colors.caption,
  },
  searchInput: {
    width: '100%', minWidth: 0, border: 0, outline: 0, padding: 0,
    background: 'transparent', color: colors.text, font: 'inherit', fontSize: 12,
  },
  tree: {
    minHeight: 120, overflowY: 'auto', margin: 0, padding: '2px 0 74px', listStyle: 'none',
  },
  status: { padding: '22px 18px 80px', color: colors.secondary, fontSize: 12, textAlign: 'center' },
  error: { color: '#c2413b' },
}

/** Keep matching topics and their ancestors so search never destroys the directory hierarchy. */
export function filterArkmeTopicSources(
  sources: readonly ArkmeSourceItem[],
  queryInput: string,
): ArkmeSourceItem[] {
  const query = queryInput.trim().toLocaleLowerCase()
  if (query === '') return [...sources]
  const byRef = new Map(sources.map(source => [source.sourceRef, source]))
  const included = new Set<string>()
  for (const source of sources) {
    if (!source.displayName.toLocaleLowerCase().includes(query)) continue
    let current: ArkmeSourceItem | undefined = source
    const visited = new Set<string>()
    while (current !== undefined && !visited.has(current.sourceRef)) {
      visited.add(current.sourceRef)
      included.add(current.sourceRef)
      current = current.parentSourceRef === undefined ? undefined : byRef.get(current.parentSourceRef)
    }
  }
  return sources.filter(source => included.has(source.sourceRef))
}

function cacheWithTopics(
  userId: number,
  sources: ArkmeSourceItem[],
  selectedSourceRef?: string | null,
): ArkmeNavigationCache {
  const current = readNavigationCache(userId) ?? {
    version: 1,
    userId,
    directory: 'root',
    sources: {},
    updatedAtMillis: 0,
  }
  const next: ArkmeNavigationCache = {
    ...current,
    directory: 'root',
    sources: { ...current.sources, send_to_self: sources },
    updatedAtMillis: Date.now(),
    ...(selectedSourceRef === undefined
      ? (current.selectedSourceRef === undefined ? {} : { selectedSourceRef: current.selectedSourceRef })
      : selectedSourceRef === null ? {} : { selectedSourceRef }),
  }
  if (selectedSourceRef !== null) return next
  const { selectedSourceRef: _selectedSourceRef, ...cleared } = next
  return cleared
}

export function ArkmeTopicDirectoryPopover({
  userId, selectedSource, onSelect, onSelectionInvalidated, onSelfSourcesResolution, retryRevision,
}: ArkmeTopicDirectoryPopoverProps) {
  const initialCache = useMemo(() => readNavigationCache(userId), [userId])
  const requestRef = useRef<AbortController>()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const createRequestRef = useRef(false)
  const selectedSourceRef = useRef(selectedSource)
  selectedSourceRef.current = selectedSource
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [sources, setSources] = useState<ArkmeSourceItem[]>(initialCache?.sources.send_to_self ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [collapsedSourceRefs, setCollapsedSourceRefs] = useState<Set<string>>(() => new Set())
  const [sourceSort, setSourceSort] = useState<ArkmeSourceSort>('default')
  const [hoveredSourceRef, setHoveredSourceRef] = useState<string>()
  const [topicCreateParent, setTopicCreateParent] = useState<ArkmeSourceItem | null>()
  const [topicCreateParentLevel, setTopicCreateParentLevel] = useState<number>()
  const [topicCreateError, setTopicCreateError] = useState('')
  const [topicCreateSubmitting, setTopicCreateSubmitting] = useState(false)
  const sourcesRef = useRef(sources)
  sourcesRef.current = sources

  const persist = useCallback((nextSources: ArkmeSourceItem[], selectedRef?: string | null) => {
    writeNavigationCache(cacheWithTopics(userId, nextSources, selectedRef))
  }, [userId])

  const load = useCallback(async () => {
    const controller = new AbortController()
    requestRef.current?.abort()
    requestRef.current = controller
    setBusy(true)
    setError('')
    if (!sourcesRef.current.some(source => source.kind === 'send_to_self')
      || !sourcesRef.current.some(source => source.kind === 'default_category')) {
      onSelfSourcesResolution(userId, { status: 'loading' })
    }
    try {
      const loaded: ArkmeSourceItem[] = []
      let cursor: string | undefined
      for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
        const page = await callArkme<ArkmeSourceList>('sources.list', {
          directory: 'send_to_self', limit: 100,
          ...(cursor === undefined ? {} : { cursor }),
        }, controller.signal)
        const known = new Set(loaded.map(source => source.sourceRef))
        loaded.push(...page.items.filter(source => !known.has(source.sourceRef)))
        if (!page.hasMore || page.nextCursor === undefined) break
        cursor = page.nextCursor
      }
      if (controller.signal.aborted) return
      setSources(loaded)
      const currentSelected = selectedSourceRef.current
      const reconciliation = reconcileArkmeTopicSelection(currentSelected, loaded)
      if (reconciliation.status === 'selected') {
        selectedSourceRef.current = reconciliation.source
        onSelect(reconciliation.source)
        persist(loaded, reconciliation.source.sourceRef)
      } else if (reconciliation.status === 'invalid') {
        selectedSourceRef.current = undefined
        onSelectionInvalidated()
        persist(loaded, null)
      } else {
        persist(loaded, null)
      }
      const aggregateSource = loaded.find(source => source.kind === 'send_to_self')
      const defaultCategorySource = loaded.find(source => source.kind === 'default_category')
      if (aggregateSource === undefined || defaultCategorySource === undefined) {
        const message = '未找到发给自己或默认分类，请重试'
        setError(message)
        onSelfSourcesResolution(userId, { status: 'error', message })
      }
    } catch (caught) {
      if (!controller.signal.aborted) {
        const message = caught instanceof Error ? caught.message : String(caught)
        setError(message)
        if (!sourcesRef.current.some(source => source.kind === 'send_to_self')
          || !sourcesRef.current.some(source => source.kind === 'default_category')) {
          onSelfSourcesResolution(userId, { status: 'error', message })
        }
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false)
      if (requestRef.current === controller) requestRef.current = undefined
    }
  }, [onSelfSourcesResolution, onSelect, onSelectionInvalidated, persist, userId])

  useEffect(() => {
    void load()
    return () => { requestRef.current?.abort() }
  }, [load, retryRevision, userId])

  useEffect(() => {
    const aggregateSource = sources.find(source => source.kind === 'send_to_self')
    const defaultCategorySource = sources.find(source => source.kind === 'default_category')
    if (aggregateSource === undefined || defaultCategorySource === undefined) return
    onSelfSourcesResolution(userId, { status: 'ready', aggregateSource, defaultCategorySource })
  }, [onSelfSourcesResolution, sources, userId])

  useEffect(() => {
    if (!open && topicCreateParent === undefined) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node) || topicCreateParent !== undefined) return
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (topicCreateParent !== undefined) {
        if (!topicCreateSubmitting) {
          setTopicCreateParent(undefined)
          setTopicCreateParentLevel(undefined)
          setTopicCreateError('')
        }
        return
      }
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, topicCreateParent, topicCreateSubmitting])

  const directorySources = useMemo(
    () => arkmeSelfDirectorySources(sources),
    [sources],
  )
  const filteredSources = useMemo(() => filterArkmeTopicSources(directorySources, query), [directorySources, query])
  const cardMode = sourceSort !== 'default' && query.trim() === ''
  const cardSources = useMemo(
    () => cardMode ? sortArkmeSources(directorySources, sourceSort) : [],
    [cardMode, directorySources, sourceSort],
  )
  const rows = useMemo(
    () => flattenVisibleArkmeSourceTree(buildArkmeSourceTree(filteredSources), collapsedSourceRefs),
    [collapsedSourceRefs, filteredSources],
  )

  const selectSource = (nextSource: ArkmeSourceItem) => {
    selectedSourceRef.current = nextSource
    onSelect(nextSource)
    persist(sources, nextSource.sourceRef)
    setOpen(false)
    setQuery('')
  }
  const selectRow = (row: (typeof rows)[number]) => {
    setCollapsedSourceRefs(current => expandTopicFromRowClick(row, current))
    selectSource(row.source)
  }
  const openCreate = (parent: ArkmeSourceItem | null, parentLevel?: number) => {
    setTopicCreateParent(parent)
    setTopicCreateParentLevel(parentLevel)
    setTopicCreateError('')
  }
  const cancelCreate = () => {
    if (createRequestRef.current) return
    setTopicCreateParent(undefined)
    setTopicCreateParentLevel(undefined)
    setTopicCreateError('')
  }
  const submitCreate = async (title: string) => {
    if (topicCreateParent === undefined || createRequestRef.current) return
    const parent = topicCreateParent
    if (parent !== null && !canCreateChildTopicAtParentLevel(topicCreateParentLevel)) {
      setTopicCreateError('主题最多支持五级层级，无法继续创建子主题')
      return
    }
    createRequestRef.current = true
    setTopicCreateSubmitting(true)
    setTopicCreateError('')
    try {
      const result = await callArkme<ArkmeTopicCreateResult>('topic.create', {
        title,
        ...(parent === null ? {} : { parentSourceRef: parent.sourceRef }),
      })
      const nextSources = mergeCreatedTopicSource(sources, result.source)
      setSources(nextSources)
      setCollapsedSourceRefs(current => expandAncestorsForReveal(nextSources, result.source.sourceRef, current))
      persist(nextSources)
      setTopicCreateParent(undefined)
      setTopicCreateParentLevel(undefined)
      setQuery('')
      if (result.warning !== undefined) setError(result.warning)
    } catch (caught) {
      setTopicCreateError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      createRequestRef.current = false
      setTopicCreateSubmitting(false)
    }
  }

  return <>
    <button
      ref={triggerRef} type="button" aria-label="打开分类目录" title="分类目录" aria-haspopup="dialog" aria-expanded={open}
      style={{ ...styles.trigger, ...(open ? styles.triggerActive : {}) }}
      onClick={() => { setOpen(value => !value) }}
    ><svg aria-hidden viewBox="0 0 24 24" width="17" height="17" fill="none">
      <circle cx="6" cy="7" r="1.2" fill="currentColor" />
      <circle cx="6" cy="12" r="1.2" fill="currentColor" />
      <circle cx="6" cy="17" r="1.2" fill="currentColor" />
      <path d="M9.5 7H19M9.5 12H16.5M9.5 17H19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg></button>
    {open && <div ref={popoverRef} role="dialog" aria-label="目录" style={styles.popover}>
      <div style={styles.head}>
        <h3 style={styles.heading}>目录</h3>
        <ArkmeSourceSortControl value={sourceSort} onChange={value => {
          setSourceSort(value)
          setHoveredSourceRef(undefined)
        }} />
        <button type="button" aria-label="关闭目录" style={styles.close} onClick={() => { setOpen(false) }}>×</button>
      </div>
      <label style={styles.search}>
        <svg aria-hidden viewBox="0 0 16 16" width="14" height="14" fill="none">
          <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.3" />
          <path d="m10.2 10.2 3.05 3.05" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <input
          type="search" value={query} placeholder="搜索主题" aria-label="搜索主题" style={styles.searchInput}
          onChange={event => { setQuery(event.currentTarget.value) }}
        />
      </label>
      <div role={cardMode ? 'list' : 'tree'} aria-label="主题目录" style={styles.tree}>
        {!cardMode && rows.map(row => {
          const source = row.source
          return <ArkmeTopicTreeRow
            key={source.sourceRef} row={row}
            selected={selectedSource?.sourceRef === source.sourceRef}
            hovered={hoveredSourceRef === source.sourceRef}
            onHoverChange={hovered => { setHoveredSourceRef(hovered ? source.sourceRef : undefined) }}
            onToggle={() => { setCollapsedSourceRefs(current => toggleTopicCollapsedState(source.sourceRef, current)) }}
            onSelect={() => { selectRow(row) }}
            onCreateChild={() => { openCreate(source, row.depth + 1) }}
          />
        })}
        {cardMode && cardSources.map(source => <ArkmeTopicCard
          key={source.sourceRef}
          source={source}
          selected={selectedSource?.sourceRef === source.sourceRef}
          hovered={hoveredSourceRef === source.sourceRef}
          onHoverChange={hovered => { setHoveredSourceRef(hovered ? source.sourceRef : undefined) }}
          onSelect={() => { selectSource(source) }}
        />)}
        {busy && (cardMode ? cardSources.length === 0 : rows.length === 0) && <div role="status" style={styles.status}>正在加载目录…</div>}
        {!busy && error === '' && (cardMode ? cardSources.length === 0 : rows.length === 0) && <div style={styles.status}>{query.trim() === '' ? '暂无主题' : '没有匹配的主题'}</div>}
        {error !== '' && <div role="alert" style={{ ...styles.status, ...styles.error }}>
          <div>{error}</div>
          <button type="button" style={{ ...styles.close, width: 'auto', margin: '8px auto 0', padding: '0 10px', fontSize: 12 }}
            onClick={() => { void load() }}>重试</button>
        </div>}
      </div>
      <ArkmeTopicCreateFooter onCreate={() => { openCreate(null) }} />
    </div>}
    {topicCreateParent !== undefined && <ArkmeTopicCreateDialog
      key={topicCreateParent?.sourceRef ?? 'root'}
      mode={topicCreateParent === null ? 'topic' : 'child'}
      submitting={topicCreateSubmitting} error={topicCreateError}
      onCancel={cancelCreate} onConfirm={title => { void submitCreate(title) }}
    />}
  </>
}
