// @vitest-environment jsdom
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TeamOutboundDialog, TeamOutboundMount } from '../src/client/TeamOutboundDialog.js'
import { openTeamOutbound, type TeamOutboundIntent } from '../src/client/team-outbound.js'
import { ArkmeMemberProfileCard } from '../src/client/ArkmeChatMemberActions.js'
import { teamContactTeams } from '../src/client/team-contact.js'
import { arkmeConversationMembers } from '../src/client/conversation-members-store.js'
import { connectArkmeLocale } from '../src/client/locale.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeChatDirectory } from '../src/client/chat-directory-store.js'
import { teamOutboundContacts } from '../src/client/team-outbound-contacts.js'
import type { ArkmeSourceList } from '../src/types.js'

const { call, navigate, invalidate } = vi.hoisted(() => ({ call: vi.fn(), navigate: vi.fn(), invalidate: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: call }))
vi.mock('../src/client/provider-instance-runtime.js', () => ({ reconcileArkmeProviderInstance: vi.fn(async () => false) }))
vi.mock('../src/client/team-messaging-events.js', () => ({ openTeamMessages: navigate, invalidateTeamMessages: invalidate }))
const teams = [
  { teamRef: 'sealed-team-a', jotmoId: 'team_a', name: '即我', currentUserRole: 'member', createdAtMillis: 1, updatedAtMillis: 1 },
  { teamRef: 'sealed-team-b', jotmoId: 'team_b', name: '其他团队', currentUserRole: 'owner', createdAtMillis: 1, updatedAtMillis: 1 },
]
const intent: TeamOutboundIntent = { accountKey: 'prod:90', person: { displayName: '客户备注', recipient: { kind: 'chat-member', sourceRef: 'sealed-source', memberRef: 'sealed-member' } } }
const close = vi.fn()
let host: HTMLDivElement, root: Root
function button(text: string) { const found = [...document.querySelectorAll('button')].find(n => n.getAttribute('aria-label') === text || n.textContent === text || n.textContent === `${text}✓`); if (!found) throw new Error(`Missing button: ${text}`); return found }
const click = async (label: string) => act(async () => button(label).click())
const signIn = (accountKey: string) => arkmeAuthStore.setAuth({ status: 'authenticated', environment: accountKey.split(':')[0] as 'prod', userId: Number(accountKey.split(':')[1]) } as never)
const renderCard = async (accountKey = intent.accountKey) => act(async () => { signIn(accountKey); root.render(<ArkmeMemberProfileCard key={accountKey} member={{ displayName: '群友' }} busy={false} onClose={close} onSend={() => { throw new Error('personal send must not run') }} teamContact={{ accountKey, person: intent.person! }}/>); })
const render = async (value = intent) => act(async () => { signIn(value.accountKey); root.render(<TeamOutboundDialog intent={value} onClose={close} />); })
const selectTeam = async (id: string) => act(async () => { const node = document.querySelector('select')!; node.value = id; node.dispatchEvent(new Event('change', { bubbles: true })) })
async function query(value: string) {
  await act(async () => {
    const input = document.querySelector('input')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function groupProjection(names: string[], phase: 'syncing' | 'complete' | 'failed' = 'syncing', revision = 1, error?: string): ArkmeSourceList {
  const items = names.map((name, index) => ({ kind: 'group_chat' as const, sourceRef: `group-${name}`, sourceKey: `key-${name}`, displayName: name, activeAtMillis: names.length - index, unreadCount: 0 }))
  return { directory: 'root', items: items as never, hasMore: phase !== 'complete', projection: {
    revision, phase, cachedAtMillis: Date.now(), bots: [], visibility: items.map(item => ({ entryKind: 'source' as const, entryRef: item.sourceRef, hidden: false })), ...(error ? { error } : {}),
  } }
}
beforeEach(() => {
  localStorage.clear(); teamContactTeams.reset(); teamOutboundContacts.reset(); arkmeChatDirectory.activateAccount(undefined); arkmeChatDirectory.activateAccount('prod:90'); arkmeConversationMembers.activateAccount('prod:90'); signIn('prod:90')
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); call.mockReset()
  call.mockImplementation(async op => op === 'team.app.teams' ? [teams[0]] : ['directory.list', 'sources.list'].includes(op) ? { items: [], hasMore: false } : { state: 'backend_pending' })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('keeps the selected person and team on an unavailable response without manufacturing a conversation', async () => {
  await render(); expect(document.body.textContent).toContain('联系用户 · 即我')
  expect(call.mock.calls.map(v => v[0])).toEqual(['team.app.teams'])
  await click('发起会话')
  expect(call.mock.calls.at(-1)).toEqual(['team.app.outbound.open', {
    expectedAccountKey: 'prod:90', teamRef: 'sealed-team-a', recipient: intent.person!.recipient, requestUid: expect.any(String),
  }, expect.any(AbortSignal)])
  expect(document.body.textContent).toContain('团队会话返回异常')
  expect(document.body.textContent).toContain('客户备注')
  expect(button('发起会话').disabled).toBe(false)
  expect(navigate).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
  expect(call.mock.calls.map(v => v[0])).toEqual(['team.app.teams', 'team.app.outbound.open'])
})

it.each(teams)('shows the channel opening path for $currentUserRole and retains the original selection for retry', async selected => {
  const conversation = { ref: 'real-ref', side: 'team', channel: { jotmoId: selected.jotmoId } }
  let attempts = 0
  call.mockImplementation(async op => {
    if (op === 'team.app.teams') return [selected]
    if (++attempts === 1) throw Object.assign(new Error('团队已暂停接收新消息'), { body: { code: 'team-channel_paused' } })
    return { state: 'ready', conversation }
  })
  await render(); await click('发起会话')
  const heading = selected.currentUserRole === 'owner' ? '开启路径' : '请团队所有者开启'
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(`${heading}：联系人 → 团队 → ${selected.name} → 团队消息通道 → 接收外部消息`)
  expect(document.body.textContent).toContain('客户备注')
  expect(document.body.textContent).toContain(`联系用户 · ${selected.name}`)
  expect(close).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled()
  expect(call.mock.calls.map(v => v[0])).toEqual(['team.app.teams', 'team.app.outbound.open'])
  await click('发起会话')
  const opens = call.mock.calls.filter(v => v[0] === 'team.app.outbound.open')
  expect(opens[1]![1]).toEqual(opens[0]![1])
  expect(navigate).toHaveBeenCalledExactlyOnceWith({ kind: 'conversation', conversation })
})

it('keeps other opening errors distinct from a disabled team channel', async () => {
  await render()
  call.mockRejectedValueOnce(Object.assign(new Error('此对话已被屏蔽'), { body: { code: 'team-conversation_blocked' } }))
  await click('发起会话')
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('此对话已被屏蔽')
  expect(navigate).not.toHaveBeenCalled()
})

it('localizes the opening path while preserving the team name', async () => {
  const locale = (active: string) => connectArkmeLocale({ getLocale: () => ({ active }), subscribe: () => () => {} })
  const disconnect = locale('en')
  try {
    call.mockResolvedValueOnce([{ ...teams[1], name: '团队消息通道' }])
    await render()
    call.mockRejectedValueOnce(Object.assign(new Error('团队已暂停接收新消息'), { body: { code: 'team-channel_paused' } }))
    await act(async () => (document.querySelector('footer button:last-child') as HTMLButtonElement).click())
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Enable: Contacts → Teams → 团队消息通道 → Team message channel → Accept visitor messages')
  } finally {
    disconnect()
    await act(async () => { locale('zh')() })
  }
})

it('defaults multiple memberships and fixes a directory entry to its own team', async () => {
  call.mockResolvedValue(teams)
  await render(); expect(button('发起会话').disabled).toBe(false)
  await selectTeam('team_b'); expect(button('发起会话').disabled).toBe(false)
  await act(async () => root.render(<TeamOutboundDialog key="prefill" intent={{ ...intent, teamJotmoId: 'team_a' }} onClose={close} />))
  expect(document.querySelector('select')).toBeNull(); expect(document.body.textContent).toContain('联系用户 · 即我')
})

it('does not silently fall back to another team after membership loss or loading failure', async () => {
  call.mockResolvedValue([teams[1]])
  await render({ ...intent, teamJotmoId: 'team_a' })
  expect(document.querySelector('select')).toBeNull()
  expect(button('发起会话').disabled).toBe(true)
  expect(document.body.textContent).toContain('你已不在该团队中')
  call.mockRejectedValueOnce(new Error('网络断开')); await click('重试')
  expect(button('发起会话').disabled).toBe(true)
  call.mockResolvedValue([teams[0]]); await click('重试')
  expect(button('发起会话').disabled).toBe(false)
})

it('opens only the verified existing team conversation, and reuses the same idempotency key after an uncertain result', async () => {
  const wait = deferred(); const conversation = { ref: 'real-ref', key: 'real-key', side: 'team', channel: { jotmoId: 'team_a' } }
  let attempts = 0
  call.mockImplementation(async op => op === 'team.app.teams' ? [teams[0]] : ++attempts === 1 ? wait.promise : { state: 'ready', conversation })
  await render(); await act(async () => { button('发起会话').click(); button('发起会话').click() })
  expect(call.mock.calls.filter(v => v[0] === 'team.app.outbound.open')).toHaveLength(1)
  // Malformed/ambiguous responses must not manufacture a conversation.
  await act(async () => wait.resolve({ state: 'ready', conversation: { ...conversation, side: 'external' } }))
  expect(navigate).not.toHaveBeenCalled(); expect(document.body.textContent).toContain('团队会话返回异常')
  await click('发起会话')
  const opens = call.mock.calls.filter(v => v[0] === 'team.app.outbound.open')
  expect(opens[0]![1].requestUid).toBe(opens[1]![1].requestUid)
  expect(navigate).toHaveBeenCalledExactlyOnceWith({ kind: 'conversation', conversation })
  expect(invalidate).toHaveBeenCalledExactlyOnceWith('prod:90'); expect(close).toHaveBeenCalledOnce()
})

it('loads real contacts progressively and passes directory references without opening a private conversation', async () => {
  call.mockImplementation(async (op, p) => op === 'team.app.teams' ? [teams[0]] : op === 'sources.list' ? { items: [], hasMore: false } : op === 'directory.list' ? {
    items: [{ kind: 'contact', contactRef: p.cursor ? 'second-ref' : 'first-ref', displayName: p.cursor ? '乙' : '甲', remark: p.cursor ? '客户乙' : '客户甲' }],
    hasMore: !p.cursor, ...(p.cursor ? {} : { nextCursor: 'next' }),
  } : { state: 'backend_pending' })
  await act(async () => root.render(<StrictMode><TeamOutboundDialog intent={{ accountKey: 'prod:90', teamJotmoId: 'team_a' }} onClose={close} /></StrictMode>))
  expect(document.body.textContent).toContain('客户甲')
  await click('加载更多联系人'); await click('客户乙'); await click('发起会话')
  expect(call.mock.calls.at(-1)![1].recipient).toEqual({ kind: 'directory-contact', contactRef: 'second-ref' })
})

it.each([
  [{ registered: true, isSelf: true, contactRef: 'self' }, '请选择其他用户'],
  [{ registered: true, team: {} }, '请选择个人用户'],
  [{ registered: false }, '未找到已注册用户'],
])('rejects unsupported recipient lookup %j', async (result, message) => {
  await render({ accountKey: 'prod:90' }); await query('target')
  call.mockResolvedValue(result); await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(document.body.textContent).toContain(message); expect(button('发起会话').disabled).toBe(true)
})

it('accepts a registered non-contact lookup and ignores an older lookup after query changes', async () => {
  await render({ accountKey: 'prod:90' }); await query('old')
  const wait = deferred(); call.mockImplementationOnce(() => wait.promise)
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); const oldSignal = call.mock.calls.at(-1)![2]
  await query('new'); expect(oldSignal.aborted).toBe(true)
  call.mockResolvedValueOnce({ registered: true, isSelf: false, contactRef: 'lookup-ref', displayName: '新用户' }); await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await act(async () => wait.resolve({ registered: true, contactRef: 'wrong-ref', displayName: '过期用户' }))
  expect(document.body.textContent).not.toContain('过期用户')
  await click('新用户'); call.mockResolvedValue({ state: 'backend_pending' }); await click('发起会话')
  expect(call.mock.calls.at(-1)![1].recipient).toEqual({ kind: 'contact-lookup', contactRef: 'lookup-ref' })
})

it('dismisses on Escape and outside click, and suppresses late responses across account changes', async () => {
  await act(async () => root.render(<TeamOutboundMount accountKey="prod:90" active />))
  await act(async () => openTeamOutbound({ ...intent, accountKey: 'prod:91' })); expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => openTeamOutbound(intent))
  await act(async () => document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => openTeamOutbound(intent))
  await act(async () => document.querySelector('[data-team-outbound-backdrop]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => openTeamOutbound(intent))
  const wait = deferred(); call.mockImplementationOnce(() => wait.promise); await click('发起会话')
  const signal = call.mock.calls.at(-1)![2]
  await act(async () => root.render(<TeamOutboundMount accountKey="prod:91" active />))
  expect(signal.aborted).toBe(true); expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => wait.resolve({ state: 'ready', conversation: { ref: 'late', side: 'team', channel: { jotmoId: 'team_a' } } }))
  expect(navigate).not.toHaveBeenCalled()
})

it('adds a separate team action to the shared avatar card without triggering personal chat', async () => {
  const personal = vi.fn(), team = vi.fn()
  await act(async () => root.render(<ArkmeMemberProfileCard member={{ displayName: '群友' }} busy={false} onClose={close} onSend={personal} onContactAsTeam={team} />))
  await click('以团队联系'); expect(team).toHaveBeenCalledOnce(); expect(personal).not.toHaveBeenCalled()
  await act(async () => root.render(<ArkmeMemberProfileCard member={{ displayName: '本人' }} hideSend busy={false} onClose={close} onSend={personal} onContactAsTeam={team} />))
  expect(document.body.textContent).not.toContain('以团队联系')
})


it('opens only on explicit intent even when an old browser attempt exists', async () => {
  localStorage.setItem(`arkme.team.outbound:${intent.accountKey}`, JSON.stringify({ ...intent, teamJotmoId: 'team_a', requestUid: 'old-attempt' }))
  await act(async () => root.render(<TeamOutboundMount accountKey={intent.accountKey} active />))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(call).not.toHaveBeenCalled()
  await act(async () => root.render(<TeamOutboundMount accountKey={intent.accountKey} active={false} />))
  await act(async () => root.render(<TeamOutboundMount accountKey={intent.accountKey} active />))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  const selected = { ...intent, person: { displayName: '当前选择客户', recipient: { kind: 'contact-lookup' as const, contactRef: 'current-selection' } } }
  await act(async () => openTeamOutbound(selected))
  expect(document.body.textContent).toContain('当前选择客户')
  expect(document.body.textContent).not.toContain('客户备注')
  expect(call.mock.calls.map(v => v[0])).toEqual(['team.app.teams'])
})

it('opens through the Host when browser attempt storage is unavailable', async () => {
  const conversation = { ref: 'real-ref', key: 'real-key', side: 'team', channel: { jotmoId: 'team_a' } }
  await render()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
  call.mockResolvedValueOnce({ state: 'ready', conversation })
  await click('发起会话')
  expect(call.mock.calls.filter(v => v[0] === 'team.app.outbound.open')).toHaveLength(1)
  expect(navigate).toHaveBeenCalledExactlyOnceWith({ kind: 'conversation', conversation })
})

it('dismisses an uncertain opening until the user enters again and retries the selected target', async () => {
  await act(async () => root.render(<TeamOutboundMount accountKey={intent.accountKey} active />))
  await act(async () => openTeamOutbound(intent))
  const wait = deferred(), conversation = { ref: 'same-cloud-conversation', key: 'same-cloud-key', side: 'team', channel: { jotmoId: 'team_a' } }
  call.mockImplementationOnce(() => wait.promise)
  await click('发起会话')
  const first = call.mock.calls.at(-1)!
  await click('关闭')
  expect(first[2].aborted).toBe(true)
  await act(async () => root.render(<TeamOutboundMount key="reloaded" accountKey={intent.accountKey} active />))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => wait.resolve({ state: 'ready', conversation }))
  expect(navigate).not.toHaveBeenCalled()
  expect(call.mock.calls.filter(v => v[0] === 'team.app.outbound.open')).toHaveLength(1)
  await act(async () => openTeamOutbound(intent))
  call.mockResolvedValueOnce({ state: 'ready', conversation })
  await click('发起会话')
  const opens = call.mock.calls.filter(v => v[0] === 'team.app.outbound.open')
  expect(opens).toHaveLength(2)
  expect(opens[1]![1].recipient).toEqual(first[1].recipient)
  expect(opens[1]![1].requestUid).not.toBe(first[1].requestUid)
  expect(navigate).toHaveBeenCalledExactlyOnceWith({ kind: 'conversation', conversation })
})


it('hides team contact for zero memberships and opens directly with the sole named team', async () => {
  call.mockResolvedValueOnce([]); await renderCard()
  expect(document.querySelector('[data-team-contact-selected]')).toBeNull()
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
  await act(async () => root.render(null)); teamContactTeams.reset()
  const conversation = { ref: 'real', side: 'team', channel: { jotmoId: 'team_a' } }
  call.mockImplementation(async op => op === 'team.app.teams' ? [teams[0]] : { state: 'ready', conversation })
  await renderCard(); expect(document.querySelector('select')).toBeNull()
  await click('以 即我 联系')
  expect(call.mock.calls.filter(([op]) => op === 'team.app.outbound.open').at(-1)![1]).toMatchObject({ expectedAccountKey: intent.accountKey, teamRef: 'sealed-team-a', recipient: intent.person!.recipient })
  expect(navigate).toHaveBeenCalledWith({ kind: 'conversation', conversation })
  expect(localStorage.getItem(`arkme.team-contact.preferred.v1:${intent.accountKey}`)).toBe('team_a')
})

it('switches multiple teams in the card, remembering only a successful choice within the account', async () => {
  call.mockImplementation(async (op, p) => op === 'team.app.teams' ? teams : { state: 'ready', conversation: { ref: 'real', side: 'team', channel: { jotmoId: p.teamRef === 'sealed-team-a' ? 'team_a' : 'team_b' } } })
  await renderCard(); expect(button('以 即我 联系')).toBeDefined()
  await selectTeam('team_b')
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
  expect(call.mock.calls.filter(v => v[0].endsWith('.open'))).toHaveLength(0)
  expect(localStorage.getItem(`arkme.team-contact.preferred.v1:${intent.accountKey}`)).toBeNull()
  await click('以 其他团队 联系')
  await act(async () => root.render(null)); await renderCard()
  expect(button('以 其他团队 联系')).toBeDefined()
  await act(async () => root.render(null)); await renderCard('prod:91')
  expect(button('以 即我 联系')).toBeDefined()
  await act(async () => root.render(null)); localStorage.setItem(`arkme.team-contact.preferred.v1:prod:91`, 'removed')
  await renderCard('prod:91'); expect(button('以 即我 联系')).toBeDefined()
})

it('distinguishes failed team reads from zero memberships and retries without leaving the card', async () => {
  call.mockRejectedValueOnce(new Error('offline')); await renderCard()
  expect(document.body.textContent).toContain('暂时无法读取团队')
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
  call.mockResolvedValueOnce([teams[0]]); await click('重试读取团队')
  expect(button('以 即我 联系')).toBeDefined()
  call.mockRejectedValueOnce(new Error('你已不在该团队中')); await click('以 即我 联系')
  expect(document.body.textContent).toContain('你已不在该团队中')
  expect(close).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled()
  const first = call.mock.calls.at(-1)![1].requestUid
  await click('以 即我 联系')
  expect(call.mock.calls.at(-1)![1].requestUid).toBe(first)
})

it('cancels direct contact and ignores a late opening after the card account changes', async () => {
  await renderCard(); const wait = deferred(); call.mockImplementationOnce(() => wait.promise)
  await click('以 即我 联系'); const signal = call.mock.calls.at(-1)![2]
  await renderCard('prod:91'); expect(signal.aborted).toBe(true)
  await act(async () => wait.resolve({ state: 'ready', conversation: { ref: 'late', side: 'team', channel: { jotmoId: 'team_a' } } }))
  expect(navigate).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
})

it('expands real group members and retains group-issued recipient references', async () => {
  const group = { sourceRef: 'group-ref', sourceKey: 'group-key', kind: 'group_chat', displayName: '研发群' }
  const member = { memberRef: 'member-ref', displayName: '群友乙', isSelf: false, status: 'active', role: 'member', isOwner: false, joinedAtMillis: 1, recordCount: 0, mentionCount: 0 }
  call.mockImplementation(async op => op === 'team.app.teams' ? [teams[0]] : op === 'sources.list' ? { items: [group], hasMore: false,
    projection: { revision: 1, phase: 'complete', cachedAtMillis: 1, bots: [], visibility: [{ entryKind: 'source', entryRef: group.sourceRef, hidden: false }] } }
    : op === 'source.members.cached' ? null : op === 'source.members.page' ? { kind: 'membership', selfRole: 'member', source: group, items: [member, { ...member, memberRef: 'self', isSelf: true }], removedMemberRefs: [], hasMore: false }
    : op === 'source.members.presentation' ? { kind: 'presentation', source: group, removedMemberRefs: [], unavailableProfileMemberRefs: [], items: [member] }
    : op === 'directory.list' ? { items: [], hasMore: false } : { state: 'backend_pending' })
  await render({ accountKey: 'prod:90', teamJotmoId: 'team_a' })
  await click('#研发群'); await click('群友乙'); await click('发起会话')
  expect(call.mock.calls.at(-1)![1].recipient).toEqual({ kind: 'chat-member', sourceRef: 'group-ref', memberRef: 'member-ref' })
  expect(document.querySelector('select')).toBeNull()
})


it('keeps malformed directory responses inside the picker as retryable errors', async () => {
  call.mockImplementation(async op => op === 'team.app.teams' ? [teams[0]] : {})
  await render({ accountKey: intent.accountKey, teamJotmoId: 'team_a' })
  expect(document.querySelectorAll('[role="alert"]')).toHaveLength(2)
  expect(document.body.textContent).toContain('目录返回异常，请重试')
  expect(button('发起会话').disabled).toBe(true)
  expect(button('重试加载联系人')).toBeDefined(); expect(button('重试加载群聊')).toBeDefined()
})

it('shows a syncing Host group snapshot without a cursor while contacts are still loading', async () => {
  const contacts = deferred()
  call.mockImplementation(async op => op === 'team.app.teams' ? [teams[0]] : op === 'sources.list' ? groupProjection(['新用户群101']) : contacts.promise)
  await render({ accountKey: intent.accountKey, teamJotmoId: 'team_a' })
  expect(button('#新用户群101')).toBeDefined()
  expect(document.body.textContent).toContain('正在同步群聊…')
  expect(document.body.textContent).toContain('正在加载联系人…')
  expect(document.body.textContent).not.toContain('会话分页异常')
  expect(document.querySelector('[role="alert"]')).toBeNull()
  await act(async () => contacts.resolve({ items: [], hasMore: false }))
})

it('does not read or display the picker without a matching authenticated account', async () => {
  await act(async () => {
    arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'prod' } as never)
    root.render(<TeamOutboundDialog intent={{ accountKey: '' }} onClose={close} />)
  })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(call).not.toHaveBeenCalled()
})

