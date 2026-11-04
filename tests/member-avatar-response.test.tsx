// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { MessageAvatar } from '../src/client/MessageAvatar.js'
import { ArkmeMemberProfileCard } from '../src/client/ArkmeMemberProfileCard.js'
import { ArkmeMemberActionMenu } from '../src/client/ArkmeChatMemberActions.js'
import { messageMemberTarget, useMemberInteraction } from '../src/client/member-interaction.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import type { ArkmeConversationMemberItem } from '../src/types.js'
const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<object>(), callArkme: call }))
const source = { sourceRef: 'group', sourceKey: 'group-key', kind: 'group_chat' as const, displayName: '新用户群101' }
const item = { itemUid: 'message', memberRef: 'signed-member', senderName: '后面分页的群友', avatarRef: '', isMe: false, sendAtMillis: 1, title: '', textContent: '你好', status: 1 }
const member: ArkmeConversationMemberItem = { memberRef: 'signed-member', displayName: '补齐后的昵称', status: 'active', role: 'member', isSelf: false, isOwner: false, joinedAtMillis: 1, recordCount: 4, mentionCount: 2, statsKnown: true, mentionRef: 'signed-mention', mentionDisplayName: '群昵称' }
let root: Root, host: HTMLDivElement
function deferred() { let resolve!: (v: unknown) => void; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const page = (values = [member]) => ({ kind: 'presentation', source, items: values, removedMemberRefs: [], unavailableProfileMemberRefs: [] })
function Surface({ account = 'test:42', targetItem = item }: { account?: string; targetItem?: typeof item }) {
  const [opened, setOpened] = useState<'profile' | 'hover'>()
  const target = messageMemberTarget(targetItem)
  const detail = useMemberInteraction(account, source, opened ? target : undefined)
  return <>
    <MessageAvatar member={target} label={targetItem.senderName} profileEnabled hoverEnabled onOpen={() => setOpened('profile')} onHover={() => setOpened('hover')} onContextMenu={() => setOpened('hover')}/>
    {opened === 'profile' && detail.target && <ArkmeMemberProfileCard member={detail.target} busy={false} closeWhileBusy copyLinkTarget={{ kind: 'member', sourceRef: source.sourceRef, memberRef: detail.target.memberRef }} onClose={() => setOpened(undefined)} onSend={() => {}}/>}
    {opened === 'hover' && detail.target && <ArkmeMemberActionMenu member={detail.target} sourceKind="group_chat" position={{ left: 20, top: 40, placement: 'below' }} loading={detail.loading} error={detail.error} onRetry={detail.retry} onMention={() => {}} onRecords={() => {}} onClose={() => setOpened(undefined)}/>}
    <output data-member-detail>{detail.error || detail.target?.displayName}</output>
  </>
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
  call.mockReset(); call.mockImplementation(async op => op === 'team.app.teams' ? [] : op === 'identity.person.read' ? { userId: 7, isSelf: false } : page())
})
afterEach(async () => { await act(async () => { root.unmount(); arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' }) }); host.remove(); vi.restoreAllMocks() })
const mount = async (element = <Surface/>) => act(async () => root.render(element))
const avatar = () => document.querySelector<HTMLButtonElement>('[data-arkme-message-avatar]')!
it('renders and opens the actual profile immediately while member and profile reads never finish', async () => {
  const wait = deferred(); call.mockImplementation(() => wait.promise)
  await mount(); expect(call).not.toHaveBeenCalled(); expect(avatar().tagName).toBe('BUTTON')
  await act(async () => avatar().click())
  expect(document.querySelector('[data-arkme-person-profile]')?.textContent).toContain(item.senderName)
  expect(document.querySelector<HTMLButtonElement>('[aria-label="关闭"]')?.disabled).toBe(false)
  expect(call.mock.calls.filter(v => v[0] === 'source.members.presentation')[0]![1]).toEqual({ sourceRef: 'group', memberRefs: ['signed-member'] })
  expect(call.mock.calls.some(v => ['source.members', 'source.members.page'].includes(v[0]))).toBe(false)
  const signals = call.mock.calls.map(v => v[2]).filter(Boolean)
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click())
  expect(document.querySelector('[data-arkme-person-profile]')).toBeNull()
  expect(signals.every((signal: AbortSignal) => signal.aborted)).toBe(true)
  await act(async () => wait.resolve(page()))
  expect(document.querySelector('[data-arkme-person-profile]')).toBeNull()
})
it('exposes mouse hover immediately and keeps @ disabled until its real capability arrives', async () => {
  const wait = deferred(); call.mockImplementation(() => wait.promise)
  await mount()
  await act(async () => { const e = new Event('pointerover', { bubbles: true }); Object.assign(e, { pointerType: 'mouse', buttons: 0 }); avatar().dispatchEvent(e) })
  const mention = () => [...document.querySelectorAll<HTMLButtonElement>('[role=menuitem]')].find(node => node.textContent?.includes('@'))!
  expect(document.querySelector('[role=menu]')).not.toBeNull(); expect(mention().disabled).toBe(true)
  expect(mention().textContent).toContain('正在确认')
  await act(async () => wait.resolve(page()))
  expect(mention().textContent).toBe(`@${member.displayName}`); expect(mention().disabled).toBe(false)
})
it('does not borrow role, status or counts from the message to manufacture membership', () => {
  const target = messageMemberTarget(item)!
  expect(target).toMatchObject({ memberRef: 'signed-member', isSelf: false, statsKnown: false })
  for (const field of ['role', 'status', 'isOwner', 'recordCount', 'mentionCount', 'mentionRef']) expect(target).not.toHaveProperty(field)
  expect(messageMemberTarget({ ...item, senderKind: 'bot' })).toBeUndefined()
})
it('shows a retry after member failure without removing the immediately opened surface', async () => {
  call.mockRejectedValueOnce(new Error('成员读取超时')); await mount()
  await act(async () => { const e = new Event('pointerover', { bubbles: true }); Object.assign(e, { pointerType: 'mouse', buttons: 0 }); avatar().dispatchEvent(e) })
  const retry = [...document.querySelectorAll<HTMLButtonElement>('[role=menuitem]')].find(node => node.textContent === '成员资料读取失败，重试')!
  expect(retry).toBeDefined(); call.mockResolvedValueOnce(page()); await act(async () => retry.click())
  expect(document.querySelector('[data-member-detail]')?.textContent).toBe(member.displayName)
})
it('aborts the previous target on account or member change and ignores late data', async () => {
  const wait = deferred(); call.mockImplementationOnce(() => wait.promise)
  await mount(); await act(async () => avatar().click())
  const signal = call.mock.calls.find(v => v[0] === 'source.members.presentation')![2]
  await mount(<Surface account="test:43" targetItem={{ ...item, memberRef: 'different', senderName: '新账号群友' }}/>)
  expect(signal.aborted).toBe(true)
  await act(async () => wait.resolve(page()))
  expect(document.querySelector('[data-member-detail]')?.textContent).not.toBe(member.displayName)
})
it('missing legacy references still open an informational card without guessing a recipient', async () => {
  await mount(<MessageAvatar label="旧消息中的人" profileEnabled hoverEnabled onOpen={() => {}} onContextMenu={() => {}}/>)
  await act(async () => avatar().click())
  expect(document.querySelector('[data-arkme-person-profile]')?.textContent).toContain('旧消息中的人')
  expect(document.querySelector('[role=alert]')?.textContent).toContain('该消息缺少成员身份')
  expect(call).not.toHaveBeenCalled()
})

it('disables @ when a capability is incomplete or the composer cannot accept mentions', async () => {
  const partial = { ...member, mentionDisplayName: undefined }
  await mount(<ArkmeMemberActionMenu member={partial} sourceKind="group_chat" position={{ left: 20, top: 40, placement: 'below' }} onMention={() => { throw new Error('must not run') }} onRecords={() => {}} onClose={() => {}}/>)
  let mention = [...document.querySelectorAll<HTMLButtonElement>('[role=menuitem]')].find(n => n.textContent?.includes('@'))!
  expect(mention.disabled).toBe(true)
  await mount(<ArkmeMemberActionMenu member={member} canMention={false} sourceKind="group_chat" position={{ left: 20, top: 40, placement: 'below' }} onMention={() => { throw new Error('must not run') }} onRecords={() => {}} onClose={() => {}}/>)
  mention = [...document.querySelectorAll<HTMLButtonElement>('[role=menuitem]')].find(n => n.textContent?.includes('@'))!
  expect(mention.disabled).toBe(true)
})

it('opening the world does not await the separate profile decoration request', async () => {
  const wait = deferred(); call.mockImplementation(async op => op === 'identity.person.read' ? wait.promise : op === 'chat.member.world-target' ? { userId: 7 } : [])
  const close = vi.fn()
  await mount(<ArkmeMemberProfileCard member={{ displayName: '群友' }} busy={false} closeWhileBusy copyLinkTarget={{ kind: 'member', sourceRef: 'group', memberRef: 'signed-member' }} onClose={close} onSend={() => {}}/>)
  const world = document.querySelector<HTMLButtonElement>('[aria-label="进入 TA 的世界"]')!
  expect(world.disabled).toBe(false); await act(async () => world.click())
  expect(call).toHaveBeenCalledWith('chat.member.world-target', { sourceRef: 'group', memberRef: 'signed-member' }, expect.any(AbortSignal))
  expect(close).toHaveBeenCalledOnce()
})
it('retains unsupported large world identifiers as an explicit error', async () => {
  call.mockImplementation(async op => op === 'identity.person.read' ? { userId: 7, isSelf: false } : op === 'chat.member.world-target' ? { userId: '9007199254740993' } : [])
  const close = vi.fn()
  await mount(<ArkmeMemberProfileCard member={{ displayName: '群友' }} busy={false} closeWhileBusy copyLinkTarget={{ kind: 'member', sourceRef: 'group', memberRef: 'signed-member' }} onClose={close} onSend={() => {}}/>)
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="进入 TA 的世界"]')!.click())
  expect(document.querySelector('[role=alert]')?.textContent).toContain('当前世界接口暂不支持此用户标识')
  expect(close).not.toHaveBeenCalled()
})

it('uses fresh local public data across groups without waiting for a live read or replacing the B group name', async () => {
  const cached = { userId: 7, isSelf: false, accountName: 'public_jia', publicDisplayName: '公开甲', cachedAtMillis: Date.now() }
  call.mockImplementation(async (op, params) => op === 'identity.person.read' && params.cacheOnly ? cached : op === 'team.app.teams' ? [] : new Promise(() => {}))
  await mount(<ArkmeMemberProfileCard member={{ displayName: 'B群昵称' }} busy={false} closeWhileBusy copyLinkTarget={{ kind: 'member', sourceRef: 'B', memberRef: 'B-ref' }} onClose={() => {}} onSend={() => {}}/>)
  expect(document.querySelector('h3')?.textContent).toBe('B群昵称')
  expect(document.body.textContent).toContain('public_jia')
  expect(call.mock.calls.filter(v => v[0] === 'identity.person.read')).toHaveLength(1)
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(n => n.getAttribute('aria-label') === '更多操作')!.click())
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(n => n.textContent === '刷新名片')!.click())
  expect(call.mock.calls.find(v => v[0] === 'identity.person.read' && v[1].forceRefresh)?.[1]).toMatchObject({ kind: 'member', sourceRef: 'B', forceRefresh: true })
  expect(document.body.textContent).toContain('public_jia')
})

