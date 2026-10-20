import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EMPTY_RECORDING_WORKFLOW } from '../src/recording-workflow-contract.js'
const mocks = vi.hoisted(() => ({ call: vi.fn(), scope: 'test:42', listeners: new Set<() => void>() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/auth-store.js', () => ({ arkmeAuthStore: {
  subscribe: (fn: () => void) => { mocks.listeners.add(fn); return () => mocks.listeners.delete(fn) },
  getSnapshot: () => ({ auth: mocks.scope ? { status: 'authenticated', environment: mocks.scope.split(':')[0], userId: Number(mocks.scope.split(':')[1]) } : undefined }),
} }))
import { RecordingNotificationStore } from '../src/client/recording-notification-store.js'
const notice = { id: 'notice-0001', sequence: '60', batchId: 'batch-0001', stage: 'processing', state: 'completed', fileCount: 2, completedCount: 2, failedCount: 0, atMillis: 1000, readAtMillis: 0, message: '', days: [] }
const page = { ...EMPTY_RECORDING_WORKFLOW, supported: true, items: [notice], latest: notice, total: 60, unreadCount: 55, nextCursor: 'next', readThrough: '0123456789abcdef01234567:60' }
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
let store: RecordingNotificationStore, releases: (() => void)[]
beforeEach(() => { mocks.scope = 'test:42'; mocks.call.mockReset().mockResolvedValue(page); store = new RecordingNotificationStore(); releases = [] })
afterEach(() => { for (const release of releases) release(); vi.useRealTimers() })
it('deduplicates consumers and pages while retaining server unread totals', async () => {
  releases.push(store.acquire('test:42'), store.acquire('test:42')); await tick()
  expect(mocks.call).toHaveBeenCalledOnce()
  await store.refresh(true)
  expect(store.getSnapshot().items).toHaveLength(1)
  expect(store.getSnapshot().unreadCount).toBe(55)
  expect(mocks.call.mock.calls.every(call => call[1].operation === 'query')).toBe(true)
})
it('keeps last good notices on outages and does not claim failed read acknowledgements', async () => {
  releases.push(store.acquire('test:42')); await tick()
  mocks.call.mockRejectedValue(new Error('offline')); await store.refresh()
  expect(store.getSnapshot().items).toHaveLength(1)
  await expect(store.read('test:42', [{ id: 'notice-0001', sequence: '60' }])).rejects.toThrow('offline')
  expect(store.getSnapshot().items[0]!.readAtMillis).toBe(0)
})
it('drops late results even when an account logs out and logs back in as itself', async () => {
  let done!: (value: unknown) => void
  mocks.call.mockImplementation(() => new Promise(resolve => { done = resolve }))
  releases.push(store.acquire('test:42')); await tick()
  mocks.scope = ''; mocks.listeners.forEach(fn => fn()); mocks.scope = 'test:42'
  done(page); await tick()
  expect(store.getSnapshot().items).toHaveLength(0)
})
it('does not mark new events arriving during read-all as read or reorder the old event', async () => {
  releases.push(store.acquire('test:42')); await tick()
  let finish!: () => void
  const newer = { ...notice, id: 'notice-0002', atMillis: 2000 }
  mocks.call.mockImplementation(async (_op, input) => input.operation === 'read' ? new Promise<void>(resolve => { finish = resolve }) : { ...page, total: 61, unreadCount: 1, latest: newer, items: [newer, { ...notice, readAtMillis: 3000 }] })
  const reading = store.read('test:42'); await tick(); await store.refresh(); finish(); await reading
  expect(store.getSnapshot().items.find(item => item.id === newer.id)?.readAtMillis).toBe(0)
  expect(store.getSnapshot().items.find(item => item.id === notice.id)?.atMillis).toBe(1000)
  expect(mocks.call.mock.calls.find(call => call[1].operation === 'read')?.[1]).toMatchObject({ readThrough: '0123456789abcdef01234567:60' })
})
it('backs off unsupported servers and never invents completion events', async () => {
  vi.useFakeTimers(); mocks.call.mockResolvedValue(EMPTY_RECORDING_WORKFLOW)
  releases.push(store.acquire('test:42')); await tick()
  await vi.advanceTimersByTimeAsync(240_000)
  expect(mocks.call).toHaveBeenCalledOnce()
  expect(store.getSnapshot()).toMatchObject({ supported: false, items: [] })
  expect(store.getSnapshot().error).toBeUndefined()
})

it.each([false, true])('keeps a newer revision of the same notice unread while %s read is in flight', async all => {
  releases.push(store.acquire('test:42')); await tick()
  let finish!: () => void
  const newer = { ...notice, sequence: '61', atMillis: 2000 }
  let failRefresh = false
  mocks.call.mockImplementation(async (_op, input) => {
    if (input.operation === 'read') return new Promise<void>(resolve => { finish = resolve })
    if (failRefresh) throw new Error('offline')
    return { ...page, items: [newer], latest: newer, readThrough: '0123456789abcdef01234567:61' }
  })
  const reading = store.read('test:42', all ? undefined : [{ id: notice.id, sequence: notice.sequence }])
  await tick(); await store.refresh()
  failRefresh = true; finish(); await reading
  expect(store.getSnapshot().items[0]).toMatchObject({ sequence: '61', readAtMillis: 0 })
  expect(mocks.call.mock.calls.find(call => call[1].operation === 'read')?.[1]).toMatchObject(all
    ? { readThrough: '0123456789abcdef01234567:60' } : { items: [{ id: notice.id, sequence: '60' }] })
})

it('replaces stale pages on refresh so deleted or expired notices do not accumulate', async () => {
  releases.push(store.acquire('test:42')); await tick()
  const older = { ...notice, id: 'notice-older' }
  mocks.call.mockResolvedValue({ ...page, items: [older], nextCursor: 'third' })
  await store.refresh(true)
  expect(store.getSnapshot().items).toHaveLength(2)
  mocks.call.mockResolvedValue({ ...page, items: [], latest: undefined, total: 0, unreadCount: 0, readThrough: '', nextCursor: '' })
  await store.refresh()
  expect(store.getSnapshot()).toMatchObject({ items: [], total: 0, unreadCount: 0, readThrough: '', nextCursor: '' })
})

it('recovers an expired pagination anchor by replacing with the current first page', async () => {
  releases.push(store.acquire('test:42')); await tick()
  const newer = { ...notice, id: 'new-epoch', sequence: '1' }
  mocks.call.mockImplementation(async (_op, input) => {
    if (input.cursor) throw new Error('expired cursor')
    return { ...page, items: [newer], latest: newer, total: 1, unreadCount: 1, nextCursor: '' }
  })
  await store.refresh(true)
  expect(store.getSnapshot().items).toEqual([newer])
  expect(store.getSnapshot().error).toBeUndefined()
})
