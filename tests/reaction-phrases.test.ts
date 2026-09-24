import { expressionLabel, labelExpression } from '../src/client/reaction-expression.js'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { reactionFixture } from './reaction-fixture.js'
vi.mock('../src/client/api.js', async importOriginal => ({ ...await importOriginal<object>(), callArkme: (operation: string,input: never) => reactionFixture.call(operation,input) }))
import { reactionLibrary, ReactionLibraryStore } from '../src/client/reaction-library.js'
import { readReactionCollection, writeReactionCollection, defaultReactionPhrases, moveReactionPhrase, orderReactionPhrases } from '../src/client/reaction-phrases.js'
afterEach(()=>{ reactionLibrary.setScope(undefined); reactionFixture.reset() })
describe('server-owned phrase library', () => {
 it('preserves image combinations and colors atomically across reload', async () => {
  reactionLibrary.setScope('test:1'); await reactionLibrary.load('test:1')
  const label = '[jm_combo:smiling_face:thumb_up] 包在我身上'
  await writeReactionCollection('test:1',[labelExpression(label, 'blue')])
  await reactionLibrary.load('test:1')
  expect(readReactionCollection('test:1').map(expressionLabel)).toEqual([label])
  expect(readReactionCollection('test:1')[0]?.color).toBe('blue')
 })
 it('only defaults a never-saved library; empty saved collections stay empty', async () => {
  reactionLibrary.setScope('test:1'); await reactionLibrary.load('test:1')
  expect(readReactionCollection('test:1').map(expressionLabel)).toEqual(defaultReactionPhrases)
  await writeReactionCollection('test:1',[]); await reactionLibrary.load('test:1')
  expect(readReactionCollection('test:1')).toEqual([])
  reactionLibrary.setScope('test:2')
  expect(readReactionCollection('test:1')).toEqual([])
 })
 it('moves phrases in both directions and reconciles additions and deletions', () => {
  expect(moveReactionPhrase(['a','b','c'],'a','c')).toEqual(['b','c','a'])
  expect(moveReactionPhrase(['a','b','c'],'c','a')).toEqual(['c','a','b'])
  expect(orderReactionPhrases(['a','b','new'],['gone','b','a'])).toEqual(['b','a','new'])
 })
 it('refreshes conflicts without overwriting another device',async()=>{
  const store = new ReactionLibraryStore(async input => input.action==='library-query' ? {revision:1,items:[]} : {outcome:'revision_conflict',library:{revision:2,items:[{text:'另一台设备'}]}})
  store.setScope('test:1'); await store.load('test:1')
  await expect(store.save('test:1',[{text:'本机'}])).rejects.toThrow('其他设备')
  expect(store.read('test:1')?.items).toEqual([{text:'另一台设备'}])
  store.setScope(undefined)
 })
 it('retains ambiguous write identity and exposes retry without optimistic success',async()=>{
  const requests: unknown[]=[]; let fail=true
  const store = new ReactionLibraryStore(async input => {
   if(input.action==='library-query')return {revision:0,items:[]}
   requests.push(input); if(fail)throw new Error('timeout')
   return {outcome:'idempotent',library:{revision:1,items:[{text:'收到'}]}}
  })
  store.setScope('test:1'); await store.load('test:1')
  await expect(store.save('test:1',[{text:'收到'}])).rejects.toThrow('timeout')
  expect(store.read('test:1')?.revision).toBe(0)
  await expect(store.save('test:1',[{text:'其他'}])).rejects.toThrow('未确认')
  fail=false; await store.retry('test:1')
  expect(requests[0]).toEqual(requests[1])
  expect(store.read('test:1')?.revision).toBe(1)
  store.setScope(undefined)
 })
})

it('keeps same-text color variants distinct across save, reload, reorder and deletion', async () => {
 reactionLibrary.setScope('test:1'); await reactionLibrary.load('test:1')
 const blue = labelExpression('收到', 'blue'), rose = labelExpression('收到', 'rose')
 await writeReactionCollection('test:1', [blue, rose]); await reactionLibrary.load('test:1')
 expect(readReactionCollection('test:1')).toEqual([blue, rose])
 await writeReactionCollection('test:1', [rose, blue]); await reactionLibrary.load('test:1')
 expect(readReactionCollection('test:1')).toEqual([rose, blue])
 await writeReactionCollection('test:1', [blue]); await reactionLibrary.load('test:1')
 expect(readReactionCollection('test:1')).toEqual([blue])
})
