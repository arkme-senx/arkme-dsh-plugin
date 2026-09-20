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

  it('publishes changed cross-seat selections once and skips repeated clear or select snapshots', () => {
    const store = new ContactsTabStore()
    const abort = vi.fn()
    const listener = vi.fn()
    store.bindAborter(abort)
    store.activateAccount('prod:1')
    store.subscribe(listener)
    const initial = store.getSnapshot()

    store.clear()
    expect(store.getSnapshot()).toBe(initial)
    expect(listener).not.toHaveBeenCalled()

    store.select({ kind: 'contact', contactRef: 'contact-1' })
    const selected = store.getSnapshot()
    expect(selected.selection).toEqual({ kind: 'contact', contactRef: 'contact-1' })
    expect(listener).toHaveBeenCalledTimes(1)

    store.select({ kind: 'contact', contactRef: 'contact-1' })
    expect(store.getSnapshot()).toBe(selected)
    expect(listener).toHaveBeenCalledTimes(1)

    store.clear()
    const cleared = store.getSnapshot()
    expect(cleared.selection).toEqual({ kind: 'none' })
    expect(listener).toHaveBeenCalledTimes(2)

    store.clear()
    expect(store.getSnapshot()).toBe(cleared)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(abort).toHaveBeenCalledTimes(6)
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


it('updates the cached contact name without losing selection, preserves it against late cache writes, and isolates accounts', () => {
  const store = new ContactsTabStore()
  store.activateAccount('a')
  const state = createContactDirectoryState('a')
  state.sections.contacts.items = [{ kind: 'contact', contactRef: 'ref', displayName: '小满', nickname: '小满', remark: '', letter: 'X' }]
  store.cacheDirectoryState(state, true)
  store.select({ kind: 'contact', contactRef: 'ref' })
  const profile = { contactRef: 'ref', displayName: '设计同事', nickname: '小满', remark: '设计同事' }
  store.updateContactProfile('a', profile)
  store.cacheDirectoryState(state, false)
  expect(store.getDirectoryCache('a')?.state.sections.contacts.items[0]).toMatchObject({ displayName: '设计同事', remark: '设计同事', letter: 'S' })
  expect(store.getSnapshot().selection).toEqual({ kind: 'contact', contactRef: 'ref' })
  expect(store.getSnapshot().contactProfiles.ref).toEqual(profile)
  store.activateAccount('b')
  store.updateContactProfile('a', profile)
  expect(store.getSnapshot().contactProfiles).toEqual({})
})

it('invalidates directory data after an add intent while retaining section preferences', () => {
  const store = new ContactsTabStore()
  store.activateAccount('prod:1')
  store.setSectionExpanded('groups', true)
  store.cacheDirectoryState(createContactDirectoryState('prod:1'), true)
  expect(store.getDirectoryCache('prod:1')).toBeDefined()
  store.invalidateDirectoryCache()
  expect(store.getDirectoryCache('prod:1')).toBeUndefined()
  expect(store.getSnapshot().expandedSections.groups).toBe(true)
})


it('accepts fresh directory data after a saved profile but keeps saves newer than the request', () => {
  const store = new ContactsTabStore()
  store.activateAccount('test:1')
  const saved = { contactRef: 'stable-ref', displayName: '本地备注', remark: '本地备注', nickname: '小满' }
  store.updateContactProfile('test:1', saved)
  const profilesAtStart = store.getSnapshot().contactProfiles
  const state = createContactDirectoryState('test:1')
  state.sections.contacts.items = [{ kind: 'contact', contactRef: 'stable-ref', displayName: '其他设备的新备注', remark: '其他设备的新备注', nickname: '新昵称', letter: 'Q' }]
  store.cacheDirectoryState(state, true, profilesAtStart)
  expect(store.getSnapshot().contactProfiles).toEqual({})
  expect(store.getDirectoryCache('test:1')?.state.sections.contacts.items[0]).toMatchObject({ displayName: '其他设备的新备注', nickname: '新昵称' })

  store.updateContactProfile('test:1', saved)
  const olderRead = store.getSnapshot().contactProfiles
  store.updateContactProfile('test:1', { ...saved, displayName: '后保存的备注', remark: '后保存的备注' })
  store.cacheDirectoryState(state, true, olderRead)
  expect(store.getDirectoryCache('test:1')?.state.sections.contacts.items[0]).toMatchObject({ displayName: '后保存的备注' })
  expect(store.getSnapshot().contactProfiles['stable-ref']?.remark).toBe('后保存的备注')
})
