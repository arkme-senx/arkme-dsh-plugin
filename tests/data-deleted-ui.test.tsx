// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { ArkmeDataManagementSettings } from '../src/client/ArkmeDataManagementSettings.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkoLifecycleSync } from '../src/client/arko-lifecycle-sync.js'
import { callArkme } from '../src/client/api.js'
vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
let root: Root, host: HTMLDivElement
const record = { recordUid: '88:1', version: 5, title: '保留的快记', text: '快记详情', sendAtMillis: 1000 }
const message = () => ({ messageRef: 'opaque', messageKey: '88:1', version: 1, state: 'deleted', deletedAtMillis: 1, purgeAtMillis: Date.now() + 5000, lastOperationUid: 'delete', message: { text: '已删除的问题', createdAtMillis: 2000 } })
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text)!
const click = async (text: string) => { await act(async () => { expect(button(text), text).toBeDefined(); button(text).click() }) }
const open = async () => { await act(async () => root.render(<ArkmeDataManagementSettings />)); await click('最近删除') }
const select = async (text: string) => { await act(async () => [...host.querySelectorAll('li')].find(li => li.textContent?.includes(text))!.querySelector('button')!.click()) }
const writes = () => vi.mocked(callArkme).mock.calls.filter(([op]) => op === 'data.recover' || op === 'arko.lifecycle.change')
let messages: ReturnType<typeof message>[]
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 7 })
  messages = [message()]
  vi.mocked(callArkme).mockReset().mockImplementation(async (op, input) => {
    if (op === 'data.deleted') return { accountScope: 'test:7', items: [record], mayHaveMore: false } as never
    if (op === 'arko.deleted') return { items: messages, hasMore: false } as never
    if (op === 'arko.lifecycle.change') {
      messages = []
      return { items: [{ ...message(), state: 'active', version: 2, lastOperationUid: input?.operationUid, result: 'applied' }] } as never
    }
    if (op === 'data.recover') return {} as never
    throw Error(op)
  })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
