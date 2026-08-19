import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArkmeTopicCreateDialog } from '../src/client/ArkmeTopicCreateDialog.js'
import type { ArkmeSourceItem } from '../src/types.js'
import {
  ArkmeTopicCreateFooter, ArkmeTopicTreeRow, expandAncestorsForReveal,
} from '../src/client/ArkmeVirtualWorkspace.js'
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
    expect(`${child}${root}`).not.toContain('话题磁铁')
    expect(`${child}${root}`).toContain('#a7dfbd')
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

    expect(resting).toContain('>36</span>')
    expect(resting).not.toContain('创建子主题')
    expect(hovered).toContain('aria-label="在工作下创建子主题"')
    expect(hovered).not.toContain('>36</span>')
    expect(hovered).toContain('<svg')
    expect(hovered).toContain('width:58px')
    expect(hovered).toContain('padding-right:12px')
    expect(hovered).toContain('#62c98d')
    expect(hovered).not.toContain('＋')
    expect(selected).toContain('background:#def3e8')
    expect(selected).toContain('inset 2px 0 #20c66a')
  })

  it('keeps the root create action in a non-scrolling footer', () => {
    const footer = renderToStaticMarkup(<ArkmeTopicCreateFooter onCreate={() => {}} />)
    expect(footer).toContain('新建主题')
    expect(footer).toContain('position:absolute')
    expect(footer).toContain('background:transparent')
    expect(footer).toContain('padding:10px 12px 30px')
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
})
