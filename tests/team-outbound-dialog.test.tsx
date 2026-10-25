// @vitest-environment jsdom
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TeamOutboundDialog, TeamOutboundMount } from '../src/client/TeamOutboundDialog.js'
import { openTeamOutbound, type TeamOutboundIntent } from '../src/client/team-outbound.js'
import { ArkmeMemberProfileCard } from '../src/client/ArkmeChatMemberActions.js'
import { TEAM_OUTBOUND_PENDING_TEXT } from '../src/team-outbound-contract.js'

const { call, navigate, invalidate } = vi.hoisted(() => ({ call: vi.fn(), navigate: vi.fn(), invalidate: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
vi.mock('../src/client/team-messaging-events.js', () => ({ openTeamMessages: navigate, invalidateTeamMessages: invalidate }))
const teams = [
  { teamRef: 'sealed-team-a', jotmoId: 'team_a', name: '即我', currentUserRole: 'member', createdAtMillis: 1, updatedAtMillis: 1 },
  { teamRef: 'sealed-team-b', jotmoId: 'team_b', name: '其他团队', currentUserRole: 'owner', createdAtMillis: 1, updatedAtMillis: 1 },
]
const intent: TeamOutboundIntent = { accountKey: 'prod:90', person: { displayName: '客户备注', recipient: { kind: 'chat-member', sourceRef: 'sealed-source', memberRef: 'sealed-member' } } }
const close = vi.fn()
let host: HTMLDivElement, root: Root
function button(text: string) { const found = [...document.querySelectorAll('button')].find(n => n.textContent === text); if (!found) throw new Error(`Missing button: ${text}`); return found }
const click = async (label: string) => act(async () => button(label).click())
const render = async (value = intent) => act(async () => root.render(<TeamOutboundDialog intent={value} onClose={close} />))
const selectTeam = async (id: string) => act(async () => { const node = document.querySelector('select')!; node.value = id; node.dispatchEvent(new Event('change', { bubbles: true })) })
async function query(value: string) {
  await act(async () => {
    const input = document.querySelector('input')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); call.mockReset()
  call.mockImplementation(async op => op === 'team.app.teams' ? [teams[0]] : op === 'directory.list' ? { items: [], hasMore: false } : { state: 'backend_pending' })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('keeps the selected person and real team, with an explicit pending result and no personal chat or message write', async () => {
  await render(); expect(document.body.textContent).toContain('以 即我 身份发给 客户备注')
  expect(call.mock.calls.map(v => v[0])).toEqual(['team.app.teams'])
  await click('开始团队私信')
  expect(call.mock.calls.at(-1)).toEqual(['team.app.outbound.open', {
    expectedAccountKey: 'prod:90', teamRef: 'sealed-team-a', recipient: intent.person!.recipient, requestUid: expect.any(String),
  }, expect.any(AbortSignal)])
  expect(document.body.textContent).toContain(TEAM_OUTBOUND_PENDING_TEXT)
  expect(document.body.textContent).toContain('客户备注')
  expect(button('开始团队私信').disabled).toBe(true)
  expect(navigate).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
  expect(call.mock.calls.map(v => v[0])).toEqual(['team.app.teams', 'team.app.outbound.open'])
})

it('requires explicit team choice for multiple memberships; a directory entry prefills only its own team', async () => {
  call.mockResolvedValue(teams)
  await render(); expect(button('开始团队私信').disabled).toBe(true)
  await selectTeam('team_b'); expect(button('开始团队私信').disabled).toBe(false)
  await act(async () => root.render(<TeamOutboundDialog key="prefill" intent={{ ...intent, teamJotmoId: 'team_a' }} onClose={close} />))
  expect(document.querySelector('select')?.value).toBe('team_a')
})

it('does not silently fall back to another team after membership loss or loading failure', async () => {
  call.mockResolvedValue([teams[1]])
  await render({ ...intent, teamJotmoId: 'team_a' })
  expect(document.querySelector('select')?.value).toBe('')
  expect(button('开始团队私信').disabled).toBe(true)
  expect(document.body.textContent).toContain('你已不在该团队中')
  call.mockRejectedValueOnce(new Error('网络断开')); await click('重试')
  expect(button('开始团队私信').disabled).toBe(true)
  call.mockResolvedValue([teams[0]]); await click('重试')
  expect(button('开始团队私信').disabled).toBe(false)
})

it('opens only the verified existing team conversation, and reuses the same idempotency key after an uncertain result', async () => {
  const wait = deferred(); const conversation = { ref: 'real-ref', key: 'real-key', side: 'team', channel: { jotmoId: 'team_a' } }
  let attempts = 0
  call.mockImplementation(async op => op === 'team.app.teams' ? [teams[0]] : ++attempts === 1 ? wait.promise : { state: 'ready', conversation })
  await render(); await act(async () => { button('开始团队私信').click(); button('开始团队私信').click() })
  expect(call.mock.calls.filter(v => v[0] === 'team.app.outbound.open')).toHaveLength(1)
  // Malformed/ambiguous responses must not manufacture a conversation.
  await act(async () => wait.resolve({ state: 'ready', conversation: { ...conversation, side: 'external' } }))
  expect(navigate).not.toHaveBeenCalled(); expect(document.body.textContent).toContain('团队会话返回异常')
  await click('开始团队私信')
  const opens = call.mock.calls.filter(v => v[0] === 'team.app.outbound.open')
  expect(opens[0]![1].requestUid).toBe(opens[1]![1].requestUid)
  expect(navigate).toHaveBeenCalledExactlyOnceWith({ kind: 'conversation', conversation })
  expect(invalidate).toHaveBeenCalledExactlyOnceWith('prod:90'); expect(close).toHaveBeenCalledOnce()
})

it('loads real contacts progressively and passes directory references without opening a private conversation', async () => {
  call.mockImplementation(async (op, p) => op === 'team.app.teams' ? [teams[0]] : op === 'directory.list' ? {
    items: [{ kind: 'contact', contactRef: p.cursor ? 'second-ref' : 'first-ref', displayName: p.cursor ? '乙' : '甲', remark: p.cursor ? '客户乙' : '客户甲' }],
    hasMore: !p.cursor, ...(p.cursor ? {} : { nextCursor: 'next' }),
  } : { state: 'backend_pending' })
  await act(async () => root.render(<StrictMode><TeamOutboundDialog intent={{ accountKey: 'prod:90', teamJotmoId: 'team_a' }} onClose={close} /></StrictMode>))
  expect(document.body.textContent).toContain('客户甲')
  await click('加载更多联系人'); await click('客户乙'); await click('开始团队私信')
  expect(call.mock.calls.at(-1)![1].recipient).toEqual({ kind: 'directory-contact', contactRef: 'second-ref' })
})

it.each([
  [{ registered: true, isSelf: true, contactRef: 'self' }, '请选择其他用户'],
  [{ registered: true, team: {} }, '请选择个人用户'],
  [{ registered: false }, '未找到已注册用户'],
])('rejects unsupported recipient lookup %j', async (result, message) => {
  await render({ accountKey: 'prod:90' }); await query('target')
  call.mockResolvedValue(result); await click('精确查找')
  expect(document.body.textContent).toContain(message); expect(button('开始团队私信').disabled).toBe(true)
})

it('accepts a registered non-contact lookup and ignores an older lookup after query changes', async () => {
  await render({ accountKey: 'prod:90' }); await query('old')
  const wait = deferred(); call.mockImplementationOnce(() => wait.promise)
  await click('精确查找'); const oldSignal = call.mock.calls.at(-1)![2]
  await query('new'); expect(oldSignal.aborted).toBe(true)
  call.mockResolvedValueOnce({ registered: true, isSelf: false, contactRef: 'lookup-ref', displayName: '新用户' }); await click('精确查找')
  await act(async () => wait.resolve({ registered: true, contactRef: 'wrong-ref', displayName: '过期用户' }))
  expect(document.body.textContent).not.toContain('过期用户')
  call.mockResolvedValue({ state: 'backend_pending' }); await click('开始团队私信')
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
  const wait = deferred(); call.mockImplementationOnce(() => wait.promise); await click('开始团队私信')
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
