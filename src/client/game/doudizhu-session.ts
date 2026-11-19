import type {Action, Authority, State} from './authority.js'
import type {Room} from './contracts.js'
import type {privateView} from './doudizhu.js'
import {cardIds} from './doudizhu-wire.js'
import type {Delivery} from './im.js'
import {PrivateChannel} from './private-channel.js'

type Hand = ReturnType<typeof privateView>
interface Context {
  room:Room; me:string; state:State|undefined; authority:Authority|undefined; now:number
}
interface Hooks {
  current:()=>Context
  send:(type:string,data:unknown,options?:Delivery)=>Promise<void>
  cancel:(key:string)=>void
  changed:()=>void
  acknowledge:(commit:()=>boolean)=>Promise<void>
  observeVersion:(version:number)=>void
  snapshot:()=>Promise<void>
}
interface Subscription {epoch:string; revision:number; seat:string}
interface Receipt {round:string; version:number; epoch:string; proof:string}

export class DoudizhuSession {
  private channel: PrivateChannel|undefined
  private generation = 0
  private hostEpoch = ''
  private requested = ''
  private revision = 0
  private lastHello = -Infinity
  private subscriptions = new Map<string,Subscription>()
  private receipts = new Map<string,Receipt>()
  private delivered = new Map<string,string>()
  private local: {round:string; version:number; view:Hand; proof:string}|undefined
  private incoming: {round:string; version:number; view:Hand; proof:string; revision:number}|undefined
  constructor(private hooks:Hooks) {}
  clear() {
    this.generation++
    this.channel = undefined
    this.local = undefined
    this.incoming = undefined
    this.hostEpoch = ''
    this.lastHello = -Infinity
    this.revision = 0
    for (const id of this.subscriptions.keys()) this.drop(id)
    this.receipts.clear()
    this.delivered.clear()
  }
  async reset() {
    this.clear()
    const gen = this.generation
    const channel = await PrivateChannel.create()
    if (gen !== this.generation) return
    this.channel = channel
    const {authority} = this.hooks.current()
    if (authority) await this.announce()
    else await this.hello()
  }
  private active(member:string) {
    const {room,now}=this.hooks.current()
    return room.members.some(m=>m.membership_id===member && m.status==='active' && m.lease_expires_at>now)
  }
  private drop(member:string) {
    this.channel?.forget(member)
    this.subscriptions.delete(member)
    this.receipts.delete(member)
    this.delivered.delete(member)
    this.hooks.cancel('hand:'+member)
    this.hooks.current().authority?.revokeDeal(member)
  }
  prune() {
    for (const member of this.subscriptions.keys()) if (!this.active(member)) this.drop(member)
  }
  get perspective() {
    const {room,state,me}=this.hooks.current()
    if (state?.players.includes(me)) return me
    return state?.players.includes(this.requested) ? this.requested : room.host_membership_id
  }
  get view():Hand|undefined {
    const {state}=this.hooks.current()
    if (!state?.doudizhu || !this.channel || (this.incoming && this.incoming.version>state.version)) return
    if (this.local?.round === state.round && this.local.version === state.version && this.local.view.member===this.perspective) return this.local.view
  }
  get proof() { return this.view && this.local?.proof || undefined }
  async watch(seat:string) {
    const {state,me}=this.hooks.current()
    if (!state?.doudizhu || state.players.includes(me) || !state.players.includes(seat)) throw Error('无效的观战视角')
    this.requested = seat
    this.revision++
    this.local = undefined
    this.hooks.changed()
    await this.hello()
  }
  private announce() {
    return this.hooks.send('ddz-key', this.channel?.publicKey, {key:'ddz-key'})
  }
  private async hello() {
    if (!this.channel) return
    const {now,state,me}=this.hooks.current()
    this.lastHello = now
    await this.hooks.send('ddz-hello',{key:this.channel.publicKey,known:this.hostEpoch,member:me,seat:this.perspective,
      revision:this.revision, version:state?.version ?? 0},{key:'ddz-hello'})
  }
  async retry() {
    const {state,now,authority}=this.hooks.current()
    if (authority || now-this.lastHello<3500) return
    if (!this.hostEpoch || !state || (state.doudizhu && (!this.view || state.doudizhu.phase==='dealing'))) await this.hello()
  }
  private async distribute(member:string, force=false) {
    const {state,authority,room}=this.hooks.current()
    const sub=this.subscriptions.get(member), channel=this.channel
    if (!state?.doudizhu || !authority || !channel || !sub || !this.active(member)) return
    const perspective = state.players.includes(sub.seat) ? sub.seat : room.host_membership_id
    const view=authority.handFor(member,perspective)
    if (!view) return
    const stamp=JSON.stringify([state.version,sub.epoch,sub.revision,view.member])
    if (!force && this.delivered.get(member)===stamp) return
    this.delivered.set(member,stamp)
    let receipt = this.receipts.get(member)
    if (!receipt || receipt.version!==state.version || receipt.epoch!==sub.epoch || receipt.round!==state.round) {
      receipt={round:state.round,version:state.version,epoch:sub.epoch,proof:crypto.randomUUID()}
      this.receipts.set(member,receipt)
    }
    const context={room:room.room_id,runtime:room.runtime_id,member,round:state.round,version:state.version}
    try {
      const sealed=await channel.seal(member,context,{view,revision:sub.revision,proof:receipt.proof})
      if (channel!==this.channel || this.delivered.get(member)!==stamp || !this.active(member) || this.hooks.current().state?.version!==context.version) return
      await this.hooks.send('ddz-hand',sealed,{key:'hand:'+member,observer:!state.players.includes(member)})
    } catch(e) {
      if (this.delivered.get(member)===stamp) this.delivered.delete(member)
      throw e
    }
  }
  published() {
    const {authority,state,me,now}=this.hooks.current()
    if (!authority || !state?.doudizhu || !this.channel) return false
    const cacheLocalHand = () => {
      if (this.local?.round===state.round && this.local.version===state.version) return
      const view=authority.handFor(me,this.perspective)
      if (view) this.local={round:state.round,version:state.version,view,proof:''}
    }
    cacheLocalHand()
    const started = !!this.local && this.commitDeal(me,state.round,state.version,now)
    if (started) cacheLocalHand()
    for (const id of this.subscriptions.keys()) void this.distribute(id).catch(()=>{})
    return started
  }
  private validReceipt(member:string,round:string,version:number,proof:unknown) {
    const r=this.receipts.get(member)
    return !!r && r.round===round && r.version===version && r.proof===proof
      && this.channel?.isBound(member,r.epoch)===true && this.active(member)
  }
  private commitDeal(member:string,round:string,version:number,now:number) {
    const {state,authority,me}=this.hooks.current()
    if (!authority || state?.doudizhu?.phase!=='dealing' || state.round!==round || state.version!==version) return false
    // A different seat may have expired or started rekeying since its own ACK committed.
    for (const id of state.players) {
      if (id!==me && !this.validReceipt(id,round,version,this.receipts.get(id)?.proof)) authority.revokeDeal(id)
    }
    return authority.acknowledgeDeal(member,round,version,now)
  }
  canAct(member:string,a:Action) {
    const {me}=this.hooks.current()
    return member===me || !['play','bid','pass'].includes(a.kind) || this.validReceipt(member,a.round,a.version,a.proof)
  }
  async hostMessage(member:string,type:string,p:any) {
    const channel=this.channel
    if (!channel || !this.active(member) || !p) return
    if (type==='ddz-received') {
      const {round,version,proof}=p
      if (this.validReceipt(member,round,version,proof)) await this.hooks.acknowledge(()=>{
        if (this.channel!==channel || !this.validReceipt(member,round,version,proof)) return false
        return this.commitDeal(member,round,version,this.hooks.current().now)
      })
      return
    }
    if (type!=='ddz-hello') return
    if (p.known!==channel.publicKey.epoch) { await this.announce(); return }
    if (!Number.isSafeInteger(p.revision) || p.revision<0 || typeof p.seat!=='string' || p.seat.length>160) return
    await channel.bind(member,p.key)
    if (channel!==this.channel || !channel.isBound(member,p.key.epoch) || !this.active(member)) return
    const old=this.subscriptions.get(member)
    if (old?.epoch===p.key.epoch && old!.revision>p.revision) return
    if (old?.epoch!==p.key.epoch) {
      this.hooks.current().authority?.revokeDeal(member)
      this.receipts.delete(member)
      this.hooks.cancel('hand:'+member)
    }
    this.subscriptions.set(member,{epoch:p.key.epoch,revision:p.revision,seat:p.seat})
    if (this.hooks.current().state?.version!==p.version) await this.hooks.snapshot()
    await this.distribute(member,true)
  }
  async guestMessage(type:string,p:any) {
    const channel=this.channel
    if (!channel || !p) return
    const {room,me}=this.hooks.current()
    if (type==='ddz-key') {
      await channel.bind(room.host_membership_id,p)
      if (channel!==this.channel || !channel.isBound(room.host_membership_id,p.epoch) || this.hostEpoch===p.epoch) return
      this.hostEpoch=p.epoch
      this.incoming=undefined
      this.local=undefined
      this.hooks.changed()
      await this.hello()
    }
    if (type!=='ddz-hand' || p.member!==me || p.peerEpoch!==channel.publicKey.epoch
      || !Number.isSafeInteger(p.version) || p.version<(this.hooks.current().state?.version ?? 0)) return
    const context={room:room.room_id,runtime:room.runtime_id,member:me,round:p.round,version:p.version}
    const clear=await channel.open(room.host_membership_id,context,p) as {view:Hand;revision:number;proof:string}
    const {state}=this.hooks.current()
    if (channel!==this.channel || this.hostEpoch!==p.epoch || !channel.isBound(room.host_membership_id,p.epoch)
      || !clear?.view || typeof clear.proof!=='string' || clear.revision!==this.revision
      || p.version<(state?.version ?? 0) || p.version<(this.incoming?.version ?? 0)) return
    this.incoming={round:p.round,version:p.version,view:clear.view,proof:clear.proof,revision:clear.revision}
    this.hooks.observeVersion(p.version)
    await this.consume()
  }
  async consume() {
    const p=this.incoming
    const {state,me}=this.hooks.current()
    if (!p || !state || p.version>state.version) return
    this.incoming=undefined
    const view=p.view
    if (!state.doudizhu || p.version!==state.version || p.round!==state.round
      || p.revision!==this.revision || view.member!==this.perspective || view.version!==state.doudizhu.version
      || view.round!==state.doudizhu.round) return
    const count=state.doudizhu.counts[state.players.indexOf(view.member)]
    if (count===undefined) return
    const hand=cardIds(view.hand,count,count)
    this.local={round:p.round,version:p.version,proof:p.proof,view:{member:view.member,round:view.round,version:view.version,hand}}
    this.hooks.changed()
    if (state.doudizhu.phase==='dealing' && state.players.includes(me)) {
      await this.hooks.send('ddz-received',{round:p.round,version:p.version,proof:p.proof},{key:'ddz-received'})
    }
  }
}
