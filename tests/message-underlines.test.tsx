// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { readUnderlineSnapshot, acceptUnderlineSnapshot, underlineCapabilities, type MessageUnderlineSnapshot } from '../src/message-annotations.js'
import { MessageUnderlineSession, underlineTargetKey } from '../src/client/message-underline-session.js'
import { mergeUnderlinePositions, type MarkPosition } from '../src/client/ArkmeMessageUnderlines.js'
import { callArkme } from '../src/client/api.js'
import type { MessageSelectionTarget } from '../src/client/ArkmeMessageTextSelection.js'
vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
const anchor = { version: 1, projection: 'arkme-text-v1', sourceDigest: 'a'.repeat(64), start: 0, end: 2, text: '重点', prefix: '', suffix: '' } as const
const target: MessageSelectionTarget = { sourceRef: 'self', item: { itemUid: 'note', recordOwnerUserId: 42, messageActionRef: 'ref', isMe: true, status: 1, title: '', textContent: '重点', senderName: '我', sendAtMillis: 1 } }
const mark = { id: 'mine', actorId: 42, actorName: '你', mine: true, anchor, state: 'available' as const }
const initial: MessageUnderlineSnapshot = { revision: 1, accessible: true, items: [mark, { ...mark, id: 'other', actorId: 7, actorName: '宏顺', mine: false }] }
const deferred = <T,>() => { let resolve!: (v:T)=>void, reject!: (e:unknown)=>void; const promise = new Promise<T>((r,j)=>{resolve=r;reject=j}); return {promise,resolve,reject} }
beforeEach(() => { vi.mocked(callArkme).mockReset() })
it('requires a versioned capability and derives mine from authenticated viewer', () => {
  expect(underlineCapabilities({ enabled:true })).toMatchObject({supported:false})
  expect(underlineCapabilities({ enabled:true,protocol_version:1,projection:'arkme-text-v1',max_length:9000 })).toEqual({supported:true,maxLength:2000})
  const wire = { complete:true, accessible:true, revision:2, annotations:[{ annotation_uid:'a',actor_user_id:7,actor_name:'宏顺',anchor,state:'available',mine:true }] }
  expect(readUnderlineSnapshot(wire,42).items[0]?.mine).toBe(false)
  expect(readUnderlineSnapshot({...wire,accessible:false},42).items).toEqual([])
  expect(()=>readUnderlineSnapshot({...wire,complete:false},42)).toThrow()
  expect(()=>readUnderlineSnapshot({...wire,annotations:[...wire.annotations,...wire.annotations]},42)).toThrow()
})
it('keeps newer and pending snapshots but removes revoked content immediately', () => {
  expect(acceptUnderlineSnapshot(initial,{...initial,revision:0,items:[]})).toBe(initial)
  expect(acceptUnderlineSnapshot(initial,{...initial,revision:3,items:[]},true)).toBe(initial)
  expect(acceptUnderlineSnapshot(initial,{...initial,accessible:false},true)?.items).toEqual([])
})
it('renders shared overlaps as one background per span with all relevant authors', () => {
  const base: MarkPosition = {key:'a',target,ids:['mine'],left:10,top:10,width:30,height:20,stale:false,pending:false}
  const merged = mergeUnderlinePositions([base,{...base,key:'b',ids:['other'],left:30,width:30}])
  expect(merged.map(p=>[p.left,p.width,p.ids])).toEqual([[10,20,['mine']],[30,10,['mine','other']],[40,20,['other']]])
})
it('keeps the same message in list and detail as independent hit-test surfaces', () => {
  const base: MarkPosition={key:'a',target,ids:['mine'],left:10,top:10,width:30,height:20,stale:false,pending:false}
  const merged=mergeUnderlinePositions([{...base,element:document.createElement('div')},{...base,element:document.createElement('div')}])
  expect(merged).toHaveLength(2)
  expect(merged[0]?.element).not.toBe(merged[1]?.element)
})
it('local cancellation removes only mine and rolls back failure with the same retry id', async () => {
  const session = new MessageUnderlineSession('self',42,vi.fn(),'local'); session.capability = {supported:true,maxLength:2000}; session.snapshots.set(underlineTargetKey(target),initial)
  const response = deferred<MessageUnderlineSnapshot>(); vi.mocked(callArkme).mockReturnValueOnce(response.promise)
  const mutation = session.change(target,{kind:'remove',annotationId:'mine',operationId:'stable'})
  expect(session.snapshots.get(underlineTargetKey(target))?.items.map(i=>i.id)).toEqual(['other'])
  response.reject(new Error('network')); await mutation
  expect(session.snapshots.get(underlineTargetKey(target))).toBe(initial)
  vi.mocked(callArkme).mockResolvedValueOnce({...initial,revision:2,items:[initial.items[1]!]}); await session.retry?.()
  expect(vi.mocked(callArkme).mock.calls[1]?.[1]).toMatchObject({change:{operationId:'stable'}})
  expect(session.snapshots.get(underlineTargetKey(target))?.items.map(i=>i.id)).toEqual(['other'])
  await expect(session.change(target,{kind:'remove',annotationId:'other',operationId:'new'})).rejects.toThrow('只能取消')
})
it('shows an optimistic add before the response and prevents stale reads undoing it', async () => {
  const session = new MessageUnderlineSession('self',42,vi.fn()); session.capability={supported:true,maxLength:2000}
  const read = deferred<unknown>(), write = deferred<unknown>(); vi.mocked(callArkme).mockReturnValueOnce(read.promise).mockReturnValueOnce(write.promise)
  const reading = session.read([target]), writing = session.change(target,{kind:'add',anchor,operationId:'op'})
  expect(session.snapshots.get(underlineTargetKey(target))?.items[0]).toMatchObject({pending:true,anchor})
  write.resolve({...initial,revision:5}); await writing
  read.resolve([{actionRef:'ref',snapshot:{revision:0,accessible:true,items:[]}}]); await reading
  expect(session.snapshots.get(underlineTargetKey(target))?.revision).toBe(5)
})
it('does not write when unsupported, and ignores completion after scope disposal', async () => {
  const session = new MessageUnderlineSession('self',42,vi.fn())
  await expect(session.change(target,{kind:'add',anchor,operationId:'op'})).rejects.toThrow('确认')
  expect(callArkme).not.toHaveBeenCalled()
  session.capability={supported:true,maxLength:2000}; const response=deferred<unknown>(); vi.mocked(callArkme).mockReturnValueOnce(response.promise)
  const writing=session.change(target,{kind:'add',anchor,operationId:'op'}); session.dispose(); response.resolve(initial); await writing
  expect(session.snapshots.size).toBe(0)
})
it.each(['arkme-code-2001', 'arkme-network-error'])('cloud cancellation clears unverified text on %s and retries its original operation after a fresh read', async code => {
  const session = new MessageUnderlineSession('self',42,vi.fn(),'cloud')
  session.capability = {supported:true,maxLength:2000}
  session.snapshots.set(underlineTargetKey(target),initial)
  vi.mocked(callArkme).mockRejectedValueOnce(Object.assign(new Error('source unavailable'),{body:{code,httpStatus:502}}))
  await session.change(target,{kind:'remove',annotationId:'mine',operationId:'original'})
  expect(session.snapshots.size).toBe(0)
  vi.mocked(callArkme).mockResolvedValueOnce([{actionRef:'ref',snapshot:initial}])
    .mockResolvedValueOnce({...initial,revision:2,items:[initial.items[1]!]})
  await session.retry?.()
  expect(vi.mocked(callArkme).mock.calls[1]?.[0]).toBe('source.message-underline.list')
  expect(vi.mocked(callArkme).mock.calls[2]?.[1]).toMatchObject({change:{operationId:'original'}})
  expect(session.snapshots.get(underlineTargetKey(target))?.items.map(item=>item.id)).toEqual(['other'])
  session.dispose()
})
it.each(['add', 'remove'] as const)('settles a lost %s response when a fresh owner snapshot already confirms the requested state', async kind => {
  const session = new MessageUnderlineSession('self',42,vi.fn(),'cloud')
  session.capability = {supported:true,maxLength:2000}
  session.snapshots.set(underlineTargetKey(target), kind === 'remove' ? initial : {...initial,items:[initial.items[1]!]})
  const change = kind === 'remove'
    ? {kind,annotationId:'mine',operationId:'lost'} as const
    : {kind,anchor,operationId:'lost'} as const
  vi.mocked(callArkme).mockRejectedValueOnce(new Error('response lost'))
  await session.change(target,change)
  const confirmed = {...initial,revision:2,items:kind === 'remove' ? [initial.items[1]!] : initial.items.map(item => ({...item,anchor:{...item.anchor,recordVersion:1}}))}
  vi.mocked(callArkme).mockResolvedValueOnce([{actionRef:'ref',snapshot:confirmed}])
  await session.retry?.()
  expect(session.snapshots.get(underlineTargetKey(target))).toEqual(confirmed)
  expect(session.notice).toBe('')
  expect(session.retry).toBeUndefined()
  expect(callArkme).toHaveBeenCalledTimes(2)
  session.dispose()
})
it.each(['denied', 'failed'] as const)('does not interpret a %s access read as successful cancellation', async state => {
  const session = new MessageUnderlineSession('self',42,vi.fn(),'cloud')
  session.capability = {supported:true,maxLength:2000}
  session.snapshots.set(underlineTargetKey(target),initial)
  vi.mocked(callArkme).mockRejectedValueOnce(new Error('response lost'))
  await session.change(target,{kind:'remove',annotationId:'mine',operationId:'lost'})
  if (state === 'denied') vi.mocked(callArkme).mockResolvedValueOnce([{actionRef:'ref',snapshot:{revision:0,accessible:false,items:[]}}])
  else vi.mocked(callArkme).mockRejectedValueOnce(new Error('access lookup failed'))
  await session.retry?.()
  expect(session.notice).not.toBe('')
  expect(session.retry).toBeDefined()
  expect(callArkme).toHaveBeenCalledTimes(2)
  expect(session.snapshots.get(underlineTargetKey(target))?.items ?? []).toEqual([])
  session.dispose()
})
it.each([false,true])('paints background (native=%s) and opens the shared toolbar with exact own cancellation', async (native) => {
  const {act}=await import('react'),{createRoot}=await import('react-dom/client'),{webcrypto}=await import('node:crypto')
  const {UnderlineLayer}=await import('../src/client/ArkmeMessageUnderlines.js')
  const {ArkmeMessageTextSelectionToolbar}=await import('../src/client/ArkmeMessageTextSelection.js')
  const remove=vi.fn(async()=>undefined), reply=vi.fn(),add=vi.fn(async()=>undefined)
  const {ArkmeMessageContent}=await import('../src/client/ArkmeRichContent.js')
  const {quoteDigest}=await import('../src/client/message-quote-selection.js')
  const waitForUi = async (check: () => void) => {
    // Flush React after WebCrypto/frame work, then assert its observable result.
    await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }); check() })
  }
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('crypto',webcrypto)
  const highlights=new Map<string,Set<Range>>()
  if(native){ vi.stubGlobal('CSS',{highlights});vi.stubGlobal('Highlight',class extends Set<Range>{constructor(...ranges:Range[]){super(ranges)}}) }
  vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}})
  const rect=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue(new DOMRect(20,50,200,60))
  const clientRects=Object.getOwnPropertyDescriptor(Range.prototype,'getClientRects')
  Range.prototype.getClientRects=()=>[new DOMRect(20,50,100,20)] as unknown as DOMRectList
  const originalPoint=document.elementFromPoint;document.elementFromPoint=()=>null
  const dom=document.createElement('div');document.body.append(dom);const root=createRoot(dom)
  const actual={...anchor,sourceDigest:await quoteDigest(target.item)}
  const snapshot={...initial,items:initial.items.map(item=>({...item,anchor:actual}))}
  const session=new MessageUnderlineSession('self',42,vi.fn());session.capability={supported:true,maxLength:2000};session.snapshots.set(underlineTargetKey(target),snapshot)
  vi.mocked(callArkme).mockResolvedValue([{actionRef:'ref',snapshot}])
  const renderFixture=(key:number)=><><ArkmeMessageContent key={key} item={target.item} sourceRef="self"/><UnderlineLayer session={session} revision={1}/><ArkmeMessageTextSelectionToolbar markStorage="local" replySourceRef="self" replyLabel="延展" onReply={reply} onUnderline={add} getMarks={()=>session.snapshots.get(underlineTargetKey(target))?.items??[]} onRemoveMark={remove}/></>
  try {
    await act(async()=>{root.render(renderFixture(1))})
    await waitForUi(() => {
      if (native) expect([...highlights.values()][0]?.size).toBe(2)
      else expect(document.querySelectorAll('[data-arkme-mark-paint]')).toHaveLength(1)
    })
    const paints=document.querySelectorAll<HTMLElement>('[data-arkme-mark-paint]')
    expect(paints).toHaveLength(native ? 0 : 1)
    if(native) expect([...highlights.values()][0]?.size).toBe(2)
    else { expect(paints[0]!.style.height).toBe('20px');expect(paints[0]!.style.pointerEvents).toBe('none') }
    let text=dom.querySelector<HTMLElement>('[data-arkme-text-selection]')!
    expect(text.textContent).toBe('重点')
    document.getSelection()?.removeAllRanges()
    await act(async()=>{
      text.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:30,clientY:55}))
      text.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:30,clientY:55}))
    })
    const toolbar=document.querySelector('[role="toolbar"]')!
    expect(toolbar.textContent).toContain('你、宏顺')
    expect(toolbar.textContent).toContain('仅本机')
    expect([...toolbar.querySelectorAll('button')].map(b=>b.textContent)).toEqual(['复制','全选','✓ 取消标记','查找','延展'])
    expect(document.getSelection()?.toString()).toBe('重点')
    const cancel=toolbar.querySelector<HTMLButtonElement>('[aria-pressed="true"]')!
    await act(async()=>cancel.click())
    expect(remove).toHaveBeenCalledWith(target,expect.objectContaining({id:'mine'}))
    expect(add).not.toHaveBeenCalled()
    // Other people's highlights remain actionable as an add, never as their deletion.
    session.snapshots.set(underlineTargetKey(target),{...snapshot,items:[snapshot.items[1]!]})
    await act(async()=>{
      text.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:30,clientY:55}))
      text.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:30,clientY:55}))
    })
    const otherToolbar=document.querySelector('[role="toolbar"]')!
    expect(otherToolbar.textContent).toContain('宏顺')
    expect(otherToolbar.textContent).not.toContain('取消标记')
    await act(async()=>[...otherToolbar.querySelectorAll('button')].find(b=>b.textContent==='标记')!.click())
    await waitForUi(() => expect(add).toHaveBeenCalledWith(target,actual))
    expect(remove).toHaveBeenCalledTimes(1)
    // Background refresh can replace the DOM root at identical coordinates; hit testing follows the new root.
    const oldText=text
    await act(async()=>{root.render(renderFixture(2))})
    text=dom.querySelector<HTMLElement>('[data-arkme-text-selection]')!
    expect(text).not.toBe(oldText)
    await vi.waitFor(async () => {
      await act(async()=>{
        text.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:30,clientY:55}))
        text.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:30,clientY:55}))
      })
      expect(document.querySelector('[role="toolbar"]')?.textContent).toContain('宏顺')
    })
    // Dragging a subset keeps the user's precise selection; it must not cancel the whole original mark.
    session.snapshots.set(underlineTargetKey(target),snapshot)
    const node=document.createTreeWalker(text,NodeFilter.SHOW_TEXT).nextNode()!
    await act(async()=>{
      text.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:30,clientY:55}))
      const range=document.createRange();range.setStart(node,0);range.setEnd(node,1)
      document.getSelection()!.removeAllRanges();document.getSelection()!.addRange(range)
      text.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:45,clientY:55}))
      text.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:45,clientY:55}))
    })
    expect(document.getSelection()?.toString()).toBe('重')
    expect(document.querySelector('[role="toolbar"]')?.textContent).not.toContain('取消标记')
    await act(async()=>[...document.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')].find(b=>b.textContent==='标记')!.click())
    await waitForUi(() => expect(add).toHaveBeenLastCalledWith(target,expect.objectContaining({start:0,end:1,text:'重'})))
  }finally{
    await act(async()=>root.unmount());if(native)expect(highlights.size).toBe(0);dom.remove();document.getSelection()?.removeAllRanges();session.dispose();rect.mockRestore();document.elementFromPoint=originalPoint
    if(clientRects)Object.defineProperty(Range.prototype,'getClientRects',clientRects)
    vi.unstubAllGlobals()
  }
})
it('does not restore stale text after permission loss during a mutation', async () => {
  const session=new MessageUnderlineSession('self',42,vi.fn());session.capability={supported:true,maxLength:2000};session.snapshots.set(underlineTargetKey(target),initial)
  vi.mocked(callArkme).mockRejectedValueOnce(Object.assign(new Error('access revoked'),{body:{code:'auth-http-403'}}))
  await session.change(target,{kind:'remove',annotationId:'mine',operationId:'op'})
  expect(session.snapshots.size).toBe(0)
})
it('does not hide one failed mark when another message succeeds concurrently', async () => {
  const session=new MessageUnderlineSession('self',42,vi.fn());session.capability={supported:true,maxLength:2000}
  const first=deferred<unknown>(), second=deferred<unknown>();vi.mocked(callArkme).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const a=session.change(target,{kind:'add',anchor,operationId:'one'})
  const b=session.change({...target,item:{...target.item,itemUid:'note2',messageActionRef:'ref2'}},{kind:'add',anchor,operationId:'two'})
  first.reject(new Error('first failed'));await a;second.resolve(initial);await b
  expect(session.notice).toBe('first failed');expect(session.retry).toBeDefined()
})
it('local mode persists optimistically through only local host operations', async () => {
  const session = new MessageUnderlineSession('self',42,vi.fn(),'local')
  vi.mocked(callArkme).mockResolvedValueOnce({supported:true,maxLength:2000,storage:'local'})
  await session.prepare()
  vi.mocked(callArkme).mockResolvedValueOnce([{actionRef:'ref',snapshot:{revision:0,accessible:true,items:[]}}])
  await session.read([target])
  const write=deferred<unknown>(); vi.mocked(callArkme).mockReturnValueOnce(write.promise)
  const writing=session.change(target,{kind:'add',anchor,operationId:'local-add'})
  expect(session.snapshots.get(underlineTargetKey(target))?.items[0]?.pending).toBe(true)
  expect(session.notice).toContain('本机')
  write.resolve({...initial,items:[mark]});await writing
  expect(vi.mocked(callArkme).mock.calls.map(call=>call[0])).toEqual(['source.local-message-mark.capabilities','source.local-message-mark.list','source.local-message-mark.change'])
  expect(session.snapshots.get(underlineTargetKey(target))?.items[0]?.pending).toBeUndefined()
})
it('local save failure rolls back and retries the same operation', async () => {
  const session=new MessageUnderlineSession('self',42,vi.fn(),'local');session.capability={supported:true,maxLength:2000}
  vi.mocked(callArkme).mockRejectedValueOnce(new Error('本机标记未保存，已恢复'))
  await session.change(target,{kind:'add',anchor,operationId:'local-fail'})
  expect(session.snapshots.size).toBe(0);expect(session.notice).toContain('未保存')
  vi.mocked(callArkme).mockResolvedValueOnce({...initial,items:[mark]});await session.retry?.()
  expect(vi.mocked(callArkme).mock.calls[1]?.[1]).toMatchObject({change:{operationId:'local-fail'}})
})

