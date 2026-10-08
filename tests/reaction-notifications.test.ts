import { reactionPreview } from '../src/client/reaction-preview-store.js'
import { describe, it, expect, vi } from 'vitest'
import { ReactionNotifications } from '../src/client/reaction-notifications.js'
import type { ReactionNotification } from '../src/reaction-contract.js'
const item: ReactionNotification = { id:'a'.repeat(64), revision:1, actorUserId:2, sourceKey:'chat', itemUid:'old', recordOwnerUserId:1, sendAtMillis:1, text:'hello', selections:[{ key:'b'.repeat(64), expression:{text:'收到'}, at:1 }] }
const page = (items: ReactionNotification[]) => ({items,has_more:false,after_id:''})
describe('reaction notification ownership', () => {
 it('keeps history highlighting separate from notification read state and clears it on account switch', async () => {
  vi.useFakeTimers()
  const store = new ReactionNotifications(async () => page([item]))
  const release = store.acquire('test:1')
  try {
   await store.refresh(); store.beginViewing('chat', 'old')
   store.beginHistoryViewing('test:1', 'chat', 'old', 'exact-expression')
   expect(store.canAcknowledge('test:1', item)).toBe(false)
   expect(store.highlights('test:1', 'chat', 'old')).toBeUndefined()
   store.startHighlights('test:1', 'chat', 'old')
   expect(store.highlights('test:1', 'chat', 'old')?.expressionIdentity).toBe('exact-expression')
   expect(store.forSource('test:1', 'chat')).toEqual([item])
   vi.advanceTimersByTime(2300)
   expect(store.highlights('test:1', 'chat', 'old')).toBeUndefined()
   store.beginHistoryViewing('test:1', undefined, 'self', 'exact-expression')
   const other = store.acquire('test:2')
   expect(store.hasHistoryHighlight('test:2', undefined, 'self')).toBe(false)
   other()
  } finally { release(); vi.useRealTimers() }
 })
 it('recovers unread after a network failure and reopening, without resurrecting server-acknowledged rows', async () => {
  let online=true, unread=true
  const transport=vi.fn(async (request:any)=>{if(!online)throw Error('offline');if(request.action==='notifications')return page(unread?[item]:[]);unread=false;return {ok:true}})
  const first=new ReactionNotifications(transport);const close=first.acquire('test:1')
  await first.refresh();online=false;await first.refresh()
  expect(first.error).toBe('offline');expect(transport.mock.calls.every(([r])=>r.action==='notifications')).toBe(true)
  online=true;await first.refresh();expect(first.forSource('test:1','chat')).toEqual([item]);close()
  const reopened=new ReactionNotifications(transport);const release=reopened.acquire('test:1')
  await reopened.refresh();expect(reopened.forSource('test:1','chat')).toEqual([item]);await reopened.seen('test:1',[item]);release()
  const last=new ReactionNotifications(transport);const end=last.acquire('test:1');await last.refresh();expect(last.forSource('test:1','chat')).toEqual([]);end()
 })

 it('keeps the other message available after viewing one, and clears only the last viewed reminder', async () => {
  const other: ReactionNotification = {...item,id:'c'.repeat(64),itemUid:'another',selections:[{...item.selections[0]!,at:2}]}
  const store=new ReactionNotifications(async request=>request.action==='notifications'?page([item,other]):{ok:true})
  const release=store.acquire('test:1')
  try {
   await store.refresh()
   await store.seen('test:1',[other])
   expect(store.forSource('test:1','chat')).toEqual([item])
   await store.refresh()
   expect(store.forSource('test:1','chat')).toEqual([item])
   await store.seen('test:1',[item])
   expect(store.forSource('test:1','chat')).toEqual([])
  } finally { release() }
 })

 it('does not read on acquire or query; acknowledges exact displayed revision only', async () => {
  const transport=vi.fn(async request => request.action==='notifications' ? page([item]) : {ok:true})
  const store=new ReactionNotifications(transport);const release=store.acquire('test:1');await store.refresh()
  expect(store.forSource('test:1','chat')).toEqual([item]);expect(transport.mock.calls.every(([r])=>r.action==='notifications')).toBe(true)
  await store.seen('test:other',[item]);expect(transport).toHaveBeenCalledTimes(1)
  await store.seen('test:1',[item]);expect(transport.mock.calls.at(-1)?.[0]).toMatchObject({action:'notifications-read',items:[{id:item.id,revision:1}]})
  await store.refresh();expect(store.forSource('test:1','chat')).toEqual([])
  release()
 })
 it('keeps later revisions and unread on failed acknowledgement',async()=>{
  let current=item;let fail=true
  const store=new ReactionNotifications(async request=>{if(request.action==='notifications')return page([current]);if(fail)throw Error('offline');return {ok:true}})
  const release=store.acquire('test:1');await store.refresh();await store.seen('test:1',[item]);expect(store.forSource('test:1','chat')).toEqual([item])
  fail=false;current={...item,revision:2};await store.refresh();await store.seen('test:1',[item]);expect(store.forSource('test:1','chat')[0]?.revision).toBe(2);release()
 })
 it('releases requests on account switch and can reacquire same account',async()=>{
  let resolve!:(value:unknown)=>void
  const transport=vi.fn((_request,signal)=>new Promise(r=>{resolve=r;signal.addEventListener('abort',()=>r(page([])))}))
  const store=new ReactionNotifications(transport);store.acquire('test:1');const pending=store.refresh();const release=store.acquire('test:2');resolve(page([item]));await pending
  expect(store.forSource('test:1','chat')).toEqual([]);expect(store.forSource('test:2','chat')).toEqual([]);release()
 })
})


