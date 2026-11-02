import { useState } from 'react'
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
  // The avatar remains one personal-profile target. The named label owns Team navigation.
  if (compact) return <span aria-hidden="true" data-arkme-team-representation="marker"
    style={{ ...teamIdentityBadgeStyle, pointerEvents: 'none' }}><Users size={10} weight="fill" /></span>
  const label = tr('代表 · {v0}', { v0: value.name })
  return <><button type="button" data-arkme-team-representation="label"
    title={tr('代表{v0}发言；查看团队资料', { v0: value.name })}
    aria-label={tr('查看{v0}团队资料', { v0: value.name })}
    onClick={event => { event.stopPropagation(); if (accountKey) setOpen(true) }}
    style={{ ...teamIdentityLinkStyle, display: 'inline-flex', alignItems: 'center', gap: 4,
      minWidth: 0, minHeight: 28, maxWidth: '100%', textAlign: 'start' }}>
    <Users size={12} weight="fill" aria-hidden="true" style={{ flexShrink: 0 }} />
    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
  </button>
    {open && accountKey && <TeamPublicCardDialog accountKey={accountKey} jotmoId={value.jotmoId} onClose={() => setOpen(false)} />}
  </>
}
