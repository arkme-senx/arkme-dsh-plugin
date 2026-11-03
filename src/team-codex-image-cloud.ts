import { createHash } from 'node:crypto'
import {setImmediate} from 'node:timers/promises'
import type { DatabaseSync } from 'node:sqlite'
import type { TeamCodexCloudPort } from './team-codex-cloud.js'

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
type Image = {ref:string;width:number;height:number;image:Uint8Array|null;thumbnail:Uint8Array|null}
type Manifest = {version:number;items:{image_id:string;client_image_id:string;state:string}[]}
type Receipt = {signature:string;localSignature?:string;manifest:Manifest;complete:boolean}

/** Files owns transfer attempts. This receipt records the accepted message facet, never another asset owner. */
export class TeamCodexImageCloud {
  private busy = false
  private cursors = new Map<string, number>()
  constructor(private readonly db: DatabaseSync, private readonly port: TeamCodexCloudPort) {
    if (!(db.prepare('PRAGMA table_info(codex_cloud_events)').all() as {name:string}[]).some(c => c.name === 'image_receipt')) {
      db.exec("ALTER TABLE codex_cloud_events ADD COLUMN image_receipt TEXT NOT NULL DEFAULT ''")
    }
  }
  async sync(owner:number, team:string, eligible:ReadonlySet<string>, signal:AbortSignal):Promise<void> {
    if (this.busy || !this.port.bytes || !this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='codex_private_images'").get()) return
    this.busy = true
    const scope = JSON.stringify([owner,team]), cursor = this.cursors.get(scope) ?? 0
    try {
      // Advance through at most 32 metadata rows per tick. No full-history blob reads or turn scans.
      const messages = this.db.prepare(`SELECT e.rowid position,e.id,e.payload,e.version,e.image_receipt,
        t.local_id,t.id task,s.id source,ct.local_turn FROM codex_cloud_events e
        JOIN codex_cloud_tasks t ON e.task=t.id JOIN codex_cloud_sources s ON s.id=t.source
        JOIN codex_cloud_turns ct ON ct.task=t.id AND ct.seq=json_extract(e.payload,'$.turn_seq')
        WHERE s.owner=? AND s.local_team=? AND e.ack=e.version AND e.blocked='' AND e.rowid>?
        AND json_extract(e.payload,'$.kind') IN ('UserPromptSubmit','Stop') ORDER BY e.rowid LIMIT 32`).all(owner,team,cursor)
      let budget = 4
      for (const message of messages) {
        signal.throwIfAborted()
        this.cursors.set(scope, Number(message.position))
        if (!eligible.has(String(message.local_id))) continue
        const payload = JSON.parse(String(message.payload)) as {kind:string;message_seq?:number}
        const local = this.db.prepare(`SELECT t.session_id session FROM codex_tasks t
          JOIN codex_installations i ON i.id=t.installation_id WHERE t.id=? AND i.user_id=? AND i.team_ref=?
          AND i.status='active' AND t.excluded=0 AND t.deleted=0
          UNION SELECT session_id FROM connections WHERE id=? AND user_id=? AND team_ref=? AND status='active'`)
          .get(String(message.local_id),owner,team,String(message.local_id),owner,team)
        if (!local?.session) continue
        const args = [owner,String(local.session),String(message.local_turn),payload.kind] as const
        const metadata = this.db.prepare(`SELECT ref,source_hash,width,height,image IS NOT NULL AND thumbnail IS NOT NULL ready
          FROM codex_private_images WHERE owner=? AND session=? AND turn=? AND kind=? AND message_seq=? ORDER BY ordinal LIMIT 32`).all(...args,payload.message_seq??0)
        let old:Receipt|undefined
        try { old = JSON.parse(String(message.image_receipt)) } catch { /* No accepted facet yet. */ }
        if (!metadata.length && !old) continue
        const localSignature = JSON.stringify(metadata)
        if (old?.complete && old.localSignature === localSignature) continue
        if (budget <= 0) { this.cursors.set(scope, Number(message.position)-1); break }
        budget--
        try {
          const readImage = this.db.prepare(`SELECT ref,width,height,image,thumbnail FROM codex_private_images
            WHERE owner=? AND session=? AND turn=? AND kind=? AND ref=?`)
          const declarations:Record<string,unknown>[]=[]
          for(const item of metadata){
            signal.throwIfAborted()
            // Read one original/thumbnail pair at a time: 32 maximum-sized images must not
            // allocate the whole message in the desktop Host heap.
            const image=readImage.get(...args,String(item.ref)) as unknown as Image|undefined
            if(!image)throw Error('图片清单已变化')
            declarations.push(image.image&&image.thumbnail?
              {client_image_id:image.ref,sha256:hash(image.image),size:image.image.byteLength,thumbnail_sha256:hash(image.thumbnail),thumbnail_size:image.thumbnail.byteLength,width:image.width,height:image.height}:
              {client_image_id:image.ref,state:'unavailable',width:image.width,height:image.height})
            await setImmediate(undefined,{signal})
          }
          const signature = JSON.stringify(declarations)
          const target = {source_id:String(message.source),task_id:String(message.task),event_id:String(message.id)}
          const manifest = old?.signature === signature ? old.manifest : await this.port.post<Manifest>(owner,
            '/api/v1/team-codex/images/prepare', {...target,event_version:Number(message.version),base_revision:old?.manifest.version??0,images:declarations},signal)
          signal.throwIfAborted()
          if (!Number.isSafeInteger(manifest.version) || !Array.isArray(manifest.items) || manifest.items.length !== metadata.length) throw Error('图片清单未确认')
          const save = (complete:boolean) => this.db.prepare('UPDATE codex_cloud_events SET image_receipt=? WHERE id=?')
            .run(JSON.stringify({signature,localSignature,manifest,complete}),String(message.id))
          save(false)
          for (const item of metadata) {
            const image=readImage.get(...args,String(item.ref)) as unknown as Image|undefined
            if(!image)throw Error('图片清单已变化')
            const entry = manifest.items.find(item => item.client_image_id === image.ref)
            if (!entry) throw Error('图片归属未确认')
            if (entry.state === 'ready' || entry.state === 'unavailable') continue
            if (!image.image || !image.thumbnail) throw Error('图片清单状态不一致')
            for (const variant of ['original','thumbnail'] as const) {
              signal.throwIfAborted()
              await this.port.bytes(owner,'/api/v1/team-codex/images/upload',variant==='original'?image.image:image.thumbnail,
                {'X-Codex-Source-ID':target.source_id,'X-Codex-Task-ID':target.task_id,'X-Codex-Event-ID':target.event_id,
                  'X-Codex-Image-ID':entry.image_id,'X-Codex-Image-Variant':variant},signal)
            }
          }
          signal.throwIfAborted(); save(true)
        } catch {
          signal.throwIfAborted()
          // Keep the durable accepted receipt. A failed message cannot starve another message/source.
        }
      }
      if (messages.length < 32 && budget > 0) this.cursors.set(scope,0)
      if (this.cursors.size > 64) this.cursors.delete(this.cursors.keys().next().value!)
    } finally { this.busy = false }
  }
}
