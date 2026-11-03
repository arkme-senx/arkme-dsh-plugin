import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { TeamCodexEvent, TeamCodexEventPage, TeamCodexTask, TeamCodexTurnTiming } from './team-codex-contract.js'
import { codexImageSafeText } from './team-codex-image-text.js'
import { codexEventPhase } from './team-codex-contract.js'
import { codexPromptText } from './team-codex-prompt-text.js'

export interface CloudEvent {
  event_id: string; version: number; turn_id: string; turn_seq: number
  kind: TeamCodexEvent['kind']; text: string; at: number; truncated: boolean; message_seq:number; timing?:TeamCodexTurnTiming
}
export interface CloudTask {
  task_id: string; version: number; project_key: string; project_name: string; task_title: string; branch: string; events: CloudEvent[];classification?:TeamCodexTask['classification']
}
export interface CloudBatch extends Record<string, unknown> {
  expected_owner_ref: string; team_ref: string; source_id: string; source_name: string; tasks: CloudTask[]
}
interface Source { id: string; owner: number; local_team: string; local_source: string; team: string; name: string }
export const DEFAULT_CODEX_SOURCE_NAME = '本机 Codex'
export function validCodexSourceName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value, 'utf8') <= 128
    && !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value)
}
interface TaskRow { id: string; local_id: string; source: string; payload: string; version: number; ack: number; blocked: string }
interface EventRow { id: string; task: string; slot: string; payload: string; version: number; ack: number; blocked: string }
const bytes = (s: string) => Buffer.byteLength(s, 'utf8')
export function clipUtf8(text: string, limit: number): string {
  if (bytes(text) <= limit) return text
  let result = '', size = 0
  for (const character of text) { size += bytes(character); if (size > limit) break; result += character }
  return result
}
const metadata = (text: string | undefined, limit: number) => clipUtf8((text ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' '), limit)
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
export const codexCloudTurnId = (turnId: string): string => digest(turnId)
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** Durable identity/version/ACK ledger. No credentials, queue snapshots, paths or tool logs. */
export class TeamCodexCloudJournal {
  private previousSource = ''
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS codex_cloud_sources (
      id TEXT PRIMARY KEY, owner INTEGER NOT NULL, local_team TEXT NOT NULL, local_source TEXT NOT NULL,
      team TEXT NOT NULL, name TEXT NOT NULL, UNIQUE(owner,local_team,local_source));
      CREATE TABLE IF NOT EXISTS codex_cloud_tasks (
      id TEXT PRIMARY KEY, local_id TEXT NOT NULL, source TEXT NOT NULL REFERENCES codex_cloud_sources(id),
      payload TEXT NOT NULL, version INTEGER NOT NULL, ack INTEGER NOT NULL DEFAULT 0, blocked TEXT NOT NULL DEFAULT '',
      UNIQUE(local_id,source));
      CREATE TABLE IF NOT EXISTS codex_cloud_turns (
      task TEXT NOT NULL REFERENCES codex_cloud_tasks(id), local_turn TEXT NOT NULL, seq INTEGER NOT NULL,
      PRIMARY KEY(task,local_turn), UNIQUE(task,seq));
      CREATE TABLE IF NOT EXISTS codex_cloud_events (
      id TEXT PRIMARY KEY, task TEXT NOT NULL REFERENCES codex_cloud_tasks(id), slot TEXT NOT NULL,
      payload TEXT NOT NULL, version INTEGER NOT NULL, ack INTEGER NOT NULL DEFAULT 0, blocked TEXT NOT NULL DEFAULT '',
      UNIQUE(task,slot));
      CREATE TABLE IF NOT EXISTS codex_cloud_source_confirmations (
      source TEXT PRIMARY KEY REFERENCES codex_cloud_sources(id), confirmed_at INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0, blocked TEXT NOT NULL DEFAULT '');`)
    const taskColumns = new Set((db.prepare('PRAGMA table_info(codex_cloud_tasks)').all() as {name:string}[]).map(c=>c.name))
    if(!taskColumns.has('local_read_cursor'))db.exec("ALTER TABLE codex_cloud_tasks ADD COLUMN local_read_cursor TEXT NOT NULL DEFAULT ''")
    if (!taskColumns.has('classification')) db.exec("ALTER TABLE codex_cloud_tasks ADD COLUMN classification TEXT NOT NULL DEFAULT ''")
    if (!taskColumns.has('classification_ack')) db.exec('ALTER TABLE codex_cloud_tasks ADD COLUMN classification_ack INTEGER NOT NULL DEFAULT 0')

    if(!taskColumns.has('content_revision')) {
      db.exec(`ALTER TABLE codex_cloud_tasks ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE codex_cloud_tasks ADD COLUMN content_count INTEGER NOT NULL DEFAULT 0;
        UPDATE codex_cloud_tasks SET content_count=(SELECT count(*) FROM codex_cloud_events WHERE task=codex_cloud_tasks.id);
        UPDATE codex_cloud_tasks SET content_revision=content_count;`)
    }
    const eventColumns=new Set(db.prepare('PRAGMA table_info(codex_cloud_events)').all().map(row=>String(row.name)))
    if(!eventColumns.has('turn_seq')){
      db.exec(`ALTER TABLE codex_cloud_events ADD COLUMN turn_seq INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE codex_cloud_events ADD COLUMN kind TEXT NOT NULL DEFAULT '';
        ALTER TABLE codex_cloud_events ADD COLUMN message_seq INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE codex_cloud_events ADD COLUMN phase INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE codex_cloud_events ADD COLUMN at INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE codex_cloud_events ADD COLUMN payload_bytes INTEGER NOT NULL DEFAULT 0;
        UPDATE codex_cloud_events SET turn_seq=json_extract(payload,'$.turn_seq'),kind=json_extract(payload,'$.kind'),message_seq=COALESCE(json_extract(payload,'$.message_seq'),0),
          phase=CASE json_extract(payload,'$.kind') WHEN 'Progress' THEN 1 WHEN 'Interrupt' THEN 2 WHEN 'Stop' THEN 3 ELSE 0 END,
          at=json_extract(payload,'$.at'),payload_bytes=length(CAST(payload AS BLOB));`)
    }
    if(!taskColumns.has('pending_count')){
      db.exec(`ALTER TABLE codex_cloud_tasks ADD COLUMN pending_count INTEGER NOT NULL DEFAULT 0;
       ALTER TABLE codex_cloud_tasks ADD COLUMN blocked_count INTEGER NOT NULL DEFAULT 0;
       UPDATE codex_cloud_tasks SET pending_count=(SELECT count(*) FROM codex_cloud_events WHERE task=codex_cloud_tasks.id AND ack<version AND blocked=''),
         blocked_count=(SELECT count(*) FROM codex_cloud_events WHERE task=codex_cloud_tasks.id AND blocked<>'');`)
    }
    db.exec(`CREATE INDEX IF NOT EXISTS codex_cloud_content_position ON codex_cloud_events(task,turn_seq,kind,message_seq);
      CREATE INDEX IF NOT EXISTS codex_cloud_content_latest ON codex_cloud_events(task,turn_seq DESC,phase DESC,message_seq DESC);
      CREATE INDEX IF NOT EXISTS codex_cloud_pending ON codex_cloud_events(task) WHERE ack<version AND blocked='';
      CREATE TRIGGER IF NOT EXISTS codex_cloud_content_insert AFTER INSERT ON codex_cloud_events BEGIN
        UPDATE codex_cloud_tasks SET content_count=content_count+1,content_revision=content_revision+1,
         pending_count=pending_count+(NEW.ack<NEW.version AND NEW.blocked=''),blocked_count=blocked_count+(NEW.blocked<>'') WHERE id=NEW.task; END;
      CREATE TRIGGER IF NOT EXISTS codex_cloud_content_update AFTER UPDATE OF payload ON codex_cloud_events BEGIN
        UPDATE codex_cloud_tasks SET content_revision=content_revision+1 WHERE id=NEW.task; END;
      CREATE TRIGGER IF NOT EXISTS codex_cloud_counters_update AFTER UPDATE OF version,ack,blocked ON codex_cloud_events BEGIN
        UPDATE codex_cloud_tasks SET pending_count=pending_count-(OLD.ack<OLD.version AND OLD.blocked='')+(NEW.ack<NEW.version AND NEW.blocked=''),
         blocked_count=blocked_count-(OLD.blocked<>'')+(NEW.blocked<>'') WHERE id=NEW.task; END;
      CREATE TABLE IF NOT EXISTS codex_cloud_budget(id INTEGER PRIMARY KEY CHECK(id=1),pending_bytes INTEGER NOT NULL);

