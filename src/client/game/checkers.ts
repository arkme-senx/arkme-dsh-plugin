export type Cell = readonly [number, number]
export const directions: Cell[] = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
]
export const key = ([q, r]: Cell) => `${q},${r}`
const rotate = ([q, r]: Cell): Cell => [-r, q + r]
const triangle: Cell[] = []
for (let q = 5; q <= 8; q++) for (let r = -4; r <= 4 - q; r++) triangle.push([q, r])
export const camps: Cell[][] = [triangle]
for (let i = 1; i < 6; i++) camps.push(camps[i - 1]!.map(rotate))
export const cells: Cell[] = []
for (let q = -4; q <= 4; q++) for (let r = -4; r <= 4; r++) if (Math.abs(q + r) <= 4) cells.push([q, r])
cells.push(...camps.flat())
const valid = new Set(cells.map(key))
export const campSets = camps.map((c) => new Set(c.map(key)))
export const layouts: Record<number, number[]> = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 6: [0, 1, 2, 3, 4, 5] }
export interface Player {
  id: string
  camp: number
  timeouts: number
  retired: boolean
}
export interface Board {
  pieces: Record<string, string>
  players: Player[]
  turn: number
  turnSeconds?: number
  deadline: number
  winner?: string | undefined
  ended: boolean
}
export function createBoard(ids: string[], now: number, turnSeconds = 60): Board {
  if (![30, 60, 90, 120].includes(turnSeconds)) throw new Error('回合时长无效')
  const layout = layouts[ids.length]
  if (!layout) throw new Error('人数必须为 2、3、4 或 6')
  const players = ids.map((id, i) => ({ id, camp: layout[i]!, timeouts: 0, retired: false }))
  const pieces: Record<string, string> = {}
  for (const p of players) for (const c of camps[p.camp]!) pieces[key(c)] = p.id
  return { pieces, players, turn: 0, turnSeconds, deadline: now + turnSeconds * 1000, ended: false }
}
function segment(a: Cell, b: Cell): { direction: Cell; distance: number } | null {
  for (const d of directions)
    for (let n = 1; n <= 16; n++)
      if (a[0] + d[0] * n === b[0] && a[1] + d[1] * n === b[1]) return { direction: d, distance: n }
  return null
}
export function validatePath(board: Board, id: string, path: Cell[]): boolean {
  if (board.ended || board.players[board.turn]?.id !== id || path.length < 2 || path.length > 122) return false
  const player = board.players[board.turn]!
  const target = campSets[(player.camp + 3) % 6]!
  const pieces = { ...board.pieces }
  const seen = new Set<string>()
  if (!path.every((c) => Array.isArray(c) && c.length === 2 && c.every(Number.isInteger) && valid.has(key(c))))
    return false
  if (pieces[key(path[0]!)] !== id) return false
  seen.add(key(path[0]!))
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!,
      b = path[i]!,
      s = segment(a, b)
    if (!s || pieces[key(b)] || seen.has(key(b)) || (target.has(key(a)) && !target.has(key(b)))) return false
    if (s.distance === 1) {
      if (path.length !== 2) return false
    } else {
      if (s.distance % 2 !== 0) return false
      for (let j = 1; j < s.distance; j++) {
        const c: Cell = [a[0] + s.direction[0] * j, a[1] + s.direction[1] * j]
        if (!valid.has(key(c))) return false
        const occupied = !!pieces[key(c)]
        if (occupied !== (j === s.distance / 2)) return false
      }
    }
    delete pieces[key(a)]
    pieces[key(b)] = id
    seen.add(key(b))
  }
  return true
}
function advance(b: Board, now: number) {
  const alive = b.players.filter((p) => !p.retired)
  if (alive.length <= 1) {
    b.ended = true
    b.winner = alive[0]?.id
    return
  }
  do {
    b.turn = (b.turn + 1) % b.players.length
  } while (b.players[b.turn]!.retired)
  b.deadline = now + (b.turnSeconds ?? 60) * 1000
}
export function move(board: Board, id: string, path: Cell[], now: number): Board {
  if (now >= board.deadline || !validatePath(board, id, path)) throw new Error('当前走棋无效或回合已结束')
  const b = structuredClone(board)
  delete b.pieces[key(path[0]!)]
  b.pieces[key(path.at(-1)!)] = id
  b.players[b.turn]!.timeouts = 0
  const target = campSets[(b.players[b.turn]!.camp + 3) % 6]!
  if ([...target].every((c) => b.pieces[c] === id)) {
    b.ended = true
    b.winner = id
  } else advance(b, now)
  return b
}
export function retire(board: Board, id: string, now: number): Board {
  const b = structuredClone(board),
    p = b.players.find((p) => p.id === id)
  if (!p || p.retired || b.ended) return b
  p.retired = true
  for (const [c, owner] of Object.entries(b.pieces)) if (owner === id) delete b.pieces[c]
  if (b.players[b.turn]?.id === id) advance(b, now)
  else {
    const alive = b.players.filter((p) => !p.retired)
    if (alive.length <= 1) {
      b.ended = true
      b.winner = alive[0]?.id
    }
  }
  return b
}
export function timeout(board: Board, now: number): Board {
  if (board.ended || now < board.deadline) return board
  const b = structuredClone(board),
    p = b.players[b.turn]!
  p.timeouts++
  if (p.timeouts >= 3) return retire(b, p.id, now)
  advance(b, now)
  return b
}
