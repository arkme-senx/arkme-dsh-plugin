import type { ArkmeUploadCompletion } from './services/media-service.js'
import type { DatabaseSync } from 'node:sqlite'
import type { ArkmeSelfRoleSnapshot } from './types.js'

export interface CloudSelfRoleSnapshot { role_id: string; name: string; avatar_file_asset_uid?: string }
export interface CloudSelfRole extends CloudSelfRoleSnapshot { version: number; deleted: boolean; update_at: number }
export interface SelfRoleWrite extends ArkmeSelfRoleSnapshot { expectedVersion: number; deleted: boolean }
interface Row { role_id: string; name: string; avatar_ref: string | null; deleted: number; cloud_version: number; cloud_payload: string | null; pending_payload: string | null; sync_error: string | null }
const desired = (row: Row): SelfRoleWrite => ({ roleId: row.role_id, name: row.name, ...(row.avatar_ref ? { avatarRef: row.avatar_ref } : {}), deleted: row.deleted === 1, expectedVersion: row.cloud_version })
const content = (w: SelfRoleWrite): string => JSON.stringify([w.roleId, w.name, w.avatarRef ?? '', w.deleted])
const fromCloud = (r: CloudSelfRole): SelfRoleWrite => ({ roleId: r.role_id, name: r.name, ...(r.avatar_file_asset_uid ? { avatarRef: `file_asset://${r.avatar_file_asset_uid}` } : {}), expectedVersion: r.version, deleted: r.deleted })

/** Durable role operations belong to the role directory, never record_cache's message queue. */
export class SelfRoleSyncStore {
  constructor(private readonly db: DatabaseSync, private readonly transaction: (action: () => void) => void) {
    const columns = new Set((db.prepare('PRAGMA table_info(self_role)').all() as Array<{ name: string }>).map(r => r.name))
    for (const [name, type] of Object.entries({ deleted: 'INTEGER NOT NULL DEFAULT 0', cloud_version: 'INTEGER NOT NULL DEFAULT 0', cloud_payload: 'TEXT', pending_payload: 'TEXT', sync_error: 'TEXT' })) {
      if (!columns.has(name)) db.exec(`ALTER TABLE self_role ADD COLUMN ${name} ${type}`)
    }
    const bindings = new Set((db.prepare('PRAGMA table_info(self_role_record)').all() as Array<{ name: string }>).map(r => r.name))
    if (!bindings.has('cloud_ack')) db.exec('ALTER TABLE self_role_record ADD COLUMN cloud_ack INTEGER NOT NULL DEFAULT 0')
    db.exec(`CREATE TABLE IF NOT EXISTS self_role_avatar_asset (user_id INTEGER NOT NULL, local_ref TEXT NOT NULL, asset_uid TEXT NOT NULL DEFAULT '', completion_json TEXT, PRIMARY KEY(user_id,local_ref))`)
  }

  state(userId: number,roleId: string): {syncState: 'pending'|'synced'|'conflict';syncError?: string} | undefined {
    const row=this.db.prepare('SELECT * FROM self_role WHERE user_id=? AND role_id=?').get(userId,roleId) as unknown as Row
    if(!row)return undefined
    return row.sync_error ? {syncState:'conflict',syncError:row.sync_error} : {syncState:row.pending_payload !== null || row.cloud_payload !== content(desired(row)) ? 'pending':'synced'}
  }
  acceptRemote(userId:number,role:CloudSelfRole):void {
    this.transaction(()=>{
      this.db.prepare('UPDATE self_role SET name=?,avatar_ref=?,deleted=?,pending_payload=NULL,sync_error=NULL,cloud_version=?,cloud_payload=?,updated_at_millis=? WHERE user_id=? AND role_id=?').run(role.name,role.avatar_file_asset_uid ? `file_asset://${role.avatar_file_asset_uid}` : null,Number(role.deleted),role.version,content(fromCloud(role)),role.update_at,userId,role.role_id)
    })
  }

  next(userId: number, roleId?: string): SelfRoleWrite | undefined {
    const rows = this.db.prepare(`SELECT * FROM self_role WHERE user_id=? ${roleId === undefined ? '' : 'AND role_id=?'} ORDER BY role_id`).all(...(roleId === undefined ? [userId] : [userId, roleId])) as unknown as Row[]
    for (const row of rows) {
      if (row.sync_error) continue
      const operation = row.pending_payload === null ? desired(row) : JSON.parse(row.pending_payload) as SelfRoleWrite
      if (row.pending_payload === null && row.cloud_payload === content(operation)) continue
      if (row.pending_payload === null) this.db.prepare('UPDATE self_role SET pending_payload=? WHERE user_id=? AND role_id=?').run(JSON.stringify(operation),userId,row.role_id)
      return operation
    }
    return undefined
  }

  acknowledge(userId: number, role: CloudSelfRole): void {
    this.transaction(() => {
      if (role.deleted) this.db.prepare('UPDATE self_role SET name=?,avatar_ref=? WHERE user_id=? AND role_id=? AND deleted=1').run(role.name,role.avatar_file_asset_uid ? `file_asset://${role.avatar_file_asset_uid}` : null,userId,role.role_id)
      this.db.prepare('UPDATE self_role SET cloud_version=?,cloud_payload=?,pending_payload=NULL,sync_error=NULL WHERE user_id=? AND role_id=?').run(role.version, content(fromCloud(role)), userId, role.role_id)
    })
  }

  merge(userId: number, role: CloudSelfRole): void {
    this.transaction(() => {
      const local = this.db.prepare('SELECT * FROM self_role WHERE user_id=? AND role_id=?').get(userId,role.role_id) as unknown as Row | undefined
      if (local && (local.pending_payload !== null || local.cloud_payload !== content(desired(local)))) return
      if (local && local.cloud_version >= role.version) return
      this.db.prepare(`INSERT INTO self_role(user_id,role_id,name,avatar_ref,created_at_millis,updated_at_millis,deleted,cloud_version,cloud_payload)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,role_id) DO UPDATE SET name=excluded.name,avatar_ref=excluded.avatar_ref,updated_at_millis=excluded.updated_at_millis,deleted=excluded.deleted,cloud_version=excluded.cloud_version,cloud_payload=excluded.cloud_payload`)
        .run(userId,role.role_id,role.name,role.avatar_file_asset_uid ? `file_asset://${role.avatar_file_asset_uid}` : null,role.update_at,role.update_at,Number(role.deleted),role.version,content(fromCloud(role)))
    })
  }

  conflict(userId: number,roleId: string,message: string): void {
    // A rejected profile edit cannot block a newer local deletion.
    this.db.prepare('UPDATE self_role SET pending_payload=CASE WHEN deleted=1 THEN NULL ELSE pending_payload END, sync_error=CASE WHEN deleted=1 THEN NULL ELSE ? END WHERE user_id=? AND role_id=?').run(message,userId,roleId)
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
