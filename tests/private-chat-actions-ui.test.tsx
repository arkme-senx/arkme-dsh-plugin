// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async importOriginal => ({ ...await importOriginal<object>(), callArkme: mocks.call }))
import { ConversationActionsMenu, privateChatActionItems, usePrivateChatActions, type ConversationActionItem } from '../src/client/PrivateChatActions.js'
import { useDirectMessageAdmission } from '../src/client/direct-message-admission.js'
import { privateChatActions, UnconfirmedBanError } from '../src/client/private-chat-actions-store.js'
import { ArkmeClientError } from '../src/client/api.js'

const account = 'test:7'
const source = { sourceRef: 'opaque', sourceKey: 'private:42', kind: 'private_chat' as const, peerUserId: 42, displayName: 'Peer', activeAtMillis: 0, unreadCount: 0 }
const allowed = { state: 'allowed', canSend: true, refusalCreationEnabled: true, ownRefused: false, counterpartRefused: false, ownRevision: 0, counterpartRevision: 0 }
const profile = { profile: { userId: 7, accountType: 2 }, revision: 1, cachedAtMillis: 1 }
let host: HTMLDivElement; let trigger: HTMLButtonElement; let root: Root
const anchor = createRef<HTMLButtonElement>()
const close = vi.fn()
function Probe({ open = true, currentAccount = account } = {}) {
  const admission = useDirectMessageAdmission(currentAccount, source, true)
  const actions = usePrivateChatActions(currentAccount, 7, source, true, open)
  return open ? <ConversationActionsMenu items={privateChatActionItems(actions, admission, vi.fn())} host={host} anchor={anchor} onClose={close} /> : null
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); trigger = document.createElement('button'); (anchor as { current: HTMLButtonElement }).current = trigger
  document.body.append(trigger, host); trigger.focus(); root = createRoot(host)
  mocks.call.mockImplementation(async operation => {
    if (operation === 'user.profile.refresh') return profile
    if (operation === 'related-recordings.eligibility') return { allowed: true }
    if (operation === 'chat.direct-message-admission') return allowed
    if (operation === 'user-ban.status') return { sourceRef: 'opaque', displayName: 'Peer', exists: false, banned: false }
    throw new Error(`unexpected ${operation}`)
  })
})
afterEach(() => {
  act(() => { root.unmount() }); host.remove(); trigger.remove()
  privateChatActions.activateAccount(undefined); privateChatActions.reset(); localStorage.clear()
  close.mockReset(); mocks.call.mockReset(); vi.useRealTimers(); vi.unstubAllGlobals()
})
const rows = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
const render = async (open = true) => { await act(async () => { root.render(<Probe open={open} />) }) }

it('shows an enabled unchecked result immediately, never a loading row or an unconfirmed employee action', async () => {
  mocks.call.mockImplementation(() => new Promise(() => {}))
  await render()
  expect(rows().map(button => button.textContent)).toEqual(['拒收对方消息'])
  expect(rows()[0]!.getAttribute('aria-checked')).toBe('false')
  expect(rows()[0]!.disabled).toBe(false)
  expect(host.textContent).not.toMatch(/加载|正在检查|封禁/)
  expect(host.querySelector('[role=menu]')!.hasAttribute('aria-busy')).toBe(false)
})

it('revalidates both warm business snapshots on every open without refreshing the still-fresh identity', async () => {
  await render(); expect(rows().map(button => button.textContent)).toEqual(['相关录音', '拒收对方消息', '封禁用户'])
  await render(false); await render()
  for (const operation of ['related-recordings.eligibility', 'user-ban.status']) {
    expect(mocks.call.mock.calls.filter(call => call[0] === operation)).toHaveLength(2)
  }
  expect(mocks.call.mock.calls.filter(call => call[0] === 'user.profile.refresh')).toHaveLength(1)
})

it('does not query ban status for an ordinary account or show staff from persistent profile data', async () => {
  localStorage.setItem('profile', JSON.stringify(profile))
  const original = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation(async operation => operation === 'user.profile.refresh'
    ? { ...profile, profile: { userId: 7, accountType: 1 } } : await original(operation))
  await render()
  expect(host.textContent).not.toContain('封禁')
  expect(mocks.call.mock.calls.some(call => call[0] === 'user-ban.status')).toBe(false)
})

it('does not issue menu-only reads on invalidation while closed or expose a rejected employee action', async () => {
  await render(false)
  await act(async () => { privateChatActions.reset() })
  expect(mocks.call.mock.calls.some(call => call[0] === 'user-ban.status' || call[0] === 'related-recordings.eligibility')).toBe(false)
  const original = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation(async operation => {
    if (operation === 'user-ban.status') throw new ArkmeClientError({ code: 'arkme-code-1001', message: '参数错误', retryable: false })
    return await original(operation)
  })
  await render(); expect(host.textContent).not.toContain('封禁用户')
  expect(mocks.call.mock.calls.filter(call => call[0] === 'user-ban.status')).toHaveLength(1)
  mocks.call.mockImplementation(original)
  await render(false); await render()
  expect(host.textContent).toContain('封禁用户')
})

it('keeps cached visible values enabled while background requests stall', async () => {
  await render(); await render(false)
  mocks.call.mockImplementation(() => new Promise(() => {}))
  await render()
  expect(rows().map(button => button.textContent)).toEqual(['相关录音', '拒收对方消息', '封禁用户'])
  expect(rows().every(button => !button.disabled)).toBe(true)
})

