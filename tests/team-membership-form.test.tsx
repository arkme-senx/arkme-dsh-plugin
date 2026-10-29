import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TeamDirectoryActions } from '../src/client/redesign/contacts/TeamDirectoryActions.js'
import { ArkmeActionMenu } from '../src/client/ArkmeDshMenu.js'
import { invalidateTeamMessages, openTeamMessages } from '../src/client/team-messaging-events.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { ArkmeClientError } from '../src/sdk/index.js'
import { teamMembershipErrorText } from '../src/client/redesign/contacts/team-membership-feedback.js'

const call = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
vi.mock('../src/client/redesign/contacts/ContactDirectoryAddDialog.js', () => ({
  DirectoryActionDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('../src/client/team-messaging-events.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/team-messaging-events.js')>(), openTeamMessages: vi.fn(),
}))
let root: ReactTestRenderer
const changed = vi.fn()
const tick = async () => { await Promise.resolve(); await Promise.resolve() }
const text = () => JSON.stringify(root.toJSON())
const input = () => root.root.findByType('input')
async function change(value: string) { await act(async () => { input().props.onChange({ target: { value } }); await tick() }) }
async function open(mode: 'join' | 'link', accountKey = 'account') {
  await act(async () => { root = create(<TeamDirectoryActions accountKey={accountKey} onChanged={changed} onSelect={() => {}} />) })
  await act(async () => { root.root.findByType(ArkmeActionMenu).props.actions.find((a: { id: string }) => a.id === mode).onSelect() })
}
async function submit() { await act(async () => { root.root.findByType('form').props.onSubmit({ preventDefault() {} }); await tick() }) }
async function refresh(account = 'account') { await act(async () => { invalidateTeamMessages(account); await tick() }) }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
beforeEach(() => { call.mockReset(); changed.mockReset(); vi.mocked(openTeamMessages).mockClear() })
afterEach(async () => { await act(async () => root?.unmount()); vi.useRealTimers() })

