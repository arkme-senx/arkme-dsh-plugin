import { createBoard, move, retire, timeout, type Board, type Cell } from './checkers.js'
import * as cards from './doudizhu.js'
import * as gomoku from './gomoku.js'
import {playerCounts, type GameType} from './game-types.js'
import type { Member } from './contracts.js'
export interface State {
  gameType?: GameType
  doudizhu?: ReturnType<typeof cards.publicView>
  gomoku?: gomoku.GomokuBoard
  version: number
  round: string
  count: number
  turnSeconds?: number
  players: string[]
  ready: string[]
  lastMove?: { version: number; player: string; path: Cell[] }
  board?: Board
}
export interface Action {
  id: string
  round: string
  version: number
  kind: 'ready' | 'duration' | 'count' | 'start' | 'bid' | 'play' | 'pass' | 'place' | 'move' | 'withdraw' | 'next'
  member?: string
  proof?: string
  value?: unknown
}
export class Authority {
  state: State = { version: 1, round: 'lobby', count: 6, turnSeconds: 60, players: [], ready: [] }
  #cards: cards.Round | undefined
  private dealt = new Set<string>()
  private tableRounds = new Set<string>()
  private previousDeal: {round:number; starter:number} | undefined
  private identities = new Map<string, string>()
  private seen = new Map<string, string>()
  constructor(readonly host: string, readonly gameType: GameType = 'chinese_checkers') {
    this.state.gameType = gameType
    this.state.count = gameType === 'chinese_checkers' ? 6 : playerCounts(gameType)[0]!
  }
  get board() { return this.state.gomoku ?? this.state.board }
  private get inGame() { return !!(this.board || this.#cards) }
  handFor(member: string, perspective?: string) {
    const round = this.#cards
    if (!round) return
    const seat = round.players.includes(member) ? member : perspective ?? this.host
    if (!round.players.includes(seat)) return
    return cards.privateView(round, seat)
  }
  private updateDeal(next: cards.Round) {
    if (this.#cards?.round !== next.round) {
      this.state.round = crypto.randomUUID()
      this.tableRounds.add(this.state.round)
      this.dealt.clear()
    }
    this.#cards = next
    this.previousDeal = {round:next.round, starter:next.starter}
    this.state.doudizhu = cards.publicView(next)
    this.state.players = [...next.players]
  }
  private lobby() {
    this.#cards = undefined
    this.tableRounds.clear()
    this.dealt.clear()
    delete this.state.doudizhu
    this.state.round = crypto.randomUUID()
    this.state.ready = this.state.players.includes(this.host) ? [this.host] : []
  }
  acknowledgeDeal(member:string, round:string, version:number, now:number) {
    if (!this.#cards || this.#cards.phase !== 'dealing' || !this.#cards.players.includes(member)
      || this.state.round !== round || this.state.version !== version || now >= this.#cards.deadline!) return false
    this.dealt.add(member)
    if (!this.#cards.players.every(id => this.dealt.has(id))) return false
    this.updateDeal(cards.startBidding(this.#cards,now))
    this.state.version++
    return true
  }
  revokeDeal(member:string) { this.dealt.delete(member) }
  sync(members: Member[], now: number): boolean {
    const ids = members
      .filter((m) => m.status === 'active' && m.lease_expires_at > now)
      .sort((a, b) => a.join_seq - b.join_seq)
      .map((m) => m.membership_id)
    const old = JSON.stringify(this.state)
    if (this.#cards) {
      for (const seat of this.#cards.players) if (!ids.includes(seat)) this.dealt.delete(seat)
      for (const m of members.filter(m => ids.includes(m.membership_id))) {
        const previous = this.identities.get(`${m.user_id}:${m.client_id}`)
        if (previous && !ids.includes(previous) && this.#cards.players.includes(previous)) {
          this.updateDeal(cards.replaceMember(this.#cards, previous, m.membership_id))
          this.dealt.clear()
        }
      }
    } else if (this.state.gomoku) {
      for (const p of this.state.gomoku.players)
        if (!ids.includes(p.id)) this.state.gomoku = gomoku.retire(this.state.gomoku, p.id, now)
    } else if (this.state.board) {
      // Admission expiry is not a game resignation. Keep the frozen seat until
      // the normal three-turn timeout; only the server-authenticated same device
      // may take over its own still-active seat after obtaining a new membership.
      for (const m of members.filter(m => ids.includes(m.membership_id))) {
        const previous = this.identities.get(`${m.user_id}:${m.client_id}`)
        const p = this.state.board.players.find(p => p.id === previous)
        if (!p || p.retired || this.state.board.ended || p.id === m.membership_id || ids.includes(p.id)) continue
        const oldId = p.id
        p.id = m.membership_id
        for (const cell of Object.keys(this.state.board.pieces))
          if (this.state.board.pieces[cell] === oldId) this.state.board.pieces[cell] = p.id
        this.state.players = this.state.players.map(id => id === oldId ? p.id : id)
        delete this.state.lastMove
      }
    } else {
      const players = ids.slice(0, this.state.count)
      if (players.join() !== this.state.players.join()) {
        this.state.players = players
        this.state.ready = this.state.players.includes(this.host) ? [this.host] : []
      }
    }
    for (const m of members.filter(m => ids.includes(m.membership_id)))
      this.identities.set(`${m.user_id}:${m.client_id}`, m.membership_id)
    if (JSON.stringify(this.state) !== old) {
      this.state.version++
      return true
    }
    return false
  }
  tick(now: number): boolean {
    if (this.#cards) {
      if (this.#cards.phase === 'dealing' && now >= this.#cards.deadline!) this.lobby()
      else {
        const next = cards.timeout(this.#cards, now)
        if (next === this.#cards) return false
        this.updateDeal(next)
      }
      this.state.version++
      return true
    }
    if (this.state.gomoku) {
      const b = gomoku.timeout(this.state.gomoku, now)
      if (b === this.state.gomoku) return false
      this.state.gomoku = b; this.state.version++; return true
    }
    if (!this.state.board) return false
    const b = timeout(this.state.board, now)
    if (b === this.state.board) return false
    this.state.board = b
    this.state.version++
    return true
  }
  apply(sender: string, a: Action, members: Member[], now: number, handReady = true): string {
    if (typeof a.id !== 'string' || a.id.length > 80) return '请求无效'
    const dedupe = `${sender}:${a.id}`
    if (this.seen.has(dedupe)) return this.seen.get(dedupe)!
    let error = ''
    try {
      if (!members.some((m) => m.membership_id === sender && m.status === 'active' && m.lease_expires_at > now))
        throw new Error('成员无效')
      if (this.#cards) this.tick(now)
      if (a.kind==='withdraw' && this.gameType==='doudizhu') {
        if (a.member!==sender || !this.#cards?.players.includes(sender)) throw Error('退出席位身份已更新')
        if (!this.tableRounds.has(a.round)) throw Error('牌桌已更新，请同步后重试')
      } else if (a.round!==this.state.round || a.version!==this.state.version) throw Error('游戏已更新，请同步后重试')
      if (!handReady) throw Error('手牌已更新，请同步后重试')
      switch (a.kind) {
        case 'count':
          if (sender !== this.host || this.inGame || !playerCounts(this.gameType).includes(Number(a.value)))
            throw new Error('不能调整人数')
          this.state.count = Number(a.value)
          this.state.ready = this.state.players.includes(this.host) ? [this.host] : []
          this.sync(members, now)
          break
        case 'duration':
          if (sender !== this.host || this.inGame || ![30, 60, 90, 120].includes(a.value as number))
            throw new Error('不能调整回合时长')
          this.state.turnSeconds = a.value as number
          this.state.ready = this.state.players.includes(this.host) ? [this.host] : []
          break
        case 'ready':
          if (sender === this.host) throw new Error('房主自动准备，无需操作')
          if (this.inGame || !this.state.players.includes(sender)) throw new Error('当前为观察者')
          this.state.ready = this.state.ready.includes(sender)
            ? this.state.ready.filter((x) => x !== sender)
            : [...this.state.ready, sender]
          break
        case 'start':
          if (
            sender !== this.host ||
            this.inGame ||
            members.some((m) => m.status === 'joining') ||
            this.state.players.length !== this.state.count ||
            !this.state.players.every((p) => this.state.ready.includes(p))
          )
            throw new Error('请等待人员到齐并准备')
          this.state.round = crypto.randomUUID()
          if (this.gameType === 'doudizhu') {
            const prior = this.previousDeal
            this.updateDeal(cards.createRound(this.state.players, {
              turnSeconds:this.state.turnSeconds ?? 60, now,
              ...(prior && {round:prior.round+1, starter:(prior.starter+1)%3}),
            }))
          } else if (this.gameType === 'multiplayer_gomoku') this.state.gomoku = gomoku.createBoard(this.state.players, now, this.state.turnSeconds ?? 60)
          else this.state.board = createBoard(this.state.players, now, this.state.turnSeconds ?? 60)
          this.state.ready = []
          break
        case 'bid':
          if (!this.#cards || typeof a.value !== 'number') throw Error('叫分无效')
          this.updateDeal(cards.bid(this.#cards,sender,a.value,now))
          break
        case 'play':
          if (!this.#cards || !Array.isArray(a.value) || a.value.length > 20) throw Error('所选手牌无效')
          this.updateDeal(cards.play(this.#cards,sender,a.value,now))
          break
        case 'pass':
          if (!this.#cards) throw Error('当前不能不出')
          this.updateDeal(cards.pass(this.#cards,sender,now))
          break
        case 'place':
          if (this.gameType !== 'multiplayer_gomoku' || !this.state.gomoku || typeof a.value !== 'number') throw Error('不能落子')
          this.state.gomoku = gomoku.place(this.state.gomoku, sender, a.value, now)
          break
        case 'withdraw':
          if (this.#cards) this.updateDeal(cards.withdraw(this.#cards,sender))
          if (this.state.gomoku) this.state.gomoku = gomoku.retire(this.state.gomoku, sender, now)
          if (this.state.board) this.state.board = retire(this.state.board, sender, now)
          break
        case 'move':
          if (!this.state.board || !Array.isArray(a.value)) throw new Error('不能走棋')
          this.state.board = move(this.state.board, sender, a.value as Cell[], now)
          this.state.lastMove = {version: this.state.version+1, player:sender, path:(a.value as Cell[]).map(c=>[c[0],c[1]])}
          break
        case 'next':
          if (sender !== this.host || !(this.board?.ended || this.#cards?.phase === 'ended')) throw new Error('本局尚未结束')
          this.lobby()
          delete this.state.gomoku
          delete this.state.board
          delete this.state.lastMove
          this.state.round = crypto.randomUUID()
          this.state.ready = this.state.players.includes(this.host) ? [this.host] : []
          this.sync(members, now)
          break
        default:
          throw new Error('未知操作')
      }
      this.state.version++
    } catch (e) {
      error = e instanceof Error ? e.message : '操作失败'
    }
    this.seen.set(dedupe, error)
    if (this.seen.size > 2048) this.seen.delete(this.seen.keys().next().value!)
    return error
  }
}
