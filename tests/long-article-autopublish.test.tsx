import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeLongArticleDialog } from '../src/client/ArkmeLongArticleDialog.js'
import { ArkmeLongArticleQuickView } from '../src/client/ArkmeLongArticleQuickView.js'
import { ArkmeLongArticleActions } from '../src/client/ArkmeLongArticleActions.js'
const mocks = vi.hoisted(() => ({ call: vi.fn(), listeners: {} as Record<string, () => void> }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call, ArkmeClientError: class extends Error {} }))
const item = { itemUid: 'article', title: '标题', textContent: '正文', sendAtMillis: 1 }
const detail = { ...item, sourceRef: 'self', version: 4, editable: true, updateAtMillis: 1, recordDurationMillis: 0, editDurationMillis: 0, thinkingDurationMillis: 0 }
let renderer: ReactTestRenderer | undefined
const close = vi.fn(), updated = vi.fn(), created = vi.fn()
const status = () => renderer!.root.findByProps({ 'data-arkme-article-publication': true })
const input = (name: string) => renderer!.root.findByProps({ 'aria-label': name })
const edit = (value: string, name = '长文正文') => act(() => input(name).props.onChange({ target: { value } }))
beforeEach(() => {
  vi.useFakeTimers(); mocks.call.mockReset(); close.mockReset(); updated.mockReset(); created.mockReset()
  mocks.listeners = {}
  vi.stubGlobal('window', { addEventListener: (event: string, listener: () => void) => { mocks.listeners[event] = listener }, removeEventListener: vi.fn(), setInterval, clearInterval })
  mocks.call.mockImplementation(async (op, p) => op === 'provider.capabilities' ? { features: { markdownLongArticles: false } }
    : op === 'source.long-article.detail' ? { ...detail, itemUid: p.itemUid }
    : op === 'source.long-article.update' ? { ...detail, ...p, version: p.version + 1 }
    : op === 'source.send-rich' ? { itemUid: 'created', status: 1, messageActionRef: 'signed-created' } : undefined)
})
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals() })
async function mount(props = {}) { await act(async () => { renderer = create(<ArkmeLongArticleDialog sourceRef="self" item={item} onClose={close} onUpdated={updated} onCreated={created} {...props} />) }) }
const writes = () => mocks.call.mock.calls.filter(([op]) => op === 'source.long-article.update' || op === 'source.send-rich')
it('opens editable content directly, keeps read-only content protected, and does not publish on open', async () => {
  await mount(); expect(input('长文正文').props.value).toBe('正文')
  expect(status().children.filter(value => typeof value === 'string').join('')).toContain('已发布')
  expect(renderer!.root.findAllByType('button').some(node => node.children.includes('发布') || node.children.includes('✎ 编辑'))).toBe(false)
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('◷')
  await act(async () => vi.advanceTimersByTimeAsync(60_000)); expect(writes()).toHaveLength(0)
})
it('publishes after five idle seconds, saves locally first and leaves the editor open', async () => {
  await mount(); edit('新正文')
  expect(status().children.filter(value => typeof value === 'string').join('')).toContain('待发布')
  await act(async () => vi.advanceTimersByTimeAsync(4_999)); expect(writes()).toHaveLength(0)
  await act(async () => vi.advanceTimersByTimeAsync(1))
  expect(writes()[0]![1]).toMatchObject({ itemUid: 'article', textContent: '新正文', version: 4 })
  const operations = mocks.call.mock.calls.map(([op]) => op)
  expect(operations.indexOf('source.long-article.draft.put')).toBeLessThan(operations.indexOf('source.long-article.update'))
  expect(input('长文正文').props.value).toBe('新正文'); expect(close).not.toHaveBeenCalled()
  expect(status().children.filter(value => typeof value === 'string').join('')).toContain('已发布')
})
it('preserves typing during a write, then serially publishes the latest revision using the new version', async () => {
  let resolve!: (value: unknown) => void
  await mount(); const original = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation((op, p) => op === 'source.long-article.update' && p.version === 4 ? new Promise(done => { resolve = done }) : original(op, p))
  edit('第一版'); await act(async () => vi.advanceTimersByTimeAsync(5_000))
  expect(input('长文正文').props.disabled).toBe(false)
  expect(status().children.filter(value => typeof value === 'string').join('')).toContain('发布中')
  edit('第二版')
  await act(async () => { resolve({ ...detail, textContent: '第一版', version: 5 }) })
  expect(writes()).toHaveLength(2)
  expect(writes()[1]![1]).toMatchObject({ textContent: '第二版', version: 5 })
  expect(input('长文正文').props.value).toBe('第二版')
})
it('flushes before article navigation and before share/export barriers', async () => {
  await mount(); edit('离开前修改')
  await act(async () => { await renderer!.root.findByType(ArkmeLongArticleActions).props.beforeAction() })
  expect(writes()).toHaveLength(1)
  edit('切换前修改')
  await act(async () => renderer!.root.findByType(ArkmeLongArticleQuickView).props.onChooseArticle({ recordUid: 'next', title: '下一篇', textContent: '', sendAtMillis: 1, targetSource: { sourceRef: 'next-source' } }))
  expect(writes()).toHaveLength(2)
  expect(mocks.call.mock.calls.some(([op, p]) => op === 'source.long-article.detail' && p.itemUid === 'next')).toBe(true)
})
it('flushes close immediately and retains the article when publication fails', async () => {
  await mount(); edit('不能丢的内容')
  const original = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation(async (op, p) => { if (op === 'source.long-article.update') throw new Error('网络中断'); return original(op, p) })
  await act(async () => renderer!.root.findAllByType('button').find(node => node.props['aria-label'] === '关闭长文')!.props.onClick())
  expect(close).not.toHaveBeenCalled(); expect(input('长文正文').props.value).toBe('不能丢的内容')
  expect(status().children.filter(value => typeof value === 'string').join('')).toContain('发布失败')
  mocks.call.mockImplementation(original)
  await act(async () => { mocks.listeners.online!() })
  expect(status().children.filter(value => typeof value === 'string').join('')).toContain('已发布')
})
it('pauses during IME composition and resumes on composition end', async () => {
  await mount(); input('长文标题').props.onCompositionStart(); edit('正在拼音')
  await act(async () => vi.advanceTimersByTimeAsync(30_000)); expect(writes()).toHaveLength(0)
  act(() => input('长文标题').props.onCompositionEnd())
  await act(async () => vi.advanceTimersByTimeAsync(5_000)); expect(writes()).toHaveLength(1)
})
it('creates once and continues editing the same confirmed record', async () => {
  await mount({ item: undefined }); edit('新建标题', '长文标题'); edit('新建正文')
  await act(async () => vi.advanceTimersByTimeAsync(5_000))
  expect(created).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled()
  expect(input('长文正文').props.value).toBe('新建正文')
  expect(renderer!.root.findByType(ArkmeLongArticleQuickView).props.currentArticle.itemUid).toBe('created')
  edit('后续正文'); await act(async () => vi.advanceTimersByTimeAsync(5_000))
  expect(writes().filter(([op]) => op === 'source.send-rich')).toHaveLength(1)
  expect(writes().at(-1)![1]).toMatchObject({ itemUid: 'created', textContent: '后续正文' })
})
it('never automatically sends a composer attachment draft', async () => {
  const prepared = vi.fn(); await mount({ item: undefined, onPrepared: prepared }); edit('附件标题', '长文标题'); edit('附件正文')
  await act(async () => vi.advanceTimersByTimeAsync(60_000)); expect(writes()).toHaveLength(0); expect(prepared).not.toHaveBeenCalled()
})
it('recovers a durable automatic draft with the original CAS version and publishes without another edit click', async () => {
  const original = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation((op, p) => op === 'source.long-article.draft.get'
    ? { sourceRef: 'self', itemUid: 'article', autoPublish: true, baseVersion: 4, title: '标题', textContent: '重开后待发布的正文', durationMillis: 50, updatedAtMillis: 1 }
    : original(op, p))
  await mount(); expect(input('长文正文').props.value).toBe('重开后待发布的正文')
  await act(async () => vi.advanceTimersByTimeAsync(5_000))
  expect(writes()[0]![1]).toMatchObject({ version: 4, textContent: '重开后待发布的正文' })
})
it('flushes outstanding edits when its parent section unmounts', async () => {
  await mount(); edit('切走模块前的内容')
  await act(async () => renderer!.unmount()); renderer = undefined
  expect(writes()).toHaveLength(1); expect(writes()[0]![1].textContent).toBe('切走模块前的内容')
})
