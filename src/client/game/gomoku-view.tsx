import React, {useEffect,useState} from 'react'
import {GOMOKU_SIZE, type GomokuBoard} from './gomoku.js'
export const gomokuColors=['#303b4a','#c84b51','#317db0','#31836c','#885ab0','#bd7425']
interface Props {
  board: GomokuBoard; me: string; version: number; epoch: number; paused: boolean; pending: boolean; now: number; host: boolean
  name: (id:string)=>string; identity: (id:string)=>React.ReactNode
  place: (cell:number)=>void; next: ()=>void
}
const margin=29, step=28, gridEnd=margin+(GOMOKU_SIZE-1)*step, extent=gridEnd+margin
const xy=(cell:number)=>[margin+(cell%GOMOKU_SIZE)*step,margin+Math.floor(cell/GOMOKU_SIZE)*step] as const
export function GomokuView({board:b,me,version,epoch,paused,pending,now,host,name,identity,place,next}:Props){
 const [selected,setSelected]=useState<number>()
 const mine=b.players[b.turn]?.id===me&&!b.players[b.turn]?.retired
 const enabled=mine&&!paused&&!pending&&!b.ended
 useEffect(()=>setSelected(undefined),[version,epoch,paused,b.ended])
 const end=b.winner?`${name(b.winner)} 四子连珠，获胜！`:b.endReason==='full'?'棋盘已满，本局无胜者':'参与者不足两人，本局无胜者'
 const seconds=Math.max(0,Math.ceil((b.deadline-now)/1000))
 return <div className="gomoku-play">
  <style>{`
.gomoku-play{min-width:0;min-height:0;flex:1;display:flex;flex-direction:column;gap:10px;width:100%}.gomoku-play>.turn-banner,.gomoku-players,.gomoku-play>.actions,.gomoku-status{flex-shrink:0}
.gomoku-players{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}.gomoku-player{display:flex;align-items:center;gap:7px;background:#fff;border:2px solid var(--stone);border-radius:14px;padding:7px 10px;max-width:200px}.gomoku-player.current{background:#236453;color:white;box-shadow:0 0 0 3px #78ae9b40}.gomoku-player.retired{opacity:.55}.gomoku-player .player-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.stone-key{width:23px;height:23px;display:grid;place-items:center;border-radius:50%;background:var(--stone);color:white;flex-shrink:0;font-size:12px}.gomoku-player .person-avatar{width:28px;height:28px}
.gomoku-board{width:100%;height:0;min-height:200px;flex:1;align-self:center;display:block;filter:drop-shadow(0 5px 10px #583b1c20)}.gomoku-board [role=button]:focus{outline:none;stroke:#226c59;stroke-width:3}.gomoku-board [role=button][aria-disabled=false]{cursor:pointer}.gomoku-status{text-align:center;color:#68788a;margin:0}
`}</style>
  <div className={`turn-banner ${paused?'paused':mine&&!b.ended?'mine':''}`} role="status" aria-live="polite">
   <strong>{b.ended?end:paused?'连接恢复中，暂停操作':mine?'● 轮到你了':`等待 ${name(b.players[b.turn]!.id)} 落子`}</strong>
   {!b.ended&&<span aria-label="剩余时间">{seconds} 秒</span>}
  </div>
  <div className="gomoku-players">{b.players.map((p,i)=><div key={p.id} data-gomoku-player={p.id} className={`gomoku-player ${!b.ended&&i===b.turn?'current':''} ${p.retired?'retired':''}`} style={{'--stone':gomokuColors[i]} as React.CSSProperties}>
   {identity(p.id)}<span className="stone-key">{i+1}</span><span className="player-label" title={name(p.id)}>{name(p.id)}{p.retired?' · 已退赛':!b.ended&&i===b.turn?' · 当前回合':''}</span>
  </div>)}</div>
  <svg className="gomoku-board" viewBox={`0 0 ${extent} ${extent}`} role="group" aria-label={`${GOMOKU_SIZE}×${GOMOKU_SIZE} 五子棋棋盘`}>
   <defs><linearGradient id="gomoku-wood" x2="1" y2="1"><stop stopColor="#f5dfb6"/><stop offset="1" stopColor="#e6c58e"/></linearGradient></defs>
   <rect x="3" y="3" width={extent-6} height={extent-6} rx="15" fill="url(#gomoku-wood)" stroke="#8f693b" strokeWidth="5"/>
   {Array.from({length:GOMOKU_SIZE},(_,i)=><g key={i} stroke="#92754b" strokeWidth=".8"><path d={`M${margin} ${margin+i*step}H${gridEnd}`}/><path d={`M${margin+i*step} ${margin}V${gridEnd}`}/></g>)}
   {[3, GOMOKU_SIZE-4].flatMap(y=>[3, GOMOKU_SIZE-4].map(x=>y*GOMOKU_SIZE+x)).map(c=><circle key={c} cx={xy(c)[0]} cy={xy(c)[1]} r="2.8" fill="#72562f"/>)}
   {b.cells.map((color,c)=>{const [x,y]=xy(c),preview=selected===c&&!color;return <g key={c}>
    {(!!color||preview)&&<><circle cx={x} cy={y} r="12" fill={gomokuColors[color?color-1:b.turn]} opacity={preview ? .5 : 1} stroke="#fff" strokeWidth=".7"/><text x={x} y={y+4} textAnchor="middle" fontSize="11" fill="white" pointerEvents="none" opacity={preview ? .6 : 1}>{color||b.turn+1}</text></>}
    {b.lastCell===c&&<circle cx={x} cy={y} r="14" fill="none" stroke="#fff" strokeWidth="2"/>}
    <circle data-gomoku-cell={c} data-stone={color} data-preview={preview||undefined} cx={x} cy={y} r="13.5" fill="transparent" role="button" aria-label={`第${Math.floor(c/GOMOKU_SIZE)+1}行第${c%GOMOKU_SIZE+1}列${color?`，${color}号棋子`:'，空位'}`} aria-disabled={!enabled||!!color} tabIndex={enabled&&!color?0:-1} onClick={()=>{if(enabled&&!color)setSelected(c)}} onKeyDown={e=>{if((e.key==='Enter'||e.key===' ')&&enabled&&!color){e.preventDefault();setSelected(c)}}}/>
   </g>})}
   {b.winningLine&&<polyline data-winning-line points={b.winningLine.map(c=>xy(c).join(',')).join(' ')} fill="none" stroke="#fff291" strokeWidth="4" strokeLinecap="round" pointerEvents="none"/>}
  </svg>
  <p className="gomoku-status">{b.ended?'本局已结束':!b.players.some(p=>p.id===me&&!p.retired)?'你正在观战，可以在右侧聊天':enabled?'点击空位预览，确认后落子':'等待当前玩家完成落子'}</p>
  {!b.ended&&<div className="actions"><button disabled={selected===undefined||!enabled} onClick={()=>setSelected(undefined)}>取消选择</button><button className="primary" disabled={selected===undefined||!enabled} onClick={()=>{if(selected!==undefined&&enabled)place(selected)}}>确认落子</button></div>}
  {host&&b.ended&&<div className="actions"><button className="primary" disabled={paused||pending} onClick={next}>下一局</button></div>}
 </div>
}
