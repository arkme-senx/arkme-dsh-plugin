import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  ARKME_TOPIC_CREATE_ACTION_COLOR, ArkmeTopicCreateDialog,
} from '../src/client/ArkmeTopicCreateDialog.js'
import {
  ARKME_TOPIC_DIRECTORY_POPOVER_MAX_HEIGHT, ArkmeTopicDirectoryPopover, filterArkmeTopicSources,
  reconcileArkmeTopicSelection,
} from '../src/client/ArkmeTopicDirectoryPopover.js'
import {
  arkmeAggregateSourceForUser, arkmeSourceComposerPlaceholder, arkmeSourceDestinationLabel,
} from '../src/client/ArkmeSidebar.js'
import {
  appendArkmeSourceBreadcrumbTrail, ArkmeSourceBreadcrumb, arkmeSourceBreadcrumb,
  truncateArkmeSourceBreadcrumbTrail,
} from '../src/client/ArkmeSourceBreadcrumb.js'
import type { ArkmeSourceItem } from '../src/types.js'
import {
  ArkmeSourceSortControl, ArkmeSourceSortMenu, ArkmeTopicCard, ArkmeTopicCreateFooter,
  ArkmeTopicTreeRow, expandAncestorsForReveal,
  canCreateChildTopicAtParentLevel, expandTopicFromRowClick, isTopicRowFullyVisible,
  mergeCreatedTopicSource, toggleTopicCollapsedState,
} from '../src/client/ArkmeVirtualWorkspace.js'
import { buildArkmeSourceTree, flattenVisibleArkmeSourceTree } from '../src/client/source-tree.js'
import type { ArkmeSourceTreeRow } from '../src/client/source-tree.js'

function renderDialog(mode: 'topic' | 'child'): string {
  return renderToStaticMarkup(<ArkmeTopicCreateDialog
    mode={mode} submitting={false} onCancel={() => {}} onConfirm={() => {}}
  />)
}

const topicRow: ArkmeSourceTreeRow = {
  source: {
    sourceRef: 'topic-parent', kind: 'topic', displayName: '工作',
    activeAtMillis: 1, unreadCount: 0, recordCount: 36,
  },
  depth: 0,
  hasChildren: true,
  expanded: true,
}

