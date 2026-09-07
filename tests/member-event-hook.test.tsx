import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMemberEventTimeline } from '../src/client/use-member-event-timeline.js'
import { publishMemberEventHint } from '../src/client/member-event-hints.js'
import type { ArkmeMemberEvent, ArkmeMemberEventPage, ArkmeTimelineItem } from '../src/types.js'

const {read}=vi.hoisted(()=>({read:vi.fn(async(..._args: unknown[]):Promise<ArkmeMemberEventPage>=>({items:[],hasMore:false}))}))
vi.mock('../src/client/api.js',()=>({callArkme:read}))
let renderer:ReactTestRenderer|undefined
afterEach(async()=>{
  await render({...defaults,enabled:false,accountKey:undefined})
  await act(async()=>renderer!.unmount());renderer=undefined
  read.mockReset();read.mockResolvedValue({items:[],hasMore:false});vi.useRealTimers()
})
const message=(time:number)=>({itemUid:`record-${time}`,sendAtMillis:time}) as ArkmeTimelineItem
type Options=Parameters<typeof useMemberEventTimeline>[0]
const defaults:Options={enabled:true,accountKey:'test:42',sourceKey:'group-1',sourceRef:'ref-1',mode:'latest',windowRevision:0,ready:true,items:[message(100)],hasMoreMessages:true,paginationKey:'initial',bodyRef:{current:null},beforeChange:()=>{}}
let snapshot:ReturnType<typeof useMemberEventTimeline>
let renderedRows:string[][]=[]
function Harness({options}:{options:Options}){
  snapshot=useMemberEventTimeline(options)
  renderedRows.push(snapshot.events.map(event=>event.eventId))
  return null
}
const render=async(options:Options)=>{await act(async()=>{if(renderer===undefined)renderer=create(createElement(Harness,{options}));else renderer.update(createElement(Harness,{options}))})}
const leave=(eventId:string,occurredAtMillis=150):ArkmeMemberEvent=>({eventId,occurredAtMillis,type:'left',displayName:'李四'})
const anotherGroup={...defaults,sourceKey:'group-2',sourceRef:'ref-2'}

