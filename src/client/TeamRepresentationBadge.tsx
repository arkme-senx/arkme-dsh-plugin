import { useState, type ReactNode } from 'react'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import type { TeamRepresentationSnapshot } from '../team-group-contract.js'
import { arkmeAuthStore } from './auth-store.js'
import { TeamPublicCardDialog } from './TeamPublicCardDialog.js'
import { teamIdentityBadgeStyle, teamIdentityLinkStyle } from './team-identity-presentation.js'
import { tr, useArkmeLocale } from './locale.js'

export function TeamRepresentationBadge({ value, compact = false }: {
  value: Pick<TeamRepresentationSnapshot, 'name' | 'jotmoId'>
  compact?: boolean
}) {
  useArkmeLocale()
  const [open, setOpen] = useState(false)
  const auth = arkmeAuthStore.getSnapshot().auth
  const accountKey = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : undefined
  return <><button type="button" data-arkme-team-representation={compact ? 'marker' : 'label'}
    title={tr('代表{v0}发言；查看团队资料', { v0: value.name })}
    aria-label={tr('查看{v0}团队资料', { v0: value.name })}
    onClick={event => { event.stopPropagation(); if (accountKey) setOpen(true) }}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation() }}
    style={compact ? { ...teamIdentityBadgeStyle, padding: 0, cursor: 'pointer' } : teamIdentityLinkStyle}>
    <Users size={compact ? 10 : 12} weight="fill" aria-hidden="true" />{!compact && value.name}
  </button>
    {open && accountKey && <TeamPublicCardDialog accountKey={accountKey} jotmoId={value.jotmoId} onClose={() => setOpen(false)} />}
  </>
}

/** Reuse the personal avatar and the existing compact Team corner marker. */
export function TeamRepresentationAvatar({ value, children }: {
  value?: Pick<TeamRepresentationSnapshot, 'name' | 'jotmoId'> | undefined
  children: ReactNode
}) {
  return <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
    {children}{value && <TeamRepresentationBadge value={value} compact />}
  </span>
}
