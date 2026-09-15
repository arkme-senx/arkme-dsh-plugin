import type { ArkmeSourceItem } from './types.js'

export function arkmePeerMemberType(value: unknown): NonNullable<ArkmeSourceItem['peerMemberType']> {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : String(value)
  if (['svip', 'super_vip', 'super-vip', 'svip_member', '2'].includes(normalized)) return 'svip'
  if (['vip', 'vip_member', '1'].includes(normalized)) return 'vip'
  if (normalized === 'free' || normalized === '0') return 'free'
  return 'unknown'
}
