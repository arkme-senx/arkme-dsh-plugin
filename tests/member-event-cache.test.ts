import { afterEach, describe, expect, it, vi } from 'vitest'
import { arkmeMemberEvents } from '../src/client/member-event-cache.js'
import { publishMemberEventHint } from '../src/client/member-event-hints.js'
import type { ArkmeMemberEvent, ArkmeMemberEventPage, ArkmeMemberEventQuery } from '../src/types.js'

const event = (eventId: string, occurredAtMillis: number): ArkmeMemberEvent => ({eventId,occurredAtMillis,type:'left',displayName:'李四'})
const leases: Array<ReturnType<typeof arkmeMemberEvents.attach>> = []
const attach = (group: string, read: (query: ArkmeMemberEventQuery) => Promise<ArkmeMemberEventPage>, account = 'test:42') => {
  const lease = arkmeMemberEvents.attach(account,group,read,()=>{})
  leases.push(lease)
  return lease
}
afterEach(()=>{
  for(const lease of leases.splice(0))lease.release()
  arkmeMemberEvents.activateAccount(undefined)
  vi.useRealTimers()
})

describe('shared member-event cache',()=>{
  it('resumes the original signed cursor after switching views and does not re-fetch completed pages',async()=>{
    vi.useFakeTimers();vi.setSystemTime(1000)
    const queries:ArkmeMemberEventQuery[]=[]
    const read=async(query:ArkmeMemberEventQuery):Promise<ArkmeMemberEventPage>=>{
      queries.push(query)
      return query.cursor===undefined
        ? {items:[event('b',900)],hasMore:true,nextCursor:'signed-for-100-1000'}
        : {items:[event('a',150)],hasMore:false}
    }
    const first=attach('one',read)
    await first.timeline.enterWindow(100,1000,'latest');first.release()
    vi.setSystemTime(2000)
    const second=attach('one',read)
    await second.timeline.enterWindow(100,200,'around')
    expect(second.timeline.snapshot().events).toEqual([])
    expect(second.timeline.snapshot().gaps).toHaveLength(1)
    await second.timeline.loadGap(second.timeline.snapshot().gaps[0]!.id)
    expect(queries).toEqual([
      {fromAtMillis:100,toAtMillis:1000,limit:50},
      {fromAtMillis:100,toAtMillis:1000,limit:50,cursor:'signed-for-100-1000'},
    ])
    expect(second.timeline.snapshot().events.map(row=>row.eventId)).toEqual(['a'])
    second.release()
    const third=attach('one',read)
    await third.timeline.enterWindow(100,3000,'latest')
    expect(queries).toHaveLength(2)
    expect(third.timeline.snapshot().events.map(row=>row.eventId)).toEqual(['a','b'])
    expect(third.timeline.snapshot().gaps).toEqual([])
  })

  it('fills a hole between independently cached historical windows',async()=>{
    vi.useFakeTimers();vi.setSystemTime(1000)
    const queries:ArkmeMemberEventQuery[]=[]
    const lease=attach('one',async(query)=>{queries.push(query);return {items:[],hasMore:false}})
    await lease.timeline.enterWindow(100,200,'around')
    await lease.timeline.enterWindow(800,1000,'around')
    await lease.timeline.enterWindow(150,850,'around')
    expect(queries.map(query=>[query.fromAtMillis,query.toAtMillis])).toEqual([[100,200],[800,1000],[201,799]])
  })

  it('does not extend the freshness of the latest page by reading an older cursor',async()=>{
    vi.useFakeTimers();vi.setSystemTime(1000)
    const queries:ArkmeMemberEventQuery[]=[]
    const lease=attach('one',async(query)=>{
      queries.push(query)
      return query.cursor===undefined
        ? {items:[event('newer',900)],hasMore:true,nextCursor:'older'}
        : {items:[event('older',150)],hasMore:false}
    })
    await lease.timeline.enterWindow(100,1000,'latest')
    vi.setSystemTime(300000)
    await lease.timeline.loadGap(lease.timeline.snapshot().gaps[0]!.id)
    vi.setSystemTime(301001)
    await lease.timeline.enterWindow(100,301001,'latest')
    expect(queries).toHaveLength(3)
    expect(queries[2]).toMatchObject({fromAtMillis:100,toAtMillis:301001})
  })

  it('evicts the least recently used group and retains a recently revisited empty result',async()=>{
    vi.useFakeTimers();vi.setSystemTime(1000)
    const queries:string[]=[]
    const open=async(group:string)=>{
      const lease=attach(group,async()=>{queries.push(group);return {items:[],hasMore:false}})
      await lease.timeline.enterWindow(0,1000,'latest');lease.release()
    }
    for(let i=0;i<20;i++)await open(`group-${i}`)
    await open('group-0')
    await open('group-20')
    await open('group-0')
    await open('group-1')
    expect(queries.filter(group=>group==='group-0')).toHaveLength(1)
    expect(queries.filter(group=>group==='group-1')).toHaveLength(2)
  })

  it('bounds retained rows and discards coverage for pages whose rows were evicted',async()=>{
    vi.useFakeTimers();vi.setSystemTime(2000)
    let reads=0
    const read=async(query:ArkmeMemberEventQuery):Promise<ArkmeMemberEventPage>=>{
      reads++
      const page=Number(query.cursor??0)
      const rows=Array.from({length:page===20?1:50},(_,index)=>event(String(1001-page*50-index),1001-page*50-index))
      return page===20?{items:rows,hasMore:false}:{items:rows,hasMore:true,nextCursor:String(page+1)}
    }
    const first=attach('one',read)
    await first.timeline.enterWindow(0,2000,'latest')
    for(let i=0;i<20;i++)await first.timeline.loadGap(first.timeline.snapshot().gaps[0]!.id)
    expect(first.timeline.snapshot().events).toHaveLength(1001)
    first.release()
    expect(first.timeline.snapshot().events).toHaveLength(1000)
    const second=attach('one',read)
    await second.timeline.enterWindow(0,2000,'latest')
    expect(reads).toBe(22)
    expect(second.timeline.snapshot().gaps).toHaveLength(1)
  })

  it('keeps latest data dirty after a notification refreshes only an around window',async()=>{
    vi.useFakeTimers();vi.setSystemTime(1000)
    const queries:ArkmeMemberEventQuery[]=[]
    const lease=attach('one',async(query)=>{
      queries.push(query)
      return {items:query.toAtMillis>=1200?[event('future',1200)]:[],hasMore:false}
    })
    await lease.timeline.enterWindow(100,1000,'latest')
    await lease.timeline.enterWindow(100,200,'around');lease.setForeground(true)
    publishMemberEventHint({account:'test:42',sourceKey:'one',eventId:'future',occurredAtMillis:1200})
    await vi.advanceTimersByTimeAsync(300)
    expect(queries[1]).toMatchObject({fromAtMillis:100,toAtMillis:200})
    expect(lease.timeline.snapshot().events).toEqual([])
    await lease.timeline.enterWindow(100,1300,'latest')
    expect(lease.timeline.snapshot().events.map(row=>row.eventId)).toEqual(['future'])
  })

  it('clears cached rows on denial and cannot revive them with a late in-flight result',async()=>{
    let finish!:(page:ArkmeMemberEventPage)=>void
    const lease=attach('one',async()=>await new Promise(resolve=>{finish=resolve}))
    const pending=lease.timeline.enterWindow(0,1000,'latest')
    arkmeMemberEvents.revoke('test:42','one')
    finish({items:[event('late',150)],hasMore:false});await pending
    expect(lease.timeline.snapshot()).toMatchObject({events:[],unavailable:true})
    const read=vi.fn(async()=>({items:[],hasMore:false}))
    const next=attach('one',read)
    await next.timeline.enterWindow(0,1000,'latest')
    expect(read).toHaveBeenCalledTimes(1)
    expect(next.timeline.snapshot().events).toEqual([])
  })
})