it.each(['dawd', '/team-message?channel=' + 'a'.repeat(32), 'http://example.com/team-message?channel=' + 'a'.repeat(32),
  'https://example.com/wrong?channel=' + 'a'.repeat(32), 'https://example.com/team-message?channel=bad',
  'https://example.com/team-message?channel=' + 'a'.repeat(32) + '&channel=' + 'b'.repeat(32),
  'https://user:password@example.com/team-message?channel=' + 'a'.repeat(32),
  'https://example.com/team-message?channel=' + 'a'.repeat(32) + '#extra',
])('explains invalid link input without exposing URL diagnostics: %s', async value => {
  await open('link'); await change(value); await submit()
  expect(root.root.findByProps({ role: 'alert' }).children.join('')).toBe('请粘贴完整的团队消息链接')
  expect(input().props['aria-invalid']).toBe(true)
  expect(input().props.value).toBe(value)
  expect(call).not.toHaveBeenCalled(); expect(openTeamMessages).not.toHaveBeenCalled()
  await change('corrected'); expect(root.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
})
it('opens a valid link using only its public reference and closes the form', async () => {
  arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:42})
  call.mockImplementation(async op => op === 'team.app.open' ? {channel:{teamRef:'folder'},openInbox:true} : {items:[],hasMore:false})
  await open('link', 'test:42'); await change(` https://example.com/team-message?channel=${'a'.repeat(32)} `); await submit()
  expect(openTeamMessages).toHaveBeenCalledExactlyOnceWith({ kind: 'link', publicRef: 'a'.repeat(32) })
  expect(root.root.findAllByType('form')).toHaveLength(0)
  expect(call.mock.calls.filter(([op]) => op === 'team.app.open')).toHaveLength(1)
  expect(call.mock.calls.some(([op]) => op === 'team.app.entries.change')).toBe(false)
})
it.each(['joined', 'pending'] as const)('shows the %s result without a query or duplicate application action', async state => {
  call.mockResolvedValue({ state })
  await open('join'); await change('arkme_cn'); await submit()
  expect(text()).toContain(state === 'joined' ? '已加入团队' : '申请已提交，等待团队所有者审批')
  expect(text()).not.toContain('查询申请状态')
  expect(root.root.findAllByProps({ type: 'submit' })).toHaveLength(0)
  await submit(); expect(call).toHaveBeenCalledTimes(1); expect(changed).toHaveBeenCalledOnce()
  await change('another_team')
  expect(root.root.findAllByProps({ role: 'status' })).toHaveLength(0)
  expect(root.root.findByProps({ type: 'submit' }).props.disabled).toBe(false)
})
it('updates pending membership automatically and ignores events for other accounts', async () => {
  call.mockResolvedValueOnce({ state: 'pending' }).mockResolvedValueOnce({ state: 'joined' })
  await open('join'); await change('arkme_cn'); await submit()
  await refresh('other-account'); expect(call).toHaveBeenCalledTimes(1)
  await refresh()
  expect(call).toHaveBeenLastCalledWith('team.app.join.status', { jotmoId: 'arkme_cn', expectedAccountKey: 'account' }, expect.any(AbortSignal))
  expect(text()).toContain('已加入团队'); expect(text()).not.toContain('等待团队所有者审批')
  expect(changed).toHaveBeenCalledTimes(2)
  await refresh(); expect(changed).toHaveBeenCalledTimes(2)
})
it('uses a new application identity after a lost response is reconciled and then rejected', async () => {
  call.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({state:'pending'})
    .mockResolvedValueOnce({state:'rejected'}).mockResolvedValueOnce({state:'pending'})
  await open('join'); await change('arkme_cn'); await submit(); await refresh(); await refresh()
  expect(text()).toContain('加入申请未通过')
  await submit()
  const writes = call.mock.calls.filter(value => value[0] === 'team.app.join')
  expect(writes).toHaveLength(2)
  expect(writes[0]![1].requestUid).not.toBe(writes[1]![1].requestUid)
})
it('does not interpret an unexpected result as joined and preserves retry identity', async () => {
  call.mockResolvedValue({ state: 'INTERNAL_UNKNOWN_STATE' })
  await open('join'); await change('arkme_cn'); await submit()
  expect(text()).toContain('暂时无法确认加入结果，请重试'); expect(text()).not.toContain('已加入团队')
  await submit()
  expect(call.mock.calls[0]![1].requestUid).toBe(call.mock.calls[1]![1].requestUid)
})
it('preserves input and request identity when joining fails with an internal error', async () => {
  call.mockRejectedValue(new Error('SQL INTERNAL_DIAGNOSTIC_DETAIL'))
  await open('join'); await change('arkme_cn'); await submit(); await submit()
  expect(text()).toContain('暂时无法加入团队，请稍后重试'); expect(text()).not.toContain('INTERNAL_DIAGNOSTIC')
  expect(input().props.value).toBe('arkme_cn')
  expect(call.mock.calls[0]![1].requestUid).toBe(call.mock.calls[1]![1].requestUid)
})
it('maps a known error code to safe recovery copy rather than the returned message', async () => {
  call.mockRejectedValue(new ArkmeClientError({ code: 'arkme-code-1001', message: 'database/path INTERNAL', retryable: false }))
  await open('join'); await change('bad_team'); await submit()
  expect(text()).toContain('请检查团队即我号是否正确，再试一次'); expect(text()).not.toContain('database/path')
  await refresh()
  expect(call).toHaveBeenCalledTimes(1)
  expect(text()).toContain('请检查团队即我号是否正确，再试一次')
})
it('refreshes the directory once when a confirmed member is removed', async () => {
  call.mockResolvedValueOnce({state:'joined'}).mockResolvedValue({state:'not_member'})
  await open('join'); await change('arkme_cn'); await submit(); await refresh(); await refresh()
  expect(text()).toContain('当前已不是团队成员')
  expect(changed).toHaveBeenCalledTimes(2)
  expect(call.mock.calls.filter(value=>value[0]==='team.app.join')).toHaveLength(1)
})
it('prevents a delayed status result from overwriting the latest membership or another input', async () => {
  const old = deferred<{ state: string }>(), newer = deferred<{ state: string }>(), changedInput = deferred<{ state: string }>()
  call.mockResolvedValueOnce({ state: 'pending' }).mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise).mockReturnValueOnce(changedInput.promise)
  await open('join'); await change('arkme_cn'); await submit(); await refresh(); await refresh()
  await act(async () => { newer.resolve({ state: 'joined' }); await tick() })
  await act(async () => { old.resolve({ state: 'pending' }); await tick() })
  expect(text()).toContain('已加入团队'); expect(text()).not.toContain('等待团队所有者审批')
  await refresh(); await change('another_team')
  await act(async () => { changedInput.resolve({ state: 'joined' }); await tick() })
  expect(root.root.findAllByProps({ role: 'status' })).toHaveLength(0)
})
it('keeps an accepted result on refresh failure and clears the error after recovery', async () => {
  call.mockResolvedValueOnce({ state: 'pending' }).mockRejectedValueOnce(new Error('INTERNAL')).mockResolvedValueOnce({ state: 'joined' })
  await open('join'); await change('arkme_cn'); await submit(); await refresh()
  expect(text()).toContain('申请已提交'); expect(text()).toContain('恢复连接后会自动更新'); expect(text()).not.toContain('INTERNAL')
  expect(root.root.findAllByProps({ type: 'submit' })).toHaveLength(0)
  await refresh(); expect(root.root.findAllByProps({ role: 'alert' })).toHaveLength(0); expect(text()).toContain('已加入团队')
})
it('does not dispatch duplicate mutations while the first request is unresolved', async () => {
  const pending = deferred<{ state: string }>(); call.mockReturnValue(pending.promise)
  await open('join'); await change('arkme_cn'); await submit(); await submit(); await refresh()
  expect(call).toHaveBeenCalledTimes(1)
  await act(async () => { pending.resolve({ state: 'joined' }); await tick() })
  expect(text()).toContain('已加入团队')
})
it('aborts and suppresses callbacks when the dialog closes before the mutation resolves', async () => {
  const pending = deferred<{ state: string }>(); call.mockReturnValue(pending.promise)
  await open('join'); await change('arkme_cn'); await submit()
  const signal = call.mock.calls[0]![2] as AbortSignal
  await act(async () => { root.unmount() }); expect(signal.aborted).toBe(true)
  await act(async () => { pending.resolve({ state: 'joined' }); await tick() })
  expect(changed).not.toHaveBeenCalled()
})
it('replays an invalidation received before a delayed pending response', async () => {
  const pending = deferred<{state: string}>()
  call.mockImplementation(operation => operation === 'team.app.join' ? pending.promise : Promise.resolve({state:'joined'}))
  await open('join'); await change('arkme_cn'); await submit(); await refresh()
  expect(call).toHaveBeenCalledTimes(1)
  await act(async () => { pending.resolve({state:'pending'}); await tick() })
  expect(call.mock.calls.map(value => value[0])).toEqual(['team.app.join', 'team.app.join.status'])
  expect(text()).toContain('已加入团队'); expect(text()).not.toContain('等待团队所有者审批')
})
it('retries a transient status failure without another join mutation', async () => {
  vi.useFakeTimers()
  call.mockResolvedValueOnce({state:'pending'}).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({state:'joined'})
  await open('join'); await change('arkme_cn'); await submit(); await refresh()
  await act(async () => { await vi.advanceTimersByTimeAsync(250); await tick() })
  expect(call.mock.calls.map(value => value[0])).toEqual(['team.app.join', 'team.app.join.status', 'team.app.join.status'])
  expect(text()).toContain('已加入团队'); expect(root.root.findAllByProps({role:'alert'})).toHaveLength(0)
})
it.each(['create','join'] as const)('preserves phone binding recovery semantics for %s', action => {
  const error = new ArkmeClientError({code:'social-phone-binding-required',message:'INTERNAL',retryable:false})
  expect(teamMembershipErrorText(error, action)).toBe('绑定手机号后继续')
})
it('retains the phone binding prompt without background reconciliation of a blocked join', async () => {
  call.mockRejectedValue(new ArkmeClientError({code:'social-phone-binding-required',message:'INTERNAL',retryable:false}))
  await open('join'); await change('arkme_cn'); await submit(); await refresh()
  expect(text()).toContain('绑定手机号后继续'); expect(text()).not.toContain('INTERNAL')
  expect(input().props.value).toBe('arkme_cn'); expect(call).toHaveBeenCalledTimes(1)
})
it.each(['change','close','account'] as const)('cancels a pending read retry on %s and never submits another write', async action => {
  vi.useFakeTimers()
  call.mockResolvedValueOnce({state:'pending'}).mockRejectedValue(new TypeError('Failed to fetch'))
  await open('join'); await change('arkme_cn'); await submit(); await refresh()
  const signal = call.mock.calls[1]![2] as AbortSignal
  if (action === 'change') await change('another_team')
  else if (action === 'close') await act(async () => { root.unmount() })
  else await act(async () => { root.update(<TeamDirectoryActions accountKey="other-account" onChanged={changed} onSelect={() => {}} />) })
  expect(signal.aborted).toBe(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); await tick() })
  expect(call.mock.calls.map(value => value[0])).toEqual(['team.app.join', 'team.app.join.status'])
})
it('bounds retries of a sustained transport failure and preserves an accepted pending result', async () => {
  vi.useFakeTimers()
  call.mockResolvedValueOnce({state:'pending'}).mockRejectedValue(new TypeError('Failed to fetch'))
  await open('join'); await change('arkme_cn'); await submit(); await refresh()
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); await tick() })
  expect(call.mock.calls.filter(value => value[0] === 'team.app.join.status')).toHaveLength(3)
  expect(call.mock.calls.filter(value => value[0] === 'team.app.join')).toHaveLength(1)
  expect(text()).toContain('申请已提交'); expect(text()).toContain('恢复连接后会自动更新')
  expect(text()).not.toContain('查询申请状态')
})
it('coalesces repeated events during a status read into one follow-up read', async () => {
  const pending = deferred<{state:string}>()
  call.mockResolvedValueOnce({state:'pending'}).mockReturnValueOnce(pending.promise).mockResolvedValue({state:'joined'})
  await open('join'); await change('arkme_cn'); await submit(); await refresh(); await refresh(); await refresh()
  expect(call.mock.calls.filter(value => value[0] === 'team.app.join.status')).toHaveLength(1)
  await act(async () => { pending.resolve({state:'pending'}); await tick() })
  expect(call.mock.calls.filter(value => value[0] === 'team.app.join.status')).toHaveLength(2)
  expect(text()).toContain('已加入团队')
})
it.each(['local-network-unavailable','arkme-timeout','team-rate_limited'])('explains automatic status recovery for %s', code => {
  const error = new ArkmeClientError({code,message:'INTERNAL',retryable:true})
  expect(teamMembershipErrorText(error, 'status')).toBe('暂时无法更新加入状态，恢复连接后会自动更新')
})
