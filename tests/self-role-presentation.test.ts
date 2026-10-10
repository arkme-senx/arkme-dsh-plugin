import { describe, expect, it } from 'vitest'
import { arkmePersonalAvatarRef, arkmeSelfRoleAvatarFallback, arkmeSelfRoleForPresentation } from '../src/client/self-role-presentation.js'

const role = { roleId: 'role-1', name: '另一个我', avatarRef: 'file_asset://avatar123' }

describe('local self-role presentation', () => {
  const profile = { avatarRef: 'current-account-avatar' }

  it.each([undefined, '', 'file_asset://old_avatar_42', 'https://example.com/expired-avatar', 'arkme-self-role-image-v1.other-device'])
    ('uses the account avatar without a local role even when the record has %s', avatarRef => {
      const item = Object.freeze({ isMe: true, ...(avatarRef === undefined ? {} : { avatarRef }) })
      expect(arkmePersonalAvatarRef(item, profile)).toBe(profile.avatarRef)
      expect(item.avatarRef).toBe(avatarRef)
    })

  it('preserves device A role snapshots while device B falls back to the account avatar', () => {
    const record = { isMe: true, avatarRef: 'historical-avatar' }
    const local = Object.freeze({ ...record, selfRole: Object.freeze({ ...role }) })
    expect(arkmePersonalAvatarRef(local, profile)).toBe(role.avatarRef)
    expect(arkmePersonalAvatarRef(record, profile)).toBe(profile.avatarRef)
    expect(local.selfRole).toEqual(role)
  })

  it('keeps a role without an image eligible for its generated role avatar', () => {
    expect(arkmePersonalAvatarRef({ isMe: true, selfRole: { roleId: 'role-2', name: '理性我' } }, profile)).toBeUndefined()
  })

  it('does not substitute the account avatar for another author', () => {
    expect(arkmePersonalAvatarRef({ isMe: false, avatarRef: 'other-avatar', selfRole: role }, profile)).toBe('other-avatar')
    expect(arkmePersonalAvatarRef({ isMe: false }, profile)).toBeUndefined()
  })

  it('keeps the recorded avatar while the profile is loading and follows refreshed account avatars', () => {
    const record = { isMe: true, avatarRef: 'historical-avatar' }
    expect(arkmePersonalAvatarRef(record)).toBe(record.avatarRef)
    expect(arkmePersonalAvatarRef(record, { avatarRef: '' })).toBe(record.avatarRef)
    expect(arkmePersonalAvatarRef(record, profile)).toBe(profile.avatarRef)
    expect(arkmePersonalAvatarRef(record, { avatarRef: 'updated-account-avatar' })).toBe('updated-account-avatar')
  })

  it("uses the role only for the owner's personal views", () => {
    const ownItem = { isMe: true, selfRole: role }
    expect(arkmeSelfRoleForPresentation(ownItem, 'send_to_self')).toEqual(role)
    expect(arkmeSelfRoleForPresentation(ownItem, 'default_category')).toEqual(role)
    expect(arkmeSelfRoleForPresentation(ownItem, 'topic')).toEqual(role)
    expect(arkmeSelfRoleForPresentation(ownItem, 'private_chat')).toBeUndefined()
    expect(arkmeSelfRoleForPresentation(ownItem, 'group_chat')).toBeUndefined()
    expect(arkmeSelfRoleForPresentation({ ...ownItem, isMe: false }, 'send_to_self')).toBeUndefined()
  })

  it('keeps the generated avatar stable from the frozen role snapshot', () => {
    const fallback = arkmeSelfRoleAvatarFallback(role)
    expect(fallback.kind).toBe('phone_default')
    expect(fallback).toEqual(arkmeSelfRoleAvatarFallback({ roleId: role.roleId, name: role.name }))
    expect(fallback.label).toBe('另')
  })
})
