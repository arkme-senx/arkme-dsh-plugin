import { describe, expect, it, vi } from 'vitest'
import { retryArkmeRead } from '../src/client/read-retry.js'
import { createContactDirectoryState, contactDirectoryReducer } from '../src/client/redesign/contacts/contact-directory-state.js'

describe('directory failure recovery boundary', () => {
  it('retains known contacts and selection for partial refresh but replaces an authoritative complete refresh', () => {
    let state = createContactDirectoryState('account')
    const old = { kind: 'contact' as const, contactRef: 'old', displayName: '旧联系人', nickname: '', remark: '', letter: '#' }
    const current = { ...old, contactRef: 'current', displayName: '新联系人' }
    state.sections.contacts = { ...state.sections.contacts, status: 'ready', items: [old], total: 1, generation: 1 }
    state.selection = { kind: 'contact', contactRef: 'old' }
    const action = { type: 'load-success' as const, section: 'contacts' as const, accountKey: 'account', generation: 1, mode: 'replace' as const,
      page: { section: 'contacts' as const, items: [current], total: 1, hasMore: false, coverage: 'partial' as const } }
    state = contactDirectoryReducer(state, action)
    expect(state.sections.contacts.items).toEqual([old, current])
    expect(state.sections.contacts.total).toBe(2)
    expect(state.selection).toEqual({ kind: 'contact', contactRef: 'old' })
    state = contactDirectoryReducer(state, { ...action, page: { ...action.page, coverage: 'complete' } })
    expect(state.sections.contacts.items).toEqual([current])
    expect(state.selection).toEqual({ kind: 'none' })
  })

  it('keeps group pagination distinct from a partial contact projection and propagates count coverage', () => {
    let state = createContactDirectoryState('account')
    const old = { kind: 'group' as const, sourceRef: 'old', displayName: '旧群' }
    const current = { ...old, sourceRef: 'new' }
    state.sections.groups = { ...state.sections.groups, items: [old], generation: 1 }
    state = contactDirectoryReducer(state, { type: 'load-success', section: 'groups', accountKey: 'account', generation: 1, mode: 'replace',
      page: { section: 'groups', items: [current], total: 1, hasMore: true, nextCursor: 'next', coverage: 'partial' } })
    expect(state.sections.groups.items).toEqual([current])
    state = contactDirectoryReducer(state, { type: 'load-success', section: 'contacts', accountKey: 'account', generation: 0, mode: 'count',
      page: { section: 'contacts', items: [], total: 2, hasMore: false, coverage: 'partial' } })
    expect(state.sections.contacts.coverage).toBe('partial')
  })

  it('does not multiply exhausted Host attempts in the browser', async () => {
    const failure = Object.assign(new Error('繁忙'), { body: { retryable: true, recovery: { owner: 'host', attempts: 3, exhausted: true } } })
    const read = vi.fn().mockRejectedValue(failure)
    await expect(retryArkmeRead(read)).rejects.toBe(failure)
    expect(read).toHaveBeenCalledOnce()
  })
  it.each(['groups', 'bots', 'unmarked-speakers', 'teams', 'contacts'] as const)('keeps existing %s rows after a refresh failure', section => {
    let state = createContactDirectoryState('account')
    const row = { kind: 'group' as const, sourceRef: 'opaque', displayName: 'Existing' }
    state.sections[section] = { ...state.sections[section], status: 'ready', items: [row], total: 1 }
    state = contactDirectoryReducer(state, { type: 'load-start', section, accountKey: 'account', generation: 1, mode: 'replace' })
    state = contactDirectoryReducer(state, { type: 'load-error', section, accountKey: 'account', generation: 1, message: '暂时繁忙' })
    expect(state.sections[section]).toMatchObject({ status: 'error', items: [row], total: 1, warning: '暂时繁忙' })
  })
})
