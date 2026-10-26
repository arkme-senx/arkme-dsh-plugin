import type { ArkmeChatRealtimeNotice, ArkmeTeamPublicationHint } from '../chat-realtime.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type { TeamAppService } from './team-app-service.js'
export type TeamDesktopNotice = NonNullable<Awaited<ReturnType<TeamAppService['resolveMessageNotification']>>>
interface Ports {
  session():Promise<ArkmeSessionCredentials|undefined>
  resolve(hint:ArkmeTeamPublicationHint, session:ArkmeSessionCredentials, signal:AbortSignal):Promise<TeamDesktopNotice|undefined>
  publish(notice:TeamDesktopNotice):void
}
interface Pending { hint:ArkmeTeamPublicationHint; userId:number; signal:AbortSignal; due:number; attempts:number }
/** Independent bounded work lane. No Team failure enters Chat projection/retry state. */
export class TeamMessageNotificationService {
  private readonly pending=new Map<string,Pending>()
  private readonly remembered=new Map<string,number>()
  private readonly running=new Set<string>()
  private timer:ReturnType<typeof setTimeout>|undefined
  private stopped=false
  constructor(private readonly ports:Ports, private readonly now=Date.now) {}
  accept(notice:ArkmeChatRealtimeNotice):void {
    // IM owns the server-clock connection anchor. Comparing its publication
    // timestamp with this device's connection time drops valid fresh messages.
    const h=notice.teamPublication, signal=notice.connectionSignal, userId=notice.connectionUserId
    if(this.stopped||!h||!signal||!userId||signal.aborted||h.publishedAt+300000<=this.now())return
    for(const [key,expiry] of this.remembered)if(expiry<=this.now())this.remembered.delete(key)
    const key=`${userId}:${h.eventUid}`
    if(this.remembered.has(key)||this.pending.has(key)||this.pending.size>=64||this.remembered.size>=2048)return
    this.pending.set(key,{hint:h,userId,signal,due:0,attempts:0});this.pump()
  }
  private pump():void {
    if(this.stopped)return
    if(this.timer){clearTimeout(this.timer);this.timer=undefined}
    let due=Infinity
    for(const [key,p] of this.pending){
      if(this.running.has(key))continue
      if(p.signal.aborted||p.hint.publishedAt+300000<=this.now()){this.pending.delete(key);continue}
      if(this.running.size<4&&p.due<=this.now()){
        this.running.add(key)
        void this.deliver(key,p).finally(()=>{this.running.delete(key);this.pump()})
      }else due=Math.min(due,p.due)
    }
    if(Number.isFinite(due)&&this.running.size<4)this.timer=setTimeout(()=>this.pump(),Math.max(1,due-this.now()))
  }
  private async deliver(key:string,p:Pending):Promise<void>{
    try{
      const session=await this.ports.session()
      if(!session||session.userId!==p.userId||p.signal.aborted||this.stopped){this.pending.delete(key);return}
      const signal=AbortSignal.any([p.signal,AbortSignal.timeout(10000)])
      const n=await this.ports.resolve(p.hint,session,signal)
      const current=await this.ports.session()
      if(!current||current.userId!==session.userId||current.refreshToken!==session.refreshToken||signal.aborted||this.stopped){this.pending.delete(key);return}
      if(n&&n.expiresAtMillis>this.now())this.ports.publish(n)
      this.remembered.set(key,p.hint.publishedAt+300000);this.pending.delete(key)
    }catch{
      p.attempts++;p.due=this.now()+Math.min(30000,1000*2**Math.min(p.attempts-1,5))
    }
  }
  dispose():void{this.stopped=true;if(this.timer)clearTimeout(this.timer);this.pending.clear();this.remembered.clear()}
}