describe('member event timeline hook integration',()=>{
  it.each([
    {enabled:true,ready:true},
    {enabled:true,ready:false},
    {enabled:false,ready:true},
    {enabled:false,ready:false},
  ])('shows cached rows in the first render while loading gates are pending (%j)',async(gates)=>{
    vi.useFakeTimers();vi.setSystemTime(1000)
    read.mockResolvedValueOnce({items:[leave('cached')],hasMore:false})
    await render(defaults)
    await render(anotherGroup)
    renderedRows=[]
    await render({...defaults,...gates,restoreCached:true,windowReady:true})
    expect(renderedRows[0]).toEqual(['cached'])
    expect(snapshot.events.map(event=>event.eventId)).toEqual(['cached'])
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('restores cached rows in the first render after the component is remounted',async()=>{
    vi.useFakeTimers();vi.setSystemTime(1000)
    read.mockResolvedValueOnce({items:[leave('cached')],hasMore:false})
    await render(defaults)
    await act(async()=>renderer!.unmount());renderer=undefined
    renderedRows=[]
    await render({...defaults,enabled:false,ready:false,restoreCached:true,windowReady:false})
    expect(renderedRows[0]).toEqual(['cached'])
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('does not flash cached rows for another account or after explicit access revocation',async()=>{
    vi.useFakeTimers();vi.setSystemTime(1000)
    read.mockResolvedValueOnce({items:[leave('cached')],hasMore:false})
    await render(defaults)
    renderedRows=[]
    await render({...defaults,enabled:false,ready:false,restoreCached:true,accountKey:'test:99'})
    expect(renderedRows.every(rows=>rows.length===0)).toBe(true)
    read.mockResolvedValueOnce({items:[leave('cached')],hasMore:false})
    await render(defaults)
    renderedRows=[]
    await render({...defaults,enabled:false,ready:false,restoreCached:true,accessRevoked:true})
    expect(renderedRows.every(rows=>rows.length===0)).toBe(true)
    await render({...defaults,enabled:false,ready:false,restoreCached:true})
    expect(snapshot.events).toEqual([])
  })

  it('filters a cached around window synchronously without flashing future or older rows',async()=>{
    vi.useFakeTimers();vi.setSystemTime(1000)
    read.mockResolvedValueOnce({items:[leave('too-old',50),leave('inside',150),leave('future',900)],hasMore:false})
    await render({...defaults,hasMoreMessages:false})
    await render(anotherGroup)
    renderedRows=[]
    await render({...defaults,mode:'around',items:[message(100),message(200)],enabled:false,ready:false,restoreCached:true,windowReady:true})
    expect(renderedRows[0]).toEqual(['inside'])
    expect(renderedRows.every(rows=>rows.length===1&&rows[0]==='inside')).toBe(true)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('does not turn cache restoration into a cold read before owner eligibility is known',async()=>{
    await render({...defaults,enabled:false,restoreCached:true,windowReady:true})
    expect(snapshot.events).toEqual([])
    expect(read).not.toHaveBeenCalled()
    await render({...defaults,restoreCached:true})
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('keeps cached rows visible during a member refresh without querying on a pending hint',async()=>{
    vi.useFakeTimers();vi.setSystemTime(1000)
    read.mockResolvedValueOnce({items:[leave('cached')],hasMore:false})
    await render(defaults)
    await render(anotherGroup)
    await render({...defaults,enabled:false,ready:false,restoreCached:true,windowReady:true})
    await act(async()=>{
      publishMemberEventHint({account:'test:42',sourceKey:'group-1',eventId:'new',occurredAtMillis:1200})
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(snapshot.events.map(event=>event.eventId)).toEqual(['cached'])
    expect(read).toHaveBeenCalledTimes(2)
    read.mockResolvedValueOnce({items:[leave('cached'),leave('new',1200)],hasMore:false})
    await render({...defaults,restoreCached:true})
    expect(read).toHaveBeenCalledTimes(3)
    expect(snapshot.events.map(event=>event.eventId)).toEqual(['cached','new'])
  })

  it.each([false,true])('reuses records and empty results across switches and remounts (empty=%s)',async(empty)=>{
    vi.useFakeTimers();vi.setSystemTime(1000)
    read.mockResolvedValue({items:empty?[]:[leave('first')],hasMore:false})
    await render(defaults)
    vi.setSystemTime(2000);await render(anotherGroup)
    vi.setSystemTime(3000);await render(defaults)
    expect(read).toHaveBeenCalledTimes(2)
    expect(snapshot.events.map(event=>event.eventId)).toEqual(empty?[]:['first'])
    await act(async()=>renderer!.unmount());renderer=undefined
    vi.setSystemTime(4000);await render(defaults)
    expect(read).toHaveBeenCalledTimes(2)
    expect(snapshot.events.map(event=>event.eventId)).toEqual(empty?[]:['first'])
  })

  it('expires only on entry, shows stale rows during refresh, and does not retry a failure',async()=>{
    vi.useFakeTimers();vi.setSystemTime(1000)
    read.mockResolvedValueOnce({items:[leave('cached')],hasMore:false})
    await render(defaults)
    await act(async()=>{await vi.advanceTimersByTimeAsync(300_001)})
    expect(read).toHaveBeenCalledTimes(1)
    await render(anotherGroup)
    let reject!:(error:Error)=>void
    read.mockImplementationOnce(async()=>await new Promise((_resolve,no)=>{reject=no}))
    await render(defaults)
    expect(read).toHaveBeenCalledTimes(3)
    expect(snapshot.events.map(event=>event.eventId)).toEqual(['cached'])
    expect(snapshot.loading).toBe(true)
    await act(async()=>{reject(new Error('offline'));await vi.advanceTimersByTimeAsync(600_000)})
    expect(read).toHaveBeenCalledTimes(3)
    expect(snapshot.events.map(event=>event.eventId)).toEqual(['cached'])
  })

  it('applies a failure cooldown across rapid re-entry without scheduling retries',async()=>{
    vi.useFakeTimers();vi.setSystemTime(1000)
    read.mockRejectedValueOnce(new Error('offline'))
    await render(defaults)
    await render(anotherGroup)
    vi.setSystemTime(1100);await render(defaults)
    expect(read).toHaveBeenCalledTimes(2)
    await act(async()=>{await vi.advanceTimersByTimeAsync(3000)})
    expect(read).toHaveBeenCalledTimes(2)
    await render(anotherGroup);await render(defaults)
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('remembers inactive-group hints without fetching and refreshes once on re-entry',async()=>{
    vi.useFakeTimers();vi.setSystemTime(1000)
    await render(defaults)
    await render(anotherGroup)
    await act(async()=>{
      for(let i=0;i<10;i++)publishMemberEventHint({account:'test:42',sourceKey:'group-1',eventId:`leave-${i}`,occurredAtMillis:1200})
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(read).toHaveBeenCalledTimes(2)
    read.mockResolvedValueOnce({items:[leave('new',1200)],hasMore:false})
    await render(defaults)
    expect(read).toHaveBeenCalledTimes(3)
    expect(snapshot.events.map(event=>event.eventId)).toEqual(['new'])
    await render(anotherGroup);await render(defaults)
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('shares an unfinished request across rapid switches and ignores late old-account results',async()=>{
    vi.useFakeTimers();vi.setSystemTime(1000)
    let finish!:(page:ArkmeMemberEventPage)=>void
    read.mockImplementationOnce(async()=>await new Promise(resolve=>{finish=resolve}))
    await render(defaults)
    vi.setSystemTime(1100);await render(anotherGroup)
    vi.setSystemTime(1200);await render(defaults)
    expect(read).toHaveBeenCalledTimes(2)
    await render({...defaults,accountKey:'test:99'})
    await act(async()=>{finish({items:[leave('old-account')],hasMore:false})})
    expect(snapshot.events).toEqual([])
    await render(defaults)
    expect(read).toHaveBeenCalledTimes(4)
    expect(snapshot.events).toEqual([])
  })

  it('reuses covered history after remount but queries only an uncovered earlier interval',async()=>{
    vi.useFakeTimers();vi.setSystemTime(1000)
    await render(defaults)
    await render({...defaults,items:[message(50),message(100)],paginationKey:'older'})
    await render(anotherGroup)
    await render({...defaults,items:[message(25),message(100)],paginationKey:'oldest'})
    expect(read).toHaveBeenCalledTimes(4)
    expect(read.mock.calls[3]?.[1]).toMatchObject({fromAtMillis:25,toAtMillis:49})
  })

  it('shares cached rows with an around view without including future events',async()=>{
    vi.useFakeTimers();vi.setSystemTime(1000)
    read.mockResolvedValue({items:[leave('old',150),leave('future',900)],hasMore:false})
    await render(defaults)
    await render({...defaults,mode:'around',items:[message(100),message(200)]})
    expect(snapshot.events.map(event=>event.eventId)).toEqual(['old'])
    expect(read).toHaveBeenCalledTimes(1)
    await render(defaults)
    expect(snapshot.events.map(event=>event.eventId)).toEqual(['old','future'])
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('keeps a notification received during a refresh pending until a subsequent read',async()=>{
    vi.useFakeTimers();vi.setSystemTime(1000)
    await render(defaults)
    let finish!:(page:ArkmeMemberEventPage)=>void
    read.mockImplementationOnce(async()=>await new Promise(resolve=>{finish=resolve}))
    await act(async()=>{
      publishMemberEventHint({account:'test:42',sourceKey:'group-1',eventId:'first-hint',occurredAtMillis:1100})
      await vi.advanceTimersByTimeAsync(300)
      publishMemberEventHint({account:'test:42',sourceKey:'group-1',eventId:'during-read',occurredAtMillis:1400})
    })
    expect(read).toHaveBeenCalledTimes(2)
    read.mockResolvedValueOnce({items:[leave('during-read',1400)],hasMore:false})
    await act(async()=>{finish({items:[],hasMore:false});await vi.advanceTimersByTimeAsync(2000)})
    expect(read).toHaveBeenCalledTimes(3)
    expect(snapshot.events.map(event=>event.eventId)).toEqual(['during-read'])
  })

  it('does not read for ordinary messages or re-renders, and expands on history pages',async()=>{
    vi.useFakeTimers();vi.setSystemTime(1000)
    await render(defaults)
    expect(read).toHaveBeenCalledTimes(1)
    await render({...defaults,items:[message(100),message(200)]})
    expect(read).toHaveBeenCalledTimes(1)
    await render({...defaults,items:[message(50),message(100),message(200)],paginationKey:'older'})
    expect(read).toHaveBeenCalledTimes(2)
    expect(read.mock.calls[1]?.[1]).toMatchObject({fromAtMillis:50,toAtMillis:99})
    await act(async()=>{publishMemberEventHint({account:'test:42',sourceKey:'another-group',eventId:'x',occurredAtMillis:300});await vi.advanceTimersByTimeAsync(60_000)})
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('does not show future events in an around window and ignores old-account hints',async()=>{
    vi.useFakeTimers();vi.setSystemTime(1000)
    await render({...defaults,mode:'around',items:[message(100),message(200)]})
    expect(read.mock.calls[0]?.[1]).toMatchObject({fromAtMillis:100,toAtMillis:200})
    await act(async()=>{publishMemberEventHint({account:'test:42',sourceKey:'group-1',eventId:'future',occurredAtMillis:900});await vi.advanceTimersByTimeAsync(300)})
    expect(read.mock.calls[1]?.[1]).toMatchObject({fromAtMillis:100,toAtMillis:200})
    await render({...defaults,accountKey:'test:99'})
    const count=read.mock.calls.length
    await act(async()=>{publishMemberEventHint({account:'test:42',sourceKey:'group-1',eventId:'old-account',occurredAtMillis:1100});await vi.advanceTimersByTimeAsync(60_000)})
    expect(read).toHaveBeenCalledTimes(count)
  })

  it('waits for the quick-note window and owner eligibility, with no member reads',async()=>{
    await render({...defaults,enabled:false})
    expect(read).not.toHaveBeenCalled()
    await render({...defaults,ready:false})
    expect(read).not.toHaveBeenCalled()
    await render({...defaults,items:[],hasMoreMessages:false})
    expect(read).toHaveBeenCalledTimes(1)
    expect(read.mock.calls[0]?.[1]).toMatchObject({fromAtMillis:0})
  })

  it('clears history when owner access is explicitly lost but preserves it during a loading gate',async()=>{
    vi.useFakeTimers();vi.setSystemTime(1000)
    read.mockResolvedValueOnce({items:[leave('cached')],hasMore:false})
    await render(defaults)
    await render({...defaults,enabled:false})
    await render(defaults)
    expect(read).toHaveBeenCalledTimes(1)
    await render({...defaults,enabled:false,accessRevoked:true})
    expect(snapshot.events).toEqual([])
    await render(defaults)
    expect(read).toHaveBeenCalledTimes(2)
    expect(snapshot.events).toEqual([])
  })

  it('opens event history before the first quick note when around pagination reaches the beginning',async()=>{
    await render({...defaults,mode:'around',items:[message(100),message(200)]})
    await render({...defaults,mode:'around',items:[message(50),message(100),message(200)],hasMoreMessages:false,paginationKey:'oldest'})
    expect(read.mock.calls[1]?.[1]).toMatchObject({fromAtMillis:0,toAtMillis:99})
    expect(read).toHaveBeenCalledTimes(2)
  })
})
