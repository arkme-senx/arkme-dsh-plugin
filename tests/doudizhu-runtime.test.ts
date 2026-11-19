import {afterEach,expect,it,vi} from 'vitest'
import {Authority, type Action} from '../src/client/game/authority.js'
import type {Room,Reply,Member} from '../src/client/game/contracts.js'
import {encodeState,decodeState} from '../src/client/game/wire-state.js'

const bus=vi.hoisted(()=>({
  clients:[] as {user:string;group:string;receive:(message:any)=>void}[],
  messages:[] as {from:string; packet:any}[],
  allow:(_from:string,_to:string,_packet:any)=>true,
}))
vi.mock('../src/client/game/im.js',()=>({GameIM:class {
  user=''
  constructor(_:number,public group:string,public receive:(message:any)=>void,private status:(online:boolean)=>void){bus.clients.push(this)}
  async login(user:string){this.user=user;this.status(true)}
  async history(){return []}
  async destroy(){bus.clients=bus.clients.filter(c=>c!==this)}
  async send(packet:any){
    bus.messages.push({from:this.user,packet:structuredClone(packet)})
    for (const c of bus.clients) if (c!==this && c.group===this.group && bus.allow(this.user,c.user,packet))
      c.receive({ID:crypto.randomUUID(),from:this.user,to:this.group,type:'TIMCustomElem',payload:{extension:'arkme.game.v1',data:JSON.stringify(packet)}})
  }
}}))
import {GameRuntime} from '../src/client/game/runtime.js'