it('uses the already loaded second-column groups immediately and follows later Host updates', async () => {
  arkmeChatDirectory.applyHostPage(groupProjection(['已有群']))
  const wait = deferred()
  call.mockImplementation(async op => op === 'team.app.teams' ? [teams[0]] : op === 'sources.list' ? wait.promise : { items: [], hasMore: false })
  await render({ accountKey: intent.accountKey })
  expect(button('#已有群')).toBeDefined()
  await act(async () => arkmeChatDirectory.applyHostPage(groupProjection(['新增群', '已有群'], 'complete', 2)))
  expect([...document.querySelectorAll('button[aria-expanded]')].map(node => node.textContent)).toEqual(['#新增群', '#已有群'])
  expect(document.body.textContent).not.toContain('正在同步群聊')
  await act(async () => wait.resolve(groupProjection(['已有群'], 'syncing', 1)))
  expect(button('#新增群')).toBeDefined()
})

it('retains loaded contact pages across closing and reopening without repeating fresh reads', async () => {
  call.mockImplementation(async (op, p) => op === 'team.app.teams' ? [teams[0]] : op === 'sources.list' ? groupProjection(['研发群'], 'complete') : {
    items: [{ kind: 'contact', contactRef: p.cursor ? 'b' : 'a', displayName: p.cursor ? '乙' : '甲' }], hasMore: !p.cursor, ...(!p.cursor ? { nextCursor: 'next' } : {}),
  })
  const picker = { accountKey: intent.accountKey, teamJotmoId: 'team_a' }
  await render(picker); await click('加载更多联系人')
  await act(async () => root.render(null))
  const counts = call.mock.calls.length
  await render(picker)
  expect(button('甲')).toBeDefined(); expect(button('乙')).toBeDefined(); expect(button('#研发群')).toBeDefined()
  expect(document.body.textContent).not.toContain('正在加载')
  expect(call.mock.calls).toHaveLength(counts)
})

