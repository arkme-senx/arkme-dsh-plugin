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
export class GameIM {
  private chat: ReturnType<typeof Chat.create>
  private listeners: Array<[string, (event: any) => void]> = []
  private next = 0
  private queue = Promise.resolve()
  private queued = 0
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

  send(data: unknown): Promise<void> {
    if (this.disposed || this.queued >= 32) return Promise.reject(new Error('游戏消息队列已满，请稍后同步'))
    const text = JSON.stringify(data)
    if (new TextEncoder().encode(text).length > 4096) return Promise.reject(new Error('游戏消息超过大小限制'))
    this.queued++
    const work = this.queue
      .catch(() => {})
      .then(async () => {
        await new Promise((r) => setTimeout(r, Math.max(0, this.next - Date.now())))
        if (this.disposed) throw new Error('游戏已退出')
        this.next = Date.now() + 220
        const message = this.chat.createCustomMessage({
          to: this.group,
          conversationType: Chat.TYPES.CONV_GROUP,
          payload: { data: text, description: '', extension: 'arkme.game.v1' },
        })
        await this.chat.sendMessage(message, { onlineUserOnly: true })
      })
    this.queue = work
    return work.finally(() => {
      this.queued--
    })
  }
  async text(text: string) {
    const message = this.chat.createTextMessage({
      to: this.group,
      conversationType: Chat.TYPES.CONV_GROUP,
      payload: { text },
    })
    const result = await this.chat.sendMessage(message, { offlinePushInfo: { disablePush: true } })
    return result.data.message as WireMessage
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
    for (const [name, fn] of this.listeners) this.chat.off(name, fn)
    this.listeners = []
    await this.chat.destroy()
  }
}