it('shows stale local data while refresh is pending and retains it after a transient failure', async () => {
  const pending = deferred(), cached = { userId: 7, isSelf: false, accountName: 'cached_jia', cachedAtMillis: Date.now() - 120_000 }
  call.mockImplementation(async (op, params) => op === 'identity.person.read' ? params.cacheOnly ? cached : pending.promise : [])
  await mount(<ArkmeMemberProfileCard member={{ displayName: 'B群昵称' }} busy={false} closeWhileBusy copyLinkTarget={{ kind: 'member', sourceRef: 'B', memberRef: 'B-ref' }} onClose={() => {}} onSend={() => {}}/>)
  expect(document.body.textContent).toContain('cached_jia'); expect(document.body.textContent).toContain('更新中')
  expect(document.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.disabled).toBe(false)
  await act(async () => pending.resolve({ ...cached, refreshFailed: true }))
  expect(document.body.textContent).toContain('cached_jia'); expect(document.body.textContent).toContain('更新失败')
})

it.each([{ pointerType: 'touch', buttons: 0 }, { pointerType: 'mouse', buttons: 1 }, { pointerType: 'pen', buttons: 0 }])('does not mistake touch, drag or pen entry for a pure mouse hover: %j', async pointer => {
  await mount()
  await act(async () => { const e = new Event('pointerover', { bubbles: true }); Object.assign(e, pointer); avatar().dispatchEvent(e) })
  expect(document.querySelector('[role=menu]')).toBeNull()
  expect(document.querySelector('[data-arkme-person-profile]')).toBeNull()
  expect(call).not.toHaveBeenCalled()
})

