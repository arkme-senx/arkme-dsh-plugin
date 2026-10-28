import { expect, it, vi } from 'vitest'
import { SharedPersonRecords, personRecordKey, type SharedPersonSnapshot } from '../src/client/shared-person-records.js'
import { ArkmeClientError } from '../src/client/api.js'
import type { PersonRecordSource } from '../src/person-records.js'
const source = (id:string):PersonRecordSource => ({source:{sourceRef:id,sourceKey:id,kind:'group_chat',displayName:id,activeAtMillis:0,unreadCount:0},memberRef:`member:${id}`})
const row = (id:string,seq:number,time=seq) => ({itemUid:id,timelineItemKey:`event:${seq}`,sequence:seq,sendAtMillis:time,senderName:'TA',isMe:false,title:'',textContent:id,status:1})
const page = (s:PersonRecordSource,items:ReturnType<typeof row>[],before?:number)=>({source:s.source,member:{memberRef:s.memberRef} as never,mode:'owner' as const,items,hasMore:before!==undefined,...(before===undefined?{}:{nextCursor:{beforeSequence:before}})})
it('publishes entry first, merges source-specific occurrences and resumes each numeric cursor independently',async()=>{
 const events:SharedPersonSnapshot[]=[];const entry=source('entry'),group=source('other')
 const records=vi.fn(async(s:PersonRecordSource,before?:number)=> before===undefined?page(s,[row('same-record',10,s.source.sourceRef===entry.source.sourceRef?100:90)],s.source.sourceRef===entry.source.sourceRef?9:400):page(s,[row('older',before-1,20)]))
 const read=new SharedPersonRecords(entry,{sources:async()=>({items:[group,entry],hasMore:false}),records},new AbortController().signal,s=>events.push(s))
 await read.load();expect(events[0]!.items).toHaveLength(1);expect(read.snapshot().items).toHaveLength(2)
 expect(new Set(read.snapshot().items.map(personRecordKey)).size).toBe(2)
 await read.load(true);expect(records.mock.calls.filter(([,b])=>b!==undefined).map(([s,b])=>[s.source.sourceRef,b])).toEqual([['entry',9],['other',400]])
 expect(read.snapshot().items).toHaveLength(4);expect(read.snapshot().hasMore).toBe(false)
})
it('limits message fanout to two and stops after a bounded discovery page',async()=>{
 let active=0,max=0;const entry=source('entry');let release!:()=>void
 const gate=new Promise<void>(r=>{release=r});const records=vi.fn(async(s:PersonRecordSource)=>{active++;max=Math.max(active,max);if(s.source.sourceRef!==entry.source.sourceRef)await gate;active--;return page(s,[])})
 const reads=new SharedPersonRecords(entry,{sources:async()=>({items:[source('a'),source('b'),source('c')],hasMore:true,nextCursor:'next'}),records},new AbortController().signal,()=>{})
 const work=reads.load();await vi.waitFor(()=>expect(active).toBe(2));release();await work
 expect(max).toBe(2);expect(reads.snapshot()).toMatchObject({discovering:true,discovered:4,read:4})
})
it('retains successful sources and retries only the failed page with the same older cursor',async()=>{
 let fail=true;const entry=source('entry');const records=vi.fn(async(s:PersonRecordSource,b?:number)=>{if(b!==undefined&&fail)throw Error('offline');return page(s,[row(b?'older':'first',b??10)],b===undefined?9:undefined)})
 const reads=new SharedPersonRecords(entry,{sources:async()=>({items:[],hasMore:false}),records},new AbortController().signal,()=>{})
 await reads.load();await reads.load(true);expect(reads.snapshot().items).toHaveLength(1);expect(reads.snapshot().error).toContain('可重试')
 fail=false;await reads.load(true);expect(records.mock.calls.map(([,b])=>b)).toEqual([undefined,9,9]);expect(reads.snapshot().error).toBe('')
})
it('does not publish late pages after closing and never starts queued sources',async()=>{
 const controller=new AbortController();let resolve!:(p:ReturnType<typeof page>)=>void;const update=vi.fn();const entry=source('entry');const sources=vi.fn()
 const reads=new SharedPersonRecords(entry,{sources,records:()=>new Promise(r=>{resolve=r})},controller.signal,update)
 const work=reads.load();controller.abort();resolve(page(entry,[row('late',1)]));await expect(work).rejects.toThrow();expect(update).not.toHaveBeenCalled();expect(sources).not.toHaveBeenCalled()
})
it('removes revoked source content and propagates entry revocation instead of showing stale data',async()=>{
 const entry=source('entry');const denied=new ArkmeClientError({code:'chat-member-ref-stale',message:'revoked',retryable:false})
 const records=vi.fn(async(s:PersonRecordSource,b?:number)=>{if(b)throw denied;return page(s,[row('first',10)],9)})
 const reads=new SharedPersonRecords(entry,{sources:async()=>({items:[],hasMore:false}),records},new AbortController().signal,()=>{})
 await reads.load();await expect(reads.load(true)).rejects.toThrow('revoked');expect(reads.snapshot().items).toEqual([])
})
it('rejects nonadvancing pages without losing the earlier valid page',async()=>{
 const entry=source('entry');const reads=new SharedPersonRecords(entry,{sources:async()=>({items:[],hasMore:false}),records:async(s,b)=>page(s,[row(b?'invalid':'valid',10)],9)},new AbortController().signal,()=>{})
 await reads.load();await reads.load(true);expect(reads.snapshot().items.map(x=>x.itemUid)).toEqual(['valid']);expect(reads.snapshot().error).toContain('可重试')
})
it('rejects mixed-person/source replies and deduplicates exact occurrences without merging genuine resends',async()=>{
 const entry=source('entry'),other=source('other');const reads=new SharedPersonRecords(entry,{sources:async()=>({items:[other],hasMore:false}),records:async(s)=>s.source.sourceRef===entry.source.sourceRef?page(s,[row('same',1),row('same',2),row('same',1)]):page(entry,[row('wrong',3)])},new AbortController().signal,()=>{})
 await reads.load();expect(reads.snapshot().items).toHaveLength(2);expect(reads.snapshot().error).toContain('可重试')
})

