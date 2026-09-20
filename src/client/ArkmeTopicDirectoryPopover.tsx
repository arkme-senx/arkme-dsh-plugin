import { tr, useArkmeLocale } from './locale.js'
import {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties,
} from 'react'
import { ListBullets } from '@phosphor-icons/react/dist/icons/ListBullets'
import type {
  ArkmeEnvironment, ArkmeSourceItem, ArkmeTopicCreateResult,
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
  arkmeTopicPathNames, buildArkmeSourceTree, flattenVisibleArkmeSourceTree,
} from './source-tree.js'
import { arkmeSelfDirectorySources, sortArkmeSources, type ArkmeSourceSort } from './source-list.js'
import { arkmeTheme } from './arkme-theme.js'
import { useSelfTopicExpansion } from './self-topic-expansion-preference.js'
import { mergeSelfTopicSources, selfTopicDirectory } from './self-topic-directory-cache.js'
import { filterArkmeTopicSources } from './topic-search.js'
export { filterArkmeTopicSources } from './topic-search.js'

export interface ArkmeTopicDirectoryPopoverProps {
  userId: number
  environment?: ArkmeEnvironment
  selectedSource: ArkmeSourceItem | undefined
  trigger?: 'button' | 'none'
  onSelect(source: ArkmeSourceItem): void
  onSelectionRefreshed?(source: ArkmeSourceItem): void
  onSelectionInvalidated(): void
  onCreateWarning(message: string): void
  onSelfSourcesResolution(userId: number, resolution: ArkmeSelfSourcesResolution): void
  onCreateTopicReady?(open: ArkmeTopicCreateOpener | undefined): void
  retryRevision: number
}

export type ArkmeTopicCreateOpener = (parent?: ArkmeSourceItem | null, parentLevel?: number) => void

export type ArkmeSelfSourcesResolution =
  | { status: 'loading' }
  | {
    status: 'ready'
    aggregateSource: ArkmeSourceItem
    defaultCategorySource: ArkmeSourceItem
    sources: ArkmeSourceItem[]
    loading: boolean
    complete?: boolean
    error?: string
  }
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

/** Merge successive pages without discarding hierarchy metadata refreshed on a later page. */
export function mergeArkmeTopicSourcePages(
  current: readonly ArkmeSourceItem[], incoming: readonly ArkmeSourceItem[],
): ArkmeSourceItem[] {
  return mergeSelfTopicSources(current, incoming)
}

const colors = {
  text: arkmeTheme.text,
  secondary: arkmeTheme.secondary,
  caption: arkmeTheme.caption,
  border: arkmeTheme.borderSoft,
  surface: arkmeTheme.menu,
  input: arkmeTheme.input,
}

export const ARKME_TOPIC_DIRECTORY_POPOVER_MAX_HEIGHT = 'min(550px, calc(100vh - 112px))'
export const ARKME_TOPIC_DIRECTORY_SEARCH_BG = arkmeTheme.input

