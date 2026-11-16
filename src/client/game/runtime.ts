import {encodeState,decodeState} from './wire-state.js'
import { Authority, type State, type Action } from './authority.js'
import { GameIM, type WireMessage } from './im.js'
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
  private command?: GameCommand
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
    return !this.online || !this.state || this.now > this.leaseUntil || (!this.host && this.now - this.lastHost > 15000)
  }
  private body() {
    return { room_id: this.room?.room_id, membership_id: this.me, runtime_id: this.host ? this.runtime : undefined }
  }
  private accept(r: Reply) {
    this.offset = r.server_time - Date.now()
    this.room = r.room
    this.me = r.membership_id
    this.leaseUntil = r.room.members.find((m) => m.membership_id === this.me)?.lease_expires_at ?? 0
    if (r.invite_token) this.token = r.invite_token
  }
  async enter(command: GameCommand) {
    if (this.busy || this.disposed) return
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
            if (!ready) this.animationEpoch++
            this.online = ready
            if (kicked) {
              this.error = '游戏登录已失效，请退出后重新进入'
              void this.leave()
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
          ? { request_id: this.requestId, runtime_id: this.runtime, game_type: 'chinese_checkers' }
          : { request_id: this.requestId, room_id: command.roomId, invite_token: command.token },
      )
      this.accept(reply)
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
          this.authority = new Authority(this.me)
          this.authority.sync(this.room.members, this.now)
          this.state = this.authority.state
        }
        this.accept(await this.api('activate', this.body()))
        if (!this.token) {
          const r = await this.api('invite/rotate', this.body())
          this.token = r.invite_token ?? ''
        }
        await this.snapshot()
      } else {
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
  private envelope(type: string, payload: unknown) {
    return { protocol_version: 1, room_id: this.room!.room_id, runtime_id: this.room!.runtime_id, type, payload }
  }
  private async send(type: string, payload: unknown) {
    if (this.im && !this.disposed) await this.im.send(this.envelope(type, payload))
  }
  private async snapshot() {
    if (!this.authority) return
    this.state = this.authority.state
    this.lastSnapshot = this.now
    await this.send('snapshot', encodeState(this.state))
    this.changed()
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
      if (this.host) await this.snapshot()
      else await this.sync()
      await this.history()
    } catch {
      this.error = '连接恢复中，请稍候'
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
  private receive(m: WireMessage) {
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
      packet.protocol_version !== 1 ||
      packet.room_id !== this.room.room_id ||
      packet.runtime_id !== this.room.runtime_id
    )
      return
    const sender = this.room.members.find(
      (x) => x.registration_id === m.from && x.status === 'active' && x.lease_expires_at > this.now,
    )
    if (!sender) return
    if (sender.membership_id === this.room.host_membership_id) {
      this.lastHost = this.now
      if (packet.type === 'snapshot' && !this.host) {
        const s = packet.payload
        if (
          !s ||
          !Number.isSafeInteger(s.version) ||
          s.version < (this.state?.version ?? 0) ||
          !Array.isArray(s.players) ||
          !Array.isArray(s.ready) ||
          ![2, 3, 4, 6].includes(s.count)
        )
          return
        try { this.state = decodeState(s) } catch { return }
        this.status = ''
      }
      if (packet.type === 'digest' && !this.host && packet.payload?.version !== (this.state?.version ?? 0))
        void this.sync().catch(() => {})
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
      if (packet.type === 'sync' && this.now - this.lastSnapshot > 500) void this.snapshot().catch(() => {})
      if (packet.type === 'action') void this.handleAction(sender.membership_id, packet.payload).catch(() => { this.error = '操作确认发送失败，等待重试'; this.changed() })
    }
    this.changed()
  }
  private async handleAction(sender: string, action: Action) {
    if (!this.authority || !this.room || !action || this.paused) return
    const error = this.authority.apply(sender, action, this.room.members, this.now)
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
    if (kind === 'start') {
      await this.refresh()
      if (this.authority?.sync(this.room!.members, this.now)) await this.snapshot()
    }
    const action: Action = {
      id: crypto.randomUUID(),
      round: this.state.round,
      version: this.state.version,
      kind,
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
  private async refresh() {
    const r = await this.api('heartbeat', this.body())
    if (this.disposed) return
    this.accept(r)
    if (this.room?.status === 'closing' || this.room?.status === 'closed') {
      await this.leave()
      this.error = '房间已结束'
      return
    }
    if (this.authority?.sync(r.room.members, this.now)) await this.snapshot()
  }
  private ticking = false
  private async tick() {
    if (
      this.ticking ||
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
        if (this.authority?.tick(now)) await this.snapshot()
        if (now - this.lastDigest >= 5000) {
          this.lastDigest = now
          await this.send('digest', { version: this.state?.version })
        }
      } else if (!this.state || now - this.lastHost > 15000) await this.sync()
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
    } catch {
      this.error = '房间连接异常，正在重试'
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
  async leave() {
    if (this.disposed) return
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
