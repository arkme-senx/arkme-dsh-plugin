import { expect, it } from 'vitest'
import { MemberRecordsCache } from '../src/client/member-records-cache.js'
const snapshot = { items: [{ itemUid: 'one' } as never], hasMore: true, cursor: 9, viewport: { scrollTop: 120, anchors: [{id:'one',offset:-5}] } }
it('restores the exact page range/viewport and isolates accounts, people and scopes',()=>{
 const cache=new MemberRecordsCache()
 cache.put('prod:11','person-a:conversation',snapshot,100)
 expect(cache.get('prod:11','person-a:conversation',101)).toMatchObject(snapshot)
 expect(cache.get('prod:11','person-b:conversation',102)).toBeUndefined()
 expect(cache.get('prod:11','person-a:shared',103)).toBeUndefined()
 expect(cache.get('prod:12','person-a:conversation',104)).toBeUndefined()
 expect(cache.get('prod:11','person-a:conversation',105)).toBeUndefined()
})
it('bounds retention without inventing a cursor for truncated data',()=>{
 const cache=new MemberRecordsCache()
 for(let n=0;n<9;n++) cache.put('prod:11',String(n),snapshot,100+n)
 expect(cache.get('prod:11','0',110)).toBeUndefined()
 expect(cache.get('prod:11','8',110)).toBeDefined()
 cache.put('prod:11','huge',{...snapshot,items:Array(501).fill(snapshot.items[0])},120)
 expect(cache.get('prod:11','huge',121)).toBeUndefined()
 cache.put('prod:11','expired',snapshot,100)
 expect(cache.get('prod:11','expired',60101)).toBeUndefined()
 cache.put('prod:11','revoked',snapshot,100); cache.remove('prod:11','revoked')
 expect(cache.get('prod:11','revoked',101)).toBeUndefined()
})