it('keeps cached contacts selectable during a refresh and after its failure', async () => {
  call.mockImplementation(async op => op === 'team.app.teams' ? [teams[0]] : op === 'sources.list' ? groupProjection([], 'complete') : { items: [{ kind: 'contact', contactRef: 'a', displayName: '已有联系人' }], hasMore: false })
  await render({ accountKey: intent.accountKey })
  const wait = deferred(); call.mockImplementationOnce(() => wait.promise)
  let refresh!: Promise<unknown>
  await act(async () => { refresh = teamOutboundContacts.refresh(intent.accountKey, intent.accountKey).catch(() => {}) })
  expect(document.body.textContent).toContain('正在更新联系人…')
  await click('已有联系人'); expect(button('发起会话').disabled).toBe(false)
  await act(async () => wait.resolve(Promise.reject(new Error('目录暂时离线')))); await act(async () => { await refresh })
  expect(button('已有联系人')).toBeDefined(); expect(button('发起会话').disabled).toBe(false)
  expect(document.body.textContent).toContain('目录暂时离线')
})

it('reloads cleared Provider references and clears the old selected recipient', async () => {
  call.mockImplementation(async op => op === 'team.app.teams' ? [teams[0]] : op === 'sources.list' ? groupProjection([], 'complete') : { items: [{ kind: 'contact', contactRef: 'old', displayName: '旧引用' }], hasMore: false })
  await render({ accountKey: intent.accountKey }); await click('旧引用')
  const wait = deferred(); call.mockImplementationOnce(() => wait.promise)
  await act(async () => teamOutboundContacts.reset())
  expect(button('发起会话').disabled).toBe(true)
  expect(document.body.textContent).toContain('未选择对象')
  await act(async () => wait.resolve({ items: [{ kind: 'contact', contactRef: 'new', displayName: '新引用' }], hasMore: false }))
  expect(button('新引用')).toBeDefined()
  expect(document.body.textContent).not.toContain('旧引用')
})