it('opens an informative hover menu for legacy messages without inventing a member lookup', async () => {
  await mount(<MessageAvatar label="旧消息群友" profileEnabled hoverEnabled onOpen={() => {}} onContextMenu={() => {}}/>)
  await act(async () => { const e = new Event('pointerover', { bubbles: true }); Object.assign(e, { pointerType: 'mouse', buttons: 0 }); avatar().dispatchEvent(e) })
  expect(document.querySelector('[role=menu]')).not.toBeNull()
  expect(document.querySelector('[data-arkme-person-profile]')).toBeNull()
  expect(document.body.textContent).toContain('该消息缺少成员身份')
  expect(call).not.toHaveBeenCalled()
})

it('ignores an older hovered member response after moving to another member', async () => {
  const old = deferred(), current = deferred()
  call.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => current.promise)
  const hover = async () => act(async () => { const e = new Event('pointerover', { bubbles: true }); Object.assign(e, { pointerType: 'mouse', buttons: 0 }); avatar().dispatchEvent(e) })
  await mount(); await hover()
  const oldSignal = call.mock.calls.find(([op]) => op === 'source.members.presentation')![2]
  await mount(<Surface targetItem={{ ...item, memberRef: 'new-member', senderName: '另一位群友' }}/>)
  expect(oldSignal.aborted).toBe(true)
  await act(async () => old.resolve(page()))
  expect(document.querySelector('[role=menu]')).not.toBeNull()
  expect(document.querySelector('[data-member-detail]')?.textContent).not.toBe(member.displayName)
  expect(document.querySelector('[data-arkme-person-profile]')).toBeNull()
})
