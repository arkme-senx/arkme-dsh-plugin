// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeArkoSurface } from '../src/client/ArkmeArkoSurface.js'
import { TeamConversationPane } from '../src/client/TeamMessagingPanel.js'
import { callArkme } from '../src/client/api.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkoModelCache } from '../src/client/arko-model-cache.js'
import { arkmeArkoProfileStore } from '../src/client/arko-profile-store.js'
import { installArkoPendingHostMock } from './helpers/arko-pending-host.js'
import type { ArkmeArkoHistoryItem } from '../src/types.js'
import type { TeamConversation, TeamMessage } from '../src/team-app-contract.js'

vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: vi.fn() }))
// Exercise the actual surface return path; history panel filtering has its own tests.
vi.mock('../src/client/ArkmeArkoHistoryTools.js', () => ({ ArkmeArkoHistoryTools: ({ onLocate }: any) => <button onClick={() => onLocate({ items: [arkoItem(1)], hasBefore: false, hasAfter: false }, arkoItem(1))}>定位 Arko 历史</button> }))
vi.mock('../src/client/TeamConversationTools.js', () => ({ TeamConversationTools: ({ onLocate }: any) => <button onClick={() => { void onLocate(teamMessage(1), new AbortController().signal) }}>定位团队历史</button> }))
const conversation: TeamConversation = { ref: 'conv', key: 'bottom-test', channel: { teamRef: 'team', name: '团队', jotmoId: 'team', publicRef: 'a'.repeat(32), link: '', enabled: true, revision: 1, canManage: false }, side: 'external', lastSeq: 100, latestTeamReplySeq: 100, myReadSeq: 100, unread: 0, needsReply: false, blocked: false, revision: 1, updatedAt: 1 }
function arkoItem(id: number): ArkmeArkoHistoryItem { return { messageId: id, sessionId: 88, role: 'assistant', text: `消息 ${id}`, reasoning: '', createdAtMillis: 1786000000000 + id * 1000, status: 2, createdRecordUids: [] } }
function teamMessage(seq: number): TeamMessage { return { key: `m${seq}`, ref: `ref${seq}`, seq, revision: 1, side: 'team', sender: { nickname: '成员' }, own: false, state: 'published', createdAt: seq, canEdit: false, canDelete: false, version: 1, contentStatus: 'available', content: { text_content: `消息 ${seq}`, template_kind: 1 }, media: [] } }
const arkoItems = Array.from({ length: 6 }, (_, i) => arkoItem(i + 10))
const teamItems = Array.from({ length: 6 }, (_, i) => teamMessage(i + 90))
let host: HTMLDivElement, root: Root
let frames: FrameRequestCallback[], resize: Array<{ callback: ResizeObserverCallback; targets: Element[] }>, intersections: Array<{ callback: IntersectionObserverCallback; targets: Element[] }>
let growth = 0
const viewSelector = '[data-arko-message-viewport],.team-message-list'
const isView = (node: Element) => node.matches(viewSelector)
const view = () => host.querySelector<HTMLDivElement>(viewSelector)!
const rows = (body: Element) => [...body.querySelectorAll<HTMLElement>('[data-arkme-conversation-row]')]
const click = async (node: Element) => { await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
const scroll = async (top: number) => { await act(async () => { view().scrollTop = top; view().dispatchEvent(new Event('scroll', { bubbles: true })) }) }
const flushFrames = async () => { await act(async () => { const pending = frames.splice(0); for (const frame of pending) frame(performance.now()) }) }
async function mount(kind: 'arko' | 'team') {
  await act(async () => { root.render(kind === 'arko' ? <ArkmeArkoSurface /> : <TeamConversationPane conversation={conversation} accountKey="test:10001" onChanged={() => {}} />) })
  await flushFrames()
}
async function loadEarlier() {
  await scroll(100)
  await act(async () => { for (const observer of intersections) if (observer.targets.some(t => t.parentElement === view())) observer.callback([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver) })
}
async function resized() {
  await act(async () => { for (const observer of resize) observer.callback([], {} as ResizeObserver) })
}
beforeEach(() => {
  frames = []; resize = []; intersections = []; growth = 0
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('ResizeObserver', class { entry: typeof resize[number]; constructor(callback: ResizeObserverCallback) { this.entry = { callback, targets: [] }; resize.push(this.entry) } observe(target: Element) { this.entry.targets.push(target) } disconnect() { this.entry.targets = [] } })
  vi.stubGlobal('IntersectionObserver', class { entry: typeof intersections[number]; constructor(callback: IntersectionObserverCallback) { this.entry = { callback, targets: [] }; intersections.push(this.entry) } observe(target: Element) { this.entry.targets.push(target) } disconnect() { this.entry.targets = [] } })
  const tops = new WeakMap<Element, number>()
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) { return isView(this) ? 400 : 0 })
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function (this: Element) { return isView(this) ? rows(this).length * 200 + growth : 0 })
  vi.spyOn(Element.prototype, 'scrollTop', 'get').mockImplementation(function (this: Element) { return tops.get(this) ?? 0 })
  vi.spyOn(Element.prototype, 'scrollTop', 'set').mockImplementation(function (this: Element, value: number) { tops.set(this, isView(this) ? Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)) : value) })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const body = this.closest(viewSelector)
    if (isView(this)) return new DOMRect(0, 0, 600, 400)
    if (body && this.hasAttribute('data-arkme-conversation-row')) return new DOMRect(0, rows(body).indexOf(this as HTMLElement) * 200 - body.scrollTop, 600, 200)
    return new DOMRect()
  })
  localStorage.clear(); arkoModelCache.clear(); arkmeArkoProfileStore.activateUser(undefined)
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 10001 })
  vi.mocked(callArkme).mockImplementation(async (method, params: any) => {
    if (method === 'arko.session') return { sessionId: 88 } as never
    if (method === 'arko.messages') return { items: arkoItems, nextCursor: 'older' } as never
    if (method === 'arko.models') return { options: [] } as never
    if (method === 'arko.profile') return { displayName: 'Arko', version: 2 } as never
    if (method === 'user.profile') return { profile: {} } as never
    if (method === 'team.app.timeline') return { conversation, messages: params?.beforeSeq ? [teamMessage(1)] : teamItems, hasMore: false, beforeSeq: 0 } as never
    return [] as never
  })
  installArkoPendingHostMock(vi.mocked(callArkme))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); arkmeArkoProfileStore.activateUser(undefined); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks() })

