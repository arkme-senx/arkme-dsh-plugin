import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call, ArkmeClientError: class extends Error {} }))
vi.mock('../src/client/official-notification-store.js', () => ({ useOfficialNotifications: () => ({ items: [], summary: { total: 0, unreadCount: 0 }, ready: true }), officialNotifications: {} }))
vi.mock('../src/client/world-notification-reader.js', () => ({ readWorldNotifications: async () => [] }))
import { ArkmeNotificationCenter, useArkmeNotificationSummary } from '../src/client/ArkmeNotificationCenter.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
let renderer: ReactTestRenderer | undefined
const tick = async () => { for (let i = 0; i < 25; i++) await Promise.resolve() }
beforeEach(() => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
})
afterEach(async () => {
  await act(async () => { renderer?.unmount(); arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' }) })
  vi.unstubAllGlobals()
})
it('includes recording events in the total notification conversation with server unread count, then opens the real detail', async () => {
  const notice = { id: 'notice-0001', batchId: 'batch-0001', stage: 'processing', state: 'completed', fileCount: 2, completedCount: 2, failedCount: 0, atMillis: 1000, readAtMillis: 0, message: '', days: [{ date: '2026-10-09', summary: { state: 'pending' }, timeline: { state: 'pending' } }] }
  let read = false
  mocks.call.mockImplementation(async (operation, input) => {
    if (operation === 'recordings.workflow') {
      if (input.operation === 'read') { read = true; return }
      return { supported: true, items: [{ ...notice, readAtMillis: read ? 2000 : 0 }], latest: notice, total: 60, unreadCount: read ? 54 : 55, nextCursor: 'next', throughSequence: '60' }
    }
    return { items: [], unreadCount: 0, total: 0, seenThroughSequence: 0 }
  })
  let summary!: ReturnType<typeof useArkmeNotificationSummary>
  function Probe() { summary = useArkmeNotificationSummary(); return null }
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 742 })
  await act(async () => { renderer = create(<><Probe /><ArkmeNotificationCenter /></>); await tick() })
  expect(summary).toMatchObject({ unreadCount: 55, atMillis: 1000, hasNotifications: true })
  expect(renderer!.root.findByProps({ 'aria-label': '录音 (60)' })).toBeDefined()
  expect(mocks.call.mock.calls.filter(call => call[0] === 'recordings.workflow')).toHaveLength(1)
  await act(async () => { renderer!.root.findByProps({ 'aria-label': '录音：录音处理完成' }).props.onClick(); await tick() })
  expect(renderer!.root.findAllByType('button').some(button => button.children.includes('查看录音'))).toBe(true)
  expect(summary).toMatchObject({ unreadCount: 54, atMillis: 1000 })
  expect(mocks.call.mock.calls.find(call => call[1]?.operation === 'read')?.[1]).toEqual({ operation: 'read', accountKey: 'test:742', ids: ['notice-0001'] })
})

it('shows loading instead of a false empty recording filter while its first query is pending', async () => {
  mocks.call.mockImplementation(async (operation) => operation === 'recordings.workflow'
    ? new Promise(() => {}) : { items: [], unreadCount: 0, total: 0, seenThroughSequence: 0 })
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 743 })
  await act(async () => { renderer = create(<ArkmeNotificationCenter />); await tick() })
  await act(async () => { renderer!.root.findByProps({ 'aria-label': '录音 (0)' }).props.onClick() })
  expect(renderer!.root.findAllByProps({ role: 'status' }).some(node => node.children.includes('正在加载通知…'))).toBe(true)
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('录音暂时没有通知')
})