it('focuses the existing recovery confirmation in a long list, including repeated selection', async () => {
  messages = Array.from({ length: 45 }, (_, index) => ({ ...message(), messageRef: `opaque-${index}`, messageKey: `88:${index + 1}`,
    message: { text: index === 0 ? '恢复定位目标' : `其他已删除消息 ${index}`, createdAtMillis: 2000 - index } }))
  await open()
  expect(host.querySelectorAll('li')).toHaveLength(46)
  await select('恢复定位目标')
  const confirmation = host.querySelector('[aria-label="确认恢复记录"]')!
  expect(document.activeElement).toBe(confirmation)
  expect(confirmation.textContent).toContain('恢复定位目标')
  expect(writes()).toHaveLength(0)
  const restore = host.querySelector('li button') as HTMLButtonElement
  restore.focus()
  await select('恢复定位目标')
  expect(document.activeElement).toBe(confirmation)
  await click('取消')
  expect(host.querySelector('[aria-label="确认恢复记录"]')).toBeNull()
  expect(writes()).toHaveLength(0)
})
it('reuses existing rows and confirmation while routing identical keys to the correct owner', async () => {
  await open()
  expect(host.querySelectorAll('.arkme-data-deleted-list')).toHaveLength(1)
  expect(host.querySelectorAll('li')).toHaveLength(2)
  expect(host.querySelectorAll('input, [aria-label="Arko 对话消息"]')).toHaveLength(0)
  expect([...host.querySelectorAll('button')].map(b => b.textContent)).toEqual(['‹ 数据管理', '刷新', '恢复', '恢复'])
  await select('已删除的问题'); await click('取消'); expect(writes()).toHaveLength(0)
  await select('已删除的问题'); await click('确认恢复')
  expect(writes()).toHaveLength(1)
  expect(writes()[0]).toEqual(['arko.lifecycle.change', expect.objectContaining({ action: 'restore', targets: [{ messageRef: 'opaque', expectedVersion: 1 }] }), expect.any(AbortSignal)])
  expect(host.querySelectorAll('li')).toHaveLength(1)
  expect(host.textContent).toContain('保留的快记')
  await select('保留的快记'); await click('确认恢复')
  expect(writes()[1]).toEqual(['data.recover', { expectedAccountScope: 'test:7', recordUid: '88:1', version: 5 }, expect.any(AbortSignal)])
})
it('keeps unknown restores in the list and makes repeated confirmation read-only', async () => {
  const original = vi.mocked(callArkme).getMockImplementation()!
  let resolved = false
  vi.mocked(callArkme).mockImplementation(async (op, input, signal) => {
    if (op === 'arko.lifecycle.change') return { items: [{ ...message(), result: 'unknown' }] } as never
    if (op === 'arko.lifecycle.query') return { revision: 1, items: [{ ...message(), ...(resolved ? { state: 'active', version: 2 } : {}) }] } as never
    return original(op, input, signal)
  })
  await open(); await select('已删除的问题'); await click('确认恢复')
  expect(host.textContent).not.toContain('已恢复')
  expect(host.querySelectorAll('li')).toHaveLength(2)
  await click('确认恢复'); expect(writes()).toHaveLength(1)
  expect(host.textContent).not.toMatch(/核对状态|恢复所选|尚未确认/)
  resolved = true; messages = []
  await click('确认恢复')
  expect(writes()).toHaveLength(1)
  expect(host.textContent).toContain('已恢复')
  expect(host.querySelectorAll('li')).toHaveLength(1)
})
it('cancels account-scoped recovery and drops late success after logout', async () => {
  const original = vi.mocked(callArkme).getMockImplementation()!
  let finish!: (value: unknown) => void
  vi.mocked(callArkme).mockImplementation((op, input, signal) => op === 'arko.lifecycle.change' ? new Promise(resolve => { finish = resolve }) as never : original(op, input, signal))
  await open(); await select('已删除的问题'); await click('确认恢复')
  await click('正在恢复…'); expect(writes()).toHaveLength(1)
  const signal = writes()[0]![2]!
  await act(async () => arkmeAuthStore.setAuth({ status: 'logged_out', environment: 'test' } as never))
  expect(signal.aborted).toBe(true)
  await act(async () => finish({ items: [{ ...message(), state: 'active', version: 2, result: 'applied' }] }))
  expect(host.textContent).not.toContain('已恢复')
  expect(host.querySelectorAll('li')).toHaveLength(0)
})
it('uses existing partial-read messaging when one source fails, preserving the other source', async () => {
  const original = vi.mocked(callArkme).getMockImplementation()!
  vi.mocked(callArkme).mockImplementation((op, input, signal) => op === 'data.deleted' ? Promise.reject(Error('offline')) : original(op, input, signal))
  await open()
  expect(host.querySelectorAll('li')).toHaveLength(1)
  expect(host.textContent).toContain('已删除的问题')
  expect(host.textContent).toContain('部分记录状态无法确认')
  expect(host.textContent).not.toContain('暂无最近删除')
})
it('removes expired content and its pending confirmation without polling or hiding Record rows', async () => {
  vi.useFakeTimers()
  await open(); await select('已删除的问题')
  const readCount = vi.mocked(callArkme).mock.calls.length
  await act(async () => { await vi.advanceTimersByTimeAsync(5001) })
  expect(host.textContent).not.toContain('已删除的问题')
  expect(host.textContent).toContain('保留的快记')
  expect(host.querySelector('[aria-label="确认恢复记录"]')).toBeNull()
  expect(vi.mocked(callArkme).mock.calls).toHaveLength(readCount)
  expect(writes()).toHaveLength(0)
})
it('clears stale confirmation after cross-device restoration using the existing invalidation', async () => {
  await open(); await select('已删除的问题')
  messages = []
  await act(async () => arkoLifecycleSync.invalidate())
  expect(host.textContent).not.toContain('已删除的问题')
  expect(host.querySelector('[aria-label="确认恢复记录"]')).toBeNull()
  expect(writes()).toHaveLength(0)
})
