import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeLongArticleDialogProps } from '../src/client/ArkmeLongArticleDialog.js'
import type { ArkmeRecordSearchResult, ArkmeSearchRecordItem } from '../src/types.js'
import { ArkmeLongArticleQuickView } from '../src/client/ArkmeLongArticleQuickView.js'

const mocks = vi.hoisted(() => ({ call: vi.fn(), dialog: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }))
vi.mock('../src/client/ArkmeLongArticleDialog.js', () => ({ ArkmeLongArticleDialog: (props: ArkmeLongArticleDialogProps) => {
  mocks.dialog(props)
  return <button aria-label="关闭长文" onClick={props.onClose}>阅读详情</button>
} }))

function item(id: string, extra: Partial<ArkmeSearchRecordItem> = {}): ArkmeSearchRecordItem {
  return {
    recordUid: id, recordOwnerUserId: 42, sourceKind: 1, routeTargetKind: 'source', sendAtMillis: 1,
    title: `文章${id}`, snippet: '摘要', textContent: '正文', templateKind: 8, media: [], files: [],
    targetSource: { sourceRef: 'signed-source', kind: 'self', displayName: '发给自己', unreadCount: 0, activeAtMillis: 1 },
    ...extra,
  }
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
const cards = () => renderer!.root.findAllByProps({ 'data-arkme-long-article-result': 'true' })
const button = (label: string) => renderer!.root.findAllByType('button').find(node => content(node.props.children) === label)!
async function mount() { await act(async () => { renderer = create(<ArkmeLongArticleQuickView />) }) }

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('document', { body: {} })
  mocks.call.mockReset(); mocks.dialog.mockReset()
})
afterEach(() => { act(() => { renderer?.unmount() }); renderer = undefined; vi.unstubAllGlobals(); vi.useRealTimers() })

describe('long-article quick browse', () => {
  it('uses the Flutter scene, excludes ordinary notes/files and shows plain-text markdown excerpts', async () => {
    mocks.call.mockResolvedValue(page([item('1', { textFormat: 'markdown', snippet: '**加粗摘要**' }), item('file', { templateKind: 7 }), item('note', { templateKind: 1 }), item('2', { templateKind: 1, displayKind: 1 })]))
    await mount()
    expect(mocks.call).toHaveBeenCalledExactlyOnceWith('search.scene', { scene: 'long_article', limit: 30 }, expect.any(AbortSignal))
    expect(cards()).toHaveLength(2)
    expect(content(renderer!.toJSON())).toContain('加粗摘要')
    expect(content(renderer!.toJSON())).not.toContain('**')
    expect(content(renderer!.toJSON())).not.toContain('文章file')
  })

  it('paginates with the returned cursor, deduplicates by owner and uid and never issues parallel requests', async () => {
    let finish!: (value: ArkmeRecordSearchResult) => void
    mocks.call.mockResolvedValueOnce(page([item('1')], 'next')).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await mount()
    act(() => { const more = button('加载更多长文'); more.props.onClick(); more.props.onClick() })
    expect(mocks.call).toHaveBeenCalledTimes(2)
    expect(mocks.call.mock.calls[1]![1]).toEqual({ scene: 'long_article', limit: 30, cursor: 'next' })
    await act(async () => { finish(page([item('1'), item('2'), item('1', { recordOwnerUserId: 43 })])) })
    expect(cards()).toHaveLength(3)
    expect(content(renderer!.toJSON())).not.toContain('加载更多长文')
  })

  it('keeps loaded cards on pagination failure and retries the same cursor', async () => {
    mocks.call.mockResolvedValueOnce(page([item('1')], 'next')).mockRejectedValueOnce(new Error('网络暂不可用')).mockResolvedValueOnce(page([item('2')]))
    await mount()
    await act(async () => { button('加载更多长文').props.onClick() })
    expect(cards()).toHaveLength(1)
    expect(content(renderer!.toJSON())).toContain('网络暂不可用')
    await act(async () => { button('重试').props.onClick() })
    expect(mocks.call.mock.calls[2]![1].cursor).toBe('next')
    expect(cards()).toHaveLength(2)
  })

  it('shows a retryable initial failure and a proper empty state', async () => {
    mocks.call.mockRejectedValueOnce(new Error('请求失败')).mockResolvedValueOnce(page([]))
    await mount()
    expect(content(renderer!.toJSON())).toContain('请求失败')
    expect(content(renderer!.toJSON())).not.toContain('暂无长文')
    await act(async () => { button('重试').props.onClick() })
    expect(content(renderer!.toJSON())).toContain('暂无长文')
  })

  it('does not repeatedly load an invalid or repeated cursor', async () => {
    mocks.call.mockResolvedValueOnce(page([item('1')], 'next')).mockResolvedValueOnce(page([item('2')], 'next'))
    await mount()
    await act(async () => { button('加载更多长文').props.onClick() })
    expect(content(renderer!.toJSON())).toContain('后续分页暂不可用')
    expect(content(renderer!.toJSON())).not.toContain('加载更多长文')
    expect(mocks.call).toHaveBeenCalledTimes(2)
  })

  it('aborts pending work on leaving the category and ignores late responses', async () => {
    let finish!: (value: ArkmeRecordSearchResult) => void
    mocks.call.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await mount()
    const signal = mocks.call.mock.calls[0]![2] as AbortSignal
    act(() => { renderer!.unmount() })
    expect(signal.aborted).toBe(true)
    await act(async () => { finish(page([item('late')])) })
    renderer = undefined
    expect(mocks.dialog).not.toHaveBeenCalled()
  })

  it('opens the existing reader above global search and preserves list state/focus when closed', async () => {
    mocks.call.mockResolvedValue(page([item('1')], 'next'))
    await mount()
    const focus = vi.fn()
    act(() => { cards()[0]!.props.onClick({ currentTarget: { focus } }) })
    const props = mocks.dialog.mock.lastCall![0] as ArkmeLongArticleDialogProps
    expect(props.sourceRef).toBe('signed-source')
    expect(props.item?.itemUid).toBe('1')
    expect(props.overlayZIndex).toBeGreaterThan(10020)
    act(() => { renderer!.root.findByProps({ 'aria-label': '关闭长文' }).props.onClick() })
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(cards()).toHaveLength(1)
    expect(button('加载更多长文')).toBeDefined()
    expect(mocks.call).toHaveBeenCalledTimes(1)
  })

  it('does not open the editor without a valid source', async () => {
    const unavailable = item('1'); delete unavailable.targetSource
    mocks.call.mockResolvedValue(page([unavailable]))
    await mount()
    act(() => { cards()[0]!.props.onClick({ currentTarget: {} }) })
    expect(content(renderer!.toJSON())).toContain('原会话暂不可访问')
    expect(mocks.dialog).not.toHaveBeenCalled()
  })
})
