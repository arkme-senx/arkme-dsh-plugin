import {it,expect} from 'vitest'
import {createBoard,place,timeout,retire} from '../src/client/game/gomoku.js'
for(const count of [2,3,4,5,6])it(`initializes ${count} numbered players`,()=>{
 const b=createBoard(Array.from({length:count},(_,i)=>`p${i}`),1000,90)
 expect(b.cells).toHaveLength(225);expect(b.players).toHaveLength(count);expect(b.deadline).toBe(91000)
 expect(place(b,'p0',112,2000).turn).toBe(1)
})
for(const [dx,dy] of [[1,0],[0,1],[1,1],[-1,1]])it(`wins along ${dx},${dy} only with five`,()=>{
 let b=createBoard(['a','b'],0)
 const start=dx===-1?10:2
 for(let i=0;i<4;i++)b.cells[(2+i*dy!)*15+start+i*dx!]=1
 const win=place(b,'a',(2+4*dy!)*15+start+4*dx!,1)
 expect(win.winner).toBe('a');expect(win.ended).toBe(true);expect(win.winningLine).toHaveLength(5)
 b=createBoard(['a','b'],0);for(let i=0;i<3;i++)b.cells[30+i]=1
 expect(place(b,'a',33,1).ended).toBe(false)
})
it('accepts long lines, rejects occupied/out-of-turn/invalid placements and row wrapping',()=>{
 const b=createBoard(['a','b'],0);for(const x of [0,1,2,4,5])b.cells[30+x]=1
 expect(place(b,'a',33,1).winningLine).toHaveLength(6)
 for(const cell of [-1,225,1.1,NaN])expect(()=>place(b,'a',cell,1)).toThrow()
 expect(()=>place(b,'b',33,1)).toThrow();expect(()=>place(b,'a',30,1)).toThrow()
 const edge=createBoard(['a','b'],0);[13,14,15,16].forEach(x=>edge.cells[x]=1)
 expect(place(edge,'a',17,1).ended).toBe(false)
 edge.cells[16]=2;expect(place(edge,'a',17,1).ended).toBe(false)
})
it('keeps retired stones as obstacles and ends without winner with one survivor',()=>{
 const b=createBoard(['a','b','c'],0);b.cells[10]=2
 const r=retire(b,'b',1);expect(r.cells[10]).toBe(2);expect(r.players[1]!.retired).toBe(true)
 expect(()=>place(r,'a',10,2)).toThrow()
 const end=retire(r,'c',2);expect(end.ended).toBe(true);expect(end.winner).toBeUndefined();expect(end.endReason).toBe('insufficient_players')
})
it('skips timeouts, retires on third, resets streak after placement, obeys duration',()=>{
 for(const seconds of [30,60,90,120]){
 let b=createBoard(['a','b','c'],0,seconds)
 b.players[0]!.timeouts=2;b=timeout(b,b.deadline)
 expect(b.players[0]!.retired).toBe(true);expect(b.turn).toBe(1);expect(b.deadline).toBe(seconds*2000)
 b.players[1]!.timeouts=2;b=place(b,'b',0,b.deadline-1);expect(b.players[1]!.timeouts).toBe(0)
 }
})
it('ends a full board without five as a draw',()=>{
 const b=createBoard(['a','b'],0)
 b.cells=Array.from({length:225},(_,i)=>((Math.floor(i/15)+Math.floor((i%15)/2))%2)+1)
 b.cells[112]=0
 const end=place(b,'a',112,1);expect(end.ended).toBe(true);expect(end.endReason).toBe('full');expect(end.winner).toBeUndefined()
})

import {Authority} from '../src/client/game/authority.js'
import {encodeState,decodeState} from '../src/client/game/wire-state.js'
import type {Member} from '../src/client/game/contracts.js'
const members:Member[]=Array.from({length:7},(_,i)=>({membership_id:`member-${i}`,user_id:i,client_id:1,registration_id:`user-${i}`,binding_generation:'b',join_seq:i,status:'active',lease_expires_at:999999}))
it('keeps generic lobby semantics and resets gomoku next round',()=>{
 const a=new Authority('member-0','multiplayer_gomoku');a.sync(members,0)
 expect(a.state.count).toBe(2);expect(a.state.ready).toEqual(['member-0'])
 let id=0;const act=(sender:string,kind:any,value?:unknown)=>a.apply(sender,{id:String(id++),round:a.state.round,version:a.state.version,kind,value},members,0)
 expect(act('member-1','count',5)).not.toBe('');expect(act('member-0','count',5)).toBe('')
 for(const m of members.slice(1,5))act(m.membership_id,'ready')
 expect(act('member-0','start')).toBe('');expect(a.state.gomoku?.players).toHaveLength(5)
 expect(act('member-0','count',6)).not.toBe('');expect(act('member-6','place',1)).not.toBe('')
 act('member-0','place',112);expect(a.state.gomoku?.lastCell).toBe(112)
 a.state.gomoku!.ended=true;act('member-0','next')
 expect(a.state.gomoku).toBeUndefined();expect(a.state.players).toHaveLength(5);expect(a.state.ready).toEqual(['member-0'])
})
it('encodes a full six-player board below 4 KiB and rejects cross-game or corrupt snapshots',()=>{
 const a=new Authority('member-0','multiplayer_gomoku');a.sync(members,0)
 a.state.count=6;a.sync(members,0);a.state.gomoku=createBoard(a.state.players,0)
 a.state.gomoku.cells=Array.from({length:225},(_,i)=>i%6+1)
 const wire=encodeState(a.state)
 expect(new TextEncoder().encode(JSON.stringify({room_id:'r'.repeat(32),runtime_id:'x'.repeat(36),protocol_version:1,type:'snapshot',payload:wire})).length).toBeLessThan(4096)
 expect(decodeState(wire,'multiplayer_gomoku')).toEqual(a.state)
 expect(()=>decodeState(wire,'chinese_checkers')).toThrow()
 for(const cells of ['0'.repeat(224),'7'.repeat(225),Array(225).fill(0)])expect(()=>decodeState({...wire,gomoku:{...a.state.gomoku,cells}},'multiplayer_gomoku')).toThrow()
 expect(()=>decodeState({...wire,gameType:'unknown'},'multiplayer_gomoku')).toThrow()
 const legacy={version:1,round:'lobby',count:2,players:[],ready:[]}
 expect(decodeState(legacy)).toEqual(legacy)
})
