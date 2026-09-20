// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { ArkmeCalendarRecordItem } from '../src/types.js'
const api = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: api.call, ArkmeClientError: class extends Error {} }))
import { arkmeUi } from '../src/client/ui-controller.js'
import { arkmeAvatarImages } from '../src/client/avatar-image-runtime.js'
import { ArkmeCalendarSurface } from '../src/client/ArkmeCalendarSurface.js'

let root: Root, host: HTMLDivElement
const record: ArkmeCalendarRecordItem = {
  recordUid: 'rich', sendAtMillis: Date.now(), accessState: 'available', title: '', textContent: '旧摘要', preview: '旧摘要',
  sourceKind: 'self', creationSource: 0, templateKind: 1, displayKind: 0, protected: false,
  content: { itemUid: 'rich', senderName: '我', isMe: true, status: 1, sendAtMillis: Date.now(), title: '',
    textFormat: 'markdown', textContent: '**完整正文** [链接](https://example.com)',
    contentBlocks: [{ kind: 'image', mediaRef: 'safe-image', fileName: '图片.png', sortOrder: 0 }] },
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  api.call.mockReset().mockImplementation(async (op: string) => {
    if (op === 'user.profile') return { profile: { avatarRef: '' } }
    if (op === 'calendar.buckets') return { days: [] }
    if (op === 'calendar.records') return { items: [record], hasMore: false }
    throw new Error(`unexpected operation ${op}`)
  })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const render = () => act(async () => { root.render(<ArkmeCalendarSurface />) })
const click = async (selector: string) => act(async () => { const node = host.querySelector<HTMLElement>(selector); expect(node).not.toBeNull(); node!.click() })
it('renders rich content, opens existing detail from body and returns focus without another data request', async () => {
  await render()
  expect(host.querySelector('strong')?.textContent).toBe('完整正文')
  expect(host.querySelector('img[src*="safe-image"]')).not.toBeNull()
  expect(host.textContent).not.toContain('旧摘要')
  const button = host.querySelector<HTMLElement>('[aria-label="打开快记详情"]')!
  button.focus()
  await click('strong')
  expect(host.querySelector('[role="dialog"][aria-label="快记详情"]')).not.toBeNull()
  expect(host.querySelector('[data-arkme-content-presentation="detail"] strong')?.textContent).toBe('完整正文')
  await click('[aria-label="关闭详情"]')
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(button)
  expect(api.call.mock.calls.map(([op]) => op).sort()).toEqual(['calendar.buckets', 'calendar.records', 'user.profile'])
})
it('leaves link clicks alone and closes the old record detail when selecting another date', async () => {
  await render()
  const link = host.querySelector('a')!
  link.addEventListener('click', e => e.preventDefault())
  await act(async () => link.click())
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  await click('[aria-label="打开快记详情"]')
  const dates = [...host.querySelectorAll<HTMLButtonElement>('button[data-selected="false"]')].filter(b => !b.disabled)
  await act(async () => dates[0]!.click())
  expect(host.querySelector('[aria-label="快记详情"]')).toBeNull()
})
it('opens an article through the calendar detail callback without a conversation source', async () => {
  api.call.mockImplementation(async (op: string) => op === 'user.profile' ? { profile: {} }
    : op === 'calendar.buckets' ? { days: [] }
      : { items: [{ ...record, content: { ...record.content, templateKind: 8, title: '长文标题' } }], hasMore: false })
  await render()
  const article = [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('长文标题'))!
  expect(article).toBeDefined()
  await act(async () => article.click())
  expect(host.querySelector('[aria-label="快记详情"]')).not.toBeNull()
  expect(host.querySelector('[data-arkme-content-presentation="detail"]')?.textContent).toContain('完整正文')
})

it('recovers a failed day read through the visible refresh control without claiming an empty day', async () => {
  let reads = 0
  api.call.mockImplementation(async (op: string) => {
    if (op === 'user.profile') return { profile: {} }
    if (op === 'calendar.buckets') return { days: [] }
    if (op === 'calendar.records') {
      if (++reads === 1) throw new Error('暂时不可用')
      return { items: [record], hasMore: false }
    }
    throw new Error(op)
  })
  await render()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('暂时不可用')
  expect(host.textContent).not.toContain('这一天还没有快记')
  await click('[aria-label="刷新当天快记"]')
  expect(host.querySelector('[role="alert"]')).toBeNull()
  expect(host.querySelector('strong')?.textContent).toBe('完整正文')
  expect(reads).toBe(2)
})

it('opens the card with the keyboard without a separate detail button', async () => {
  await render()
  expect(host.textContent).not.toContain('查看详情')
  const card = host.querySelector<HTMLElement>('[aria-label="打开快记详情"]')!
  await act(async () => card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(host.querySelector('[aria-label="快记详情"]')).not.toBeNull()
})

it('loads a page at the bottom once, stops at the last page and disposes the observer', async () => {
  let intersect!: IntersectionObserverCallback
  const disconnect = vi.fn()
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
      if (options.root === host.querySelector('[aria-label="当天快记列表"]')) intersect = callback
    }
    observe() {}
    disconnect = disconnect
  })
  let finish!: (page: unknown) => void
  api.call.mockImplementation(async (op: string, input: { cursor?: string }) => {
    if (op === 'user.profile') return { profile: {} }
    if (op === 'calendar.buckets') return { days: [] }
    if (input.cursor) return new Promise(resolve => { finish = resolve })
    return { items: [record], hasMore: true, nextCursor: 'page-2' }
  })
  await render()
  expect(host.textContent).not.toContain('加载更多')
  const callback = intersect
  await act(async () => {
    callback([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver)
    callback([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver)
  })
  expect(api.call.mock.calls.filter(([op]) => op === 'calendar.records')).toHaveLength(2)
  expect(host.textContent).toContain('加载中…')
  await act(async () => finish({ items: [{ ...record, recordUid: 'second' }], hasMore: true, nextCursor: 'page-3' }))
  expect(host.querySelectorAll('article')).toHaveLength(2)
  await act(async () => callback([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver))
  expect(api.call.mock.calls.filter(([op]) => op === 'calendar.records')).toHaveLength(2)
  // A rebuilt observer still seeing the sentinel must not drain all remaining pages.
  await act(async () => intersect([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver))
  expect(api.call.mock.calls.filter(([op]) => op === 'calendar.records')).toHaveLength(2)
  await act(async () => {
    intersect([{ isIntersecting: false }] as IntersectionObserverEntry[], {} as IntersectionObserver)
    intersect([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver)
  })
  expect(api.call.mock.calls.filter(([op]) => op === 'calendar.records')).toHaveLength(3)
  await act(async () => finish({ items: [{ ...record, recordUid: 'third' }], hasMore: false }))
  expect(host.querySelectorAll('article')).toHaveLength(3)
  expect(disconnect).toHaveBeenCalled()
})

it('shows the source topic badge below the content and omits it for uncategorized records', async () => {
  api.call.mockImplementation(async (op: string) => op === 'user.profile' ? { profile: {} }
    : op === 'calendar.buckets' ? { days: [] }
      : { items: [{ ...record, topicTitle: '我的项目' }, { ...record, recordUid: 'uncategorized' }], hasMore: false })
  await render()
  const badge = host.querySelector<HTMLElement>('[aria-label="来源：我的项目"]')!
  expect(badge).not.toBeNull()
  expect(host.querySelectorAll('[aria-label^="来源："]')).toHaveLength(1)
  expect((badge as HTMLButtonElement).disabled).toBe(true)
  await click('strong')
  expect(host.querySelector('[aria-label="快记详情"] [aria-label="来源：我的项目"]')).not.toBeNull()
})

it('centers the initial loading state inside the day list', async () => {
  api.call.mockImplementation(async (op: string) => op === 'user.profile' ? { profile: {} }
    : op === 'calendar.buckets' ? { days: [] } : new Promise(() => {}))
  await render()
  const loading = host.querySelector<HTMLElement>('[aria-label="当天快记列表"] [role="status"]')!
  expect(loading.textContent).toBe('正在加载…')
  expect(loading.style.justifyContent).toBe('center')
  expect(loading.style.alignItems).toBe('center')
  expect(loading.style.minHeight).toBe('100%')
})


it('renders chat source badges even when topicTitle is absent', async () => {
  api.call.mockImplementation(async (op: string) => op === 'user.profile' ? { profile: {} }
    : op === 'calendar.buckets' ? { days: [] }
      : { items: [{ ...record, sourceKind: 'chat', source: { kind: 'group_chat', displayName: '项目群', sourceRef: 'safe' } }], hasMore: false })
  await render()
  expect(host.querySelector('[aria-label="来源：项目群"]')).not.toBeNull()
})

it('shows DSH provenance without a link back to the hidden personal topic', async () => {
  api.call.mockImplementation(async (op: string) => op === 'user.profile' ? { profile: {} }
    : op === 'calendar.buckets' ? { days: [] }
      : { items: [{ ...record, creationSource: 3, topicTitle: 'DSH Agent Input',
        source: { kind: 'topic', displayName: '发给 DSH 的消息', sourceRef: 'system-topic' } }], hasMore: false })
  await render()
  expect(host.querySelector('[data-arkme-dsh-agent-input-marker]')).not.toBeNull()
  expect(host.querySelector('[aria-label^="来源："]')).toBeNull()
  expect(host.textContent).not.toContain('DSH Agent Input')
  await click('strong')
  expect(host.querySelector('[aria-label="快记详情"]')).not.toBeNull()
  expect(host.querySelector('[aria-label="快记详情"] [aria-label^="来源："]')).toBeNull()
})


it('renders private and group avatars inside source badges through the shared avatar renderer', async () => {
  arkmeAvatarImages.activateScope('calendar-badge-avatars')
  api.call.mockImplementation(async (op: string) => {
    if (op === 'user.profile') return { profile: {} }
    if (op === 'calendar.buckets') return { days: [] }
    if (op === 'image.read') return { mediaType: 'image/png', dataBase64: 'iVBORw0KGgo=' }
    return { items: [
      { ...record, sourceKind: 'chat', source: { kind: 'private_chat', displayName: '同事', avatarRef: 'private-avatar' } },
      { ...record, recordUid: 'group', sourceKind: 'chat', source: { kind: 'group_chat', displayName: '项目群', avatarRefs: ['member-1', 'member-2'] } },
    ], hasMore: false }
  })
  try {
    await render()
    expect(host.querySelector('[aria-label="来源：同事"] img')).not.toBeNull()
    const group = host.querySelector('[aria-label="来源：项目群"]')!
    expect(group.querySelectorAll('[data-arkme-group-avatar-slot] img')).toHaveLength(2)
    await act(async () => host.querySelectorAll<HTMLElement>('[aria-label="打开快记详情"]')[1]!.click())
    expect(host.querySelectorAll('[aria-label="快记详情"] [aria-label="来源：项目群"] [data-arkme-group-avatar-slot] img')).toHaveLength(2)
  } finally { arkmeAvatarImages.activateScope(undefined) }
})


it('navigates the same source from list and detail badges without opening a nested detail', async () => {
  const source = { sourceRef: 'safe-session-ref', kind: 'private_chat', displayName: '同事', avatarRef: 'private-avatar', activeAtMillis: 0, unreadCount: 0 }
  api.call.mockImplementation(async (op: string) => op === 'user.profile' ? { profile: {} }
    : op === 'calendar.buckets' ? { days: [] }
      : op === 'image.read' ? { mediaType: 'image/png', dataBase64: 'iVBORw0KGgo=' }
        : { items: [{ ...record, sourceKind: 'chat', source }], hasMore: false })
  const close = vi.fn()
  await act(async () => root.render(<ArkmeCalendarSurface onClose={close} />))
  await click('[aria-label="来源：同事"]')
  expect(host.querySelector('[aria-label="快记详情"]')).toBeNull()
  expect(arkmeUi.getSnapshot().selectedSource).toEqual(source)
  expect(close).toHaveBeenCalledTimes(1)
  await click('strong')
  expect(host.querySelector('[aria-label="快记详情"] [aria-label="来源：同事"]')).not.toBeNull()
  await click('[aria-label="快记详情"] [aria-label="来源：同事"]')
  expect(arkmeUi.getSnapshot().selectedSource).toEqual(source)
  expect(host.querySelector('[aria-label="快记详情"]')).toBeNull()
  expect(close).toHaveBeenCalledTimes(2)
})


it('keeps the source badge in forwarded record details', async () => {
  api.call.mockImplementation(async (op: string) => op === 'user.profile' ? { profile: {} }
    : op === 'calendar.buckets' ? { days: [] }
      : { items: [{ ...record, topicTitle: '项目', content: { ...record.content, forwardRecords: {
        title: '转发快记', createdAtMillis: 1, items: [], summaryLines: ['转发正文'],
      } } }], hasMore: false })
  await render()
  await click('[aria-label="打开快记详情"]')
  expect(host.querySelector('[aria-label="转发快记详情"] [aria-label="来源：项目"]')).not.toBeNull()
})
