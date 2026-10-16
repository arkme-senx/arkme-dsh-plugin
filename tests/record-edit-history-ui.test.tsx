// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { ArkmeRecordEditHistoryPage, ArkmeRecordEditHistoryReader } from '../src/record-edit-history.js'
vi.mock('../src/client/ArkmeRichContent.js', () => ({ ArkmeMessageContent: ({ item }: { item: { textContent: string } }) => <p>{item.textContent}</p> }))
import { ArkmeMessageContent } from '../src/client/ArkmeRichContent.js'
import { ArkmeUserAvatar } from '../src/client/ArkmeAvatar.js'
import { ArkmeRecordEditHistory } from '../src/client/ArkmeRecordEditHistory.js'
import { ArkmeRecordRevisionDiff } from '../src/client/ArkmeRecordRevisionDiff.js'
const page = (id: string): ArkmeRecordEditHistoryPage => ({ items: [{ revisionUid: id, kind: 'manual', editAtMillis: 1700000000000, content: { title: '', textContent: id, contentBlocks: [] } }], hasMore: false })
async function render(reader: ArkmeRecordEditHistoryReader) {
  let view!: ReactTestRenderer
  await act(async () => { view = create(<ArkmeRecordEditHistory sourceRef="s" messageActionRef="a" reader={reader} />) })
  return view
}
const button = (view: ReactTestRenderer, text: string) => view.root.findAllByType('button').find(node => node.children.includes(text))!

