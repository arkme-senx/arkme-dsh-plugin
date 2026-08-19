import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  ARKME_TOPIC_CREATE_ACTION_COLOR, ArkmeTopicCreateDialog,
} from '../src/client/ArkmeTopicCreateDialog.js'
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
    expect(control).toContain('gap:4px')
    expect(control).toContain('默认')
    expect(menu).toContain('role="menu"')
    expect(menu).toContain('width:96px')
    expect(menu).toContain('height:32px')
    expect(menu).toContain('right:-20px')
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
    expect(hovered).toContain('#b0b5bc')
    expect(hovered).not.toContain('＋')
    expect(resting).not.toContain('transition:')
    expect(hovered).not.toContain('transition:')
    expect(selected).toContain('background:#def3e8')
    expect(selected).toContain('inset 2px 0 #20c66a')
    expect(created).toContain('background:#def3e8')
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