const styles: Record<string, CSSProperties> = {
  trigger: {
    zIndex: 3, width: 28, height: 28, flex: 'none', marginRight: 7,
    display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: 8,
    background: 'transparent', color: colors.secondary, cursor: 'pointer',
  },
  triggerActive: {
    color: '#30333b',
    background: '#f1f2f6',
  },
  popover: {
    position: 'absolute', zIndex: 12, top: 48, left: 20,
    width: 'min(340px, calc(100% - 32px))', maxHeight: ARKME_TOPIC_DIRECTORY_POPOVER_MAX_HEIGHT,
    display: 'grid', gridTemplateRows: 'auto auto minmax(0, 1fr)', overflow: 'hidden',
    boxSizing: 'border-box', border: `1px solid ${colors.border}`, borderRadius: 16,
    background: colors.surface,
    boxShadow: arkmeTheme.shadow,
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
    background: ARKME_TOPIC_DIRECTORY_SEARCH_BG, color: colors.caption,
  },
  searchInput: {
    width: '100%', minWidth: 0, border: 0, outline: 0, padding: 0,
    background: 'transparent', color: colors.text, font: 'inherit', fontSize: 12,
  },
  tree: {
    minHeight: 120, overflowY: 'auto', margin: 0, padding: '2px 0 74px', listStyle: 'none',
  },
  status: { padding: '22px 18px 80px', color: colors.secondary, fontSize: 12, textAlign: 'center' },
  error: { color: arkmeTheme.danger },
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
  userId, environment = 'prod', selectedSource, trigger = 'button', onSelect, onSelectionRefreshed = onSelect, onSelectionInvalidated, onSelfSourcesResolution, onCreateWarning, onCreateTopicReady, retryRevision,
}: ArkmeTopicDirectoryPopoverProps) {
  useArkmeLocale()
  const directory = useMemo(() => selfTopicDirectory(userId, environment), [userId, environment])
  const snapshot = useSyncExternalStore(directory.subscribe, directory.getSnapshot, directory.getSnapshot)
  const resolvedRoots = useRef<{ directory: typeof directory; aggregateSource: ArkmeSourceItem; defaultCategorySource: ArkmeSourceItem }>()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const createRequestRef = useRef<symbol>()
  const selectedSourceRef = useRef(selectedSource)
  selectedSourceRef.current = selectedSource
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { sources, loading: busy, error, complete } = snapshot
  const [collapsedSourceRefs, setCollapsedSourceRefs] = useSelfTopicExpansion(userId, environment, sources)
  const [sourceSort, setSourceSort] = useState<ArkmeSourceSort>('default')
  const [hoveredSourceRef, setHoveredSourceRef] = useState<string>()
  const [topicCreateParent, setTopicCreateParent] = useState<ArkmeSourceItem | null>()
  const [topicCreateParentLevel, setTopicCreateParentLevel] = useState<number>()
  const [topicCreateError, setTopicCreateError] = useState('')
  const [topicCreateSubmitting, setTopicCreateSubmitting] = useState(false)
  const sourcesRef = useRef(sources)
  sourcesRef.current = sources

  useEffect(() => () => { createRequestRef.current = undefined }, [])

  const persist = useCallback((nextSources: ArkmeSourceItem[], selectedRef?: string | null) => {
    writeNavigationCache(cacheWithTopics(userId, nextSources, selectedRef))
  }, [userId])

  const firstLoad = useRef(true)
  useEffect(() => {
    let disposed = false
    const force = !firstLoad.current
    firstLoad.current = false
    void directory.ensure(force).then(() => {
      if (disposed) return
      const result = directory.getSnapshot()
      if (!result.complete || result.error) return
      const loaded = result.sources
      const reconciliation = reconcileArkmeTopicSelection(selectedSourceRef.current, loaded)
      if (reconciliation.status === 'selected') {
        selectedSourceRef.current = reconciliation.source
        onSelectionRefreshed(reconciliation.source)
        persist(loaded, reconciliation.source.sourceRef)
      } else if (reconciliation.status === 'invalid') {
        selectedSourceRef.current = undefined
        onSelectionInvalidated()
        persist(loaded, null)
      } else {
        persist(loaded, null)
      }
    })
    return () => { disposed = true }
  }, [directory, retryRevision, onSelectionRefreshed, onSelectionInvalidated, persist])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const refresh = () => { if (document.visibilityState !== 'hidden') void directory.ensure() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [directory])

  useEffect(() => {
    // Directory invalidation clears visible topics/counts, not the mounted conversation's route.
    const previous = error === '' && resolvedRoots.current?.directory === directory ? resolvedRoots.current : undefined
    const aggregateSource = sources.find(source => source.kind === 'send_to_self') ?? previous?.aggregateSource
    const defaultCategorySource = sources.find(source => source.kind === 'default_category') ?? previous?.defaultCategorySource
    if (aggregateSource === undefined || defaultCategorySource === undefined) {
      resolvedRoots.current = undefined
      onSelfSourcesResolution(userId, error ? { status: 'error', message: error } : { status: 'loading' })
      return
    }
    resolvedRoots.current = { directory, aggregateSource, defaultCategorySource }
    onSelfSourcesResolution(userId, {
      status: 'ready', aggregateSource, defaultCategorySource, sources, loading: busy, complete,
      ...(error === '' ? {} : { error }),
    })
  }, [busy, complete, directory, error, onSelfSourcesResolution, sources, userId])

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

  const selectSource = (nextSource: ArkmeSourceItem, nextSources = sources) => {
    selectedSourceRef.current = nextSource
    persist(nextSources, nextSource.sourceRef)
    setOpen(false)
    setQuery('')
    onSelect(nextSource)
  }
  const selectRow = (row: (typeof rows)[number]) => {
    setCollapsedSourceRefs(current => expandTopicFromRowClick(row, new Set(current)))
    selectSource(row.source)
  }
  const openCreate = useCallback((parent: ArkmeSourceItem | null, parentLevel?: number) => {
    setTopicCreateParent(parent)
    setTopicCreateParentLevel(parentLevel)
    setTopicCreateError('')
  }, [])
  useEffect(() => {
    if (onCreateTopicReady === undefined) return
    onCreateTopicReady((parent = null, parentLevel) => { openCreate(parent, parentLevel) })
    return () => { onCreateTopicReady(undefined) }
  }, [onCreateTopicReady, openCreate])
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
    const contextSource = parent ?? selectedSourceRef.current
      ?? sourcesRef.current.find(source => source.kind === 'send_to_self')
    if (contextSource === undefined) {
      setTopicCreateError('主题列表尚未加载完成，请稍后重试')
      return
    }
    const request = Symbol()
    createRequestRef.current = request
    setTopicCreateSubmitting(true)
    setTopicCreateError('')
    try {
      const result = await callArkme<ArkmeTopicCreateResult>('topic.create', {
        title,
        contextSourceRef: contextSource.sourceRef,
        ...(parent === null ? {} : { parentSourceRef: parent.sourceRef }),
      })
      if (createRequestRef.current !== request) return
      const nextSources = mergeCreatedTopicSource(sourcesRef.current, result.source)
      sourcesRef.current = nextSources
      directory.upsert(result.source)
      setCollapsedSourceRefs(current => expandAncestorsForReveal(nextSources, result.source.sourceRef, current), nextSources)
      setTopicCreateParent(undefined)
      setTopicCreateParentLevel(undefined)
      setQuery('')
      if (result.warning !== undefined) {
        persist(nextSources)
        onCreateWarning(result.warning)
      } else {
        selectSource(result.source, nextSources)
      }
    } catch (caught) {
      if (createRequestRef.current === request) {
        setTopicCreateError(caught instanceof Error ? caught.message : String(caught))
      }
    } finally {
      if (createRequestRef.current === request) {
        createRequestRef.current = undefined
        setTopicCreateSubmitting(false)
      }
    }
  }

  return <>
    {trigger === 'button' && <button data-arkme-feedback="neutral" data-arkme-feedback-selected={open}
      ref={triggerRef} type="button" aria-label={tr("打开主题")} title={tr("主题")} aria-haspopup="dialog" aria-expanded={open}
      data-arkme-topic-directory-trigger="leading"
      style={{ ...styles.trigger, ...(open ? styles.triggerActive : {}) }}
      onClick={() => { setOpen(value => !value) }}
    ><ListBullets size={17} aria-hidden /></button>}
    {open && <div ref={popoverRef} role="dialog" aria-label={tr("主题")} style={styles.popover}>
      <div style={styles.head}>
        <h3 style={styles.heading}>{tr("主题")}</h3>
        <ArkmeSourceSortControl value={sourceSort} onChange={value => {
          setSourceSort(value)
          setHoveredSourceRef(undefined)
        }} />
        <button data-arkme-feedback="neutral" type="button" aria-label={tr("关闭主题")} style={styles.close} onClick={() => { setOpen(false) }}>×</button>
      </div>
      <label style={styles.search}>
        <svg aria-hidden viewBox="0 0 16 16" width="14" height="14" fill="none">
          <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.3" />
          <path d="m10.2 10.2 3.05 3.05" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <input
          type="search" value={query} placeholder={tr("搜索主题")} aria-label={tr("搜索主题")} style={styles.searchInput}
          onChange={event => { setQuery(event.currentTarget.value) }}
        />
      </label>
      <div role={cardMode ? 'list' : 'tree'} aria-label={tr("主题列表")} style={styles.tree}>
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
        {busy && (cardMode ? cardSources.length === 0 : rows.length === 0) && <div role="status" style={styles.status}>{tr("正在加载主题…")}</div>}
        {!busy && error === '' && (cardMode ? cardSources.length === 0 : rows.length === 0) && <div style={styles.status}>{query.trim() === '' ? '暂无主题' : '没有匹配的主题'}</div>}
        {error !== '' && <div role="alert" style={{ ...styles.status, ...styles.error }}>
          <div>{error}</div>
          <button data-arkme-feedback="neutral" type="button" style={{ ...styles.close, width: 'auto', margin: '8px auto 0', padding: '0 10px', fontSize: 12 }}
            onClick={() => { void directory.ensure(true) }}>{tr("重试")}</button>
        </div>}
      </div>
      <ArkmeTopicCreateFooter onCreate={() => { openCreate(null) }} />
    </div>}
    {topicCreateParent !== undefined && <ArkmeTopicCreateDialog
      key={topicCreateParent?.sourceRef ?? 'root'}
      mode={topicCreateParent === null ? 'topic' : 'child'}
      {...(topicCreateParent === null ? {} : { parentTopicPath: arkmeTopicPathNames(topicCreateParent, sources) })}
      submitting={topicCreateSubmitting} error={topicCreateError}
      onCancel={cancelCreate} onConfirm={title => { void submitCreate(title) }}
    />}
  </>
}
