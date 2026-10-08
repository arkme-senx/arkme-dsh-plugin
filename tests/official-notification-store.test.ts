import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn(), scope: 'test:42' }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/auth-store.js', () => ({
  arkmeAuthStore: {
    getSnapshot: () => ({
      auth: {
        status: 'authenticated',
        environment: mocks.scope.split(':')[0],
        userId: Number(mocks.scope.split(':')[1]),
      },
    }),
  },
}))
import { OfficialNotificationStore } from '../src/client/official-notification-store.js'
const notice = {
  id: 'notice-one',
  title: '公告',
  summary: '',
  publishedAtMillis: 100,
  readAtMillis: 0,
}
const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
let store: OfficialNotificationStore, release: () => void
beforeEach(() => {
  mocks.scope = 'test:42'
  mocks.call.mockReset()
  store = new OfficialNotificationStore()
  release = () => {}
  mocks.call.mockImplementation(async (op: string) =>
    op.endsWith('summary')
      ? { total: 120, unreadCount: 120, latest: notice }
      : { items: [notice], nextCursor: 'next' },
  )
})
afterEach(() => {
  release()
  vi.restoreAllMocks()
})
it('uses server summary across pages, and lists never mark read', async () => {
  release = store.acquire('test:42')
  await tick()
  expect(store.getSnapshot().summary.unreadCount).toBe(120)
  expect(
    mocks.call.mock.calls.every(
      (call) => call[0] !== 'official-notifications.read',
    ),
  ).toBe(true)
  mocks.call.mockImplementation(async (op: string) =>
    op.endsWith('read')
      ? { total: 120, unreadCount: 0 }
      : op.endsWith('summary')
        ? { total: 120, unreadCount: 0 }
        : { items: [{ ...notice, readAtMillis: 101 }], nextCursor: '' },
  )
  await store.read('test:42')
  await tick()
  expect(mocks.call).toHaveBeenCalledWith(
    'official-notifications.read',
    { accountKey: 'test:42', all: true },
    expect.anything(),
  )
  expect(store.getSnapshot().summary.unreadCount).toBe(0)
})
it('preserves the last good state on outage and surfaces failed writes', async () => {
  release = store.acquire('test:42')
  await tick()
  mocks.call.mockRejectedValue(new Error('offline'))
  await store.refresh()
  expect(store.getSnapshot().items).toEqual([notice])
  expect(store.getSnapshot().error).toBe('offline')
  await expect(store.read('test:42')).rejects.toThrow('offline')
  expect(store.getSnapshot().summary.unreadCount).toBe(120)
})
it('discards late account A responses after account B activation', async () => {
  let finish!: (value: unknown) => void
  mocks.call.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  release = store.acquire('test:42')
  await tick()
  const oldFinish = finish
  mocks.scope = 'test:99'
  release()
  mocks.call.mockResolvedValue({
    items: [],
    nextCursor: '',
    total: 0,
    unreadCount: 0,
  })
  release = store.acquire('test:99')
  await tick()
  oldFinish({ items: [notice], nextCursor: '' })
  await tick()
  expect(store.getSnapshot().scope).toBe('test:99')
  expect(store.getSnapshot().items).toEqual([])
})
it('reconciles again when an IM hint arrives during a stale in-flight read', async () => {
  let finish!: (value: unknown) => void
  mocks.call.mockImplementation(async (op: string) =>
    op.endsWith('summary')
      ? { total: 1, unreadCount: 1 }
      : new Promise((resolve) => {
          finish = resolve
        }),
  )
  release = store.acquire('test:42')
  await tick()
  store.invalidate('test:42')
  mocks.call.mockImplementation(async (op: string) =>
    op.endsWith('summary')
      ? { total: 0, unreadCount: 0 }
      : { items: [], nextCursor: '' },
  )
  finish({ items: [notice], nextCursor: '' })
  await tick()
  expect(store.getSnapshot().items).toEqual([])
  expect(store.getSnapshot().summary.total).toBe(0)
})

it('does not mark a concurrent publication read while read-all is pending', async () => {
  release = store.acquire('test:42')
  await tick()
  let finish!: (value: unknown) => void
  mocks.call.mockImplementation(async (op: string) =>
    op.endsWith('read') ? new Promise(resolve => { finish = resolve })
      : op.endsWith('summary') ? { total: 2, unreadCount: 1 }
      : { items: [{ ...notice, readAtMillis: 101 }, { ...notice, id: 'notice-new' }], nextCursor: '' })
  const writing = store.read('test:42')
  store.invalidate('test:42')
  await tick()
  finish({ total: 2, unreadCount: 1 })
  await writing
  expect(store.getSnapshot().items.find(item => item.id === 'notice-new')?.readAtMillis).toBe(0)
  await tick()
  expect(store.getSnapshot().summary.unreadCount).toBe(1)
})
