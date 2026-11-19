// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
import { RecordingFavoriteAction } from '../src/client/RecordingFavoriteAction.js'
import { RecordingFavorites } from '../src/client/RecordingFavorites.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { favoriteChanges } from '../src/client/recording-favorite-client.js'
const favorite = { accountKey: 'test:42', favoriteRef: 'favorite', audience: 'collector', saved: true, available: true, version: 3, createdAtMillis: 1000, savedAtMillis: 1000, readAtMillis: 0, recordingStartedAtMillis: 1000, segmentCount: 1, durationMillis: 2000, preview: '已收藏的原文', sharer: { name: '分享者' } }
const detail = { ...favorite, segments: [{ speakerName: '说话人', textContent: '已收藏的原文', startMillis: 0, endMillis: 2000, occurredAtMillis: 1000 }], canRevoke: false }
let root: Root, container: HTMLDivElement
const click = async (text: string) => { const button = [...document.querySelectorAll('button')].find(button => button.textContent === text); expect(button).toBeDefined(); await act(async () => (button as HTMLButtonElement).click()) }
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); mocks.call.mockReset(); arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 }) })
afterEach(async () => { await act(async () => { root.unmount() }); container.remove(); vi.unstubAllGlobals() })
it('saves with observed version, displays monochrome saved state, and reads back a conflict without replaying', async () => {
  let version = 0, saved = false, fail = false
  mocks.call.mockImplementation(async (_operation, input) => {
    if (input.action === 'status') return { ...favorite, saved, version }
    if (input.action === 'save') { expect(input.expectedVersion).toBe(version); version++; saved = true; return { ...detail, version } }
    if (input.action === 'remove') { if (fail) { saved = false; version++; throw new Error('收藏状态已变化') }; return {} }
  })
  await act(async () => root.render(<RecordingFavoriteAction sid="AbCdEf0123456789" />))
  await click('收藏录音')
  expect(container.textContent).toContain('已保存到「我收藏的录音」')
  expect(container.querySelector('button')?.getAttribute('aria-pressed')).toBe('true')
  fail = true
  await click('已收藏'); await click('取消收藏')
  expect(mocks.call.mock.calls.filter(([, input]) => input.action === 'remove')).toHaveLength(1)
  expect(container.textContent).toContain('收藏状态已变化')
  expect(container.querySelector('button')?.getAttribute('aria-pressed')).toBe('false')
})
it('shows list and authorized detail while preserving list state on return; blocks collector source/revoke', async () => {
  mocks.call.mockImplementation(async (_operation, input) => input.action === 'page' ? { accountKey: 'test:42', items: [favorite], readThrough: 'anchor' } : detail)
  await act(async () => root.render(<RecordingFavorites accountKey="test:42" mediaPath="/media" />))
  expect(container.querySelectorAll('.arkme-favorite-row')).toHaveLength(1)
  expect(container.querySelector('nav')).toBeNull()
  expect(container.querySelector('.arkme-favorites-more')).toBeNull()
  await act(async () => (container.querySelector('.arkme-favorite-row') as HTMLButtonElement).click())
  expect(container.textContent).toContain('已收藏的原文')
  expect(container.textContent).not.toContain('查看原录音'); expect(container.textContent).not.toContain('撤销授权')
  await act(async () => (container.querySelector('[aria-label="返回"]') as HTMLButtonElement).click())
  expect(container.querySelectorAll('.arkme-favorite-row')).toHaveLength(1)
  expect(mocks.call.mock.calls.filter(([, input]) => input.action === 'page')).toHaveLength(1)
})
it('appends pages once, retains rows on failure, and restores the loaded list and scroll after detail', async () => {
  const observers: { trigger(): void; disconnect: ReturnType<typeof vi.fn> }[] = []
  vi.stubGlobal('IntersectionObserver', class {
    disconnect = vi.fn()
    constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
      if (options.rootMargin === '240px 0px') observers.push({ trigger: () => callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver), disconnect: this.disconnect })
    }
    observe() {}
  })
  let resolve!: (value: unknown) => void, fail = true
  mocks.call.mockImplementation(async (_operation, input) => {
    if (input.action === 'detail') return detail
    if (!input.cursor) return { accountKey: 'test:42', items: [favorite], nextCursor: 'next', readThrough: 'anchor' }
    if (fail) { fail = false; throw new Error('暂时无法连接') }
    return new Promise(done => { resolve = done })
  })
  await act(async () => root.render(<RecordingFavorites accountKey="test:42" mediaPath="/media" />))
  await act(async () => observers.at(-1)!.trigger())
  expect(container.querySelectorAll('.arkme-favorite-row')).toHaveLength(1)
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('暂时无法连接')
  expect(observers.at(-1)!.disconnect).toHaveBeenCalled()
  await click('重试')
  await act(async () => { observers.at(-1)!.trigger(); observers.at(-1)!.trigger() })
  expect(mocks.call.mock.calls.filter(([, input]) => input.cursor === 'next')).toHaveLength(2)
  await act(async () => resolve({ accountKey: 'test:42', items: [favorite, { ...favorite, favoriteRef: 'second' }], readThrough: 'anchor' }))
  expect(container.querySelectorAll('.arkme-favorite-row')).toHaveLength(2)
  expect(container.querySelector('.arkme-favorites-more')).toBeNull()
  const scroll = container.querySelector('.arkme-favorites-scroll') as HTMLDivElement
  scroll.scrollTop = 400
  await act(async () => (container.querySelector('.arkme-favorite-row') as HTMLButtonElement).click())
  await act(async () => (container.querySelector('[aria-label="返回"]') as HTMLButtonElement).click())
  expect(container.querySelectorAll('.arkme-favorite-row')).toHaveLength(2)
  expect(scroll.scrollTop).toBe(400)
  expect(mocks.call.mock.calls.filter(([, input]) => input.action === 'page')).toHaveLength(3)
})
it('ignores a stale continuation after a favorite change resets the list', async () => {
  let resolve!: (value: unknown) => void, signal: AbortSignal | undefined, changed = false
  mocks.call.mockImplementation(async (_operation, input, requestSignal) => {
    if (input.cursor) { signal = requestSignal; return new Promise(done => { resolve = done }) }
    return { accountKey: 'test:42', items: changed ? [] : [favorite], ...(changed ? {} : { nextCursor: 'next' }), readThrough: 'anchor' }
  })
  await act(async () => root.render(<RecordingFavorites accountKey="test:42" mediaPath="/media" />))
  await click('加载更多')
  changed = true
  await act(async () => favoriteChanges.publish('test:42'))
  expect(signal?.aborted).toBe(true)
  await act(async () => resolve({ accountKey: 'test:42', items: [favorite], readThrough: 'anchor' }))
  expect(container.querySelectorAll('.arkme-favorite-row')).toHaveLength(0)
  expect(container.textContent).toContain('还没有收藏的录音')
})
it('windows large loaded lists and cancels a continuation on unmount', async () => {
  let signal: AbortSignal | undefined
  mocks.call.mockImplementation(async (_operation, input, requestSignal) => {
    if (input.cursor) { signal = requestSignal; return new Promise(() => {}) }
    return { accountKey: 'test:42', items: Array.from({ length: 300 }, (_, index) => ({ ...favorite, favoriteRef: String(index) })), nextCursor: 'next', readThrough: 'anchor' }
  })
  await act(async () => root.render(<RecordingFavorites accountKey="test:42" mediaPath="/media" />))
  expect(container.querySelectorAll('.arkme-favorite-row').length).toBeLessThanOrEqual(200)
  await click('加载更多')
  await act(async () => root.render(null))
  expect(signal?.aborted).toBe(true)
})
it('suppresses late status after an account switch', async () => {
  let resolve!: (value: unknown) => void
  mocks.call.mockImplementationOnce(() => new Promise(done => { resolve = done })).mockResolvedValue({ ...favorite, accountKey: 'test:43', saved: false })
  await act(async () => root.render(<RecordingFavoriteAction sid="AbCdEf0123456789" />))
  await act(async () => arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 43 }))
  await act(async () => resolve(favorite))
  expect(container.querySelector('button')?.getAttribute('aria-pressed')).toBe('false')
})

it('requires confirmation for sharer revocation and then hides unavailable content', async () => {
  let revoked = false
  mocks.call.mockImplementation(async (_operation, input) => {
    if (input.action === 'revoke') { revoked = true; return {} }
    return { ...detail, audience: 'sharer', saved: false, canRevoke: !revoked, available: !revoked, segments: revoked ? [] : detail.segments }
  })
  await act(async () => root.render(<RecordingFavorites accountKey="test:42" mediaPath="/media" initialRef="favorite" fromNotifications />))
  await click('撤销授权')
  expect(revoked).toBe(false)
  await act(async () => { const buttons = [...document.querySelectorAll('[role="dialog"] button')]; (buttons.find(button => button.textContent === '撤销授权') as HTMLButtonElement).click() })
  expect(revoked).toBe(true); expect(container.textContent).toContain('该录音已不可访问'); expect(container.textContent).not.toContain('已收藏的原文')
  expect(mocks.call.mock.calls.filter(([, input]) => input.action === 'revoke')).toHaveLength(1)
})
