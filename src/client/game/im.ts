import ChatModule from '@tencentcloud/lite-chat'
// The SDK publishes CommonJS with a default-export declaration; isolate the
// NodeNext interop mismatch at this boundary, not in the game runtime.
interface SDK {
  on(event: string, fn: (event: any) => void): void
  off(event: string, fn: (event: any) => void): void
  setLogLevel(level: number): void
  isReady(): boolean
  login(options: { userID: string; userSig: string }): Promise<unknown>
  destroy(): Promise<unknown>
  createTextMessage(options: unknown): unknown
  createCustomMessage(options: unknown): unknown
  sendMessage(message: unknown, options: unknown): Promise<{ data: { message: WireMessage } }>
  getMessageList(options: unknown): Promise<{ data: { messageList: WireMessage[]; nextReqMessageID?: string; isCompleted?: boolean } }>
}
const Chat = ChatModule as unknown as {
  create(options: { SDKAppID: number }): SDK
  EVENT: { MESSAGE_RECEIVED: string; SDK_READY: string; SDK_NOT_READY: string; KICKED_OUT: string }
  TYPES: { CONV_GROUP: string }
}
export interface WireMessage {
  from: string
  ID: string
  to: string
  conversationType: string
  type: string
  payload: { text?: string; data?: string; extension?: string }
}
export interface Delivery { key?: string; observer?: boolean }
interface Outgoing { options:Delivery; run:()=>Promise<void>; discard:()=>void; fail:(e:unknown)=>void }
export class GameIM {
  private chat: ReturnType<typeof Chat.create>
  private listeners: Array<[string, (event: any) => void]> = []
  private next = 0
  private queue:Outgoing[] = []
  private draining = false
  private disposed = false
  constructor(
    app: number,
    public group: string,
    onMessage: (message: WireMessage) => void,
    onStatus: (ready: boolean, kicked?: boolean) => void,
  ) {
    this.chat = Chat.create({ SDKAppID: app })
    this.chat.setLogLevel(4)
    this.on(Chat.EVENT.MESSAGE_RECEIVED, (e) => {
      for (const m of e.data ?? [])
        if (m.to === this.group && m.conversationType === Chat.TYPES.CONV_GROUP) onMessage(m)
    })
    this.on(Chat.EVENT.SDK_READY, () => onStatus(true))
    this.on(Chat.EVENT.SDK_NOT_READY, () => onStatus(false))
    this.on(Chat.EVENT.KICKED_OUT, () => onStatus(false, true))
  }
  private on(name: string, fn: (event: any) => void) {
    this.chat.on(name, fn)
    this.listeners.push([name, fn])
  }
  async login(user: string, sig: string) {
    let timer: ReturnType<typeof setTimeout> | undefined
    let ready: () => void = () => {}
    const wait = new Promise<void>((resolve, reject) => {
      ready = () => resolve()
      this.chat.on(Chat.EVENT.SDK_READY, ready)
      timer = setTimeout(() => reject(new Error('游戏 IM 连接超时')), 20000)
    })
    try {
      await Promise.all([
        this.chat.login({ userID: user, userSig: sig }).then(() => {
          if (this.chat.isReady()) ready()
        }),
        wait,
      ])
    } finally {
      clearTimeout(timer)
      this.chat.off(Chat.EVENT.SDK_READY, ready)
    }
  }

  private schedule(options:Delivery, send:()=>Promise<void>) {
    if (this.disposed) return Promise.reject(Error('游戏已退出'))
    const same = options.key && this.queue.find(job=>job.options.key === options.key)
    if (same) {
      this.queue.splice(this.queue.indexOf(same),1)
      same.discard()
    }
    if (this.queue.length >= 32) {
      const observer = this.queue.findIndex(job=>job.options.observer)
      if (observer < 0 || options.observer) return Promise.reject(Error('游戏消息队列已满，请稍后同步'))
      this.queue.splice(observer,1)[0]!.discard()
    }
    return new Promise<void>((resolve,reject)=>{
      this.queue.push({options,run:async()=>{ await send(); resolve() },discard:resolve,fail:reject})
      void this.drain()
    })
  }
  private async drain() {
    if (this.draining) return
    this.draining = true
    try {
      while (this.queue.length && !this.disposed) {
        const delay = this.next-Date.now()
        if (delay > 0) await new Promise(resolve=>setTimeout(resolve,delay))
        if (this.disposed) break
        const priority = this.queue.findIndex(job=>!job.options.observer)
        const job = this.queue.splice(Math.max(0,priority),1)[0]
        if (!job) continue
        this.next = Date.now()+220
        try { await job.run() } catch(e) { job.fail(e) }
      }
    } finally { this.draining = false }
  }
  cancel(key:string) {
    const index=this.queue.findIndex(job=>job.options.key===key)
    if (index>=0) this.queue.splice(index,1)[0]!.discard()
  }
  send(data: unknown, options:Delivery={}): Promise<void> {
    const text = JSON.stringify(data)
    if (new TextEncoder().encode(text).length > 4096) return Promise.reject(new Error('游戏消息超过大小限制'))
    return this.schedule(options,async()=>{
      const message = this.chat.createCustomMessage({
        to:this.group, conversationType:Chat.TYPES.CONV_GROUP,
        payload:{data:text,description:'',extension:'arkme.game.v1'},
      })
      await this.chat.sendMessage(message,{onlineUserOnly:true})
    })
  }
  async text(text: string) {
    let sent:WireMessage | undefined
    await this.schedule({}, async()=>{
      const message = this.chat.createTextMessage({
        to:this.group, conversationType:Chat.TYPES.CONV_GROUP, payload:{text},
      })
      sent = (await this.chat.sendMessage(message,{offlinePushInfo:{disablePush:true}})).data.message
    })
    return sent!
  }
  async history(): Promise<WireMessage[]> {
    let messages: WireMessage[] = []
    let cursor: string | undefined
    // This pinned SDK exposes a cursor, not a count option. Fetch bounded pages
    // rather than silently accepting its default first-page size.
    for (let page = 0; page < 4; page++) {
      const result = await this.chat.getMessageList({ conversationID: `GROUP${this.group}`, ...(cursor ? {nextReqMessageID: cursor} : {}) })
      messages = [...result.data.messageList, ...messages]
      const next = result.data.nextReqMessageID
      if (messages.length >= 50 || result.data.isCompleted || !next || next === cursor) break
      cursor = next
    }
    return messages.slice(-50)
  }
  async destroy() {
    this.disposed = true
    for (const job of this.queue.splice(0)) job.fail(Error('游戏已退出'))
    for (const [name, fn] of this.listeners) this.chat.off(name, fn)
    this.listeners = []
    await this.chat.destroy()
  }
}
