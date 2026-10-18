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
beforeEach(() => vi.mocked(callArkme).mockReset())
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
it('renders shared overlaps as one line per span with all relevant authors', () => {
  const base: MarkPosition = {key:'a',target,ids:['mine'],left:10,top:10,width:30,stale:false,pending:false}
  const merged = mergeUnderlinePositions([base,{...base,key:'b',ids:['other'],left:30,width:30}])
  expect(merged.map(p=>[p.left,p.width,p.ids])).toEqual([[10,20,['mine']],[30,10,['mine','other']],[40,20,['other']]])
})
it('removes only mine immediately and rolls back failure with the same retry id', async () => {
  const session = new MessageUnderlineSession('self',42,vi.fn()); session.capability = {supported:true,maxLength:2000}; session.snapshots.set(underlineTargetKey(target),initial)
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
it('paints a single shared line and exposes both markers without changing copyable text', async () => {
  const {act}=await import('react'),{createRoot}=await import('react-dom/client'),{webcrypto}=await import('node:crypto')
  const {UnderlineLayer}=await import('../src/client/ArkmeMessageUnderlines.js')
  const {ArkmeMessageContent}=await import('../src/client/ArkmeRichContent.js')
  const {quoteDigest}=await import('../src/client/message-quote-selection.js')
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('crypto',webcrypto)
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
  try {
    await act(async()=>{root.render(<><ArkmeMessageContent item={target.item} sourceRef="self"/><UnderlineLayer session={session} revision={1}/></>);await new Promise(resolve=>setTimeout(resolve,30))})
    const lines=document.querySelectorAll<HTMLButtonElement>('[aria-label="查看划线标记者"]')
    expect(lines).toHaveLength(1)
    expect(dom.querySelector('[data-arkme-text-selection]')?.textContent).toBe('重点')
    await act(async()=>lines[0]!.click())
    expect(document.querySelector('[aria-label="划线详情"]')?.textContent).toContain('你、宏顺标记了这段')
    expect(document.querySelector('[aria-label="划线详情"]')?.textContent).toContain('取消我的划线')
  }finally{
    await act(async()=>root.unmount());dom.remove();session.dispose();rect.mockRestore();document.elementFromPoint=originalPoint
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