describe('topic create UI', () => {
  it('uses a compact trigger and a rounded floating sort menu', () => {
    const control = renderToStaticMarkup(<ArkmeSourceSortControl value="default" onChange={() => {}} />)
    const menu = renderToStaticMarkup(<ArkmeSourceSortMenu value="default" onSelect={() => {}} />)

    expect(control).toContain('aria-haspopup="menu"')
    expect(control).toContain('aria-expanded="false"')
    expect(control).toContain('height:22px')
    expect(control).toContain('gap:5px')
    expect(control).toContain('font-size:12px')
    expect(control).toContain('font-weight:400')
    expect(control).toContain('line-height:22px')
    expect(control).toContain('transform:translateY(2px)')
    expect(control).toContain('z-index:40')
    expect(control).toContain('默认')
    expect(menu).toContain('role="menu"')
    expect(menu).toContain('width:80px')
    expect(menu).toContain('height:28px')
    expect(menu).toContain('right:-8px')
    expect(menu).toContain('justify-content:center')
    expect(menu).toContain('text-align:center')
    expect(menu).toContain('border-radius:10px')
    expect(menu).toContain('--dsw-specific-menu')
    expect(menu).toContain('--dsw-shadow-lv3')
    expect(menu).toContain('aria-checked="true"')
    expect(menu).toContain('最新')
    expect(menu).toContain('最多')
    expect(menu).toContain('默认')
    expect(`${control}${menu}`).not.toContain('名称')
  })

  it('renders latest and most entries as flat compact cards', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 19, 11, 45))
    try {
      const card = renderToStaticMarkup(<ArkmeTopicCard
        source={{
          sourceRef: 'default', kind: 'default_category', displayName: '默认分类',
          activeAtMillis: new Date(2026, 7, 18, 16, 13).getTime(), unreadCount: 0,
          recordCount: 433, latestPreview: '是第三十四',
        }}
        selected={false} hovered={false} onHoverChange={() => {}}
        onSelect={() => {}}
      />)
      const hoveredTopicCard = renderToStaticMarkup(<ArkmeTopicCard
        source={{ ...topicRow.source, latestPreview: '卡片预览' }}
        selected={false} hovered onHoverChange={() => {}} onSelect={() => {}}
      />)

      expect(card).toContain('role="listitem"')
      expect(card).toContain('border-radius:9px')
      expect(card).toContain('min-height:56px')
      expect(card).toContain('默认分类')
      expect(card).toContain('>433</span>')
      expect(card).toContain('昨天 16:13：')
      expect(card).toContain('是第三十四')
      expect(card).not.toContain('创建子主题')
      expect(hoveredTopicCard).not.toContain('创建子主题')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the create dialog focused on the topic name without magnet settings', () => {
    const child = renderDialog('child')
    const root = renderDialog('topic')

    expect(child).toContain('role="dialog"')
    expect(child).toContain('aria-modal="true"')
    expect(child).toContain('创建子主题')
    expect(root).toContain('创建主题')
    expect(root).toContain('主题名称')
    expect(root).toContain('请输入主题名称')
    expect(root).toContain('取消')
    expect(root).toContain('确认')
    expect(root).toContain('font-weight:500')
    expect(`${child}${root}`).not.toContain('话题磁铁')
    expect(`${child}${root}`).toContain('#a7dfbd')
    expect(ARKME_TOPIC_CREATE_ACTION_COLOR).toBe('#09B83E')
  })

  it('shows the child-topic shortcut only for a hovered topic row', () => {
    const baseProps = {
      row: topicRow,
      selected: false,
      onHoverChange: () => {},
      onToggle: () => {},
      onSelect: () => {},
      onCreateChild: () => {},
    }
    const resting = renderToStaticMarkup(<ArkmeTopicTreeRow {...baseProps} hovered={false} />)
    const hovered = renderToStaticMarkup(<ArkmeTopicTreeRow {...baseProps} hovered />)
    const selected = renderToStaticMarkup(<ArkmeTopicTreeRow {...baseProps} selected hovered={false} />)
    const created = renderToStaticMarkup(<ArkmeTopicTreeRow
      {...baseProps} createdHighlightActive createdHighlightVisible hovered={false}
    />)

    expect(resting).toContain('>36</span>')
    expect(resting).not.toContain('创建子主题')
    expect(hovered).toContain('aria-label="在工作下创建子主题"')
    expect(hovered).not.toContain('>36</span>')
    expect(hovered).toContain('<svg')
    expect(hovered).toContain('width:58px')
    expect(hovered).toContain('padding-right:12px')
    expect(hovered).toContain('var(--dsw-alias-label-caption, #a3a8ae)')
    expect(hovered).not.toContain('＋')
    expect(resting).not.toContain('transition:')
    expect(hovered).not.toContain('transition:')
    expect(selected).toContain('background:var(--dsw-alias-state-success-tertiary, #def3e8)')
    expect(selected).toContain('inset 2px 0 var(--dsw-alias-state-success-primary, #09b83e)')
    expect(created).toContain('background:var(--dsw-alias-state-success-tertiary, #def3e8)')
    expect(created).toContain('box-shadow:none')
    expect(created).toContain('transition:background-color 140ms ease')
    expect(created).not.toContain('inset 2px 0 #20c66a')
  })

  it('keeps the root create action in a non-scrolling footer', () => {
    const footer = renderToStaticMarkup(<ArkmeTopicCreateFooter onCreate={() => {}} />)
    expect(footer).toContain('新建主题')
    expect(footer).toContain('position:absolute')
    expect(footer).toContain('background:transparent')
    expect(footer).toContain('padding:10px 12px 22px')
    expect(footer).not.toContain('box-shadow')
  })

  it('renders the directory trigger next to the floating surface close action', () => {
    const markup = renderToStaticMarkup(<ArkmeTopicDirectoryPopover
      userId={10001} selectedSource={undefined} onSelect={() => {}}
      onSelectionInvalidated={() => {}} onSelfSourcesResolution={() => {}} retryRevision={0}
    />)

    expect(markup).toContain('aria-label="打开分类目录"')
    expect(markup).toContain('title="分类目录"')
    expect(markup).toContain('margin-left:auto')
    expect(markup).not.toContain('position:absolute')
    expect(ARKME_TOPIC_DIRECTORY_POPOVER_MAX_HEIGHT).toContain('100vh')
    expect(ARKME_TOPIC_DIRECTORY_POPOVER_MAX_HEIGHT).not.toContain('100%')
    expect(markup).not.toContain('选择发送目标')
  })

  it('keeps matching topic ancestors while filtering the directory', () => {
    const sources: ArkmeSourceItem[] = [
      { ...topicRow.source, sourceRef: 'root', displayName: '工作' },
      { ...topicRow.source, sourceRef: 'child', parentSourceRef: 'root', displayName: 'DSH 插件' },
      { ...topicRow.source, sourceRef: 'other', displayName: '生活' },
    ]

    expect(filterArkmeTopicSources(sources, 'dsh').map(source => source.sourceRef)).toEqual(['root', 'child'])
    expect(filterArkmeTopicSources(sources, '  ').map(source => source.sourceRef)).toEqual(['root', 'child', 'other'])
  })

  it('keeps send-to-self, default category, and topics as distinct destinations', () => {
    const aggregate: ArkmeSourceItem = {
      ...topicRow.source, sourceRef: 'aggregate', kind: 'send_to_self', displayName: '发给自己',
    }
    const defaultCategory: ArkmeSourceItem = {
      ...topicRow.source, sourceRef: 'default', kind: 'default_category', displayName: '默认分类',
    }

    expect(arkmeSourceDestinationLabel(aggregate)).toBe('发给自己')
    expect(arkmeSourceComposerPlaceholder(aggregate)).toBe('发送给自己…')
    expect(arkmeSourceDestinationLabel(defaultCategory)).toBe('默认分类')
    expect(arkmeSourceComposerPlaceholder(defaultCategory)).toBe('发送到「默认分类」…')
    expect(arkmeSourceDestinationLabel(undefined)).toBe('发给自己')
    expect(arkmeSourceComposerPlaceholder(undefined)).toBe('发送给自己…')
    expect(arkmeSourceDestinationLabel(topicRow.source)).toBe('工作')
    expect(arkmeSourceComposerPlaceholder(topicRow.source)).toBe('发送到「工作」…')
  })

  it('records visited personal destinations without inferring directory parents', () => {
    const aggregate: ArkmeSourceItem = {
      ...topicRow.source, sourceRef: 'aggregate', kind: 'send_to_self', displayName: '发给自己',
    }
    const defaultCategory: ArkmeSourceItem = {
      ...topicRow.source, sourceRef: 'default', kind: 'default_category', displayName: '默认分类',
    }
    const rootTopic: ArkmeSourceItem = {
      ...topicRow.source, sourceRef: 'product', displayName: '产品研发',
    }
    const childTopic: ArkmeSourceItem = {
      ...topicRow.source, sourceRef: 'dsh', parentSourceRef: rootTopic.sourceRef, displayName: 'DSH 插件',
    }
    const leafTopic: ArkmeSourceItem = {
      ...topicRow.source, sourceRef: 'release', parentSourceRef: childTopic.sourceRef, displayName: '发布流程',
    }
    const sources = [aggregate, defaultCategory, rootTopic, childTopic, leafTopic]

    let trail: ArkmeSourceItem[] = []
    expect(appendArkmeSourceBreadcrumbTrail(trail, undefined, sources)).toBe(trail)
    expect(appendArkmeSourceBreadcrumbTrail(trail, aggregate, sources)).toBe(trail)
    trail = appendArkmeSourceBreadcrumbTrail(trail, rootTopic, sources)
    trail = appendArkmeSourceBreadcrumbTrail(trail, leafTopic, sources)
    expect(arkmeSourceBreadcrumb(trail, sources).map(segment => segment.label))
      .toEqual(['发给自己', '产品研发', '发布流程'])

    trail = appendArkmeSourceBreadcrumbTrail(trail, childTopic, sources)
    trail = appendArkmeSourceBreadcrumbTrail(trail, rootTopic, sources)
    expect(arkmeSourceBreadcrumb(trail, sources).map(segment => segment.label))
      .toEqual(['发给自己', '产品研发', '发布流程', 'DSH 插件', '产品研发'])
    expect(appendArkmeSourceBreadcrumbTrail(trail, rootTopic, sources)).toBe(trail)
    expect(truncateArkmeSourceBreadcrumbTrail(trail, 1).map(source => source.displayName))
      .toEqual(['产品研发', '发布流程'])
    expect(appendArkmeSourceBreadcrumbTrail(trail, aggregate, sources)).toEqual([])

    const markup = renderToStaticMarkup(<ArkmeSourceBreadcrumb
      trail={[rootTopic, leafTopic]} sources={sources} onSelect={() => {}} onSelectAggregate={() => {}}
    />)
    expect(markup).toContain('aria-label="当前主题路径"')
    expect(markup).toContain('发给自己')
    expect(markup).toContain('产品研发')
    expect(markup).not.toContain('DSH 插件')
    expect(markup).toContain('aria-current="page"')
    expect(markup).toContain('--dsw-alias-label-secondary')
    expect(markup).toContain('发布流程')

    const aggregateMarkup = renderToStaticMarkup(<ArkmeSourceBreadcrumb
      trail={[]} sources={sources} onSelect={() => {}} onSelectAggregate={() => {}}
    />)
    expect(aggregateMarkup).toContain('aria-current="page"')
    expect(aggregateMarkup).toContain('--dsw-alias-label-primary')
    expect(aggregateMarkup).not.toContain('--dsw-alias-label-caption')
  })

  it('rebinds rotated source references without duplicating the visited destination', () => {
    const stale: ArkmeSourceItem = {
      ...topicRow.source, sourceRef: 'stale-topic-ref', displayName: '产品研发',
    }
    const current: ArkmeSourceItem = {
      ...stale, sourceRef: 'current-topic-ref', recordCount: 48,
    }

    const trail = appendArkmeSourceBreadcrumbTrail([stale], stale, [current])
    expect(trail).toEqual([current])

    const segments = arkmeSourceBreadcrumb([stale], [current])
    expect(segments).toHaveLength(2)
    expect(segments[1]?.source).toBe(current)
  })

  it('never reuses a resolved aggregate source across accounts', () => {
    const aggregate: ArkmeSourceItem = {
      ...topicRow.source, sourceRef: 'aggregate-a', kind: 'send_to_self', displayName: '发给自己',
    }
    const defaultCategory: ArkmeSourceItem = {
      ...topicRow.source, sourceRef: 'default-a', kind: 'default_category', displayName: '默认分类',
    }
    const state = {
      userId: 10001,
      resolution: {
        status: 'ready' as const, aggregateSource: aggregate, defaultCategorySource: defaultCategory,
        sources: [aggregate, defaultCategory],
      },
    }

    expect(arkmeAggregateSourceForUser(10001, state)).toBe(aggregate)
    expect(arkmeAggregateSourceForUser(10002, state)).toBeUndefined()
    expect(arkmeAggregateSourceForUser(undefined, state)).toBeUndefined()
  })

  it('refreshes selected topic metadata and invalidates a missing topic', () => {
    const selected = { ...topicRow.source, displayName: '旧名称', unreadCount: 3 }
    const refreshed = { ...selected, displayName: '新名称', unreadCount: 0 }

    expect(reconcileArkmeTopicSelection(selected, [refreshed])).toEqual({ status: 'selected', source: refreshed })
    expect(reconcileArkmeTopicSelection(selected, [])).toEqual({ status: 'invalid' })
    expect(reconcileArkmeTopicSelection(undefined, [refreshed])).toEqual({ status: 'aggregate' })
  })

  it('expands every ancestor before revealing a newly created topic', () => {
    const source = (sourceRef: string, parentSourceRef?: string): ArkmeSourceItem => ({
      sourceRef,
      ...(parentSourceRef === undefined ? {} : { parentSourceRef }),
      kind: 'topic', displayName: sourceRef, activeAtMillis: 1, unreadCount: 0,
    })
    const collapsed = new Set(['root', 'parent', 'unrelated'])
    const expanded = expandAncestorsForReveal([
      source('root'), source('parent', 'root'), source('created', 'parent'), source('unrelated'),
    ], 'created', collapsed)

    expect([...expanded]).toEqual(['unrelated'])
  })

  it('scrolls a created topic only when it is outside the visible list area', () => {
    const listRect = { top: 100, bottom: 500 }

    expect(isTopicRowFullyVisible({ top: 180, bottom: 220 }, listRect)).toBe(true)
    expect(isTopicRowFullyVisible({ top: 80, bottom: 120 }, listRect)).toBe(false)
    expect(isTopicRowFullyVisible({ top: 480, bottom: 520 }, listRect)).toBe(false)
  })

  it('adds a created child without replacing the currently selected source object', () => {
    const selectedSource = topicRow.source
    const createdSource: ArkmeSourceItem = {
      ...topicRow.source,
      sourceRef: 'topic-child',
      parentSourceRef: selectedSource.sourceRef,
      displayName: '新子主题',
    }

    const nextSources = mergeCreatedTopicSource([selectedSource], createdSource)

    expect(nextSources[0]).toBe(selectedSource)
    expect(nextSources[1]).toBe(createdSource)
  })

  it('preflights child creation from the rendered tree level', () => {
    expect(canCreateChildTopicAtParentLevel(1)).toBe(true)
    expect(canCreateChildTopicAtParentLevel(4)).toBe(true)
    expect(canCreateChildTopicAtParentLevel(5)).toBe(false)
    expect(canCreateChildTopicAtParentLevel(undefined)).toBe(false)
  })

  it('expands a collapsed topic from its row without collapsing an expanded topic', () => {
    const collapsed = new Set(['topic-parent', 'other'])
    const expanded = expandTopicFromRowClick({ ...topicRow, expanded: false }, collapsed)

    expect([...expanded]).toEqual(['other'])
    expect(expandTopicFromRowClick(topicRow, expanded)).toBe(expanded)
  })

  it('preserves every nested expansion state when an outer topic is collapsed and reopened', () => {
    const nestedSources: ArkmeSourceItem[] = [
      { ...topicRow.source, sourceRef: 'outer' },
      { ...topicRow.source, sourceRef: 'inner', parentSourceRef: 'outer' },
      { ...topicRow.source, sourceRef: 'leaf', parentSourceRef: 'inner' },
    ]
    const roots = buildArkmeSourceTree(nestedSources)
    const outerCollapsed = toggleTopicCollapsedState('outer', new Set())
    const outerReopened = toggleTopicCollapsedState('outer', outerCollapsed)

    expect(flattenVisibleArkmeSourceTree(roots, outerCollapsed).map(row => row.source.sourceRef))
      .toEqual(['outer'])
    expect(flattenVisibleArkmeSourceTree(roots, outerReopened).map(row => row.source.sourceRef))
      .toEqual(['outer', 'inner', 'leaf'])
  })
})
