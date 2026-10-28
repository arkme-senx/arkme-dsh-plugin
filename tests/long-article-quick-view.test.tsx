import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeLongArticleDialogProps } from '../src/client/ArkmeLongArticleDialog.js'
import type { ArkmeRecordSearchResult, ArkmeSearchRecordItem } from '../src/types.js'
import { ArkmeLongArticleQuickView } from '../src/client/ArkmeLongArticleQuickView.js'
import { invalidateMessageQuoteSources } from '../src/client/message-quote-invalidations.js'

const mocks = vi.hoisted(() => ({ call: vi.fn(), dialog: vi.fn(), auth: { auth: { userId: 42, environment: 'test' } } }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/auth-store.js', () => ({ arkmeAuthStore: { getSnapshot: () => mocks.auth } }))
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
let intersect: ((entries: {isIntersecting:boolean}[])=>void) | undefined
let renderer: ReactTestRenderer | undefined
const scrollBottom=()=>intersect?.([{isIntersecting:true}])
const cards = () => renderer!.root.findAllByProps({ 'data-arkme-long-article-result': 'true' })
const button = (label: string) => renderer!.root.findAllByType('button').find(node => content(node.props.children) === label)!
async function mount() { await act(async () => { renderer = create(<ArkmeLongArticleQuickView />, {createNodeMock:()=>({})}) }) }

it('rechecks only affected loaded pages without losing older pages or advancing their cursor', async () => {
  const a = item('a', { targetSource: { sourceRef: 'a', sourceKey: 'a', kind: 'group_chat', displayName: 'A', activeAtMillis: 1, unreadCount: 0 } })
  const b = item('b', { targetSource: { sourceRef: 'b', sourceKey: 'b', kind: 'group_chat', displayName: 'B', activeAtMillis: 1, unreadCount: 0 } })
  mocks.call.mockResolvedValueOnce(page([a], 'page2')).mockResolvedValueOnce(page([b], 'page3'))
  await mount(); await act(async () => { scrollBottom() })
  const before = mocks.call.mock.calls.length
  await act(async () => { invalidateMessageQuoteSources('unrelated'); await vi.advanceTimersByTimeAsync(150) })
  expect(mocks.call).toHaveBeenCalledTimes(before)
  mocks.call.mockResolvedValueOnce(page([], 'page2'))
  await act(async () => { invalidateMessageQuoteSources('a'); invalidateMessageQuoteSources('a'); await vi.advanceTimersByTimeAsync(150) })
  expect(mocks.call).toHaveBeenCalledTimes(before + 1)
  expect(cards()).toHaveLength(1)
  expect(content(renderer!.toJSON())).toContain('文章b')
  mocks.call.mockResolvedValueOnce(page([item('c')]))
  await act(async () => { scrollBottom() })
  expect(mocks.call.mock.calls.at(-1)![1].cursor).toBe('page3')
  expect(cards()).toHaveLength(2)
})

it('retains all pages across a failed refresh, retries that page and defers hidden refresh work', async () => {
  mocks.call.mockResolvedValueOnce(page([item('1')], 'next')).mockResolvedValueOnce(page([item('2')], 'older'))
  await mount(); await act(async () => { scrollBottom() })
  mocks.call.mockRejectedValueOnce(new Error('refresh failed'))
  await act(async () => { invalidateMessageQuoteSources('signed-source'); await vi.advanceTimersByTimeAsync(150) })
  expect(cards()).toHaveLength(2)
  mocks.call.mockResolvedValueOnce(page([item('1')], 'next')).mockResolvedValueOnce(page([item('2')], 'older'))
  await act(async () => { button('重试').props.onClick() })
  expect(cards()).toHaveLength(2)
  expect(mocks.call.mock.calls.at(-1)![1].cursor).toBe('next')
  await act(async () => renderer!.update(<ArkmeLongArticleQuickView active={false} />))
  const reads = mocks.call.mock.calls.length
  await act(async () => { invalidateMessageQuoteSources(); await vi.advanceTimersByTimeAsync(150) })
  expect(mocks.call).toHaveBeenCalledTimes(reads)
  mocks.call.mockResolvedValueOnce(page([item('1')], 'next')).mockResolvedValueOnce(page([item('2')], 'older'))
  await act(async () => { renderer!.update(<ArkmeLongArticleQuickView />); })
  await act(async () => { await vi.advanceTimersByTimeAsync(150) })
  expect(mocks.call).toHaveBeenCalledTimes(reads + 2)
  expect(cards()).toHaveLength(2)
})

it('keeps the visible article anchored when a preceding article disappears', async () => {
  const root = { scrollTop: 60, getBoundingClientRect: () => ({ top: 0 }), querySelectorAll: (): unknown[] => [] }
  root.querySelectorAll = () => cards().map(card => {
    const key = card.props['data-arkme-article-key']
    return { dataset: { arkmeArticleKey: key }, getBoundingClientRect: () => {
      const index = cards().findIndex(current => current.props['data-arkme-article-key'] === key)
      return { top: index * 50 - root.scrollTop, bottom: (index + 1) * 50 - root.scrollTop }
    } }
  })
  const scrollRoot = { current: root as unknown as HTMLElement }
  mocks.call.mockResolvedValueOnce(page([item('1'), item('2')]))
  await act(async () => { renderer = create(<ArkmeLongArticleQuickView scrollRoot={scrollRoot} />, {createNodeMock:()=>({})}) })
  mocks.call.mockResolvedValueOnce(page([item('2')]))
  await act(async () => { invalidateMessageQuoteSources(); await vi.advanceTimersByTimeAsync(150) })
  expect(cards()).toHaveLength(1)
  expect(root.scrollTop).toBe(10)
})

it('can repopulate an empty retained page after a global permission/content change', async () => {
  mocks.call.mockResolvedValueOnce(page([]))
  await mount()
  mocks.call.mockResolvedValueOnce(page([item('restored')]))
  await act(async () => { invalidateMessageQuoteSources(); await vi.advanceTimersByTimeAsync(150) })
  expect(cards()).toHaveLength(1)
  expect(content(renderer!.toJSON())).toContain('文章restored')
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('document', { body: {} })
  mocks.auth={auth:{userId:42,environment:'test'}}
  intersect=undefined
  vi.stubGlobal('IntersectionObserver', class { constructor(callback:(entries:{isIntersecting:boolean}[])=>void){intersect=callback} observe(){} disconnect(){intersect=undefined} })
  mocks.call.mockReset(); mocks.dialog.mockReset()
})
afterEach(() => { act(() => { renderer?.unmount() }); renderer = undefined; vi.unstubAllGlobals(); vi.useRealTimers() })

describe('long-article quick browse', () => {
  it('uses the Flutter scene, excludes ordinary notes/files and shows plain-text markdown excerpts', async () => {
    mocks.call.mockResolvedValue(page([item('1', { textFormat: 'markdown', snippet: '**加粗摘要**' }), item('file', { templateKind: 7 }), item('note', { templateKind: 1 }), item('2', { templateKind: 1, displayKind: 1 })]))
    await mount()
    expect(mocks.call).toHaveBeenCalledExactlyOnceWith('search.scene', { scene: 'long_article', limit: 20 }, expect.any(AbortSignal))
    expect(cards()).toHaveLength(2)
    expect(content(renderer!.toJSON())).toContain('加粗摘要')
    expect(content(renderer!.toJSON())).not.toContain('**')
    expect(content(renderer!.toJSON())).not.toContain('文章file')
  })

  it('paginates with the returned cursor, deduplicates by owner and uid and never issues parallel requests', async () => {
    let finish!: (value: ArkmeRecordSearchResult) => void
    mocks.call.mockResolvedValueOnce(page([item('1')], 'next')).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await mount()
    act(() => { scrollBottom(); scrollBottom() })
    expect(mocks.call).toHaveBeenCalledTimes(2)
    expect(mocks.call.mock.calls[1]![1]).toEqual({ scene: 'long_article', limit: 20, cursor: 'next' })
    await act(async () => { finish(page([item('1'), item('2'), item('1', { recordOwnerUserId: 43 })])) })
    expect(cards()).toHaveLength(3)
    expect(content(renderer!.toJSON())).not.toContain('加载更多长文')
  })

  it('keeps loaded cards on pagination failure and retries the same cursor', async () => {
    mocks.call.mockResolvedValueOnce(page([item('1')], 'next')).mockRejectedValueOnce(new Error('网络暂不可用')).mockResolvedValueOnce(page([item('2')]))
    await mount()
    await act(async () => { scrollBottom() })
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
    await act(async () => { scrollBottom() })
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
    expect(button('加载更多长文')).toBeUndefined()
    expect(intersect).toEqual(expect.any(Function))
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
  it('cancels a hidden category and reloads an interrupted first page without accepting its late response',async()=>{
    let finish!:(value:ArkmeRecordSearchResult)=>void
    mocks.call.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve})).mockResolvedValueOnce(page([item('current')]))
    await mount()
    const signal=mocks.call.mock.calls[0]![2] as AbortSignal
    await act(async()=>renderer!.update(<ArkmeLongArticleQuickView active={false}/>))
    expect(signal.aborted).toBe(true)
    await act(async()=>renderer!.update(<ArkmeLongArticleQuickView active/>))
    await act(async()=>finish(page([item('old')])))
    expect(cards()).toHaveLength(1)
    expect(content(renderer!.toJSON())).toContain('文章current')
    expect(content(renderer!.toJSON())).not.toContain('文章old')
  })
  it('keeps a just-created article visible when the earlier search response has not indexed it yet',async()=>{
    let finish!:(value:ArkmeRecordSearchResult)=>void
    mocks.call.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
    await mount()
    await act(async()=>renderer!.update(<ArkmeLongArticleQuickView created={item('created')}/>))
    await act(async()=>finish(page([])))
    expect(cards()).toHaveLength(1)
    expect(content(renderer!.toJSON())).toContain('文章created')
  })
})

it('removes a deleted article by owner and uid while keeping another owners same uid', async()=>{
 mocks.call.mockResolvedValue(page([item('same',{recordOwnerUserId:42}),item('same',{recordOwnerUserId:43})]));await mount();
 act(()=>cards()[0]!.props.onClick({currentTarget:{}}));
 const props=mocks.dialog.mock.lastCall![0] as ArkmeLongArticleDialogProps;
 act(()=>props.onDeleted?.('same',42));expect(cards()).toHaveLength(1);
 act(()=>cards()[0]!.props.onClick({currentTarget:{}}));expect((mocks.dialog.mock.lastCall![0] as ArkmeLongArticleDialogProps).item?.recordOwnerUserId).toBe(43);
});


it('loads twenty articles per page on bottom intersection without a load-more button', async()=>{
 mocks.call.mockResolvedValueOnce(page(Array.from({length:20},(_,i)=>item(String(i))),'next')).mockResolvedValueOnce(page(Array.from({length:20},(_,i)=>item(String(i+20)))))
 await act(async()=>{renderer=create(<ArkmeLongArticleQuickView scope="shared_by_me"/>,{createNodeMock:()=>({})})})
 expect(cards()).toHaveLength(20)
 expect(button('加载更多长文')).toBeUndefined()
 await act(async()=>scrollBottom())
 expect(cards()).toHaveLength(40)
 expect(mocks.call.mock.calls[1]![1]).toEqual({scene:'long_article',articleScope:'shared_by_me',limit:20,cursor:'next'})
})
it('cancels a recent source lookup when leaving and never opens a late result',async()=>{
 let finish!:(value:unknown)=>void
 const foreign=item('1',{recordOwnerUserId:7,targetSource:{sourceRef:'signed-group',kind:'group_chat',displayName:'群聊',unreadCount:0,activeAtMillis:1}})
 mocks.call.mockResolvedValueOnce(page([foreign])).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 await mount()
 act(()=>{cards()[0]!.props.onClick({currentTarget:{focus:vi.fn()}});cards()[0]!.props.onClick({currentTarget:{}})})
 expect(mocks.call).toHaveBeenCalledTimes(2)
 const signal=mocks.call.mock.calls[1]![2] as AbortSignal
 act(()=>renderer!.unmount());renderer=undefined
 expect(signal.aborted).toBe(true)
 await act(async()=>finish({items:[{itemUid:'1',recordOwnerUserId:7,messageActionRef:'signed'}]}))
 expect(mocks.dialog).not.toHaveBeenCalled()
})
it('does not open a recent source result after switching accounts',async()=>{
 let finish!:(value:unknown)=>void
 const foreign=item('1',{recordOwnerUserId:7,targetSource:{sourceRef:'signed-group',kind:'group_chat',displayName:'群聊',unreadCount:0,activeAtMillis:1}})
 mocks.call.mockResolvedValueOnce(page([foreign])).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 await mount();act(()=>cards()[0]!.props.onClick({currentTarget:{focus:vi.fn()}}))
 mocks.auth={auth:{userId:43,environment:'test'}}
 await act(async()=>finish({items:[{itemUid:'1',recordOwnerUserId:7,messageActionRef:'signed'}]}))
 expect(mocks.dialog).not.toHaveBeenCalled()
 expect(content(renderer!.toJSON())).toContain('账号已切换')
})
it('removes only the exact original after an explicit source revocation',async()=>{
 const source={sourceRef:'signed-group',kind:'group_chat' as const,displayName:'群聊',unreadCount:0,activeAtMillis:1}
 mocks.call.mockResolvedValueOnce(page([item('same',{recordOwnerUserId:7,targetSource:source}),item('same',{recordOwnerUserId:8,targetSource:source})])).mockRejectedValueOnce(Object.assign(new Error('共享已撤销'),{body:{retryable:false}}))
 await mount();await act(async()=>cards()[0]!.props.onClick({currentTarget:{}}))
 expect(cards()).toHaveLength(1)
 expect(mocks.dialog).not.toHaveBeenCalled()
 expect(content(renderer!.toJSON())).toContain('共享已撤销')
})
