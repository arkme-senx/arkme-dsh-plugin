import { expect, it } from 'vitest'
import { loadWorldCommentPage, type WorldCommentContinuation } from '../src/client/world-comment-page.js'
import type { ArkmeWorldInteractionItem, ArkmeWorldRepliesPage } from '../src/types.js'
const item = (id: string, parent: string): ArkmeWorldInteractionItem => ({ interactionRef:id, parentRef:parent, authorName:'Test', textContent:id, createdAtMillis:1,publishedAtMillis:1,imageCount:0,videoCount:0,voiceCount:0 })
const start = [{parentRef:'post',path:['post']}]
it('automatically includes mixed comments and nested replies, keeping root pagination for load more', async () => {
 const reads:string[]=[]
 const read=async(ref:string):Promise<ArkmeWorldRepliesPage>=>{
  reads.push(ref)
  if(ref==='post')return {items:[item('comment','post')],hasMore:true,nextCursor:'next'}
  if(ref==='comment')return {items:[item('reply','comment')],hasMore:false}
  if(ref==='reply')return {items:[item('deep','reply')],hasMore:false}
  return {items:[],hasMore:false}
 }
 const page=await loadWorldCommentPage(start,read,new AbortController().signal)
 expect(page.items.map(x=>x.interactionRef)).toEqual(['comment','reply','deep'])
 expect(page.pending).toEqual([{...start[0],cursor:'next'}]);expect(reads).toEqual(['post','comment','reply','deep'])
})
it('bounds reads, concurrency and result size and eventually visits every reply exactly once',async()=>{
 const signal=new AbortController().signal;let pending:WorldCommentContinuation[]=start,active=0,maxActive=0,requests=0
 const all:string[]=[]
 const read=async(ref:string,limit:number,cursor?:string)=>{
  active++;maxActive=Math.max(maxActive,active);requests++;await Promise.resolve();active--
  const depth=ref==='post'?0:ref.split('/').length
  const count=depth<3?6:0,start=Number(cursor??0),end=Math.min(count,start+limit)
  return {items:Array.from({length:end-start},(_,i)=>item(ref==='post'?`${start+i}`:`${ref}/${start+i}`,ref)),hasMore:end<count,...(end<count?{nextCursor:String(end)}:{})}
 }
 for(let i=0;pending.length&&i<100;i++){
  const before=requests,page=await loadWorldCommentPage(pending,read,signal);pending=page.pending
  expect(requests-before).toBeLessThanOrEqual(32);expect(page.items.length).toBeLessThanOrEqual(100);all.push(...page.items.map(x=>x.interactionRef))
 }
 expect(pending).toEqual([]);expect(all).toHaveLength(258);expect(new Set(all).size).toBe(258);expect(maxActive).toBeLessThanOrEqual(4)
})
it('does not return partial content on revocation, cycles or non advancing pagination',async()=>{
 const signal=new AbortController().signal
 await expect(loadWorldCommentPage(start,async ref=>{if(ref==='post')return {items:[item('child',ref)],hasMore:false};throw Error('withdrawn')},signal)).rejects.toThrow('withdrawn')
 await expect(loadWorldCommentPage(start,async()=>({items:[item('post','post')],hasMore:false}),signal)).rejects.toThrow('层级')
 await expect(loadWorldCommentPage([{...start[0]!,cursor:'same'}],async()=>({items:[],hasMore:true,nextCursor:'same'}),signal)).rejects.toThrow('未推进')
})
it('cancels stale traversal before publishing or starting another branch',async()=>{
 const controller=new AbortController();let calls=0
 await expect(loadWorldCommentPage(start,async ref=>{calls++;controller.abort();return {items:[item('child',ref)],hasMore:false}},controller.signal)).rejects.toMatchObject({name:'AbortError'})
 expect(calls).toBe(1)
})
