// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ArkmeCommonGroupPage } from '../src/common-groups.js'
import type { ArkmeSourceItem } from '../src/types.js'
const api = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({ callArkme: api }))
vi.mock('../src/client/ArkmeAvatar.js', () => ({ ArkmeDirectorySourceAvatar: () => <span /> }))
import { ArkmeCommonGroupsPanel } from '../src/client/ArkmeCommonGroupsPanel.js'
const source = { kind: 'private_chat', sourceRef: 'private', displayName: '张三' } as ArkmeSourceItem
const page = (start = 1, n = 20): ArkmeCommonGroupPage => ({
  items: Array.from({ length: n }, (_, i) => ({ source: { kind: 'group_chat', sourceRef: `group-${i+start}`, displayName: `群${i+start}` } as ArkmeSourceItem, memberCount: 2 })),
  totalCached: 21, hasMore: start === 1, ...(start === 1 ? { nextCursor: 'group-20' } : {}), syncedAtMillis: 1, revision: 1, syncHasMore: false,
})
const observers: Array<{ callback: IntersectionObserverCallback; target?: Element; disconnected: boolean }> = []
async function scrollBottom() {
  await act(async () => {
    for (const observer of [...observers]) if (!observer.disconnected && observer.target?.hasAttribute('data-arkme-common-groups-more')) {
      observer.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    }
  })
}
let host: HTMLDivElement, root: Root, trigger: HTMLButtonElement
beforeEach(() => {
  observers.length = 0
  vi.stubGlobal('IntersectionObserver', class {
    entry: typeof observers[number]
    constructor(callback: IntersectionObserverCallback) { this.entry = { callback, disconnected: false }; observers.push(this.entry) }
    observe(target: Element) { this.entry.target = target }
    disconnect() { this.entry.disconnected = true }
  })
  api.mockReset(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); trigger = document.createElement('button')
  document.body.append(host, trigger); trigger.focus(); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); trigger.remove(); vi.unstubAllGlobals() })
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text)!
async function mount(onOpen = vi.fn()) {
  const ref = createRef<HTMLButtonElement>(); ref.current = trigger
  await act(async () => root.render(<ArkmeCommonGroupsPanel source={source} onClose={() => root.render(null)} onOpen={onOpen} returnFocusRef={ref} />))
}
it('renders local data before sync, reuses the overlay, and cancels on Escape with focus return', async () => {
  let signal: AbortSignal | undefined
  api.mockImplementation(async (operation: string, _params: unknown, s: AbortSignal) => {
    if (operation.endsWith('.list')) return page()
    signal = s; return await new Promise(() => {})
  })
  await mount()
  expect(api.mock.calls.map(c => c[0])).toEqual(['group.common.list', 'group.common.sync'])
  expect(host.textContent).toContain('群1')
  expect(host.textContent).not.toMatch(/上次同步|本地已缓存|上一页|下一页|正在同步|你和张三都在的群聊/)
  expect(host.textContent).not.toContain('2 人')
  expect(host.querySelector('[aria-selected]')).toBeNull()
  expect(host.querySelector('footer')).toBeNull()
  expect(host.querySelectorAll('button').length).toBeLessThan(27)
  expect(host.querySelector<HTMLElement>('[data-arkme-note-detail]')?.style.position).toBe('absolute')
  expect(host.querySelector('[aria-label="调整共同群聊宽度"]')).not.toBeNull()
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })))
  expect(signal?.aborted).toBe(true); expect(document.activeElement).toBe(trigger)
})
it('appends 20-row pages at the bottom, retaining offline content without another sync', async () => {
  api.mockImplementation(async (operation: string, params: { cursor?: string }) => {
    if (operation.endsWith('.sync')) throw Error('offline')
    return params.cursor ? page(21, 1) : page()
  })
  await mount()
  expect(host.querySelector('[role="alert"]')).not.toBeNull()
  const body = host.querySelector('[data-arkme-note-detail]')!.children[2] as HTMLElement
  body.scrollTop = 300
  await scrollBottom()
  expect(api.mock.calls.filter(c => c[0].endsWith('.list')).at(-1)?.[1].cursor).toBe('group-20')
  await act(async () => {
    for (const observer of observers) if (!observer.disconnected && observer.target?.hasAttribute('data-arkme-directory-chunk')) {
      vi.spyOn(observer.target, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
      observer.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    }
  })
  expect(host.textContent).toContain('群1')
  expect(host.textContent).toContain('群21')
  expect(body.scrollTop).toBe(300)
  const count = api.mock.calls.length
  await scrollBottom()
  expect(api.mock.calls).toHaveLength(count)
  expect(api.mock.calls.filter(c => c[0].endsWith('.sync'))).toHaveLength(1)
})
it('validates current access before opening and never joins a group', async () => {
  const opened = vi.fn(); let denied = true
  api.mockImplementation(async (operation: string) => {
    if (operation === 'group.settings') { if (denied) throw Error('membership removed'); return {} }
    if (operation === 'directory.group.open-chat') return page().items[0]!.source
    return page()
  })
  await mount(opened)
  const group = () => [...host.querySelectorAll('button')].find(b => b.textContent?.startsWith('群1'))!
  await act(async () => group().click())
  expect(opened).not.toHaveBeenCalled()
  expect(api.mock.calls.some(c => c[0] === 'directory.group.open-chat')).toBe(false)
  denied = false
  await act(async () => group().click())
  expect(opened).toHaveBeenCalledWith(page().items[0]!.source)
  expect(api.mock.calls.slice(-2).map(c => c[0])).toEqual(['group.settings', 'directory.group.open-chat'])
})
it('allows retry when the local read itself failed', async () => {
  api.mockRejectedValue(Error('storage failed'))
  await mount()
  expect(host.textContent).not.toContain('正在读取本地数据…')
  expect(button('重试').disabled).toBe(false)
  api.mockResolvedValue(page())
  await act(async () => button('重试').click())
  expect(host.textContent).toContain('群1'); expect(host.querySelector('[role="alert"]')).toBeNull()
})

it('coalesces repeated bottom events and disconnects observers on close', async () => {
  let resolve!: (value: ArkmeCommonGroupPage) => void
  let pageSignal: AbortSignal | undefined
  api.mockImplementation(async (operation: string, params: { cursor?: string }, signal: AbortSignal) => {
    if (params.cursor) { pageSignal = signal; return new Promise<ArkmeCommonGroupPage>(r => { resolve = r }) }
    return page()
  })
  await mount()
  await scrollBottom(); await scrollBottom()
  expect(api.mock.calls.filter(c => c[1]?.cursor)).toHaveLength(1)
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })))
  expect(pageSignal?.aborted).toBe(true)
  expect(observers.every(o => o.disconnected)).toBe(true)
  await act(async () => resolve(page(21, 1)))
  expect(host.textContent).toBe('')
})
it('stops automatic retries after a page failure and keeps the loaded rows', async () => {
  api.mockImplementation(async (_operation: string, params: { cursor?: string }) => {
    if (params.cursor) throw Error('page failed')
    return page()
  })
  await mount(); await scrollBottom()
  expect(host.textContent).toContain('群1')
  expect(button('重试')).toBeDefined()
  const count = api.mock.calls.length
  await scrollBottom()
  expect(api.mock.calls).toHaveLength(count)
})
it('refreshes the loaded prefix after sync removes a group', async () => {
  let finish!: (value: ArkmeCommonGroupPage) => void
  let updated = false
  api.mockImplementation(async (operation: string, params: { cursor?: string }) => {
    if (operation.endsWith('.sync')) return new Promise<ArkmeCommonGroupPage>(r => { finish = r })
    if (updated) return { ...page(2, 20), totalCached: 20, hasMore: false }
    return params.cursor ? page(21, 1) : page()
  })
  await mount(); await scrollBottom()
  updated = true
  await act(async () => finish({ ...page(), syncHasMore: false }))
  expect([...host.querySelectorAll('button')].some(b => b.textContent === '群1›')).toBe(false)
  expect(host.textContent).toContain('群2')
  expect(host.querySelector('footer')).toBeNull()
})

it('retries a failed page without clearing rows or duplicating them', async () => {
  let failed = true
  api.mockImplementation(async (_operation: string, params: { cursor?: string }) => {
    if (params.cursor) { if (failed) throw Error('offline'); return page(21, 1) }
    return page()
  })
  await mount(); await scrollBottom()
  failed = false
  await act(async () => button('重试').click())
  await scrollBottom()
  expect(host.querySelector('[role="alert"]')).toBeNull()
  expect(api.mock.calls.filter(c => c[1]?.cursor)).toHaveLength(2)
})