function member(i:number):Member {
  return {membership_id:'m'+i,user_id:i+1,client_id:1,registration_id:'u'+i,binding_generation:'test',join_seq:i,status:'active',lease_expires_at:Date.now()+100000}
}
const active:GameRuntime[]=[]
afterEach(async()=>{
  bus.allow=()=>true
  for (const g of active.reverse()) await g.leave()
  active.length=0
  bus.clients=[]
  bus.messages=[]
})
async function wait(condition:()=>unknown){await vi.waitFor(()=>expect(condition(),condition.toString()).toBeTruthy(),{timeout:6000,interval:15})}
async function table(){
  const members=Array.from({length:6},(_,i)=>member(i))
  const room:Room={room_id:'room',game_type:'doudizhu',status:'open',runtime_id:'',host_membership_id:'m0',im_group_id:'group',members,membership_version:1}
  for (const m of members) {
    const g=new GameRuntime(async(type,body)=>{
      if (type==='create') room.runtime_id=String(body.runtime_id)
      if (type==='heartbeat' && body.membership_id!==m.membership_id) throw Error('房间或成员身份已失效，请退出后重新进入')
      if (type==='leave') m.status='leaving'
      if (type==='close') room.status='closed'
      return structuredClone({room,membership_id:m.membership_id,server_time:Date.now(),invite_token:'token',
        credentials:{user_id:m.registration_id,user_sig:'fake',sdk_app_id:1,expires_at:Date.now()+1000000}} satisfies Reply)
    },()=>{},()=>{})
    active.push(g)
    await g.enter(m===members[0]?{kind:'create'}:{kind:'join',roomId:room.room_id,token:'token'},'doudizhu')
  }
  await wait(()=>active.every(g=>g.state))
  for (const g of active.slice(1,3)) {
    await g.act('ready')
    await wait(()=>active.every(c=>c.state!.ready.includes(g.me)))
  }
  return {games:active,host:active[0]!,room}
}
it('waits for decrypted player receipts, isolates six projections, recovers lost hands and rekeys an expired seat', async()=>{
  const {host,games,room}=await table()
  let pendingReceipt:any
  bus.allow=(from,to,p)=>{
    if(from==='u2' && to==='u0' && p.type==='ddz-received'){pendingReceipt=p;return false}
    return true
  }
  await host.act('start')
  await wait(()=>pendingReceipt && games.every(g=>g.doudizhuView))
  const dealing=host.state!.doudizhu!
  expect(dealing.phase).toBe('dealing')
  expect(dealing.bottom).toBeNull()
  expect(dealing.remaining).toBeNull()
  expect(new Set(games.slice(0,3).flatMap(c=>c.doudizhuView!.hand)).size).toBe(51)
  expect(games.slice(3).every(c=>c.doudizhuView!.member===host.me)).toBe(true)
  const secrets=games.slice(0,3).map(c=>JSON.stringify(c.doudizhuView!.hand))
  expect(bus.messages.every(({packet})=>secrets.every(hand=>!JSON.stringify(packet).includes(hand)))).toBe(true)
  expect(bus.messages.every(({packet})=>new TextEncoder().encode(JSON.stringify(packet)).length<=4096)).toBe(true)
  // A receipt belongs to its authenticated recipient, including when a duplicate arrives from a spectator.
  const message=(from:string,packet:any)=>({from,to:room.im_group_id,type:'TIMCustomElem',payload:{extension:'arkme.game.v1',data:JSON.stringify(packet)}})
  const receive=bus.clients[0]!.receive
  const hello=bus.messages.filter(m=>m.from==='u4' && m.packet.type==='ddz-hello').at(-1)!.packet
  receive(message('u4',{...hello,payload:{...hello.payload,member:'m1'}}))
  const key=bus.messages.find(m=>m.from==='u0' && m.packet.type==='ddz-key')!.packet
  const guestClient=bus.clients.find(c=>c.user==='u1')!
  const before=bus.messages.filter(m=>m.from==='u1' && m.packet.type==='ddz-hello').length
  guestClient.receive(message('u4',{...key,payload:hello.payload.key}))
  await new Promise(r=>setTimeout(r,30))
  expect(bus.messages.filter(m=>m.from==='u1' && m.packet.type==='ddz-hello')).toHaveLength(before)
  expect(games[1]!.doudizhuView?.hand).toEqual(JSON.parse(secrets[1]!))
  receive(message('u4',pendingReceipt))
  await new Promise(r=>setTimeout(r,30))
  expect(host.state!.doudizhu!.phase).toBe('dealing')
  bus.allow=()=>true
  receive(message('u2',pendingReceipt))
  await wait(()=>games.every(g=>g.state!.doudizhu?.phase==='bidding' && g.doudizhuView))
  const guest=games[1]!, observer=games[4]!
  await expect(guest.watch(host.me)).rejects.toThrow('视角')
  await observer.watch(guest.me)
  await wait(()=>observer.doudizhuView?.member===guest.me)
  expect(observer.doudizhuView!.hand).toEqual(guest.doudizhuView!.hand)
  await expect(observer.act('pass')).rejects.toThrow('观察者')
  const bidder=games[host.state!.doudizhu!.turn!]!
  // Drop just the player's first updated private packet while the matching public snapshot arrives.
  let lost=false
  bus.allow=(_,to,p)=>{
    if(!lost && to==='u1' && p.type==='ddz-hand' && p.payload.member===guest.me){lost=true;return false}
    return true
  }
  await bidder.act('bid',3)
  await wait(()=>lost && guest.state!.doudizhu?.phase==='playing')
  expect(guest.doudizhuView).toBeUndefined()
  await expect(guest.act('play',[0])).rejects.toThrow('同步')
  await wait(()=>games.every(c=>c.doudizhuView))
  expect(bidder.doudizhuView!.hand).toHaveLength(20)
  // Deliver the next private hand first, then the authentic public snapshot.
  let delayed:any, earlyHand=false
  bus.allow=(from,to,p)=>{
    if (from!=='u0' || to!=='u1') return true
    if (p.type==='snapshot') {delayed=p;return false}
    if (p.type==='ddz-hand' && p.payload.member===guest.me) earlyHand=true
    return true
  }
  await bidder.act('play',[bidder.doudizhuView!.hand[0]])
  await wait(()=>delayed && earlyHand)
  guestClient.receive(message('u0',delayed))
  bus.allow=()=>true
  await wait(()=>guest.doudizhuView && guest.state!.version===host.state!.version)
  const initial=guest.doudizhuView!.hand
  const epoch=()=>bus.messages.filter(m=>m.from==='u1' && m.packet.type==='ddz-hello').at(-1)!.packet.payload.key.epoch
  const oldEpoch=epoch()
  await guest.reconnect()
  await wait(()=>guest.doudizhuView&&!guest.paused)
  expect(epoch()).not.toBe(oldEpoch)
  expect(guest.doudizhuView!.hand).toEqual(initial)
  const nextEpoch=epoch()
  room.members[1]!.membership_id='readmitted'
  room.membership_version++
  await guest.reconnect()
  await wait(()=>guest.me==='readmitted' && guest.doudizhuView?.member==='readmitted' && !guest.paused)
  expect(host.state!.players[1]).toBe('readmitted')
  expect(epoch()).not.toBe(nextEpoch)
  expect(guest.doudizhuView!.hand).toEqual(initial)
  await games[2]!.leave()
  await wait(()=>host.state!.doudizhu?.reason==='withdraw')
  expect(host.state!.doudizhu!.winners).toEqual([])
  expect(host.state!.doudizhu!.remaining).toHaveLength(3)
  await host.act('next')
  expect(host.state!.doudizhu).toBeUndefined()
  expect(host.state!.players).toEqual(['m0','readmitted','m3'])
  expect(host.state!.ready).toEqual(['m0'])
},20000)