it('keeps available groups on a failed projection and retries through the shared directory owner', async () => {
  let attempts = 0
  call.mockImplementation(async op => op === 'team.app.teams' ? [teams[0]] : op === 'sources.list'
    ? ++attempts === 1 ? groupProjection(['已有群'], 'failed', 1, '群目录暂时离线') : groupProjection(['已有群', '补齐群'], 'complete', 2)
    : { items: [], hasMore: false })
  await render({ accountKey: intent.accountKey })
  expect(button('#已有群')).toBeDefined(); expect(document.body.textContent).toContain('群目录暂时离线')
  await click('重试加载群聊')
  expect(button('#补齐群')).toBeDefined(); expect(document.querySelector('[role="alert"]')).toBeNull()
  expect(call.mock.calls.filter(([op]) => op === 'sources.list').at(-1)![1]).toMatchObject({ localFirst: true, refresh: true })
})

it('locks multi-team selection during opening and reuses retries only for the same chosen team', async () => {
  const wait = deferred(); let opens = 0
  call.mockImplementation(async op => op === 'team.app.teams' ? teams : ++opens === 1 ? wait.promise : { state: 'backend_pending' })
  await renderCard(); await selectTeam('team_b'); await click('以 其他团队 联系')
  expect(document.querySelector<HTMLSelectElement>('select')!.disabled).toBe(true)
  expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
  await act(async () => wait.resolve({ state: 'backend_pending' }))
  expect(document.querySelector<HTMLSelectElement>('select')!.value).toBe('team_b')
  expect(document.querySelector<HTMLSelectElement>('select')!.disabled).toBe(false)
  expect(localStorage.getItem(`arkme.team-contact.preferred.v1:${intent.accountKey}`)).toBeNull()
  await click('以 其他团队 联系')
  await selectTeam('team_a'); await click('以 即我 联系')
  const requests = call.mock.calls.filter(([op]) => op === 'team.app.outbound.open')
  expect(requests).toHaveLength(3)
  expect(requests[0]![1].requestUid).toBe(requests[1]![1].requestUid)
  expect(requests[2]![1].requestUid).not.toBe(requests[1]![1].requestUid)
  expect(requests.map(([, p]) => p.teamRef)).toEqual(['sealed-team-b', 'sealed-team-b', 'sealed-team-a'])
  expect(navigate).not.toHaveBeenCalled()
})

