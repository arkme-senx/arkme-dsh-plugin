import { classify, type Pattern } from './doudizhu-cards.js'
export * from './doudizhu-cards.js'

export type RecentAction = { type: 'bid'; score: number } | { type: 'play'; cards: number[] } | { type: 'pass' }

export interface Round {
  recent: (RecentAction | null)[]
  players: string[]
  phase: 'dealing' | 'bidding' | 'playing' | 'ended'
  round: number
  version: number
  turnSeconds: number
  deadline: number | null
  starter: number
  turn: number | null
  landlord: number | null
  bids: (number | null)[]
  hands: number[][]
  bottom: number[]
  target: Pattern | null
  lastCards: number[]
  lastPlayer: number | null
  passes: number
  winners: number[]
  reason: 'withdraw' | 'empty' | null
}

function randomIndex(limit: number): number {
  const word = new Uint32Array(1)
  const bound = 0x100000000 - (0x100000000 % limit)
  do { globalThis.crypto.getRandomValues(word) } while (word[0]! >= bound)
  return word[0]! % limit
}

export function createRound(players: readonly string[], options: {
  turnSeconds?: number; starter?: number; round?: number; now?: number
} = {}): Round {
  if (players.length !== 3 || new Set(players).size !== 3 || players.some(p => !p))
    throw new Error('需要三个不同的玩家')
  const { turnSeconds = 60, starter = randomIndex(3), round = 1, now = Date.now() } = options
  if (![30,60,90,120].includes(turnSeconds) || ![0,1,2].includes(starter) || !Number.isSafeInteger(round) || round < 1)
    throw new Error('无效的牌局设置')
  const deck = Array.from({ length: 54 }, (_,i) => i)
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1)
    ;[deck[i], deck[j]] = [deck[j]!, deck[i]!]
  }
  return {
    recent: [null,null,null], players: [...players], phase: 'dealing', round, version: 1, turnSeconds, deadline: now + 30000,
    starter, turn: null, landlord: null, bids: [null,null,null],
    hands: [0,1,2].map(i => deck.slice(17*i,17*(i+1)).sort((a,b) => a-b)), bottom: deck.slice(51),
    target: null, lastCards: [], lastPlayer: null, passes: 0, winners: [], reason: null,
  }
}

export function nextRound(s: Round, now = Date.now()) {
  if (s.phase !== 'ended') throw new Error('当前牌局尚未结束')
  return redeal(s,now)
}

function redeal(s: Round, now: number) {
  return createRound(s.players,{ round: s.round + 1, starter: (s.starter + 1) % 3, turnSeconds: s.turnSeconds, now })
}

function record(s: Round, seat: number, action: RecentAction) {
  return s.recent.map((prior,i) => i === seat ? action : prior)
}

function advance(s: Round, changes: Partial<Round>, now: number): Round {
  return { ...s, version: s.version + 1, deadline: now + s.turnSeconds * 1000, ...changes }
}

export function startBidding(s: Round, now = Date.now()) {
  if (s.phase !== 'dealing' || s.deadline === null || now >= s.deadline) throw new Error('当前不能开始叫分')
  return advance(s,{phase:'bidding',turn:s.starter},now)
}

function seatToAct(s: Round, member: string, phase: Round['phase']) {
  const seat = s.players.indexOf(member)
  if (s.phase !== phase || seat !== s.turn || seat < 0) throw new Error('当前不是你的回合')
  return seat
}

export function bid(s: Round, member: string, score: number, now = Date.now()): Round {
  const seat = seatToAct(s,member,'bidding')
  const best = Math.max(0,...s.bids.map(v => v ?? 0))
  if (![0,1,2,3].includes(score) || (score !== 0 && score <= best)) throw new Error('叫分必须高于当前分数')
  const recent = record(s,seat,{type:'bid',score})
  const bids = s.bids.map((value,i) => i === seat ? score : value)
  if (score === 3 || bids.every(v => v !== null)) {
    const high = Math.max(best,score)
    if (!high) return redeal(s,now)
    const landlord = bids.indexOf(high)
    const hands = s.hands.map((h,i) => i === landlord ? [...h,...s.bottom].sort((a,b) => a-b) : h)
    return advance(s,{phase:'playing',landlord,turn:landlord,bids,hands,recent},now)
  }
  return advance(s,{bids,recent,turn:(seat+1)%3},now)
}

