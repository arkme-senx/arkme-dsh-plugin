import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeLongArticleDialog } from '../src/client/ArkmeLongArticleDialog.js'
import type { ArkmeLongArticleDraft } from '../src/types.js'
import { ArkmeLongArticleWindow } from '../src/client/ArkmeLongArticleWindow.js'
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
  await act(async () => { renderer = create(<ArkmeLongArticleDialog sourceRef="chat" windowMode={mode} sendOnConfirm onClose={close} />) })
  act(() => { renderer!.root.findByProps({ 'aria-label': '长文标题' }).props.onChange({ target: { value: '标题' } }); renderer!.root.findByProps({ 'aria-label': '长文正文' }).props.onChange({ target: { value: '正文' } }) })
  return close
}
function button(label: string) { return renderer!.root.findAllByType('button').find(node => node.children.includes(label))! }
it('keeps composer draft state in the compact metadata row without a duration clock', async () => {
  vi.useFakeTimers()
  try {
    await mount()
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(JSON.stringify(renderer!.toJSON())).toContain('草稿已保存')
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('◷')
    act(() => renderer!.root.findByProps({ 'aria-label': '长文正文' }).props.onChange({ target: { value: '继续编辑' } }))
    expect(JSON.stringify(renderer!.toJSON())).toContain('未保存')
  } finally { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; vi.useRealTimers() }
})
it('native close allows continuing to edit without deleting the draft', async () => {
  const close = await mount(); act(() => requestClose());
  expect(JSON.stringify(renderer!.toJSON())).toContain('产品群')
  act(() => renderer!.root.findByProps({ 'aria-label': '关闭草稿确认弹窗' }).props.onClick())
  expect(renderer!.root.findAllByProps({ role: 'alertdialog' })).toHaveLength(0)
  expect(renderer!.root.findByProps({ 'aria-label': '长文正文' }).props.value).toBe('正文')
  expect(close).not.toHaveBeenCalled(); expect(cancelClose).toHaveBeenCalled()
  expect(mocks.call.mock.calls.some(([op]) => op === 'source.long-article.draft.delete')).toBe(false)
})
it('keeps the window open when draft saving fails, then permits retry', async () => {
  const close = await mount();
  mocks.call.mockImplementation(async (operation: string) => { if (operation === 'source.long-article.draft.put') throw new Error('磁盘不可用') })
  act(() => requestClose()); await act(async () => { button('保存草稿').props.onClick(); await Promise.resolve() })
  expect(close).not.toHaveBeenCalled(); expect(JSON.stringify(renderer!.toJSON())).toContain('磁盘不可用')
  mocks.call.mockResolvedValue(undefined)
  await act(async () => { button('保存草稿').props.onClick() })
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
  expect(button('保存草稿').props.disabled).toBe(true)
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
async function existing(editable: boolean, draft?: ArkmeLongArticleDraft) {
 const detail = { ...existingItem, sourceRef: 'chat', version: 4, editable, updateAtMillis: 1, recordDurationMillis: 0, editDurationMillis: 0, thinkingDurationMillis: 0 }
 mocks.call.mockImplementation(async (op: string) => op === 'auth.status' ? { status: 'authenticated', userId: 7, environment: 'prod' } : op === 'provider.capabilities' ? { features: { markdownLongArticles: false } } : op === 'source.long-article.draft.get' ? draft : op === 'source.long-article.detail' ? detail : op === 'source.long-article.update' ? { ...detail, title: '修改后', version: 5 } : undefined)
 const close = vi.fn(), updated = vi.fn(async () => true)
 vi.stubGlobal('document', { title: '' })
 vi.stubGlobal('arkmeLongArticle', {
   version: 2,
   context: async () => ({ accountKey: 'prod:7', sourceKey: 'chat:A', sourceRef: 'chat', displayName: '产品群', article: { mode: 'existing', item: existingItem } }),
   active: async () => true, onInvalidated: () => () => {},
   onClose: mode.subscribeClose, cancelClose, close, published: updated,
 })
 await act(async () => { renderer = create(<ArkmeLongArticleWindow />) })
 return { close, updated }
}
it('opens an owned article editing immediately and flushes on native close', async () => {
 const { close, updated } = await existing(true)
 expect(renderer!.root.findAllByProps({ 'aria-label': '长文标题' })).toHaveLength(1)
 expect(renderer!.root.findAllByProps({ 'aria-label': '长文正文' })).toHaveLength(1)
 expect(button('确认修改')).toBeUndefined()
 expect(renderer!.root.findByProps({ 'aria-label': '长文正文' }).props.value).toBe('原正文')
 expect(renderer!.root.findByProps({ 'aria-label': '长文标题' }).props.value).toBe('原标题')
 act(() => renderer!.root.findByProps({ 'aria-label': '长文标题' }).props.onChange({ target: { value: '修改后' } }))
 await act(async () => requestClose())
 expect(mocks.call).toHaveBeenCalledWith('source.long-article.update', expect.objectContaining({ itemUid: 'original', version: 4, title: '修改后' }))
 expect(mocks.call.mock.calls.some(([op]) => op === 'source.send-rich' || op === 'source.long-article.publish')).toBe(false)
 expect(updated).toHaveBeenCalledWith(expect.objectContaining({ version: 5 }))
 expect(close).toHaveBeenCalledOnce()
})
it('keeps originals without edit permission read only', async () => {
 await existing(false)
 expect(renderer!.root.findAllByProps({ 'aria-label': '长文标题' })).toHaveLength(0)
 expect(button('确认修改')).toBeUndefined()
 expect(button('✎ 编辑')).toBeUndefined()
 expect(JSON.stringify(renderer!.toJSON())).toContain('只读')
})
it('retains original edits when saving fails', async () => {
 const { close } = await existing(true)
 mocks.call.mockRejectedValue(new Error('版本冲突'))
 act(() => renderer!.root.findByProps({ 'aria-label': '长文标题' }).props.onChange({ target: { value: '本地修改' } }))
 await act(async () => requestClose())
 expect(close).not.toHaveBeenCalled()
 expect(renderer!.root.findByProps({ 'aria-label': '长文标题' }).props.value).toBe('本地修改')
 expect(JSON.stringify(renderer!.toJSON())).toContain('版本冲突')
})

const recoveryDraft: ArkmeLongArticleDraft = { sourceRef: 'chat', itemUid: 'original', baseVersion: 4, title: '草稿标题', textContent: '草稿正文', durationMillis: 5000, updatedAtMillis: new Date(2026, 8, 29, 11, 20, 30).getTime() }
it('previews the saved draft without editing, then restores it explicitly', async () => {
 await existing(true, recoveryDraft)
 expect(renderer!.root.findByProps({ role: 'dialog', 'aria-label': '发现未发布的草稿' })).toBeDefined()
 expect(renderer!.root.findByType('time').children).toEqual(['2026-09-29 11:20:30'])
 act(() => renderer!.root.findByProps({ 'aria-label': '预览草稿' }).props.onClick())
 expect(JSON.stringify(renderer!.toJSON())).toContain('草稿正文')
 expect(renderer!.root.findAllByProps({ 'aria-label': '长文正文' })).toHaveLength(0)
 act(() => button('返回').props.onClick())
 expect(renderer!.root.findAllByProps({ 'aria-label': '草稿预览' })).toHaveLength(0)
 await act(async () => button('恢复草稿').props.onClick())
 expect(renderer!.root.findByProps({ 'aria-label': '长文标题' }).props.value).toBe('草稿标题')
 expect(renderer!.root.findByProps({ 'aria-label': '长文正文' }).props.value).toBe('草稿正文')
})
it('cancels recovery without deleting the draft and can choose the published original', async () => {
 await existing(true, recoveryDraft)
 act(() => renderer!.root.findByProps({ 'aria-label': '关闭草稿恢复弹窗' }).props.onClick())
 expect(renderer!.root.findByProps({ 'aria-label': '长文正文' }).props.value).toBe('原正文')
 expect(mocks.call.mock.calls.some(([op]) => op === 'source.long-article.draft.delete' || op === 'source.long-article.draft.put')).toBe(false)
 expect(renderer!.root.findByProps({ 'aria-label': '长文正文' }).props.value).toBe('原正文')
})
it('previews Markdown and a local draft image without enabling the editor', async () => {
 const fileRef = 'arkme-file-v1.11111111-1111-1111-1111-111111111111'
 await existing(true, { ...recoveryDraft, textFormat: 'markdown', textContent: `**草稿加粗**\n\n![图片](arkme-local:${fileRef})`, images: [{ fileRef }] })
 act(() => renderer!.root.findByProps({ 'aria-label': '预览草稿' }).props.onClick())
 expect(renderer!.root.findByType('strong').findAll(node => node.children.includes('草稿加粗')).length).toBeGreaterThan(0)
 expect(renderer!.root.findByType('img').props.src).toContain(`/files/local?ref=${fileRef}`)
 expect(renderer!.root.findAllByProps({ 'aria-label': '长文正文' })).toHaveLength(0)
 act(() => renderer!.root.findByProps({ 'aria-label': '关闭草稿预览' }).props.onClick())
 expect(renderer!.root.findByProps({ 'aria-label': '预览草稿' })).toBeDefined()
})

it('the original native editor retains its scoped team draft and sends that explicit identity', async()=>{
 const {arkmeAuthStore}=await import('../src/client/auth-store.js')
 arkmeAuthStore.setAuth({status:'authenticated',userId:7,environment:'prod'})
 const representation={teamRef:'sealed-team',membershipKind:'member' as const,membershipRevision:3,groupJoinAt:9}
 const nativeTarget={accountKey:'prod:7',sourceKey:'chat:A',sourceRef:'chat',displayName:'产品群 · 我 · 团队',composition:{draftScope:'team',representation}}
 const published=vi.fn(async()=>true)
 const accepted={itemUid:'accepted-article',senderName:'我',isMe:true,sendAtMillis:1,status:1,representation:{...representation,name:'团队',jotmoId:'team_7'}}
 mocks.call.mockImplementation(async(op:string,params:any)=>op==='auth.status'?{status:'authenticated',userId:7,environment:'prod'}:op==='provider.capabilities'?{features:{markdownLongArticles:false}}:op==='source.send-rich'?{sourceRef:'chat',itemUid:accepted.itemUid,status:1,sequence:9,localState:'synced',messageActionRef:'accepted-action'}:op==='source.long-article.detail'?{sourceRef:'chat',...accepted,title:'标题',textContent:'正文',actionItem:accepted}:undefined)
 vi.stubGlobal('document',{title:''})
 vi.stubGlobal('arkmeLongArticle',{version:3,context:async()=>nativeTarget,active:async()=>true,onInvalidated:()=>()=>{},onClose:mode.subscribeClose,cancelClose,close:vi.fn(),published})
 await act(async()=>{renderer=create(<ArkmeLongArticleWindow/>)})
 expect(renderer!.root.findByType(ArkmeLongArticleDialog).props.representation).toEqual(representation)
 expect(renderer!.root.findByType(ArkmeLongArticleDialog).props.draftScope).toBe('team')
 act(()=>{renderer!.root.findByProps({'aria-label':'长文标题'}).props.onChange({target:{value:'标题'}});renderer!.root.findByProps({'aria-label':'长文正文'}).props.onChange({target:{value:'正文'}})})
 await act(async()=>button('发送').props.onClick())
 expect(mocks.call).toHaveBeenCalledWith('source.send-rich',expect.objectContaining({sourceRef:'chat',representation,sendAtMillis:expect.any(Number)}))
 expect(mocks.call).toHaveBeenCalledWith('source.long-article.draft.delete',expect.objectContaining({sourceRef:'chat',draftScope:'team'}))
 expect(mocks.call).toHaveBeenCalledWith('source.long-article.detail',expect.objectContaining({messageActionRef:'accepted-action'}))
 expect(published).toHaveBeenCalledWith(expect.objectContaining({itemUid:accepted.itemUid,representation:accepted.representation,sequence:9,messageActionRef:'accepted-action'}))
})
