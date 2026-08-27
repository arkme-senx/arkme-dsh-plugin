import { describe, expect, it } from 'vitest'
import type { ArkmeDirectoryItem, ArkmeDirectoryPage } from '../src/types.js'
import {
  CONTACT_DIRECTORY_SECTION_ORDER,
  contactDirectoryReducer,
  createContactDirectoryState,
  directoryItemKey,
  sectionNeedsInitialLoad,
  type ContactDirectoryAction,
  type ContactDirectoryState,
} from '../src/client/redesign/contacts/contact-directory-state.js'

const contact = (contactRef: string, displayName = contactRef): ArkmeDirectoryItem => ({
  kind: 'contact', contactRef, displayName, nickname: displayName, remark: '', letter: 'A',
})

const speaker = (candidateRef: string): ArkmeDirectoryItem => ({
  kind: 'unmarked-speaker', candidateRef, displayName: `说话人 ${candidateRef}`, subtitle: '1 天',
})

const group = (sourceRef: string): ArkmeDirectoryItem => ({
  kind: 'group', sourceRef, displayName: sourceRef,
})

function reduce(state: ContactDirectoryState, ...actions: ContactDirectoryAction[]): ContactDirectoryState {
  return actions.reduce(contactDirectoryReducer, state)
}

function page(
  section: ArkmeDirectoryPage['section'],
  items: ArkmeDirectoryItem[],
  options: Partial<ArkmeDirectoryPage> = {},
): ArkmeDirectoryPage {
  return { section, items, total: items.length, hasMore: false, ...options }
}

