import { createHash } from 'node:crypto'
import { constants, watch, type FSWatcher } from 'node:fs'
import { open } from 'node:fs/promises'
import type { DatabaseSync } from 'node:sqlite'
import type { TeamCodexEvent, TeamCodexProgress } from './team-codex-contract.js'
import { TeamCodexTurnTimingReader, type CodexTimingSource } from './team-codex-turn-timing.js'
import { redactCodexQueueText } from './team-codex-desktop-queue.js'
import { codexImageSafeText } from './team-codex-image-text.js'

const CHUNK = 1024 * 1024, BUDGET = 4 * CHUNK, MAX_LINE = 256 * 1024
const scopeOf = (owner:number,source:CodexTimingSource) => JSON.stringify([owner,source.homeKey??'',source.sessionId])
const safeId = (id:unknown):id is string => typeof id==='string' && /^[A-Za-z0-9_-]{1,160}$/.test(id)
type Completion = {turnId:string;kind:'Stop'|'Interrupt';text:string;at:number;truncated:boolean}
type Request = {owner:number;source:CodexTimingSource;wanted:Set<string>;valid():boolean;complete?:(value:Completion)=>void}
type Subscription = {request:Request;watcher?:FSWatcher|undefined;path?:string;timer?:ReturnType<typeof setTimeout>|undefined;busy:boolean;again:boolean}

/** Event-driven local projection. Only already-authorized turns in an exact bound rollout
 * are eligible. Public commentary is separate from terminal events and never cloud-uploaded.
 * Native indexes/cursors are private to this account; no Hook command or trust is changed. */