it('cancels an unacknowledged deal at its deadline, rotates the opener, and handles admission by device',()=>{
  const a=new Authority('m0','doudizhu'), members=Array.from({length:5},(_,i)=>member(i))
  let now=Date.now()
  const act=(who:string,kind:Action['kind'],value?:unknown)=>a.apply(who,{id:crypto.randomUUID(),version:a.state.version,round:a.state.round,kind,value},members,now)
  a.sync(members,now)
  const start=()=>{for(const id of ['m1','m2'])expect(act(id,'ready')).toBe('');expect(act('m0','start')).toBe('')}
  start()
  const opener=a.state.doudizhu!.starter
  expect(a.acknowledgeDeal('m0',a.state.round,a.state.version,now)).toBe(false)
  now+=30000
  expect(a.acknowledgeDeal('m1',a.state.round,a.state.version,now)).toBe(false)
  expect(a.tick(now)).toBe(true)
  expect(a.state.doudizhu).toBeUndefined()
  expect(a.state.ready).toEqual(['m0'])
  start()
  expect(a.state.doudizhu!.starter).toBe((opener+1)%3)
  const injected={...a.state,hands:[[51]],doudizhu:{...a.state.doudizhu,deck:[52],hands:[[51]],recent:[{type:'pass',hidden:[0]},null,null]}}
  const wire=encodeState(injected as any), decoded=decodeState(wire,'doudizhu')
  expect(JSON.stringify(decoded)).not.toMatch(/deck|hands|hidden/)
  expect(()=>decodeState({...wire,doudizhu:{...a.state.doudizhu,bottom:[1,2,3]}},'doudizhu')).toThrow()
  const seatHand=a.handFor('m1')!.hand
  members[1]!.lease_expires_at=now-1
  members.push({...member(6),user_id:members[1]!.user_id,client_id:2})
  a.sync(members,now)
  expect(a.state.players).toContain('m1')
  members.push({...member(7),user_id:members[1]!.user_id,client_id:1})
  a.sync(members,now)
  expect(a.state.players).toContain('m7')
  expect(a.handFor('m7')!.hand).toEqual(seatHand)
})

function deliver(room:Room,from:string,to:string,packet:any) {
  bus.clients.find(c=>c.user===to)!.receive({from,to:room.im_group_id,type:'TIMCustomElem',
    payload:{extension:'arkme.game.v1',data:JSON.stringify(packet)}})
}

it.each(['rekey','bind boundary','expiry'])('rechecks a queued deal acknowledgement after %s',async(change)=>{
  const {host,games,room}=await table()
  const guest=games[2]!
  const receipts:any[]=[]
  bus.allow=(from,to,p)=>{
    if (from==='u2' && to==='u0' && p.type==='ddz-received') {receipts.push(p);return false}
    return true
  }
  await host.act('start')
  await wait(()=>receipts.length && games[1]!.doudizhuView)
  await (host as any).actionQueue
  const receipt=receipts[0]
  let release!:()=>void
  const barrier=new Promise<void>(resolve=>{release=resolve})
  void (host as any).enqueue(()=>barrier)
  deliver(room,'u2','u0',receipt)
  const drained=(host as any).actionQueue
  const row=host.room!.members.find(m=>m.membership_id===guest.me)!
  let finishBind: (()=>void)|undefined
  try {
    if (change==='expiry') {
      row.lease_expires_at=host.now-1
    } else {
      let bound=false
      if (change==='bind boundary') {
        const channel=(host as any).cards.channel
        const bind=channel.bind.bind(channel)
        const resume=new Promise<void>(resolve=>{finishBind=resolve})
        vi.spyOn(channel,'bind').mockImplementation(async(...args)=>{
          await bind(...args)
          if (args[0]===guest.me) {bound=true;await resume}
        })
      }
      await guest.reconnect()
      await wait(()=>change==='bind boundary'?bound:receipts.some(p=>p.payload.proof!==receipt.payload.proof))
    }
    release()
    await drained
    expect(host.state!.doudizhu!.phase).toBe('dealing')
  } finally {release();finishBind?.()}
  if (change==='expiry') row.lease_expires_at=host.now+100000
  else await wait(()=>receipts.some(p=>p.payload.proof!==receipt.payload.proof))
  deliver(room,'u2','u0',receipts.at(-1))
  await wait(()=>host.state!.doudizhu!.phase==='bidding')
},15000)

