// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ArkmeGroupBotItem } from '../src/tools/ports/bots.js'
import { arkmeGroupBotsChanged, arkmeInstalledGroupBots, useGroupBots } from '../src/client/use-group-bots.js'
import { GroupBotRow, GroupMemberRow, GroupMembersDrawer } from '../src/client/ArkmeGroupChatControls.js'
import { callArkme } from '../src/client/api.js'
import type { ArkmeConversationMemberItem } from '../src/types.js'

vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
vi.mock('../src/client/use-conversation-members.js', () => ({ useConversationMembers: () => ({
  ready: true, refreshing: false, items: [{ memberRef: 'person', displayName: '真人', role: 'owner',
    isSelf: true, isOwner: true, recordCount: 9, mentionCount: 2 }],
}) }))
const bot = (id: string, provider: 'webhook' | 'openclaw' = 'webhook', installed = true): ArkmeGroupBotItem => ({
  botRef: `ref-${id}`, directoryKey: `key-${id}`, name: id, provider, installed, description: '', status: 'online',
})
const person: ArkmeConversationMemberItem = { memberRef: 'person', displayName: '真人', role: 'owner',
  isSelf: true, isOwner: true, status: 'active', joinedAtMillis: 1, recordCount: 9, mentionCount: 2 }
let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.mocked(callArkme).mockResolvedValue({ items: [bot('通知'), bot('助手', 'openclaw'), bot('未加入', 'openclaw', false)] })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.resetAllMocks(); vi.unstubAllGlobals() })
function Probe({ account = 'account', group = 'group', active = true }: { account?: string; group?: string; active?: boolean }) {
  const state = useGroupBots(account, group, active)
  return <div data-ready={state.ready} data-loading={state.loading}>
    {state.items.map(item => <span key={item.botRef}>{item.name}</span>)}
    <button onClick={state.refresh}>刷新</button><i>{state.error}</i>
  </div>
}
const names = () => [...host.querySelectorAll('span')].map(item => item.textContent)

it('includes both providers, excludes uninstalled Bots and deduplicates only by stable identity', () => {
  expect(arkmeInstalledGroupBots([bot('same'), { ...bot('same'), botRef: 'new-ref' },
    { ...bot('different', 'openclaw'), name: 'same' }, bot('gone', 'webhook', false)]).map(item => item.botRef))
    .toEqual(['ref-same', 'ref-different'])
})

it('reads group membership only while the drawer is active, never a personal Bot list', async () => {
  await act(async () => root.render(<Probe active={false} />))
  expect(callArkme).not.toHaveBeenCalled()
  await act(async () => root.render(<Probe />))
  expect(names()).toEqual(['通知', '助手'])
  expect(callArkme).toHaveBeenCalledWith('group.bots', { sourceRef: 'group' }, expect.any(AbortSignal))
  expect(callArkme).toHaveBeenCalledTimes(1)
})

it('does not display old-account/group data or accept a late response after switching', async () => {
  let finishOld!: (value: unknown) => void
  vi.mocked(callArkme).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
  await act(async () => root.render(<Probe group="old" />))
  vi.mocked(callArkme).mockResolvedValue({ items: [bot('新群 Bot')] })
  await act(async () => root.render(<Probe account="new-account" group="new" />))
  await act(async () => finishOld({ items: [bot('旧账号 Bot')] }))
  expect(names()).toEqual(['新群 Bot'])
})

it('removes a confirmed Bot immediately, rejects unrelated invalidations and refreshes authoritative membership', async () => {
  await act(async () => root.render(<Probe />))
  act(() => arkmeGroupBotsChanged('different-account', 'group', 'ref-通知'))
  act(() => arkmeGroupBotsChanged('account', 'different-group', 'ref-通知'))
  expect(callArkme).toHaveBeenCalledTimes(1)
  let complete!: (value: unknown) => void
  vi.mocked(callArkme).mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  await act(async () => arkmeGroupBotsChanged('account', 'group', 'ref-通知'))
  expect(names()).toEqual(['助手'])
  expect(host.querySelector('[data-loading]')?.getAttribute('data-loading')).toBe('true')
  await act(async () => complete({ items: [bot('通知', 'webhook', false), bot('助手', 'openclaw'), bot('新 Bot')] }))
  expect(names()).toEqual(['助手', '新 Bot'])
})

it('keeps known rows after a failed refresh and supports retry without declaring an empty roster', async () => {
  await act(async () => root.render(<Probe />))
  vi.mocked(callArkme).mockRejectedValueOnce(new Error('offline'))
  await act(async () => host.querySelector('button')!.click())
  expect(names()).toEqual(['通知', '助手'])
  expect(host.querySelector('i')?.textContent).toBe('offline')
  await act(async () => host.querySelector('button')!.click())
  expect(host.querySelector('i')?.textContent).toBe('')
})

function pointer(target: Element, type: string) {
  const event = new MouseEvent('pointerover', { bubbles: true, buttons: 0 })
  Object.defineProperty(event, 'pointerType', { value: type }); target.dispatchEvent(event)
}

it('uses member row geometry and supports hover, click, keyboard and context menu', async () => {
  const open = vi.fn(), hover = vi.fn(), context = vi.fn()
  await act(async () => root.render(<>
    <GroupMemberRow member={person} onMemberOpen={() => {}} onMemberContextMenu={() => {}} />
    <GroupBotRow bot={bot('通知')} onBotOpen={open} onBotHover={hover} onBotContextMenu={context} />
  </>))
  const row = host.querySelector<HTMLButtonElement>('[data-arkme-group-bot-row]')!
  expect(row.getAttribute('style')).toBe(host.querySelector('[data-arkme-group-member-row]')?.getAttribute('style'))
  expect(row.textContent).toBe('通知BOT')
  act(() => pointer(row, 'touch')); expect(hover).not.toHaveBeenCalled()
  act(() => pointer(row, 'mouse')); expect(hover).toHaveBeenCalledWith(expect.objectContaining({ directoryKey: 'key-通知' }), row, 'left')
  act(() => row.click()); expect(open).toHaveBeenCalledOnce()
  act(() => row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  act(() => row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
  expect(context).toHaveBeenCalledTimes(2)
})

it('appends all installed Bots to the human list and distinguishes people and Bot totals', async () => {
  await act(async () => root.render(<GroupMembersDrawer accountScope="account" open
    source={{ kind: 'group_chat', sourceRef: 'group', displayName: '群', activeAtMillis: 1, unreadCount: 0 }}
    onClose={() => {}} onAdd={() => {}} onMemberOpen={() => {}} onMemberContextMenu={() => {}} onError={() => {}} />))
  expect(host.querySelector('h3')?.textContent).toBe('群成员（1人 · 2 Bot）')
  expect(host.querySelectorAll('[data-arkme-group-member-row], [data-arkme-group-bot-row]')).toHaveLength(3)
  expect(host.textContent).not.toContain('未加入')
  expect(host.textContent).not.toContain('0条快记')
})