it('rejects another team in a direct-contact result without changing the remembered preference', async () => {
  localStorage.setItem(`arkme.team-contact.preferred.v1:${intent.accountKey}`, 'team_a')
  call.mockImplementation(async op => op === 'team.app.teams' ? teams : { state: 'ready', conversation: { ref: 'wrong-team', side: 'team', channel: { jotmoId: 'team_a' } } })
  await renderCard(); await selectTeam('team_b'); await click('以 其他团队 联系')
  expect(document.body.textContent).toContain('团队会话返回异常')
  expect(document.querySelector('select')!.value).toBe('team_b')
  expect(localStorage.getItem(`arkme.team-contact.preferred.v1:${intent.accountKey}`)).toBe('team_a')
  expect(navigate).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
})

it('does not let preference storage failures block a verified multi-team opening', async () => {
  const get = Storage.prototype.getItem, set = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (key) { if (key.startsWith('arkme.team-contact.preferred.')) throw new Error('storage unavailable'); return get.call(this, key) })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) { if (key.startsWith('arkme.team-contact.preferred.')) throw new Error('storage unavailable'); return set.call(this, key, value) })
  const conversation = { ref: 'verified-b', side: 'team', channel: { jotmoId: 'team_b' } }
  call.mockImplementation(async op => op === 'team.app.teams' ? teams : { state: 'ready', conversation })
  await renderCard(); await selectTeam('team_b'); await click('以 其他团队 联系')
  expect(navigate).toHaveBeenCalledExactlyOnceWith({ kind: 'conversation', conversation })
})

