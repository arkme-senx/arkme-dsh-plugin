import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeLocalDatabase } from '../../src/local-database.js'
import { ArkmeStateStore } from '../../src/state-store.js'
import { SelfRoleService } from '../../src/services/self-role-service.js'
import { RecordService } from '../../src/services/record-service.js'
import type { CloudSelfRole } from '../../src/self-role-sync-store.js'

let root:string, db:ArkmeLocalDatabase
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'self role owner '));db=new ArkmeLocalDatabase(root,new ArkmeStateStore(root))})
afterEach(async()=>{db.close();await rm(root,{recursive:true,force:true})})
function fixture(){
 let userId=7, loseResponse=false
 const roles=new Map<string,CloudSelfRole>()
 const session=()=>({userId,accessToken:'test',refreshToken:'test'})
 const post=vi.fn(async(path:string,body:Record<string,unknown>)=>{
  if(path.endsWith('/self-roles/list'))return {items:[...roles.values()],next_cursor:''}
  if(path.endsWith('/self-roles/apply')){
   const old=roles.get(String(body.role_id)),version=Number(body.expected_version)
   if(old && old.version!==version){
    if(old.version===version+1 && old.name===body.name && old.deleted===body.deleted)return old
    throw new Error('self role version conflict')
   }
   const role={...body,version:version+1,update_at:1} as unknown as CloudSelfRole
   roles.set(role.role_id,role)
   if(loseResponse){loseResponse=false;throw new Error('response lost')}
   return role
  }
  return {record_uid:body.record_uid}
 })
 const runtime={requireSession:async()=>session(),authenticatedPost:post}
 const media={uploadLocalFile:vi.fn(async()=>({fileAssetUid:'avatar-asset-1'}))}
 const avatar={read:vi.fn(async()=>({data:Buffer.from('image'),mediaType:'image/png'})),uploadPath:()=>'/test/isolated-avatar.png'}
 const owner=new SelfRoleService(runtime as never,db,avatar as never,media as never)
 const records=new RecordService(runtime as never,media as never,{} as never);records.selfRoles=owner
 return {owner,records,post,roles,media,session,setUser:(id:number)=>{userId=id},lose:()=>{loseResponse=true}}
}
it('uploads an avatar once and recovers the exact role after lost response plus local rename',async()=>{
 const role=await db.createSelfRole(7,'发送名','arkme-self-role-image-v1.abcdefgh')
 await db.bindSelfRole(7,'record-1',role.roleId)
 const f=fixture();f.lose()
 await expect(f.owner.refresh()).rejects.toThrow('response lost')
 await db.updateSelfRole(7,role.roleId,'改名')
 await f.owner.refresh()
 expect(f.media.uploadLocalFile).toHaveBeenCalledTimes(1)
 expect(f.post).toHaveBeenCalledWith('/api/v1/records/self-role/fill',{record_uid:'record-1',self_role_snapshot:{role_id:role.roleId,name:'发送名',avatar_file_asset_uid:'avatar-asset-1'}},expect.objectContaining({userId:7}))
 expect(f.roles.get(role.roleId)?.name).toBe('改名')
 expect(db.selfRoleSync.pendingBindings(7)).toEqual([])
})
it('creates content atomically with the frozen role even after its directory entry was deleted offline',async()=>{
 const role=await db.createSelfRole(7,'角色');await db.bindSelfRole(7,'queued',role.roleId);await db.deleteSelfRole(7,role.roleId)
 const f=fixture();await f.records.createPersonalRecord('/api/v1/records/create',{record_uid:'queued',text_content:'正文'})
 expect(f.roles.get(role.roleId)?.deleted).toBe(true)
 expect(f.post).toHaveBeenLastCalledWith('/api/v1/records/create',{record_uid:'queued',text_content:'正文',self_role_snapshot:{role_id:role.roleId,name:role.name}},expect.objectContaining({userId:7}),undefined,{})
 expect(db.selfRoleSync.pendingBindings(7)).toEqual([])
})
it('unadorned content does not wait for or call role APIs',async()=>{
 const f=fixture();await f.records.createPersonalRecord('/api/v1/records/create',{record_uid:'old-client',text_content:'正文'})
 expect(f.post).toHaveBeenCalledTimes(1)
 expect(f.post.mock.calls[0]?.[1]).not.toHaveProperty('self_role_snapshot')
})
it('account change during upload leaves the role unacknowledged and never applies it remotely',async()=>{
 const role=await db.createSelfRole(7,'角色','arkme-self-role-image-v1.abcdefgh')
 const f=fixture();f.media.uploadLocalFile.mockImplementationOnce(async()=>{f.setUser(8);return {fileAssetUid:'avatar-asset-1'}})
 await expect(f.owner.refresh()).rejects.toMatchObject({code:'self-role-account-changed'})
 expect(f.post).not.toHaveBeenCalled();expect(db.selfRoleSync.state(7,role.roleId)?.syncState).toBe('pending')
 expect(await db.listSelfRoles(8)).toEqual([])
})
it('one directory conflict does not prevent other roles or immutable messages recovering',async()=>{
 const a=await db.createSelfRole(7,'本地');const b=await db.createSelfRole(7,'另一角色')
 const f=fixture();f.roles.set(a.roleId,{role_id:a.roleId,name:'远端',version:3,deleted:false,update_at:1})
 await f.owner.refresh()
 expect(db.selfRoleSync.state(7,a.roleId)?.syncState).toBe('conflict')
 expect(f.roles.get(b.roleId)?.name).toBe('另一角色')
 await db.bindSelfRole(7,'frozen-message',a.roleId)
 expect(await f.owner.prepare(f.session(),'frozen-message')).toEqual({role_id:a.roleId,name:'本地'})
})

it('deleting a local role never depends on uploading its now-unused avatar',async()=>{
 const role=await db.createSelfRole(7,'删除角色','arkme-self-role-image-v1.missing')
 await db.deleteSelfRole(7,role.roleId)
 const f=fixture();await f.owner.refresh()
 expect(f.media.uploadLocalFile).not.toHaveBeenCalled()
 expect(f.roles.get(role.roleId)?.deleted).toBe(true)
 expect(db.selfRoleSync.next(7)).toBeUndefined()
})
