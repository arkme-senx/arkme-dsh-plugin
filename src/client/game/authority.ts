import { createBoard, move, retire, timeout, type Board, type Cell } from './checkers.js'
import type { Member } from './contracts.js'
export interface State {
  version: number
  round: string
  count: number
  players: string[]
  ready: string[]
  lastMove?: { version: number; player: string; path: Cell[] }
  board?: Board
}
export interface Action {
  id: string
  round: string
  version: number
  kind: 'ready' | 'count' | 'start' | 'move' | 'next'
  value?: unknown
}
export class Authority {
  state: State = { version: 1, round: 'lobby', count: 6, players: [], ready: [] }
  private seen = new Map<string, string>()
  constructor(readonly host: string) {}
  sync(members: Member[], now: number): boolean {
    const ids = members
      .filter((m) => m.status === 'active' && m.lease_expires_at > now)
      .sort((a, b) => a.join_seq - b.join_seq)
      .map((m) => m.membership_id)
    const old = JSON.stringify(this.state)
    if (this.state.board) {
      for (const p of this.state.board.players)
        if (!ids.includes(p.id)) this.state.board = retire(this.state.board, p.id, now)
    } else {
      const players = ids.slice(0, this.state.count)
      if (players.join() !== this.state.players.join()) {
        this.state.players = players
        this.state.ready = []
      }
    }
    if (JSON.stringify(this.state) !== old) {
      this.state.version++
      return true
    }
    return false
  }
  tick(now: number): boolean {
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
          if (sender !== this.host || this.state.board || ![2, 3, 4, 6].includes(Number(a.value)))
            throw new Error('不能调整人数')
          this.state.count = Number(a.value)
          this.state.ready = []
          this.sync(members, now)
          break
        case 'ready':
          if (this.state.board || !this.state.players.includes(sender)) throw new Error('当前为观察者')
          this.state.ready = this.state.ready.includes(sender)
            ? this.state.ready.filter((x) => x !== sender)
            : [...this.state.ready, sender]
          break
        case 'start':
          if (
            sender !== this.host ||
            this.state.board ||
            members.some((m) => m.status === 'joining') ||
            this.state.players.length !== this.state.count ||
            !this.state.players.every((p) => this.state.ready.includes(p))
          )
            throw new Error('请等待人员到齐并准备')
          this.state.round = crypto.randomUUID()
          this.state.board = createBoard(this.state.players, now)
          this.state.ready = []
          break
        case 'move':
          if (!this.state.board || !Array.isArray(a.value)) throw new Error('不能走棋')
          this.state.board = move(this.state.board, sender, a.value as Cell[], now)
          this.state.lastMove = {version: this.state.version+1, player:sender, path:(a.value as Cell[]).map(c=>[c[0],c[1]])}
          break
        case 'next':
          if (sender !== this.host || !this.state.board?.ended) throw new Error('本局尚未结束')
          delete this.state.board
          delete this.state.lastMove
          this.state.round = crypto.randomUUID()
          this.state.ready = []
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
