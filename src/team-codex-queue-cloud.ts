import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { TeamCodexTask, TeamCodexQueueSnapshot } from './team-codex-contract.js'
import { clipUtf8, type TeamCodexCloudJournal, type CloudTask } from './team-codex-cloud-journal.js'
import { codexImageSafeText } from './team-codex-image-text.js'
import { codexPromptText } from './team-codex-prompt-text.js'
import { redactCodexQueueText } from './team-codex-desktop-queue.js'
import { codexCloudQueueWire, parseCodexCloudQueue, type CodexCloudQueueSnapshot } from './team-codex-queue-wire.js'

type Row = { task: string; signature: string; version: number; payload: string; observed: number; ack: number; ack_observed: number; blocked: string }
type QueueTask = CloudTask & { queue_snapshot?: CodexCloudQueueSnapshot; queue_heartbeat?: {version:number;observed_at:number} }
export interface CodexQueueBatch extends Record<string,unknown> {
  expected_owner_ref: string; team_ref: string; source_id: string; source_name: string; tasks: QueueTask[]
}
const object = (v:unknown):Record<string,unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string,unknown> : {}

/** Queue ACKs are independent of event ACKs. No queue bytes enter the legacy upload path. */
export class TeamCodexQueueCloud {
  constructor(private readonly db: DatabaseSync, private readonly journal:TeamCodexCloudJournal) {
    db.exec(`CREATE TABLE IF NOT EXISTS codex_cloud_queue_outbox (
      task TEXT PRIMARY KEY REFERENCES codex_cloud_tasks(id) ON DELETE CASCADE,
      signature TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,observed INTEGER NOT NULL,
      ack INTEGER NOT NULL DEFAULT 0,ack_observed INTEGER NOT NULL DEFAULT 0,blocked TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS codex_cloud_queue_cache (
      owner INTEGER NOT NULL,team TEXT NOT NULL,source TEXT NOT NULL,task TEXT NOT NULL,payload TEXT NOT NULL,
      PRIMARY KEY(owner,team,source,task));`)
  }
  reconcile(owner:number,team:string,tasks:readonly TeamCodexTask[]):void {
    for (const task of tasks) {
      const q=task.queue, mapping=this.journal.mapping(owner,team,task.id)
      if (!q || !mapping || task.status !== 'active' || task.excluded || task.projectExcluded || task.cloudBlocked) continue
      const items=q.items.map(item=>{
        const safe=codexImageSafeText(redactCodexQueueText(codexPromptText(item.text)))
        const text=clipUtf8(safe,4096)
        return {request_id:createHash('sha256').update(`${mapping.taskId}:${item.id}`).digest('hex'),text,created_at:item.createdAt,
          delivery:item.delivery,state:item.state,paused:item.paused,attachment_count:item.attachmentCount,truncated:item.truncated||safe!==text}
      })
      // JSON escaping can multiply UTF-8 size. Keep every request/count, shortening previews
      // instead of creating an oversized snapshot that can never leave the outbox.
      for(let limit=2048;Buffer.byteLength(JSON.stringify(items))>900_000 && limit>=1;limit=Math.floor(limit/2)) {
        for(const item of items) {
          const text=clipUtf8(item.text,limit)
          item.truncated ||= text!==item.text
          item.text=text
        }
      }
      const row=this.db.prepare('SELECT * FROM codex_cloud_queue_outbox WHERE task=?').get(mapping.taskId) as Row|undefined
      const signature=JSON.stringify([q.availability,q.reason,items])
      const changed=!row||row.signature!==signature
      const snapshot:CodexCloudQueueSnapshot={schema_version:1,visibility:'owner',version:(row?.version??0)+(changed?1:0),
        availability:q.availability,reason:q.reason,observed_at:q.checkedAt,changed_at:q.changedAt,source_at:q.sourceAt,items}
      if (!parseCodexCloudQueue(snapshot)) continue
      this.db.prepare(`INSERT INTO codex_cloud_queue_outbox(task,signature,version,payload,observed) VALUES(?,?,?,?,?)
        ON CONFLICT(task) DO UPDATE SET signature=excluded.signature,version=excluded.version,payload=excluded.payload,
        observed=MAX(observed,excluded.observed)`).run(mapping.taskId,signature,snapshot.version,
          changed ? JSON.stringify(snapshot) : row!.payload,q.checkedAt)
    }
  }
  batch(owner:number,team:string,eligible:ReadonlySet<string>):CodexQueueBatch|undefined {
    const rows=this.db.prepare(`SELECT q.*,t.local_id,t.source,t.payload AS metadata,t.version AS metadata_version,s.team,s.name
      FROM codex_cloud_queue_outbox q JOIN codex_cloud_tasks t ON t.id=q.task JOIN codex_cloud_sources s ON s.id=t.source
      WHERE s.owner=? AND s.local_team=? AND t.blocked='' AND q.blocked='' AND (q.ack<q.version OR q.observed-q.ack_observed>=60000)
      ORDER BY q.ack_observed,q.task`).all(owner,team) as unknown as (Row&{local_id:string;source:string;metadata:string;metadata_version:number;team:string;name:string})[]
    let batch:CodexQueueBatch|undefined
    for(const row of rows) {
      if(!eligible.has(row.local_id)||batch&&batch.source_id!==row.source)continue
      batch??={expected_owner_ref:String(owner),team_ref:row.team,source_id:row.source,source_name:row.name,tasks:[]}
      const snapshot=JSON.parse(row.payload) as CodexCloudQueueSnapshot
      const task:QueueTask={...JSON.parse(row.metadata),task_id:row.task,version:row.metadata_version,events:[],
        ...(row.ack<row.version ? {queue_snapshot:{...snapshot,observed_at:row.observed}} : {queue_heartbeat:{version:row.version,observed_at:row.observed}})}
      batch.tasks.push(task)
      if(Buffer.byteLength(JSON.stringify(batch))>1_048_576){batch.tasks.pop();break}
      if(batch.tasks.length>=50)break
    }
    return batch?.tasks.length?batch:undefined
  }
  acknowledge(batch:CodexQueueBatch,value:unknown):boolean {
    const data=object(value)
    if(data.owner_ref!==batch.expected_owner_ref)throw new Error('ACCOUNT_OR_DESTINATION_MISMATCH')
    const results=Array.isArray(data.queue_results)?data.queue_results:[]
    let progress=false
    for(const task of batch.tasks) {
      const sent=task.queue_snapshot??task.queue_heartbeat!
      const matches=results.map(object).filter(row=>row.task_id===task.task_id)
      if(matches.length!==1)continue
      const result=matches[0]!
      if(result.version!==sent.version||result.observed_at!==sent.observed_at)continue
      if(['saved','unchanged'].includes(String(result.status))) {
        const updated=this.db.prepare(`UPDATE codex_cloud_queue_outbox SET ack=MAX(ack,?),ack_observed=MAX(ack_observed,?)
          WHERE task=? AND (ack<? OR ack_observed<?)`).run(sent.version,sent.observed_at,task.task_id,sent.version,sent.observed_at)
        progress||=Number(updated.changes)>0
      } else if(result.status==='snapshot_required' && task.queue_heartbeat) {
        // A server that lost its snapshot must request the full current state, not ACK a heartbeat.
        this.db.prepare('UPDATE codex_cloud_queue_outbox SET ack=0,ack_observed=0 WHERE task=? AND version=?').run(task.task_id,sent.version)
        progress=true
      } else if(['stale','conflict'].includes(String(result.status))||result.status==='rejected'&&result.retryable!==true) {
        this.db.prepare('UPDATE codex_cloud_queue_outbox SET blocked=? WHERE task=?').run(String(result.error_code||result.status).slice(0,128),task.task_id)
      }
    }
    return progress
  }
  /** Only call after an authenticated, owner-matching task row was returned. */
  read(owner:number,team:string,source:string,task:string,value:unknown,now=Date.now()):TeamCodexQueueSnapshot|undefined {
    const row=this.db.prepare('SELECT payload FROM codex_cloud_queue_cache WHERE owner=? AND team=? AND source=? AND task=?')
      .get(owner,team,source,task) as {payload:string}|undefined
    const old=row?parseCodexCloudQueue(JSON.parse(row.payload)):undefined
    const incoming=parseCodexCloudQueue(value)
    if(!incoming || incoming.checkedAt>now+60_000)return old?{...old,availability:'stale'}:undefined
    if(old&&(incoming.version<old.version||incoming.version===old.version&&incoming.checkedAt<old.checkedAt))return old
    if(old && incoming.version===old.version && incoming.availability==='ready' && old.availability==='ready'
      && JSON.stringify(incoming.items)!==JSON.stringify(old.items)) return {...old,availability:'stale'}
    // A partial/failed read must retain known rows instead of silently deleting them.
    if(old && incoming.availability!=='ready') {
      const known=new Set(incoming.items.map(item=>item.id))
      incoming.items=[...incoming.items,...old.items.filter(item=>!known.has(item.id))].slice(0,200)
    }
    this.db.prepare(`INSERT INTO codex_cloud_queue_cache VALUES(?,?,?,?,?) ON CONFLICT(owner,team,source,task) DO UPDATE SET payload=excluded.payload`)
      .run(owner,team,source,task,JSON.stringify(codexCloudQueueWire(incoming)))
    return incoming
  }
}
