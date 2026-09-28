import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeService } from '../src/arkme-service.js'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { SelfRoleAvatarStore } from '../src/self-role-avatar-store.js'
import { ArkmeStateStore } from '../src/state-store.js'
import type { ArkmeImageBytes } from '../src/types.js'
import type { ArkmeServiceConfig } from '../src/services/service.js'

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/h5kAAAAASUVORK5CYII=',
  'base64',
)

function serviceConfig(directory: string): ArkmeServiceConfig {
  return {
    environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
    recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
    imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
    relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
    routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
    maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
    fileStateDirectory: directory,
  }
}

function serviceFor(database: ArkmeLocalDatabase, directory: string, currentUser: () => number) {
  const sessions = {
    async read() { return { userId: currentUser(), accessToken: 'access', refreshToken: 'refresh' } },
    async write() {}, async delete() {},
  }
  const service = new ArkmeService(serviceConfig(directory), sessions, database, async () => {
    throw new Error('unexpected remote request')
  })
  const media = (service as unknown as { media: { readImage(ref: string): Promise<ArkmeImageBytes> } }).media
  return { service, media }
}

describe('legacy self-role avatar migration', () => {
  it('migrates current roles and historical snapshots without changing their identity or another account', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arkme-role-avatar-migration-'))
    let database = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
    const legacyRef = 'file_asset://legacy-role-image'
    const localRef = `arkme-self-role-image-v1.${randomUUID()}`
    const firstRecordUid = randomUUID()
    const deletedRoleRecordUid = randomUUID()
    const otherAccountRecordUid = randomUUID()
    try {
      const role = await database.createSelfRole(42, '最初的我', legacyRef)
      await database.bindSelfRole(42, firstRecordUid, role.roleId)
      const deletedRole = await database.createSelfRole(42, '已删除的角色', legacyRef)
      await database.bindSelfRole(42, deletedRoleRecordUid, deletedRole.roleId)
      await database.deleteSelfRole(42, deletedRole.roleId)
      const otherAccountRole = await database.createSelfRole(43, '其他账号', legacyRef)
      await database.bindSelfRole(43, otherAccountRecordUid, otherAccountRole.roleId)
      const alreadyLocal = await database.createSelfRole(42, '本地角色', `arkme-self-role-image-v1.${randomUUID()}`)

      expect(await database.legacySelfRoleAvatarRefs(42)).toEqual([legacyRef])
      await database.replaceSelfRoleAvatarRef(42, legacyRef, localRef)

      expect(await database.legacySelfRoleAvatarRefs(42)).toEqual([])
      expect((await database.listSelfRoles(42)).find(item => item.roleId === role.roleId)).toMatchObject({
        name: '最初的我', avatarRef: localRef,
      })
      expect((await database.listSelfRoles(42)).find(item => item.roleId === alreadyLocal.roleId)?.avatarRef)
        .toBe(alreadyLocal.avatarRef)
      expect((await database.selfRoleSnapshots(42, [firstRecordUid, deletedRoleRecordUid])).get(firstRecordUid))
        .toMatchObject({ roleId: role.roleId, name: '最初的我', avatarRef: localRef })
      expect((await database.selfRoleSnapshots(42, [deletedRoleRecordUid])).get(deletedRoleRecordUid))
        .toMatchObject({ roleId: deletedRole.roleId, name: '已删除的角色', avatarRef: localRef })
      expect((await database.listSelfRoles(43))[0]?.avatarRef).toBe(legacyRef)
      expect((await database.selfRoleSnapshots(43, [otherAccountRecordUid])).get(otherAccountRecordUid)?.avatarRef)
        .toBe(legacyRef)

      database.close()
      database = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
      expect((await database.listSelfRoles(42)).find(item => item.roleId === role.roleId)?.avatarRef).toBe(localRef)
      expect((await database.selfRoleSnapshots(42, [deletedRoleRecordUid])).get(deletedRoleRecordUid)?.avatarRef)
        .toBe(localRef)
    } finally {
      database.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('copies a legacy cloud avatar locally when roles are listed, including frozen message snapshots', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arkme-role-avatar-service-'))
    const database = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
    const ref = 'file_asset://legacy12345678'
    const recordUid = randomUUID()
    const deletedRoleRecordUid = randomUUID()
    try {
      const role = await database.createSelfRole(42, '当时的角色', ref)
      await database.bindSelfRole(42, recordUid, role.roleId)
      const deletedRole = await database.createSelfRole(42, '已删除的角色', ref)
      await database.bindSelfRole(42, deletedRoleRecordUid, deletedRole.roleId)
      await database.deleteSelfRole(42, deletedRole.roleId)
      const { service, media } = serviceFor(database, directory, () => 42)
      const cloudRead = vi.spyOn(media, 'readImage').mockResolvedValue({
        mediaType: 'image/png', bytes: tinyPng.byteLength, data: tinyPng,
      })

      const roles = await service.listSelfRoles(42)
      const localRef = roles.find(item => item.roleId === role.roleId)?.avatarRef
      expect(localRef).toMatch(/^arkme-self-role-image-v1\./)
      expect(cloudRead).toHaveBeenCalledExactlyOnceWith(ref)
      expect((await database.selfRoleSnapshots(42, [recordUid])).get(recordUid))
        .toMatchObject({ roleId: role.roleId, name: '当时的角色', avatarRef: localRef })
      expect((await database.selfRoleSnapshots(42, [deletedRoleRecordUid])).get(deletedRoleRecordUid))
        .toMatchObject({ roleId: deletedRole.roleId, name: '已删除的角色', avatarRef: localRef })
      const localStore = new SelfRoleAvatarStore(join(directory, 'self-role-avatars'))
      expect(Buffer.from((await localStore.read(42, localRef!)).data)).toEqual(tinyPng)

      await service.listSelfRoles(42)
      expect(cloudRead).toHaveBeenCalledOnce()
    } finally {
      database.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('leaves the legacy reference readable when cloud migration fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arkme-role-avatar-service-'))
    const database = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
    const ref = 'file_asset://missing12345678'
    const recordUid = randomUUID()
    try {
      const role = await database.createSelfRole(42, '当时的角色', ref)
      await database.bindSelfRole(42, recordUid, role.roleId)
      const { service, media } = serviceFor(database, directory, () => 42)
      const cloudRead = vi.spyOn(media, 'readImage').mockRejectedValue(new Error('offline'))

      expect((await service.listSelfRoles(42))[0]?.avatarRef).toBe(ref)
      expect((await database.selfRoleSnapshots(42, [recordUid])).get(recordUid)?.avatarRef).toBe(ref)
      expect(cloudRead).toHaveBeenCalledOnce()
    } finally {
      database.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('accepts only the active account’s existing local avatar when creating a role', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arkme-role-avatar-account-'))
    const database = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
    let currentUserId = 42
    try {
      const { service } = serviceFor(database, directory, () => currentUserId)
      const avatarRef = await service.saveSelfRoleAvatar(42, tinyPng, 'image/png')
      const role = await service.createSelfRole(42, '我', avatarRef)
      expect(role).toMatchObject({ avatarRef, name: '我' })
      const recordUid = randomUUID()
      expect(await database.bindSelfRole(42, recordUid, role.roleId)).toMatchObject({ avatarRef, name: '我' })
      expect((await database.selfRoleSnapshots(42, [recordUid])).get(recordUid)?.avatarRef).toBe(avatarRef)
      expect(Buffer.from((await service.readImage(avatarRef)).data)).toEqual(tinyPng)
      currentUserId = 43
      await expect(service.createSelfRole(43, '不能借用头像', avatarRef))
        .rejects.toMatchObject({ code: 'self-role-avatar-invalid' })
      await expect(service.readImage(avatarRef)).rejects.toMatchObject({ code: 'self-role-avatar-missing' })
      await expect(service.createSelfRole(43, '不存在的头像', `arkme-self-role-image-v1.${randomUUID()}`))
        .rejects.toMatchObject({ code: 'self-role-avatar-invalid' })
      expect(await database.listSelfRoles(43)).toEqual([])
    } finally {
      database.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects new cloud avatar references while preserving legacy rows when an update omits the avatar', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arkme-role-avatar-legacy-write-'))
    const database = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
    const legacyRef = 'file_asset://legacy12345678'
    try {
      const legacy = await database.createSelfRole(42, '旧角色', legacyRef)
      const { service } = serviceFor(database, directory, () => 42)
      await expect(service.createSelfRole(42, '不允许新增云头像', legacyRef))
        .rejects.toMatchObject({ code: 'self-role-avatar-invalid' })
      await expect(service.updateSelfRole(42, legacy.roleId, '不允许重写云头像', legacyRef))
        .rejects.toMatchObject({ code: 'self-role-avatar-invalid' })
      expect(await service.updateSelfRole(42, legacy.roleId, '保留旧头像')).toMatchObject({
        name: '保留旧头像', avatarRef: legacyRef,
      })
    } finally {
      database.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('does not return the old account role list if the account changes during migration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arkme-role-avatar-switch-'))
    const database = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
    let currentUserId = 42
    let completeRead!: (image: ArkmeImageBytes) => void
    const delayedImage = new Promise<ArkmeImageBytes>(resolve => { completeRead = resolve })
    const ref = 'file_asset://legacy12345678'
    try {
      await database.createSelfRole(42, '旧账号角色', ref)
      const { service, media } = serviceFor(database, directory, () => currentUserId)
      const cloudRead = vi.spyOn(media, 'readImage').mockImplementation(async () => await delayedImage)
      const listing = service.listSelfRoles(42)
      await vi.waitFor(() => { expect(cloudRead).toHaveBeenCalledOnce() })
      currentUserId = 43
      completeRead({ mediaType: 'image/png', bytes: tinyPng.byteLength, data: tinyPng })

      await expect(listing).rejects.toMatchObject({ code: 'self-role-account-changed' })
      expect((await database.listSelfRoles(42))[0]?.avatarRef).toBe(ref)
    } finally {
      database.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
