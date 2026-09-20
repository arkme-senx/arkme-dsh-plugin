import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeLongArticleDialog } from '../src/client/ArkmeLongArticleDialog.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call, ArkmeClientError: class extends Error {} }))
let renderer: ReactTestRenderer | undefined
let requestClose: () => void
const verifyAccount = vi.fn(async () => {})
const cancelClose = vi.fn()
const mode = { displayName: '产品群', verifyAccount, subscribeClose: (listener: () => void) => { requestClose = listener; return () => {} }, cancelClose }
beforeEach(() => {
  vi.stubGlobal('window', { confirm: () => true, addEventListener: vi.fn(), removeEventListener: vi.fn(), setInterval, clearInterval })
  mocks.call.mockReset(); verifyAccount.mockReset().mockResolvedValue(undefined); cancelClose.mockClear()
  mocks.call.mockImplementation(async (operation: string) => operation === 'provider.capabilities' ? { features: { markdownLongArticles: false } } : undefined)
})
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; vi.unstubAllGlobals() })
async function mount(close = vi.fn()) {
  await act(async () => { renderer = create(<ArkmeLongArticleDialog sourceRef="chat" windowMode={mode} onClose={close} />) })
  act(() => { renderer!.root.findByProps({ 'aria-label': '长文标题' }).props.onChange({ target: { value: '标题' } }); renderer!.root.findByProps({ 'aria-label': '长文正文' }).props.onChange({ target: { value: '正文' } }) })
  return close
}
function button(label: string) { return renderer!.root.findAllByType('button').find(node => node.children.includes(label))! }
it('native close allows continuing to edit without deleting the draft', async () => {
  const close = await mount(); act(() => requestClose());
  expect(JSON.stringify(renderer!.toJSON())).toContain('产品群')
  act(() => button('继续编辑').props.onClick())
  expect(close).not.toHaveBeenCalled(); expect(cancelClose).toHaveBeenCalled()
  expect(mocks.call.mock.calls.some(([op]) => op === 'source.long-article.draft.delete')).toBe(false)
})
it('keeps the window open when draft saving fails, then permits retry', async () => {
  const close = await mount();
  mocks.call.mockImplementation(async (operation: string) => { if (operation === 'source.long-article.draft.put') throw new Error('磁盘不可用') })
  act(() => requestClose()); await act(async () => { button('保存并关闭').props.onClick(); await Promise.resolve() })
  expect(close).not.toHaveBeenCalled(); expect(JSON.stringify(renderer!.toJSON())).toContain('磁盘不可用')
  mocks.call.mockResolvedValue(undefined)
  await act(async () => { button('保存并关闭').props.onClick() })
  expect(close).toHaveBeenCalledOnce()
})
it('retains submission ids when sending fails and retries', async () => {
  await mount(); let count = 0
  mocks.call.mockImplementation(async (operation: string) => { if (operation === 'source.send-rich') { if (++count === 1) throw new Error('连接中断'); return { itemUid: 'sent', status: 1 } } })
  await act(async () => { button('发送').props.onClick() })
  expect(JSON.stringify(renderer!.toJSON())).toContain('连接中断')
  await act(async () => { button('发送').props.onClick() })
  const sends = mocks.call.mock.calls.filter(([op]) => op === 'source.send-rich')
  expect(sends).toHaveLength(2)
  expect(sends[0]![1].recordUid).toBe(sends[1]![1].recordUid)
  expect(sends[0]![1].relationUid).toBe(sends[1]![1].relationUid)
})
it('checks the bound account before sending', async () => {
  const close = await mount(); verifyAccount.mockRejectedValue(new Error('账号已切换'))
  await act(async () => { button('发送').props.onClick() })
  expect(mocks.call.mock.calls.some(([op]) => op === 'source.send-rich')).toBe(false)
  expect(close).not.toHaveBeenCalled(); expect(JSON.stringify(renderer!.toJSON())).toContain('账号已切换')
})
it('requires an explicit discard after account invalidation and keeps existing drafts', async () => {
  const close = await mount()
  await act(async () => { renderer!.update(<ArkmeLongArticleDialog sourceRef="chat" windowMode={{ ...mode, invalidated: true }} onClose={close} />) })
  act(() => requestClose())
  expect(close).not.toHaveBeenCalled()
  expect(button('保存并关闭').props.disabled).toBe(true)
  await act(async () => { button('放弃修改').props.onClick() })
  expect(close).toHaveBeenCalledOnce()
  expect(mocks.call.mock.calls.some(([op]) => op === 'source.long-article.draft.delete')).toBe(false)
})

