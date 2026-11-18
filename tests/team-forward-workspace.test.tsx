// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { UnifiedForwardDialog } from '../src/client/UnifiedForwardDialog.js'
import { SourceForwardAttempt } from '../src/client/source-forward-attempt.js'
import { projectUnifiedForwardTargets } from '../src/client/unified-forward-targets.js'
import { teamDirectoryPreferences } from '../src/client/team-directory-preferences.js'
import type { TeamChannel, TeamConversation } from '../src/team-app-contract.js'
import type { TeamWorkspaceEntry, TeamWorkspaceFolder, TeamWorkspacePage } from '../src/team-group-contract.js'
import type { ArkmeSourceItem } from '../src/types.js'
const mocks = vi.hoisted(() => ({ call: vi.fn(), directory: vi.fn(), auth: { status: 'authenticated', environment: 'test', userId: 11 }, refresh: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/unified-forward-directory.js', () => ({ useUnifiedForwardDirectory: mocks.directory }))
vi.mock('../src/client/auth-store.js', () => ({ arkmeAuthStore: { getSnapshot: () => ({ auth: mocks.auth }), subscribe: () => () => {} } }))
vi.mock('../src/client/direct-message-admission.js', () => ({ requireDirectMessageSendAllowed: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../src/client/ArkmeAvatar.js', () => ({ ArkmeDirectorySourceAvatar: () => null, ArkmeUserAvatar: () => null }))
vi.mock('../src/client/ArkmeTeamAvatar.js', () => ({ ArkmeTeamChannelAvatar: () => null }))
vi.mock('../src/client/team-avatar-image-runtime.js', () => ({ teamAvatarImages: {} }))
const channel: TeamChannel = { teamRef: 'team-a', jotmoId: 'support', name: 'Support', enabled: true, publicRef: '', link: '', revision: 1, canManage: false }
const folder: TeamWorkspaceFolder = { channel, activityAt: 300, preview: '', unread: 0, groupCount: 1, hasPublished: true, groups: [{ sourceKey: 'delegated-a', unread: 0, lastSeq: 1 }] }
const group = (key = 'a', at = 300): TeamWorkspaceEntry => ({ kind: 'group', key, activityAt: at, entryKey: `entry-${key}`, entryRef: `entry-ref-${key}`,
  source: { kind: 'group_chat', sourceRef: `sealed-${key}`, sourceKey: `delegated-${key}`, canonicalChatSourceKey: 'same-chat', accessKind: 'team_delegation', teamWorkspace: { ref: channel.teamRef, jotmoId: channel.jotmoId }, displayName: `客户群${key}`, activeAtMillis: at, unreadCount: 0 } })
const page = (items: TeamWorkspaceEntry[], more = false, cursor = 'next'): TeamWorkspacePage => ({ items, complete: true, resetRequired: false, unavailableSources: [], hasMore: more, ...(more ? { nextCursor: cursor } : {}) })
let host: HTMLDivElement, root: Root
let preferences: Record<string, { pinned: boolean; dismissed: boolean }>, conversations: TeamConversation[]
let supported = true
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.auth.userId = 11; mocks.call.mockReset(); mocks.refresh.mockReset().mockResolvedValue(undefined)
  supported = true; preferences = {}; conversations = []; channel.teamRef = 'team-a'; delete channel.entryKey
  teamDirectoryPreferences.setWorkspaceAvailable('test:11', true)
  vi.spyOn(teamDirectoryPreferences, 'hydrate').mockResolvedValue()
  vi.spyOn(teamDirectoryPreferences, 'reconcileTargets').mockResolvedValue()
  vi.spyOn(teamDirectoryPreferences, 'workspacePins').mockReturnValue([])
  mocks.directory.mockImplementation(() => ({ rows: projectUnifiedForwardTargets([], conversations, preferences, true, [folder]), preferences,
    workspaceSupported: supported, conversations, loading: false, hasMore: false, error: '', refresh: mocks.refresh }))
  mocks.call.mockImplementation(async operation => operation === 'team.app.workspace' ? page([group()]) : { state: 'ready', membershipPolicy: 'independent', teams: [],
    fixedIdentity: { team: { name: 'Support', jotmoId: 'support', teamRef: 'team-a' }, selection: { teamRef: 'team-a', membershipKind: 'member', membershipRevision: 1, groupJoinAt: 1, groupMembershipUid: 'membership', groupMembershipRevision: 2 } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
const button = (name: string) => [...dialog().querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent === name || el.getAttribute('aria-label') === name)!
const target = (name: string) => [...dialog().querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find(el => el.textContent?.includes(name))!
const click = async (el: HTMLElement) => { await act(async () => el.click()) }
async function mount(sender = vi.fn().mockResolvedValue({ itemUid: 'sent', localState: 'synced' }), account = 'test:11') {
  const attempt = new SourceForwardAttempt('ordinary-source', ['action'], Number(account.split(':')[1]), sender)
  await act(async () => root.render(<UnifiedForwardDialog accountKey={account} attempt={attempt} previewTitle="消息" previewSubtitle="" onClose={() => {}} onComplete={() => {}} />))
  return { sender, attempt }
}
const expand = () => click(button('展开团队 Support'))
it('does not fan out on open; expands a group-only folder, keeps its identity and sends the scoped source', async () => {
  const { sender } = await mount()
  expect(mocks.call).not.toHaveBeenCalled()
  await expand()
  expect(target('Support · 客户群a')).toBeTruthy()
  await click(target('Support · 客户群a'))
  expect(dialog().querySelector('[title*="固定代表该团队"]')).toBeTruthy()
  expect(dialog().textContent).not.toContain('个人身份')
  await click(button('发送转发'))
  expect(sender.mock.calls[0]![0]).toMatchObject({ sourceRef: 'ordinary-source', targetSourceRef: 'sealed-a', expectedUserId: 11 })
  expect(mocks.call.mock.calls.filter(([operation]) => operation === 'team.app.workspace')).toHaveLength(1)
})
it('merges pages, preserves selection across navigation and uses the exact server continuation', async () => {
  mocks.call.mockImplementation(async (operation, params) => operation === 'team.app.workspace' ? params.cursor ? page([group('b', 200)]) : page([group()], true) : { state: 'backend_pending', teams: [] })
  await mount(); await expand(); await click(target('客户群a'))
  await click(button('更多团队会话'))
  expect(mocks.call.mock.calls.filter(([operation]) => operation === 'team.app.workspace').at(-1)![1]).toEqual({ expectedAccountKey: 'test:11', teamRef: 'team-a', cursor: 'next' })
  expect(target('客户群b')).toBeTruthy(); expect(target('客户群a').getAttribute('aria-pressed')).toBe('true')
  await click(button('返回转发对象')); await expand()
  expect(target('客户群a').getAttribute('aria-pressed')).toBe('true')
})
it('uses group entry pins and hidden preferences together with existing silent member contacts', async () => {
  const silent = { key: 'silent', entryKey: 'silent', ref: 'silent-ref', side: 'team', channel, visitor: { nickname: '新联系' }, lastSeq: 0, memberInitiated: true, updatedAt: 10 } as TeamConversation
  conversations = [silent]; preferences = { 'entry-b': { pinned: true, dismissed: false }, 'entry-hidden': { pinned: false, dismissed: true } }
  mocks.call.mockResolvedValue(page([group('a'), group('b', 1), group('hidden', 500), { kind: 'customer', key: 'silent', activityAt: 10, conversation: silent }]))
  await mount(); await expand()
  expect([...dialog().querySelectorAll('button[aria-pressed]')].map(el => el.textContent)).toEqual([expect.stringContaining('客户群b'), expect.stringContaining('客户群a'), expect.stringContaining('新联系')])
  expect(dialog().textContent).not.toContain('客户群hidden')
})
it('does not advance an incomplete or reset cursor and retries from a fresh authoritative page', async () => {
  mocks.call.mockResolvedValue({ ...page([group()], true), complete: false, unavailableSources: ['groups'] })
  await mount(); await expand()
  expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('尚不完整')
  expect(button('更多团队会话')).toBeUndefined()
  mocks.call.mockResolvedValue(page([group('b')]))
  await click(button('重试'))
  expect(target('客户群a')).toBeUndefined(); expect(target('客户群b')).toBeTruthy()
  expect(mocks.call.mock.calls.filter(([operation]) => operation === 'team.app.workspace').at(-1)![1]).toEqual({ expectedAccountKey: 'test:11', teamRef: 'team-a' })
})
it('retires revoked group targets and their unsubmitted selection after focus revalidation', async () => {
  await mount(); await expand(); await click(target('客户群a'))
  mocks.call.mockRejectedValue({ message: '撤权', body: { code: 'team-team_group_membership_stale' } })
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(target('客户群a')).toBeUndefined()
  expect(dialog().querySelectorAll('[aria-pressed="true"]')).toHaveLength(0)
  expect(button('发送转发')).toBeUndefined()
})
it('keeps the legacy private contact path on a server without workspace support', async () => {
  supported = false
  conversations = [{ key: 'legacy', ref: 'legacy-ref', side: 'team', channel, visitor: { nickname: '原联系人' }, updatedAt: 20 } as TeamConversation]
  await mount(); await expand()
  expect(target('原联系人')).toBeTruthy(); expect(mocks.call).not.toHaveBeenCalled()
})

it('rejects a repeated continuation without replacing already-authorized rows', async () => {
  mocks.call.mockImplementation(async (operation, params) => operation === 'team.app.workspace'
    ? params.cursor ? page([group('bad')], true, 'next') : page([group()], true, 'next') : { state: 'backend_pending', teams: [] })
  await mount(); await expand(); await click(button('更多团队会话'))
  expect(target('客户群a')).toBeTruthy(); expect(target('客户群bad')).toBeUndefined()
  expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('分页异常')
})
it('drops a stale page on reset and requires a fresh cursor before continuing', async () => {
  let reset = false
  mocks.call.mockImplementation(async operation => operation === 'team.app.workspace'
    ? reset ? { ...page([group('new')], true), resetRequired: true } : page([group()], true) : { state: 'backend_pending', teams: [] })
  await mount(); await expand(); await click(target('客户群a')); reset = true
  await click(button('更多团队会话'))
  expect(target('客户群a')).toBeUndefined(); expect(target('客户群new')).toBeTruthy()
  expect(dialog().querySelectorAll('[aria-pressed="true"]')).toHaveLength(0)
  expect(button('更多团队会话')).toBeUndefined()
  expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('来源权限已变化')
})
it('does not leak a late result across accounts even when the network ignores cancellation', async () => {
  let release!: (value: TeamWorkspacePage) => void, oldSignal!: AbortSignal
  mocks.call.mockImplementation(async (operation, params, signal) => {
    if (operation !== 'team.app.workspace') return { state: 'backend_pending', teams: [] }
    if (params.expectedAccountKey === 'test:11') { oldSignal = signal; return new Promise<TeamWorkspacePage>(resolve => { release = resolve }) }
    return page([group('other-account')])
  })
  await mount(); await expand(); expect(oldSignal.aborted).toBe(false)
  mocks.auth.userId = 12
  await mount(undefined, 'test:12')
  expect(oldSignal.aborted).toBe(true)
  await act(async () => release(page([group('old-account')])))
  expect(target('客户群old-account')).toBeUndefined(); expect(target('客户群other-account')).toBeTruthy()
})
it('aborts the expanded workspace request when the dialog unmounts', async () => {
  let release!: (value: TeamWorkspacePage) => void, signal!: AbortSignal
  mocks.call.mockImplementation(async (_operation, _params, value) => { signal = value; return new Promise<TeamWorkspacePage>(resolve => { release = resolve }) })
  await mount(); await expand()
  await act(async () => root.render(null))
  expect(signal.aborted).toBe(true)
  await act(async () => release(page([group('late')])))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
it('resolves pinned group entries outside the current page through the same workspace owner', async () => {
  preferences = { 'entry-deep': { pinned: true, dismissed: false } }
  vi.mocked(teamDirectoryPreferences.workspacePins).mockReturnValue([{ kind: 'group', ref: 'deep-entry' }])
  mocks.call.mockImplementation(async operation => operation === 'team.app.workspace' ? page([group()]) : page([group('deep', 1)]))
  await mount(); await expand()
  expect([...dialog().querySelectorAll('button[aria-pressed]')].map(el => el.textContent)).toEqual([expect.stringContaining('客户群deep'), expect.stringContaining('客户群a')])
  expect(mocks.call).toHaveBeenCalledWith('team.app.workspace.request', { expectedAccountKey: 'test:11', request: { operation: 'resolve-entries', teamRef: 'team-a', entries: [{ kind: 'group', ref: 'deep-entry' }] } }, expect.any(AbortSignal))
})
it('keeps selection while a same-team opaque reference rotates and ignores the superseded request', async () => {
  await mount(); await expand(); await click(target('客户群a'))
  let release!: (value: TeamWorkspacePage) => void
  mocks.call.mockImplementation(async (operation, params) => operation === 'team.app.workspace'
    ? new Promise<TeamWorkspacePage>(resolve => { release = resolve }) : { state: 'backend_pending', teams: [] })
  channel.teamRef = 'rotated-team-ref'
  await mount()
  expect(target('客户群a').getAttribute('aria-pressed')).toBe('true')
  expect(mocks.call.mock.calls.filter(([operation]) => operation === 'team.app.workspace').at(-1)![1]).toEqual({ expectedAccountKey: 'test:11', teamRef: 'rotated-team-ref' })
  await act(async () => release(page([group()])))
  expect(target('客户群a').getAttribute('aria-pressed')).toBe('true')
})
it('does not retain targets when a different stable team owner reuses the displayed folder key', async () => {
  channel.entryKey = 'owner-a'
  await mount(); await expand(); await click(target('客户群a'))
  let release!: (value: TeamWorkspacePage) => void
  mocks.call.mockImplementation(async () => new Promise<TeamWorkspacePage>(resolve => { release = resolve }))
  channel.entryKey = 'owner-b'; channel.teamRef = 'other-owner'
  await mount()
  expect(target('客户群a')).toBeUndefined()
  expect(dialog().querySelectorAll('[aria-pressed="true"]')).toHaveLength(0)
  await act(async () => release(page([group('other-owner')])))
  expect(target('客户群other-owner')).toBeTruthy()
  delete channel.entryKey
})