it('clears cloud fragments when permission lookup fails and rejects a pending write restoring them', async () => {
  const session = new MessageUnderlineSession('self',42,vi.fn()); session.capability={supported:true,maxLength:2000}; session.snapshots.set(underlineTargetKey(target),initial)
  const write=deferred<unknown>(); vi.mocked(callArkme).mockReturnValueOnce(write.promise)
  const writing=session.change(target,{kind:'remove',annotationId:'mine',operationId:'stable'})
  vi.mocked(callArkme).mockRejectedValueOnce(new Error('source lookup unavailable'))
  await session.read([target])
  expect(session.snapshots.size).toBe(0)
  write.reject(new Error('lost response')); await writing
  expect(session.snapshots.size).toBe(0)
  session.dispose()
})
it.each([{ audience: 'self' as const, label: '在我的设备间同步', button: '标记' }, { audience: 'conversation' as const, label: '会话成员可见', button: '共享标记' }])('keeps $audience marking simple and switches existing stores without writing', async ({ audience, label, button }) => {
  const { act, useState } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { webcrypto } = await import('node:crypto')
  const { useMessageUnderlines } = await import('../src/client/ArkmeMessageUnderlines.js')
  const { ArkmeMessageTextSelectionToolbar } = await import('../src/client/ArkmeMessageTextSelection.js')
  const { ArkmeMessageContent } = await import('../src/client/ArkmeRichContent.js')
  const { quoteDigest } = await import('../src/client/message-quote-selection.js')
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 50, 200, 60))
  const clientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
  Range.prototype.getClientRects = () => [new DOMRect(20, 50, 100, 20)] as unknown as DOMRectList
  const originalPoint = document.elementFromPoint
  document.elementFromPoint = () => null
  const actual = { ...anchor, sourceDigest: await quoteDigest(target.item) }
  const local = { ...initial, items: [{ ...mark, anchor: actual }] }
  const cloud = { ...initial, items: [] }
  vi.mocked(callArkme).mockImplementation(async (operation: string) => {
    if (operation.endsWith('.capabilities')) return { supported: true, maxLength: 2000 }
    if (operation.endsWith('.list')) return [{ actionRef: 'ref', snapshot: operation.startsWith('source.local-') ? local : cloud }]
    throw new Error('Switching storage must not write')
  })
  function Fixture() {
    const [storage, setStorage] = useState<'local' | 'cloud'>('cloud')
    const marks = useMessageUnderlines('scope', 'self', 42, undefined, storage)
    return <><ArkmeMessageContent item={target.item} sourceRef="self" />{marks.layer}
      <ArkmeMessageTextSelectionToolbar replySourceRef="self" markStorage={storage} onMarkStorageChange={setStorage} markAudience={audience}
        onUnderline={marks.mark} getMarks={marks.getMarks} onRemoveMark={marks.remove} /></>
  }
  const dom = document.createElement('div'); document.body.append(dom)
  const root = createRoot(dom)
  const settle = async (check: () => void) => vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }); check()
  })
  try {
    await act(async () => root.render(<Fixture />))
    const text = dom.querySelector<HTMLElement>('[data-arkme-text-selection]')!
    const node = document.createTreeWalker(text, NodeFilter.SHOW_TEXT).nextNode()!
    const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 2)
    document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range)
    await act(async () => text.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })))
    const toolbar = () => document.querySelector('[role="toolbar"]')!
    expect(toolbar().textContent).not.toMatch(/查看仅本机|跨设备同步|会话共享/)
    expect([...toolbar().querySelectorAll('button')].some(b => b.textContent === button)).toBe(true)
    expect(document.querySelector('[role="menu"]')).toBeNull()
    const openScope = async () => {
      await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="标记范围"]')!.click())
      await settle(() => expect(document.querySelector('[role="menu"]')).not.toBeNull())
    }
    const choose = async (text: string) => {
      const option = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(b => b.textContent === text)!
      expect(option).toBeDefined()
      // Native mouse events on the portaled list must not dismiss the selection toolbar.
      await act(async () => {
        option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        option.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        option.click()
      })
    }
    await openScope()
    expect([...document.querySelectorAll('[role="menuitem"]')].map(b => b.textContent)).toEqual([label, '仅此电脑可见'])
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(toolbar()).not.toBeNull()
    expect(document.getSelection()?.toString()).toBe('重点')
    await openScope()
    await choose('仅此电脑可见')
    await settle(() => expect(toolbar().textContent).toContain('取消标记（仅此电脑）'))
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.getSelection()?.toString()).toBe('重点')
    await openScope()
    await choose(label)
    await settle(() => expect(toolbar().textContent).not.toContain('取消标记'))
    expect(toolbar().textContent).not.toContain('仅此电脑')
    await openScope()
    await act(async () => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(document.querySelector('[role="toolbar"]')).toBeNull()
    expect(vi.mocked(callArkme).mock.calls.some(([operation]) => operation.startsWith('source.local-') && operation.endsWith('.list'))).toBe(true)
    expect(vi.mocked(callArkme).mock.calls.some(([operation]) => operation === 'source.message-underline.list')).toBe(true)
    expect(vi.mocked(callArkme).mock.calls.every(([operation]) => operation.endsWith('.list') || operation.endsWith('.capabilities'))).toBe(true)
    expect(local.items).toHaveLength(1)
    expect(cloud.items).toHaveLength(0)
  } finally {
    await act(async () => root.unmount()); dom.remove(); document.getSelection()?.removeAllRanges()
    rect.mockRestore(); document.elementFromPoint = originalPoint
    if (clientRects) Object.defineProperty(Range.prototype, 'getClientRects', clientRects)
    else Reflect.deleteProperty(Range.prototype, 'getClientRects')
    vi.unstubAllGlobals()
  }
})
it('retains one queued invalidation while an older snapshot is still reading', async () => {
 const session=new MessageUnderlineSession('self',42,vi.fn());session.capability={supported:true,maxLength:2000}
 const stale=deferred<unknown>()
 vi.mocked(callArkme).mockReturnValueOnce(stale.promise).mockResolvedValueOnce([{actionRef:'ref',snapshot:{...initial,revision:2}}])
 const read=session.read([target]);for(let i=0;i<100;i++)void session.read([target])
 expect(callArkme).toHaveBeenCalledOnce()
 stale.resolve([{actionRef:'ref',snapshot:{revision:1,accessible:true,items:[]}}]);await read
 expect(callArkme).toHaveBeenCalledTimes(2);expect(session.snapshots.get(underlineTargetKey(target))?.revision).toBe(2)
 session.dispose()
})

