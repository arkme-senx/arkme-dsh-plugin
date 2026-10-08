import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeRecognizedSpeakersSurface } from '../src/client/ArkmeRecognizedSpeakersSurface.js'
import { RecognizedSpeakerDirectory } from '../src/client/recognized-speaker-directory.js'
import { loaders, summary, page, person, deferred } from './helpers/speaker-directory.js'
vi.mock('../src/client/recordings/SpeakerSelfGuide.js', () => ({ SpeakerSelfGuide: () => <aside>识别我的声音</aside> }))
vi.mock('../src/client/ArkmeAvatar.js', () => ({ ArkmeUserAvatar: ({ avatarRef, label }: { avatarRef?: string; label: string }) => <span data-avatar-label={label} data-avatar-ref={avatarRef ?? ''} /> }))
const flush = async () => { for (let i = 0; i < 35; i++) await Promise.resolve() }
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : text(child)).join('')
const rows = (view: ReactTestRenderer) => view.root.findAllByProps({ className: 'arkme-recognized-speakers-row' })
let active: ReactTestRenderer[] = []
afterEach(() => { active.forEach(view => act(() => view.unmount())); active = []; vi.useRealTimers() })
async function render(api = loaders(), extra = {}) {
  const directory = new RecognizedSpeakerDirectory(api)
  let view!: ReactTestRenderer
  await act(async () => { view = create(<ArkmeRecognizedSpeakersSurface accountKey="a" onBack={() => {}} directory={directory} {...extra} />); await flush() })
  active.push(view); return { view, directory }
}
const click = (view: ReactTestRenderer, label: string) => view.root.findAllByType('button').find(button => text(button) === label)!.props.onClick()