it('retries an unavailable identity when the user reopens the menu, without a background retry loop', async () => {
  const original = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation(async operation => {
    if (operation === 'user.profile.refresh') throw new Error('offline')
    return await original(operation)
  })
  await render()
  expect(host.textContent).not.toContain('封禁用户')
  expect(mocks.call.mock.calls.filter(call => call[0] === 'user.profile.refresh')).toHaveLength(1)
  mocks.call.mockImplementation(original)
  await render(false); await render()
  expect(host.textContent).toContain('封禁用户')
  expect(mocks.call.mock.calls.filter(call => call[0] === 'user.profile.refresh')).toHaveLength(2)
})

it('keeps a known authorization rejection hidden throughout a pending retry', async () => {
  const original = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation(async operation => {
    if (operation === 'user-ban.status') throw new ArkmeClientError({ code: 'arkme-code-1001', message: '参数错误', retryable: false })
    return await original(operation)
  })
  await render(); expect(host.textContent).not.toContain('封禁用户')
  mocks.call.mockImplementation(operation => operation === 'user-ban.status' ? new Promise(() => {}) : original(operation))
  await render(false); await render()
  expect(host.textContent).not.toContain('封禁用户')
})

it('shows local failure feedback while leaving independent actions usable', async () => {
  const original = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation(async operation => {
    if (operation === 'related-recordings.eligibility' || operation === 'user-ban.status') throw new Error('offline')
    return await original(operation)
  })
  await render()
  expect(rows().map(button => button.textContent)).toEqual(['重新检查相关录音', '拒收对方消息', '封禁用户'])
  expect(rows().every(button => !button.disabled)).toBe(true)
  expect(host.querySelector('[role=status]')!.textContent).toContain('暂时无法读取')
})

it('drops employee visibility on expiry even when the refresh never completes', async () => {
  vi.useFakeTimers(); await render()
  mocks.call.mockImplementation(() => new Promise(() => {}))
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  expect(host.textContent).not.toContain('封禁')
  expect(rows().some(button => button.textContent === '拒收对方消息')).toBe(true)
})

it('restores focus to a surviving action when a focused employee entry expires', async () => {
  vi.useFakeTimers(); await render()
  rows().at(-1)!.focus(); mocks.call.mockImplementation(() => new Promise(() => {}))
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  expect(document.activeElement).toBe(rows()[0])
})

it('supports keyboard navigation, Enter, Escape and trigger focus restoration', async () => {
  const invoke = vi.fn(); const item = (id: string): ConversationActionItem => ({ id, label: id, icon: null, invoke })
  act(() => { root.render(<ConversationActionsMenu items={[item('a'), item('b')]} host={host} anchor={anchor} onClose={close} />) })
  expect(document.activeElement).toBe(rows()[0])
  act(() => { rows()[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })) })
  expect(document.activeElement).toBe(rows()[1])
  act(() => { rows()[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })
  expect(invoke).toHaveBeenCalledOnce()
  act(() => { rows()[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
  expect(close).toHaveBeenCalledOnce()
  act(() => { root.render(null) }); expect(document.activeElement).toBe(trigger)
})

it('shows mutation progress only on the corresponding action', () => {
  act(() => { root.render(<ConversationActionsMenu items={[
    { id: 'busy', label: '封禁用户', icon: null, busy: true, invoke: vi.fn() },
    { id: 'available', label: '相关录音', icon: null, invoke: vi.fn() },
  ]} host={host} anchor={anchor} onClose={close} />) })
  expect(rows()[0]!.disabled).toBe(true); expect(rows()[0]!.textContent).toContain('处理中')
  expect(rows()[1]!.disabled).toBe(false); expect(rows()[1]!.textContent).not.toContain('处理中')
})

it('captures the clicked intent even if the same item receives a new label before pointer-up', () => {
  const first = vi.fn(); const second = vi.fn()
  const renderItem = (invoke: () => void, label: string) => root.render(<ConversationActionsMenu
    items={[{ id: 'ban', label, icon: null, invoke }]} host={host} anchor={anchor} onClose={close} />)
  act(() => { renderItem(first, '封禁用户') })
  act(() => { rows()[0]!.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
  act(() => { renderItem(second, '解封用户') })
  act(() => { rows()[0]!.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true })) })
  expect(first).toHaveBeenCalledOnce(); expect(second).not.toHaveBeenCalled()
})

it('cancels a held gesture when permissions insert or remove rows, and accepts a fourth unrelated item', () => {
  const invoke = vi.fn(); const item = (id: string) => ({ id, label: id, icon: null, invoke })
  const renderItems = (ids: string[]) => root.render(<ConversationActionsMenu items={ids.map(item)} host={host} anchor={anchor} onClose={close} />)
  act(() => { renderItems(['refusal', 'ban']) })
  act(() => { rows()[0]!.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
  act(() => { renderItems(['related', 'refusal', 'ban', 'fourth']) })
  act(() => { rows()[1]!.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true })) })
  expect(invoke).not.toHaveBeenCalled()
  act(() => { rows()[3]!.click() }); expect(invoke).toHaveBeenCalledOnce()
})

it('retains the same explicit recovery action when ban read-back already changed', () => {
  const changeBan = vi.fn()
  const items = privateChatActionItems({ canManage: true, relatedAllowed: false,
    relatedError: undefined, refreshRelated: vi.fn(), changeBan,
    ban: { ...privateChatActions.ban.empty, value: { sourceRef: 'opaque', displayName: 'Peer', exists: true, banned: true }, operationError: new UnconfirmedBanError(true, new Error('lost')) },
  }, { applicable: false } as ReturnType<typeof useDirectMessageAdmission>, vi.fn())
  expect(items[0]!.label).toBe('重试封禁用户'); items[0]!.invoke()
  expect(changeBan).toHaveBeenCalledWith(true)
})
