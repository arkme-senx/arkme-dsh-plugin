// Deterministic browser smoke adapter; production bundle always uses Tencent SDK.
const EVENT = { MESSAGE_RECEIVED: 'message', SDK_READY: 'ready', SDK_NOT_READY: 'notready', KICKED_OUT: 'kicked' }
class SDK {
  listeners = new Map<string, Set<(event: any) => void>>()
  ready = false
  user = 'host'
  private snapshot: any
  private action = (event: Event) => {
    const {user='u2',kind='place',value}=(event as CustomEvent).detail
    if (!this.snapshot) return
    this.emit('message',[{ID:crypto.randomUUID(),from:user,to:this.snapshot.group,conversationType:'GROUP',type:'TIMCustomElem',payload:{extension:'arkme.game.v1',data:JSON.stringify({...this.snapshot.packet,type:'action',payload:{id:crypto.randomUUID(),round:this.snapshot.packet.payload.round,version:this.snapshot.packet.payload.version,kind,value}})}}])
  }
  private disconnect = () => { this.ready = false; this.emit('kicked', {}) }
  constructor() { window.addEventListener('game-test-disconnect', this.disconnect); window.addEventListener('game-test-action',this.action) }
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
      if (packet.type === 'snapshot') { this.snapshot={packet,group:message.to}; (window as any).__gameTestSnapshot=packet.payload }
      if (packet.type === 'snapshot' && !s.board && !s.gomoku) {
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
    window.removeEventListener('game-test-disconnect', this.disconnect)
    window.removeEventListener('game-test-action',this.action)
    this.listeners.clear()
  }
}
export default { create: () => new SDK(), EVENT, TYPES: { CONV_GROUP: 'GROUP' } }
