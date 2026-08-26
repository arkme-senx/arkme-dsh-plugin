import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { ArkmeSourceItem } from '../types.js'
import { arkmeSelfDirectorySources } from './source-list.js'
import { buildArkmeSourceTree, flattenVisibleArkmeSourceTree } from './source-tree.js'

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

const colors = {
  text: '#171923', secondary: '#6f747d', border: '#e1e2e5', surface: '#fff',
  selected: '#eef1f8',
}

const styles: Record<string, CSSProperties> = {
  breadcrumb: { position: 'relative', minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 10 },
  fixedTitle: { flex: 'none', color: colors.text, fontSize: 15, lineHeight: '24px', fontWeight: 600, whiteSpace: 'nowrap' },
  selector: {
    minWidth: 0, maxWidth: 220, height: 30, display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '0 9px 0 10px', border: `1px solid ${colors.border}`, borderRadius: 8,
    background: colors.surface, color: colors.text, font: 'inherit', fontSize: 12, cursor: 'pointer',
  },
  selectorOpen: { borderColor: '#b9c4e8', background: '#f8f9ff' },
  selectorText: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  caret: { width: 12, height: 12, flex: 'none', color: colors.secondary, transition: 'transform .16s ease' },
  menu: {
    position: 'absolute', zIndex: 100, top: 36, left: 0, width: 260, maxHeight: 'min(360px, calc(100vh - 116px))',
    overflowY: 'auto', padding: 5, boxSizing: 'border-box', border: `1px solid ${colors.border}`, borderRadius: 10,
    background: colors.surface, boxShadow: '0 14px 32px rgba(23,25,35,.12)',
  },
  option: {
    width: '100%', minHeight: 32, display: 'flex', alignItems: 'center', gap: 8, padding: '0 9px', border: 0,
    borderRadius: 7, background: 'transparent', color: colors.text, font: 'inherit', fontSize: 12, textAlign: 'left', cursor: 'pointer',
  },
  optionSelected: { background: colors.selected, fontWeight: 600 },
  optionLabel: { minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  check: { width: 12, flex: 'none', color: '#5870d8', fontWeight: 700, textAlign: 'center' },
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
export function arkmeSelfTopicOptions(sources: readonly ArkmeSourceItem[]): ArkmeSelfTopicOption[] {
  const roots = buildArkmeSourceTree(arkmeSelfDirectorySources(sources))
  return flattenVisibleArkmeSourceTree(roots, new Set()).map(row => ({ source: row.source, depth: row.depth }))
}

export function arkmeSelfTopicSelectionLabel(selectedSource: ArkmeSourceItem | undefined): string {
  return selectedSource === undefined || selectedSource.kind === 'send_to_self' ? '全部主题' : selectedSource.displayName
}

export function ArkmeSourceBreadcrumb({
  selectedSource, sources, onSelect, onSelectAggregate,
}: {
  selectedSource: ArkmeSourceItem | undefined
  sources: readonly ArkmeSourceItem[]
  onSelect(source: ArkmeSourceItem): void
  onSelectAggregate(): void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLElement>(null)
  const options = useMemo(() => arkmeSelfTopicOptions(sources), [sources])
  const label = arkmeSelfTopicSelectionLabel(selectedSource)
  const selectedRef = selectedSource?.kind === 'send_to_self' || selectedSource === undefined ? undefined : selectedSource.sourceRef

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    const closeEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', closeOutside, true)
    document.addEventListener('keydown', closeEscape, true)
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true)
      document.removeEventListener('keydown', closeEscape, true)
    }
  }, [open])

  const selectAggregate = () => { setOpen(false); onSelectAggregate() }
  const selectTopic = (source: ArkmeSourceItem) => { setOpen(false); onSelect(source) }

  return <nav ref={rootRef} aria-label="发给自己主题" style={styles.breadcrumb}>
    <span data-arkme-self-topic-root="true" style={styles.fixedTitle}>发给自己</span>
    <button
      type="button" aria-label="选择主题" aria-haspopup="listbox" aria-expanded={open}
      data-arkme-self-topic-selector="true" title={label}
      style={{ ...styles.selector, ...(open ? styles.selectorOpen : {}) }}
      onClick={() => { setOpen(value => !value) }}
    >
      <span style={styles.selectorText}>{label}</span>
      <svg aria-hidden viewBox="0 0 12 12" style={{ ...styles.caret, transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>
        <path d="m2.5 4.5 3.5 3.25 3.5-3.25" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
    {open && <div role="listbox" aria-label="主题" style={styles.menu}>
      <button type="button" role="option" aria-selected={selectedRef === undefined}
        style={{ ...styles.option, ...(selectedRef === undefined ? styles.optionSelected : {}) }} onClick={selectAggregate}
      ><span style={styles.optionLabel}>全部主题</span><span aria-hidden style={styles.check}>{selectedRef === undefined ? '✓' : ''}</span></button>
      {options.map(({ source, depth }) => <button key={source.sourceRef} type="button" role="option" aria-selected={selectedRef === source.sourceRef}
        style={{ ...styles.option, paddingLeft: 10 + depth * 16, ...(selectedRef === source.sourceRef ? styles.optionSelected : {}) }}
        onClick={() => { selectTopic(source) }}
      ><span style={styles.optionLabel}>{source.displayName}</span><span aria-hidden style={styles.check}>{selectedRef === source.sourceRef ? '✓' : ''}</span></button>)}
    </div>}
  </nav>
}
