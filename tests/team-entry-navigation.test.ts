// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TeamConversation, TeamOpen } from '../src/team-app-contract.js'
const mock = vi.hoisted(() => ({ call: vi.fn(), open: vi.fn(), restore: vi.fn(), navigation: vi.fn(), auth: { status: 'authenticated', environment: 'test', userId: 11 } as Record<string, unknown>, listeners: new Set<() => void>() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mock.call }))
vi.mock('../src/client/auth-store.js', () => ({ arkmeAuthStore: { getSnapshot: () => ({ auth: mock.auth }), subscribe: (listener: () => void) => { mock.listeners.add(listener); return () => mock.listeners.delete(listener) } } }))
vi.mock('../src/client/team-directory-preferences.js', () => ({ teamDirectoryPreferences: { restoreTarget: mock.restore, restoreNavigation: mock.navigation } }))
vi.mock('../src/client/team-messaging-events.js', () => ({ openTeamMessages: mock.open, subscribeTeamMessageChanges: vi.fn() }))
import * as navigation from '../src/client/team-entry-navigation.js'
const { openTeamEntryMessages } = navigation
const c: TeamConversation = { ref: 'conversation', key: 'key', side: 'team', channel: { teamRef: 'folder', name: '团队', jotmoId: 'team', publicRef: '', link: '', enabled: true, revision: 1, canManage: false }, lastSeq: 3, latestTeamReplySeq: 0, myReadSeq: 0, unread: 3, needsReply: true, blocked: false, revision: 1, updatedAt: 1 }
beforeEach(() => {
  mock.auth = { status: 'authenticated', environment: 'test', userId: 11 }
  mock.navigation.mockImplementation(async (account, resolve, signal) => {
    const target = await resolve()
    if (target && (target.kind === 'folder' ? target.group.latest.lastSeq : target.conversation.lastSeq) > 0 && !signal?.aborted) await mock.restore(account, target, true)
  })
})
afterEach(() => { vi.resetAllMocks(); mock.listeners.clear() })
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
  expect(mock.call).toHaveBeenCalledWith('team.app.conversations', { teamRef: 'folder', side: 'team', limit: 1, expectedAccountKey: 'test:11' }, expect.any(AbortSignal))
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

it.each(['link', 'official'] as const)('explicit %s restores an existing external conversation from the authorized open result', async kind => {
  const external = { ...c, side: 'external' as const }
  mock.call.mockImplementation(async op => op === 'team.app.official' ? c.channel : { channel: c.channel, openInbox: false, conversation: external })
  openTeamEntryMessages(kind === 'link' ? { kind, publicRef: 'public-ref' } : { kind })
  expect(mock.open).toHaveBeenCalledOnce()
  await vi.waitFor(() => expect(mock.restore).toHaveBeenCalledWith('test:11', { kind: 'conversation', conversation: external }, true))
})

it('a member link restores a historical folder even when the new activity counter starts at zero', async () => {
  mock.call.mockImplementation(async op => op === 'team.app.open' ? { channel: c.channel, openInbox: true } : { items: [c], hasMore: false })
  openTeamEntryMessages({ kind: 'link', publicRef: 'public-ref' })
  await vi.waitFor(() => expect(mock.restore).toHaveBeenCalledWith('test:11', expect.objectContaining({ kind: 'folder' }), true))
})

it('shares one open request with the pane; remounting alone does not repeat the restore intent', async () => {
  let complete!: (value: TeamOpen) => void
  const opened = new Promise<TeamOpen>(resolve => { complete = resolve })
  mock.call.mockReturnValue(opened)
  openTeamEntryMessages({ kind: 'link', publicRef: 'public-ref' })
  const intent = mock.open.mock.calls[0]![0], signal = new AbortController().signal
  const view = navigation.loadTeamEntryOpen('test:11', intent, signal)
  complete({ channel: c.channel, openInbox: false, conversation: c })
  await view
  await vi.waitFor(() => expect(mock.restore).toHaveBeenCalledOnce())
  expect(mock.call.mock.calls.filter(([op]) => op === 'team.app.open')).toHaveLength(1)
  await navigation.loadTeamEntryOpen('test:11', intent, signal)
  expect(mock.restore).toHaveBeenCalledOnce()
  expect(mock.call.mock.calls.filter(([op]) => op === 'team.app.open')).toHaveLength(2)
})

it.each(['empty', 'cancelled', 'account-changed', 'account-ABA'] as const)('%s opening cannot restore a stale or empty entry', async outcome => {
  let complete!: (value: TeamOpen) => void
  mock.call.mockReturnValue(new Promise<TeamOpen>(resolve => { complete = resolve }))
  openTeamEntryMessages({ kind: 'link', publicRef: 'public-ref' })
  const intent = mock.open.mock.calls[0]![0], controller = new AbortController()
  const view = navigation.loadTeamEntryOpen('test:11', intent, controller.signal)
  if (outcome === 'cancelled') controller.abort()
  if (outcome.startsWith('account')) {
    mock.auth = { ...mock.auth, userId: 12 }; for (const listener of mock.listeners) listener()
    if (outcome === 'account-ABA') { mock.auth = { ...mock.auth, userId: 11 }; for (const listener of mock.listeners) listener() }
  }
  complete({ channel: c.channel, openInbox: false, conversation: { ...c, lastSeq: outcome === 'empty' ? 0 : c.lastSeq } })
  await view.catch(() => {})
  await vi.waitFor(() => expect(mock.listeners.size).toBe(0))
  expect(mock.restore).not.toHaveBeenCalled()
})

it('rejects a stale component event and keeps normal same-account token refresh alive', async () => {
  openTeamEntryMessages({ kind: 'team', teamRef: 'folder' }, 'test:12')
  expect(mock.open).not.toHaveBeenCalled()
  let complete!: (value: TeamOpen) => void
  mock.call.mockReturnValue(new Promise<TeamOpen>(resolve => { complete = resolve }))
  openTeamEntryMessages({ kind: 'link', publicRef: 'public-ref' }, 'test:11')
  const intent = mock.open.mock.calls[0]![0], signal = new AbortController().signal
  const view = navigation.loadTeamEntryOpen('test:11', intent, signal)
  mock.auth = { ...mock.auth, expiresAtMillis: 123456 }; for (const listener of mock.listeners) listener()
  complete({ channel: c.channel, openInbox: false, conversation: c })
  await view
  await vi.waitFor(() => expect(mock.restore).toHaveBeenCalledOnce())
})
