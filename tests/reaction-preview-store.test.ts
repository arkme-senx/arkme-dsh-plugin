import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReactionPreviewStore } from '../src/client/reaction-preview-store.js'
import { reactionFixture } from './reaction-fixture.js'
import type { ReactionRequest } from '../src/reaction-contract.js'
const target = { id: 'group:message', source: '测试群', text: '核对报价单', sourceRef: 'signed-source', messageActionRef: 'signed-message' }
const stores: ReactionPreviewStore[] = []
afterEach(() => { stores.forEach(s => s.setScope(undefined)); stores.length = 0; reactionFixture.reset(); vi.useRealTimers() })
function setup(transport = (input: ReactionRequest) => reactionFixture.call('reactions', input)) {
 const store = new ReactionPreviewStore(transport); stores.push(store); store.setScope('test:a'); store.watch('test:a', target); return store
}
describe('server-owned reactions', () => {
 it('persists explicit desired state and retains add/remove history', async () => {
  const store = setup(); await store.refresh()
  expect(await store.toggle('test:a', target, '收到')).toBe(true)
  expect(await store.toggle('test:a', target, '已完成')).toBe(true)
  expect(store.selections(target.id)).toEqual(['收到', '已完成'])
  await store.toggle('test:a', target, '收到')
  expect(store.selections(target.id)).toEqual(['已完成'])
  expect(reactionFixture.history.map(x => x.active)).toEqual([true, true, false])
 })
 it('discards reads completing after account change', async () => {
  let resolve!: (value: unknown) => void
  const store = setup(() => new Promise(r => { resolve = r }))
  const reading = store.refresh(); store.setScope('test:b')
  resolve({ items: [{ target_id: target.id, mine: { revision: 9, selections: [{ expression: {text:'秘密'},key:'a',at:1 }] },groups:[] }] })
  await reading
  expect(store.snapshot(target.id)).toBeUndefined()
  expect(await store.toggle('test:a', target, '收到')).toBe(false)
 })
 it('retries an uncertain write with the same identity before another message action', async () => {
  const requests: Extract<ReactionRequest,{action:'set'}>[] = []
  const store = setup(async input => {
   if (input.action === 'set') { requests.push(input); if (requests.length === 1) throw new Error('timeout') }
   return reactionFixture.call('reactions', input)
  })
  await store.refresh()
  expect(await store.toggle('test:a', target, '收到')).toBe(false)
  const other = {...target,id:'other'}; store.watch('test:a',other)
  expect(await store.toggle('test:a', other, '完成')).toBe(true)
  expect(requests[0]).toEqual(requests[1])
  expect(requests[2].request_id).not.toBe(requests[1].request_id)
 })
 it('clears inaccessible or failed reads instead of retaining actor identities', async () => {
  let fail = false
  const store = setup(async input => { if (fail) throw new Error('permission unavailable'); return reactionFixture.call('reactions',input) })
  await store.refresh(); await store.toggle('test:a',target,'收到')
  await store.refresh(); fail = true; await store.refresh()
  expect(store.snapshot(target.id)).toBeUndefined()
  expect(store.error(target.id)).toContain('permission')
 })
 it('bounds batches and stops polling after the last mounted target leaves', async () => {
  vi.useFakeTimers()
  const calls: ReactionRequest[] = []
  const store = new ReactionPreviewStore(async input => { calls.push(input); return reactionFixture.call('reactions',input) }); stores.push(store); store.setScope('test:a')
  const disposers = Array.from({length:205},(_,i)=>store.watch('test:a',{...target,id:String(i)}))
  await store.refresh()
  expect(calls.filter(x=>x.action==='query').map(x=>x.action==='query' && x.targets.length)).toEqual([50,50,50,50])
  disposers.forEach(dispose=>dispose())
  await vi.advanceTimersByTimeAsync(30000)
  expect(calls).toHaveLength(4)
 })
})

