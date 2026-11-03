import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/ArkmeRichContent.js', () => ({ ArkmeMediaPreview: () => <div data-preview /> }))
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { ArkmeComposerResourcePicker } from '../src/client/ArkmeComposerResourcePicker.js'
const item = (id: string) => ({ key: id, recordUid: `r-${id}`, asset: { fileAssetUid: id, fileName: `${id}.pdf`, fileKind: 4 as const, size: 1024, mimeType: 'application/pdf' }, sendAtMillis: 1 })
let view: ReactTestRenderer
const select = vi.fn(), close = vi.fn()
const button = (name: string) => view.root.findAllByType('button').find(node => node.children.join('') === name)!
async function mount(kind: 'file' | 'gallery' = 'file', limit = 2) {
  await act(async () => { view = create(<ArkmeComposerResourcePicker kind={kind} userId={42} accountKey="test:42" limit={limit} onSelect={select} onClose={close} />); await vi.advanceTimersByTimeAsync(1) })
}
beforeEach(() => { vi.useFakeTimers(); mocks.call.mockReset(); select.mockReset(); close.mockReset(); arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 }) })
afterEach(() => { act(() => view?.unmount()); vi.useRealTimers() })
describe('composer cloud picker', () => {
  it('adds multiple items only after confirmation and supports pagination without duplicates', async () => {
    mocks.call.mockResolvedValueOnce({ items: [item('a')], hasMore: true, nextCursor: 'next' }).mockResolvedValueOnce({ items: [item('a'), item('b')], hasMore: false })
    await mount(); act(() => view.root.findByProps({ role: 'checkbox' }).props.onClick())
    expect(select).not.toHaveBeenCalled()
    await act(async () => button('加载更多').props.onClick())
    expect(view.root.findAllByProps({ role: 'checkbox' })).toHaveLength(2)
    act(() => view.root.findByProps({ 'aria-label': 'b.pdf' }).props.onClick())
    act(() => button('添加到输入框').props.onClick())
    expect(select).toHaveBeenCalledWith([item('a'), item('b')]); expect(close).toHaveBeenCalledOnce()
    expect(mocks.call.mock.calls.map(([op]) => op)).toEqual(['composer.resources.list', 'composer.resources.list'])
  })
  it('uses thumbnail refs for the grid while adding the original asset', async () => {
    const image = { ...item('image'), mediaRef: 'original-ref', thumbnailRef: 'thumbnail-ref', asset: { ...item('image').asset, fileKind: 1 as const, mimeType: 'image/png' } }
    mocks.call.mockResolvedValue({ items: [image], hasMore: false })
    await mount('gallery')
    expect(view.root.findByType('img').props.src).toContain('thumbnail-ref')
    expect(view.root.findByType('img').props.loading).toBe('lazy')
    act(() => view.root.findByProps({ role: 'checkbox' }).props.onClick())
    act(() => button('添加到输入框').props.onClick())
    expect(select).toHaveBeenCalledWith([expect.objectContaining({ asset: expect.objectContaining({ fileAssetUid: 'image' }), mediaRef: 'original-ref' })])
  })
  it('enforces the remaining attachment limit and cancellation never sends', async () => {
    mocks.call.mockResolvedValue({ items: [item('a'), item('b')], hasMore: false })
    await mount('gallery', 1)
    act(() => view.root.findByProps({ 'aria-label': 'a.pdf' }).props.onClick())
    expect(view.root.findByProps({ 'aria-label': 'b.pdf' }).props.disabled).toBe(true)
    act(() => button('取消').props.onClick()); expect(select).not.toHaveBeenCalled()
  })
  it('ignores stale search responses and fences account changes at confirmation', async () => {
    let finish!: (value: unknown) => void
    mocks.call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce({ items: [item('new')], hasMore: false })
    await mount()
    act(() => view.root.findByType('input').props.onChange({ target: { value: '查询' } }))
    await act(async () => vi.advanceTimersByTimeAsync(250))
    await act(async () => finish({ items: [item('old')], hasMore: false }))
    expect(view.root.findAllByProps({ role: 'checkbox' }).map(node => node.props['aria-label'])).toEqual(['new.pdf'])
    act(() => view.root.findByProps({ 'aria-label': 'new.pdf' }).props.onClick())
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 9 })
    act(() => button('添加到输入框').props.onClick()); expect(select).not.toHaveBeenCalled()
  })
})