      CREATE TRIGGER IF NOT EXISTS codex_cloud_budget_insert AFTER INSERT ON codex_cloud_events BEGIN
       UPDATE codex_cloud_budget SET pending_bytes=pending_bytes+CASE WHEN NEW.ack<NEW.version THEN NEW.payload_bytes ELSE 0 END WHERE id=1;
       SELECT CASE WHEN (SELECT pending_bytes FROM codex_cloud_budget WHERE id=1)>536870912 THEN RAISE(ABORT,'CODEX_OUTBOX_FULL') END; END;
      CREATE TRIGGER IF NOT EXISTS codex_cloud_budget_update AFTER UPDATE OF payload,version,ack ON codex_cloud_events BEGIN
       UPDATE codex_cloud_budget SET pending_bytes=pending_bytes-CASE WHEN OLD.ack<OLD.version THEN OLD.payload_bytes ELSE 0 END+CASE WHEN NEW.ack<NEW.version THEN NEW.payload_bytes ELSE 0 END WHERE id=1;
       SELECT CASE WHEN (SELECT pending_bytes FROM codex_cloud_budget WHERE id=1)>536870912 THEN RAISE(ABORT,'CODEX_OUTBOX_FULL') END; END;
      CREATE TRIGGER IF NOT EXISTS codex_cloud_budget_delete AFTER DELETE ON codex_cloud_events BEGIN
       UPDATE codex_cloud_budget SET pending_bytes=pending_bytes-CASE WHEN OLD.ack<OLD.version THEN OLD.payload_bytes ELSE 0 END WHERE id=1;
       UPDATE codex_cloud_tasks SET content_count=content_count-1,pending_count=pending_count-(OLD.ack<OLD.version AND OLD.blocked=''),blocked_count=blocked_count-(OLD.blocked<>'') WHERE id=OLD.task; END;`)
    if(!db.prepare('SELECT 1 FROM codex_cloud_budget WHERE id=1').get())db.exec('INSERT INTO codex_cloud_budget SELECT 1,COALESCE(SUM(payload_bytes),0) FROM codex_cloud_events WHERE ack<version')

  }

  source(owner: number, localTeam: string, team: string, localSource: string, sourceName = DEFAULT_CODEX_SOURCE_NAME): Source {
    const existing = this.db.prepare('SELECT id,owner,local_team,local_source,team,name FROM codex_cloud_sources WHERE owner=? AND local_team=? AND local_source=?').get(owner, localTeam, localSource) as unknown as Source | undefined
    if (existing) {
      if (existing.team !== team) throw new Error('ACCOUNT_OR_DESTINATION_MISMATCH')
      return existing
    }
    if (!validCodexSourceName(sourceName)) throw new Error('INVALID_PARAMETER')
    const row: Source = { id: randomUUID(), owner, local_team: localTeam, local_source:localSource, team, name: sourceName.trim() }
    this.db.prepare('INSERT INTO codex_cloud_sources(id,owner,local_team,local_source,team,name) VALUES(?,?,?,?,?,?)').run(row.id, owner, localTeam, localSource, team, row.name)
    return row
  }

  contentBlock(task:string,event:CloudEvent):CloudEvent[]{
    const controls=event.kind!=='Progress'&&event.kind!=='UserPromptSubmit'
    const first=event.kind==='Progress'?Math.floor((Number(event.message_seq)-1)/4)*4+1:1
    const rows=controls?this.db.prepare(`SELECT id,version,payload FROM codex_cloud_events WHERE task=? AND turn_seq=? AND kind=? LIMIT 1`).all(task,event.turn_seq,event.kind)
      :[
        ...(first===1?this.db.prepare(`SELECT id,version,payload FROM codex_cloud_events WHERE task=? AND turn_seq=? AND kind='UserPromptSubmit' LIMIT 1`).all(task,event.turn_seq):[]),
        ...this.db.prepare(`SELECT id,version,payload FROM codex_cloud_events WHERE task=? AND turn_seq=? AND kind='Progress' AND message_seq>=? AND message_seq<=? ORDER BY message_seq LIMIT 4`).all(task,event.turn_seq,first,first+3),
      ]
    return rows.map(row=>({...JSON.parse(String(row.payload)),event_id:String(row.id),version:Number(row.version)}))
  }

  contentSummary(task:string):{version:number;event_count:number;latest_at:number;state:string}{
    const row=this.db.prepare('SELECT content_revision,content_count FROM codex_cloud_tasks WHERE id=?').get(task)!
    const latest=this.db.prepare(`SELECT payload FROM codex_cloud_events WHERE task=? ORDER BY turn_seq DESC,
      phase DESC,
      message_seq DESC LIMIT 1`).get(task)
    const event=latest?JSON.parse(String(latest.payload)) as CloudEvent:undefined
    return {version:Number(row.content_revision),event_count:Number(row.content_count),latest_at:event?.at??Date.now(),state:event?.kind==='Stop'?'turn_ended':event?.kind==='Interrupt'?'interrupted':event?'in_progress':'empty'}
  }

  confirmationDue(source: string, now: number): boolean {
    const row = this.db.prepare('SELECT * FROM codex_cloud_source_confirmations WHERE source=?').get(source) as
      {confirmed_at:number;retry_at:number;blocked:string}|undefined
    return !row || !row.confirmed_at && !row.blocked && row.retry_at <= now
  }

  confirmSource(source: string, now: number): void {
    this.db.prepare(`INSERT INTO codex_cloud_source_confirmations(source,confirmed_at) VALUES(?,?)
      ON CONFLICT(source) DO UPDATE SET confirmed_at=excluded.confirmed_at,retry_at=0,blocked=''`).run(source,now)
  }

  failConfirmation(source: string, now: number, blocked: string): void {
    const row = this.db.prepare('SELECT attempts FROM codex_cloud_source_confirmations WHERE source=?').get(source) as {attempts:number}|undefined
    const attempts = (row?.attempts ?? 0) + 1
    const retryAt = now + Math.min(300_000,30_000 * 2 ** Math.min(attempts-1,4))
    this.db.prepare(`INSERT INTO codex_cloud_source_confirmations(source,attempts,retry_at,blocked) VALUES(?,?,?,?)
      ON CONFLICT(source) DO UPDATE SET attempts=excluded.attempts,retry_at=excluded.retry_at,blocked=excluded.blocked`).run(source,attempts,retryAt,blocked)
  }

  retryConfirmations(owner: number, localTeam: string): void {
    this.db.prepare(`UPDATE codex_cloud_source_confirmations SET attempts=0,retry_at=0,blocked=''
      WHERE confirmed_at=0 AND source IN (SELECT id FROM codex_cloud_sources WHERE owner=? AND local_team=?)`).run(owner,localTeam)
  }

  mapping(owner: number, team: string, localId: string): { taskId: string; sourceId: string; sourceName: string } | undefined {
    const rows = this.db.prepare(`SELECT t.id,s.id AS source,s.name FROM codex_cloud_tasks t JOIN codex_cloud_sources s ON s.id=t.source
      WHERE s.owner=? AND (?='self' OR s.local_team=?) AND t.local_id=? LIMIT 2`).all(owner, team, team, localId) as unknown as {id:string;source:string;name:string}[]
    const row = rows.length === 1 ? rows[0] : undefined
    return row && {taskId:row.id,sourceId:row.source,sourceName:row.name}
  }

  localReadCursor(owner:number,team:string,id:string):string|undefined {
    const row=this.db.prepare('SELECT t.local_read_cursor c FROM codex_cloud_tasks t JOIN codex_cloud_sources s ON s.id=t.source WHERE s.owner=? AND s.local_team=? AND t.local_id=?').get(owner,team,id)
    return row?.c?String(row.c):undefined
  }
  /** The ingestion callback runs inside reconcile's existing SQLite transaction. */
  saveLocalReadCursor(owner:number,team:string,id:string,cursor:string):void {
    this.db.prepare('UPDATE codex_cloud_tasks SET local_read_cursor=? WHERE local_id=? AND source IN (SELECT id FROM codex_cloud_sources WHERE owner=? AND local_team=?)').run(cursor,id,owner,team)
  }
  hasPendingTask(owner:number,team:string,id:string):boolean {
    return !!this.db.prepare(`SELECT 1 FROM codex_cloud_tasks t JOIN codex_cloud_sources s ON s.id=t.source WHERE s.owner=? AND (?='self' OR s.local_team=?) AND t.local_id=? AND (t.ack<t.version OR t.pending_count>0 OR t.blocked_count>0 OR t.blocked<>'') LIMIT 1`).get(owner,team,team,id)
  }
  /** Source-side canonical projection over the same durable ledger that device B consumes. */
  readPage(owner:number,team:string,localId:string,cursor='',window?:{after?:string;from?:string;through?:string}):TeamCodexEventPage|undefined {
    const mapping=this.mapping(owner,team,localId)
    if(!mapping)return
    type Position=[number,number,number,string]
    const decode=(value:string):Position=>{
      if(!value.startsWith('lc1_')||value.length>2048)throw Error('本机工作记录游标无效')
      let raw:unknown;try{raw=JSON.parse(Buffer.from(value.slice(4),'base64url').toString('utf8'))}catch{throw Error('本机工作记录游标无效')}
      if(!Array.isArray(raw)||raw.length!==6||raw[0]!==mapping.sourceId||raw[1]!==mapping.taskId||!Number.isSafeInteger(raw[2])||raw[2]<1||!Number.isSafeInteger(raw[3])||raw[3]<0||raw[3]>3||!Number.isSafeInteger(raw[4])||raw[4]<0||typeof raw[5]!=='string'||raw[5].length>128)throw Error('本机工作记录游标无效')
      return raw.slice(2) as Position
    }
    const tuple=`(CAST(turn_seq AS INTEGER),phase,CAST(message_seq AS INTEGER),id)`
    const forward=!!(window?.after||window?.from||window?.through),where=['task=?'],args:(string|number)[]=[mapping.taskId]
    const bound=(value:string|undefined,operator:string)=>{if(value){where.push(`${tuple} ${operator} (?,?,?,?)`);args.push(...decode(value))}}
    bound(window?.after,'>');bound(window?.from,'>=');bound(window?.through,'<=');bound(cursor,forward?'>':'<')
    const order=forward?'ASC':'DESC'
    const rows=this.db.prepare(`SELECT id,payload,version FROM codex_cloud_events WHERE ${where.join(' AND ')} ORDER BY
      CAST(turn_seq AS INTEGER) ${order},
      phase ${order},
      CAST(message_seq AS INTEGER) ${order},id ${order} LIMIT 51`).all(...args)
    const more=rows.length>50,visible=rows.slice(0,50)
    if(!forward)visible.reverse()
    const items=visible.map(row=>{
      const event=JSON.parse(String(row.payload)) as CloudEvent,phase=codexEventPhase(event.kind)
      return {sequence:event.turn_seq*4+phase,eventId:String(row.id),version:Number(row.version),turnSequence:event.turn_seq,messageSequence:event.message_seq,
        turnId:event.turn_id,kind:event.kind,text:event.text,at:event.at,truncated:event.truncated,...(event.timing?{timing:event.timing}:{}),
        cursor:'lc1_'+Buffer.from(JSON.stringify([mapping.sourceId,mapping.taskId,event.turn_seq,phase,event.message_seq,String(row.id)])).toString('base64url')}
    })
    return {items,firstCursor:items[0]?.cursor??'',latestCursor:items.at(-1)?.cursor??'',...(more?{nextCursor:(forward?items.at(-1):items[0])!.cursor}:{})}
  }
  originalTurns(owner:number,team:string,localId:string,wanted:readonly string[]):Map<string,string>{
    const mapping=this.mapping(owner,team,localId),turns=new Map<string,string>(),ids=new Set(wanted)
    if(!mapping)return turns
    for(const row of this.db.prepare('SELECT local_turn FROM codex_cloud_turns WHERE task=?').all(mapping.taskId)){
      const turn=String(row.local_turn),hash=codexCloudTurnId(turn);if(ids.has(hash))turns.set(hash,turn)
    }
    return turns
  }

  forget(owner: number, team: string, localId: string): void {
    const mapping = this.mapping(owner, team, localId)
    if (!mapping) return
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('DELETE FROM codex_cloud_events WHERE task=?').run(mapping.taskId)
      this.db.prepare('DELETE FROM codex_cloud_turns WHERE task=?').run(mapping.taskId)
      if(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='codex_cloud_queue_outbox'").get()) {
        this.db.prepare('DELETE FROM codex_cloud_queue_outbox WHERE task=?').run(mapping.taskId)
      }
      this.db.prepare('DELETE FROM codex_cloud_tasks WHERE id=?').run(mapping.taskId)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  reconcile(owner: number, localTeam: string, team: string, tasks: readonly TeamCodexTask[], events: (task: TeamCodexTask) => TeamCodexEvent[], sourceName = DEFAULT_CODEX_SOURCE_NAME): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const task of tasks) {
        // Local v1 -> machine-wide migration must retain the original cloud identity/source.
        const hasMigrations = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='codex_legacy_migrations'").get()
        const migrated = hasMigrations ? this.db.prepare(`SELECT c.* FROM codex_cloud_tasks c JOIN codex_cloud_sources s ON s.id=c.source
          JOIN codex_legacy_migrations m ON m.connection_id=c.local_id WHERE m.task_id=? AND s.owner=? AND s.local_team=? LIMIT 1`).get(task.id,owner,localTeam) as unknown as TaskRow|undefined : undefined
        if(migrated) this.db.prepare('UPDATE codex_cloud_tasks SET local_id=? WHERE id=?').run(task.id,migrated.id)
        const retained = this.db.prepare(`SELECT s.* FROM codex_cloud_tasks c JOIN codex_cloud_sources s ON s.id=c.source
          WHERE c.local_id=? AND s.owner=? AND s.local_team=?`).get(task.id,owner,localTeam) as unknown as Source|undefined
        const source = retained ?? this.source(owner, localTeam, team, task.installationId ?? task.id, sourceName)
        if(source.team!==team) throw new Error('ACCOUNT_OR_DESTINATION_MISMATCH')
        let row = this.db.prepare('SELECT * FROM codex_cloud_tasks WHERE local_id=? AND source=?').get(task.id, source.id) as unknown as TaskRow | undefined
        const payload = JSON.stringify({ project_key: metadata(task.projectKey || 'unknown', 1024), project_name: metadata(task.projectName, 256), task_title: metadata(task.title, 1024), branch: metadata(task.branch, 256) })
        if (!row) {
          row = { id: randomUUID(), local_id: task.id, source: source.id, payload, version: 1, ack: 0, blocked: '' }
          this.db.prepare('INSERT INTO codex_cloud_tasks(id,local_id,source,payload,version) VALUES(?,?,?,?,1)').run(row.id, task.id, source.id, payload)
        } else if (row.payload !== payload && !row.blocked) {
          this.db.prepare('UPDATE codex_cloud_tasks SET payload=?,version=version+1 WHERE id=?').run(payload, row.id)
        }
        if(task.classification)this.classify(row.id,task.classification.kind,task.classification.evidence)
        // Backfill in original chronology. Later turns receive a stable, never-reused sequence.
        const all=events(task)
        const expanded:TeamCodexEvent[]=all.flatMap(e=>[e,...(e.localProgress??[]).map((p,index)=>({sequence:e.sequence,turnId:e.turnId,kind:'Progress' as const,text:p.text,at:p.at,truncated:p.truncated,eventId:p.id,...(p.sourceSequence?{messageSequence:p.sourceSequence}:{})}))])
        const ordered = expanded.sort((a, b) => a.at - b.at || a.sequence - b.sequence)
        for (const event of ordered) {
          const localTurn = event.turnId
          let turn = this.db.prepare('SELECT seq FROM codex_cloud_turns WHERE task=? AND local_turn=?').get(row.id, localTurn) as { seq: number } | undefined
          if (!turn) {
            const { seq } = this.db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS seq FROM codex_cloud_turns WHERE task=?').get(row.id) as { seq: number }
            turn = { seq }
            this.db.prepare('INSERT INTO codex_cloud_turns VALUES(?,?,?)').run(row.id, localTurn, seq)
          }
          const slot = digest(JSON.stringify(event.kind==='Progress'?[localTurn,event.kind,event.eventId]:[localTurn,event.kind]))
          const previous = this.db.prepare('SELECT * FROM codex_cloud_events WHERE task=? AND slot=?').get(row.id, slot) as unknown as EventRow | undefined
          const oldPayload = previous ? JSON.parse(previous.payload) as CloudEvent : undefined
          const safe = codexImageSafeText(event.text)
          const sharedText = event.kind==='UserPromptSubmit'?codexImageSafeText(codexPromptText(event.text)):safe
          const text = clipUtf8(sharedText, 256 * 1024)
          const messageSeq=event.kind==='Progress'?(oldPayload?.message_seq??event.messageSequence??Number(this.db.prepare("SELECT COALESCE(MAX(message_seq),0)+1 n FROM codex_cloud_events WHERE task=? AND turn_seq=? AND kind='Progress'").get(row.id,turn.seq)!.n)):0
          const eventPayload = JSON.stringify({ message_seq:messageSeq,...(event.timing?{timing:event.timing}:{}),turn_id: codexCloudTurnId(localTurn), turn_seq: turn.seq, kind: event.kind,
            text, at: oldPayload?.at ?? event.at, truncated: event.truncated || text !== sharedText })
          if (!previous) this.db.prepare('INSERT INTO codex_cloud_events(id,task,slot,payload,version,turn_seq,kind,message_seq,phase,at,payload_bytes) VALUES(?,?,?,?,1,?,?,?,?,?,?)').run(randomUUID(), row.id, slot, eventPayload,turn.seq,event.kind,messageSeq,codexEventPhase(event.kind),event.at,bytes(eventPayload))
          else if (previous.payload !== eventPayload && !previous.blocked) this.db.prepare('UPDATE codex_cloud_events SET payload=?,payload_bytes=?,version=version+1 WHERE id=?').run(eventPayload,bytes(eventPayload),previous.id)
        }
      }
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }


  private classify(task:string,kind:'user'|'background',evidence:string):void {
    const row=this.db.prepare('SELECT classification FROM codex_cloud_tasks WHERE id=?').get(task)
    let previous:{version:number;kind:string;evidence:string}|undefined;try{previous=JSON.parse(String(row?.classification))}catch{}
    if(previous?.kind===kind&&previous.evidence===evidence)return
    this.db.prepare('UPDATE codex_cloud_tasks SET classification=? WHERE id=?').run(JSON.stringify({version:(previous?.version??0)+1,kind,evidence}),task)
  }
  classificationBatch(owner:number,localTeam:string):CloudBatch|undefined{
    if(this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='codex_session_visibility'").get()){
      const rows=this.db.prepare(`SELECT c.id,v.visibility FROM codex_cloud_tasks c JOIN codex_cloud_sources s ON s.id=c.source JOIN codex_tasks t ON t.id=c.local_id JOIN codex_session_visibility v ON v.installation_id=t.installation_id AND v.session_id=t.session_id
        WHERE s.owner=? AND s.local_team=? AND v.visibility IN ('user','internal')
        AND (c.classification='' OR json_extract(c.classification,'$.kind')<>CASE v.visibility WHEN 'user' THEN 'user' ELSE 'background' END
          OR json_extract(c.classification,'$.evidence')<>'native-persistent-root') ORDER BY c.rowid LIMIT 100`).all(owner,localTeam)
      for(const row of rows)this.classify(String(row.id),row.visibility==='user'?'user':'background','native-persistent-root')
    }
    const rows=this.db.prepare(`SELECT t.*,s.team,s.name FROM codex_cloud_tasks t JOIN codex_cloud_sources s ON s.id=t.source WHERE s.owner=? AND s.local_team=? AND t.classification<>'' AND t.classification_ack<json_extract(t.classification,'$.version') ORDER BY t.rowid LIMIT 100`).all(owner,localTeam)
    if(!rows.length)return
    const first=rows[0]!,tasks=rows.filter(row=>row.source===first.source).map(row=>({...JSON.parse(String(row.payload)),task_id:String(row.id),version:Number(row.version),events:[],classification:JSON.parse(String(row.classification))}))
    return {protocol_version:2,expected_owner_ref:String(owner),team_ref:String(first.team),source_id:String(first.source),source_name:String(first.name),tasks}
  }
  acknowledgeClassifications(batch:CloudBatch,raw:unknown):number{
    const response=object(raw);if(response.owner_ref!==batch.expected_owner_ref)throw Error('ACCOUNT_OR_DESTINATION_MISMATCH')
    const results=Array.isArray(response.task_results)?response.task_results.map(object):[];let count=0
    for(const task of batch.tasks){const candidates=results.filter(row=>row.task_id===task.task_id);if(candidates.length!==1)continue;const result=object(candidates[0]!.classification_result)
      if(['saved','unchanged'].includes(String(result.status))&&result.version===task.classification?.version){this.db.prepare('UPDATE codex_cloud_tasks SET classification_ack=MAX(classification_ack,?) WHERE id=?').run(Number(result.version),task.task_id);count++}
    };return count
  }
  private rows(owner:number,localTeam:string,eligible:ReadonlySet<string>):TaskRow[] {
    return this.db.prepare(`SELECT t.* FROM codex_cloud_tasks t JOIN codex_cloud_sources s ON s.id=t.source
      WHERE s.owner=? AND (?='self' OR s.local_team=?) AND t.local_id IN (SELECT value FROM json_each(?))
      AND ((t.ack<t.version AND t.blocked='') OR EXISTS(SELECT 1 FROM codex_cloud_events e WHERE e.task=t.id AND e.ack<e.version AND e.blocked=''))
      ORDER BY (t.source=?),t.rowid LIMIT 100`).all(owner,localTeam,localTeam,JSON.stringify([...eligible]),this.previousSource) as unknown as TaskRow[]
  }

  counts(owner:number,team:string,eligible?:ReadonlySet<string>):{pending:number;blocked:number} {
    const capture=!!this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='codex_tasks'").get()
    const sourceEligible=capture?` AND (EXISTS(SELECT 1 FROM codex_tasks c JOIN codex_installations i ON i.id=c.installation_id
      WHERE c.id=t.local_id AND i.user_id=s.owner AND i.team_ref=s.local_team AND i.status='active' AND c.excluded=0 AND c.deleted=0
      AND EXISTS(SELECT 1 FROM codex_session_visibility v WHERE v.installation_id=c.installation_id AND v.session_id=c.session_id AND v.visibility='user')
      AND NOT EXISTS(SELECT 1 FROM codex_project_exclusions p WHERE p.installation_id=c.installation_id AND p.project_key=c.project_key))
      OR EXISTS(SELECT 1 FROM connections c WHERE c.id=t.local_id AND c.user_id=s.owner AND c.team_ref=s.local_team AND c.status='active'
        AND NOT EXISTS(SELECT 1 FROM codex_legacy_migrations m WHERE m.connection_id=c.id)))`:''
    const where=`s.owner=? AND (?='self' OR s.local_team=?)${eligible?' AND t.local_id IN (SELECT value FROM json_each(?))':sourceEligible}`
    const params=eligible?[owner,team,team,JSON.stringify([...eligible])]:[owner,team,team]
    const row=this.db.prepare(`SELECT COALESCE(SUM((t.blocked<>'')+t.blocked_count),0) blocked,
      COALESCE(SUM((t.blocked='' AND t.ack<t.version)+t.pending_count),0) pending
      FROM codex_cloud_tasks t JOIN codex_cloud_sources s ON s.id=t.source WHERE ${where}`).get(...params)!
    const classification=this.db.prepare(`SELECT count(*) n FROM codex_cloud_tasks t JOIN codex_cloud_sources s ON s.id=t.source
      WHERE s.owner=? AND (?='self' OR s.local_team=?) AND t.classification<>'' AND t.classification_ack<json_extract(t.classification,'$.version')`).get(owner,team,team)
    return {pending:Number(row.pending)+Number(classification?.n??0),blocked:Number(row.blocked)}
  }

  batch(owner: number, localTeam: string, eligible: ReadonlySet<string>): CloudBatch | undefined {
    let batch: CloudBatch | undefined, count = 0
    const rows = this.rows(owner, localTeam, eligible)
    // A retrying device must not starve other sources belonging to this account/team.
    rows.sort((a, b) => Number(a.source === this.previousSource) - Number(b.source === this.previousSource))
    for (const row of rows) {
      if (batch && row.source !== batch.source_id) continue
      const events = this.db.prepare("SELECT * FROM codex_cloud_events WHERE task=? AND ack<version AND blocked='' ORDER BY rowid LIMIT 100").all(row.id) as unknown as EventRow[]
      if ((!events.length && (row.ack >= row.version || row.blocked))) continue
      if (!batch) {
        const source = this.db.prepare('SELECT * FROM codex_cloud_sources WHERE id=?').get(row.source) as unknown as Source
        batch = { protocol_version:2,expected_owner_ref: String(owner), team_ref: source.team, source_id: source.id, source_name: source.name, tasks: [] }
      }
      const task: CloudTask = { ...JSON.parse(row.payload), task_id: row.id, version: row.version, events: [] }
      batch.tasks.push(task)
      for (const event of events) {
        if (count === 100) break
        task.events.push({ ...JSON.parse(event.payload), event_id: event.id, version: event.version })
        if (bytes(JSON.stringify(batch)) > 1_048_576) { task.events.pop(); break }
        count++
      }
      if (bytes(JSON.stringify(batch)) > 1_048_576 || (!task.events.length && (row.ack >= row.version || row.blocked))) batch.tasks.pop()
      if (count === 100 || batch.tasks.length === 100) break
    }
    if (batch?.tasks.length) { this.previousSource = batch.source_id; return batch }
    return undefined
  }

  acknowledge(batch: CloudBatch, data: unknown): void {
    const response = object(data)
    if (response.owner_ref !== batch.expected_owner_ref) throw new Error('ACCOUNT_OR_DESTINATION_MISMATCH')
    const tasks = Array.isArray(response.task_results) ? response.task_results : []
    const events = Array.isArray(response.event_results) ? response.event_results : []
    const ack = (table: 'codex_cloud_tasks' | 'codex_cloud_events', id: string, version: number, matches: unknown[]) => {
      // Duplicate/missing ACKs are ambiguous: retry the same stable identity and version.
      if (matches.length !== 1) return
      const result = object(matches[0])
      if ((result.status === 'saved' || result.status === 'unchanged') && result.version === version) {
        this.db.prepare(`UPDATE ${table} SET ack=MAX(ack,?) WHERE id=?`).run(version, id)
      } else if (['stale', 'conflict'].includes(String(result.status)) || (result.status === 'rejected' && result.retryable !== true)) {
        this.db.prepare(`UPDATE ${table} SET blocked=? WHERE id=?`).run(String(result.error_code || result.status).slice(0, 128), id)
      }
    }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const task of batch.tasks) {
        ack('codex_cloud_tasks', task.task_id, task.version, tasks.filter(item => object(item).task_id === task.task_id))
        for (const event of task.events) ack('codex_cloud_events', event.event_id, event.version,
          events.filter(item => object(item).task_id === task.task_id && object(item).event_id === event.event_id))
      }
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
}
