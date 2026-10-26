import type { DatabaseSync } from 'node:sqlite'
import type { TeamCodexEventPage, TeamCodexTask } from './team-codex-contract.js'
import { codexInternalHistory } from './team-codex-task-visibility.js'

/** Transitional protection for old cloud rows. The backend still needs source classification
 * before pagination. Evidence is read through the existing ACL-checked events endpoint.
 * Never store raw prompts here and never delete cloud data or hide by title alone.
 */
export class TeamCodexRemoteTaskReview {
  private generation = 0
  private active = 0
  private readonly queued = new Map<string, () => Promise<void>>()
  private readonly running = new Set<string>()
  constructor(private readonly db: DatabaseSync, private readonly now = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS codex_remote_task_review (
      owner INTEGER NOT NULL, team TEXT NOT NULL, source TEXT NOT NULL, task TEXT NOT NULL,
      revision TEXT NOT NULL, verdict TEXT NOT NULL, checked_at INTEGER NOT NULL,
      PRIMARY KEY(owner,team,source,task))`)
  }
  fence():void { this.generation++;this.queued.clear() }

  visible(owner:number,team:string,task:TeamCodexTask,read:()=>Promise<TeamCodexEventPage>):'visible'|'hidden'|'checking' {
    const cloud=task.cloud
    if(!cloud?.remote || task.title!=='Codex' || task.eventCount>50) return 'visible'
    const revision=JSON.stringify([task.updatedAt,task.eventCount]),key=JSON.stringify([owner,team,cloud.sourceId,cloud.taskId,revision])
    const cached=this.db.prepare('SELECT * FROM codex_remote_task_review WHERE owner=? AND team=? AND source=? AND task=?')
      .get(owner,team,cloud.sourceId,cloud.taskId) as {revision:string;verdict:string;checked_at:number}|undefined
    const settled=cached?.revision===revision && cached.verdict!=='retry'
    // Older servers do not expose an event-content revision. Recheck periodically without
    // flickering a settled row so a same-time correction does not remain hidden forever.
    const age=this.now()-(cached?.checked_at??0)
    if(cached?.revision!==revision || age>(settled?30*60_000:30_000)) {
      if(!this.queued.has(key)&&!this.running.has(key)) {
        const generation=this.generation
        this.queued.set(key,async()=>{
          let verdict='retry'
          try {
            const page=await read()
            if(generation!==this.generation) return
            if(!page.nextCursor && page.items.length===task.eventCount) {
              verdict=codexInternalHistory(page.items)?'internal'
                : page.items.length>0 && page.items.every(e=>e.kind==='Interrupt'&&!e.text)?'orphan':'user'
            }
          } catch { if(generation!==this.generation)return }
          this.db.prepare(`INSERT INTO codex_remote_task_review VALUES(?,?,?,?,?,?,?)
            ON CONFLICT(owner,team,source,task) DO UPDATE SET revision=excluded.revision,verdict=excluded.verdict,checked_at=excluded.checked_at`)
            .run(owner,team,cloud.sourceId,cloud.taskId,revision,verdict,this.now())
        })
        this.pump()
      }
    }
    return settled ? cached.verdict==='user'?'visible':'hidden' : 'checking'
  }
  private pump():void {
    while(this.active<4 && this.queued.size) {
      const [key,run]=this.queued.entries().next().value!
      this.queued.delete(key);this.running.add(key);this.active++
      void run().catch(()=>undefined).finally(()=>{this.running.delete(key);this.active--;this.pump()})
    }
  }
}
