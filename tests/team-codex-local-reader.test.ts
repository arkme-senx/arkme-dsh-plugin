import {DatabaseSync} from 'node:sqlite'
import {afterEach,expect,it} from 'vitest'
import {readLocalCodexEvents} from '../src/team-codex-local-reader.js'
const dbs:DatabaseSync[]=[]
afterEach(()=>{for(const db of dbs.splice(0))db.close()})
const scope={owner:11,task:'task',sessionId:'session',homeKey:'home',native:true}
function fixture(){
 const db=new DatabaseSync(':memory:');dbs.push(db)
 db.exec(`CREATE TABLE codex_events(task_id TEXT,turn_id TEXT,kind TEXT,text TEXT,at INTEGER,truncated INTEGER,sequence INTEGER);CREATE INDEX task_events ON codex_events(task_id,sequence);
 CREATE TABLE codex_live_messages(scope TEXT,turn TEXT,id TEXT,kind TEXT,text TEXT,at INTEGER,truncated INTEGER,source_order INTEGER,PRIMARY KEY(scope,turn,id));`)
 const insert=db.prepare('INSERT INTO codex_events VALUES(?,?,?,?,?,0,?)'),message=db.prepare('INSERT INTO codex_live_messages VALUES(?,?,?,?,?,?,0,?)')
 for(let turn=1;turn<=3;turn++){
  insert.run('task','turn-'+turn,'UserPromptSubmit','问题'+turn,1000*turn,2*turn-1)
  insert.run('task','turn-'+turn,'Stop','最终'+turn,1000*turn+1,2*turn)
  for(let n=1;n<=170;n++)message.run(JSON.stringify([11,'home','session']),'turn-'+turn,`${turn}-${String(n).padStart(3,'0')}`,'commentary','过程'+n+'x'.repeat(1000),1000*turn+n+2,n*10)
 }
 return {db,message}
}
it('pages every collected local message exactly once, bounded to 50 even when a single turn has hundreds of progress messages',()=>{
 const {db}=fixture();let cursor:string|undefined;const ids:string[]=[]
 do {const page=readLocalCodexEvents(db,scope,cursor);expect(page.items.length).toBeLessThanOrEqual(50);expect(page.items.every(row=>row.eventId&&row.cursor&&!row.localProgress)).toBe(true);ids.unshift(...page.items.map(row=>row.eventId!));cursor=page.nextCursor}while(cursor)
 expect(ids).toHaveLength(516);expect(new Set(ids).size).toBe(516)
 expect(ids[0]).toBe('turn-1:UserPromptSubmit:1');expect(ids.at(-1)).toBe('turn-3:Stop:6')
})
it('re-reads a loaded window and discovers a late message behind the tail cursor, while detecting scope changes',()=>{
 const {db,message}=fixture(),page=readLocalCodexEvents(db,scope)
 const first=page.items[0]!,last=page.items.at(-1)!
 message.run(JSON.stringify([11,'home','session']),'turn-3','late','commentary','晚到的旧位置',9000,first.messageSequence!+1)
 const window=readLocalCodexEvents(db,scope,undefined,{from:first.cursor!,through:last.cursor!})
 expect(window.items.some(row=>row.eventId==='late')).toBe(true)
 expect(readLocalCodexEvents(db,scope,undefined,{after:last.cursor!}).items).toEqual([])
 expect(()=>readLocalCodexEvents(db,{...scope,owner:22},page.nextCursor)).toThrow('分页位置已变化')
})
it('keeps cursors valid when presentation fields outside source identity change',()=>{
 const {db}=fixture(),page=readLocalCodexEvents(db,scope)
 expect(readLocalCodexEvents(db,{...scope,active:false} as typeof scope,page.nextCursor).items).toHaveLength(50)
})

it('feeds background cloud reconciliation in bounded ascending slices without rescanning all bodies',()=>{
 const {db}=fixture();let cursor:string|undefined;const rows:string[]=[]
 do{const page=readLocalCodexEvents(db,scope,cursor,{},undefined,true);expect(page.items.length).toBeLessThanOrEqual(50);rows.push(...page.items.map(e=>e.eventId!));cursor=page.nextCursor}while(cursor)
 expect(rows).toHaveLength(516);expect(new Set(rows).size).toBe(516);expect(rows[0]).toBe('turn-1:UserPromptSubmit:1');expect(rows.at(-1)).toBe('turn-3:Stop:6')
})

it('interleaves steering inputs with assistant progress in one turn and keeps user roles',()=>{
 const {db,message}=fixture()
 message.run(JSON.stringify([11,'home','session']),'turn-3','steer','input','追加需求',4000,21)
 const all=[];let cursor:string|undefined
 do{const page=readLocalCodexEvents(db,scope,cursor,{},undefined,true);all.push(...page.items);cursor=page.nextCursor}while(cursor)
 const i=all.findIndex(e=>e.eventId==='steer')
 expect(all[i]).toMatchObject({kind:'UserPromptSubmit',turnId:'turn-3',messageSequence:21})
 expect(all[i-1]).toMatchObject({kind:'Progress',messageSequence:20})
 expect(all[i+1]).toMatchObject({kind:'Progress',messageSequence:30})
})
