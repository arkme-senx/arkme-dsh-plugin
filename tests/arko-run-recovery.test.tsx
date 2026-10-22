// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeArkoSurface } from '../src/client/ArkmeArkoSurface.js'
import { readLatestArkoMessages } from '../src/client/arko-history-browser.js'
import { callArkme } from '../src/client/api.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeArkoProfileStore } from '../src/client/arko-profile-store.js'
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: vi.fn() }))
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  arkmeArkoProfileStore.activateUser(undefined)
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 10001 })
})
afterEach(() => { arkmeArkoProfileStore.activateUser(undefined); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks() })
const running = (sessionId: number) => ({ messageId: 9, sessionId, role: 'assistant', text: '正在生成的实际回答', reasoning: '', status: 2, runUid: 'current-run', runStatus: 'running', createdAtMillis: 1000, createdRecordUids: [] })

it.each([{ hiddenPages: 0, sessionId: 88 }, { hiddenPages: 2, sessionId: 88 }, { hiddenPages: 2, sessionId: 77 }])('restores current Run after candidate continuation: %j', async ({ hiddenPages, sessionId }) => {
  let read = 0
  vi.mocked(callArkme).mockImplementation(async (method, input) => {
    if (method === 'arko.session') return { sessionId: 88 } as never
    if (method === 'arko.profile') return { displayName: 'Arko', version: 1 } as never
    if (method === 'user.profile') return { profile: {} } as never
    if (method === 'arko.models') return { options: [] } as never
    if (method === 'arko.messages') {
      read++
      return (read <= hiddenPages
        ? { items: [], hasMore: true, nextCursor: `hidden-${read}`, scanned: 500, consistency: 'live' }
        : { items: [running(sessionId)], hasMore: false, scanned: 1, consistency: 'live' }) as never
    }
    if (method === 'arko.run.status') return new Promise(() => {}) as never
    if (method === 'arko.cancel') return { status: 'cancelled' } as never
    throw new Error(`unexpected ${method} ${String(input)}`)
  })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<ArkmeArkoSurface />))
    expect(read).toBe(hiddenPages + 1)
    expect(host.textContent).toContain('正在生成的实际回答')
    await act(async () => { await vi.advanceTimersByTimeAsync(1300) })
    const current = sessionId === 88
    expect(vi.mocked(callArkme).mock.calls.some(([method]) => method === 'arko.run.status')).toBe(current)
    const stop = host.querySelector<HTMLButtonElement>('[aria-label="停止当前 Arko 任务"]')
    expect(stop !== null).toBe(current)
    if (current) {
      await act(async () => stop!.click())
      expect(callArkme).toHaveBeenCalledWith('arko.cancel', { sessionId: 88, assistantMsgId: 9, runUid: 'current-run' })
    }
    expect(vi.mocked(callArkme).mock.calls.some(([method]) => method === 'arko.ask')).toBe(false)
  } finally { await act(async () => root.unmount()); host.remove() }
})

it('returns the continuation after the first visible page without scanning old history for a Run', async () => {
  vi.mocked(callArkme).mockResolvedValue({ items: [running(77)], hasMore: true, nextCursor: 'older', scanned: 1, consistency: 'live' } as never)
  const result = await readLatestArkoMessages(new AbortController().signal)
  expect(result.nextCursor).toBe('older')
  expect(callArkme).toHaveBeenCalledOnce()
})
it('rejects repeated cursors instead of silently treating an incomplete scan as latest history', async () => {
  vi.mocked(callArkme).mockResolvedValue({ items: [], hasMore: true, nextCursor: 'same', scanned: 500, consistency: 'live' } as never)
  await expect(readLatestArkoMessages(new AbortController().signal)).rejects.toThrow('分页未能继续')
  expect(callArkme).toHaveBeenCalledTimes(2)
})
it('does not continue or restore a late candidate page after cancellation/account teardown', async () => {
  const controller = new AbortController()
  vi.mocked(callArkme).mockImplementation(async () => { controller.abort(); return { items: [running(88)], hasMore: false } as never })
  await expect(readLatestArkoMessages(controller.signal)).rejects.toThrow()
  expect(callArkme).toHaveBeenCalledOnce()
})
it('bounds an all-hidden scan and preserves failures for the existing retry UI', async () => {
  let cursor = 0
  vi.mocked(callArkme).mockImplementation(async () => ({ items: [], hasMore: true, nextCursor: `next-${++cursor}` }) as never)
  await expect(readLatestArkoMessages(new AbortController().signal)).rejects.toThrow('读取预算')
  expect(callArkme).toHaveBeenCalledTimes(1000)
  vi.mocked(callArkme).mockRejectedValueOnce(new Error('temporary failure'))
  await expect(readLatestArkoMessages(new AbortController().signal)).rejects.toThrow('temporary failure')
})
