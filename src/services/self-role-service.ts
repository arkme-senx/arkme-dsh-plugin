import type { ArkmeSessionCredentials } from '../keychain-store.js'
import { createHash } from 'node:crypto'
import type { ArkmeLocalDatabase } from '../local-database.js'
import type { SelfRoleAvatarStore } from '../self-role-avatar-store.js'
import type { CloudSelfRole, CloudSelfRoleSnapshot, SelfRoleFillAttempt } from '../self-role-sync-store.js'
import type { ArkmeSelfRoleSnapshot } from '../types.js'
import type { MediaService } from './media-service.js'
import { ArkmePluginError, ArkmeUpstreamResponseError, ServiceRuntime } from './service.js'

/** Account-scoped role recovery. Existing message senders only request a frozen
 * snapshot; role CRUD does not enqueue or resend message content. */
export class SelfRoleService {
  private readonly active = new Map<number,Promise<void>>()
  private readonly refreshing = new Map<number,Promise<void>>()
  private readonly prepared = new WeakMap<CloudSelfRoleSnapshot,{userId:number;attempt:SelfRoleFillAttempt}>()
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
  private async asset(session: ArkmeSessionCredentials,ref?: string,signal?:AbortSignal): Promise<string|undefined> {
    signal?.throwIfAborted()
    if(!ref)return undefined
    if(ref.startsWith('file_asset://'))return ref.slice('file_asset://'.length)
    const cached=this.local?.selfRoleSync.asset(session.userId,ref);if(cached)return cached
    const image=await this.avatars.read(session.userId,ref)
    await this.assertAccount(session)
    const uploaded=await this.media.uploadLocalFile(this.avatars.uploadPath(session.userId,ref),{size:image.data.length,sha256:createHash('sha256').update(image.data).digest('hex'),mimeType:image.mediaType,fileName:'self-role-avatar',fileKind:1},{expectedUserId:session.userId,...(signal?{signal}:{}), completionRecovery: { read: () => this.local?.selfRoleSync.pendingAvatarCompletion(session.userId,ref), save: completion => this.local?.selfRoleSync.saveAvatarCompletion(session.userId,ref,completion) }})
    await this.assertAccount(session)
    this.local?.selfRoleSync.saveAsset(session.userId,ref,uploaded.fileAssetUid)
    return uploaded.fileAssetUid
  }
  private async cloudSnapshot(session: ArkmeSessionCredentials,s:ArkmeSelfRoleSnapshot,signal?:AbortSignal):Promise<CloudSelfRoleSnapshot>{
    const uid=await this.asset(session,s.avatarRef,signal)
    return {role_id:s.roleId,name:s.name,...(uid?{avatar_file_asset_uid:uid}:{})}
  }
  private async flush(session:ArkmeSessionCredentials,roleId?:string):Promise<void>{
    const local=this.local;if(!local)return
    let failure:unknown
    for(const id of roleId===undefined?local.selfRoleSync.dirtyRoleIds(session.userId):[roleId]) {
      for(let i=0;i<200;i++){
        await this.assertAccount(session)
        const op=local.selfRoleSync.next(session.userId,id);if(!op)break
        try {
          const snapshot=op.deletedAt>0 ? {role_id:op.roleId,name:op.name,...(op.avatarRef?.startsWith('file_asset://') ? {avatar_file_asset_uid:op.avatarRef.slice('file_asset://'.length)} : {})} : await this.cloudSnapshot(session,op)
          const role=await this.runtime.authenticatedPost<CloudSelfRole>('/api/v1/self-roles/apply',{...snapshot,name_at:op.nameAt,avatar_at:op.avatarAt,deleted_at:op.deletedAt},session)
          await this.assertAccount(session);local.selfRoleSync.acknowledge(session.userId,role)
        }catch(error){failure??=error;break}
      }
    }
    if(failure)throw failure
  }