it('prepares changed message reactions before exposing orange previews and does not repeat unchanged work', async () => {
 let finish!: () => void
 const warm = vi.spyOn(reactionPreview, 'prepareNotifications').mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
 const store = new ReactionNotifications(async () => page([item]))
 const release = store.acquire('test:1')
 try {
   const reading = store.refresh()
   await Promise.resolve(); await Promise.resolve()
   expect(warm).toHaveBeenCalledTimes(1)
   expect(store.forSource('test:1', 'chat')).toEqual([])
   finish(); await reading
   expect(store.forSource('test:1', 'chat')).toEqual([item])
   await store.refresh()
   expect(warm).toHaveBeenCalledTimes(1)
 } finally { release(); warm.mockRestore() }
})

it('does not restore a reminder acknowledged while its reaction refresh is finishing', async () => {
 let finish!: () => void
 const warm = vi.spyOn(reactionPreview, 'prepareNotifications').mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
 const store = new ReactionNotifications(async request => request.action === 'notifications' ? page([item]) : { ok: true })
 const release = store.acquire('test:1')
 try {
   const reading = store.refresh()
   await Promise.resolve(); await Promise.resolve()
   await store.seen('test:1', [item])
   finish(); await reading
   expect(store.forSource('test:1', 'chat')).toEqual([])
 } finally { release(); warm.mockRestore() }
})


it('requires explicit opening and never treats later reaction revisions as already viewed', async () => {
 let current = item
 const store = new ReactionNotifications(async request => request.action === 'notifications' ? page([current]) : { ok: true })
 const release = store.acquire('test:1')
 try {
  await store.refresh(); expect(store.canAcknowledge('test:1', item)).toBe(false)
  store.beginViewing(item.sourceKey, item.itemUid)
  expect(store.canAcknowledge('test:1', item)).toBe(true)
  current = { ...item, revision: 2 }; await store.refresh()
  expect(store.canAcknowledge('test:1', current)).toBe(false)
  expect(store.canAcknowledge('test:other', item)).toBe(false)
  store.beginViewing('another-chat', 'another-message')
  expect(store.canAcknowledge('test:1', item)).toBe(false)
 } finally { release() }
})


it('opens all actors on the clicked message while preserving later arrivals and other messages', async () => {
 const second = { ...item, id: 'second', actorUserId: 3 }
 const other = { ...item, id: 'other', itemUid: 'other-message' }
 const later = { ...item, id: 'later', actorUserId: 4 }
 let rows = [item, second, other]
 const store = new ReactionNotifications(async request => request.action === 'notifications' ? page(rows) : { ok: true })
 const release = store.acquire('test:1')
 try {
  await store.refresh(); store.beginViewing(item.sourceKey, item.itemUid)
  expect(store.canAcknowledge('test:1', item)).toBe(true)
  expect(store.canAcknowledge('test:1', second)).toBe(true)
  expect(store.canAcknowledge('test:1', other)).toBe(false)
  const updated = { ...item, revision: 2 }
  rows = [updated, second, other, later]; await store.refresh()
  expect(store.canAcknowledge('test:1', updated)).toBe(false)
  expect(store.canAcknowledge('test:1', later)).toBe(false)
  await store.seen('test:1', [item, second])
  expect(store.forSource('test:1', item.sourceKey).map(row => row.id)).toEqual([updated.id, other.id, later.id])
 } finally { release() }
})


it('retains the clicked highlight after acknowledgement, expires it after 2.3 seconds and excludes later arrivals', async () => {
 vi.useFakeTimers()
 let current = item
 const store = new ReactionNotifications(async request => request.action === 'notifications' ? page([current]) : { ok: true })
 const release = store.acquire('test:1')
 try {
  await store.refresh(); store.beginViewing(item.sourceKey, item.itemUid)
  expect(store.highlights('test:1', item.sourceKey, item.itemUid)).toBeUndefined()
  store.startHighlights('test:1', item.sourceKey, item.itemUid)
  await store.seen('test:1', [item])
  expect(store.highlights('test:1', item.sourceKey, item.itemUid)?.rows).toEqual([item])
  current = { ...item, revision: 2 }; await store.refresh()
  expect(store.highlights('test:1', item.sourceKey, item.itemUid)?.rows[0]?.revision).toBe(1)
  await vi.advanceTimersByTimeAsync(2299)
  expect(store.highlights('test:1', item.sourceKey, item.itemUid)).toBeDefined()
  await vi.advanceTimersByTimeAsync(1)
  expect(store.highlights('test:1', item.sourceKey, item.itemUid)).toBeUndefined()
 } finally { release(); vi.useRealTimers() }
})
