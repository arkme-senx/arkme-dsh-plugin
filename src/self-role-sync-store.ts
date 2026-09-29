import type { ArkmeUploadCompletion } from './services/media-service.js'
import type { DatabaseSync } from 'node:sqlite'
import type { ArkmeSelfRoleSnapshot } from './types.js'

export interface CloudSelfRoleSnapshot { role_id: string; name: string; avatar_file_asset_uid?: string }
export interface CloudSelfRole extends CloudSelfRoleSnapshot { name_at: number; avatar_at: number; deleted_at: number; version: number; deleted: boolean; update_at: number }
export interface SelfRoleWrite extends ArkmeSelfRoleSnapshot { nameAt: number; avatarAt: number; deletedAt: number }
interface Row { role_id: string; name: string; avatar_ref: string | null; name_at: number; avatar_at: number; deleted_at: number; cloud_payload: string | null }
const desired = (r: Row): SelfRoleWrite => ({roleId:r.role_id,name:r.name,...(r.avatar_ref ? {avatarRef:r.avatar_ref}:{}),nameAt:r.name_at,avatarAt:r.avatar_at,deletedAt:r.deleted_at})
const content = (w: SelfRoleWrite): string => JSON.stringify([w.roleId,w.name,w.avatarRef??'',w.nameAt,w.avatarAt,w.deletedAt])
const fromCloud = (r: CloudSelfRole): SelfRoleWrite => ({roleId:r.role_id,name:r.name,...(r.avatar_file_asset_uid ? {avatarRef:`file_asset://${r.avatar_file_asset_uid}`} : {}),nameAt:r.name_at,avatarAt:r.avatar_at,deletedAt:r.deleted_at})
const newer = (time: number,value:string,oldTime:number,oldValue:string) => time > oldTime || (time === oldTime && Buffer.compare(Buffer.from(value),Buffer.from(oldValue)) > 0)