it('does not remember or navigate a late multi-team result after the card is unmounted', async () => {
  const wait = deferred()
  call.mockImplementation(async op => op === 'team.app.teams' ? teams : wait.promise)
  await renderCard(); await selectTeam('team_b'); await click('以 其他团队 联系')
  const signal = call.mock.calls.find(([op]) => op === 'team.app.outbound.open')![2]
  await act(async () => root.render(null)); expect(signal.aborted).toBe(true)
  await act(async () => wait.resolve({ state: 'ready', conversation: { ref: 'late', side: 'team', channel: { jotmoId: 'team_b' } } }))
  expect(localStorage.getItem(`arkme.team-contact.preferred.v1:${intent.accountKey}`)).toBeNull()
  expect(navigate).not.toHaveBeenCalled()
})

it('ignores the previous account team list when it completes after another account is shown', async () => {
  const wait = deferred()
  call.mockImplementation(async (op, p) => op === 'team.app.teams' ? p.expectedAccountKey === 'prod:90' ? wait.promise : [teams[1]] : { state: 'backend_pending' })
  await renderCard()
  await renderCard('prod:91')
  // The shared store may retain the old account read for other consumers. Its value must stay scoped to that account.
  await act(async () => wait.resolve([teams[0]]))
  expect(button('以 其他团队 联系')).toBeDefined()
  expect(document.querySelector('select')).toBeNull()
  expect(document.body.textContent).not.toContain('以 即我 联系')
  expect(call.mock.calls.filter(([op]) => op === 'team.app.outbound.open')).toHaveLength(0)
})

