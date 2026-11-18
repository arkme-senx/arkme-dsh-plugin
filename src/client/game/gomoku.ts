export interface GomokuBoard {
  cells: number[]
  players: {id: string; timeouts: number; retired: boolean}[]
  turn: number
  turnSeconds: number
  deadline: number
  ended: boolean
  winner?: string
  endReason?: 'five' | 'full' | 'insufficient_players'
  lastCell?: number
  winningLine?: number[]
}
export function createBoard(ids: string[], now: number, turnSeconds = 60): GomokuBoard {
  if (ids.length < 2 || ids.length > 6 || new Set(ids).size !== ids.length || ![30,60,90,120].includes(turnSeconds)) throw Error('五子棋设置无效')
  return {cells:Array(225).fill(0),players:ids.map(id=>({id,timeouts:0,retired:false})),turn:0,turnSeconds,deadline:now+turnSeconds*1000,ended:false}
}
function finishOrAdvance(b: GomokuBoard, now: number) {
  if (b.players.filter(p=>!p.retired).length < 2) { b.ended=true;b.endReason='insufficient_players';return }
  do {b.turn=(b.turn+1)%b.players.length} while(b.players[b.turn]!.retired)
  b.deadline=now+b.turnSeconds*1000
}
export function place(board: GomokuBoard, id: string, cell: number, now: number): GomokuBoard {
  if (board.ended || now>=board.deadline || board.players[board.turn]?.id!==id || board.players[board.turn]?.retired || !Number.isInteger(cell) || cell<0 || cell>=225 || board.cells[cell]!==0) throw Error('当前落子无效或回合已结束')
  const b=structuredClone(board), color=b.turn+1
  b.cells[cell]=color;b.lastCell=cell;b.players[b.turn]!.timeouts=0
  const x=cell%15,y=Math.floor(cell/15)
  for (const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]] as const) {
    const line=[cell]
    for (const sign of [-1,1]) for(let n=1;n<15;n++) {
      const nx=x+dx*n*sign,ny=y+dy*n*sign
      if(nx<0||nx>=15||ny<0||ny>=15||b.cells[ny*15+nx]!==color)break
      if(sign<0)line.unshift(ny*15+nx);else line.push(ny*15+nx)
    }
    if(line.length>=5){b.ended=true;b.winner=id;b.endReason='five';b.winningLine=line;return b}
  }
  if(b.cells.every(c=>c!==0)){b.ended=true;b.endReason='full';return b}
  finishOrAdvance(b,now);return b
}
export function retire(board: GomokuBoard, id: string, now: number): GomokuBoard {
  const index=board.players.findIndex(p=>p.id===id)
  if(board.ended||index<0||board.players[index]!.retired)return board
  const b=structuredClone(board);b.players[index]!.retired=true
  if(b.players.filter(p=>!p.retired).length<2){b.ended=true;b.endReason='insufficient_players'}
  else if(index===b.turn)finishOrAdvance(b,now)
  return b
}
export function timeout(board: GomokuBoard, now: number): GomokuBoard {
  if(board.ended||now<board.deadline)return board
  const b=structuredClone(board),p=b.players[b.turn]!
  p.timeouts++;if(p.timeouts>=3)p.retired=true
  finishOrAdvance(b,now);return b
}