it.each(['arko', 'team'] as const)('%s shows the shared bottom-right control on scroll-up and hides it at latest', async kind => {
  await mount(kind)
  expect(view().scrollTop).toBe(800)
  expect(button('回到底部')).toBeNull()
  await scroll(200)
  expect(button('回到底部')?.closest('[data-arkme-bottom-controls]')).not.toBeNull()
  const reads = vi.mocked(callArkme).mock.calls.length
  await click(button('回到底部')!); await flushFrames()
  expect(view().scrollTop).toBe(800)
  expect(button('回到底部')).toBeNull()
  expect(vi.mocked(callArkme).mock.calls).toHaveLength(reads)
})
it('Arko preserves the currently visible message when a delayed older page arrives after more scrolling', async () => {
  await mount('arko')
  let finish!: (value: unknown) => void
  vi.mocked(callArkme).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }) as never)
  await loadEarlier(); await scroll(400)
  await act(async () => { finish({ items: [1, 2, 3, 4].map(arkoItem) }) })
  await flushFrames()
  expect(view().scrollTop).toBe(1200)
  expect(rows(view()).find(row => row.getBoundingClientRect().top === 0)?.textContent).toContain('消息 12')
})
it('Arko stays latest when the reader returns during an older request, including later image growth', async () => {
  await mount('arko')
  let finish!: (value: unknown) => void
  vi.mocked(callArkme).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }) as never)
  await loadEarlier(); await click(button('回到底部')!); await flushFrames()
  await act(async () => { finish({ items: [1, 2, 3, 4].map(arkoItem) }) }); await flushFrames()
  expect(view().scrollTop).toBe(1600)
  growth = 300; await resized()
  expect(view().scrollTop).toBe(1900)
  await scroll(900); growth = 500; await resized()
  expect(view().scrollTop).toBe(900)
})
it.each(['arko', 'team'] as const)('%s returns from historical lookup using a fresh latest page', async kind => {
  await mount(kind)
  await click([...host.querySelectorAll('button')].find(node => node.textContent === (kind === 'arko' ? '定位 Arko 历史' : '定位团队历史'))!)
  expect(button('回到最新')).not.toBeNull()
  expect(view().textContent).toContain('消息 1')
  const reads = vi.mocked(callArkme).mock.calls.filter(([method]) => method === (kind === 'arko' ? 'arko.messages' : 'team.app.timeline')).length
  await click(button('回到最新')!)
  // Explicit return must commit at the latest edge before any animation frame.
  expect(view().scrollTop).toBe(800)
  await act(async () => { view().dispatchEvent(new Event('scroll', { bubbles: true })) })
  await flushFrames()
  expect(vi.mocked(callArkme).mock.calls.filter(([method]) => method === (kind === 'arko' ? 'arko.messages' : 'team.app.timeline'))).toHaveLength(reads + 1)
  expect(view().scrollTop).toBe(800)
  expect(button('回到最新')).toBeNull()
})
it.each(['arko', 'team'] as const)('%s keeps historical content and allows retry when return-to-latest fails', async kind => {
  await mount(kind)
  await click([...host.querySelectorAll('button')].find(node => node.textContent === (kind === 'arko' ? '定位 Arko 历史' : '定位团队历史'))!)
  vi.mocked(callArkme).mockRejectedValueOnce(new Error('offline'))
  await click(button('回到最新')!)
  expect(view().textContent).toContain('消息 1')
  expect(host.textContent).toContain('暂时无法回到最新，请重试')
  await click(button('回到最新')!); await flushFrames()
  expect(view().scrollTop).toBe(800)
  expect(button('回到最新')).toBeNull()
})
