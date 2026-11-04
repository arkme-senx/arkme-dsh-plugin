// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ read: vi.fn(), retry: vi.fn(), listeners: new Set<() => void>(), snapshot: { auth: { status: 'authenticated', environment: 'test', userId: 11 } } }))
vi.mock('../src/sdk/index.js', () => ({ createArkmeSdk: () => ({ sourceMessageThoughtContinuations: mocks.read, retrySourceMessageThoughtContinuation: mocks.retry }) }))
vi.mock('../src/client/auth-store.js', () => ({ arkmeAuthStore: { subscribe: (fn: () => void) => { mocks.listeners.add(fn); return () => mocks.listeners.delete(fn) }, getSnapshot: () => mocks.snapshot } }))
import { useThoughtContinuations } from '../src/client/thought-continuations.js'
const item = { id: 'a'.repeat(64), recordUid: 'root', replyRecordUid: 'human', status: 'generating', content: '', canRetry: false }
function page(status = 'generating', scope = 'test:11') { return { accountScope: scope, supported: true, items: [{ ...item, status, content: status === 'ready' ? 'answer' : '' }] } }
let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers()
  mocks.read.mockReset().mockResolvedValue(page()); mocks.retry.mockReset().mockResolvedValue(page())
  mocks.snapshot = { auth: { status: 'authenticated', environment: 'test', userId: 11 } }
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function App({ source = 'source', tasks = [] }: { source?: string; tasks?: unknown[] }) {
  const state = useThoughtContinuations(source, 'signed-action', tasks as never)
  return <div data-pending={state.pendingReplyRecordUids.join(',')}>{state.items.map(row => <p key={row.id}>{row.status}:{row.content}</p>)}{state.error}<button onClick={() => state.retry(item.id)}>retry</button></div>
}
it('polls one mounted detail, stops on ready and cancels everything on unmount', async () => {
  await act(async () => root.render(<App/>))
  expect(mocks.read).toHaveBeenCalledOnce(); const signal = mocks.read.mock.calls[0]![2].signal as AbortSignal
  mocks.read.mockResolvedValue(page('ready'))
  await act(async () => vi.advanceTimersByTimeAsync(3000))
  expect(host.textContent).toContain('answer')
  await act(async () => vi.advanceTimersByTimeAsync(30000))
  expect(mocks.read).toHaveBeenCalledTimes(2)
  await act(async () => root.unmount())
  expect(signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0)
  root = createRoot(host)
})
it('suspends reads when hidden and resumes once on focus without parallel requests', async () => {
  await act(async () => root.render(<App/>))
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  await act(async () => vi.advanceTimersByTimeAsync(30000))
  expect(mocks.read).toHaveBeenCalledOnce()
  let resolve!: (value: unknown) => void
  mocks.read.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  await act(async () => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus')) })
  expect(mocks.read).toHaveBeenCalledTimes(2)
  await act(async () => resolve(page('ready')))
})
it('drops stale replies and aborts reads when the account changes', async () => {
  let resolve!: (value: unknown) => void
  mocks.read.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  await act(async () => root.render(<App/>)); const signal = mocks.read.mock.calls[0]![2].signal as AbortSignal
  mocks.read.mockResolvedValue({ accountScope: 'test:12', supported: true, items: [] })
  await act(async () => { mocks.snapshot = { auth: { status: 'authenticated', environment: 'test', userId: 12 } }; for (const fn of mocks.listeners) fn() })
  expect(signal.aborted).toBe(true)
  await act(async () => resolve(page('ready')))
  expect(host.textContent).not.toContain('answer')
})
it('keeps tracking an accepted send after its local receipt leaves the journal', async () => {
  mocks.read.mockResolvedValue({ accountScope: 'test:11', supported: true, items: [] })
  await act(async () => root.render(<App tasks={[{ recordUid: 'human', thoughtReplyRef: 'signed-ai', state: 'sent' }]}/>))
  await act(async () => root.render(<App tasks={[]}/>))
  expect(host.firstElementChild?.getAttribute('data-pending')).toBe('human')
  const before = mocks.read.mock.calls.length
  mocks.read.mockResolvedValue(page('ready'))
  await act(async () => vi.advanceTimersByTimeAsync(3000))
  expect(mocks.read.mock.calls.length).toBe(before + 1); expect(host.textContent).toContain('answer')
  expect(host.firstElementChild?.getAttribute('data-pending')).toBe('')
})
it('preserves ready replies while a new human send revalidates the same detail', async () => {
  mocks.read.mockResolvedValue(page('ready'))
  await act(async () => root.render(<App/>))
  expect(host.textContent).toContain('answer')
  let resolve!: (value: unknown) => void
  mocks.read.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  await act(async () => root.render(<App tasks={[{ recordUid: 'next-human', thoughtReplyRef: 'signed-ai', state: 'pending' }]}/>))
  expect(host.textContent).toContain('answer')
  await act(async () => resolve(page('ready')))
  expect(host.textContent).toContain('answer')
})

it('retains the same visible reply nodes across a transient poll failure and recovery', async () => {
  await act(async () => root.render(<App/>))
  const row = host.querySelector('p')
  mocks.read.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await act(async () => vi.advanceTimersByTimeAsync(3000))
  expect(host.querySelector('p')).toBe(row)
  expect(host.textContent).toContain('generating')
  expect(host.textContent).toContain('Failed to fetch')
  mocks.read.mockResolvedValue(page('ready'))
  await act(async () => vi.advanceTimersByTimeAsync(3000))
  expect(host.querySelector('p')).toBe(row)
  expect(host.textContent).toContain('answer')
  expect(host.textContent).not.toContain('Failed to fetch')
  expect(mocks.read).toHaveBeenCalledTimes(3)
})

it('keeps existing replies on a transient retry read failure', async () => {
  mocks.read.mockResolvedValue(page('failed'))
  await act(async () => root.render(<App/>))
  const row = host.querySelector('p')
  mocks.retry.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await act(async () => host.querySelector('button')!.click())
  expect(host.querySelector('p')).toBe(row)
  expect(host.textContent).toContain('failed')
})

it('drops retained replies when the current owner denies access', async () => {
  await act(async () => root.render(<App/>))
  mocks.read.mockRejectedValueOnce(Object.assign(new Error('Access denied'), { body: { code: 'record-detail-unavailable', retryable: false } }))
  await act(async () => vi.advanceTimersByTimeAsync(3000))
  expect(host.querySelector('p')).toBeNull()
  expect(host.textContent).toContain('Access denied')
})

it('recognizes the public SDK unsupported error envelope', async () => {
  await act(async () => root.render(<App/>))
  mocks.read.mockRejectedValueOnce(Object.assign(new Error('Unsupported'), { body: { code: 'CAPABILITY_UNSUPPORTED', retryable: false } }))
  await act(async () => vi.advanceTimersByTimeAsync(3000))
  expect(host.querySelector('p')).toBeNull()
  await act(async () => vi.advanceTimersByTimeAsync(30000))
  expect(mocks.read).toHaveBeenCalledTimes(2)
})
