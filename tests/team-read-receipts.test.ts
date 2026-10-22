import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeamMessage, TeamReceipts } from '../src/team-app-contract.js'
const { call } = vi.hoisted(() => ({call:vi.fn()}))
vi.mock('../src/client/api.js', () => ({callArkme:call}))
import { TeamReceiptStore, teamReceiptCounts, mergeTeamReceiptMembers } from '../src/client/team-read-receipts.js'
const message = (key='m') => ({key, ref:key}) as TeamMessage
const page = (overrides:Partial<TeamReceipts>={}):TeamReceipts => ({summary:{read:1,unread:1,total:2},hasMore:false,senderExcluded:true,members:[{key:'a',nickname:'同名',read:true},{key:'b',nickname:'同名',read:false}],...overrides})
afterEach(()=>{call.mockReset(); vi.useRealTimers()})
describe('team read receipts',()=>{
  it('batches 120 visible summaries in bounded pages without loading any member identities',async()=>{
    vi.useFakeTimers()
    call.mockImplementation(async(op,p)=>({items:p.messageRefs.map((key:string)=>({key,summary:{read:1,unread:999,total:1000}})),myReadSeq:8,unread:0}))
    const store=new TeamReceiptStore('prod:11'), read=vi.fn(), stop=store.subscribeReadState(read)
    for(let i=0;i<120;i++)store.watch(message(String(i)))
    await vi.runAllTimersAsync()
    expect(call.mock.calls.map(args=>args[1].messageRefs.length)).toEqual([50,50,20])
    expect(call.mock.calls.every(args=>args[0]==='team.app.receipt-summaries'&&args[1].expectedAccountKey==='prod:11')).toBe(true)
    expect(store.get('0').value?.members).toEqual([])
    expect(teamReceiptCounts(store.get('0').value)).toEqual({read:1,unread:999,total:1000})
    expect(read).toHaveBeenCalledWith(expect.objectContaining({myReadSeq:8,unread:0}))
    stop();store.dispose()
  })
  it('re-reads active summaries when a receipt invalidation arrives during the request',async()=>{
    vi.useFakeTimers()
    let resolve!:(value:unknown)=>void
    const result=(read:number)=>({items:[{key:'m',summary:{read,unread:2-read,total:2}}],myReadSeq:read,unread:0})
    call.mockImplementationOnce(()=>new Promise(r=>resolve=r)).mockResolvedValue(result(2))
    const store=new TeamReceiptStore('prod:11');store.watch(message());await vi.advanceTimersByTimeAsync(0)
    store.refreshVisible(true);resolve(result(1));await vi.runAllTimersAsync()
    expect(call).toHaveBeenCalledTimes(2)
    expect(teamReceiptCounts(store.get('m').value)?.read).toBe(2)
    store.dispose()
  })
  it('coalesces a detail invalidation burst into one follow-up request',async()=>{
    let resolve!:(value:TeamReceipts)=>void
    call.mockImplementationOnce(()=>new Promise(r=>resolve=r)).mockResolvedValue(page())
    const store=new TeamReceiptStore('prod:11'), first=store.load(message())
    const requests=Array.from({length:1000},()=>store.load(message(),false,true))
    resolve(page());await Promise.all([first,...requests])
    expect(call).toHaveBeenCalledTimes(2)
    store.dispose()
  })
  it('uses authoritative totals independently of loaded roster pages and identities',()=>{
    expect(teamReceiptCounts(page())).toEqual({read:1,unread:1,total:2})
    for(const override of [{hasMore:true},{senderExcluded:false},{members:[{nickname:'未知',read:false}]},{members:[]}]) expect(teamReceiptCounts(page(override))).toEqual({read:1,unread:1,total:2})
    for(const summary of [undefined,{read:1,unread:1,total:1},{read:-1,unread:2,total:1}]) expect(teamReceiptCounts(page({summary}))).toBeUndefined()
    expect(mergeTeamReceiptMembers(page().members,[{key:'a',nickname:'新名',read:false}])).toEqual([{key:'a',nickname:'新名',read:false},{key:'b',nickname:'同名',read:false}])
  })
  it('bounds visible-row concurrency, coalesces requests and scopes them to the account',async()=>{
    const release:Array<()=>void>=[]
    call.mockImplementation(()=>new Promise(resolve=>release.push(()=>resolve(page()))))
    const store=new TeamReceiptStore('prod:11')
    const first=store.load(message('1')); expect(store.load(message('1'))).toBe(first)
    const second=store.load(message('2')), third=store.load(message('3'))
    expect(call).toHaveBeenCalledTimes(2)
    release.shift()!();await first;await Promise.resolve();expect(call).toHaveBeenCalledTimes(3)
    release.splice(0).forEach(resolve=>resolve());await Promise.all([second,third])
    expect(call.mock.calls.every(args=>args[1].expectedAccountKey==='prod:11')).toBe(true)
    await store.load(message('1'));expect(call).toHaveBeenCalledTimes(3)
    store.dispose()
  })
  it('refreshes only watched rows and preserves already loaded pages without double-counting',async()=>{
    call.mockImplementation(async(_op,p)=>p.cursor ? page({summary:{read:2,unread:1,total:3},members:[{key:'b',nickname:'同名',read:false},{key:'c',nickname:'丙',read:true}]}) : page({summary:{read:2,unread:1,total:3},hasMore:true,nextCursor:'next'}))
    const store=new TeamReceiptStore('prod:11'),stop=store.watchDetail(message())
    await store.load(message());await store.load(message(),true)
    expect(store.get('m').value?.members).toHaveLength(3)
    store.refreshVisible(true);await store.load(message())
    expect(store.get('m').value?.members).toHaveLength(3)
    expect(teamReceiptCounts(store.get('m').value)).toEqual({read:2,unread:1,total:3})
    stop();const calls=call.mock.calls.length;store.refreshVisible(true);expect(call).toHaveBeenCalledTimes(calls)
    store.dispose()
  })
  it('retains data on transient failure and clears all cached members on permission loss',async()=>{
    call.mockResolvedValue(page());const store=new TeamReceiptStore('prod:11')
    await store.load(message());call.mockRejectedValue(new Error('offline'));await store.load(message(),false,true)
    expect(store.get('m').value?.members).toHaveLength(2);expect(store.get('m').error).toBeTruthy()
    call.mockRejectedValue(Object.assign(new Error('denied'),{body:{code:'team-not_accessible',httpStatus:403}}))
    await store.load(message(),false,true);expect(store.get('m').value).toBeUndefined()
    call.mockResolvedValue(page());await store.load(message(),false,true);expect(store.get('m').value).toBeUndefined()
    store.dispose()
  })
  it('cannot repopulate private members from another in-flight response after access is lost',async()=>{
    let resolveOther!:(value:TeamReceipts)=>void
    call.mockImplementation(async(_op,p)=>p.messageRef==='other' ? new Promise(resolve=>{resolveOther=resolve}) : Promise.reject(Object.assign(new Error('denied'),{body:{httpStatus:403}})))
    const store=new TeamReceiptStore('prod:11'),other=store.load(message('other'))
    await store.load(message());resolveOther(page());await other
    expect(store.get('other').value).toBeUndefined();store.dispose()
  })
})
