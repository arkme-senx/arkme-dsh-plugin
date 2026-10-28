// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { TeamConversation } from '../src/team-app-contract.js'
const mock = vi.hoisted(() => ({ call: vi.fn(), open: vi.fn(), restore: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mock.call }))
vi.mock('../src/client/auth-store.js', () => ({ arkmeAuthStore: { getSnapshot: () => ({ auth: { status: 'authenticated', environment: 'test', userId: 11 } }) } }))
vi.mock('../src/client/team-directory-preferences.js', () => ({ teamDirectoryPreferences: { restoreTarget: mock.restore } }))
vi.mock('../src/client/team-messaging-events.js', () => ({ openTeamMessages: mock.open, subscribeTeamMessageChanges: vi.fn() }))
import { openTeamEntryMessages } from '../src/client/team-entry-navigation.js'
const c: TeamConversation = { ref: 'conversation', key: 'key', side: 'team', channel: { teamRef: 'folder', name: '团队', jotmoId: 'team', publicRef: '', link: '', enabled: true, revision: 1, canManage: false }, lastSeq: 3, latestTeamReplySeq: 0, myReadSeq: 0, unread: 3, needsReply: true, blocked: false, revision: 1, updatedAt: 1 }
afterEach(() => vi.resetAllMocks())
it('opens a folder immediately, then restores only after authorized published history is found', async () => {
  let release!: (value: unknown) => void
  mock.call.mockReturnValue(new Promise(resolve => { release = resolve }))
  mock.restore.mockResolvedValue(undefined)
  const intent = { kind: 'team' as const, teamRef: 'folder' }
  openTeamEntryMessages(intent)
  expect(mock.open).toHaveBeenCalledWith(intent)
  expect(mock.restore).not.toHaveBeenCalled()
  release({ items: [c], hasMore: false })
  await vi.waitFor(() => expect(mock.restore).toHaveBeenCalledWith('test:11', expect.objectContaining({ kind: 'folder' }), true))
  expect(mock.call).toHaveBeenCalledWith('team.app.conversations', { teamRef: 'folder', side: 'team', limit: 1, expectedAccountKey: 'test:11' })
})
it.each([{ items: [] }, { items: [{ ...c, lastSeq: 0 }] }])('empty discovery never restores a folder: %j', async ({ items }) => {
  mock.call.mockResolvedValue({ items, hasMore: false })
  openTeamEntryMessages({ kind: 'team', teamRef: 'folder' })
  await vi.waitFor(() => expect(mock.open).toHaveBeenCalled())
  expect(mock.restore).not.toHaveBeenCalled()
})
it('a failed optional lookup cannot block navigation, and empty direct windows do not write', async () => {
  mock.call.mockRejectedValue(new Error('offline'))
  openTeamEntryMessages({ kind: 'team', teamRef: 'folder' })
  openTeamEntryMessages({ kind: 'conversation', conversation: { ...c, lastSeq: 0 } })
  await vi.waitFor(() => expect(mock.open).toHaveBeenCalledTimes(2))
  expect(mock.restore).not.toHaveBeenCalled()
})
