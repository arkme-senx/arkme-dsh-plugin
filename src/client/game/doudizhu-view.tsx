import React, {useEffect, useMemo, useState} from 'react'
import type {State} from './authority.js'
import {classify, legalPlays, rank, type privateView} from './doudizhu.js'
type PublicBoard=NonNullable<State['doudizhu']>
interface Props {
  board:PublicBoard; perspective:string; view:ReturnType<typeof privateView>|undefined; me:string; version:number; epoch:number
  paused:boolean; pending:boolean; now:number; host:boolean
  name:(id:string)=>string; identity:(id:string)=>React.ReactNode
  act:(kind:'bid'|'play'|'pass',value?:unknown)=>void; watch:(member:string)=>void; next:()=>void
}
const ranks=['3','4','5','6','7','8','9','10','J','Q','K','A','2','小王','大王']
const suits=['♣','♦','♥','♠']
function label(card:number){return `${ranks[rank(card)]}${card<52?suits[card%4]:''}`}
function Face({card,small=false}:{card:number;small?:boolean}){
  return <span className={`ddz-face ${small?'small':''} ${card===53||(card<52&&[1,2].includes(card%4))?'red':''}`}><b>{ranks[rank(card)]}</b><span>{card<52?suits[card%4]:'★'}</span></span>
}
const styles=`
.ddz-play{width:100%;flex:1;min-height:520px;display:flex;flex-direction:column;gap:9px;color:#f3f7f5;background:radial-gradient(ellipse at 50% 40%,#327c68,#205848);border:7px solid #d4b996;border-radius:24px;box-shadow:inset 0 0 0 2px #a98e6f,0 5px 18px #293a4820;padding:14px 18px;position:relative;overflow:hidden}
.ddz-top{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:48px}.ddz-top small{color:#c5ddd3;display:block}.ddz-bottom{display:flex;gap:5px}.ddz-back{width:31px;height:43px;border:2px solid #f7ead5;border-radius:5px;background:repeating-linear-gradient(45deg,#426f92,#426f92 3px,#5e8daa 3px,#5e8daa 5px)}
.ddz-opponents{display:flex;justify-content:space-between;gap:12px}.ddz-person{display:flex;align-items:center;gap:9px;background:#163f354a;border:1px solid #ffffff35;border-radius:13px;padding:8px 10px;min-width:0;max-width:46%;color:#e8f3ed}.ddz-person.active{background:#fff2d3;color:#4c412f;border-color:#f1c76e;box-shadow:0 0 0 3px #f3ca6b25}.ddz-person strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px}.ddz-person small{display:block;opacity:.8;font-size:11px}.ddz-person .person-avatar{flex-shrink:0}.ddz-count{font-size:20px;font-weight:750;margin-left:8px;white-space:nowrap}.ddz-count small{font-size:10px;text-align:center}
.ddz-table-center{flex:1;min-height:75px;display:flex;flex-direction:column;justify-content:center;gap:9px}.ddz-recent{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;text-align:center}.ddz-recent>div{min-width:0;padding:8px 3px;background:#143c3429;border-radius:12px}.ddz-recent small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#cee5d9;font-size:11px;margin-bottom:6px}.ddz-small-cards{display:flex;flex-wrap:wrap;justify-content:center;gap:2px}.ddz-face{width:44px;height:64px;display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;padding:4px 6px;background:linear-gradient(120deg,#fffef9,#f3eee2);border:1px solid #d5d0c5;border-radius:6px;color:#263343;box-shadow:0 2px 3px #0b241d28;line-height:1}.ddz-face b{font-size:17px}.ddz-face>span{font-size:21px}.ddz-face.red{color:#ba4249}.ddz-face.small{width:26px;height:36px;padding:3px;border-radius:4px}.ddz-face.small b{font-size:10px}.ddz-face.small>span{font-size:12px}
.ddz-turn{display:flex;justify-content:space-between;align-items:center;background:#153c344d;border:1px solid #ffffff2e;border-radius:11px;padding:8px 12px}.ddz-turn.mine{background:#f9edd1;color:#4d482f;border-color:#e5c271}.ddz-turn strong{font-size:16px}.ddz-clock{font:700 22px ui-monospace,monospace;white-space:nowrap}.ddz-controls{display:flex;align-items:center;justify-content:center;gap:7px;flex-wrap:wrap;min-height:40px}.ddz-controls button{padding:8px 13px;font-size:13px}.ddz-controls .primary{background:#e9c77f;border-color:#e9c77f;color:#4f432a}.ddz-controls .primary:hover:not(:disabled){background:#f3dba4}.ddz-controls button:disabled{opacity:.4}.ddz-feedback{min-height:18px;text-align:center;font-size:12px;color:#ffe2a1}
.ddz-hand-head{display:flex;align-items:center;justify-content:space-between;gap:9px;font-size:12px;min-height:36px}.ddz-hand-head .ddz-person{max-width:65%;padding:5px 9px}.ddz-hand-head select{max-width:180px;border:1px solid #d8e3da;background:#f4f7f1;color:#304b43;border-radius:8px;padding:6px;font:inherit}.ddz-hand{display:grid;grid-template-columns:repeat(var(--cards),minmax(0,1fr));margin:14px auto 0;width:100%;max-width:650px;padding-right:22px;padding-bottom:4px;min-height:72px;align-items:end}.ddz-hand button{padding:0;border:0;border-radius:6px;background:transparent;width:44px;min-width:0;position:relative;transition:transform .15s;box-shadow:none;align-self:end}.ddz-hand button:hover:not(:disabled){background:transparent;transform:translateY(-5px);box-shadow:none}.ddz-hand button[aria-pressed=true]{transform:translateY(-12px);z-index:1;outline:2px solid #f4cf79;outline-offset:1px}.ddz-hand button:disabled{opacity:1;cursor:default}.ddz-sync{text-align:center;color:#d6e8df;padding:18px;font-size:13px}
.ddz-result{padding:10px 12px;border-radius:12px;text-align:center;background:#f8eed5;color:#4b4535}.ddz-result strong{display:block;font-size:21px}.ddz-result p{margin:4px;font-size:12px}.ddz-remaining{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}.ddz-remaining>div{flex:1;min-width:110px}.ddz-remaining small{display:block;text-align:center;margin-bottom:4px;color:#d9e9e0}.ddz-hand-label{color:#d7e9df}.ddz-game-phase{font-size:12px;color:#c8e0d3}
@media(max-height:720px){.ddz-play{min-height:460px;padding:10px 14px;gap:6px}.ddz-recent>div{padding:5px 2px}.ddz-hand{margin-top:10px}.ddz-top{min-height:42px}.ddz-person{padding:6px 8px}.ddz-table-center{min-height:65px}}
@media(prefers-reduced-motion:reduce){.ddz-hand button{transition:none}}
`
export function DoudizhuView(p:Props){
 const b=p.board,observer=!b.players.includes(p.me)
 const perspective=observer?(p.perspective||b.players[0]!):p.me
 const seat=Math.max(0,b.players.indexOf(perspective)),left=(seat+1)%3,right=(seat+2)%3
 const view=p.view,viewReady=!!view&&view.round===b.round&&view.version===b.version&&view.member===perspective
 const hand=viewReady?view.hand:[]
 const mine=b.turn!==null&&b.players[b.turn]===p.me
 const enabled=!observer&&mine&&!p.paused&&!p.pending&&viewReady
 const canPlay=enabled&&b.phase==='playing'
 const [selected,setSelected]=useState<number[]>([]),[hint,setHint]=useState(0),[message,setMessage]=useState('')
 useEffect(()=>{setSelected([]);setHint(0);setMessage('')},[p.version,p.epoch,b.phase,b.turn,view?.member,view?.version])
 const candidates=useMemo(()=>b.phase==='playing'&&viewReady?legalPlays(hand,b.target):[],[view,b.phase,b.target,viewReady])
 const person=(index:number)=>{const id=b.players[index]!;return <div key={id} data-ddz-player={id} className={`ddz-person ${b.turn===index?'active':''}`}>{p.identity(id)}<div><strong>{p.name(id)}</strong><small>{b.landlord===null?'等待叫分':b.landlord===index?'♛ 地主':'农民'}{b.turn===index?' · 当前回合':''}</small></div><span className="ddz-count">{b.counts[index]}<small>张牌</small></span></div>}
 function suggest(){if(!candidates.length){setSelected([]);setMessage('没有能压过的牌，请选择“不出”');return}setSelected(candidates[hint%candidates.length]!);setHint(hint+1);setMessage(`提示 ${hint%candidates.length+1} / ${candidates.length}`)}
 function submit(){try{if(!classify(selected,b.target)){setMessage(b.target?'所选牌型不合法，或无法压过上一手牌':'所选牌不能组成合法牌型');return}setMessage('');p.act('play',selected)}catch(e){setMessage(e instanceof Error?e.message:'请选择合法牌型')}}
 const best=Math.max(0,...b.bids.map(x=>x??0)),seconds=Math.max(0,Math.ceil(((b.deadline??p.now)-p.now)/1000))
 const result=b.reason==='withdraw'?'玩家退出，本局结束，无胜负':b.winners.includes(b.landlord!)?'地主获胜':'农民共同获胜'
 return <div className="ddz-play"><style>{styles}</style>
  <div className="ddz-top"><div><strong>♠ 斗地主</strong><small>{b.landlord===null?'底牌将在确定地主后公开':`地主：${p.name(b.players[b.landlord]!)}`}</small></div><div className="ddz-bottom" aria-label="底牌">{b.bottom?b.bottom.map(c=><Face key={c} card={c} small/>):[0,1,2].map(i=><span key={i} className="ddz-back" aria-label="未公开底牌"/>)}</div></div>
  <div className="ddz-opponents">{person(left)}{person(right)}</div>
  <div className="ddz-table-center">
   {b.phase==='ended'?<><div className="ddz-result" role="status"><strong>{result}</strong><p>{b.reason==='withdraw'?'退出结束不计算胜负':'本局结束，剩余手牌已公开'}</p></div><div className="ddz-remaining">{b.remaining?.map((cards,i)=><div key={i}><small>{p.name(b.players[i]!)} · 剩余 {cards.length} 张</small><div className="ddz-small-cards">{cards.map(c=><Face key={c} card={c} small/>)}</div></div>)}</div></>:
    <div className="ddz-recent">{[left,seat,right].map(i=>{const recent=b.recent[i];return <div key={i}><small>{p.name(b.players[i]!)}</small>{recent?.type==='play'?<div className="ddz-small-cards">{recent.cards.map(c=><Face key={c} card={c} small/>)}</div>:<span className="ddz-game-phase">{recent?.type==='pass'?'不出':recent?.type==='bid'?(recent.score?`${recent.score} 分`:'不叫'):'等待行动'}</span>}</div>})}</div>}
  </div>
  {b.phase!=='ended'&&<div className={`ddz-turn ${mine&&!p.paused?'mine':''}`} role="status"><strong>{b.phase==='dealing'?'正在确认三位玩家的手牌…':!viewReady?'正在同步手牌…':p.paused?'连接恢复中，暂停操作':p.pending?'正在确认操作…':mine?`● 轮到你${b.phase==='bidding'?'叫分':'出牌'}了`:`等待 ${p.name(b.players[b.turn!]!)} ${b.phase==='bidding'?'叫分':'出牌'}`}</strong><span className="ddz-clock" aria-label="剩余时间">{seconds} 秒</span></div>}
  <div className="ddz-controls">
   {b.phase==='bidding'&&!observer&&[0,1,2,3].map(score=><button key={score} className={score===3?'primary':''} disabled={!enabled||(score>0&&score<=best)} onClick={()=>p.act('bid',score)}>{score===0?'不叫':`${score} 分`}</button>)}
   {b.phase==='playing'&&!observer&&<><button disabled={!canPlay||!b.target} onClick={()=>p.act('pass')}>不出</button><button disabled={!canPlay} onClick={suggest}>提示</button><button disabled={!canPlay||!selected.length} onClick={()=>{setSelected([]);setMessage('')}}>取消选择</button><button className="primary" disabled={!canPlay||!selected.length} onClick={submit}>出牌</button></>}
   {b.phase==='ended'&&(p.host?<button className="primary" disabled={p.paused||p.pending} onClick={p.next}>下一局</button>:<span>等待房主开始下一局</span>)}
   {observer&&b.phase!=='ended'&&<span className="ddz-hand-label">正在观战 · 不参与出牌</span>}
  </div>
  <div className="ddz-feedback" role="status">{message}</div>
  <div className="ddz-hand-head">{person(seat)}{observer&&b.phase!=='ended'?<label>观战视角 <select aria-label="观战视角" value={perspective} disabled={p.paused||p.pending} onChange={e=>{setSelected([]);p.watch(e.target.value)}}>{b.players.map(id=><option key={id} value={id}>{p.name(id)}</option>)}</select></label>:<span className="ddz-hand-label">{b.phase==='ended'?'本局结束，剩余手牌已公开':'点击选牌，再确认出牌'}</span>}</div>
  {b.phase!=='ended'&&(viewReady?<div className="ddz-hand" role="group" aria-label={observer?'观战手牌':'你的手牌'} style={{'--cards':Math.max(1,hand.length)} as React.CSSProperties}>{hand.map(c=><button key={c} data-ddz-card={c} aria-label={label(c)} aria-pressed={selected.includes(c)} disabled={!canPlay} onClick={()=>{setSelected(s=>s.includes(c)?s.filter(x=>x!==c):[...s,c]);setMessage('')}}><Face card={c}/></button>)}</div>:<div className="ddz-sync">正在建立加密连接并同步手牌…</div>)}
 </div>
}