describe('server-backed recognized speaker surface', () => {
  it('renders the directory before avatars arrive and preserves default/number avatars', async () => {
    const pending = deferred<Array<{ detailRef: string; avatarRef?: string }>>()
    const api = loaders({ list: vi.fn(async () => page({ items: [person('me', { type: 'marked', isSelf: true }), person('manual', { type: 'marked' }), person('12')] })), avatars: vi.fn(async () => pending.promise) })
    const { view } = await render(api)
    expect(rows(view)).toHaveLength(3)
    expect(api.avatars).toHaveBeenCalledWith(['detail-me', 'detail-manual'], expect.any(AbortSignal))
    expect(view.root.findByProps({ 'data-avatar-label': '说话人 me' }).props['data-avatar-ref']).toBe('')
    await act(async () => { pending.resolve([{ detailRef: 'detail-me', avatarRef: 'profile-me' }, { detailRef: 'detail-manual' }]); await flush() })
    expect(view.root.findByProps({ 'data-avatar-label': '说话人 me' }).props['data-avatar-ref']).toBe('profile-me')
    expect(view.root.findByProps({ 'data-avatar-label': '说话人 manual' }).props['data-avatar-ref']).toBe('')
    expect(rows(view).map(text)[2]).toContain('12')
    expect(api.avatars).toHaveBeenCalledTimes(1)
    expect(api.open).not.toHaveBeenCalled()
  })
  it('loads only the new page avatars after pagination', async () => {
    const api = loaders({ list: vi.fn().mockResolvedValueOnce(page({ items: [person('1', { type: 'marked' })], hasMore: true, nextCursor: 'next' }))
      .mockResolvedValueOnce(page({ items: [person('2', { type: 'marked' })] })) })
    const { view } = await render(api)
    await act(async () => { await click(view, '加载更多说话人'); await flush() })
    expect(api.avatars).toHaveBeenNthCalledWith(1, ['detail-1'], expect.any(AbortSignal))
    expect(api.avatars).toHaveBeenNthCalledWith(2, ['detail-2'], expect.any(AbortSignal))
    expect(rows(view)).toHaveLength(2)
  })
  it('retries avatar failures without hiding rows or refetching the directory', async () => {
    vi.useFakeTimers()
    const api = loaders({ list: vi.fn(async () => page({ items: [person('me', { type: 'marked' })] })),
      avatars: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([{ detailRef: 'detail-me', avatarRef: 'recovered' }]) })
    const { view } = await render(api)
    expect(rows(view)).toHaveLength(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); await flush() })
    expect(view.root.findByProps({ 'data-avatar-label': '说话人 me' }).props['data-avatar-ref']).toBe('recovered')
    expect(api.list).toHaveBeenCalledTimes(1)
  })
  it('cannot apply an old account avatar after switching accounts', async () => {
    const pending = deferred<Array<{ detailRef: string; avatarRef: string }>>()
    const api = loaders({ list: vi.fn().mockResolvedValueOnce(page({ items: [person('old', { type: 'marked' })] }))
      .mockResolvedValue(page({ items: [person('new', { type: 'marked' })] })),
      avatars: vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue([{ detailRef: 'detail-new', avatarRef: 'new-avatar' }]) })
    const { view, directory } = await render(api)
    await act(async () => { view.update(<ArkmeRecognizedSpeakersSurface accountKey="b" onBack={() => {}} directory={directory} />); await flush() })
    await act(async () => { pending.resolve([{ detailRef: 'detail-old', avatarRef: 'wrong-avatar' }]); await flush() })
    expect(view.root.findByProps({ 'data-avatar-label': '说话人 new' }).props['data-avatar-ref']).toBe('new-avatar')
    expect(JSON.stringify(view.toJSON())).not.toContain('wrong-avatar')
  })
  it('preserves server order and acknowledges only after the main first page is rendered', async () => {
    const api = loaders({ list: vi.fn(async () => page({ items: [person('9', { isSelf: true }), person('1')], hasMore: true, nextCursor: 'next' })) })
    const { view } = await render(api)
    expect(rows(view).map(text)[0]).toContain('说话人 9 · 我')
    expect(api.list).toHaveBeenCalledTimes(1)
    expect(api.seen).toHaveBeenCalledWith('seen-v1', expect.any(AbortSignal))
    expect(text(view.root)).not.toContain('识别我的声音')
    await act(async () => { await click(view, '加载更多说话人'); await flush() })
    expect(api.list).toHaveBeenCalledTimes(2)
  })
  it('searches remotely after debounce and never marks a search-only snapshot as seen', async () => {
    vi.useFakeTimers()
    const api = loaders({ list: vi.fn(async input => page({ items: [person(input.query || '1')], throughCursor: input.query ? 'search-snapshot' : 'main-snapshot' })) })
    const { view } = await render(api)
    await act(async () => { view.root.findByType('input').props.onChange({ target: { value: '王' } }); await vi.advanceTimersByTimeAsync(300); await flush() })
    expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ query: '王', cursor: '' }), expect.any(AbortSignal))
    expect(rows(view).map(text)[0]).toContain('说话人 王')
    expect(api.seen).toHaveBeenCalledTimes(1)
    expect(text(view.root)).not.toContain('识别我的声音')
  })
  it('changes filter/order with a new first page, without carrying the old cursor', async () => {
    const api = loaders({ list: vi.fn(async () => page({ hasMore: true, nextCursor: 'old-next' })) })
    const { view } = await render(api)
    await act(async () => { click(view, '未标记 33'); await flush() })
    expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'unmarked', cursor: '' }), expect.any(AbortSignal))
    await act(async () => { view.root.findByType('select').props.onChange({ target: { value: 'recent' } }); await flush() })
    expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'unmarked', sort: 'recent', cursor: '' }), expect.any(AbortSignal))
    expect(api.seen).toHaveBeenCalledTimes(1)
  })
  it('ignores a delayed old query after a newer filter has completed', async () => {
    const old = deferred<ReturnType<typeof page>>()
    const api = loaders({ list: vi.fn(async input => input.filter === 'all' ? old.promise : page({ items: [person('current')] })) })
    const { view } = await render(api)
    await act(async () => { click(view, '未标记 33'); await flush() })
    await act(async () => { old.resolve(page({ items: [person('obsolete')] })); await flush() })
    expect(rows(view).map(text).join()).toContain('current')
    expect(text(view.root)).not.toContain('obsolete')
    expect(api.seen).not.toHaveBeenCalled()
  })
  it('shows building state then first results when retry_after permits, without false empty state', async () => {
    vi.useFakeTimers()
    const api = loaders({ summary: vi.fn().mockResolvedValueOnce(summary({ state: 'building', coverage: 'unknown', snapshotVersion: '', totalCount: null, unseenCount: null, retryAfterMs: 1000 })).mockResolvedValue(summary()) })
    const { view } = await render(api)
    expect(text(view.root)).toContain('正在整理说话人目录')
    expect(text(view.root)).not.toContain('暂无已识别说话人')
    expect(api.seen).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); await flush() })
    expect(rows(view)).toHaveLength(1)
  })
  it('opens marked detail with presence version and refreshes its reference once when stale', async () => {
    const api = loaders({ list: vi.fn().mockResolvedValueOnce(page({ items: [person('me', { type: 'marked', isSelf: true, detailRef: 'old-ref' })] }))
      .mockResolvedValue(page({ items: [person('me', { type: 'marked', isSelf: true, detailRef: 'new-ref' })] })),
      open: vi.fn(async ref => ({ type: 'speaker', speakerRef: ref, expectedVersion: ref === 'old-ref' ? 'presence-old' : 'presence-new' })),
    })
    const members = vi.fn().mockResolvedValueOnce({ state: 'stale', version: 'presence-new', items: [] })
      .mockResolvedValue({ state: 'fresh', items: [], dayCount: 1 })
    const { view } = await render(api, { loadMarkedMembers: members })
    await act(async () => { rows(view)[0]!.props.onClick(); await flush() })
    expect(members).toHaveBeenNthCalledWith(1, 'old-ref', expect.any(AbortSignal), 'presence-old')
    expect(members).toHaveBeenLastCalledWith('new-ref', expect.any(AbortSignal), 'presence-new')
  })
  it('preserves loaded rows on a failed subsequent page and displays retry feedback', async () => {
    const api = loaders({ list: vi.fn().mockResolvedValueOnce(page({ hasMore: true, nextCursor: 'next' })).mockRejectedValue(new Error('网络断开')) })
    const { view } = await render(api)
    await act(async () => { await click(view, '加载更多说话人'); await flush() })
    expect(rows(view)).toHaveLength(1)
    expect(text(view.root)).toContain('网络断开')
  })
  it('unmounts old account rows immediately on account switch', async () => {
    const api = loaders({ summary: vi.fn().mockResolvedValueOnce(summary()).mockResolvedValueOnce(summary()).mockImplementation(() => new Promise(() => {})) })
    const { view, directory } = await render(api)
    await act(async () => { view.update(<ArkmeRecognizedSpeakersSurface accountKey="b" onBack={() => {}} directory={directory} />); await flush() })
    expect(rows(view)).toHaveLength(0)
  })
})