it('removes a confirmed reaction without waiting for the next background query', async () => {
 let hold = false, resolve!: (value: unknown) => void
 const store=setup(async input=> {
  if (input.action==='query' && hold) return new Promise(r=>{resolve=r})
  return reactionFixture.call('reactions',input)
 })
 await store.refresh(); await store.toggle('test:a',target,'收到')
 hold=true
 expect(await store.toggle('test:a',target,'收到')).toBe(true)
 expect(store.snapshot(target.id)?.groups).toEqual([])
 expect(store.busy(target.id)).toBe(false)
 resolve({items:[{target_id:target.id,mine:{revision:2,selections:[]},groups:[],actors_visible:true,private:false,has_more:false}]})
 await store.refresh()
})

it('appends new expression groups and treats colors as separate reactions', async () => {
 const store = setup(); await store.refresh()
 const blue = { text: '收到', color: 'blue' }, rose = { text: '收到', color: 'rose' }
 await store.toggle('test:a', target, '收到', blue)
 await store.toggle('test:a', target, '收到', rose)
 await store.refresh()
 expect(store.snapshot(target.id)?.groups.map(group => group.expression)).toEqual([blue, rose])
 await store.toggle('test:a', target, '收到', blue)
 await store.refresh()
 expect(store.snapshot(target.id)?.groups.map(group => group.expression)).toEqual([rose])
 await store.toggle('test:a', target, '收到', blue)
 await store.refresh()
 expect(store.snapshot(target.id)?.groups.map(group => group.expression)).toEqual([rose, blue])
})

it('loads targets mounted during an in-flight query immediately after it completes', async () => {
 vi.useFakeTimers()
 let resolve!:(value:unknown)=>void
 const calls:ReactionRequest[]=[]
 const store=setup(async input=>{calls.push(input);if(calls.length===1)return new Promise(r=>{resolve=r});return reactionFixture.call('reactions',input)})
 await vi.advanceTimersByTimeAsync(40)
 const later={...target,id:'late-target'};store.watch('test:a',later)
 await vi.advanceTimersByTimeAsync(100)
 expect(calls).toHaveLength(1)
 resolve({items:[]});await vi.advanceTimersByTimeAsync(1)
 expect(store.snapshot(later.id)).toBeDefined()
 expect(calls).toHaveLength(2)
})
it('does not repeatedly postpone first load as more messages mount, and does not publish identical polls',async()=>{
 vi.useFakeTimers();const calls:ReactionRequest[]=[]
 const store=setup(async input=>{calls.push(input);return reactionFixture.call('reactions',input)})
 await vi.advanceTimersByTimeAsync(20);store.watch('test:a',{...target,id:'second'})
 await vi.advanceTimersByTimeAsync(20);expect(calls).toHaveLength(1)
 const revision=store.getSnapshot();await vi.advanceTimersByTimeAsync(2000)
 expect(calls).toHaveLength(2);expect(store.getSnapshot()).toBe(revision)
})

it('retains recent snapshots without polling inactive messages and revalidates on return', async () => {
 vi.useFakeTimers()
 const transport = vi.fn(async (input: ReactionRequest) => reactionFixture.call('reactions', input))
 const store = new ReactionPreviewStore(transport); stores.push(store); store.setScope('test:a')
 const leave = store.watch('test:a', target)
 await store.refresh(); await store.toggle('test:a', target, '收到'); await store.refresh()
 const snapshot = store.snapshot(target.id)
 leave()
 expect(store.snapshot(target.id)).toBe(snapshot)
 const reads = transport.mock.calls.length
 await vi.advanceTimersByTimeAsync(10000)
 expect(transport).toHaveBeenCalledTimes(reads)
 reactionFixture.states.set(target.id, { revision: 2, selections: [] })
 const leaveAgain = store.watch('test:a', { ...target, sourceRef: 'new-reference' })
 expect(store.snapshot(target.id)).toBe(snapshot)
 await vi.advanceTimersByTimeAsync(40)
 expect(store.snapshot(target.id)?.groups).toEqual([])
 leaveAgain(); store.setScope('test:b')
 expect(store.snapshot(target.id)).toBeUndefined()
})

