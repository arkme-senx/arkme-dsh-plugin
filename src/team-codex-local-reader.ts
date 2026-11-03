import {createHash} from 'node:crypto'
import type {DatabaseSync} from 'node:sqlite'
import type {TeamCodexEvent,TeamCodexEventPage} from './team-codex-contract.js'
import {ArkmePluginError} from './services/service.js'

type Position=[number,number,number,string]
interface Scope {owner:number;task:string;sessionId:string;homeKey:string;native:boolean}
interface Window {after?:string;from?:string;through?:string}
const invalid=()=>new ArkmePluginError('team-codex-cursor-invalid','分页位置已变化，请重新打开任务',false,400)

/** Read-only projection of already collected facts. Fetch text only after selecting at most 50 identities. */
export function readLocalCodexEvents(db:DatabaseSync,scope:Scope,cursor?:string,window:Window={},before?:number,ascending=false):TeamCodexEventPage {
 const identity=createHash('sha256').update(JSON.stringify([scope.owner,scope.task,scope.sessionId,scope.homeKey,scope.native])).digest('hex')
 const encode=(p:Position)=>'nl1_'+Buffer.from(JSON.stringify([identity,...p])).toString('base64url')
 const decode=(token:string):Position=>{
  try {if(!token.startsWith('nl1_')||token.length>2048)throw invalid();const p=JSON.parse(Buffer.from(token.slice(4),'base64url').toString('utf8'))
   if(!Array.isArray(p)||p.length!==5||p[0]!==identity||!p.slice(1,4).every(Number.isSafeInteger)||p[1]<1||p[2]<0||p[2]>3||p[3]<0||typeof p[4]!=='string'||!p[4]||p[4].length>512)throw invalid()
   return p.slice(1) as Position
  }catch{throw invalid()}
 }
 const table=scope.native?'codex_events':'events',column=scope.native?'task_id':'connection_id'
 const forward=ascending||!!(window.after||window.from),direction=forward?'ASC':'DESC',where:string[]=[],bindings:(string|number)[]=[scope.task,scope.task,JSON.stringify([scope.owner,scope.homeKey,scope.sessionId])]
 const bound=(token:string|undefined,op:string)=>{if(!token)return;where.push(`(turn_seq,phase,message_seq,event_id) ${op} (?,?,?,?)`);bindings.push(...decode(token))}
 bound(window.after,'>');bound(window.from,'>=');bound(window.through,'<=');bound(cursor,forward?'>':'<')
 if(before!==undefined){if(!Number.isSafeInteger(before)||before<1)throw invalid();where.push('sequence<?');bindings.push(before)}
 const metadata=db.prepare(`WITH turns AS (
  SELECT turn_id,MIN(sequence) turn_seq FROM ${table} WHERE ${column}=? GROUP BY turn_id
 ), candidates AS (
  SELECT e.turn_id,t.turn_seq,CASE e.kind WHEN 'UserPromptSubmit' THEN 0 WHEN 'Interrupt' THEN 2 ELSE 3 END phase,
   0 message_seq,e.sequence,e.turn_id||':'||e.kind||':'||e.sequence event_id,0 native
  FROM ${table} e JOIN turns t ON e.turn_id=t.turn_id WHERE e.${column}=?
  UNION ALL
  SELECT l.turn,t.turn_seq,1,CASE WHEN l.source_order>0 THEN l.source_order ELSE l.at END,t.turn_seq,l.id,1
  FROM codex_live_messages l JOIN turns t ON l.turn=t.turn_id WHERE l.scope=? AND l.kind IN ('commentary','input')
 ) SELECT * FROM candidates ${where.length?'WHERE '+where.join(' AND '):''}
 ORDER BY turn_seq ${direction},phase ${direction},message_seq ${direction},event_id ${direction} LIMIT 51`).all(...bindings)
 const visible=metadata.slice(0,50),controls=visible.filter(r=>!r.native).map(r=>Number(r.sequence)),nativeIds=visible.filter(r=>r.native).map(r=>String(r.event_id))
 const controlsBySeq=new Map(controls.length?db.prepare(`SELECT * FROM ${table} WHERE ${column}=? AND sequence IN (${controls.map(()=>'?').join(',')})`).all(scope.task,...controls).map(row=>[Number(row.sequence),row]):[])
 const nativeById=new Map(nativeIds.length?db.prepare(`SELECT * FROM codex_live_messages WHERE scope=? AND id IN (${nativeIds.map(()=>'?').join(',')}) AND kind IN ('commentary','input')`).all(JSON.stringify([scope.owner,scope.homeKey,scope.sessionId]),...nativeIds).map(row=>[String(row.id),row]):[])
 const values=forward?visible:[...visible].reverse()
 const position=(row:typeof metadata[number]):Position=>[Number(row.turn_seq),Number(row.phase),Number(row.message_seq),String(row.event_id)]
 const items:TeamCodexEvent[]=values.map(row=>{
  const body=row.native?nativeById.get(String(row.event_id)):controlsBySeq.get(Number(row.sequence))
  if(!body)throw invalid()
  return {eventId:String(row.event_id),sequence:Number(row.sequence),turnSequence:Number(row.turn_seq),messageSequence:Number(row.message_seq),cursor:encode(position(row)),turnId:String(row.turn_id),kind:row.native?(body.kind==='input'?'UserPromptSubmit':'Progress'):body.kind as TeamCodexEvent['kind'],text:String(body.text),at:Number(body.at),truncated:body.truncated===1}
 })
 return {items,...(items.length?{firstCursor:items[0]!.cursor!,latestCursor:items.at(-1)!.cursor!}:{}),...(metadata.length>50?{nextCursor:encode(position(visible.at(-1)!))}:{})}
}