export class TeamCodexLiveUpdates {
  private readonly locator:TeamCodexTurnTimingReader
  private readonly subscriptions=new Map<string,Subscription>()
  private epoch=0
  private work=new Set<Promise<void>>()
  constructor(private readonly db:DatabaseSync,home?:string) {
    this.locator=new TeamCodexTurnTimingReader(home)
    db.exec(`CREATE TABLE IF NOT EXISTS codex_live_cursors (
      scope TEXT PRIMARY KEY,identity TEXT NOT NULL,offset INTEGER NOT NULL,turn TEXT NOT NULL,skipping INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS codex_live_messages (
      scope TEXT NOT NULL,turn TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,text TEXT NOT NULL,at INTEGER NOT NULL,truncated INTEGER NOT NULL,
      PRIMARY KEY(scope,turn,id));
      CREATE TABLE IF NOT EXISTS codex_live_spans (scope TEXT NOT NULL,turn TEXT NOT NULL,start INTEGER NOT NULL,captured INTEGER NOT NULL,PRIMARY KEY(scope,turn));
      CREATE TABLE IF NOT EXISTS codex_live_seeks(scope TEXT PRIMARY KEY,identity TEXT NOT NULL,end INTEGER NOT NULL);`)
  }
  fence():void {
    this.epoch++
    for(const sub of this.subscriptions.values()){sub.watcher?.close();if(sub.timer)clearTimeout(sub.timer)}
    this.subscriptions.clear()
  }
  async idle():Promise<void>{while(this.work.size)await Promise.all([...this.work])}
  schedule(owner:number,source:CodexTimingSource,events:readonly TeamCodexEvent[],valid:()=>boolean,complete?: (value:Completion)=>void):void {
    if(!safeId(source.sessionId)||!valid())return
    const key=scopeOf(owner,source),wanted=new Set(events.slice(-8).flatMap(event=>{
      const turn=source.turns?source.turns.get(event.turnId):event.turnId
      return safeId(turn)?[turn]:[]
    }))
    if(!wanted.size)return
    let sub=this.subscriptions.get(key)
    if(sub&&!complete&&sub.request.complete){this.run(key,sub);return}
    if(!sub){
      if(this.subscriptions.size>=16){const first=this.subscriptions.keys().next().value!;const old=this.subscriptions.get(first)!;old.watcher?.close();if(old.timer)clearTimeout(old.timer);this.subscriptions.delete(first)}
      sub={request:{owner,source,wanted,valid,...(complete?{complete}:{})},busy:false,again:false};this.subscriptions.set(key,sub)
    }else sub.request={owner,source,wanted,valid,...(complete?{complete}:{})}
    this.run(key,sub)
  }
  project(owner:number,source:CodexTimingSource,events:readonly TeamCodexEvent[]):TeamCodexEvent[] {
    const scope=scopeOf(owner,source)
    return events.map(event=>{
      if(event.kind!=='UserPromptSubmit')return event
      const turn=source.turns?source.turns.get(event.turnId):event.turnId
      if(!turn)return event
      const rows=this.db.prepare("SELECT * FROM codex_live_messages WHERE scope=? AND turn=? AND kind='commentary' ORDER BY at,id").all(scope,turn)
      const progress:TeamCodexProgress[]=rows.map(row=>({id:String(row.id),text:String(row.text),at:Number(row.at),truncated:row.truncated===1}))
      return progress.length?{...event,localProgress:progress}:event
    })
  }
  private wake(key:string,sub:Subscription):void {
    if(sub.timer)return // coalesce file writes, including tool-only activity
    sub.timer=setTimeout(()=>{sub.timer=undefined;this.run(key,sub)},750);sub.timer.unref()
  }
  private run(key:string,sub:Subscription):void {
    if(this.subscriptions.get(key)!==sub||!sub.request.valid())return
    if(sub.busy){sub.again=true;return}
    const epoch=this.epoch,request=sub.request
    const valid=()=>epoch===this.epoch&&this.subscriptions.get(key)===sub&&request.valid()
    sub.busy=true
    const job=this.scan(scopeOf(request.owner,request.source),key,sub,request,valid).catch(()=>{/* next file event / existing poll retries */}).finally(()=>{
      sub.busy=false;this.work.delete(job)
      if(sub.again&&valid()){sub.again=false;this.wake(key,sub)}
    })
    this.work.add(job)
  }
  private deliver(scope:string,request:Request,valid:()=>boolean):void {
    if(!valid())return
    for(const turn of request.wanted){
      const rows=this.db.prepare("SELECT * FROM codex_live_messages WHERE scope=? AND turn=? AND kind IN ('Stop','Interrupt') ORDER BY at").all(scope,turn)
      for(const row of rows)request.complete?.({turnId:turn,kind:row.kind as Completion['kind'],text:String(row.text),at:Number(row.at),truncated:row.truncated===1})
    }
  }
  private async scan(scope:string,key:string,sub:Subscription,request:Request,valid:()=>boolean):Promise<void> {
    const path=this.locator.location(request.source)
    if(!path||!valid())return
    if(sub.path!==path||!sub.watcher){
      sub.watcher?.close();sub.path=path
      try{sub.watcher=watch(path,{persistent:false},()=>this.wake(key,sub));sub.watcher.on('error',()=>{sub.watcher?.close();sub.watcher=undefined})}catch{/* bounded existing polling is the fallback */}
    }
    const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)
    try{
      const stat=await file.stat();if(!stat.isFile()||!valid())return
      const first=Buffer.alloc(Math.min(stat.size,65536));await file.read(first,0,first.length,0)
      const newline=first.indexOf(10);if(newline<0)return
      const meta=JSON.parse(first.subarray(0,newline).toString('utf8'))
      if(meta.type!=='session_meta'||meta.payload?.id!==request.source.sessionId)return
      const identity=`${stat.dev}:${stat.ino}`,saved=this.db.prepare('SELECT * FROM codex_live_cursors WHERE scope=?').get(scope)
      let offset=Number(saved?.offset??0),current=String(saved?.turn??''),skipping=!!saved?.skipping
      if(saved?.identity!==identity||offset>stat.size){
        offset=0;current='';skipping=false
        let indexed=false
        this.db.prepare('DELETE FROM codex_live_spans WHERE scope=?').run(scope)
        // Reuse a verified local image index, when available, to avoid rereading old gigabytes.
        if(this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='codex_image_spans'").get()&&this.db.prepare('SELECT identity FROM codex_image_cursors WHERE scope=?').get(JSON.stringify([request.owner,request.source.sessionId]))?.identity===identity){
          const spans=this.db.prepare('SELECT turn,start FROM codex_image_spans WHERE scope=? ORDER BY start').all(JSON.stringify([request.owner,request.source.sessionId]))
          const span=spans.find(row=>request.wanted.has(String(row.turn)))
          if(span){offset=Number(span.start);current=String(span.turn);indexed=true}
        }
        if(!indexed){
          // Long conversations can be gigabytes. Locate a recent authorized context from
          // the tail; never walk the entire prefix just to observe today's next reply.
          const seek=this.db.prepare('SELECT identity,end FROM codex_live_seeks WHERE scope=?').get(scope)
          const end=seek?.identity===identity?Math.min(stat.size,Number(seek.end)):stat.size
          const start=Math.max(0,end-BUDGET),buffer=Buffer.alloc(end-start)
          const {bytesRead}=await file.read(buffer,0,buffer.length,start),bytes=buffer.subarray(0,bytesRead)
          const first=start?bytes.indexOf(10)+1:0
          let found=start===0,pos=first,next:number
          while(first>=0&&(next=bytes.indexOf(10,pos))>=0){
            if(next-pos<MAX_LINE){
              const raw=bytes.subarray(pos,next).toString('utf8')
              if(/"type"\s*:\s*"(?:turn_context|task_started)"/.test(raw))try{
                const row=JSON.parse(raw),p=row.payload
                if((row.type==='turn_context'||row.type==='event_msg'&&p?.type==='task_started')&&request.wanted.has(p?.turn_id)&&(p.root_turn_id??p.turn_id)===p.turn_id)found=true
              }catch{/* partial or unknown metadata */}
            }
            pos=next+1
          }
          if(!valid())return
          if(!found){
            this.db.prepare('INSERT INTO codex_live_seeks VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET identity=excluded.identity,end=excluded.end').run(scope,identity,Math.max(0,Math.min(end-1,start+MAX_LINE)))
            sub.again=true;return
          }
          offset=start+(first>0?first:0);skipping=start>0&&first===0
          this.db.prepare('DELETE FROM codex_live_seeks WHERE scope=?').run(scope)
        }
      }
      // A Hook can arrive after native output. Replay only that previously indexed turn,
      // instead of losing progress already skipped before the prompt was authorized.
      for(const turn of request.wanted){
        const span=this.db.prepare('SELECT start FROM codex_live_spans WHERE scope=? AND turn=? AND captured=0').get(scope,turn)
        if(span&&Number(span.start)<offset){offset=Number(span.start);current='';skipping=false}
      }
      if(offset===stat.size){this.deliver(scope,request,valid);return}
      let carry=Buffer.alloc(0),position=offset,committed=offset,spent=0
      const put=this.db.prepare('INSERT OR IGNORE INTO codex_live_messages VALUES(?,?,?,?,?,?,?)')
      while(position<stat.size&&spent<BUDGET&&valid()){
        const buffer=Buffer.alloc(Math.min(CHUNK,stat.size-position)),{bytesRead}=await file.read(buffer,0,buffer.length,position)
        if(!bytesRead)break
        position+=bytesRead;spent+=bytesRead
        const data=Buffer.concat([carry,buffer.subarray(0,bytesRead)]),base=position-data.length
        let start=0,next:number
        while((next=data.indexOf(10,start))>=0){
          const length=next-start
          if(!skipping&&length<=MAX_LINE){
            const bytes=data.subarray(start,next),prefix=bytes.subarray(0,200).toString('utf8')
            if(/"type"\s*:\s*"(?:event_msg|turn_context|response_item)"/.test(prefix))try{
              const row=JSON.parse(bytes.toString('utf8')),p=row.payload,at=Date.parse(row.timestamp)
              if(row.type==='turn_context'||row.type==='event_msg'&&p?.type==='task_started'){
                current=safeId(p?.turn_id)&&(p.root_turn_id??p.turn_id)===p.turn_id?p.turn_id:''
                if(current)this.db.prepare('INSERT INTO codex_live_spans VALUES(?,?,?,?) ON CONFLICT(scope,turn) DO UPDATE SET captured=MAX(captured,excluded.captured)').run(scope,current,base+start,request.wanted.has(current)?1:0)
              }else if(Number.isFinite(at)){
                const eventTurn=row.type==='event_msg'&&safeId(p?.turn_id)&&(p.root_turn_id??p.turn_id)===p.turn_id?p.turn_id:current
                if(!eventTurn||!request.wanted.has(eventTurn)){start=next+1;committed=base+start;continue}
                let kind='',raw='',id=''
                if(row.type==='response_item'&&p?.type==='message'&&p.role==='assistant'&&p.phase==='commentary'&&(!p.status||p.status==='completed')&&(!p.recipient||p.recipient==='all')){
                  kind='commentary';raw=Array.isArray(p.content)?p.content.filter((c:{type?:string;text?:unknown})=>c.type==='output_text'&&typeof c.text==='string').map((c:{text:string})=>c.text).join('\n'):''
                  id=createHash('sha256').update(JSON.stringify([current,kind,p.id??null,at,raw])).digest('hex')
                }else if(row.type==='event_msg'&&p?.turn_id===eventTurn&&(p.root_turn_id??p.turn_id)===p.turn_id&&['task_complete','turn_aborted'].includes(p.type)){
                  kind=p.type==='task_complete'?'Stop':'Interrupt';raw=kind==='Stop'&&typeof p.last_agent_message==='string'?p.last_agent_message:'';id=kind
                }
                if(kind&&(raw.trim()||kind!=='commentary')){
                  const safe=codexImageSafeText(redactCodexQueueText(raw)),text=safe.slice(0,65536).replace(/[\uD800-\uDBFF]$/,'')
                  put.run(scope,eventTurn,id,kind,text,at,text!==safe?1:0)
                }
              }
            }catch{/* ignore incomplete/unsupported schema; never infer from prose */}
          }
          skipping=false;start=next+1;committed=base+start
        }
        carry=data.subarray(start)
        if(carry.length>MAX_LINE||skipping){carry=Buffer.alloc(0);skipping=true;committed=position}
      }
      if(!valid())return
      this.db.prepare('INSERT INTO codex_live_cursors VALUES(?,?,?,?,?) ON CONFLICT(scope) DO UPDATE SET identity=excluded.identity,offset=excluded.offset,turn=excluded.turn,skipping=excluded.skipping').run(scope,identity,committed,current,skipping?1:0)
      this.deliver(scope,request,valid)
      if(position<stat.size)sub.again=true // yield between bounded bootstrap chunks
    }finally{await file.close()}
  }
}
