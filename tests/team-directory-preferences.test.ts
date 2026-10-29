// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import type { TeamConversation } from '../src/team-app-contract.js'
import type { TeamEntryPreferenceSnapshot, TeamEntryPreferencePage } from '../src/team-entry-preference-contract.js'
import { TeamDirectoryPreferenceStore, teamEntryHidden, teamEntryPinned, type TeamEntryTarget } from '../src/client/team-directory-preferences.js'
import { groupTeamConversations, mergeTeamDirectoryRows } from '../src/client/team-conversation-directory.js'
const channel = { entryKey: 'folder-key', teamRef: 'team-ref', name: '团队', jotmoId: 'team', publicRef: '', link: '', enabled: true, revision: 1, canManage: false }
const conversation: TeamConversation = { entryKey: 'conversation-key', ref: 'conversation-ref', key: 'a', channel, side: 'team', lastSeq: 4, latestTeamReplySeq: 0, myReadSeq: 0, unread: 4, needsReply: true, blocked: false, revision: 1, updatedAt: 10 }
const direct: TeamEntryTarget = { kind: 'conversation', conversation }
const folder: TeamEntryTarget = { kind: 'folder', group: groupTeamConversations([conversation])[0]! }
const snapshot = (kind: 'folder' | 'conversation', extra = {}): TeamEntryPreferenceSnapshot => ({ key: `${kind}-key`, target: { kind, ref: `${kind === 'folder' ? 'team' : kind}-ref` }, accessible: true, pinned: false, dismissed: false, version: 0, activitySeq: 4, ...extra })
const page = (items: TeamEntryPreferenceSnapshot[]): TeamEntryPreferencePage => ({ schemaVersion: 1, items, hasMore: false })
function fixture() {
  const rows = new Map<string, TeamEntryPreferenceSnapshot>([['team-ref', snapshot('folder')], ['conversation-ref', snapshot('conversation')]])
  const transport = vi.fn(async (operation: string, p: Record<string, any>, _signal?: AbortSignal) => {
    if (operation.endsWith('.cached') || operation.endsWith('.list')) return page([...rows.values()])
    if (operation.endsWith('.query')) return page(p.entries.map((e: any) => rows.get(e.ref)!))
    for (const c of p.changes) {
      const old = rows.get(c.target.ref)!
      if (c.expectedVersion !== old.version) throw new Error('conflict')
      rows.set(c.target.ref, { ...old, version: old.version + 1, pinned: c.action === 'pin' || c.action === 'restore' && old.pinned, dismissed: c.action === 'dismiss' || c.action === 'unpin' && old.dismissed })
    }
    return page(p.changes.map((c: any) => rows.get(c.target.ref)!))
  })
  return { rows, transport, store: new TeamDirectoryPreferenceStore(transport as never) }
}
it('uses cloud projection without mutating unread, content, or other accounts', async () => {
  const { store } = fixture()
  await store.pin('a', folder, true)
  expect(teamEntryPinned(store.read('a'), folder)).toBe(true)
  expect(mergeTeamDirectoryRows([{ activeAtMillis: 100, pinned: false }], [conversation], true, store.read('a'))[0]).toMatchObject({ kind: 'team-folder' })
  await store.remove('a', folder)
  expect(teamEntryHidden(store.read('a'), folder)).toBe(true)
  expect(teamEntryHidden(store.read('b'), folder)).toBe(false)
  expect(conversation.unread).toBe(4)
})
it('accepts whole monotonic snapshots without inferring restoration from local metadata', async () => {
  const { store, rows } = fixture()
  rows.set('team-ref', snapshot('folder', { dismissed: true, version: 3, activitySeq: 5 }))
  await store.reconcile('a', [conversation], new AbortController().signal)
  rows.set('team-ref', snapshot('folder', { dismissed: false, version: 4, activitySeq: 4 }))
  await store.reconcile('a', [{ ...conversation, lastSeq: 99, updatedAt: 500 }], new AbortController().signal)
  expect(teamEntryHidden(store.read('a'), folder)).toBe(true)
  rows.set('team-ref', snapshot('folder', { dismissed: false, version: 3, activitySeq: 6 }))
  await store.reconcile('a', [conversation], new AbortController().signal)
  expect(teamEntryHidden(store.read('a'), folder)).toBe(false)
})
it('authority denial is distinct from dismissal and a team-side denial does not revoke visitor-side presentation', async () => {
  const f = fixture()
  f.rows.set('team-ref', snapshot('folder', { accessible: false }))
  await f.store.reconcile('a', [conversation], new AbortController().signal)
  expect(teamEntryHidden(f.store.read('a'), folder)).toBe(false)
  expect(f.store.canPresent('a', conversation)).toBe(false)
  expect(f.store.canPresent('a', { ...conversation, side: 'external', entryKey: 'visitor-key' })).toBe(true)
})
it('serializes rapid actions and restores parent + child in one command', async () => {
  const { store, transport } = fixture()
  await Promise.all([store.pin('a', direct, true), store.pin('a', direct, false)])
  expect(teamEntryPinned(store.read('a'), direct)).toBe(false)
  await store.remove('a', direct); await store.remove('a', folder)
  await store.restoreTarget('a', direct)
  expect(teamEntryHidden(store.read('a'), folder)).toBe(false)
  expect(teamEntryHidden(store.read('a'), direct)).toBe(false)
  expect(transport.mock.calls.filter(([op]) => op.endsWith('.change')).at(-1)?.[1].changes).toHaveLength(2)
})
it('rolls back failed optimism and discovers pins outside ordinary pages', async () => {
  const f = fixture()
  await f.store.hydrate('a')
  const impl = f.transport.getMockImplementation()!
  f.transport.mockImplementation(async (op, p) => { if (op.endsWith('.change')) throw new Error('offline'); return impl(op, p) })
  await expect(f.store.pin('a', direct, true)).rejects.toThrow('offline')
  expect(teamEntryPinned(f.store.read('a'), direct)).toBe(false)
  f.rows.set('team-ref', snapshot('folder', { pinned: true, version: 5 }))
  await f.store.hydrate('a', true)
  expect(f.store.missingPins('a', [])).toEqual([{ kind: 'folder', ref: 'team-ref' }])
})
it('keeps a legacy migration explanation until acknowledged, across normal refreshes', async () => {
  const f = fixture(), impl = f.transport.getMockImplementation()!
  let first = true
  f.transport.mockImplementation(async (op, p) => {
    const result = await impl(op, p)
    if (op.endsWith('.query') && first) { first = false; return { ...result, migrationNotice: '旧文件夹隐藏记录已保留为可见' } }
    return result
  })
  await f.store.reconcile('a', [conversation], new AbortController().signal)
  await f.store.hydrate('a', true)
  expect(f.store.error('a')).toContain('保留为可见')
  f.store.acknowledgeNotice('a'); expect(f.store.error('a')).toBe('')
})
it('empty navigation never restores, while an explicit restore supports a zero watermark', async () => {
  const f = fixture()
  f.rows.set('team-ref', snapshot('folder', { dismissed: true, version: 1, activitySeq: 0 }))
  const empty = { ...conversation, lastSeq: 0 }
  await f.store.restoreTarget('a', { kind: 'folder', group: groupTeamConversations([empty])[0]! }, true)
  expect(f.transport.mock.calls.some(([op]) => op.endsWith('.change'))).toBe(false)
  await f.store.restoreTarget('a', folder)
  expect(teamEntryHidden(f.store.read('a'), folder)).toBe(false)
})
it('explicit historical navigation restores a zero-counter folder and its child atomically', async () => {
  const f = fixture()
  f.rows.set('team-ref', snapshot('folder', { dismissed: true, version: 1, activitySeq: 0 }))
  f.rows.set('conversation-ref', snapshot('conversation', { dismissed: true, version: 2, activitySeq: conversation.lastSeq }))
  await f.store.restoreTarget('a', direct, true)
  expect(f.transport.mock.calls.filter(([op]) => op.endsWith('.change')).at(-1)?.[1].changes).toHaveLength(2)
  expect(teamEntryHidden(f.store.read('a'), folder)).toBe(false)
  expect(teamEntryHidden(f.store.read('a'), direct)).toBe(false)
})

