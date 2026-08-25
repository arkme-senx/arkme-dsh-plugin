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
  text: '#171923',
  secondary: '#8e9199',
  caption: '#a0a3aa',
}

const styles: Record<string, CSSProperties> = {
  breadcrumb: {
    minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap',
  },
  titleGroup: {
    minWidth: 0, flex: '1 1 auto', display: 'flex', flexDirection: 'column', justifyContent: 'center', overflow: 'hidden',
  },
  path: {
    minWidth: 0, display: 'flex', alignItems: 'center', overflow: 'hidden', color: colors.secondary,
    fontSize: 11, lineHeight: '15px', whiteSpace: 'nowrap',
  },
  segment: {
    minWidth: 0, maxWidth: 132, flex: '0 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  ancestor: {
    padding: 0, border: 0, background: 'transparent', color: colors.secondary,
    font: 'inherit', fontWeight: 400, textAlign: 'left', cursor: 'pointer',
  },
  root: { flex: 'none', color: colors.caption },
  current: {
    minWidth: 0, overflow: 'hidden', color: colors.text, fontSize: 15, lineHeight: '21px', fontWeight: 600,
    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  separator: { flex: 'none', padding: '0 4px', color: colors.caption, fontWeight: 400 },
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

/** Move one visited personal destination to the end without keeping an older duplicate. */
export function appendArkmeSourceBreadcrumbTrail(
  trail: ArkmeSourceItem[],
  selectedSource: ArkmeSourceItem | undefined,
  sources: readonly ArkmeSourceItem[],
): ArkmeSourceItem[] {
  if (selectedSource === undefined || selectedSource.kind === 'send_to_self') return trail.length === 0 ? trail : []
  if (selectedSource.kind !== 'default_category' && selectedSource.kind !== 'topic') return trail
  const resolved = reconcileBreadcrumbSource(selectedSource, sources)
  const last = trail.at(-1)
  const uniqueNamedDestination = sources.filter(source => source.kind === resolved.kind
    && source.displayName === resolved.displayName).length === 1
  const sameDestination = (source: ArkmeSourceItem): boolean => source.sourceRef === resolved.sourceRef
    || (uniqueNamedDestination && source.kind === resolved.kind && source.displayName === resolved.displayName)
  if (last !== undefined && sameDestination(last)) {
    return last === resolved ? trail : [...trail.slice(0, -1), resolved]
  }
  return [...trail.filter(source => !sameDestination(source)), resolved]
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
  const currentSegment = segments.at(-1)!
  const ancestorSegments = segments.slice(0, -1)
  return <nav aria-label="当前主题路径" style={styles.breadcrumb}>
    <span style={styles.titleGroup}>
      {ancestorSegments.length > 0 && <span
        data-arkme-source-breadcrumb-path="true"
        title={ancestorSegments.map(segment => segment.label).join(' / ')}
        style={styles.path}
      >
        {ancestorSegments.map((segment, index) => <span key={segment.key} style={{ display: 'contents' }}>
            {index > 0 && <span aria-hidden style={styles.separator}>/</span>}
            <button
              type="button" title={segment.label}
              style={{ ...styles.segment, ...styles.ancestor, ...(segment.root ? styles.root : {}) }}
              onClick={segment.root
                ? onSelectAggregate
                : () => {
                    if (segment.source !== undefined && segment.trailIndex !== undefined) {
                      onSelect(segment.trailIndex, segment.source)
                    }
                  }}
            >{segment.label}</button>
          </span>)}
      </span>}
      <span
        aria-current="page"
        data-arkme-source-breadcrumb-current="true"
        title={currentSegment.label}
        style={styles.current}
      >{currentSegment.label}</span>
    </span>
  </nav>
}
