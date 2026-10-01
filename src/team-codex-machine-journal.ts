import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { ArkmePluginError } from './services/service.js'
import type { ArkmeTeamMember } from './types.js'
import type { TeamCodexConnectionStatus, TeamCodexEventPage, TeamCodexInstallation, TeamCodexQueueSnapshot, TeamCodexTask } from './team-codex-contract.js'
import { TeamCodexDesktopQueueReader, type QueueObservation } from './team-codex-desktop-queue.js'
import { TeamCodexDesktopTitleReader } from './team-codex-desktop-titles.js'

interface Installation {
  id:string; user_id:number; team_ref:string; member_json:string; name:string; home_key:string|null
  status:TeamCodexConnectionStatus; generation:string; created_at:number; expires_at:number; updated_at:number
}
interface Task {
  id:string; installation_id:string; session_id:string; title:string; project_key:string; project_name:string
  cwd:string; branch:string; worktree:string; excluded:number; deleted:number; updated_at:number
}
interface EventRow {sequence:number;turn_id:string;kind:'UserPromptSubmit'|'Stop'|'Interrupt';text:string;at:number;truncated:number}
type Json = Record<string, unknown>
const idPattern = /^[0-9a-f-]{36}$/
const keyPattern = /^(?:[a-f0-9]{64}|unknown)$/
const sessionPattern = /^[A-Za-z0-9_-]{8,160}$/
const kinds = new Set(['UserPromptSubmit','Stop','Interrupt'])
const fail = (message:string,status=400):never => {throw new ArkmePluginError('team-codex-invalid',message,false,status)}

/** Installation != task. All data stays in the original account-scoped local journal. */
export class TeamCodexMachineJournal {
  private readonly queues: TeamCodexDesktopQueueReader
  private readonly titles: TeamCodexDesktopTitleReader
  constructor(private readonly db:DatabaseSync, private readonly directory:string, private readonly now:()=>number,
    private readonly read:(path:string)=>Json, private readonly write:(path:string,value:unknown)=>void, codexHome?:string) {
    this.queues = new TeamCodexDesktopQueueReader(codexHome)
    this.titles = new TeamCodexDesktopTitleReader(codexHome)
    db.exec(`CREATE TABLE IF NOT EXISTS codex_installations (
      id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,team_ref TEXT NOT NULL,member_json TEXT NOT NULL,
      name TEXT NOT NULL,home_key TEXT,status TEXT NOT NULL,generation TEXT NOT NULL,
      created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS codex_installation_owner ON codex_installations(user_id,team_ref);
      CREATE TABLE IF NOT EXISTS codex_tasks (
      id TEXT PRIMARY KEY,installation_id TEXT NOT NULL REFERENCES codex_installations(id),session_id TEXT NOT NULL,
      title TEXT NOT NULL,project_key TEXT NOT NULL,project_name TEXT NOT NULL,cwd TEXT NOT NULL,branch TEXT NOT NULL,
      worktree TEXT NOT NULL,excluded INTEGER NOT NULL DEFAULT 0,deleted INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL,
      UNIQUE(installation_id,session_id));
      CREATE TABLE IF NOT EXISTS codex_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL REFERENCES codex_tasks(id),turn_id TEXT NOT NULL,
      kind TEXT NOT NULL,text TEXT NOT NULL,at INTEGER NOT NULL,truncated INTEGER NOT NULL,UNIQUE(task_id,turn_id,kind));
      CREATE INDEX IF NOT EXISTS codex_task_events ON codex_events(task_id,sequence);
      CREATE TABLE IF NOT EXISTS codex_project_exclusions (
      installation_id TEXT NOT NULL REFERENCES codex_installations(id),project_key TEXT NOT NULL,name TEXT NOT NULL,
      PRIMARY KEY(installation_id,project_key));
      CREATE TABLE IF NOT EXISTS codex_legacy_migrations (connection_id TEXT PRIMARY KEY,task_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS codex_queue_snapshots (task_id TEXT PRIMARY KEY REFERENCES codex_tasks(id),
        version INTEGER NOT NULL,payload TEXT NOT NULL,checked_at INTEGER NOT NULL,changed_at INTEGER NOT NULL);`)
  }

