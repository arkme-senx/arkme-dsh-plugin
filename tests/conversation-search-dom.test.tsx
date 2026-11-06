// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeConversationSearchPanel } from '../src/client/ArkmeConversationSearch.js'
import { callArkme } from '../src/client/api.js'
import { closeAttachmentPreview } from '../src/client/attachment-preview-window.js'
import { bindAttachmentPreviewAccount } from '../src/client/attachment-preview-auth-binding.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import type { ArkmeSourceItem } from '../src/types.js'
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: vi.fn() }))
const source: ArkmeSourceItem = { sourceRef: 'signed-chat', kind: 'group_chat', displayName: '群聊', activeAtMillis: 1, unreadCount: 0 }
let host: HTMLDivElement, root: Root
let mediaKind: 'image' | 'video' = 'image'
const close = vi.fn()
const find = (label: string) => host.querySelector(`[aria-label="${label}"]`) as HTMLElement
const click = async (label: string) => { expect(find(label)).not.toBeNull(); await act(async () => { find(label).dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
beforeEach(() => {
  mediaKind = 'image'
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.mocked(callArkme).mockReset().mockImplementation(async operation => {
    if (operation === 'source.timeline-around') return { items: [{ itemUid: 'record', title: '', status: 1, senderName: '作者', textContent: '原消息', sendAtMillis: 1,
      contentBlocks: ['a', 'b'].map(id => ({ kind: mediaKind, fileAssetUid: id, mediaRef: id, fileName: id, mimeType: 'image/png', size: 1, sortOrder: 0 })),
    }] } as never
    if (operation === 'search.scene') return { items: [{ recordUid: 'record', recordOwnerUserId: 77, sourceKind: 3, sourceUid: 'chat', routeTargetKind: 'chat_timeline', targetSource: source,
      sendAtMillis: 1, title: '', textContent: '', snippet: '', media: ['a', 'b'].map(id => ({ fileAssetUid: id, fileName: id })), files: [],
    }], sourceAggregates: [], hasMore: false, queryGuard: { state: 'complete' } } as never
    throw new Error(`unexpected operation: ${operation}`)
  })
})
afterEach(async () => { await act(async () => { closeAttachmentPreview(); root.unmount() }); host.remove(); delete (window as any).arkmeAttachmentPreview; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('uses the shared independent preview window and keeps its snapshot after search closes', async () => {
  const previewDocument = document.implementation.createHTMLDocument('')
  const events = new EventTarget()
  const child = { document: previewDocument, closed: false, focus: vi.fn(), close() { this.closed = true; events.dispatchEvent(new Event('beforeunload')) }, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) }
  vi.spyOn(window, 'open').mockReturnValue(child as unknown as Window)
  const bridge = { version: 1, focus: vi.fn(), close: vi.fn() }; (window as any).arkmeAttachmentPreview = bridge
  await act(async () => root.render(<ArkmeConversationSearchPanel source={source} scene="image_video" global={false} onScene={() => {}} onGlobal={() => {}} onClose={close} />))
  await act(async () => vi.advanceTimersByTimeAsync(0))
  const results = find('聊天搜索结果'); results.scrollTop = 120
  await click('查看图片 a')
  expect(window.open).toHaveBeenCalledTimes(1)
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(previewDocument.querySelector('[aria-label="a"]')?.getAttribute('role')).toBe('dialog')
  expect(find('聊天搜索结果')).toBe(results); expect(results.scrollTop).toBe(120)
  expect(document.body.style.overflow).not.toBe('hidden')
  await act(async () => root.render(<div>另一个对话</div>))
  await act(async () => previewDocument.querySelector('[aria-label="下一个媒体"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  expect(previewDocument.querySelector('[aria-label="b"]')?.getAttribute('role')).toBe('dialog')
  expect(vi.mocked(callArkme).mock.calls.filter(([op]) => op === 'source.timeline-around')).toHaveLength(1)
  await act(async () => previewDocument.querySelector('[aria-label="b"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(child.closed).toBe(true); expect(bridge.close).toHaveBeenCalled()
})

it.each(['close', 'logout'] as const)('cancels cross-message reads on %s and never reopens for a late response', async end => {
  const doc = document.implementation.createHTMLDocument('')
  const events = new EventTarget()
  const child = { document: doc, closed: false, focus() {}, close() { this.closed = true; events.dispatchEvent(new Event('beforeunload')) }, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) }
  vi.spyOn(window, 'open').mockReturnValue(child as unknown as Window)
  ;(window as any).arkmeAttachmentPreview = { version: 1, focus() {}, close() {} }
  arkmeAuthStore.setAuth({status:'authenticated',environment:'prod',userId:42})
  const unbind = bindAttachmentPreviewAccount()
  const pending: Array<{signal:AbortSignal;resolve(value:unknown):void}> = []
  vi.mocked(callArkme).mockImplementation(async (operation, params, signal) => {
    if (operation === 'source.timeline-around') {
      if ((params as any).itemUid === 'two') return await new Promise(resolve => pending.push({signal:signal!,resolve})) as never
      return {items:[{itemUid:'one',contentBlocks:[{kind:'image',fileAssetUid:'one',mediaRef:'one',fileName:'one'}]}]} as never
    }
    if(operation === 'search.scene') return {items:['one','two'].map(id=>({recordUid:id,recordOwnerUserId:77,sourceKind:3,sourceUid:'chat',targetSource:source,sendAtMillis:1,title:'',textContent:'',snippet:'',files:[],media:[{fileAssetUid:id,fileName:id}]})),sourceAggregates:[],hasMore:false,queryGuard:{state:'complete'}} as never
    throw new Error(`unexpected ${operation}`)
  })
  try {
    await act(async()=>root.render(<ArkmeConversationSearchPanel source={source} scene="image_video" global={false} onScene={()=>{}} onGlobal={()=>{}} onClose={close}/>))
    await act(async()=>vi.advanceTimersByTimeAsync(0))
    await click('查看图片 one')
    await act(async()=>root.render(<div>搜索已关闭</div>))
    await act(async()=>doc.querySelector('[aria-label="one"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})))
    expect(doc.body.textContent).toContain('加载详情')
    expect(doc.querySelector<HTMLButtonElement>('[aria-label="上一个媒体"]')!.disabled).toBe(false)
    const read = pending.at(-1)!
    expect(read.signal.aborted).toBe(false)
    if(end === 'logout') await act(async()=>arkmeAuthStore.setAuth({status:'logged-out',environment:'prod'}))
    else await act(async()=>child.close())
    expect(read.signal.aborted).toBe(true)
    await act(async()=>read.resolve({items:[{itemUid:'two',contentBlocks:[{kind:'image',fileAssetUid:'two',mediaRef:'late'}]}]}))
    expect(child.closed).toBe(true); expect(doc.body.textContent).toBe('')
    expect(window.open).toHaveBeenCalledTimes(1)
  } finally { await act(async()=>unbind()) }
})

it('retries a missing sibling from fresh detail and honors a repeated click after window navigation', async () => {
  const doc = document.implementation.createHTMLDocument('')
  const events = new EventTarget()
  const child = { document: doc, closed: false, focus() {}, close() { this.closed = true; events.dispatchEvent(new Event('beforeunload')) }, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) }
  vi.spyOn(window, 'open').mockReturnValue(child as unknown as Window)
  ;(window as any).arkmeAttachmentPreview = { version: 1, focus() {}, close() {} }
  const original = vi.mocked(callArkme).getMockImplementation()!
  let reads = 0
  vi.mocked(callArkme).mockImplementation(async (...args) => {
    if(args[0] !== 'source.timeline-around') return original(...args)
    return {items:[{itemUid:'record',contentBlocks:(++reads===1?['a']:['a','b']).map(id=>({kind:'image',fileAssetUid:id,mediaRef:id,fileName:id}))}]} as never
  })
  await act(async()=>root.render(<ArkmeConversationSearchPanel source={source} scene="image_video" global={false} onScene={()=>{}} onGlobal={()=>{}} onClose={close}/>))
  await act(async()=>vi.advanceTimersByTimeAsync(0))
  await click('查看图片 a')
  await act(async()=>doc.querySelector('[aria-label="下一个媒体"]')!.dispatchEvent(new MouseEvent('click',{bubbles:true})))
  expect(doc.body.textContent).toContain('媒体暂不可访问')
  await act(async()=>Array.from(doc.querySelectorAll('button')).find(button=>button.textContent==='重试')!.click())
  expect(reads).toBe(2)
  expect(doc.querySelector('[aria-label="b"]')?.getAttribute('role')).toBe('dialog')
  await act(async()=>root.render(<div>关闭搜索</div>))
  await act(async()=>root.render(<ArkmeConversationSearchPanel source={source} scene="image_video" global={false} onScene={()=>{}} onGlobal={()=>{}} onClose={close}/>))
  await act(async()=>vi.advanceTimersByTimeAsync(0))
  await click('查看图片 a')
  expect(doc.querySelector('[aria-label="a"]')?.getAttribute('role')).toBe('dialog')
  expect(window.open).toHaveBeenCalledTimes(1)
})

it('also reuses the message-list window when an image is opened inside a searched message', async () => {
  const doc=document.implementation.createHTMLDocument(''),events=new EventTarget()
  const child={document:doc,closed:false,focus(){},close(){this.closed=true;events.dispatchEvent(new Event('beforeunload'))},addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)}
  vi.spyOn(window,'open').mockReturnValue(child as unknown as Window)
  ;(window as any).arkmeAttachmentPreview={version:1,focus(){},close(){}}
  const original=vi.mocked(callArkme).getMockImplementation()!
  vi.mocked(callArkme).mockImplementation(async(...args)=>{
    const value=await original(...args) as any
    if(args[0]==='search.scene') value.items[0].media=[]
    return value
  })
  await act(async()=>root.render(<ArkmeConversationSearchPanel source={source} scene="image_video" global={false} onScene={()=>{}} onGlobal={()=>{}} onClose={close}/>))
  await act(async()=>vi.advanceTimersByTimeAsync(0))
  await act(async()=>Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='查看媒体消息')!.click())
  await click('预览图片 a')
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(doc.querySelector('[aria-label="a"]')?.getAttribute('role')).toBe('dialog')
  expect(window.open).toHaveBeenCalledTimes(1)
})
it.each(['image', 'video'] as const)('keeps %s preview focus and navigation inside the modal and Escape restores search', async kind => {
  mediaKind = kind
  await act(async () => root.render(<ArkmeConversationSearchPanel source={source} scene="image_video" global={false} onScene={() => {}} onGlobal={() => {}} onClose={close} />))
  await act(async () => vi.advanceTimersByTimeAsync(0))
  const results = find('聊天搜索结果')
  results.scrollTop = 120
  await click(`查看${kind === 'image' ? '图片' : '视频'} a`)
  expect(find('a')?.getAttribute('role')).toBe('dialog')
  expect(find('a').contains(document.activeElement)).toBe(true)
  await act(async () => { find('a').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })) })
  expect(find('a')?.getAttribute('role')).toBe('dialog')
  const buttons = find('a').querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
  const first = buttons[0]!, last = buttons[buttons.length - 1]!
  await act(async () => {
    last.focus()
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  })
  expect(document.activeElement).toBe(first)
  await act(async () => { first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })) })
  expect(document.activeElement).toBe(last)
  expect(results.hidden).toBe(false)
  expect(results.style.display).not.toBe('none')
  expect(host.textContent).not.toContain('原消息')
  expect(host.textContent).not.toContain('返回结果')
  expect(host.textContent).not.toContain('定位到消息')
  await click('下一个媒体')
  expect(find('b')?.getAttribute('role')).toBe('dialog')
  expect(close).not.toHaveBeenCalled()
  await act(async () => { find('下一个媒体').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(host.querySelector('[aria-modal="true"]')).toBeNull()
  expect(find('聊天搜索结果')).toBe(results)
  expect(results.hidden).toBe(false)
  expect(results.scrollTop).toBe(120)
  expect(document.activeElement).toBe(find('搜索聊天关键词'))
  expect(document.body.style.overflow).not.toBe('hidden')
  expect(close).not.toHaveBeenCalled()
})