it('pauses on an authenticated newer hand until its public snapshot arrives',async()=>{
  const {host,games,room}=await table()
  await host.act('start')
  await wait(()=>games.every(g=>g.state?.doudizhu?.phase==='bidding' && g.doudizhuView))
  const guest=games[1]!, prior=guest.state!.version
  let snapshot:any,hand:any
  bus.allow=(from,to,p)=>{
    if (from!=='u0' || to!=='u1') return true
    if (p.type==='snapshot') {snapshot=p;return false}
    if (p.type==='digest') return false
    if (p.type==='ddz-hand' && p.payload.member===guest.me) {hand=p;return false}
    return true
  }
  await games[host.state!.doudizhu!.turn!]!.act('bid',3)
  await wait(()=>snapshot && hand)
  // Delimit authentication before asserting the stale view is still usable.
  const session=(guest as any).cards
  await expect(session.guestMessage('ddz-hand',{...hand.payload,version:hand.payload.version+1})).rejects.toThrow()
  expect(guest.doudizhuView).toBeDefined()
  expect(guest.paused).toBe(false)
  const syncs=()=>bus.messages.filter(m=>m.from==='u1' && m.packet.type==='sync').length
  ;(guest as any).lastSync=0
  const before=syncs()
  deliver(room,'u0','u1',hand)
  await wait(()=>guest.paused && syncs()>before)
  expect(guest.state!.version).toBe(prior)
  expect(guest.doudizhuView).toBeUndefined()
  const actions=()=>bus.messages.filter(m=>m.from==='u1' && m.packet.type==='action').length
  const sent=actions()
  await expect(guest.act('play',[0])).rejects.toThrow('同步')
  expect(actions()).toBe(sent)
  deliver(room,'u0','u1',snapshot)
  await wait(()=>!guest.paused && guest.doudizhuView)
  expect(guest.doudizhuView).toEqual((host as any).authority.handFor(guest.me))
},15000)

function biddingTable() {
  const authority=new Authority('m0','doudizhu'),members=Array.from({length:3},(_,i)=>member(i))
  const now=Date.now()
  authority.sync(members,now)
  const action=(kind:Action['kind'],value?:unknown)=>({id:crypto.randomUUID(),round:authority.state.round,version:authority.state.version,kind,value})
  for (const id of ['m1','m2']) expect(authority.apply(id,action('ready'),members,now)).toBe('')
  expect(authority.apply('m0',action('start'),members,now)).toBe('')
  for (const m of members) authority.acknowledgeDeal(m.membership_id,authority.state.round,authority.state.version,now)
  const skip=()=>authority.apply(authority.state.players[authority.state.doudizhu!.turn!]!,action('bid',0),members,now)
  expect(skip()).toBe('')
  expect(skip()).toBe('')
  return {authority,members,now,skip,withdraw:{...action('withdraw'),member:'m1'}}
}

it.each(['last bid','expired timer'])('applies the same seat withdrawal across a redeal caused by %s',cause=>{
  const {authority,members,now,skip,withdraw}=biddingTable()
  if (cause==='last bid') expect(skip()).toBe('')
  // apply() processes the expired turn before it handles the withdrawal.
  const appliedAt=cause==='expired timer'?authority.state.doudizhu!.deadline!:now
  expect(authority.apply('m1',withdraw,members,appliedAt)).toBe('')
  expect(authority.state.round).not.toBe(withdraw.round)
  expect(authority.state.doudizhu).toMatchObject({phase:'ended',reason:'withdraw',winners:[]})
})

it('isolates a readmitted seat from a withdrawal issued under its previous membership',()=>{
  const {authority,members,now,skip,withdraw}=biddingTable()
  expect(skip()).toBe('')
  members[1]={...members[1]!,membership_id:'renewed'}
  authority.sync(members,now)
  expect(authority.state.players).toContain('renewed')
  expect(authority.apply('renewed',withdraw,members,now)).not.toBe('')
  expect(authority.apply('renewed',{...withdraw,id:crypto.randomUUID(),round:authority.state.round},members,now)).not.toBe('')
  expect(authority.state.doudizhu!.phase).toBe('dealing')
  expect(authority.apply('renewed',{...withdraw,id:crypto.randomUUID(),round:authority.state.round,member:'renewed'},members,now)).toBe('')
})

