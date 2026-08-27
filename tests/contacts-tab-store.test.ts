import { describe, expect, it, vi } from 'vitest'
import { ContactsTabStore } from '../src/client/redesign/contacts/contacts-tab-store.js'
import {
  contactDirectoryReducer,
  createContactDirectoryState,
} from '../src/client/redesign/contacts/contact-directory-state.js'

describe('contacts tab store', () => {
  it('synchronously aborts registered handoffs before every selection or account replacement', () => {
    const store = new ContactsTabStore()
    const abort = vi.fn()
    store.bindAborter(abort)

    store.activateAccount('prod:1')
    store.select({ kind: 'contact', contactRef: 'contact-1' })
    store.refresh()
    store.clear()
    store.activateAccount('stage:2')

    expect(abort).toHaveBeenCalledTimes(5)
    expect(store.getSnapshot()).toMatchObject({ accountKey: 'stage:2', selection: { kind: 'none' } })
  })

  it('retains section folds across a Conversations round trip for the same account', () => {
    const store = new ContactsTabStore()
    store.activateAccount('prod:1')
    store.setSectionExpanded('groups', true)
    store.setSectionExpanded('contacts', false)

    expect(store.getSnapshot().expandedSections).toMatchObject({ groups: true, contacts: false })
    expect(store.getSnapshotForAccount('prod:1').expandedSections).toMatchObject({ groups: true, contacts: false })
  })

  it('retains a fresh account-scoped directory across a Conversations round trip and expires it without exposing it to another account', () => {
    let now = 1_000
    const store = new ContactsTabStore({ now: () => now, directoryCacheMaxAgeMs: 30_000 })
    store.activateAccount('prod:1')
    const initial = createContactDirectoryState('prod:1')
    const loading = contactDirectoryReducer(initial, {
      type: 'load-start', section: 'contacts', accountKey: 'prod:1', generation: 1, mode: 'replace',
    })
    const ready = contactDirectoryReducer(loading, {
      type: 'load-success', section: 'contacts', accountKey: 'prod:1', generation: 1, mode: 'replace',
      page: {
        section: 'contacts', total: 1, hasMore: false,
        items: [{ kind: 'contact', contactRef: 'contact-1', displayName: '联系人一', nickname: '联系人一', remark: '', letter: 'L' }],
      },
    })

    store.cacheDirectoryState(ready, true)
    store.clear()

    expect(store.getDirectoryCache('prod:1')).toMatchObject({
      fresh: true,
      state: { sections: { contacts: { total: 1, items: [{ contactRef: 'contact-1' }] } } },
    })
    expect(store.getDirectoryCache('prod:1')?.state.selection).toEqual({ kind: 'none' })

    now = 31_001
    expect(store.getDirectoryCache('prod:1')?.fresh).toBe(false)
    store.activateAccount('stage:1')
    expect(store.getDirectoryCache('prod:1')).toBeUndefined()
    expect(store.getDirectoryCache('stage:1')).toBeUndefined()
  })
})