  async prepare(session:ArkmeSessionCredentials,recordUid:string):Promise<CloudSelfRoleSnapshot|undefined>{
    const local=this.local;if(!local)return undefined
    // Ordinary messages without a role keep the existing read-only fast path.
    if(!(await local.selfRoleSnapshots(session.userId,[recordUid])).has(recordUid))return undefined
    const attempt=local.selfRoleSync.claimBinding(session.userId,recordUid,Date.now())
    const snapshot=attempt?.snapshot??(await local.selfRoleSnapshots(session.userId,[recordUid])).get(recordUid)
    if(!snapshot)return undefined
    const remember=(value:CloudSelfRoleSnapshot):CloudSelfRoleSnapshot=>{
      if(attempt){
        this.prepared.set(value,{userId:session.userId,attempt})
      }
      return value
    }
    // Confirmed snapshots with a stable avatar need no directory/upload lane.
    if (local.selfRoleSync.isKnownRemotely(session.userId,snapshot.roleId)
        && (!snapshot.avatarRef || snapshot.avatarRef.startsWith('file_asset://'))) {
      await this.assertAccount(session)
      return remember(await this.cloudSnapshot(session,snapshot))
    }
    let prepared: CloudSelfRoleSnapshot | undefined
    await this.exclusive(session.userId,async()=>{
      await this.assertAccount(session)
      // A frozen send depends on directory existence, not on later profile edits.
      if (!local.selfRoleSync.isKnownRemotely(session.userId,snapshot.roleId)) {
        await this.flush(session,snapshot.roleId)
      }
      await this.assertAccount(session)
      // Deleted roles no longer upload their directory avatar. Frozen messages
      // still share its single upload receipt through this same account lane.
      prepared = await this.cloudSnapshot(session,snapshot)
    })
    return prepared===undefined?undefined:remember(prepared)
  }
  async acknowledge(session:ArkmeSessionCredentials,uid:string,snapshot:CloudSelfRoleSnapshot):Promise<void>{
    const proof=this.prepared.get(snapshot)
    if(proof?.userId===session.userId && proof.attempt.recordUid===uid){
      this.prepared.delete(snapshot)
      // Content creation is already acknowledged by its owner. Local role
      // bookkeeping must not turn that known success into a resendable failure.
      try{
        await this.assertAccount(session)
        this.local?.selfRoleSync.acknowledgeBinding(session.userId,uid,proof.attempt.token)
      }catch{ /* Preserve the binding for later recovery. */ }
    }
  }
  private async exclusive(userId:number,work:()=>Promise<void>):Promise<void>{
    const previous=this.active.get(userId)??Promise.resolve()
    const next=previous.catch(()=>undefined).then(work);this.active.set(userId,next)
    try{await next}finally{if(this.active.get(userId)===next)this.active.delete(userId)}
  }
  private async receipt(session:ArkmeSessionCredentials,attempt:SelfRoleFillAttempt,signal:AbortSignal):Promise<{status:number;version:number}|undefined>{
    const value=await this.runtime.authenticatedPost<unknown>('/api/v1/records/receipt/get',{record_uid:attempt.recordUid},session,signal)
    await this.assertAccount(session)
    if(value===null||typeof value!=='object')throw new Error('invalid self-role receipt')
    const r=value as Record<string,unknown>
    if(r.record_uid!==attempt.recordUid||typeof r.record_exists!=='boolean'||typeof r.accepted!=='boolean'
      ||(r.revision_uid!==undefined&&r.revision_uid!==''))throw new Error('invalid self-role receipt')
    if(!r.record_exists){
      if(r.accepted||(r.record_status!==undefined&&r.record_status!==0)||(r.current_version!==undefined&&r.current_version!==0))throw new Error('invalid self-role receipt')
      return undefined
    }
    if(typeof r.record_status!=='number'||![1,2,3,4].includes(r.record_status)
      ||typeof r.current_version!=='number'||!Number.isSafeInteger(r.current_version)||r.current_version<1
      ||r.current_version<attempt.version)throw new Error('invalid self-role receipt')
    return {status:r.record_status,version:r.current_version}
  }
  private async fill(session:ArkmeSessionCredentials,attempt:SelfRoleFillAttempt,signal:AbortSignal):Promise<void>{
    const store=this.local!.selfRoleSync
    // Only an earlier explicit fill refusal puts a binding into metadata polling.
    if(attempt.status===2||attempt.status===3){
      const current=await this.receipt(session,attempt,signal)
      if(current?.status!==1){store.deferBinding(session.userId,attempt,Date.now(),current?.status,current?.version);return}
    }
    let snapshot:CloudSelfRoleSnapshot|undefined
    // Avatar receipts have exactly one upload owner, shared with prepare(). The
    // record fill/receipt transport deliberately runs outside this upload lane.
    await this.exclusive(session.userId,async()=>{
      await this.assertAccount(session)
      if(!signal.aborted&&store.ownsBinding(session.userId,attempt))snapshot=await this.cloudSnapshot(session,attempt.snapshot,signal)
    })
    await this.assertAccount(session)
    if(!snapshot||!store.ownsBinding(session.userId,attempt))return
    signal.throwIfAborted()
    try{
      await this.runtime.authenticatedPost('/api/v1/records/self-role/fill',{record_uid:attempt.recordUid,self_role_snapshot:snapshot},session,signal)
    }catch(error){
      await this.assertAccount(session)
      // Upload failures and ambiguous transport outcomes must never become
      // lifecycle evidence. Only a received business refusal permits readback.
      if(!(error instanceof ArkmeUpstreamResponseError)||error.code!=='arkme-code-40001'||error.writeOutcomeUnknown===true)throw error
      const current=await this.receipt(session,attempt,signal)
      store.deferBinding(session.userId,attempt,Date.now(),current?.status,current?.version)
      return
    }
    await this.assertAccount(session)
    store.acknowledgeBinding(session.userId,attempt.recordUid,attempt.token)
  }
  private async refreshAccount(session:ArkmeSessionCredentials):Promise<void>{
    let failure:unknown
    await this.exclusive(session.userId,async()=>{
      try { await this.flush(session) } catch (error) { failure=error }
      // Existing directory synchronization remains independent of fill failures.
      let after=''
      do{
        await this.assertAccount(session)
        const page=await this.runtime.authenticatedPost<{items:CloudSelfRole[];next_cursor:string}>('/api/v1/self-roles/list',{after,limit:100},session)
        await this.assertAccount(session)
        for(const role of page.items)this.local!.selfRoleSync.merge(session.userId,role)
        after=page.next_cursor
      }while(after)
    })
    const store=this.local!.selfRoleSync
    const deadline=Date.now()+30_000
    // One indexed due page, not a loop through all historical unacknowledged rows.
    for(const uid of store.dueBindings(session.userId,Date.now())){
      await this.assertAccount(session)
      const remaining=deadline-Date.now();if(remaining<=0)break
      const attempt=store.claimBinding(session.userId,uid,Date.now(),true);if(!attempt)continue
      try { await this.fill(session,attempt,AbortSignal.timeout(remaining)) }
      catch(error){
        await this.assertAccount(session)
        store.deferBinding(session.userId,attempt,Date.now())
        failure??=error
      }
    }
    if(failure)throw failure
  }
  async refresh():Promise<void>{
    if(!this.local||this.closed)return
    const session=await this.runtime.requireSession()
    const running=this.refreshing.get(session.userId);if(running)return await running
    const next=this.refreshAccount(session);this.refreshing.set(session.userId,next)
    try{await next}finally{if(this.refreshing.get(session.userId)===next)this.refreshing.delete(session.userId)}
  }
}