it('reserves slow navigation before a later dismissal in the same command queue', async () => {
  const f = fixture()
  await f.store.remove('a', direct)
  let complete!: (target: TeamEntryTarget) => void
  const pending = new Promise<TeamEntryTarget>(resolve => { complete = resolve })
  const restore = f.store.restoreNavigation('a', () => pending)
  const dismiss = f.store.remove('a', direct)
  complete(direct)
  await Promise.all([restore, dismiss])
  expect(teamEntryHidden(f.store.read('a'), direct)).toBe(true)
  expect(f.transport.mock.calls.filter(([op]) => op.endsWith('.change')).slice(-2).map(([, p]) => p.changes[0].action)).toEqual(['restore', 'dismiss'])
})
it('cancelled navigation neither writes nor blocks the next user command', async () => {
  const f = fixture(), controller = new AbortController()
  let complete!: (target: TeamEntryTarget) => void
  const pending = new Promise<TeamEntryTarget>(resolve => { complete = resolve })
  const restore = f.store.restoreNavigation('a', () => pending, controller.signal)
  await Promise.resolve()
  controller.abort()
  const dismiss = f.store.remove('a', direct)
  complete(direct)
  await Promise.all([restore, dismiss])
  expect(teamEntryHidden(f.store.read('a'), direct)).toBe(true)
  expect(f.transport.mock.calls.filter(([op]) => op.endsWith('.change')).map(([, p]) => p.changes[0].action)).toEqual(['dismiss'])
  expect(f.store.error('a')).toBe('')
})