describe('contact directory state', () => {
  it('starts with the fixed section order, only contacts expanded, and all sections loadable', () => {
    const state = createContactDirectoryState('account-a')

    expect(CONTACT_DIRECTORY_SECTION_ORDER).toEqual([
      'groups', 'bots', 'unmarked-speakers', 'teams', 'contacts',
    ])
    expect(CONTACT_DIRECTORY_SECTION_ORDER.map(section => state.sections[section].expanded))
      .toEqual([false, false, false, false, true])
    expect(CONTACT_DIRECTORY_SECTION_ORDER.map(section => state.sections[section].status))
      .toEqual(['idle', 'idle', 'idle', 'idle', 'idle'])
    expect(CONTACT_DIRECTORY_SECTION_ORDER.filter(section => sectionNeedsInitialLoad(state.sections[section])))
      .toEqual(['groups', 'bots', 'unmarked-speakers', 'teams', 'contacts'])
    expect(state.selection).toEqual({ kind: 'none' })
  })

  it('loads each section independently on first expansion and keeps cached sections on re-expansion', () => {
    let state = createContactDirectoryState('account-a')
    state = reduce(state,
      { type: 'set-expanded', section: 'groups', expanded: true },
      { type: 'load-start', section: 'groups', accountKey: 'account-a', generation: 1, mode: 'replace' },
    )
    expect(state.sections.groups.status).toBe('loading')
    expect(state.sections.contacts.status).toBe('idle')

    state = contactDirectoryReducer(state, {
      type: 'load-success', section: 'groups', accountKey: 'account-a', generation: 1,
      mode: 'replace', page: page('groups', [group('group-1')]),
    })
    state = reduce(state,
      { type: 'set-expanded', section: 'groups', expanded: false },
      { type: 'set-expanded', section: 'groups', expanded: true },
    )

    expect(state.sections.groups.status).toBe('ready')
    expect(state.sections.groups.items.map(directoryItemKey)).toEqual(['group:group-1'])
    expect(sectionNeedsInitialLoad(state.sections.groups)).toBe(false)
    expect(state.sections.groups.generation).toBe(1)
  })

  it('merges cursor pages by opaque row identity and records the next cursor and total', () => {
    let state = createContactDirectoryState('account-a')
    state = reduce(state,
      { type: 'load-start', section: 'contacts', accountKey: 'account-a', generation: 1, mode: 'replace' },
      {
        type: 'load-success', section: 'contacts', accountKey: 'account-a', generation: 1, mode: 'replace',
        page: page('contacts', [contact('contact-a'), contact('contact-b', '旧名字')], {
          total: 3, hasMore: true, nextCursor: 'cursor-2',
        }),
      },
      { type: 'load-start', section: 'contacts', accountKey: 'account-a', generation: 2, mode: 'append' },
      {
        type: 'load-success', section: 'contacts', accountKey: 'account-a', generation: 2, mode: 'append',
        page: page('contacts', [contact('contact-b', '新名字'), contact('contact-c')], { total: 3 }),
      },
    )

    expect(state.sections.contacts.items.map(item => [directoryItemKey(item), item.displayName])).toEqual([
      ['contact:contact-a', 'contact-a'], ['contact:contact-b', '新名字'], ['contact:contact-c', 'contact-c'],
    ])
    expect(state.sections.contacts).toMatchObject({ total: 3, hasMore: false, nextCursor: undefined, status: 'ready' })
  })

  it('keeps the count-only group total when list pages cannot report the upstream total', () => {
    let state = createContactDirectoryState('account-a')
    state = reduce(state,
      { type: 'load-start', section: 'groups', accountKey: 'account-a', generation: 1, mode: 'count' },
      { type: 'load-success', section: 'groups', accountKey: 'account-a', generation: 1, mode: 'count', page: page('groups', [], { total: 137 }) },
      { type: 'load-start', section: 'groups', accountKey: 'account-a', generation: 2, mode: 'replace' },
      { type: 'load-success', section: 'groups', accountKey: 'account-a', generation: 2, mode: 'replace', page: page('groups', [group('group-1')], { total: 50, hasMore: true, nextCursor: 'page-2' }) },
      { type: 'load-start', section: 'groups', accountKey: 'account-a', generation: 3, mode: 'append' },
      { type: 'load-success', section: 'groups', accountKey: 'account-a', generation: 3, mode: 'append', page: page('groups', [group('group-2')], { total: 87 }) },
    )

    expect(state.sections.groups.total).toBe(137)
    expect(state.sections.groups.items.map(directoryItemKey)).toEqual(['group:group-1', 'group:group-2'])
  })

  it('accepts an authoritative unmarked-speaker replacement total decreasing after mark or not-found refresh', () => {
    let state = createContactDirectoryState('account-a')
    state = reduce(state,
      { type: 'load-start', section: 'unmarked-speakers', accountKey: 'account-a', generation: 1, mode: 'count' },
      { type: 'load-success', section: 'unmarked-speakers', accountKey: 'account-a', generation: 1, mode: 'count', page: page('unmarked-speakers', [], { total: 2 }) },
      { type: 'load-start', section: 'unmarked-speakers', accountKey: 'account-a', generation: 2, mode: 'replace' },
      { type: 'load-success', section: 'unmarked-speakers', accountKey: 'account-a', generation: 2, mode: 'replace', page: page('unmarked-speakers', [speaker('speaker-a')], { total: 1 }) },
    )
    expect(state.sections['unmarked-speakers'].total).toBe(1)

    state = reduce(state,
      { type: 'load-start', section: 'unmarked-speakers', accountKey: 'account-a', generation: 3, mode: 'replace' },
      { type: 'load-success', section: 'unmarked-speakers', accountKey: 'account-a', generation: 3, mode: 'replace', page: page('unmarked-speakers', [], { total: 0 }) },
    )
    expect(state.sections['unmarked-speakers'].total).toBe(0)
  })

  it('retains stale items and exposes an inline warning when refresh fails', () => {
    let state = createContactDirectoryState('account-a')
    state = reduce(state,
      { type: 'load-start', section: 'contacts', accountKey: 'account-a', generation: 1, mode: 'replace' },
      {
        type: 'load-success', section: 'contacts', accountKey: 'account-a', generation: 1, mode: 'replace',
        page: page('contacts', [contact('contact-a')]),
      },
      { type: 'load-start', section: 'contacts', accountKey: 'account-a', generation: 2, mode: 'replace' },
      {
        type: 'load-error', section: 'contacts', accountKey: 'account-a', generation: 2,
        message: '联系人加载失败',
      },
    )

    expect(state.sections.contacts.status).toBe('error')
    expect(state.sections.contacts.items.map(directoryItemKey)).toEqual(['contact:contact-a'])
    expect(state.sections.contacts.warning).toBe('联系人加载失败')
  })

  it('discards a stale cursor page and returns the expanded section to first-page loading eligibility', () => {
    let state = createContactDirectoryState('account-a')
    state = reduce(state,
      { type: 'load-start', section: 'contacts', accountKey: 'account-a', generation: 1, mode: 'replace' },
      {
        type: 'load-success', section: 'contacts', accountKey: 'account-a', generation: 1, mode: 'replace',
        page: page('contacts', [contact('contact-a')], { total: 2, hasMore: true, nextCursor: 'expired' }),
      },
      { type: 'load-start', section: 'contacts', accountKey: 'account-a', generation: 2, mode: 'append' },
      {
        type: 'load-success', section: 'contacts', accountKey: 'account-a', generation: 2, mode: 'append',
        page: page('contacts', [contact('ignored')], { cursorStale: true }),
      },
    )

    expect(state.sections.contacts.items.map(directoryItemKey)).toEqual(['contact:contact-a'])
    expect(state.sections.contacts).toMatchObject({ status: 'idle', hasMore: false, nextCursor: undefined })
    expect(sectionNeedsInitialLoad(state.sections.contacts)).toBe(true)
  })

  it('rejects completions unless section, generation, and account all match', () => {
    let state = createContactDirectoryState('account-a')
    state = reduce(state,
      { type: 'load-start', section: 'contacts', accountKey: 'account-a', generation: 3, mode: 'replace' },
      {
        type: 'load-success', section: 'contacts', accountKey: 'account-a', generation: 2, mode: 'replace',
        page: page('contacts', [contact('old-generation')]),
      },
      {
        type: 'load-success', section: 'groups', accountKey: 'account-a', generation: 3, mode: 'replace',
        page: page('groups', [group('wrong-section')]),
      },
      {
        type: 'load-success', section: 'contacts', accountKey: 'account-b', generation: 3, mode: 'replace',
        page: page('contacts', [contact('wrong-account')]),
      },
    )

    expect(state.sections.contacts.status).toBe('loading')
    expect(state.sections.contacts.items).toEqual([])
    expect(state.sections.groups.items).toEqual([])
  })

  it('clears a contact or speaker selection when a replacement page removes it', () => {
    let contactState = createContactDirectoryState('account-a')
    contactState = reduce(contactState,
      { type: 'select', selection: { kind: 'contact', contactRef: 'contact-a' } },
      { type: 'load-start', section: 'contacts', accountKey: 'account-a', generation: 1, mode: 'replace' },
      {
        type: 'load-success', section: 'contacts', accountKey: 'account-a', generation: 1, mode: 'replace',
        page: page('contacts', [contact('contact-b')]),
      },
    )
    expect(contactState.selection).toEqual({ kind: 'none' })

    let speakerState = createContactDirectoryState('account-a')
    speakerState = reduce(speakerState,
      { type: 'select', selection: { kind: 'unmarked-speaker', candidateRef: 'speaker-a' } },
      { type: 'load-start', section: 'unmarked-speakers', accountKey: 'account-a', generation: 1, mode: 'replace' },
      {
        type: 'load-success', section: 'unmarked-speakers', accountKey: 'account-a', generation: 1, mode: 'replace',
        page: page('unmarked-speakers', [speaker('speaker-b')]),
      },
    )
    expect(speakerState.selection).toEqual({ kind: 'none' })
  })

  it('resets every section and selection when the account changes', () => {
    let state = createContactDirectoryState('account-a')
    state = reduce(state,
      { type: 'select', selection: { kind: 'contact', contactRef: 'contact-a' } },
      { type: 'set-expanded', section: 'groups', expanded: true },
      { type: 'load-start', section: 'contacts', accountKey: 'account-a', generation: 7, mode: 'replace' },
      {
        type: 'load-success', section: 'contacts', accountKey: 'account-a', generation: 7, mode: 'replace',
        page: page('contacts', [contact('contact-a')], { total: 1 }),
      },
      { type: 'reset-account', accountKey: 'account-b' },
    )

    expect(state.accountKey).toBe('account-b')
    expect(state.selection).toEqual({ kind: 'none' })
    expect(CONTACT_DIRECTORY_SECTION_ORDER.map(section => ({
      section,
      accountKey: state.sections[section].accountKey,
      status: state.sections[section].status,
      items: state.sections[section].items,
      generation: state.sections[section].generation,
      expanded: state.sections[section].expanded,
    }))).toEqual([
      { section: 'groups', accountKey: 'account-b', status: 'idle', items: [], generation: 0, expanded: false },
      { section: 'bots', accountKey: 'account-b', status: 'idle', items: [], generation: 0, expanded: false },
      { section: 'unmarked-speakers', accountKey: 'account-b', status: 'idle', items: [], generation: 0, expanded: false },
      { section: 'teams', accountKey: 'account-b', status: 'idle', items: [], generation: 0, expanded: false },
      { section: 'contacts', accountKey: 'account-b', status: 'idle', items: [], generation: 0, expanded: true },
    ])
  })
})
