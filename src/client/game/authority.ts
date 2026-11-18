import { createBoard, move, retire, timeout, type Board, type Cell } from './checkers.js'
import * as gomoku from './gomoku.js'
import {playerCounts, type GameType} from './game-types.js'
import type { Member } from './contracts.js'
export interface State {
  gameType?: GameType
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
  kind: 'ready' | 'duration' | 'count' | 'start' | 'place' | 'move' | 'withdraw' | 'next'
  value?: unknown
}
export class Authority {
  state: State = { version: 1, round: 'lobby', count: 6, turnSeconds: 60, players: [], ready: [] }
  private identities = new Map<string, string>()
  private seen = new Map<string, string>()
  constructor(readonly host: string, readonly gameType: GameType = 'chinese_checkers') {
    this.state.gameType = gameType
    this.state.count = gameType === 'multiplayer_gomoku' ? 2 : 6
  }
  get board() { return this.state.gomoku ?? this.state.board }
  sync(members: Member[], now: number): boolean {
    const ids = members
      .filter((m) => m.status === 'active' && m.lease_expires_at > now)
      .sort((a, b) => a.join_seq - b.join_seq)
      .map((m) => m.membership_id)
    const old = JSON.stringify(this.state)
    if (this.state.gomoku) {
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
  apply(sender: string, a: Action, members: Member[], now: number): string {
    if (typeof a.id !== 'string' || a.id.length > 80) return '请求无效'
    const dedupe = `${sender}:${a.id}`
    if (this.seen.has(dedupe)) return this.seen.get(dedupe)!
    let error = ''
    try {
      if (!members.some((m) => m.membership_id === sender && m.status === 'active' && m.lease_expires_at > now))
        throw new Error('成员无效')
      if (a.round !== this.state.round || a.version !== this.state.version) throw new Error('棋盘已更新，请同步后重试')
      switch (a.kind) {
        case 'count':
          if (sender !== this.host || this.board || !playerCounts(this.gameType).includes(Number(a.value)))
            throw new Error('不能调整人数')
          this.state.count = Number(a.value)
          this.state.ready = this.state.players.includes(this.host) ? [this.host] : []
          this.sync(members, now)
          break
        case 'duration':
          if (sender !== this.host || this.board || ![30, 60, 90, 120].includes(a.value as number))
            throw new Error('不能调整回合时长')
          this.state.turnSeconds = a.value as number
          this.state.ready = this.state.players.includes(this.host) ? [this.host] : []
          break
        case 'ready':
          if (sender === this.host) throw new Error('房主自动准备，无需操作')
          if (this.board || !this.state.players.includes(sender)) throw new Error('当前为观察者')
          this.state.ready = this.state.ready.includes(sender)
            ? this.state.ready.filter((x) => x !== sender)
            : [...this.state.ready, sender]
          break
        case 'start':
          if (
            sender !== this.host ||
            this.board ||
            members.some((m) => m.status === 'joining') ||
            this.state.players.length !== this.state.count ||
            !this.state.players.every((p) => this.state.ready.includes(p))
          )
            throw new Error('请等待人员到齐并准备')
          this.state.round = crypto.randomUUID()
          if (this.gameType === 'multiplayer_gomoku') this.state.gomoku = gomoku.createBoard(this.state.players, now, this.state.turnSeconds ?? 60)
          else this.state.board = createBoard(this.state.players, now, this.state.turnSeconds ?? 60)
          this.state.ready = []
          break
        case 'place':
          if (this.gameType !== 'multiplayer_gomoku' || !this.state.gomoku || typeof a.value !== 'number') throw Error('不能落子')
          this.state.gomoku = gomoku.place(this.state.gomoku, sender, a.value, now)
          break
        case 'withdraw':
          if (this.state.gomoku) this.state.gomoku = gomoku.retire(this.state.gomoku, sender, now)
          if (this.state.board) this.state.board = retire(this.state.board, sender, now)
          break
        case 'move':
          if (!this.state.board || !Array.isArray(a.value)) throw new Error('不能走棋')
          this.state.board = move(this.state.board, sender, a.value as Cell[], now)
          this.state.lastMove = {version: this.state.version+1, player:sender, path:(a.value as Cell[]).map(c=>[c[0],c[1]])}
          break
        case 'next':
          if (sender !== this.host || !this.board?.ended) throw new Error('本局尚未结束')
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
