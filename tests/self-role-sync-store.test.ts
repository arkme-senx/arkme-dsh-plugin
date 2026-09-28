import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect,it } from 'vitest'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { ArkmeStateStore } from '../src/state-store.js'

it('persists the exact in-flight operation across edits and restart, then sends the successor',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'role-sync-'));let db=new ArkmeLocalDatabase(dir,new ArkmeStateStore(dir))
 try{
  const role=await db.createSelfRole(1,'第一版');const first=db.selfRoleSync.next(1)!
  await db.updateSelfRole(1,role.roleId,'第二版');db.close();db=new ArkmeLocalDatabase(dir,new ArkmeStateStore(dir))
  expect(db.selfRoleSync.next(1)).toEqual(first)
  db.selfRoleSync.acknowledge(1,{role_id:role.roleId,name:first.name,version:1,deleted:false,update_at:1})
  expect(db.selfRoleSync.next(1)).toMatchObject({name:'第二版',expectedVersion:1})
  db.selfRoleSync.acknowledge(1,{role_id:role.roleId,name:'第二版',version:2,deleted:false,update_at:2})
  expect(db.selfRoleSync.next(1)).toBeUndefined()
 }finally{db.close();await rm(dir,{recursive:true,force:true})}
})
it('syncs deletion independently of queued messages and retains their frozen history',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'role-delete-'));const db=new ArkmeLocalDatabase(dir,new ArkmeStateStore(dir))
 try{
  const role=await db.createSelfRole(1,'角色');db.selfRoleSync.next(1);db.selfRoleSync.acknowledge(1,{role_id:role.roleId,name:role.name,version:1,deleted:false,update_at:1})
  const uid=randomUUID();await db.bindSelfRole(1,uid,role.roleId);await db.deleteSelfRole(1,role.roleId)
  db.selfRoleSync.acknowledgeBinding(1,uid)
  expect(db.selfRoleSync.next(1)).toMatchObject({deleted:true,expectedVersion:1})
  db.selfRoleSync.acknowledge(1,{role_id:role.roleId,name:role.name,version:2,deleted:true,update_at:2})
  expect(await db.listSelfRoles(1)).toEqual([])
  expect((await db.selfRoleSnapshots(1,[uid])).get(uid)?.name).toBe('角色')
 }finally{db.close();await rm(dir,{recursive:true,force:true})}
})
it('merges clean cloud roles without clobbering offline edits and resolves conflict only explicitly',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'role-conflict-'));const db=new ArkmeLocalDatabase(dir,new ArkmeStateStore(dir))
 try{
  const cloud={role_id:randomUUID(),name:'云端',version:1,deleted:false,update_at:1}
  db.selfRoleSync.merge(1,cloud);await db.updateSelfRole(1,cloud.role_id,'离线修改')
  db.selfRoleSync.merge(1,{...cloud,name:'另一设备',version:2})
  expect((await db.listSelfRoles(1))[0]?.name).toBe('离线修改')
  db.selfRoleSync.next(1);db.selfRoleSync.conflict(1,cloud.role_id,'并发冲突')
  expect(db.selfRoleSync.next(1)).toBeUndefined()
  db.selfRoleSync.acceptRemote(1,{...cloud,name:'另一设备',version:2})
  expect((await db.listSelfRoles(1))[0]).toMatchObject({name:'另一设备',syncState:'synced'})
 }finally{db.close();await rm(dir,{recursive:true,force:true})}
})

it('deletion supersedes a rejected profile operation without user conflict resolution',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'role-delete-conflict-'));const db=new ArkmeLocalDatabase(dir,new ArkmeStateStore(dir))
 try{
  const cloud={role_id:randomUUID(),name:'云端',version:1,deleted:false,update_at:1}
  db.selfRoleSync.merge(1,cloud)
  await db.updateSelfRole(1,cloud.role_id,'离线改名')
  db.selfRoleSync.next(1);db.selfRoleSync.conflict(1,cloud.role_id,'另一端已修改')
  await db.deleteSelfRole(1,cloud.role_id)
  expect(db.selfRoleSync.next(1)).toMatchObject({deleted:true})
  db.selfRoleSync.conflict(1,cloud.role_id,'迟到的改名冲突')
  expect(db.selfRoleSync.next(1)).toMatchObject({deleted:true})
  db.selfRoleSync.acknowledge(1,{...cloud,name:'最新云端名称',version:3,deleted:true})
  expect(db.selfRoleSync.next(1)).toBeUndefined()
  expect(await db.listSelfRoles(1)).toEqual([])
 }finally{db.close();await rm(dir,{recursive:true,force:true})}
})