it('bounds inactive snapshots and removes retained identities on access failure', async () => {
 const transport = vi.fn(async (input: ReactionRequest) => reactionFixture.call('reactions', input))
 const store = new ReactionPreviewStore(transport); stores.push(store); store.setScope('test:a')
 for (let i = 0; i < 405; i++) {
   const stop = store.watch('test:a', { ...target, id: String(i) })
   await store.refresh(); stop()
 }
 expect(Array.from({ length: 405 }, (_, i) => store.snapshot(String(i))).filter(Boolean)).toHaveLength(400)
 expect(store.snapshot('0')).toBeUndefined()
 expect(store.snapshot('404')).toBeDefined()
 const stop = store.watch('test:a', { ...target, id: '404' })
 transport.mockRejectedValueOnce(new Error('access denied'))
 await store.refresh()
 expect(store.snapshot('404')).toBeUndefined()
 stop()
 expect(store.snapshot('404')).toBeUndefined()
})

it('prepares cold message reactions before the timeline mounts and releases temporary watches', async () => {
 vi.useFakeTimers()
 const transport = vi.fn(async (input: ReactionRequest) => reactionFixture.call('reactions', input))
 const store = new ReactionPreviewStore(transport); stores.push(store); store.setScope('test:a')
 await store.prepare('test:a', [target], new AbortController().signal)
 expect(store.snapshot(target.id)).toBeDefined()
 expect(transport).toHaveBeenCalledTimes(1)
 await vi.advanceTimersByTimeAsync(10000)
 expect(transport).toHaveBeenCalledTimes(1)
 await store.prepare('test:a', [target], new AbortController().signal)
 expect(transport).toHaveBeenCalledTimes(1)
})

it('does not block messages indefinitely or retain a cold response after cancelled navigation', async () => {
 vi.useFakeTimers()
 let finish!: (value: unknown) => void
 const transport = vi.fn(() => new Promise(resolve => { finish = resolve }))
 const store = new ReactionPreviewStore(transport); stores.push(store); store.setScope('test:a')
 const controller = new AbortController()
 const preparing = store.prepare('test:a', [target], controller.signal)
 controller.abort(); await preparing
 finish(await reactionFixture.call('reactions', { action: 'query', accountKey: 'test:a', targets: [target] }))
 await store.refresh()
 expect(store.snapshot(target.id)).toBeUndefined()
 expect(transport).toHaveBeenCalledTimes(1)
 const timed = store.prepare('test:a', [target], new AbortController().signal)
 await vi.advanceTimersByTimeAsync(1500); await timed
 finish({ items: [] }); await store.refresh()
 expect(transport).toHaveBeenCalledTimes(2)
})


it('refreshes retained notified messages before click without scanning unknown timelines', async () => {
 const transport = vi.fn(async (input: ReactionRequest) => reactionFixture.call('reactions', input))
 const store = new ReactionPreviewStore(transport); stores.push(store); store.setScope('test:a')
 const known = { ...target, sourceKey: 'chat', itemUid: 'message' }
 const leave = store.watch('test:a', known); await store.refresh(); leave()
 reactionFixture.states.set(known.id, { revision: 1, selections: [{ key: 'new', expression: { text: 'new reaction' }, at: 1 }] })
 await store.prepareNotifications('test:a', [{ sourceKey: 'chat', itemUid: 'message' }, { sourceKey: 'unknown', itemUid: 'other' }], new AbortController().signal)
 expect(store.snapshot(known.id)?.groups[0]?.key).toBe('new')
 expect(transport).toHaveBeenCalledTimes(2)
 const request = transport.mock.calls[1]![0]
 expect(request.action === 'query' && request.targets.map(t => t.id)).toEqual([known.id])
})