it('does not attribute another sender to the selected person',async()=>{
 const entry=source('entry');const reads=new SharedPersonRecords(entry,{sources:async()=>({items:[],hasMore:false}),records:async s=>page(s,[{...row('other-sender',1),memberRef:'another-person'}])},new AbortController().signal,()=>{})
 await reads.load();expect(reads.snapshot().items).toEqual([]);expect(reads.snapshot().error).toContain('可重试')
})

it('uses one aggregate page, retries its cursor, and removes explicitly revoked events', async () => {
 const entry=source('entry');let fail=false;let calls=0
 const aggregate=vi.fn(async(cursor?:string,known?:readonly string[])=>{
  calls++;if(fail)throw Error('temporary')
  return {version:1 as const,supported:true,items:[{...row(cursor?'same-record':'same-record',calls,100-calls),personSource:source(cursor?'other':'entry').source,eventRef:cursor?'event-b':'event-a'}],hasMore:!cursor,...(!cursor?{nextCursor:'global-cursor'}:{}),removedEventRefs:cursor?['event-a']:[],coverage:'current_chat_relations' as const}
 })
 const records=vi.fn(),sources=vi.fn();const read=new SharedPersonRecords(entry,{aggregate,records,sources},new AbortController().signal,()=>{})
 await read.load();expect(read.snapshot().items).toHaveLength(1);expect(sources).not.toHaveBeenCalled();expect(records).not.toHaveBeenCalled()
 fail=true;await read.load(true);expect(read.snapshot().items).toHaveLength(1);expect(read.snapshot().hasMore).toBe(true)
 fail=false;await read.load(true);expect(aggregate.mock.calls.slice(1).map(([cursor])=>cursor)).toEqual(['global-cursor','global-cursor']);expect(read.snapshot().items).toHaveLength(1);expect(read.snapshot().items[0]?.personSource?.sourceRef).toBe('other')
})
it('falls back to existing composition only when the server explicitly lacks aggregation',async()=>{
 const entry=source('entry');const aggregate=vi.fn(async()=>({version:1 as const,supported:false,items:[],hasMore:false,removedEventRefs:[],coverage:'current_chat_relations' as const}));const sources=vi.fn(async()=>({items:[],hasMore:false}));const records=vi.fn(async()=>page(entry,[row('entry',1)]))
 const read=new SharedPersonRecords(entry,{aggregate,sources,records},new AbortController().signal,()=>{});await read.load();expect(read.snapshot().items).toHaveLength(1);expect(aggregate).toHaveBeenCalledTimes(1);expect(records).toHaveBeenCalledTimes(1)
})