describe('edit history view', () => {
  it('keeps full snapshots folded until requested and unmount aborts its scope', async () => {
    const reader = { page: vi.fn<ArkmeRecordEditHistoryReader['page']>(async () => page('old snapshot')) }
    const view = await render(reader)
    expect(view.root.findAllByType(ArkmeMessageContent)).toHaveLength(0)
    act(() => button(view, '查看此版全文').props.onClick())
    expect(view.root.findByType(ArkmeMessageContent).props.item.textContent).toBe('old snapshot')
    expect(JSON.stringify(view.toJSON())).toContain('最新')
    const signal = reader.page.mock.calls[0]?.[3] as AbortSignal | undefined
    act(() => view.unmount())
    expect(signal?.aborted).toBe(true)
  })
  it.each([true, false])('keeps author direction and read-only revision identity in history bubbles (mine=%s)', async isMe => {
    const reader = { page: vi.fn().mockResolvedValue(page('revision-only')) }
    let view!: ReactTestRenderer
    await act(async () => { view = create(<ArkmeRecordEditHistory sourceRef="s" messageActionRef="a" reader={reader} author={{ isMe, senderName: '作者', senderKind: 'bot' }} />) })
    expect(view.root.findByProps({ 'data-arkme-history-row': true }).props.style.flexDirection).toBe(isMe ? 'row-reverse' : 'row')
    expect(view.root.findByType(ArkmeUserAvatar).props).toMatchObject({ size: 32, senderKind: 'bot', label: '作者' })
    act(() => button(view, '查看此版全文').props.onClick())
    const content = view.root.findByType(ArkmeMessageContent).props
    expect(content.presentation).toBe('detail')
    expect(content.item.itemUid).toBe('revision-only')
    expect(content.item.messageActionRef).toBeUndefined()
    expect(content.sourceRef).toBeUndefined()
    expect(view.root.findByProps({ 'data-arkme-history-latest': true }).props.style.fontSize).toBe(10)
    expect(view.root.findByProps({ 'data-arkme-history-time': true }).props.style.gridTemplateColumns).toBe('1fr auto 1fr')
    act(() => view.unmount())
  })

  it('shows a snapshot title even without current-message article metadata', async () => {
    const result = page('body')
    result.items[0]!.content = { title: '历史标题', textContent: '', contentBlocks: [] }
    const view = await render({ page: vi.fn().mockResolvedValue(result) })
    act(() => button(view, '查看此版全文').props.onClick())
    expect(view.root.findAllByType('h3')).toHaveLength(1)
    expect(JSON.stringify(view.toJSON())).toContain('历史标题')
    expect(view.root.findAllByType(ArkmeMessageContent)).toHaveLength(0)
    act(() => view.unmount())
  })

  it('keeps pagination reachable when a whole page is filtered and blocks duplicate loads', async () => {
    let resolve!: (value: ArkmeRecordEditHistoryPage) => void
    const reader = { page: vi.fn<ArkmeRecordEditHistoryReader['page']>()
      .mockResolvedValueOnce({ items: [], hasMore: true, nextCursorEditAt: 100 })
      .mockImplementationOnce(() => new Promise(done => { resolve = done })) }
    const view = await render(reader)
    expect(button(view, '加载更多')).toBeDefined()
    await act(async () => { button(view, '加载更多').props.onClick(); button(view, '加载更多').props.onClick() })
    expect(reader.page).toHaveBeenCalledTimes(2)
    await act(async () => resolve(page('original')))
    expect(JSON.stringify(view.toJSON())).toContain('original')
    act(() => view.unmount())
  })
  it('retains loaded revisions on pagination failure and retries the same cursor', async () => {
    const reader = { page: vi.fn<ArkmeRecordEditHistoryReader['page']>()
      .mockResolvedValueOnce({ ...page('first'), hasMore: true, nextCursorEditAt: 100 })
      .mockRejectedValueOnce(new Error('网络失败')).mockResolvedValueOnce(page('second')) }
    const view = await render(reader)
    await act(async () => button(view, '加载更多').props.onClick())
    expect(JSON.stringify(view.toJSON())).toContain('first')
    await act(async () => button(view, '重试').props.onClick())
    expect(reader.page.mock.calls[2]?.[2]).toBe(100)
    expect(JSON.stringify(view.toJSON())).toContain('second')
    act(() => view.unmount())
  })
  it('does not apply a late response after changing the target', async () => {
    let resolve!: (value: ArkmeRecordEditHistoryPage) => void
    const reader = { page: vi.fn<ArkmeRecordEditHistoryReader['page']>()
      .mockImplementationOnce(() => new Promise(done => { resolve = done })).mockResolvedValueOnce(page('new')) }
    const view = await render(reader)
    await act(async () => view.update(<ArkmeRecordEditHistory sourceRef="s2" messageActionRef="b" reader={reader} />))
    await act(async () => resolve(page('stale')))
    expect(JSON.stringify(view.toJSON())).toContain('new')
    expect(JSON.stringify(view.toJSON())).not.toContain('stale')
    act(() => view.unmount())
  })
  it('bounds eventual-consistency retries and cancels pending retry timers on close', async () => {
    vi.useFakeTimers()
    try {
      const reader = { page: vi.fn<ArkmeRecordEditHistoryReader['page']>().mockResolvedValue({ items: [], hasMore: false }) }
      const view = await render(reader)
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
      expect(reader.page).toHaveBeenCalledTimes(3)
      expect(JSON.stringify(view.toJSON())).toContain('暂无编辑记录')
      act(() => view.unmount())
      const pending = await render(reader)
      act(() => pending.unmount())
      const count = reader.page.mock.calls.length
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(reader.page).toHaveBeenCalledTimes(count)
    } finally { vi.useRealTimers() }
  })

  it('retries a failed media refresh from the first page instead of the pagination cursor', async () => {
    const first = page('first')
    first.items[0]!.content.mediaUnavailable = true
    const reader = { page: vi.fn<ArkmeRecordEditHistoryReader['page']>()
      .mockResolvedValueOnce({ ...first, hasMore: true, nextCursorEditAt: 100 })
      .mockRejectedValueOnce(new Error('刷新失败')).mockResolvedValueOnce(page('refreshed')) }
    const view = await render(reader)
    await act(async () => button(view, '重新加载历史附件').props.onClick())
    await act(async () => button(view, '重试').props.onClick())
    expect(reader.page.mock.calls[2]?.[2]).toBe(0)
    expect(JSON.stringify(view.toJSON())).not.toContain('first')
    act(() => view.unmount())
  })

  it('shows query errors instead of empty success', async () => {
    const view = await render({ page: vi.fn().mockRejectedValue(new Error('没有权限')) })
    expect(JSON.stringify(view.toJSON())).toContain('没有权限')
    expect(button(view, '重试')).toBeDefined()
    act(() => view.unmount())
  })

  it('compares every edit with its immediate predecessor, including AI polish', async () => {
    const item = (id: string, text: string, time: number, kind: 'manual' | 'polish' | 'original') => ({ revisionUid: id, kind, editAtMillis: time, content: { title: '', textContent: text, contentBlocks: [] } })
    const view = await render({ page: vi.fn().mockResolvedValue({ items: [
      item('latest', '我们周四开会。', 3000, 'manual'), item('ai', '我们周三开会。', 2000, 'polish'), item('original', '周三开会', 1000, 'original'),
    ], hasMore: false }) })
    const latest = view.root.findByProps({ 'data-arkme-history-revision': 'latest' })
    expect(latest.findByType('del').children).toContain('三')
    expect(latest.findByType('ins').children).toContain('四')
    expect(JSON.stringify(view.toJSON())).toContain('对比基准：AI 润色')
    expect(latest.findAllByType(ArkmeMessageContent)).toHaveLength(0)
    const original = view.root.findByProps({ 'data-arkme-history-revision': 'original' })
    expect(original.findAllByType('ins')).toHaveLength(0)
    expect(original.findByType(ArkmeMessageContent).props.item.textContent).toBe('周三开会')
    expect(original.findAllByType('button')).toHaveLength(0)
    act(() => view.unmount())
  })

  it('fills a page boundary baseline without resetting expanded versions', async () => {
    const first = page('new'); first.items[0]!.content.textContent = '周四开会'
    const older = page('older'); older.items[0]!.editAtMillis -= 1000; older.items[0]!.content.textContent = '周三开会'
    const reader = { page: vi.fn().mockResolvedValueOnce({ ...first, hasMore: true, nextCursorEditAt: 100 }).mockResolvedValueOnce(older) }
    const view = await render(reader)
    expect(view.root.findAllByType('del')).toHaveLength(0)
    act(() => button(view, '查看此版全文').props.onClick())
    await act(async () => button(view, '加载更多').props.onClick())
    expect(view.root.findByType('del').children).toContain('三')
    expect(view.root.findAllByType(ArkmeMessageContent)).toHaveLength(1)
    act(() => view.unmount())
  })

  it('does not invent changes when ordering or a previous snapshot is missing', async () => {
    const older = page('older').items[0]!; older.editAtMillis -= 1000
    const view = await render({ page: vi.fn().mockResolvedValue({ items: [...page('a').items, ...page('b').items, older], hasMore: false }) })
    expect(view.root.findAllByType('ins')).toHaveLength(0)
    expect(JSON.stringify(view.toJSON())).toContain('版本先后顺序不明确')
    expect(JSON.stringify(view.toJSON())).toContain('缺少上一版本')
    act(() => view.unmount())
  })

  it('expands unchanged context separately from the full version', async () => {
    const a = page('new').items[0]!, b = page('before').items[0]!
    a.content.textContent = '前文。'.repeat(100) + '周四开会' + '后文。'.repeat(100)
    b.content.textContent = a.content.textContent.replace('周四', '周三'); b.editAtMillis -= 1000
    const view = await render({ page: vi.fn().mockResolvedValue({ items: [a, b], hasMore: false }) })
    expect(view.root.findAllByProps({ title: '未改动内容已折叠' })).toHaveLength(2)
    act(() => button(view, '展开上下文').props.onClick())
    expect(view.root.findAllByProps({ title: '未改动内容已折叠' })).toHaveLength(0)
    expect(view.root.findAllByType(ArkmeMessageContent)).toHaveLength(0)
    expect(view.root.findAllByType(ArkmeRecordRevisionDiff)).toHaveLength(2)
    act(() => view.unmount())
  })

  it('does not offer an ineffective context toggle for unchanged long text', async () => {
    const a = page('new').items[0]!, b = page('before').items[0]!
    a.content.textContent = b.content.textContent = '没有修改的正文。'.repeat(100)
    a.content.title = '新标题'; b.content.title = '旧标题'; b.editAtMillis -= 1000
    const view = await render({ page: vi.fn().mockResolvedValue({ items: [a, b], hasMore: false }) })
    expect(button(view, '展开上下文')).toBeUndefined()
    expect(view.root.findByType('del').children).toContain('旧')
    act(() => view.unmount())
  })

  it('automatically reads the next baseline when near the viewport and stops after a failure', async () => {
    let intersect!: (entries: { isIntersecting: boolean }[]) => void
    const disconnect = vi.fn(), observe = vi.fn()
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: typeof intersect) { intersect = callback }
      observe = observe
      disconnect = disconnect
    })
    let view: ReactTestRenderer | undefined
    try {
      const reader = { page: vi.fn().mockResolvedValueOnce({ ...page('new'), hasMore: true, nextCursorEditAt: 100 }).mockRejectedValueOnce(new Error('读取失败')) }
      await act(async () => { view = create(<ArkmeRecordEditHistory sourceRef="s" messageActionRef="a" reader={reader} />, { createNodeMock: element => element.props['data-arkme-history-baseline'] !== undefined ? {} : null }) })
      expect(observe).toHaveBeenCalledTimes(1)
      await act(async () => { intersect([{ isIntersecting: true }]); intersect([{ isIntersecting: true }]) })
      expect(reader.page).toHaveBeenCalledTimes(2)
      expect(reader.page.mock.calls[1]?.[2]).toBe(100)
      expect(observe).toHaveBeenCalledTimes(1)
      expect(disconnect).toHaveBeenCalled()
      expect(view!.root.findAllByType('ins')).toHaveLength(0)
      expect(button(view!, '重试')).toBeDefined()
    } finally { if (view) act(() => view!.unmount()); vi.unstubAllGlobals() }
  })
})
