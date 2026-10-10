import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeArticlePicker } from '../src/client/ArkmeArticlePicker.js'
import type { ArkmeSearchRecordItem } from '../src/types.js'
const mock = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mock.call }))
vi.mock('../src/client/ArkmeLongArticleDialog.js', () => ({ ArkmeLongArticleDialog: () => <div data-editor />, ArkmeLongArticleSnapshotDialog: () => <div data-preview /> }))
const row = (id: string, extra: Partial<ArkmeSearchRecordItem> = {}) => ({ recordUid: id, recordOwnerUserId: 42, title: id, textContent: '正文', snippet: '**摘要**', sendAtMillis: 1, templateKind: 8, ...extra })
const page = (items: unknown[], cursor?: string) => ({ items, hasMore: !!cursor, nextCursor: cursor })
let view: ReactTestRenderer
const selected = vi.fn(), closed = vi.fn()
const choices = () => view.root.findAll(node => node.props['data-arkme-article-choice'])
const text = () => JSON.stringify(view.toJSON())
const button = (label: string) => view.root.findAllByType('button').find(node => node.children.join('') === label)!
async function mount() { await act(async () => { view = create(<ArkmeArticlePicker sourceRef="chat-target" userId={42} onClose={closed} onSelect={selected} />) }); await act(async () => { await vi.advanceTimersByTimeAsync(1) }) }
beforeEach(() => { mock.call.mockReset(); selected.mockReset(); closed.mockReset(); vi.useFakeTimers() })
afterEach(() => { act(() => { view?.unmount() }); vi.useRealTimers() })

describe('add own article picker', () => {
  it('loads own long articles globally, excludes other owners/creators and ordinary records, supports later pages', async () => {
    mock.call.mockResolvedValueOnce(page([row('mine'), row('other', { recordOwnerUserId: 9 }), row('copy', { recordCreatorUserId: 9 }), row('note', { templateKind: 1 })], 'p2')).mockResolvedValueOnce(page([row('mine'), row('later', { sendAtMillis: 2 })]))
    await mount()
    expect(choices().map(node => node.props['data-arkme-article-choice'])).toEqual(['mine'])
    expect(mock.call).toHaveBeenCalledWith('search.scene', { scene: 'long_article', limit: 30 }, expect.any(AbortSignal))
    await act(async () => { button('加载更多').props.onClick() })
    expect(choices().map(node => node.props['data-arkme-article-choice'])).toEqual(['later', 'mine'])
    expect(selected).not.toHaveBeenCalled()
  })
  it('selecting a row does not send or create, attachment resolves full article only on confirmation', async () => {
    const detail = { sourceRef: 'self', itemUid: 'mine', title: 'mine', textContent: '完整正文', editable: true }
    mock.call.mockResolvedValueOnce(page([row('mine')])).mockResolvedValueOnce({ detail, messageActionRef: 'signed' })
    await mount()
    act(() => view.root.findByProps({ role: 'radio' }).props.onClick())
    expect(mock.call).toHaveBeenCalledTimes(1)
    expect(selected).not.toHaveBeenCalled()
    await act(async () => { button('添加所选').props.onClick() })
    expect(selected).toHaveBeenCalledWith({ kind: 'existing', detail, messageActionRef: 'signed' })
    expect(closed).toHaveBeenCalledOnce()
    expect(mock.call.mock.calls.map(([op]) => op)).toEqual(['search.scene', 'source.long-article.own'])
  })
  it('loads more when the current page contains only others and retains results for same-cursor retry', async () => {
    mock.call.mockResolvedValueOnce(page([row('other', { recordOwnerUserId: 9 })], 'next')).mockRejectedValueOnce(new Error('网络错误')).mockResolvedValueOnce(page([row('mine')]))
    await mount(); expect(text()).toContain('本页暂无自己的长文')
    await act(async () => { button('加载更多').props.onClick() })
    expect(text()).toContain('网络错误')
    await act(async () => { button('重试').props.onClick() })
    expect(mock.call.mock.calls[2]![1].cursor).toBe('next'); expect(choices()).toHaveLength(1)
  })
  it('debounces keyword searches and ignores stale pages', async () => {
    let old!: (value: unknown) => void
    mock.call.mockImplementationOnce(() => new Promise(resolve => { old = resolve })).mockResolvedValueOnce(page([row('new')]))
    await mount()
    const signal = mock.call.mock.calls[0]![2]
    act(() => view.root.findByType('input').props.onChange({ target: { value: '关键字' } }))
    expect(signal.aborted).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(250) })
    await act(async () => old(page([row('stale')])))
    expect(choices().map(node => node.props['data-arkme-article-choice'])).toEqual(['new'])
    expect(mock.call.mock.calls[1]![0]).toBe('search.records')
  })
  it('new opens the editor; cancellation and late selection never send', async () => {
    mock.call.mockResolvedValueOnce(page([]))
    await mount(); act(() => button('＋新建长文').props.onClick())
    expect(view.root.findByProps({ 'data-editor': true })).toBeDefined()
    expect(mock.call).toHaveBeenCalledTimes(1)
    expect(selected).not.toHaveBeenCalled()
  })
  it('aborts detail loading on close/unmount and drops its result', async () => {
    let finish!: (value: unknown) => void
    mock.call.mockResolvedValueOnce(page([row('mine')])).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await mount(); act(() => view.root.findByProps({ role: 'radio' }).props.onClick())
    act(() => button('添加所选').props.onClick())
    const signal = mock.call.mock.calls[1]![2]
    act(() => view.unmount())
    expect(signal.aborted).toBe(true)
    await act(async () => finish({ detail: { itemUid: 'mine' }, messageActionRef: 'signed' }))
    expect(selected).not.toHaveBeenCalled()
  })
})