it('continues past 500 with one bounded page request and revalidates every retained page in batches', async () => {
 const entry=source('entry');let next=0;const aggregate=vi.fn(async(cursor?:string,known?:readonly string[],validateOnly?:boolean)=>{
  expect(known?.length??0).toBeLessThanOrEqual(500)
  if(validateOnly)return {version:1 as const,supported:true,items:[],hasMore:false,removedEventRefs:known?.filter(ref=>ref==='event-1'||ref==='event-1100')??[],coverage:'current_chat_relations' as const}
  expect(cursor).toBe(next===0?undefined:String(next));const from=next;next+=20
  return {version:1 as const,supported:true,items:Array.from({length:20},(_,i)=>({...row('same-record',from+i,1200-from-i),personSource:entry.source,eventRef:'event-'+(from+i)})),hasMore:next<1200,...(next<1200?{nextCursor:String(next)}:{}),removedEventRefs:[],coverage:'current_chat_relations' as const}
 })
 const read=new SharedPersonRecords(entry,{aggregate,sources:vi.fn(),records:vi.fn()},new AbortController().signal,()=>{})
 for(let i=0;i<60;i++)await read.load(i>0)
 expect(read.snapshot()).toMatchObject({hasMore:false,error:''});expect(read.snapshot().items).toHaveLength(1200)
 expect(aggregate).toHaveBeenCalledTimes(60)
 expect(aggregate.mock.calls[26]?.[1]).toHaveLength(500)
 await read.revalidate()
 expect(aggregate.mock.calls.filter(c=>c[2]).map(c=>c[1]?.length)).toEqual([500,500,200])
 expect(read.snapshot().items).toHaveLength(1198)
 expect(new Set(read.snapshot().items.map(x=>(x as {eventRef?:string}).eventRef)).size).toBe(1198)
})

it('cancels queued validation batches after closing without publishing stale updates',async()=>{
 const entry=source('entry'),controller=new AbortController(),update=vi.fn();let next=0,release!:(v:never)=>void
 const aggregate=vi.fn(async(_cursor?:string,_known?:readonly string[],validateOnly?:boolean)=>{
  if(validateOnly)return await new Promise<never>(r=>{release=r})
  const from=next;next+=20;return{version:1 as const,supported:true,items:Array.from({length:20},(_,i)=>({...row('r',from+i),personSource:entry.source,eventRef:'event-'+(from+i)})),hasMore:true,nextCursor:String(next),removedEventRefs:[],coverage:'current_chat_relations' as const}
 })
 const read=new SharedPersonRecords(entry,{aggregate,sources:vi.fn(),records:vi.fn()},controller.signal,update)
 for(let i=0;i<30;i++)await read.load(i>0)
 update.mockClear();const pending=read.revalidate();await vi.waitFor(()=>expect(release).toBeDefined());controller.abort();release({supported:true,removedEventRefs:[]} as never)
 await expect(pending).rejects.toThrow();expect(aggregate.mock.calls.filter(c=>c[2])).toHaveLength(1);expect(update).not.toHaveBeenCalled()
})

it('keeps long signed references below the Host body budget while reading past500 and revalidating all',async()=>{
 const entry=source('entry');let next=0;const checked=new Set<string>();const ref=(n:number)=>'signed-'+String(n)+'-'+('x'.repeat(800))
 const aggregate=vi.fn(async(cursor?:string,known?:readonly string[],validateOnly?:boolean)=>{
  expect(new TextEncoder().encode(JSON.stringify(known??[])).byteLength).toBeLessThan(64*1024)
  expect(known?.length??0).toBeLessThanOrEqual(500)
  if(validateOnly){for(const r of known??[])checked.add(r);return{version:1 as const,supported:true,items:[],hasMore:false,removedEventRefs:[],coverage:'current_chat_relations' as const}}
  expect(cursor).toBe(next===0?undefined:String(next));const from=next;next+=20;return{version:1 as const,supported:true,items:Array.from({length:20},(_,i)=>({...row('r',from+i),personSource:entry.source,eventRef:ref(from+i)})),hasMore:next<620,...(next<620?{nextCursor:String(next)}:{}),removedEventRefs:[],coverage:'current_chat_relations' as const}
 })
 const read=new SharedPersonRecords(entry,{aggregate,sources:vi.fn(),records:vi.fn()},new AbortController().signal,()=>{})
 for(let i=0;i<31;i++)await read.load(i>0)
 expect(read.snapshot()).toMatchObject({hasMore:false,error:''});expect(read.snapshot().items).toHaveLength(620)
 await read.revalidate();expect(checked.size).toBe(620);expect(aggregate.mock.calls.filter(c=>c[2]).length).toBeGreaterThan(2)
})
