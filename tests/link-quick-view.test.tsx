import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeLinkQuickView } from '../src/client/ArkmeLinkQuickView.js'
import { arkmeSearchRecordLinks } from '../src/search-record-links.js'
import type { ArkmeRecordSearchResult, ArkmeSearchRecordItem } from '../src/types.js'

const mocks = vi.hoisted(() => ({ call: vi.fn(), open: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/link-metadata-client.js', () => ({
  arkmeShouldResolveLinkMetadata: () => true,
  arkmeLinkMetadataResolver: { resolve: async () => null },
}))

function item(id: string, extra: Partial<ArkmeSearchRecordItem> = {}): ArkmeSearchRecordItem {
  return { recordUid: id, recordOwnerUserId: 42, sourceKind: 1, sourceUid: 'self', routeTargetKind: 'source', sendAtMillis: 1,
    title: '', snippet: '', textContent: 'https://example.com/one', media: [], files: [], sourceTitle: '发给自己', ...extra }
}
function page(items: ArkmeSearchRecordItem[], nextCursor?: string): ArkmeRecordSearchResult {
  return { items, sourceAggregates: [], hasMore: nextCursor !== undefined, ...(nextCursor === undefined ? {} : { nextCursor }), queryGuard: { state: 'ok' } }
}
function content(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(content).join('')
  return value !== null && typeof value === 'object' && 'children' in value ? content(value.children) : ''
}
let renderer: ReactTestRenderer | undefined
const cards = () => renderer!.root.findAllByProps({ 'data-arkme-link-record': 'true' })
const button = (label: string) => renderer!.root.findAllByType('button').find(node => content(node.props.children) === label)!
async function mount() { await act(async () => { renderer = create(<ArkmeLinkQuickView onOpenRecord={mocks.open} />) }) }
beforeEach(() => { vi.useFakeTimers(); mocks.call.mockReset(); mocks.open.mockReset() })
afterEach(() => { act(() => { renderer?.unmount() }); renderer = undefined; vi.unstubAllGlobals(); vi.useRealTimers() })

describe('external link quick browse', () => {
  it('uses the link scene, keeps all valid links and separates opening a page from opening its source', async () => {
    const original = item('1', { linkUrls: ['http://example.com/one', 'https://example.com/two', 'http://example.com/one', 'javascript:alert(1)'] })
    mocks.call.mockResolvedValue(page([original, item('no-link', { textContent: 'ordinary note' })]))
    await mount()
    expect(mocks.call).toHaveBeenCalledExactlyOnceWith('search.scene', { scene: 'link', limit: 30 }, expect.any(AbortSignal))
    expect(cards()).toHaveLength(1)
    const anchors = renderer!.root.findAllByType('a')
    expect(anchors.map(a => a.props.href)).toEqual(['http://example.com/one', 'https://example.com/two'])
    for (const anchor of anchors) {
      expect(anchor.props.target).toBe('_blank')
      expect(anchor.props.rel).toBe('noopener noreferrer')
      expect(anchor.props.onClick).toBeUndefined()
    }
    expect(mocks.open).not.toHaveBeenCalled()
    await act(async () => { button('查看来源').props.onClick() })
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith(original)
  })

  it('can expand more than five links without losing the record source', async () => {
    mocks.call.mockResolvedValue(page([item('1', { linkUrls: Array.from({ length: 7 }, (_, i) => `https://example.com/${i}`) })]))
    await mount()
    expect(renderer!.root.findAllByType('a')).toHaveLength(5)
    act(() => { button('展开另外 2 个链接').props.onClick() })
    expect(renderer!.root.findAllByType('a')).toHaveLength(7)
    act(() => { button('收起链接').props.onClick() })
    expect(renderer!.root.findAllByType('a')).toHaveLength(5)
  })

  it('keeps different record sources but deduplicates repeated pages and concurrent loads', async () => {
    let finish!: (result: ArkmeRecordSearchResult) => void
    mocks.call.mockResolvedValueOnce(page([item('1')], 'next')).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await mount()
    act(() => { const more = button('加载更多链接'); more.props.onClick(); more.props.onClick() })
    expect(mocks.call).toHaveBeenCalledTimes(2)
    await act(async () => { finish(page([item('1'), item('1', { sourceUid: 'other' }), item('2')])) })
    expect(cards()).toHaveLength(3)
  })

  it('keeps the page and retries the same cursor after a pagination failure', async () => {
    mocks.call.mockResolvedValueOnce(page([item('1')], 'next')).mockRejectedValueOnce(new Error('网络暂不可用')).mockResolvedValueOnce(page([item('2')]))
    await mount()
    await act(async () => { button('加载更多链接').props.onClick() })
    expect(cards()).toHaveLength(1)
    expect(content(renderer!.toJSON())).toContain('网络暂不可用')
    await act(async () => { button('重试').props.onClick() })
    expect(mocks.call.mock.calls[2]![1].cursor).toBe('next')
    expect(cards()).toHaveLength(2)
  })

  it('distinguishes errors, empty results and filtered pages that still have a next page', async () => {
    mocks.call.mockRejectedValueOnce(new Error('请求失败')).mockResolvedValueOnce(page([item('none', { textContent: '' })], 'next')).mockResolvedValueOnce(page([]))
    await mount()
    expect(content(renderer!.toJSON())).not.toContain('暂无外部链接')
    await act(async () => { button('重试').props.onClick() })
    expect(button('加载更多链接')).toBeDefined()
    expect(content(renderer!.toJSON())).not.toContain('暂无外部链接')
    await act(async () => { button('加载更多链接').props.onClick() })
    expect(content(renderer!.toJSON())).toContain('暂无外部链接')
  })

  it('stops cyclic cursors, including a cycle longer than one page', async () => {
    mocks.call.mockResolvedValueOnce(page([item('1')], 'a')).mockResolvedValueOnce(page([item('2')], 'b')).mockResolvedValueOnce(page([item('3')], 'a'))
    await mount()
    await act(async () => { button('加载更多链接').props.onClick() })
    await act(async () => { button('加载更多链接').props.onClick() })
    expect(cards()).toHaveLength(3)
    expect(button('加载更多链接')).toBeUndefined()
    expect(content(renderer!.toJSON())).toContain('后续分页暂不可用')
  })

  it('aborts on category exit and ignores late responses', async () => {
    let finish!: (result: ArkmeRecordSearchResult) => void
    mocks.call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await mount()
    const signal = mocks.call.mock.calls[0]![2] as AbortSignal
    act(() => { renderer!.unmount() }); renderer = undefined
    expect(signal.aborted).toBe(true)
    await act(async () => { finish(page([item('late')])) })
    expect(mocks.open).not.toHaveBeenCalled()
  })
})

it('shares safe chat URL recognition for HTTP, HTTPS, punctuation and repeated links', () => {
  expect(arkmeSearchRecordLinks('看 http://example.com/a，https://example.org/b。 http://example.com/a javascript:alert(1) data:text/html,hi ftp://example.org/x')).toEqual(['http://example.com/a', 'https://example.org/b'])
  expect(arkmeSearchRecordLinks('https://user:secret@example.com/ https://example.com\\evil')).toEqual([])
})
