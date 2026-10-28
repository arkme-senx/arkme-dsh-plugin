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
  const transport = vi.fn(async (operation: string, p: Record<string, any>) => {
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
  await f.store.restoreReference('a', { kind: 'folder', ref: 'team-ref' })
  expect(f.transport.mock.calls.some(([op]) => op.endsWith('.change'))).toBe(false)
  await f.store.restoreTarget('a', folder)
  expect(teamEntryHidden(f.store.read('a'), folder)).toBe(false)
})