/** Attribute timestamps make retries idempotent; no persisted request or conflict state. */
export class SelfRoleSyncStore {
  constructor(private readonly db: DatabaseSync, private readonly transaction: (action: () => void) => void) {
    const columns = new Set((db.prepare('PRAGMA table_info(self_role)').all() as Array<{name:string}>).map(r=>r.name))
    for (const [name,type] of Object.entries({deleted:'INTEGER NOT NULL DEFAULT 0',name_at:'INTEGER NOT NULL DEFAULT 0',avatar_at:'INTEGER NOT NULL DEFAULT 0',deleted_at:'INTEGER NOT NULL DEFAULT 0',cloud_payload:'TEXT'})) {
      if (!columns.has(name)) db.exec(`ALTER TABLE self_role ADD COLUMN ${name} ${type}`)
    }
    // Existing local-only roles become ordinary unsent attribute edits.
    db.exec('UPDATE self_role SET name_at=updated_at_millis,avatar_at=updated_at_millis WHERE name_at=0')
    const bindings = new Set((db.prepare('PRAGMA table_info(self_role_record)').all() as Array<{name:string}>).map(r=>r.name))
    if (!bindings.has('cloud_ack')) db.exec('ALTER TABLE self_role_record ADD COLUMN cloud_ack INTEGER NOT NULL DEFAULT 0')
    db.exec("CREATE TABLE IF NOT EXISTS self_role_avatar_asset (user_id INTEGER NOT NULL,local_ref TEXT NOT NULL,asset_uid TEXT NOT NULL DEFAULT '',completion_json TEXT,PRIMARY KEY(user_id,local_ref))")
  }
  dirtyRoleIds(userId:number):string[] {
    return (this.db.prepare('SELECT * FROM self_role WHERE user_id=? ORDER BY role_id').all(userId) as unknown as Row[]).filter(r=>r.cloud_payload!==content(desired(r))).map(r=>r.role_id)
  }
  isKnownRemotely(userId: number, roleId: string): boolean {
    return this.db.prepare('SELECT 1 FROM self_role WHERE user_id=? AND role_id=? AND cloud_payload IS NOT NULL').get(userId,roleId) !== undefined
  }
  next(userId:number,roleId?:string):SelfRoleWrite|undefined {
    const rows=this.db.prepare(`SELECT * FROM self_role WHERE user_id=? ${roleId===undefined?'':'AND role_id=?'} ORDER BY role_id`).all(...(roleId===undefined?[userId]:[userId,roleId])) as unknown as Row[]
    for(const row of rows){const op=desired(row);if(row.cloud_payload!==content(op))return op}
    return undefined
  }
  acknowledge(userId:number,role:CloudSelfRole):void {this.merge(userId,role)}
  merge(userId:number,role:CloudSelfRole):void {
    this.transaction(()=>{
      const row=this.db.prepare('SELECT * FROM self_role WHERE user_id=? AND role_id=?').get(userId,role.role_id) as unknown as Row|undefined
      const cloud=fromCloud(role)
      const local=row?desired(row):cloud
      const nameWins=newer(cloud.nameAt,cloud.name,local.nameAt,local.name)
      const avatarWins=newer(cloud.avatarAt,cloud.avatarRef??'',local.avatarAt,local.avatarRef??'') || (cloud.deletedAt>0 && cloud.avatarAt===local.avatarAt && !!local.avatarRef && !local.avatarRef.startsWith('file_asset://'))
      const name=nameWins?cloud.name:local.name,avatar=avatarWins?cloud.avatarRef:local.avatarRef
      const nameAt=Math.max(cloud.nameAt,local.nameAt),avatarAt=Math.max(cloud.avatarAt,local.avatarAt),deletedAt=Math.max(cloud.deletedAt,local.deletedAt)
      this.db.prepare(`INSERT INTO self_role(user_id,role_id,name,avatar_ref,created_at_millis,updated_at_millis,deleted,name_at,avatar_at,deleted_at,cloud_payload)
        VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,role_id) DO UPDATE SET name=excluded.name,avatar_ref=excluded.avatar_ref,updated_at_millis=excluded.updated_at_millis,deleted=excluded.deleted,name_at=excluded.name_at,avatar_at=excluded.avatar_at,deleted_at=excluded.deleted_at,cloud_payload=excluded.cloud_payload`)
        .run(userId,role.role_id,name,avatar??null,role.update_at,Math.max(nameAt,avatarAt,deletedAt),Number(deletedAt>0),nameAt,avatarAt,deletedAt,content(cloud))
    })
  }
  asset(userId: number,ref: string): string | undefined { return (this.db.prepare('SELECT asset_uid FROM self_role_avatar_asset WHERE user_id=? AND local_ref=?').get(userId,ref) as {asset_uid:string}|undefined)?.asset_uid }
  pendingAvatarCompletion(userId: number,ref: string): ArkmeUploadCompletion | undefined {
    const row = this.db.prepare('SELECT completion_json FROM self_role_avatar_asset WHERE user_id=? AND local_ref=?').get(userId,ref) as {completion_json:string|null}|undefined
    return row?.completion_json ? JSON.parse(row.completion_json) as ArkmeUploadCompletion : undefined
  }
  saveAvatarCompletion(userId:number,ref:string,completion:ArkmeUploadCompletion):void {
    this.db.prepare('INSERT INTO self_role_avatar_asset(user_id,local_ref,completion_json) VALUES(?,?,?) ON CONFLICT(user_id,local_ref) DO UPDATE SET completion_json=excluded.completion_json').run(userId,ref,JSON.stringify(completion))
  }
  saveAsset(userId: number,ref: string,uid: string): void {
    this.transaction(() => {
      this.db.prepare('INSERT INTO self_role_avatar_asset(user_id,local_ref,asset_uid) VALUES(?,?,?) ON CONFLICT(user_id,local_ref) DO UPDATE SET asset_uid=excluded.asset_uid,completion_json=NULL').run(userId,ref,uid)
      // Only avatar storage identity changes; frozen names/role IDs remain intact.
      this.db.prepare('UPDATE self_role SET avatar_ref=? WHERE user_id=? AND avatar_ref=?').run(`file_asset://${uid}`,userId,ref)
      this.db.prepare('UPDATE self_role_record SET avatar_ref=? WHERE user_id=? AND avatar_ref=?').run(`file_asset://${uid}`,userId,ref)
    })
  }
  pendingBindings(userId: number,after = ''): Array<{recordUid:string;snapshot:ArkmeSelfRoleSnapshot}> {
    return (this.db.prepare('SELECT record_uid,role_id,role_name,avatar_ref FROM self_role_record WHERE user_id=? AND cloud_ack=0 AND record_uid>? ORDER BY record_uid LIMIT 100').all(userId,after) as Array<{record_uid:string;role_id:string;role_name:string;avatar_ref:string|null}>).map(r=>({recordUid:r.record_uid,snapshot:{roleId:r.role_id,name:r.role_name,...(r.avatar_ref ? {avatarRef:r.avatar_ref}:{})}}))
  }
  cacheSnapshot(userId: number, recordUid: string, snapshot: ArkmeSelfRoleSnapshot): void {
    this.db.prepare(`INSERT INTO self_role_record(user_id,record_uid,role_id,role_name,avatar_ref,bound_at_millis,cloud_ack)
      VALUES(?,?,?,?,?,?,1) ON CONFLICT(user_id,record_uid) DO UPDATE SET role_id=excluded.role_id,role_name=excluded.role_name,avatar_ref=excluded.avatar_ref,cloud_ack=1`)
      .run(userId,recordUid,snapshot.roleId,snapshot.name,snapshot.avatarRef ?? null,Date.now())
  }
  acknowledgeBinding(userId: number,recordUid: string): void { this.db.prepare('UPDATE self_role_record SET cloud_ack=1 WHERE user_id=? AND record_uid=?').run(userId,recordUid) }
}

export function selfRoleSnapshotFromCloud(value: unknown): ArkmeSelfRoleSnapshot | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const r=value as Record<string,unknown>
  if (typeof r.role_id !== 'string' || !r.role_id || typeof r.name !== 'string' || !r.name) return undefined
  return {roleId:r.role_id,name:r.name,...(typeof r.avatar_file_asset_uid === 'string' && r.avatar_file_asset_uid ? {avatarRef:`file_asset://${r.avatar_file_asset_uid}`}:{})}
}
