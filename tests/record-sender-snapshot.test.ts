import { describe, expect, it } from 'vitest'
import { currentProfileRecordSnapshot, recordSenderSnapshot } from '../src/record-sender-snapshot.js'
import type { ArkmeUserProfile } from '../src/types.js'

const profile: ArkmeUserProfile = {
  userId: 42,
  displayName: '现用昵称',
  nickname: '现用昵称',
  avatarRef: 'arkme-profile-image-v1.mutable-token',
  avatarAssetRef: 'file_asset://immutable_avatar_42',
  arkmeId: 'sample',
  accountType: 1,
  createdAt: 1,
  bindings: { apple: false, wechat: false, google: false },
  contact: {},
}

describe('personal record sender snapshots', () => {
  it('writes the historical avatar asset and nickname, never the mutable profile token', () => {
    expect(currentProfileRecordSnapshot(profile)).toEqual({
      avatar: 'file_asset://immutable_avatar_42', nickname: '现用昵称',
    })
    expect(currentProfileRecordSnapshot({ ...profile, avatarAssetRef: undefined, avatarUrl: undefined })).toEqual({ nickname: '现用昵称' })
  })

  it('distinguishes an actual recorded nickname from the 我 placeholder', () => {
    expect(recordSenderSnapshot({ record_core: { sender_snapshot: { avatar: 'file_asset://old_avatar_42', nickname: '当时的昵称' } } }))
      .toMatchObject({ avatarRef: 'file_asset://old_avatar_42', senderName: '当时的昵称', senderNameSnapshot: true })
    expect(recordSenderSnapshot({ record_core: { sender_snapshot: { nickname: '我' } } }).senderNameSnapshot).toBe(true)
    expect(recordSenderSnapshot({ record_core: {} })).toEqual({ avatarSnapshot: true, senderName: '我' })
  })
})
