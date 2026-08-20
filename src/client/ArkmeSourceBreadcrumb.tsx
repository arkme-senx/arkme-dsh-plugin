import type { CSSProperties } from 'react'
import type { ArkmeSourceItem } from '../types.js'

export interface ArkmeSourceBreadcrumbSegment {
  key: string
  label: string
  source?: ArkmeSourceItem
  trailIndex?: number
  root: boolean
  current: boolean
}

const colors = {
  text: 'var(--dsw-alias-label-primary, #17191c)',
  secondary: 'var(--dsw-alias-label-secondary, #8a9099)',
  caption: 'var(--dsw-alias-label-caption, #b0b5bc)',
}

const styles: Record<string, CSSProperties> = {
  breadcrumb: {
    minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap',
    fontSize: 14, lineHeight: '20px',
  },
  segment: {
    minWidth: 0, maxWidth: 160, flex: '0 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  ancestor: {
    padding: 0, border: 0, background: 'transparent', color: colors.secondary,
    font: 'inherit', fontWeight: 400, textAlign: 'left', cursor: 'pointer',
  },
  root: { flex: 'none', color: colors.caption },
  current: { color: colors.text, fontWeight: 500 },
  currentRoot: { color: colors.text, fontWeight: 500 },
  separator: { flex: 'none', padding: '0 5px', color: colors.caption, fontWeight: 400 },
}

function reconcileBreadcrumbSource(
  source: ArkmeSourceItem,
  sources: readonly ArkmeSourceItem[],
): ArkmeSourceItem {
  const exact = sources.find(candidate => candidate.sourceRef === source.sourceRef)
  if (exact !== undefined) return exact
  const equivalent = sources.filter(candidate => candidate.kind === source.kind
    && candidate.displayName === source.displayName)
  return equivalent.length === 1 ? equivalent[0]! : source
}

/** Append one visited personal destination without deriving its directory ancestry. */
export function appendArkmeSourceBreadcrumbTrail(
  trail: ArkmeSourceItem[],
  selectedSource: ArkmeSourceItem | undefined,
  sources: readonly ArkmeSourceItem[],
): ArkmeSourceItem[] {
  if (selectedSource === undefined || selectedSource.kind === 'send_to_self') return trail.length === 0 ? trail : []
  if (selectedSource.kind !== 'default_category' && selectedSource.kind !== 'topic') return trail
  const resolved = reconcileBreadcrumbSource(selectedSource, sources)
  const last = trail.at(-1)
  if (last !== undefined && last.kind === resolved.kind && last.displayName === resolved.displayName) {
    return last === resolved ? trail : [...trail.slice(0, -1), resolved]
  }
  if (last?.sourceRef !== resolved.sourceRef) return [...trail, resolved]
  if (last === resolved) return trail
  return [...trail.slice(0, -1), resolved]
}

/** Return to one visited destination and discard everything visited after it. */
export function truncateArkmeSourceBreadcrumbTrail(
  trail: readonly ArkmeSourceItem[],
  trailIndex: number,
): ArkmeSourceItem[] {
  return trail.slice(0, Math.max(0, trailIndex + 1))
}

/** Build the visible visit trail. Directory parents are intentionally not inferred. */
export function arkmeSourceBreadcrumb(
  trail: readonly ArkmeSourceItem[],
  sources: readonly ArkmeSourceItem[],
): ArkmeSourceBreadcrumbSegment[] {
  const sourcesByRef = new Map(sources.map(source => [source.sourceRef, source]))
  const aggregateSource = sources.find(source => source.kind === 'send_to_self')
  const root: ArkmeSourceBreadcrumbSegment = {
    key: aggregateSource?.sourceRef ?? 'arkme:send-to-self',
    label: '发给自己',
    ...(aggregateSource === undefined ? {} : { source: aggregateSource }),
    root: true,
    current: trail.length === 0,
  }
  return [root, ...trail.map((trailSource, index) => {
    const source = sourcesByRef.get(trailSource.sourceRef)
      ?? reconcileBreadcrumbSource(trailSource, sources)
    return {
      key: `${String(index)}:${source.sourceRef}`,
      label: source.displayName,
      source,
      trailIndex: index,
      root: false,
      current: index === trail.length - 1,
    }
  })]
}

export function ArkmeSourceBreadcrumb({
  trail, sources, onSelect, onSelectAggregate,
}: {
  trail: readonly ArkmeSourceItem[]
  sources: readonly ArkmeSourceItem[]
  onSelect(trailIndex: number, source: ArkmeSourceItem): void
  onSelectAggregate(): void
}) {
  const segments = arkmeSourceBreadcrumb(trail, sources)
  return <nav aria-label="当前主题路径" style={styles.breadcrumb}>
    {segments.map((segment, index) => <span key={segment.key} style={{ display: 'contents' }}>
      {index > 0 && <span aria-hidden style={styles.separator}>/</span>}
      {segment.current
        ? <span
          aria-current="page" title={segment.label}
          style={{
            ...styles.segment,
            ...styles.current,
            ...(segment.root ? { ...styles.root, ...styles.currentRoot } : {}),
          }}
        >{segment.label}</span>
        : <button
          type="button" title={segment.label}
          style={{ ...styles.segment, ...styles.ancestor, ...(segment.root ? styles.root : {}) }}
          onClick={segment.root
            ? onSelectAggregate
            : () => {
                if (segment.source !== undefined && segment.trailIndex !== undefined) {
                  onSelect(segment.trailIndex, segment.source)
                }
              }}
        >{segment.label}</button>}
    </span>)}
  </nav>
}
