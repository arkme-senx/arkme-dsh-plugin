import type { DatabaseSync } from 'node:sqlite'
import { ArkmePluginError } from './services/service.js'

import type {CodexTaskPosition,CodexTaskPage} from './team-codex-contract.js'
const localTasks=(activity=false)=>`SELECT t.id,t.updated_at,i.team_ref FROM codex_tasks t ${activity?'INDEXED BY codex_task_activity':''} CROSS JOIN codex_installations i ON i.id=t.installation_id
 WHERE i.user_id=? AND (?='self' OR i.team_ref=?) AND t.deleted=0
 AND EXISTS(SELECT 1 FROM codex_session_visibility v WHERE v.installation_id=t.installation_id AND v.session_id=t.session_id AND v.visibility='user')
 UNION ALL SELECT c.id,c.updated_at,c.team_ref FROM connections c ${activity?'INDEXED BY connection_activity':''} WHERE c.user_id=? AND (?='self' OR c.team_ref=?)
 AND NOT EXISTS(SELECT 1 FROM codex_legacy_migrations m WHERE m.connection_id=c.id)`
const args=(user:number,team:string)=>[user,team,team,user,team,team]
export const isLocalCodexTaskPosition=(p:CodexTaskPosition)=>[p.cursor,p.after,p.from].some(value=>value?.startsWith('lt1_'))
export function localCodexTaskPage(db:DatabaseSync,user:number,team:string,position:CodexTaskPosition={}) {
 const raw=position.cursor||position.after||position.from
 let at:number|undefined,id:string|undefined
 if(raw){try{const value=JSON.parse(Buffer.from(raw.slice(4),'base64url').toString('utf8'))
  if(!raw.startsWith('lt1_')||raw.length>2048||[position.cursor,position.after,position.from].filter(Boolean).length!==1||value[0]!==user||value[1]!==team||!Number.isSafeInteger(value[2])||typeof value[3]!=='string')throw Error()
  at=value[2];id=value[3]
 }catch{throw new ArkmePluginError('team-codex-cursor-invalid','本机列表位置无效，请刷新后重试',false,400)}}
 const newer=!!position.after
 const bound=at===undefined?'':newer?' WHERE updated_at>=? AND (updated_at>? OR id<?)':` WHERE updated_at<=? AND (updated_at<? OR id${position.from?'>=':'>'}?)`
 const rows=db.prepare(`WITH local AS (${localTasks(true)}) SELECT * FROM local${bound} ORDER BY updated_at ${newer?'ASC':'DESC'},id ${newer?'DESC':'ASC'} LIMIT 51`).all(...args(user,team),...(at===undefined?[]:[at,at,id!])) as {id:string;updated_at:number;team_ref:string}[]
 const more=rows.length>50;rows.splice(50);if(newer)rows.reverse()
 const encode=(row:typeof rows[number]|undefined)=>row?'lt1_'+Buffer.from(JSON.stringify([user,team,row.updated_at,row.id])).toString('base64url'):undefined
 const hasNewer=newer?more:!!(position.cursor||position.from)
 const paging:CodexTaskPage={hasMore:newer?rows.length>0:more,hasNewer,firstCursor:encode(rows[0]),nextCursor:encode(rows.at(-1)),previousCursor:hasNewer?encode(rows[0]):undefined}
 return {rows,paging}
}

/** Hot tasks stay prompt; a keyset sweep eventually visits every cold task. */
export function localCodexTaskBatch(db:DatabaseSync,user:number,team:string,after:string) {
 const query=`WITH local AS (${localTasks()}) SELECT * FROM local`
 const hot=db.prepare(query+' ORDER BY updated_at DESC,id LIMIT 4').all(...args(user,team)) as {id:string}[]
 let cold=db.prepare(query+' WHERE id>? ORDER BY id LIMIT 4').all(...args(user,team),after) as {id:string}[]
 if(!cold.length)cold=db.prepare(query+' ORDER BY id LIMIT 4').all(...args(user,team)) as {id:string}[]
 return {ids:[...new Set([...hot,...cold].map(row=>row.id))],cursor:cold.at(-1)?.id??''}
}
