import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CollapsibleDirectorySection } from '../src/client/redesign/contacts/CollapsibleDirectorySection.js'
import { contactDirectoryReducer, createContactDirectoryState } from '../src/client/redesign/contacts/contact-directory-state.js'
import { projectDirectorySearch } from '../src/client/redesign/contacts/contact-directory-search.js'
import type { ArkmeDirectoryPage } from '../src/types.js'

const row = (contactRef: string, displayName = contactRef) => ({ kind: 'contact' as const, contactRef, displayName, nickname: displayName, remark: '', letter: '#' })
const success = (state: ReturnType<typeof createContactDirectoryState>, page: ArkmeDirectoryPage, mode: 'replace' | 'append' = 'replace') => contactDirectoryReducer(state, {
  type: 'load-success', section: page.section, accountKey: 'a', generation: state.sections[page.section].generation, mode, page,
})

describe('directory user experience contracts', () => {
  it('uses the Audio owner projection state without conflating it with per-page contact hydration', () => {
    let state = createContactDirectoryState('a')
    state.selection = { kind: 'unmarked-speaker', candidateRef: 'selected' }
    state = success(state, { section: 'unmarked-speakers', items: [], total: 0, hasMore: false, projectionState: 'building' })
    expect(state.selection).toEqual({ kind: 'unmarked-speaker', candidateRef: 'selected' })
    expect(state.sections['unmarked-speakers'].status).toBe('ready')
    state = success(state, { section: 'unmarked-speakers', items: [], total: 0, hasMore: false, projectionState: 'fresh' }, 'append')
    expect(state.sections['unmarked-speakers'].warning).toBeUndefined()
    expect(state.sections['unmarked-speakers'].status).toBe('empty')
    expect(state.selection).toEqual({ kind: 'none' })
  })

  it('uses the existing empty state only for a complete empty contact result', () => {
    const partial = success(createContactDirectoryState('a'), { section: 'contacts', items: [], total: 0, hasMore: false, coverage: 'partial', projectionState: 'stale' })
    const markup = renderToStaticMarkup(createElement(CollapsibleDirectorySection, {
      section: partial.sections.contacts, label: '联系人', emptyLabel: '暂无联系人', children: null,
      onToggle() {}, onRetry() {}, onLoadMore() {},
    }))
    expect(markup).not.toContain('暂无联系人')
    expect(markup).not.toContain('已显示部分联系人')
    expect(markup).not.toContain('重试')
    expect(success(partial, { section: 'contacts', items: [], total: 0, hasMore: false, coverage: 'complete' }).sections.contacts.status).toBe('empty')
  })

  it('retains page presentation degradation until those rows are refreshed, including during append', () => {
    let state = createContactDirectoryState('a')
    for (const section of Object.values(state.sections)) section.status = 'empty'
    state = success(state, { section: 'contacts', items: [row('first', '联系人')], total: 2, hasMore: true, nextCursor: 'p2', coverage: 'complete', projectionState: 'stale' })
    state = contactDirectoryReducer(state, { type: 'load-start', section: 'contacts', accountKey: 'a', generation: 1, mode: 'append' })
    state = success(state, { section: 'contacts', items: [row('later')], total: 2, hasMore: false, coverage: 'complete' }, 'append')
    expect(state.sections.contacts.warning).toBeDefined()
    expect(projectDirectorySearch(state, 'missing-name', {}).status).not.toBe('未找到匹配的项目')
    state = success(state, { section: 'contacts', items: [row('first'), row('later')], total: 2, hasMore: false, coverage: 'complete' })
    expect(state.sections.contacts.warning).toBeUndefined()
  })

  it('does not discard a selected later-page contact before a complete replacement has finished', () => {
    let state = createContactDirectoryState('a')
    state.selection = { kind: 'contact', contactRef: 'later' }
    state = success(state, { section: 'contacts', items: [row('first')], total: 2, hasMore: true, nextCursor: 'p2', coverage: 'complete' })
    expect(state.selection).toEqual({ kind: 'contact', contactRef: 'later' })
    state = success(state, { section: 'contacts', items: [row('later')], total: 2, hasMore: false, coverage: 'complete' }, 'append')
    expect(state.selection).toEqual({ kind: 'contact', contactRef: 'later' })
    state = success(state, { section: 'contacts', items: [row('first')], total: 2, hasMore: true, nextCursor: 'p2', coverage: 'complete' })
    state = success(state, { section: 'contacts', items: [row('other')], total: 2, hasMore: false, coverage: 'complete' }, 'append')
    expect(state.selection).toEqual({ kind: 'none' })
  })
})
