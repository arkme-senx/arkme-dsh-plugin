// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { loadMoreTeamOutboundContacts, observeTeamOutboundAccount, teamOutboundContacts } from '../src/client/team-outbound-contacts.js'

const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
const account = 'prod:90'
const contact = (name: string) => ({ kind: 'contact', contactRef: name, displayName: name, nickname: name, remark: '', letter: '#' })
const page = (name: string, cursor?: string) => ({ section: 'contacts', items: [contact(name)], hasMore: !!cursor, ...(cursor ? { nextCursor: cursor } : {}) })
const signIn = (environment = 'prod', userId = 90) => arkmeAuthStore.setAuth({ status: 'authenticated', environment, userId } as never)
const read = () => teamOutboundContacts.refresh(account, account, false)
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => { teamOutboundContacts.reset(); call.mockReset(); signIn(); observeTeamOutboundAccount() })
afterEach(() => { teamOutboundContacts.reset(); vi.restoreAllMocks() })

it('coalesces simultaneous first reads and keeps all loaded pages for a fresh reopen', async () => {
  const wait = deferred(); call.mockImplementationOnce(() => wait.promise).mockResolvedValueOnce(page('乙'))
  const first = read(), joined = read()
  await vi.waitFor(() => expect(call).toHaveBeenCalledOnce())
  wait.resolve(page('甲', 'page-2')); await Promise.all([first, joined])
  await loadMoreTeamOutboundContacts(account)
  expect((await read()).items.map(item => item.displayName)).toEqual(['甲', '乙'])
  expect(call).toHaveBeenCalledTimes(2)
})

it('retains existing contacts after a failed background refresh', async () => {
  call.mockResolvedValueOnce(page('甲')); await read()
  call.mockRejectedValueOnce(new Error('temporary outage'))
  await expect(teamOutboundContacts.refresh(account, account)).rejects.toThrow('temporary outage')
  expect(teamOutboundContacts.get(account).value?.items[0]?.displayName).toBe('甲')
  expect(teamOutboundContacts.get(account).error).toBeInstanceOf(Error)
})

it('keeps the cursor and existing page after load-more failure, then retries the same page', async () => {
  call.mockResolvedValueOnce(page('甲', 'page-2')); await read()
  call.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page('乙'))
  await expect(loadMoreTeamOutboundContacts(account)).rejects.toThrow('offline')
  expect(teamOutboundContacts.get(account).value?.items).toHaveLength(1)
  await loadMoreTeamOutboundContacts(account)
  expect(call.mock.calls.slice(1).map(([, p]) => p.cursor)).toEqual(['page-2', 'page-2'])
  expect(teamOutboundContacts.get(account).value?.items).toHaveLength(2)
  expect(teamOutboundContacts.get(account).operationError).toBeUndefined()
})

it('restarts an expired Host snapshot without appending an unrelated new first page', async () => {
  call.mockResolvedValueOnce(page('甲', 'expired')).mockResolvedValueOnce({ section: 'contacts', items: [], hasMore: false, cursorStale: true }).mockResolvedValueOnce(page('新甲', 'new-cursor'))
  await read(); await loadMoreTeamOutboundContacts(account)
  expect(teamOutboundContacts.get(account).value?.items.map(item => item.displayName)).toEqual(['新甲'])
  expect(call.mock.calls.map(([, p]) => p.cursor)).toEqual([undefined, 'expired', undefined])
})

it('rejects a cyclic cursor and retains the last coherent list', async () => {
  call.mockResolvedValueOnce(page('甲', 'a')).mockResolvedValueOnce(page('乙', 'b')).mockResolvedValueOnce(page('丙', 'a'))
  await read(); await loadMoreTeamOutboundContacts(account)
  await expect(loadMoreTeamOutboundContacts(account)).rejects.toThrow('联系人分页异常')
  expect(teamOutboundContacts.get(account).value?.items.map(item => item.displayName)).toEqual(['甲', '乙'])
})

it.each(['account', 'environment', 'logout'] as const)('drops old references and ignores late reads after %s changes', async change => {
  const wait = deferred(); call.mockImplementationOnce(() => wait.promise)
  const old = read(); const cancelled = expect(old).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(call).toHaveBeenCalledOnce())
  if (change === 'account') signIn('prod', 91)
  else if (change === 'environment') signIn('test')
  else { arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'prod' } as never); signIn() }
  expect(call.mock.calls[0]![2].aborted).toBe(true)
  wait.resolve(page('旧账号')); await cancelled
  expect(teamOutboundContacts.get(account).value).toBeUndefined()
  const next = change === 'account' ? 'prod:91' : change === 'environment' ? 'test:90' : account
  call.mockResolvedValueOnce(page('当前账号'))
  expect((await teamOutboundContacts.refresh(next, next, false)).items[0]?.displayName).toBe('当前账号')
})

it('does not let a late load-more response restore references after Provider cache reset', async () => {
  call.mockResolvedValueOnce(page('甲', 'next')); await read()
  const wait = deferred(); call.mockImplementationOnce(() => wait.promise)
  const more = loadMoreTeamOutboundContacts(account); const cancelled = expect(more).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2))
  teamOutboundContacts.reset(); call.mockResolvedValueOnce(page('当前 Host')); await read()
  wait.resolve(page('旧 Host')); await cancelled
  expect(teamOutboundContacts.get(account).value?.items.map(item => item.displayName)).toEqual(['当前 Host'])
})
