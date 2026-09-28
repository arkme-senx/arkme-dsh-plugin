import type { ArkmeGroupAvatarFallback, ArkmeSelfRoleSnapshot, ArkmeSourceKind, ArkmeTimelineItem } from '../types.js'

/** Role identity is a local display layer, never a replacement for record ownership. */
export function arkmeSelfRoleForPresentation(
  item: Pick<ArkmeTimelineItem, 'isMe' | 'selfRole'>,
  sourceKind: ArkmeSourceKind,
): ArkmeSelfRoleSnapshot | undefined {
  if (!item.isMe) return undefined
  if (sourceKind !== 'send_to_self' && sourceKind !== 'default_category' && sourceKind !== 'topic') return undefined
  return item.selfRole
}

export function arkmeSelfRoleAvatarFallback(
  role: Pick<ArkmeSelfRoleSnapshot, 'roleId' | 'name'>,
): ArkmeGroupAvatarFallback {
  return {
    kind: 'phone_default',
    colorIndex: [...role.roleId].reduce((sum, character) => sum + character.charCodeAt(0), 0),
    label: [...role.name.trim()][0] ?? '•',
  }
}
