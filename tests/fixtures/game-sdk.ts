// Deterministic browser smoke adapter; production bundle always uses Tencent SDK.
const EVENT = { MESSAGE_RECEIVED: 'message', SDK_READY: 'ready', SDK_NOT_READY: 'notready', KICKED_OUT: 'kicked' }
class SDK {
  listeners = new Map<string, Set<(event: any) => void>>()
  ready = false
  user = 'host'
  on(name: string, fn: (event: any) => void) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set())
    this.listeners.get(name)!.add(fn)
  }
  off(name: string, fn: (event: any) => void) {
    this.listeners.get(name)?.delete(fn)
  }
  emit(name: string, data: any) {
    for (const fn of this.listeners.get(name) ?? []) fn({ data })
  }
  setLogLevel() {}
  isReady() {
    return this.ready
  }
  async login({ userID }: { userID: string }) {
    this.user = userID
    this.ready = true
    this.emit('ready', {})
  }
  createTextMessage(v: any) {
    return { ...v, from: this.user, ID: crypto.randomUUID(), type: 'TIMTextElem' }
  }
  createCustomMessage(v: any) {
    return { ...v, from: this.user, ID: crypto.randomUUID(), type: 'TIMCustomElem' }
  }
  async sendMessage(message: any) {
    if (message.type === 'TIMTextElem') setTimeout(() => this.emit('message', [{...message, ID: crypto.randomUUID(), from: 'u2', payload: {text: '收到，轮到我了'}}]), 30)

    if (message.type === 'TIMCustomElem') {
      const packet = JSON.parse(message.payload.data),
        s = packet.payload
      if (packet.type === 'snapshot' && !s.board) {
        const bot = s.players.find((p: string) => p !== 'member1' && !s.ready.includes(p))
        if (bot)
          setTimeout(
            () =>
              this.emit('message', [
                {
                  ID: crypto.randomUUID(),
                  from: bot.replace('member', 'u'),
                  to: message.to,
                  conversationType: 'GROUP',
                  type: 'TIMCustomElem',
                  payload: {
                    extension: 'arkme.game.v1',
                    data: JSON.stringify({
                      ...packet,
                      type: 'action',
                      payload: { id: crypto.randomUUID(), version: s.version, round: s.round, kind: 'ready' },
                    }),
                  },
                },
              ]),
            30,
          )
      }
    }
    return { data: { message } }
  }
  async getMessageList() {
    return { data: { messageList: [] } }
  }
  async destroy() {
    this.listeners.clear()
  }
}
export default { create: () => new SDK(), EVENT, TYPES: { CONV_GROUP: 'GROUP' } }