it('discards the pre-invalidation read while draining the upstream queued refresh', async () => {
  const session = new MessageUnderlineSession('self', 42, vi.fn(), 'cloud')
  session.capability = { supported: true, maxLength: 2000 }
  const stale = deferred<unknown>(), fresh = deferred<unknown>()
  vi.mocked(callArkme).mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise)
  const reading = session.read([target])
  session.invalidate()
  void session.read([target])
  stale.resolve([{ actionRef: 'ref', snapshot: initial }])
  await vi.waitFor(() => expect(callArkme).toHaveBeenCalledTimes(2))
  expect(session.snapshots.size).toBe(0)
  fresh.resolve([{ actionRef: 'ref', snapshot: { ...initial, revision: 2, items: [] } }])
  await reading
  expect(session.snapshots.get(underlineTargetKey(target))).toMatchObject({ revision: 2, items: [] })
  session.dispose()
})

it('shares refresh scheduling while retaining cloud access invalidation and transport cleanup', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { UnderlineLayer } = await import('../src/client/ArkmeMessageUnderlines.js')
  const { invalidateMessageMarks } = await import('../src/client/message-mark-invalidations.js')
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const stop = vi.fn(), subscribe = vi.fn(() => stop)
  const session = new MessageUnderlineSession('self', 42, vi.fn(), 'cloud', {
    capabilities: async () => ({ supported: true, maxLength: 2000 }),
    list: async () => [], change: async () => initial, subscribe,
  })
  session.capability = { supported: true, maxLength: 2000 }
  session.snapshots.set(underlineTargetKey(target), initial)
  const invalidate = vi.spyOn(session, 'invalidate')
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<UnderlineLayer session={session} revision={0} />))
    expect(subscribe).toHaveBeenCalledOnce()
    await act(async () => invalidateMessageMarks(true))
    expect(invalidate).toHaveBeenCalledOnce()
    expect(session.snapshots.size).toBe(0)
    await act(async () => root.unmount())
    expect(stop).toHaveBeenCalledOnce()
    invalidateMessageMarks(true)
    expect(invalidate).toHaveBeenCalledOnce()
  } finally { await act(async () => root.unmount()); session.dispose(); host.remove(); vi.unstubAllGlobals() }
})
