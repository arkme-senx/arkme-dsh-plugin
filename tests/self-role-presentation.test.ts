import { describe, expect, it } from 'vitest'
import { arkmeSelfRoleAvatarFallback, arkmeSelfRoleForPresentation } from '../src/client/self-role-presentation.js'

const role = { roleId: 'role-1', name: '另一个我', avatarRef: 'file_asset://avatar123' }

describe('local self-role presentation', () => {
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
