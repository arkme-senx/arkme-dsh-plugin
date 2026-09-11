import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { arkmeTheme } from './arkme-theme.js'
import type { ArkmeCallParticipant, ArkmeCallVideoPerspective } from '../types.js'
const CALL_ASSET_ROOT = '/arkme-self/api/call'

export function callVideoPerspectiveLabel(perspective: ArkmeCallVideoPerspective | undefined, participants: readonly ArkmeCallParticipant[], peerName = '', fallback = '视频'): string {
  const owner = perspective?.userId === undefined ? undefined : participants.find(person => person.userId === perspective.userId)
  if (owner?.isCurrentUser === true || (!owner && perspective?.perspective === 'self')) return '我的视角'
  const namedView = (value: string | undefined): string => {
    const name = value?.trim() ?? ''
    if (!name || ['通话详情', '通话参与者', '对方'].includes(name)) return ''
    return name.endsWith('视角') ? name : `${name}的视角`
  }
  if (owner && namedView(owner.displayName)) return namedView(owner.displayName)
  if (perspective?.perspective === 'self') return '我的视角'
  if (namedView(perspective?.label)) return namedView(perspective?.label)
  if (perspective?.perspective === 'peer') {
    // The service omits isCurrentUser for other participants instead of sending false.
    const peers = participants.filter(person => person.isCurrentUser !== true)
    return (peers.length === 1 ? namedView(peers[0]?.displayName) : '') || namedView(peerName) || '对方视角'
  }
  return perspective?.perspective === 'main' ? '主视角' : fallback
}

export function sampleAvatarUrl(name: string): string | undefined {
  if (name === '林小满') return `${CALL_ASSET_ROOT}/avatar-lin-xiaoman.jpeg`
  if (name === '妈妈') return `${CALL_ASSET_ROOT}/avatar-mother.jpg`
  if (name === '你') return `${CALL_ASSET_ROOT}/avatar-self.png`
  return undefined
}

export function formatDuration(seconds: number): string {
  const value = Math.max(0, Math.trunc(seconds))
  const minutes = Math.floor(value / 60)
  const rest = value % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

export function clockTime(millis: number): string {
  if (!Number.isFinite(millis) || millis <= 0) return ''
  return new Date(millis).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function cleanAvatarRef(value: string | undefined): string | undefined {
  const normalized = value?.trim() ?? ''
  return normalized === '' ? undefined : normalized
}

export function CallAvatar({ name, avatarRef, assetUrl, size = 40 }: { name: string; avatarRef?: string | undefined; assetUrl?: string | undefined; size?: number }) {
  if (assetUrl !== undefined) return <span style={{
    width: size, height: size, flex: 'none', display: 'grid', placeItems: 'center', overflow: 'hidden',
    borderRadius: 999, background: arkmeTheme.layer2,
  }} aria-label={`${name}头像`}>
    <img src={assetUrl} alt="" draggable={false} style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }} />
  </span>
  const normalizedRef = cleanAvatarRef(avatarRef)
  return <ArkmeUserAvatar
    {...(normalizedRef === undefined ? {} : { avatarRef: normalizedRef })}
    size={size}
    fallback={{ kind: 'phone_default', colorIndex: name.length, label: name.slice(0, 1) || '即' }}
    label={`${name}头像`}
  />
}
