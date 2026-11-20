import type {State} from './authority.js'
import type {Pattern, RecentAction} from './doudizhu.js'

const invalid = (): never => { throw Error('无效的公开牌局') }
const int = (v: unknown, low: number, high: number): number =>
  Number.isSafeInteger(v) && Number(v) >= low && Number(v) <= high ? Number(v) : invalid()
const seat = (v: unknown) => v === null ? null : int(v,0,2)
function list<T>(v:unknown, min:number, max:number, read:(x:any)=>T):T[] {
  if (!Array.isArray(v) || v.length < min || v.length > max) return invalid()
  return v.map(read)
}
export function cardIds(v:unknown, min = 0, max = 20) {
  const result = list(v,min,max,x=>int(x,0,53))
  return new Set(result).size === result.length ? result : invalid()
}
function recent(v:any):RecentAction|null {
  if (v === null || v.type === 'pass') return v === null ? null : {type:'pass'}
  if (v.type === 'bid') return {type:'bid',score:int(v.score,0,3)}
  if (v.type === 'play') return {type:'play',cards:cardIds(v.cards,1)}
  return invalid()
}
function target(v:any): Pattern|null {
  if (v === null) return null
  if (!['single','pair','triple','tripleSingle','triplePair','straight','pairRun','plane','planeSingles','planePairs','fourSingles','fourPairs','bomb','rocket'].includes(v.kind)) return invalid()
  return {kind:v.kind,high:int(v.high,0,14),length:int(v.length,1,12)}
}
// Only fields deliberately projected here can ever reach the public wire or UI.
export function cardState(s:any):State {
  if (![30,60,90,120].includes(s.turnSeconds) || s.count !== 3) return invalid()
  const id = (v:unknown) => typeof v === 'string' && v.length && v.length <= 160 ? v : invalid()
  const base:State = {gameType:'doudizhu', version:int(s.version,1,Number.MAX_SAFE_INTEGER),
    round:id(s.round), count:3, turnSeconds:s.turnSeconds, players:list(s.players,0,3,id), ready:list(s.ready,0,3,id)}
  const d = s.doudizhu
  if (d === undefined) return base
  if (d.players?.length !== 3 || base.players.length !== 3 || !base.players.every((p,i)=>d.players[i]===p)
    || d.turnSeconds !== base.turnSeconds || !['dealing','bidding','playing','ended'].includes(d.phase)
    || (d.phase === 'ended' ? !['withdraw','empty'].includes(d.reason) || d.deadline !== null : d.remaining !== null || d.reason !== null || !Number.isFinite(d.deadline))
    || (d.landlord === null && d.bottom !== null)) return invalid()
  const counts = list(d.counts,3,3,x=>int(x,0,20))
  const remaining = d.phase === 'ended' ? list(d.remaining,3,3,x=>cardIds(x)) : null
  if (remaining?.some((cards,i)=>cards.length !== counts[i])) return invalid()
  base.doudizhu = {players:[...base.players], phase:d.phase, round:int(d.round,1,Number.MAX_SAFE_INTEGER),
    version:int(d.version,1,Number.MAX_SAFE_INTEGER), turnSeconds:d.turnSeconds, deadline:d.deadline,
    starter:int(d.starter,0,2),turn:seat(d.turn),landlord:seat(d.landlord),
    bids:list(d.bids,3,3,x=>x===null ? null : int(x,0,3)), counts, bottom:d.landlord===null ? null : cardIds(d.bottom,3,3),
    target:target(d.target),lastCards:cardIds(d.lastCards),lastPlayer:seat(d.lastPlayer),passes:int(d.passes,0,1),
    winners:list(d.winners,0,2,x=>int(x,0,2)),reason:d.reason,remaining,recent:list(d.recent,3,3,recent)}
  return base
}
