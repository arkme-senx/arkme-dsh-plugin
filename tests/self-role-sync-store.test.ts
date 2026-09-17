import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { beforeEach, afterEach, expect,it, vi } from 'vitest'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { ArkmeStateStore } from '../src/state-store.js'
import type { SelfRoleWrite, CloudSelfRole } from '../src/self-role-sync-store.js'
let dir:string,db:ArkmeLocalDatabase
beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'role-merge-'));db=new ArkmeLocalDatabase(dir,new ArkmeStateStore(dir))})
afterEach(async()=>{vi.restoreAllMocks();db.close();await rm(dir,{recursive:true,force:true})})
const cloud=(op:SelfRoleWrite):CloudSelfRole=>({role_id:op.roleId,name:op.name,avatar_file_asset_uid:op.avatarRef?.replace('file_asset://',''),name_at:op.nameAt,avatar_at:op.avatarAt,deleted_at:op.deletedAt,deleted:op.deletedAt>0,version:1,update_at:op.nameAt})
it('persists edit timestamps across restart and merges old ACK without losing a newer edit',async()=>{
 const role=await db.createSelfRole(1,'第一版');const first=db.selfRoleSync.next(1)!
 await db.updateSelfRole(1,role.roleId,'第二版');const second=db.selfRoleSync.next(1)!
 db.close();db=new ArkmeLocalDatabase(dir,new ArkmeStateStore(dir))
 expect(db.selfRoleSync.next(1)).toEqual(second)
 db.selfRoleSync.acknowledge(1,cloud(first))
 expect(db.selfRoleSync.next(1)).toEqual(second)
 db.selfRoleSync.acknowledge(1,cloud(second));expect(db.selfRoleSync.next(1)).toBeUndefined()
 db.selfRoleSync.merge(1,cloud(first));expect((await db.listSelfRoles(1))[0]?.name).toBe('第二版')
})
it('merges local name and remote avatar then accepts newer same-field edits automatically',async()=>{
 const role=await db.createSelfRole(1,'初始');const original=db.selfRoleSync.next(1)!
 db.selfRoleSync.acknowledge(1,cloud(original));await db.updateSelfRole(1,role.roleId,'离线改名')
 const edited=db.selfRoleSync.next(1)!
 const remote={...cloud(original),avatar_file_asset_uid:'asset',avatar_at:original.avatarAt+10}
 db.selfRoleSync.merge(1,remote)
 expect(db.selfRoleSync.next(1)).toMatchObject({name:'离线改名',nameAt:edited.nameAt,avatarRef:'file_asset://asset',avatarAt:remote.avatar_at})
 db.selfRoleSync.merge(1,{...remote,name:'远端更新',name_at:edited.nameAt+20})
 expect(db.selfRoleSync.next(1)).toBeUndefined()
 expect((await db.listSelfRoles(1))[0]?.name).toBe('远端更新')
})
it('deletion and an in-flight rename converge without reviving the role or changing messages',async()=>{
 const role=await db.createSelfRole(1,'发送名');const first=db.selfRoleSync.next(1)!
 const uid=randomUUID();await db.bindSelfRole(1,uid,role.roleId);await db.deleteSelfRole(1,role.roleId)
 const deletion=db.selfRoleSync.next(1)!
 db.selfRoleSync.merge(1,{...cloud(first),name:'另一端改名',name_at:first.nameAt+20})
 expect(await db.listSelfRoles(1)).toEqual([])
 expect(db.selfRoleSync.next(1)).toMatchObject({name:'另一端改名',deletedAt:deletion.deletedAt})
 db.selfRoleSync.acknowledge(1,cloud(db.selfRoleSync.next(1)!))
 expect(db.selfRoleSync.next(1)).toBeUndefined()
 expect((await db.selfRoleSnapshots(1,[uid])).get(uid)?.name).toBe('发送名')
})
it('handles rolled-back clocks and same-millisecond UTF-8 ties deterministically',async()=>{
 vi.spyOn(Date,'now').mockReturnValue(100)
 const role=await db.createSelfRole(1,'初始');const first=db.selfRoleSync.next(1)!
 db.selfRoleSync.merge(1,{...cloud(first),name:'\ue000',name_at:1000})
 db.selfRoleSync.merge(1,{...cloud(first),name:'😀',name_at:1000})
 expect((await db.listSelfRoles(1))[0]?.name).toBe('😀')
 await db.updateSelfRole(1,role.roleId,'本机后续')
 expect(db.selfRoleSync.next(1)?.nameAt).toBe(1001)
})

it('sparse edits retain other attributes and clearing an avatar wins by edit time',async()=>{
 const role=await db.createSelfRole(1,'初始','file_asset://before');const original=db.selfRoleSync.next(1)!
 const remote={...cloud(original),name:'远端名称',name_at:original.nameAt+10,avatar_file_asset_uid:'remote',avatar_at:original.avatarAt+20}
 db.selfRoleSync.merge(1,remote)
 await db.updateSelfRole(1,role.roleId,undefined,'')
 const clear=db.selfRoleSync.next(1)!
 expect(clear).toMatchObject({name:'远端名称',nameAt:remote.name_at})
 expect(clear.avatarRef).toBeUndefined();expect(clear.avatarAt).toBeGreaterThan(remote.avatar_at)
 db.selfRoleSync.merge(1,remote)
 expect(db.selfRoleSync.next(1)).toEqual(clear)
 await db.updateSelfRole(1,role.roleId,'只改名')
 expect(db.selfRoleSync.next(1)).toMatchObject({name:'只改名',avatarAt:clear.avatarAt})
 expect(db.selfRoleSync.next(1)?.avatarRef).toBeUndefined()
})