export function play(s: Round, member: string, cards: readonly number[], now = Date.now()): Round {
  const seat = seatToAct(s,member,'playing')
  if (cards.some(c => !s.hands[seat]!.includes(c))) throw new Error('所选牌不在你的手牌中')
  const target = classify(cards,s.target)
  if (!target) throw new Error(s.target ? '牌型不合法或未压过上一手牌' : '所选牌不能组成合法牌型')
  const hands = s.hands.map((h,i) => i === seat ? h.filter(c => !cards.includes(c)) : h)
  const won = hands[seat]!.length === 0
  const winners = won ? [0,1,2].filter(i => (i === s.landlord) === (seat === s.landlord)) : []
  return advance(s,{hands,target,recent:record(s,seat,{type:'play',cards:[...cards]}),lastCards:[...cards],lastPlayer:seat,passes:0,
    phase:won ? 'ended' : 'playing', turn:won ? null : (seat+1)%3, winners,reason:won ? 'empty' : null,
    ...(won ? { deadline:null } : {})},now)
}

export function pass(s: Round, member: string, now = Date.now()) {
  const seat = seatToAct(s,member,'playing')
  if (!s.target) throw new Error('自由领出时不能不出')
  const reset = s.passes === 1
  return advance(s,{recent:record(s,seat,{type:'pass'}),target:reset ? null : s.target,lastCards:reset ? [] : s.lastCards,
    passes:reset ? 0 : 1,turn:(seat+1)%3},now)
}

export function timeout(s: Round, now = Date.now()) {
  if (s.deadline === null || now < s.deadline || s.turn === null) return s
  const member = s.players[s.turn]!
  if (s.phase === 'bidding') return bid(s,member,0,now)
  if (s.phase === 'playing') return s.target ? pass(s,member,now) : play(s,member,[Math.min(...s.hands[s.turn]!)],now)
  return s
}

export function withdraw(s: Round, member: string): Round {
  if (!s.players.includes(member)) throw new Error('玩家不在本桌')
  if (s.phase === 'ended') return s
  return advance(s,{phase:'ended',turn:null,deadline:null,winners:[],reason:'withdraw'},0)
}

export function replaceMember(s: Round, oldId: string, newId: string): Round {
  if (!s.players.includes(oldId) || !newId || (newId !== oldId && s.players.includes(newId))) throw new Error('座位身份不匹配')
  if (newId === oldId) return s
  return {...s,version:s.version+1,players:s.players.map(p => p === oldId ? newId : p)}
}

export function publicView(s: Round) {
  return {
    recent:s.recent.map(a => a?.type === 'play' ? {...a,cards:[...a.cards]} : a && {...a}),
    players:[...s.players],phase:s.phase,round:s.round,version:s.version,turnSeconds:s.turnSeconds,
    deadline:s.deadline,starter:s.starter,turn:s.turn,landlord:s.landlord,bids:[...s.bids],
    counts:s.hands.map(h => h.length), bottom:s.landlord === null ? null : [...s.bottom],
    target:s.target && {...s.target},lastCards:[...s.lastCards],lastPlayer:s.lastPlayer,passes:s.passes,
    winners:[...s.winners],reason:s.reason,remaining:s.phase === 'ended' ? s.hands.map(h => [...h]) : null,
  }
}

export function privateView(s: Round, seatMember: string) {
  const seat = s.players.indexOf(seatMember)
  if (seat < 0) throw new Error('无效的手牌视角')
  return {round:s.round,version:s.version,member:seatMember,hand:[...s.hands[seat]!]}
}
