import { createHmac, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeService } from '../src/arkme-service.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { ArkmeStateStore } from '../src/state-store.js'
import type { ArkmeSessionCredentials } from '../src/keychain-store.js'
import type { ArkmeTimelinePage } from '../src/types.js'
import type { ArkmeServiceConfig } from '../src/services/service.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

describe('local self speaking roles', () => {
  it('freezes message presentation across role changes, deletion and database restart while isolating accounts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arkme-self-roles-'))
    let database = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
    const recordUid = randomUUID()
    const serverRecordUid = randomUUID()
    try {
      const role = await database.createSelfRole(42, '理性我', 'file_asset://avatar_original')
      expect(await database.bindSelfRole(42, recordUid, role.roleId)).toEqual({
        roleId: role.roleId, name: '理性我', avatarRef: 'file_asset://avatar_original',
      })
      expect(await database.rebindSelfRole(42, recordUid, recordUid)).toBe(true)
      expect(await database.rebindSelfRole(42, serverRecordUid, serverRecordUid)).toBe(false)
      await database.updateSelfRole(42, role.roleId, '感性我', 'file_asset://avatar_updated')
      expect(await database.bindSelfRole(42, recordUid, role.roleId)).toEqual({
        roleId: role.roleId, name: '理性我', avatarRef: 'file_asset://avatar_original',
      })
      const otherRole = await database.createSelfRole(42, '另一个我')
      await expect(database.bindSelfRole(42, recordUid, otherRole.roleId)).rejects.toThrow('self-role-record-conflict')
      await database.deleteSelfRole(42, role.roleId)
      expect((await database.listSelfRoles(42)).map(item => item.roleId)).toEqual([otherRole.roleId])
      expect((await database.selfRoleSnapshots(42, [recordUid])).get(recordUid)).toEqual({
        roleId: role.roleId, name: '理性我', avatarRef: 'file_asset://avatar_original',
      })
      expect((await database.selfRoleSnapshots(43, [recordUid])).size).toBe(0)
      expect(await database.rebindSelfRole(42, recordUid, serverRecordUid)).toBe(true)
      database.close()
      database = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
      expect((await database.selfRoleSnapshots(42, [serverRecordUid])).get(serverRecordUid)?.name).toBe('理性我')
      expect((await database.selfRoleSnapshots(42, [recordUid])).size).toBe(0)
      const secondRecordUid = randomUUID()
      await database.bindSelfRole(42, secondRecordUid, otherRole.roleId)
      const firstMigrationPage = await database.selfRoleBindings(42, '', 1)
      expect(firstMigrationPage.items).toHaveLength(1)
      expect(firstMigrationPage.nextCursor).toBe(firstMigrationPage.items[0]?.recordUid)
      const secondMigrationPage = await database.selfRoleBindings(42, firstMigrationPage.nextCursor, 1)
      expect(secondMigrationPage.items).toHaveLength(1)
      expect(secondMigrationPage.nextCursor).toBeUndefined()
      expect([...firstMigrationPage.items, ...secondMigrationPage.items].map(item => item.recordUid).sort())
        .toEqual([serverRecordUid, secondRecordUid].sort())
      expect([...firstMigrationPage.items, ...secondMigrationPage.items].find(item => item.recordUid === serverRecordUid)?.snapshot)
        .toEqual({ roleId: role.roleId, name: '理性我', avatarRef: 'file_asset://avatar_original' })
      expect((await database.selfRoleBindings(43)).items).toEqual([])
      await database.unbindSelfRole(42, serverRecordUid, role.roleId)
      await database.bindSelfRole(42, serverRecordUid, otherRole.roleId)
      // A delayed cleanup for the first role must not remove a newer binding.
      await database.unbindSelfRole(42, serverRecordUid, role.roleId)
      expect((await database.selfRoleSnapshots(42, [serverRecordUid])).get(serverRecordUid)?.roleId).toBe(otherRole.roleId)
      await database.unbindSelfRole(42, serverRecordUid, otherRole.roleId)
      expect((await database.selfRoleSnapshots(42, [serverRecordUid])).size).toBe(0)
    } finally {
      database.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('requires the active account, validates role inputs and decorates only self-authored self messages', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arkme-self-roles-service-'))
    const database = new ArkmeLocalDatabase(directory, new ArkmeStateStore(directory))
    const session: ArkmeSessionCredentials = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
    const sessions = { async read() { return session }, async write() {}, async delete() {} }
    const service = new ArkmeService(config, sessions, database, async () => { throw new Error('unexpected remote request') })
    const recordUid = randomUUID()
    try {
      const source = await service.selfTarget()
      await expect(service.createSelfRole(43, '理性我')).rejects.toMatchObject({ code: 'self-role-account-changed' })
      await expect(service.createSelfRole(42, 'bad', 'data:image/png;base64,xxx')).rejects.toMatchObject({ code: 'self-role-avatar-invalid' })
      await expect(service.createSelfRole(42, 'x'.repeat(21))).rejects.toMatchObject({ code: 'self-role-name-invalid' })
      await expect(service.createSelfRole(42, 'a\u0085b')).rejects.toMatchObject({ code: 'self-role-name-invalid' })
      const role = await dispatchArkmeHostOperation(service, 'self-roles.create', { expectedUserId: 42, name: '理性我' }) as { roleId: string }
      expect(await dispatchArkmeHostOperation(service, 'self-roles.list', { expectedUserId: 42 })).toMatchObject([{ roleId: role.roleId, name: '理性我' }])
      await expect(service.bindSelfRole(43, source.sourceRef, recordUid, role.roleId)).rejects.toMatchObject({ code: 'self-role-account-changed' })
      const privatePayload = Buffer.from(JSON.stringify({
        version: 1, userId: 42, kind: 'private_chat', ownerRef: 'chat-1', displayName: '私聊',
      })).toString('base64url')
      const privateSignature = createHmac('sha256', await database.uniqueCode()).update(privatePayload).digest('base64url')
      await expect(service.bindSelfRole(42, `arkme-source-v1.${privatePayload}.${privateSignature}`, recordUid, role.roleId))
        .rejects.toMatchObject({ code: 'self-role-source-invalid' })
      await expect(service.bindSelfRole(42, source.sourceRef, 'invalid-record-uid', role.roleId))
        .rejects.toMatchObject({ code: 'self-role-uid-invalid' })
      await service.bindSelfRole(42, source.sourceRef, recordUid, role.roleId)
      await expect(dispatchArkmeHostOperation(service, 'self-roles.unbind', { expectedUserId: 42, recordUid }))
        .rejects.toMatchObject({ code: 'self-role-uid-invalid' })
      const page: ArkmeTimelinePage = {
        source, hasMore: false, items: [
          { itemUid: recordUid, senderName: '我', isMe: true, sendAtMillis: 1, title: '', textContent: '我说的', status: 1 },
          { itemUid: randomUUID(), senderName: '其他人', isMe: false, sendAtMillis: 2, title: '', textContent: '别人的', status: 1 },
        ],
      }
      const chat = (service as unknown as { chat: {
        readSource: () => Promise<ArkmeTimelinePage>
        sourceMessageExtensionContext: () => Promise<unknown>
      } }).chat
      const readSource = vi.spyOn(chat, 'readSource').mockResolvedValue(page)
      const projected = await service.readSource(source.sourceRef)
      expect(projected.items[0]).toMatchObject({ isMe: true, selfRole: { roleId: role.roleId, name: '理性我' } })
      expect(projected.items[1]?.selfRole).toBeUndefined()
      readSource.mockResolvedValue({ ...page, source: { ...source, kind: 'private_chat' } })
      expect((await service.readSource(source.sourceRef)).items[0]?.selfRole).toBeUndefined()
      vi.spyOn(chat, 'sourceMessageExtensionContext').mockResolvedValue({
        parentRecordUid: randomUUID(), extensionCount: 2,
        extensions: [
          { recordUid, sourceKind: 'record_extension', senderDisplayName: '我', title: '', textContent: '角色延展',
            sendAtMillis: 1, templateKind: 1, displayKind: 0, officialMark: 0, mediaItems: [], level: 2 },
          { recordUid: randomUUID(), sourceKind: 'record_extension', senderDisplayName: '我', title: '', textContent: '本人延展',
            sendAtMillis: 2, templateKind: 1, displayKind: 0, officialMark: 0, mediaItems: [], level: 2 },
        ],
      })
      const extensionContext = await service.sourceMessageExtensionContext(source.sourceRef, 'opaque-action')
      expect(extensionContext.extensions[0]?.selfRole).toMatchObject({ roleId: role.roleId, name: '理性我' })
      expect(extensionContext.extensions[1]?.selfRole).toBeUndefined()
      vi.spyOn(service['chat'], 'sourceMessageExtensionContext').mockResolvedValue({ extensionCount: 1, extensions: [{ ...extensionContext.extensions[0]!, selfRole: undefined, protectedContent: true }] })
      expect((await service.sourceMessageExtensionContext(source.sourceRef, 'action')).extensions[0]?.selfRole).toBeUndefined()
    } finally {
      database.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
