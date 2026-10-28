import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { ArkmeStateStore } from '../src/state-store.js'

describe('self role avatar asset receipts', () => {
 it('assetizes shared local bytes without rewriting frozen names or another account', async () => {
  const dir=await mkdtemp(join(tmpdir(),'role-asset-'));const db=new ArkmeLocalDatabase(dir,new ArkmeStateStore(dir))
  try {
   const ref=`arkme-self-role-image-v1.${randomUUID()}`
   const role=await db.createSelfRole(42,'原名',ref);const uid=randomUUID();await db.bindSelfRole(42,uid,role.roleId)
   await db.updateSelfRole(42,role.roleId,'新名');await db.createSelfRole(43,'其他账号',ref)
   db.selfRoleSync.saveAsset(42,ref,'cloud-avatar')
   expect((await db.selfRoleSnapshots(42,[uid])).get(uid)).toEqual({roleId:role.roleId,name:'原名',avatarRef:'file_asset://cloud-avatar'})
   expect((await db.listSelfRoles(42))[0]).toMatchObject({name:'新名',avatarRef:'file_asset://cloud-avatar'})
   expect((await db.listSelfRoles(43))[0]?.avatarRef).toBe(ref)
   expect(db.selfRoleSync.asset(42,ref)).toBe('cloud-avatar')
  } finally { db.close();await rm(dir,{recursive:true,force:true}) }
 })
})
