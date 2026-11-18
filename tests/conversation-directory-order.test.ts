import { expect, it } from 'vitest'
import { orderConversationDirectoryRows } from '../src/client/conversation-directory-order.js'

it('interleaves AI conversations with messages and notifications while preserving pins and stable ties', () => {
  const rows = [
    {id:'group',activeAtMillis:200,pinned:false}, {id:'dsh',activeAtMillis:300,pinned:false},
    {id:'pinned',activeAtMillis:1,pinned:true}, {id:'codex',activeAtMillis:400,pinned:false},
    {id:'self',activeAtMillis:250,pinned:false}, {id:'notifications',activeAtMillis:200,pinned:false},
  ]
  expect(orderConversationDirectoryRows(rows).map(row=>row.id)).toEqual(['pinned','codex','dsh','self','group','notifications'])
  expect(rows[0]!.id).toBe('group')
  expect(orderConversationDirectoryRows(rows.map(row=>row.id==='group'?{...row,activeAtMillis:500}:row)).map(row=>row.id)).toEqual(['pinned','group','codex','dsh','self','notifications'])
  expect(orderConversationDirectoryRows(rows.map(row=>row.id==='dsh'?{...row,pinned:true}:row)).map(row=>row.id)).toEqual(['dsh','pinned','codex','self','group','notifications'])
})

it('puts unknown and invalid activity last instead of inventing current time', () => {
  expect(orderConversationDirectoryRows([0,NaN,Infinity,-1,10].map((at,i)=>({id:i,activeAtMillis:at,pinned:false}))).map(row=>row.id)).toEqual([4,0,1,2,3])
})
