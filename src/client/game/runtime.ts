import {DoudizhuSession} from './doudizhu-session.js'
import {isGameType, type GameType} from './game-types.js'
import {encodeState,decodeState} from './wire-state.js'
import { Authority, type State, type Action } from './authority.js'
import { GameIM, type Delivery, type WireMessage } from './im.js'
import type { Room, Reply, Request } from './contracts.js'
import type { GameCommand } from './command.js'
export class GameRuntime {
  room?: Room
  me = ''
  token = ''
  state?: State
  status = '选择游戏'
  error = ''
  animationEpoch = 0
  online = false
  closed = false
  reconnecting = false
  connectionError = false
  initializationFailed = false
  messages: WireMessage[] = []
  private offset = 0
  get now() {
    return Date.now() + this.offset
  }
  private im?: GameIM
  private authority?: Authority
  private registration = ''
  private runtime = crypto.randomUUID()
  private requestId = crypto.randomUUID()
  private readmitting = false
  private command?: GameCommand
  private selectedGame: GameType = 'chinese_checkers'
  private cards: DoudizhuSession | undefined
  private latestHostVersion = 0
  private needSnapshot = false
  private async resetCards() {
    if (this.gameType !== 'doudizhu' || !this.room) return
    this.needSnapshot = !this.host
    this.cards ??= new DoudizhuSession({
      current:()=>({room:this.room!,me:this.me,state:this.state,authority:this.authority,now:this.now}),
      send:(type,data,options)=>this.send(type,data,options),
      cancel:key=>this.im?.cancel?.(key),
      changed:this.changed,
      acknowledge:commit=>this.enqueue(async()=>{
        if (!this.paused && commit()) await this.snapshot()
      }),
      observeVersion:version=>this.observeHostVersion(version),
      snapshot:()=>this.snapshot(),
    })
    await this.cards.reset()
  }
  get doudizhuView() { return this.cards?.view }
  get doudizhuPerspective() { return this.cards?.perspective ?? this.me }
  watch(member:string) {
    if (!this.cards) return Promise.reject(Error('当前没有可观战的牌局'))
    return this.cards.watch(member)
  }
  private actionQueue: Promise<void> = Promise.resolve()
  get gameType(): GameType { return isGameType(this.room?.game_type) ? this.room.game_type : this.selectedGame }
  private timer?: ReturnType<typeof setInterval>
  private disposed = false
  private busy = false
  private lastBeat = 0
  private lastHost = 0
  private lastDigest = 0
  private lastSync = 0
  private lastText = 0
  private lastSnapshot = 0
  private leaseUntil = 0
  private credentialExpires = 0
  private pending: { action: Action; sent: number; attempts: number } | undefined
  private messageIds = new Set<string>()
  constructor(
    private api: Request,
    readonly changed: () => void,
    private selected: (id: string) => void,
  ) {}
  get awaitingAction() { return this.pending !== undefined }
  get host() {
    return this.room?.host_membership_id === this.me
  }
  get paused() {
    return this.needSnapshot || (!this.host && (this.state?.version ?? 0)<this.latestHostVersion) || this.closed || this.reconnecting || this.connectionError || !this.online || !this.state || this.now > this.leaseUntil || (!this.host && this.now - this.lastHost > 15000)
  }
  private body() {
    return { room_id: this.room?.room_id, membership_id: this.me, runtime_id: this.host ? this.runtime : undefined }
  }
  private requestOrder = 0
  private acceptedOrder = 0
  private acceptedTime = 0
  private accept(r: Reply, order=++this.requestOrder) {
    if (this.room?.room_id===r.room.room_id) {
      if (r.room.membership_version<this.room.membership_version) return false
      if (r.room.membership_version===this.room.membership_version && (r.server_time<this.acceptedTime
        || (r.server_time===this.acceptedTime && order<this.acceptedOrder))) return false
    }
    this.acceptedTime=r.server_time
    this.acceptedOrder=order
    this.offset = r.server_time - Date.now()
    this.room = r.room
    this.me = r.membership_id
    this.leaseUntil = r.room.members.find((m) => m.membership_id === this.me)?.lease_expires_at ?? 0
    if (r.invite_token) this.token = r.invite_token
    return true
  }
  async enter(command: GameCommand, gameType: GameType = this.selectedGame) {
    if (this.busy || this.disposed) return
    this.selectedGame = gameType
    this.command = command
    this.busy = true
    this.error = ''
    this.status = '正在进入房间…'
    this.changed()
    try {
      if (!this.im || !this.online) {
        const prepared = await this.api('prepare', {})
        const c = prepared.credentials
        if (!c) throw new Error('游戏凭证不可用')
        this.registration = c.user_id
        this.credentialExpires = c.expires_at
        this.status = '正在连接游戏聊天…'
        this.changed()
        await this.im?.destroy()
        this.im = new GameIM(
          c.sdk_app_id,
          this.room?.im_group_id ?? '',
          (m) => this.receive(m),
          (ready, kicked) => {
            if (this.disposed) return
            if (!ready) { this.animationEpoch++; this.cards?.clear() }
            this.online = ready
            this.connectionError = !ready
            if (kicked) {
              this.error = '游戏登录已断开，请点击立即重连'
            } else if (ready) {
              void this.recover()
            }
            this.changed()
          },
        )
        await this.im.login(c.user_id, c.user_sig)
        if (this.disposed) {
          await this.im.destroy()
          return
        }
      }
      await this.api('ready', { registration_id: this.registration })
      if (this.disposed) return
      const reply = await this.api(
        command.kind === 'create' ? 'create' : 'join',
        command.kind === 'create'
          ? { request_id: this.requestId, runtime_id: this.runtime, game_type: this.selectedGame }
          : { request_id: this.requestId, room_id: command.roomId, invite_token: command.token },
      )
      this.accept(reply)
      if (!isGameType(reply.room.game_type)) {
        await this.api('leave', this.body()).catch(() => {})
        await this.finish('当前版本不支持此游戏，请更新插件')
        return
      }
      if (this.disposed) {
        await this.api('leave', this.body()).catch(() => {})
        return
      }
      this.selected(reply.room.room_id)
      // Retry admission until the server's durable Tencent worker completes it.
      if (!this.room?.members.some((m) => m.membership_id === this.me && m.status === 'active'))
        throw new Error('腾讯群正在准备，请稍后重试')
      this.im!.group = this.room.im_group_id
      this.initializationFailed = false
      clearInterval(this.timer)
      this.lastBeat = 0
      this.timer = setInterval(() => void this.tick(), 1000)
      if (this.host) {
        if (!this.authority) {
          this.authority = new Authority(this.me, this.gameType)
          this.authority.sync(this.room.members, this.now)
          this.state = this.authority.state
        }
        this.accept(await this.api('activate', this.body()))
        if (!this.token) {
          const r = await this.api('invite/rotate', this.body())
          this.token = r.invite_token ?? ''
        }
        await this.resetCards()
        await this.snapshot()
      } else {
        await this.resetCards()
        this.status = '正在同步棋盘…'
        await this.sync()
      }
      await this.history()
      this.status = ''
      this.lastBeat = this.now
      clearInterval(this.timer)
      this.timer = setInterval(() => void this.tick(), 1000)
    } catch (e) {
      this.initializationFailed = true
      this.error = e instanceof Error ? e.message : '游戏连接失败'
      this.status = '连接未完成'
    } finally {
      this.busy = false
      this.changed()
    }
  }
  async retry() {
    if (this.command) await this.enter(this.command)
  }
  async reconnect() {
    if (this.busy || this.reconnecting || this.disposed || !this.room) return
    this.reconnecting = true
    if (this.cards) { this.cards.clear(); this.needSnapshot=!this.host }
    this.busy = true
    this.error = ''
    this.animationEpoch++
    this.changed()
    try {
      try { await this.refresh(false) }
      catch (e) {
        if (!(e instanceof Error) || e.message !== '房间或成员身份已失效，请退出后重新进入' || this.host || this.command?.kind !== 'join') throw e
        await this.readmit()
      }
      if (this.disposed) return
      const r = await this.api('credentials', this.body())
      if (this.disposed) return
      const c = r.credentials
      if (!c || c.user_id !== this.registration || !this.im) throw new Error('游戏凭证不可用')
      await this.im.login(c.user_id, c.user_sig)
      if (this.disposed) return
      this.credentialExpires = c.expires_at
      this.online = true
      this.pending = undefined
      await this.resetCards()
      if (this.host) await this.snapshot()
      else { this.lastSync = 0; this.lastHost = 0; await this.sync() }
      await this.history()
      this.error = ''
      this.connectionError = false
    } catch (e) {
      const message = e instanceof Error ? e.message : '重连失败，请重试'
      if (['房间已结束', '设备 IM 登记已失效，请重新进入'].includes(message) || (this.host && message === '房间或成员身份已失效，请退出后重新进入'))
        await this.finish(message)
      else { this.error = message; this.connectionError = true }
    } finally {
      this.busy = false
      this.reconnecting = false
      this.changed()
    }
  }
  private async readmit() {
    if (this.command?.kind !== 'join' || this.host) throw new Error('无法恢复原房间')
    if (!this.readmitting) { this.requestId = crypto.randomUUID(); this.readmitting = true }
    const r = await this.api('join', {room_id: this.command.roomId, invite_token: this.command.token, request_id: this.requestId})
    if (this.disposed) {
      await this.api('leave', {room_id:r.room.room_id, membership_id:r.membership_id}).catch(() => {})
      return
    }
    this.accept(r)
    if (!r.room.members.some(m=>m.membership_id===this.me && m.status==='active')) throw new Error('腾讯群正在准备，请稍后重试')
    this.readmitting = false
    this.pending = undefined
    this.lastHost = 0
    this.lastSync = 0
    this.lastBeat = this.now
    this.im!.group = r.room.im_group_id
    clearInterval(this.timer)
    this.timer = setInterval(() => void this.tick(), 1000)
  }
  private async finish(message: string) {
    this.cards?.clear()
    this.disposed = true
    this.closed = true
    this.online = false
    this.initializationFailed = false
    this.pending = undefined
    clearInterval(this.timer)
    this.error = message
    this.status = message
    this.changed()
    await this.im?.destroy().catch(() => {})
  }
  private envelope(type: string, payload: unknown) {
    return { protocol_version: 1, room_id: this.room!.room_id, runtime_id: this.room!.runtime_id, type, payload }
  }
  private async send(type: string, payload: unknown, options?:Delivery) {
    if (this.im && !this.disposed) await this.im.send(this.envelope(type, payload),options)
  }
  private async snapshot() {
    if (!this.authority) return
    this.state = this.authority.state
    this.cards?.published()
    this.lastSnapshot = this.now
    await this.send('snapshot', encodeState(this.state),this.cards ? {key:'snapshot'} : undefined)
    this.changed()
  }
  private observeHostVersion(version:number) {
    this.latestHostVersion=Math.max(this.latestHostVersion,version)
    if (version>(this.state?.version ?? 0)) {
      this.changed()
      void this.sync().catch(()=>{})
    }
  }
  private async sync() {
    if (this.now - this.lastSync < 2000) return
    this.lastSync = this.now
    this.animationEpoch++
    await this.send('sync', {})
  }
  private async recover() {
    if (!this.room || this.busy || this.disposed) return
    try {
      await this.refresh()
      if (this.disposed) return
      await this.resetCards()
      if (this.host) await this.snapshot()
      else { this.lastSync = 0; await this.sync() }
      await this.history()
      this.error = ''
      this.connectionError = false
      this.changed()
    } catch {
      this.error = '连接恢复中，请稍候'
      this.connectionError = true
      this.changed()
    }
  }
  private async history() {
    if (!this.im) return
    try {
      for (const m of await this.im.history()) this.addText(m)
    } catch {
      /* history is optional; live channel continues */
    }
  }
  private addText(m: WireMessage) {
    if (m.type !== 'TIMTextElem' || typeof m.payload.text !== 'string' || this.messageIds.has(m.ID)) return
    this.messageIds.add(m.ID)
    this.messages = [...this.messages, m].slice(-200)
    if (this.messageIds.size > 1000) this.messageIds.delete(this.messageIds.values().next().value!)
    this.changed()
  }
  private admissionRefresh:Promise<void>|undefined
  private lastAdmissionRefresh = -Infinity
  private receive(m: WireMessage, retryAdmission=true) {
    if (this.disposed || !this.room || m.to !== this.room.im_group_id) return
    if (m.type === 'TIMTextElem') {
      this.addText(m)
      return
    }
    if (
      m.payload.extension !== 'arkme.game.v1' ||
      typeof m.payload.data !== 'string' ||
      new TextEncoder().encode(m.payload.data).length > 4096
    )
      return
    let packet: any
    try {
      packet = JSON.parse(m.payload.data)
    } catch {
      return
    }
    if (
      !packet || packet.protocol_version !== 1 ||
      packet.room_id !== this.room.room_id ||
      packet.runtime_id !== this.room.runtime_id
    )
      return
    const sender = this.room.members.find(
      (x) => x.registration_id === m.from && x.status === 'active' && x.lease_expires_at > this.now,
    )
    // A claimed membership is only a hint to refresh. Bind solely to the server row for the actual IM sender.
    if (!sender || (packet.type==='ddz-hello' && packet.payload?.member!==sender.membership_id)) {
      if (retryAdmission && this.host && this.cards && ['sync','ddz-hello'].includes(packet.type)) {
        if (!this.admissionRefresh && this.now-this.lastAdmissionRefresh>2000) {
          this.lastAdmissionRefresh=this.now
          this.admissionRefresh=this.refresh().finally(()=>{this.admissionRefresh=undefined})
        }
        void this.admissionRefresh?.then(()=>this.receive(m,false)).catch(()=>{})
      }
      return
    }
    if (sender.membership_id === this.room.host_membership_id) {
      this.lastHost = this.now
      if (!this.host && this.cards && typeof packet.type==='string' && packet.type.startsWith('ddz-')) void this.cards.guestMessage(packet.type,packet.payload).catch(()=>{})
      if (packet.type === 'snapshot' && !this.host) {
        const s = packet.payload
        if (
          !s ||
          !Number.isSafeInteger(s.version) ||
          s.version < (this.state?.version ?? 0) ||
          !Array.isArray(s.players) ||
          !Array.isArray(s.ready) ||
          !Number.isInteger(s.count)
        )
          return
        try { this.state = decodeState(s, this.gameType) } catch { return }
        this.needSnapshot = false
        this.status = ''
        void this.cards?.consume().catch(()=>{})
      }
      if (packet.type === 'digest' && !this.host && Number.isSafeInteger(packet.payload?.version)) {
        this.observeHostVersion(packet.payload.version)
      }
      if (packet.type==='ack' && this.leaveAck && packet.payload?.id===this.leaveAck.id && packet.payload?.member===this.me) this.leaveAck.done(packet.payload.error)
      if (
        packet.type === 'ack' &&
        packet.payload?.id === this.pending?.action.id &&
        packet.payload?.member === this.me
      ) {
        this.error = packet.payload.error ?? ''
        this.pending = undefined
      }
    }
    if (this.host && this.online && this.now < this.leaseUntil) {
      if (this.cards && sender.membership_id!==this.me && typeof packet.type==='string' && packet.type.startsWith('ddz-'))
        void this.cards.hostMessage(sender.membership_id,packet.type,packet.payload).catch(()=>{})
      if (packet.type === 'sync' && this.now - this.lastSnapshot > 500) void this.snapshot().catch(() => {})
      if (packet.type === 'action') void this.handleAction(sender.membership_id, packet.payload).catch(() => { this.error = '操作确认发送失败，等待重试'; this.changed() })
    }
    this.changed()
  }
  private handleAction(sender: string, action: Action): Promise<void> {
    return this.enqueue(()=>this.processAction(sender,action))
  }
  private enqueue(task:()=>Promise<void>):Promise<void> {
    const next = this.actionQueue.catch(() => {}).then(task)
    this.actionQueue = next
    return next
  }
  private async processAction(sender: string, action: Action) {
    if (!this.authority || !this.room || !action || this.paused) return
    const error = this.authority.apply(sender,action,this.room.members,this.now,this.cards?.canAct(sender,action) ?? true)
    this.state = this.authority.state
    await this.send('ack', { id: action.id, member: sender, error })
    await this.snapshot()
    if (sender === this.me) {
      this.error = error
      this.pending = undefined
    }
    this.changed()
  }
  async act(kind: Action['kind'], value?: unknown) {
    if (this.paused || !this.state || this.pending) throw new Error('正在同步或等待操作确认')
    if (this.state.doudizhu && !this.state.players.includes(this.me) && ['bid','play','pass','withdraw'].includes(kind)) throw Error('观察者不能操作牌局')
    if (this.state.doudizhu && ['bid','play','pass'].includes(kind) && (!this.doudizhuView || this.state.version<this.latestHostVersion)) {
      await this.sync()
      throw Error('正在同步最新手牌')
    }
    if (kind === 'start' || (kind === 'next' && this.cards)) {
      await this.refresh()
      if (this.authority?.sync(this.room!.members, this.now)) await this.snapshot()
    }
    const action: Action = {
      id: crypto.randomUUID(),
      round: this.state.round,
      version: this.state.version,
      kind,
      ...(this.cards && kind==='withdraw' && {member:this.me}),
      ...(this.cards?.proof && {proof:this.cards.proof}),
      value,
    }
    this.pending = { action, sent: this.now, attempts: 1 }
    this.changed()
    try {
      if (this.host) await this.handleAction(this.me, action)
      else await this.send('action', action)
    } catch (e) {
      this.error = '发送未确认，正在重试'
      throw e
    }
  }
  private async refresh(publish = true) {
    const order=++this.requestOrder
    const r = await this.api('heartbeat', this.body())
    if (this.disposed || !this.accept(r,order)) return
    if (this.room?.status === 'closing' || this.room?.status === 'closed') {
      await this.finish('房间已结束')
      return
    }
    if (!this.room?.members.some(m => m.membership_id === this.me && m.status === 'active' && m.lease_expires_at > this.now)) {
      throw new Error('房间或成员身份已失效，请退出后重新进入')
    }
    this.cards?.prune()
    if (this.authority?.sync(r.room.members, this.now) && this.online && publish) await this.snapshot()
  }
  private ticking = false
  private async tick() {
    if (
      this.ticking ||
      this.reconnecting ||
      this.disposed ||
      !this.room ||
      !this.room.members.some((m) => m.membership_id === this.me && m.status === 'active')
    )
      return
    this.ticking = true
    try {
      const now = this.now
      if (now - this.lastBeat >= 10000) {
        this.lastBeat = now
        await this.refresh()
        if (this.disposed) return
      }
      if (now >= this.leaseUntil) {
        this.error = '房间租约已失效，请退出后重新进入'
        this.online = false
        return
      }
      if (this.credentialExpires - now < 300000 && this.im) {
        const r = await this.api('credentials', this.body())
        if (r.credentials) {
          await this.im.login(r.credentials.user_id, r.credentials.user_sig)
          this.credentialExpires = r.credentials.expires_at
        }
      }
      if (this.host && !this.paused) {
        await this.enqueue(async()=>{
          if (this.authority?.tick(this.now)) {
            if (this.cards && !this.state?.doudizhu) this.authority.sync(this.room!.members,this.now)
            await this.snapshot()
          }
        })
        if (now - this.lastDigest >= 5000) {
          this.lastDigest = now
          await this.send('digest', { version: this.state?.version })
        }
      } else if (this.needSnapshot || !this.state || this.state.version<this.latestHostVersion || now - this.lastHost > 15000) await this.sync()
      await this.cards?.retry()
      if (this.pending && now - this.pending.sent > 3000) {
        if (this.pending.attempts >= 4) {
          this.error = '操作未确认，请同步后重试'
          this.pending = undefined
          await this.sync()
        } else {
          this.pending.sent = now
          this.pending.attempts++
          if (this.host) await this.handleAction(this.me, this.pending.action)
          else await this.send('action', this.pending.action)
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : ''
      if (['房间已结束', '设备 IM 登记已失效，请重新进入'].includes(message) || (this.host && message === '房间或成员身份已失效，请退出后重新进入')) await this.finish(message)
      else { this.error = '房间连接异常，请尝试立即重连'; this.connectionError = true }
    } finally {
      this.ticking = false
      this.changed()
    }
  }
  async text(text: string) {
    text = text.trim()
    if (!text || [...text].length > 500 || new TextEncoder().encode(text).length > 2048)
      throw new Error('文字最多 500 字且不超过 2 KiB')
    if (this.now - this.lastText < 2000) throw new Error('发送太快，请稍后重试')
    if (!this.im || !this.online) throw new Error('聊天连接尚未就绪')
    this.lastText = this.now
    this.addText(await this.im.text(text))
  }
  private leaveAck:{id:string;done:(error?:string)=>void}|undefined
  private leaving:Promise<void>|undefined
  leave() {
    this.leaving ??= this.leaveRoom().finally(()=>{this.leaving=undefined})
    return this.leaving
  }
  private async leaveRoom() {
    if (this.disposed) return
    if (!this.host && this.cards && this.online && this.state?.doudizhu && this.state.doudizhu.phase!=='ended' && this.state.players.includes(this.me)) {
      // Wait for host confirmation while backend admission still authenticates this sender.
      const id=crypto.randomUUID()
      const error=await new Promise<string|undefined>(resolve=>{
        const done=(message?:string)=>{
          if (this.leaveAck?.id!==id) return
          clearTimeout(timer)
          this.leaveAck=undefined
          resolve(message)
        }
        const timer=setTimeout(done,3500)
        this.leaveAck={id,done}
        void this.send('action',{id,round:this.state!.round,version:this.state!.version,kind:'withdraw',member:this.me}).catch(()=>done())
      })
      if (error) {
        this.error=error
        this.changed()
        throw Error(error)
      }
    }
    const activeBoard = this.state?.gomoku ?? this.state?.board
    if (!this.host && this.room && this.online && this.state && activeBoard && !activeBoard.ended) {
      await this.send('action', {id: crypto.randomUUID(), round:this.state.round, version:this.state.version, kind:'withdraw'}).catch(() => {})
    }
    this.cards?.clear()
    this.disposed = true
    this.closed = true
    clearInterval(this.timer)
    if (this.room) await this.api(this.host ? 'close' : 'leave', this.body()).catch(() => {})
    await this.im?.destroy().catch(() => {})
    this.online = false
    this.status = '已退出房间'
    this.changed()
  }
}