it('places send beside the bound target and uses native window closing', async () => {
  await mount()
  const bar = renderer!.root.findByProps({ 'data-arkme-article-window-toolbar': true })
  expect(JSON.stringify(bar.children.map(node => typeof node === 'string' ? node : node.props.children))).toContain('产品群')
  expect(bar.findAllByType('button').some(node => node.children.includes('发送'))).toBe(true)
  expect(renderer!.root.findAllByProps({ 'aria-label': '关闭长文' })).toHaveLength(0)
})

const existingItem = { itemUid: 'original', title: '原标题', textContent: '原正文', sendAtMillis: 1 }
async function existing(editable: boolean) {
 const detail = { ...existingItem, sourceRef: 'chat', version: 4, editable, updateAtMillis: 1, recordDurationMillis: 0, editDurationMillis: 0, thinkingDurationMillis: 0 }
 mocks.call.mockImplementation(async (op: string) => op === 'provider.capabilities' ? { features: { markdownLongArticles: false } } : op === 'source.long-article.detail' ? detail : op === 'source.long-article.update' ? { ...detail, title: '修改后', version: 5 } : undefined)
 const close = vi.fn(), updated = vi.fn()
 await act(async () => { renderer = create(<ArkmeLongArticleDialog sourceRef="chat" item={existingItem} windowMode={{ ...mode, editOnOpen: true }} onClose={close} onUpdated={updated} />) })
 return { close, updated }
}
it('opens authorized original directly for editing and updates it instead of sending', async () => {
 const { close, updated } = await existing(true)
 expect(renderer!.root.findByProps({ 'aria-label': '长文标题' }).props.value).toBe('原标题')
 act(() => renderer!.root.findByProps({ 'aria-label': '长文标题' }).props.onChange({ target: { value: '修改后' } }))
 await act(async () => button('保存修改').props.onClick())
 expect(mocks.call).toHaveBeenCalledWith('source.long-article.update', expect.objectContaining({ itemUid: 'original', version: 4, title: '修改后' }))
 expect(mocks.call.mock.calls.some(([op]) => op === 'source.send-rich' || op === 'source.long-article.publish')).toBe(false)
 expect(updated).toHaveBeenCalledWith(expect.objectContaining({ version: 5 }))
 expect(close).toHaveBeenCalledOnce()
})
it('keeps originals without edit permission read only', async () => {
 await existing(false)
 expect(renderer!.root.findAllByProps({ 'aria-label': '长文标题' })).toHaveLength(0)
 expect(button('保存修改')).toBeUndefined()
 expect(JSON.stringify(renderer!.toJSON())).toContain('只读')
})
it('retains original edits when saving fails', async () => {
 const { close } = await existing(true)
 mocks.call.mockRejectedValue(new Error('版本冲突'))
 act(() => renderer!.root.findByProps({ 'aria-label': '长文标题' }).props.onChange({ target: { value: '本地修改' } }))
 await act(async () => button('保存修改').props.onClick())
 expect(close).not.toHaveBeenCalled()
 expect(renderer!.root.findByProps({ 'aria-label': '长文标题' }).props.value).toBe('本地修改')
 expect(JSON.stringify(renderer!.toJSON())).toContain('版本冲突')
})
