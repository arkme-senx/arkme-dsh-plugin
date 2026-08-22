import type { CSSProperties } from 'react'
import { StackSimple } from '@phosphor-icons/react/dist/icons/StackSimple'
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
  accent: '#5d76e8',
  accentSoft: '#f1f2f6',
}

const styles: Record<string, CSSProperties> = {
  breadcrumb: {
    minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap',
  },
  directoryIconFrame: {
    width: 36, height: 36, marginRight: 9, flex: '0 0 auto', display: 'grid', placeItems: 'center',
    borderRadius: 10, color: colors.accent, background: colors.accentSoft,
  },
  directoryIcon: { width: 18, height: 18 },
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

function ArkmeDirectoryBreadcrumbIcon() {
  return <span
    aria-hidden="true"
    data-arkme-source-breadcrumb-icon="true"
    style={styles.directoryIconFrame}
  >
    <StackSimple size={18} weight="regular" style={styles.directoryIcon} />
  </span>
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
  const currentSegment = segments.at(-1)!
  const ancestorSegments = segments.slice(0, -1)
  const pathLabel = ancestorSegments.map(segment => segment.label).join(' / ') || '主题目录'
  return <nav aria-label="当前主题路径" style={styles.breadcrumb}>
    <ArkmeDirectoryBreadcrumbIcon />
    <span style={styles.titleGroup}>
      <span data-arkme-source-breadcrumb-path="true" title={pathLabel} style={styles.path}>
        {ancestorSegments.length === 0
          ? '主题目录'
          : ancestorSegments.map((segment, index) => <span key={segment.key} style={{ display: 'contents' }}>
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
      </span>
      <span
        aria-current="page"
        data-arkme-source-breadcrumb-current="true"
        title={currentSegment.label}
        style={styles.current}
      >{currentSegment.label}</span>
    </span>
  </nav>
}
