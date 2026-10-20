import { describe, expect, it } from 'vitest'
import { mergeExploreEvidence } from '../src/explore-evidence.js'
import type { ExploreEvidence } from '../src/explore-contract.js'
const evidence=(key:string,start=1):ExploreEvidence=>({key,label:'来源',speaker:'',text:'同一原文',date:1,anchor:false,ref:'open',mentions:[{start,end:start+2,text:'名字'}]})
describe('relationship source cards',()=>{
  it('groups duplicate sources inside the first batch and retains distinct mention positions',()=>{
    const rows=mergeExploreEvidence([evidence('a',1),evidence('a',5),evidence('b',1),evidence('b',1)])
    expect(rows).toHaveLength(2);expect(rows[0]?.mentions?.map(x=>x.start)).toEqual([1,5])
    expect(rows[1]?.mentions).toHaveLength(1)
  })
  it('merges across pages without removing identically worded records from other sources',()=>{
    const rows=mergeExploreEvidence([evidence('a'),evidence('b')],[evidence('a',5),evidence('c')])
    expect(rows.map(x=>x.key)).toEqual(['a','b','c']);expect(rows[0]?.mentions).toHaveLength(2)
  })
})
