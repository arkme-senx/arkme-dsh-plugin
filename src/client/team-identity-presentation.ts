import type { ArkmeTimelineItem } from '../types.js'
import type { CSSProperties } from 'react'
import { arkmeTheme } from './arkme-theme.js'

// Shared geometry from the existing identity-menu badge and public-team link.
export const teamIdentityBadgeStyle: CSSProperties = {
  boxSizing: 'border-box', position: 'absolute', right: -2, bottom: -2, display: 'grid', placeItems: 'center',
  width: 14, height: 14, borderRadius: '50%', border: `2px solid ${arkmeTheme.base}`,
  background: arkmeTheme.accentSoft, color: arkmeTheme.accent,
}
export const teamIdentityLinkStyle: CSSProperties = {
  border: 0, background: 'transparent', color: arkmeTheme.accent, padding: 6, cursor: 'pointer',
}

/** Compare accepted presentation facts, never randomized sealed references or composer selection. */
export function continuesTeamRepresentation(previous: ArkmeTimelineItem | undefined, item: ArkmeTimelineItem): boolean {
  if (!previous?.representation || !item.representation || item.senderKind === 'bot' || previous.senderKind === 'bot'
    || item.sharedRecording || previous.sharedRecording
    || item.extensionParent || item.extensionParentRecordUid || previous.extensionParent || previous.extensionParentRecordUid) return false
  const actor = (value: ArkmeTimelineItem) => value.isMe ? 'self'
    : value.memberRef || (value.recordOwnerUserId ? `owner:${String(value.recordOwnerUserId)}` : undefined)
  const previousActor = actor(previous)
  if (!previousActor || previousActor !== actor(item)) return false
  const gap = item.sendAtMillis - previous.sendAtMillis
  const before = new Date(previous.sendAtMillis), at = new Date(item.sendAtMillis)
  return Number.isFinite(gap) && previous.sendAtMillis > 0 && gap >= 0 && gap <= 5 * 60_000
    && before.getFullYear() === at.getFullYear() && before.getMonth() === at.getMonth() && before.getDate() === at.getDate()
    && previous.representation.jotmoId === item.representation.jotmoId
    && previous.representation.name === item.representation.name
}
