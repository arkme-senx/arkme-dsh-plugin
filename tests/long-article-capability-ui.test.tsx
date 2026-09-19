import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { ArkmeLongArticleDialog } from '../src/client/ArkmeLongArticleDialog.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
let renderer: ReactTestRenderer | undefined
beforeEach(() => {
  vi.stubGlobal('window', { confirm: () => true, addEventListener: vi.fn(), removeEventListener: vi.fn(), setInterval, clearInterval })
  mocks.call.mockReset()
})
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; vi.unstubAllGlobals() })
it('composer prepare mode saves locally and attaches without publishing', async () => {
  const prepared = vi.fn(), close = vi.fn()
  mocks.call.mockImplementation(async (operation: string) => operation === 'provider.capabilities' ? { features: { markdownLongArticles: false } } : undefined)
  await act(async () => { renderer = create(<ArkmeLongArticleDialog sourceRef="chat" onClose={close} onPrepared={prepared} />) })
  act(() => { renderer!.root.findByProps({ 'aria-label': '长文标题' }).props.onChange({ target: { value: '新长文' } }); renderer!.root.findByProps({ 'aria-label': '长文正文' }).props.onChange({ target: { value: '原有正文' } }) })
  const attach = renderer!.root.findAllByType('button').find(node => node.children.some(value => typeof value === 'string' && value.includes('添加到待发送')))!
  await act(async () => { attach.props.onClick() })
  expect(prepared).toHaveBeenCalledWith(expect.objectContaining({ title: '新长文', textContent: '原有正文', recordUid: expect.any(String), relationUid: expect.any(String) }))
  expect(close).toHaveBeenCalledOnce()
  expect(mocks.call.mock.calls.some(([operation]) => operation === 'source.long-article.draft.put')).toBe(true)
  expect(mocks.call.mock.calls.some(([operation]) => operation === 'source.long-article.publish' || operation === 'source.send-rich' || operation === 'source.long-article.draft.delete')).toBe(false)
})
it.each(['pending', 'disabled', 'failed'])('does not publish restored image drafts through plain text when capability is %s', async state => {
  mocks.call.mockImplementation(async (operation: string) => {
    if (operation === 'provider.capabilities') {
      if (state === 'pending') return new Promise(() => {})
      if (state === 'failed') throw new Error('能力查询失败')
      return { features: { markdownLongArticles: false } }
    }
    if (operation === 'source.long-article.draft.get') return {
      title: '图片草稿', textContent: '![图](arkme-local:arkme-file-v1.11111111-1111-1111-1111-111111111111)', textFormat: 'markdown', durationMillis: 0,
      images: [{ fileRef: 'arkme-file-v1.11111111-1111-1111-1111-111111111111' }],
    }
  })
  await act(async () => { renderer = create(<ArkmeLongArticleDialog sourceRef="source" onClose={() => {}} />); await Promise.resolve() })
  const publish = renderer!.root.find(node => node.type === 'button' && node.children.some(value => typeof value === 'string' && value.includes('发布')))
  expect(publish.props.disabled).toBe(true)
  await act(async () => { publish.props.onClick(); await Promise.resolve() })
  expect(mocks.call.mock.calls.some(([operation]) => operation === 'source.send-rich' || operation === 'source.long-article.publish')).toBe(false)
})
it('keeps the original draft version and refuses to overwrite newer content', async () => {
  mocks.call.mockImplementation(async (operation: string) => {
    if (operation === 'provider.capabilities') return { features: { markdownLongArticles: false } }
    if (operation === 'source.long-article.detail') return { itemUid: 'record', title: '新标题', textContent: '手机修改', textFormat: 'plain', editable: true, version: 2, editDurationMillis: 0 }
    if (operation === 'source.long-article.draft.get') return { title: '旧草稿', textContent: '旧正文', textFormat: 'plain', baseVersion: 1, durationMillis: 0 }
  })
  await act(async () => { renderer = create(<ArkmeLongArticleDialog sourceRef="source" item={{ itemUid: 'record' } as never} onClose={() => {}} />) })
  const edit = renderer!.root.find(node => node.type === 'button' && node.children.some(value => typeof value === 'string' && value.includes('编辑')))
  await act(async () => { edit.props.onClick() })
  const publish = renderer!.root.find(node => node.type === 'button' && node.children.some(value => typeof value === 'string' && value.includes('发布')))
  await act(async () => { publish.props.onClick() })
  expect(mocks.call.mock.calls.some(([operation]) => operation === 'source.long-article.update')).toBe(false)
  expect(JSON.stringify(renderer!.toJSON())).toContain('此草稿基于旧版本')
})