it('uses team IDs rather than equal display names to route the selected identity', async () => {
  const sameNames = teams.map(t => ({ ...t, name: '同名团队' }))
  const conversation = { ref: 'verified-b', side: 'team', channel: { jotmoId: 'team_b' } }
  call.mockImplementation(async op => op === 'team.app.teams' ? sameNames : { state: 'ready', conversation })
  await renderCard(); await selectTeam('team_b'); await click('以 同名团队 联系')
  expect(call.mock.calls.filter(([op]) => op === 'team.app.outbound.open').at(-1)![1].teamRef).toBe('sealed-team-b')
  expect(navigate).toHaveBeenCalledExactlyOnceWith({ kind: 'conversation', conversation })
})


it('falls back to an available team after membership refresh without opening a conversation', async () => {
  let available = teams
  localStorage.setItem(`arkme.team-contact.preferred.v1:${intent.accountKey}`, 'team_b')
  call.mockImplementation(async op => op === 'team.app.teams' ? available : { state: 'backend_pending' })
  await renderCard(); expect(button('以 其他团队 联系')).toBeDefined()
  available = [teams[0]!]
  await act(async () => { await teamContactTeams.refresh(intent.accountKey, intent.accountKey) })
  expect(document.querySelector('select')).toBeNull()
  expect(button('以 即我 联系')).toBeDefined()
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
  expect(call.mock.calls.filter(([op]) => op === 'team.app.outbound.open')).toHaveLength(0)
})