  migratedIds():Set<string> {
    return new Set((this.db.prepare('SELECT connection_id FROM codex_legacy_migrations').all() as {connection_id:string}[]).map(r=>r.connection_id))
  }

  private installations(user:number,team?:string):Installation[] {
    return (team === undefined ? this.db.prepare('SELECT * FROM codex_installations WHERE user_id=? ORDER BY created_at DESC').all(user)
      : this.db.prepare('SELECT * FROM codex_installations WHERE user_id=? AND team_ref=? ORDER BY created_at DESC').all(user,team)) as unknown as Installation[]
  }

  private claim(row:Installation):Json|undefined {
    try {
      const claim=this.read(join(this.directory,row.id,'claim.json'))
      if(claim.version===2 && typeof claim.homeKey==='string' && /^[a-f0-9]{64}$/.test(claim.homeKey)
        && typeof claim.at==='number' && claim.at>=row.created_at && claim.at<=row.expires_at
        && (!row.home_key || row.home_key===claim.homeKey)) return claim
    } catch { /* Not enrolled yet. */ }
    return undefined
  }

  private effectiveStatus(row:Installation):TeamCodexConnectionStatus {
    return row.status==='pending' && row.expires_at<this.now() && !this.claim(row) ? 'expired' : row.status
  }

  private exclusions(id:string):{project_key:string;name:string}[] {
    return this.db.prepare('SELECT project_key,name FROM codex_project_exclusions WHERE installation_id=?').all(id) as {project_key:string;name:string}[]
  }

  private control(row:Installation):void {
    const excluded=this.db.prepare('SELECT session_id FROM codex_tasks WHERE installation_id=? AND (excluded=1 OR deleted=1)').all(row.id) as {session_id:string}[]
    this.write(join(this.directory,row.id,'control.json'),{version:2,userId:row.user_id,status:row.status,
      generation:row.generation,expiresAt:row.expires_at,excludedSessions:excluded.map(t=>t.session_id),
      excludedProjects:this.exclusions(row.id).map(p=>p.project_key)})
  }

  state(user:number,team:string):{installations:TeamCodexInstallation[];tasks:TeamCodexTask[]} {
    const installations=this.installations(user,team)
    const tasks:TeamCodexTask[]=[]
    for(const installation of installations) {
      const projects=new Set(this.exclusions(installation.id).map(p=>p.project_key))
      const rows=this.db.prepare(`SELECT t.*,COUNT(e.sequence) AS event_count,
        (SELECT kind FROM codex_events WHERE task_id=t.id ORDER BY at DESC,
          CASE kind WHEN 'UserPromptSubmit' THEN 0 WHEN 'Interrupt' THEN 1 ELSE 2 END DESC,sequence DESC LIMIT 1) AS latest_kind
        FROM codex_tasks t LEFT JOIN codex_events e ON e.task_id=t.id
        WHERE t.installation_id=? AND t.deleted=0 GROUP BY t.id ORDER BY t.updated_at DESC,t.id`).all(installation.id) as unknown as (Task&{event_count:number;latest_kind:string|null})[]
      for(const row of rows) {
        const queue = this.queueSnapshot(row.id)
        const input = row.latest_kind === 'UserPromptSubmit' ? this.db.prepare("SELECT turn_id,text,at FROM codex_events WHERE task_id=? AND kind='UserPromptSubmit' ORDER BY at DESC,sequence DESC LIMIT 1").get(row.id) as {turn_id:string;text:string;at:number}|undefined : undefined
        tasks.push({id:row.id,installationId:row.installation_id,title:row.title,
        projectKey:row.project_key,projectName:row.project_name,cwd:row.cwd,branch:row.branch,worktree:row.worktree,
        excluded:row.excluded===1,projectExcluded:projects.has(row.project_key),status:this.effectiveStatus(installation),
        state:row.latest_kind==='Stop'?'finished':row.latest_kind==='Interrupt'?'interrupted':row.latest_kind==='UserPromptSubmit'?'working':'waiting',
        updatedAt:row.updated_at,eventCount:row.event_count,member:JSON.parse(installation.member_json) as ArkmeTeamMember,
        ...(queue ? {queue} : {}), ...(input ? {currentInput:{turnId:input.turn_id,text:input.text.slice(0,240),at:input.at}} : {})})
      }
    }
    return {tasks,installations:installations.map(row=>({id:row.id,name:row.name,status:this.effectiveStatus(row),
      configured:!!this.claim(row),updatedAt:row.updated_at,excludedProjects:this.exclusions(row.id).map(p=>({key:p.project_key,name:p.name}))}))}
  }

