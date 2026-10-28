import { expect, it, vi } from 'vitest'
import {
  OfficialNotificationService,
  officialSummary,
} from '../../src/services/official-notification-service.js'
import type { ServiceRuntime } from '../../src/services/service.js'
const notice = {
  id: 'notice-one',
  title: '官方公告',
  summary: '摘要',
  status: 'published',
  published_at: 100,
  read_at: 0,
}
function fixture() {
  let session = { userId: 42, accessToken: 'test', refreshToken: 'refresh' }
  const post = vi.fn(),
    invalidate = vi.fn()
  const runtime = {
    config: { environment: 'test' },
    requireSession: async () => session,
    accountScopedSession: async () => session,
    requestScope: (id: number) => `test:${id}`,
    invalidateKey: invalidate,
    authenticatedPost: post,
    runCompositeOwnerRead: async (
      _route: string,
      _params: unknown,
      read: (signal: AbortSignal) => Promise<unknown>,
      signal?: AbortSignal,
    ) => read(signal ?? new AbortController().signal),
  } as unknown as ServiceRuntime
  return {
    service: new OfficialNotificationService(runtime),
    post,
    invalidate,
    switchAccount: () => {
      session = { ...session, userId: 99 }
    },
  }
}
it('routes reads to Record without acknowledging and returns only public notice data', async () => {
  const f = fixture()
  f.post.mockResolvedValue({
    items: [{ ...notice, created_by: 7 }],
    next_cursor: 'next',
  })
  expect(await f.service.list()).toEqual({
    items: [
      {
        id: 'notice-one',
        title: '官方公告',
        summary: '摘要',
        publishedAtMillis: 100,
        readAtMillis: 0,
      },
    ],
    nextCursor: 'next',
  })
  expect(f.post.mock.calls[0]?.[0]).toBe('/api/v1/official-notifications/query')
  expect(f.post).toHaveBeenCalledTimes(1)
})
it('rejects stale-account writes before dispatch and late reads after switching', async () => {
  const f = fixture()
  await expect(
    f.service.read({ accountKey: 'test:99', ids: [notice.id] }),
  ).rejects.toThrow('账号已变化')
  expect(f.post).not.toHaveBeenCalled()
  f.post.mockImplementation(async () => {
    f.switchAccount()
    return notice
  })
  await expect(f.service.detail(notice.id)).rejects.toThrow('账号已变化')
})
it('issues read-all once, propagates uncertain outcomes and invalidates owner reads', async () => {
  const f = fixture()
  f.post.mockRejectedValue(new Error('connection lost'))
  await expect(
    f.service.read({ accountKey: 'test:42', all: true }),
  ).rejects.toThrow('connection lost')
  expect(f.post).toHaveBeenCalledTimes(1)
  expect(f.post.mock.calls[0]?.[0]).toBe(
    '/api/v1/official-notifications/read-all',
  )
  expect(f.invalidate).toHaveBeenCalled()
})
it.each([
  { total: 1, unread_count: 2 },
  { total: 0 },
  { total: -1, unread_count: 0 },
  { total: 1, unread_count: 0, latest: { ...notice, status: 'withdrawn' } },
])('rejects malformed summary %o', (value) => {
  expect(() => officialSummary(value)).toThrow()
})