it('retains admission when the host rejects a withdrawal',async()=>{
  const {host,games,room}=await table()
  await host.act('start')
  await wait(()=>games.every(g=>g.state?.doudizhu?.phase==='bidding'))
  const guest=games[1]!
  const authority=(host as any).authority as Authority
  vi.spyOn(authority,'apply').mockReturnValueOnce('席位已更新')
  await expect(guest.leave()).rejects.toThrow('席位已更新')
  expect(guest.closed).toBe(false)
  expect(room.members[1]!.status).toBe('active')
  await guest.leave()
  expect(host.state!.doudizhu!.reason).toBe('withdraw')
},15000)

it('bounds the withdrawal wait even when the SDK send remains pending',async()=>{
  const {host,games,room}=await table()
  await host.act('start')
  await wait(()=>games.every(g=>g.state?.doudizhu?.phase==='bidding'))
  const guest=games[1]!
  vi.spyOn((guest as any).im,'send').mockImplementationOnce(()=>new Promise(()=>{}))
  vi.useFakeTimers()
  try {
    const leaving=guest.leave()
    await vi.advanceTimersByTimeAsync(3500)
    expect(guest.closed).toBe(true)
    await leaving
    expect(room.members[1]!.status).toBe('leaving')
    expect(host.state!.doudizhu!.phase).toBe('bidding')
  } finally {vi.useRealTimers()}
},15000)

it('keeps a delayed withdrawal from an ended table out of the next table',()=>{
  const {authority,members,now,withdraw}=biddingTable()
  expect(authority.apply('m1',{...withdraw,id:crypto.randomUUID()},members,now)).toBe('')
  const act=(sender:string,kind:Action['kind'])=>authority.apply(sender,
    {id:crypto.randomUUID(),round:authority.state.round,version:authority.state.version,kind},members,now)
  expect(act('m0','next')).toBe('')
  expect(act('m1','ready')).toBe('')
  expect(act('m2','ready')).toBe('')
  expect(act('m0','start')).toBe('')
  expect(authority.apply('m1',withdraw,members,now)).not.toBe('')
  expect(authority.state.doudizhu!.phase).toBe('dealing')
})

it('retains the readmitted seat and its authorization when an older roster arrives late',async()=>{
  const {host,games,room}=await table()
  await host.act('start')
  await wait(()=>games.every(g=>g.state?.doudizhu?.phase==='bidding' && g.doudizhuView))
  const guest=games[1]!, hand=guest.doudizhuView!.hand
  const impl=host as any
  const previous=structuredClone(host.room!)
  const timestamp=host.now
  let resume!:(r:Reply)=>void
  vi.spyOn(impl,'api').mockImplementationOnce(()=>new Promise<Reply>(resolve=>{resume=resolve}))
  const old=impl.refresh()
  room.members[1]!.membership_id='new-membership'
  room.members[0]!.lease_expires_at+=10000
  room.membership_version++
  await guest.reconnect()
  await wait(()=>guest.me==='new-membership' && guest.doudizhuView?.member===guest.me)
  const currentLease=impl.leaseUntil
  const currentOffset=impl.offset
  const proof=(guest as any).cards.proof
  resume({room:previous,membership_id:host.me,server_time:timestamp})
  await old
  expect(host.room!.membership_version).toBe(room.membership_version)
  expect(host.state!.players[1]).toBe(guest.me)
  expect(impl.leaseUntil).toBe(currentLease)
  expect(impl.offset).toBe(currentOffset)
  expect(guest.doudizhuView!.hand).toEqual(hand)
  expect(impl.cards.canAct(guest.me,{kind:'bid',round:host.state!.round,version:host.state!.version,proof})).toBe(true)

  const olderSameVersion=structuredClone(room)
  olderSameVersion.members[0]!.lease_expires_at-=5000
  vi.spyOn(impl,'api').mockResolvedValueOnce({room:olderSameVersion,membership_id:host.me,server_time:timestamp-100})
  await impl.refresh()
  expect(impl.leaseUntil).toBe(currentLease)
  expect(impl.offset).toBe(currentOffset)

  // Two samples from the same server millisecond must preserve their request order.
  const sameTime=impl.acceptedTime
  const updated=structuredClone(room)
  updated.members[0]!.lease_expires_at+=1000
  vi.spyOn(impl,'api').mockImplementationOnce(()=>new Promise<Reply>(resolve=>{resume=resolve}))
    .mockResolvedValueOnce({room:updated,membership_id:host.me,server_time:sameTime})
  const earlier=impl.refresh()
  await impl.refresh()
  resume({room:olderSameVersion,membership_id:host.me,server_time:sameTime})
  await earlier
  expect(impl.leaseUntil).toBe(updated.members[0]!.lease_expires_at)
},15000)