it('a later permission denial cannot be overwritten by an older in-flight projection', async () => {
  const f = fixture(), original = f.transport.getMockImplementation()!
  const old = page([snapshot('conversation', { pinned: true, version: 3 }), snapshot('folder', { pinned: true, version: 3 })])
  let complete!: (value: TeamEntryPreferencePage) => void
  let queries = 0
  f.transport.mockImplementation(async (op, p) => {
    if (op.endsWith('.query') && ++queries === 1) return new Promise<TeamEntryPreferencePage>(resolve => { complete = resolve })
    return original(op, p)
  })
  const previous = f.store.reconcile('a', [conversation], new AbortController().signal)
  await vi.waitFor(() => expect(queries).toBe(1))
  f.rows.set('team-ref', snapshot('folder', { accessible: false, activitySeq: 0 }))
  f.rows.set('conversation-ref', snapshot('conversation', { accessible: false, activitySeq: 0 }))
  const revoked = f.store.reconcile('a', [conversation], new AbortController().signal)
  await new Promise(resolve => setTimeout(resolve, 0))
  complete(old)
  await Promise.all([previous, revoked])
  expect(f.store.canPresent('a', conversation)).toBe(false)
  expect(f.store.missingPins('a', [])).toEqual([])
  // A later authorized read may establish new access; denial is not permanent.
  f.rows.set('team-ref', snapshot('folder', { version: 4 }))
  f.rows.set('conversation-ref', snapshot('conversation', { version: 4 }))
  await f.store.reconcile('a', [conversation], new AbortController().signal)
  expect(f.store.canPresent('a', conversation)).toBe(true)
})

it('a cancelled reconciliation does not dispatch or poison later commands', async () => {
  const f = fixture(), controller = new AbortController()
  controller.abort()
  const previous = f.store.reconcile('a', [conversation], controller.signal)
  const write = f.store.pin('a', direct, true)
  await expect(previous).rejects.toMatchObject({ name: 'AbortError' })
  await write
  expect(teamEntryPinned(f.store.read('a'), direct)).toBe(true)
  expect(f.transport.mock.calls.every(([, , signal]) => !signal?.aborted)).toBe(true)
})
it('a slow reconciliation in one account does not block another account', async () => {
  const f = fixture(), original = f.transport.getMockImplementation()!
  let complete!: (value: TeamEntryPreferencePage) => void
  f.transport.mockImplementation(async (op, p) => {
    if (p.expectedAccountKey === 'a') return new Promise<TeamEntryPreferencePage>(resolve => { complete = resolve })
    return original(op, p)
  })
  const read = f.store.reconcile('a', [conversation], new AbortController().signal)
  await vi.waitFor(() => expect(complete).toBeDefined())
  await f.store.pin('b', direct, true)
  expect(teamEntryPinned(f.store.read('b'), direct)).toBe(true)
  complete(page([snapshot('conversation'), snapshot('folder')]))
  await read
  expect(teamEntryPinned(f.store.read('a'), direct)).toBe(false)
})
