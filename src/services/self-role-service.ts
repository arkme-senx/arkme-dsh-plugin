import type { ArkmeSessionCredentials } from '../keychain-store.js'
import { createHash } from 'node:crypto'
import type { ArkmeLocalDatabase } from '../local-database.js'
import type { SelfRoleAvatarStore } from '../self-role-avatar-store.js'
import type { CloudSelfRole, CloudSelfRoleSnapshot } from '../self-role-sync-store.js'
import type { ArkmeSelfRoleSnapshot } from '../types.js'
import type { MediaService } from './media-service.js'
import { ArkmePluginError, ServiceRuntime } from './service.js'

/** Account-scoped role recovery. Existing message senders only request a frozen
 * snapshot; role CRUD does not enqueue or resend message content. */
export class SelfRoleService {
  private readonly active = new Map<number,Promise<void>>()
  private timer: ReturnType<typeof setInterval> | undefined
  private closed = false
  constructor(private readonly runtime: ServiceRuntime,private readonly local: ArkmeLocalDatabase | undefined,private readonly avatars: SelfRoleAvatarStore,private readonly media: MediaService) {}
  start(): () => void {
    this.closed=false
    const kick=() => { void this.refresh().catch(()=>undefined) }
    kick();this.timer=setInterval(kick,30_000);this.timer.unref?.()
    return () => this.dispose()
  }
  dispose(): void { this.closed=true;if(this.timer)clearInterval(this.timer);this.timer=undefined }
  private async assertAccount(session: ArkmeSessionCredentials): Promise<void> {
    if(this.closed || (await this.runtime.requireSession()).userId!==session.userId)throw new ArkmePluginError('self-role-account-changed','账号已切换，角色操作保留待恢复',false,409)
  }
  private async asset(session: ArkmeSessionCredentials,ref?: string): Promise<string|undefined> {
    if(!ref)return undefined
    if(ref.startsWith('file_asset://'))return ref.slice('file_asset://'.length)
    const cached=this.local?.selfRoleSync.asset(session.userId,ref);if(cached)return cached
    const image=await this.avatars.read(session.userId,ref)
    await this.assertAccount(session)
    const uploaded=await this.media.uploadLocalFile(this.avatars.uploadPath(session.userId,ref),{size:image.data.length,sha256:createHash('sha256').update(image.data).digest('hex'),mimeType:image.mediaType,fileName:'self-role-avatar',fileKind:1},{expectedUserId:session.userId, completionRecovery: { read: () => this.local?.selfRoleSync.pendingAvatarCompletion(session.userId,ref), save: completion => this.local?.selfRoleSync.saveAvatarCompletion(session.userId,ref,completion) }})
    await this.assertAccount(session)
    this.local?.selfRoleSync.saveAsset(session.userId,ref,uploaded.fileAssetUid)
    return uploaded.fileAssetUid
  }
  private async cloudSnapshot(session: ArkmeSessionCredentials,s:ArkmeSelfRoleSnapshot):Promise<CloudSelfRoleSnapshot>{
    const uid=await this.asset(session,s.avatarRef)
    return {role_id:s.roleId,name:s.name,...(uid?{avatar_file_asset_uid:uid}:{})}
  }
  private async flush(session:ArkmeSessionCredentials,roleId?:string):Promise<void>{
    const local=this.local;if(!local)return
    for(let i=0;i<200;i++){
      await this.assertAccount(session)
      const op=local.selfRoleSync.next(session.userId,roleId);if(!op)return
      try {
        const snapshot=op.deleted ? {role_id:op.roleId,name:op.name,...(op.avatarRef?.startsWith('file_asset://') ? {avatar_file_asset_uid:op.avatarRef.slice('file_asset://'.length)} : {})} : await this.cloudSnapshot(session,op)
        const role=await this.runtime.authenticatedPost<CloudSelfRole>('/api/v1/self-roles/apply',{...snapshot,expected_version:op.expectedVersion,deleted:op.deleted},session)
        await this.assertAccount(session);local.selfRoleSync.acknowledge(session.userId,role)
      } catch(error){
        if(error instanceof Error && /self role (version conflict|deleted|invalid)|invalid self role/.test(error.message)) {
          local.selfRoleSync.conflict(session.userId,op.roleId,'角色已在另一端修改或删除，请重新确认')
          if (roleId === undefined) continue
          return // The directory conflict cannot invalidate a frozen message snapshot.
        }
        throw error
      }
    }
  }
  async prepare(session:ArkmeSessionCredentials,recordUid:string):Promise<CloudSelfRoleSnapshot|undefined>{
    const local=this.local;if(!local)return undefined
    const snapshot=(await local.selfRoleSnapshots(session.userId,[recordUid])).get(recordUid)
    if(!snapshot)return undefined
    let prepared: CloudSelfRoleSnapshot | undefined
    await this.exclusive(session.userId,async()=>{
      await this.flush(session,snapshot.roleId)
      await this.assertAccount(session)
      // Deleted roles no longer upload their directory avatar. Frozen messages
      // still share its single upload receipt through this same account lane.
      prepared = await this.cloudSnapshot(session,snapshot)
    })
    return prepared
  }
  acknowledge(session:ArkmeSessionCredentials,uid:string):void{this.local?.selfRoleSync.acknowledgeBinding(session.userId,uid)}
  private async exclusive(userId:number,work:()=>Promise<void>):Promise<void>{
    const previous=this.active.get(userId)??Promise.resolve()
    const next=previous.catch(()=>undefined).then(work);this.active.set(userId,next)
    try{await next}finally{if(this.active.get(userId)===next)this.active.delete(userId)}
  }
  async acceptRemote(userId:number,roleId:string):Promise<void>{
    const session=await this.runtime.requireSession();if(session.userId!==userId)throw new ArkmePluginError('self-role-account-changed','账号已切换',false,409)
    await this.exclusive(userId,async()=>{let after='';do{
      const page=await this.runtime.authenticatedPost<{items:CloudSelfRole[];next_cursor:string}>('/api/v1/self-roles/list',{after,limit:100},session)
      await this.assertAccount(session)
      const role=page.items.find(r=>r.role_id===roleId);if(role){this.local?.selfRoleSync.acceptRemote(userId,role);return}
      after=page.next_cursor
    }while(after);throw new ArkmePluginError('self-role-missing','云端角色不存在',false,404)})
  }
  async refresh():Promise<void>{
    if(!this.local||this.closed)return
    const session=await this.runtime.requireSession()
    const running=this.active.get(session.userId);if(running)return await running
    await this.exclusive(session.userId,async()=>{
      await this.flush(session)
      let after=''
      do{
        await this.assertAccount(session)
        const page=await this.runtime.authenticatedPost<{items:CloudSelfRole[];next_cursor:string}>('/api/v1/self-roles/list',{after,limit:100},session)
        await this.assertAccount(session)
        for(const role of page.items)this.local!.selfRoleSync.merge(session.userId,role)
        after=page.next_cursor
      }while(after)
      let cursor=''
      let bindingConflict: Error | undefined
      for(;;){
        const batch=this.local!.selfRoleSync.pendingBindings(session.userId,cursor);if(batch.length===0)break
        for(const binding of batch){
          await this.assertAccount(session)
          const snapshot=await this.cloudSnapshot(session,binding.snapshot)
          try{
            await this.runtime.authenticatedPost('/api/v1/records/self-role/fill',{record_uid:binding.recordUid,self_role_snapshot:snapshot},session)
            await this.assertAccount(session);this.local!.selfRoleSync.acknowledgeBinding(session.userId,binding.recordUid)
          }catch(error){
            // A queued message has no cloud record yet. Keep its binding; the
            // ordinary send path acknowledges it after atomic content creation.
            if(error instanceof Error && error.message.includes('self role version conflict')) { bindingConflict ??= error }
            else if(!(error instanceof Error)||!error.message.includes('invalid self role'))throw error
          }
          cursor=binding.recordUid
        }
      }
      if(bindingConflict)throw bindingConflict
    })
  }
}