  invite(user:number,team:string,member:ArkmeTeamMember):{id:string;expiresAt:number} {
    const existing=this.installations(user,team).find(row=>['pending','active','paused'].includes(this.effectiveStatus(row)))
    if(existing) {
      if(existing.status==='paused') fail('本机 Codex 已暂停，请先恢复同步',409)
      return {id:existing.id,expiresAt:existing.expires_at}
    }
    const now=this.now()
    const row:Installation={id:randomUUID(),user_id:user,team_ref:team,member_json:JSON.stringify(member),name:'Codex',home_key:null,
      status:'pending',generation:randomUUID(),created_at:now,expires_at:now+20*60_000,updated_at:now}
    mkdirSync(join(this.directory,row.id,'inbox'),{recursive:true,mode:0o700})
    chmodSync(join(this.directory,row.id),0o700)
    this.db.prepare(`INSERT INTO codex_installations(id,user_id,team_ref,member_json,name,home_key,status,generation,created_at,expires_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(row.id,user,team,row.member_json,row.name,null,row.status,row.generation,now,row.expires_at,now)
    this.control(row)
    return {id:row.id,expiresAt:row.expires_at}
  }

  /** Caller performs account/member checks before any action that resumes collection. */
  change(user:number,team:string,id:string,action:string,projectKey?:string):boolean {
    if(!idPattern.test(id)) return false
    const installation=this.installations(user,team).find(row=>row.id===id)
    if(installation) {
      if(projectKey!==undefined) {
        if(!keyPattern.test(projectKey) || !['exclude','include'].includes(action)) fail('项目操作无效')
        const task=this.db.prepare('SELECT project_name FROM codex_tasks WHERE installation_id=? AND project_key=? LIMIT 1').get(id,projectKey) as {project_name:string}|undefined
        if(!task) return fail('未找到当前设备的项目',404)
        if(action==='exclude') this.db.prepare('INSERT OR REPLACE INTO codex_project_exclusions VALUES(?,?,?)').run(id,projectKey,task.project_name)
        else this.db.prepare('DELETE FROM codex_project_exclusions WHERE installation_id=? AND project_key=?').run(id,projectKey)
      } else {
        if(!['pause','resume','disconnect'].includes(action)) fail('设备操作无效')
        if(action==='resume' && (installation.status!=='paused' || !this.claim(installation))) fail('请重新生成接入指令',409)
        if(action==='pause' && !['pending','active'].includes(installation.status)) fail('此连接无法暂停',409)
        installation.status=action==='pause'?'paused':action==='resume'?(installation.home_key?'active':'pending'):'disconnected'
      }
      this.rotate(installation)
      return true
    }
    const task=this.ownedTask(user,team,id)
    if(!task) return false
    if(projectKey!==undefined || !['exclude','include','delete'].includes(action)) fail('任务操作无效')
    if(task.deleted && action!=='delete') fail('本地记录已删除',404)
    this.db.prepare('UPDATE codex_tasks SET excluded=?,deleted=? WHERE id=?').run(action==='include'?0:1,action==='delete'?1:task.deleted,id)
    if(action==='delete') {
      this.db.prepare('DELETE FROM codex_events WHERE task_id=?').run(id)
      this.db.prepare('DELETE FROM codex_queue_snapshots WHERE task_id=?').run(id)
    }
    this.rotate(this.installations(user,team).find(row=>row.id===task.installation_id)!)
    return true
  }

  private rotate(row:Installation):void {
    row.generation=randomUUID()
    this.control(row)
    this.db.prepare('UPDATE codex_installations SET status=?,generation=? WHERE id=?').run(row.status,row.generation,row.id)
    this.captureQueues(row)
  }

  private ownedTask(user:number,team:string,id:string):Task|undefined {
    return this.db.prepare(`SELECT t.* FROM codex_tasks t JOIN codex_installations i ON i.id=t.installation_id
      WHERE t.id=? AND i.user_id=? AND i.team_ref=?`).get(id,user,team) as unknown as Task|undefined
  }

  events(user:number,team:string,id:string,before?:number):TeamCodexEventPage|undefined {
    const task=this.ownedTask(user,team,id)
    if(!task) return undefined
    if(task.deleted) fail('本地记录已删除',404)
    const rows=this.db.prepare('SELECT * FROM codex_events WHERE task_id=? AND sequence<? ORDER BY sequence DESC LIMIT 51').all(id,before??Number.MAX_SAFE_INTEGER) as unknown as EventRow[]
    const visible=rows.slice(0,50).reverse()
    return {items:visible.map(row=>({sequence:row.sequence,turnId:row.turn_id,kind:row.kind,text:row.text,at:row.at,truncated:row.truncated===1})),
      ...(rows.length>50?{nextBefore:visible[0]!.sequence}:{})}
  }

  ingest(user:number):void {
    for(const row of this.installations(user)) {
      if(!['pending','active'].includes(row.status)) continue
      const claim=this.claim(row)
      if(!claim) continue
      const folder=join(this.directory,row.id,'inbox')
      const entries=readdirSync(folder).filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).slice(0,1000).flatMap(file=>{
        const path=join(folder,file)
        try{return [{path,event:this.read(path)}]}catch{rmSync(path,{force:true});return []}
      }).sort((a,b)=>Number(a.event.at)-Number(b.event.at)||Number(a.event.kind!=='UserPromptSubmit')-Number(b.event.kind!=='UserPromptSubmit')).slice(0,100)
      let changed=false
      for(const {path,event} of entries) {
        if(this.valid(row,claim,event)) {
          // Once the explicitly authorized global connection actually works, retire ALL legacy
          // collectors for this member/team. Otherwise an old collector could bypass global pause.
          this.adoptLegacy(row)
          const p=event.project as Json
          let task=this.db.prepare('SELECT * FROM codex_tasks WHERE installation_id=? AND session_id=?').get(row.id,String(event.sessionId)) as unknown as Task|undefined
          const projectExcluded=this.exclusions(row.id).some(x=>x.project_key===p.key)
          if(!projectExcluded && !task?.excluded && !task?.deleted) {
            if(!task) {
              task={id:randomUUID(),installation_id:row.id,session_id:String(event.sessionId),title:'Codex',
                project_key:String(p.key),project_name:String(p.name),cwd:String(p.cwd),branch:String(p.branch),worktree:String(p.worktree),excluded:0,deleted:0,updated_at:Number(event.at)}
              this.db.prepare('INSERT INTO codex_tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(task.id,row.id,task.session_id,task.title,task.project_key,task.project_name,task.cwd,task.branch,task.worktree,0,0,task.updated_at)
            }
            if(!task.excluded) {
              const title=task.title
              this.db.prepare(`INSERT INTO codex_events(task_id,turn_id,kind,text,at,truncated) VALUES(?,?,?,?,?,?)
                ON CONFLICT(task_id,turn_id,kind) DO UPDATE SET text=excluded.text,at=excluded.at,truncated=excluded.truncated WHERE excluded.at>=codex_events.at`)
                .run(task.id,String(event.turnId),String(event.kind),String(event.text),Number(event.at),event.truncated===true?1:0)
              // Do not let late delivery move a task back to an old working directory.
              this.db.prepare('UPDATE codex_tasks SET title=? WHERE id=?').run(title,task.id)
              this.db.prepare('UPDATE codex_tasks SET title=?,project_key=?,project_name=?,cwd=?,branch=?,worktree=?,updated_at=? WHERE id=? AND updated_at<=?')
                .run(title,String(p.key),String(p.name),String(p.cwd),String(p.branch),String(p.worktree),event.at as number,task.id,event.at as number)
            }
            row.home_key=String(claim.homeKey);row.name=typeof claim.name==='string'?claim.name.slice(0,100):'Codex';row.status='active'
            row.updated_at=Math.max(row.updated_at,Number(event.at));changed=true
          }
        }
        rmSync(path,{force:true})
      }
      if(changed) {
        this.db.prepare("UPDATE codex_installations SET status='active',home_key=?,name=?,updated_at=? WHERE id=?").run(row.home_key,row.name,row.updated_at,row.id)
        this.control(row)
      }
      this.captureTitles(row)
      this.captureQueues(row)
    }
  }

  private queueSnapshot(taskId:string):TeamCodexQueueSnapshot|undefined {
    const row=this.db.prepare('SELECT * FROM codex_queue_snapshots WHERE task_id=?').get(taskId) as
      {version:number;payload:string;checked_at:number;changed_at:number}|undefined
    return row ? {...JSON.parse(row.payload) as QueueObservation,version:row.version,checkedAt:row.checked_at,changedAt:row.changed_at} : undefined
  }

  private captureTitles(installation:Installation):void {
    if(installation.status!=='active' || !installation.home_key) return
    const tasks=this.db.prepare(`SELECT t.* FROM codex_tasks t WHERE t.installation_id=? AND t.deleted=0 AND t.excluded=0
      AND NOT EXISTS (SELECT 1 FROM codex_project_exclusions p WHERE p.installation_id=t.installation_id AND p.project_key=t.project_key)
      AND NOT EXISTS (SELECT 1 FROM codex_tasks other JOIN codex_installations i ON i.id=other.installation_id
        WHERE other.session_id=t.session_id AND i.user_id<>?)
      AND NOT EXISTS (SELECT 1 FROM connections c WHERE c.session_id=t.session_id AND c.user_id<>?)`)
      .all(installation.id,installation.user_id,installation.user_id) as unknown as Task[]
    const names=this.titles.read(installation.home_key,tasks.map(task=>task.session_id))
    for(const task of tasks) {
      const name=names.get(task.session_id)
      // Metadata-only change: retain event timestamps, task identity and activity ordering.
      if(name!==undefined && name!==task.title) this.db.prepare('UPDATE codex_tasks SET title=? WHERE id=?').run(name,task.id)
    }
  }

  private captureQueues(installation:Installation):void {
    const tasks=this.db.prepare('SELECT * FROM codex_tasks WHERE installation_id=? AND deleted=0').all(installation.id) as unknown as Task[]
    const excluded=new Set(this.exclusions(installation.id).map(p=>p.project_key))
    // Read only sessions already bound through the trusted Hook. Never claim unrelated queues.
    const eligible=tasks.filter(task=>!task.excluded&&!excluded.has(task.project_key)&&installation.status==='active')
    const snapshots=this.queues.read(installation.home_key??'',eligible.map(t=>t.session_id),this.now())
    for(const task of tasks) {
      const previous=this.queueSnapshot(task.id)
      const ambiguous=this.db.prepare(`SELECT 1 FROM codex_tasks t JOIN codex_installations i ON i.id=t.installation_id
        WHERE t.session_id=? AND i.home_key=? AND i.user_id<>? LIMIT 1`).get(task.session_id,installation.home_key,installation.user_id)
      let observation:QueueObservation=ambiguous ? {availability:'unavailable',reason:'ambiguous-owner',sourceAt:null,items:[]}
        : snapshots.get(task.session_id)??{availability:'paused',reason:task.excluded||excluded.has(task.project_key)?'excluded':'paused',sourceAt:null,items:[]}
      // A failed read must not turn a previously observed queue into a false empty list.
      if(observation.availability==='unavailable'&&!ambiguous&&previous) observation={...observation,sourceAt:previous.sourceAt,items:previous.items}
      if(observation.availability==='partial'&&previous) {
        const known=new Set(observation.items.map(item=>item.id))
        observation={...observation,items:[...observation.items,...previous.items.filter(item=>!known.has(item.id))].slice(0,200)}
      }
      const payload=JSON.stringify(observation),now=this.now()
      // Unrelated desktop settings may change this file's mtime; only queue changes advance revision.
      const changed=!previous || JSON.stringify([observation.availability,observation.reason,observation.items])
        !==JSON.stringify([previous.availability,previous.reason,previous.items])
      this.db.prepare(`INSERT INTO codex_queue_snapshots VALUES(?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET
        version=excluded.version,payload=excluded.payload,checked_at=excluded.checked_at,changed_at=excluded.changed_at`)
        .run(task.id,(previous?.version??0)+(changed?1:0),payload,now,changed?now:previous!.changedAt)
    }
  }

  private adoptLegacy(installation:Installation):void {
    const legacy=this.db.prepare(`SELECT session_id,MAX(updated_at) AS updated_at FROM connections
      WHERE user_id=? AND team_ref=? AND session_id IS NOT NULL
      AND id NOT IN (SELECT connection_id FROM codex_legacy_migrations) GROUP BY session_id`)
      .all(installation.user_id,installation.team_ref) as {session_id:string;updated_at:number}[]
    for(const old of legacy) {
      let task=this.db.prepare('SELECT * FROM codex_tasks WHERE installation_id=? AND session_id=?').get(installation.id,old.session_id) as unknown as Task|undefined
      if(!task) {
        task={id:randomUUID(),installation_id:installation.id,session_id:old.session_id,title:'Codex',project_key:'unknown',project_name:'',cwd:'',branch:'',worktree:'',excluded:0,deleted:0,updated_at:old.updated_at}
        this.db.prepare('INSERT INTO codex_tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(task.id,installation.id,task.session_id,task.title,'unknown','','','','',0,0,task.updated_at)
      }
      this.migrateLegacy(installation,task)
    }
    if(legacy.length) this.control(installation)
  }

  private valid(row:Installation,claim:Json,event:Json):boolean {
    const p=event.project
    if(event.version!==2 || event.homeKey!==claim.homeKey || event.generation!==row.generation
      || typeof event.sessionId!=='string' || !sessionPattern.test(event.sessionId)
      || typeof event.turnId!=='string' || !/^[A-Za-z0-9_-]{1,160}$/.test(event.turnId) || !kinds.has(String(event.kind))
      || typeof event.text!=='string' || event.text.length>131072 || typeof event.at!=='number' || !Number.isSafeInteger(event.at)
      || event.at<Number(claim.at) || event.at>this.now()+5000 || !p || typeof p!=='object' || Array.isArray(p)) return false
    const project=p as Json
    return typeof project.key==='string' && keyPattern.test(project.key)
      && ['name','cwd','branch','worktree'].every(key=>typeof project[key]==='string' && (project[key] as string).length<=4096)
  }

  /** Preserve old records on the same session, and stop the old hook so it cannot bypass exclusions. */
  private migrateLegacy(installation:Installation,task:Task):void {
    const legacy=this.db.prepare(`SELECT * FROM connections WHERE user_id=? AND team_ref=? AND session_id=?
      AND id NOT IN (SELECT connection_id FROM codex_legacy_migrations)`).all(installation.user_id,installation.team_ref,task.session_id) as {id:string;status:string;title:string;expires_at:number}[]
    for(const old of legacy) {
      this.db.prepare(`INSERT OR IGNORE INTO codex_events(task_id,turn_id,kind,text,at,truncated)
        SELECT ?,turn_id,kind,text,at,truncated FROM events WHERE connection_id=? ORDER BY sequence`).run(task.id,old.id)
      if(task.title==='Codex' && old.title!=='Codex') task.title=old.title
      if(['paused','disconnected'].includes(old.status)) task.excluded=1
      const generation=randomUUID()
      if(existsSync(join(this.directory,old.id))) this.write(join(this.directory,old.id,'control.json'),{
        version:1,userId:installation.user_id,status:'disconnected',generation,expiresAt:old.expires_at})
      this.db.prepare("UPDATE connections SET status='disconnected',generation=? WHERE id=?").run(generation,old.id)
      this.db.prepare('INSERT INTO codex_legacy_migrations VALUES(?,?)').run(old.id,task.id)
    }
    if(legacy.length) this.db.prepare('UPDATE codex_tasks SET title=?,excluded=? WHERE id=?').run(task.title,task.excluded,task.id)
  }
}
