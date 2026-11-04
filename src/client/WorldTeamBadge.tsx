import { UsersThree } from '@phosphor-icons/react/dist/icons/UsersThree'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'

export function WorldTeamBadge() {
  return <span data-world-team-badge style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, gap: 3, padding: '1px 5px', borderRadius: 5, background: arkmeTheme.accentSoft, color: arkmeTheme.accent, fontSize: 10, lineHeight: '17px', fontWeight: 500 }}>
    <UsersThree size={12} aria-hidden />{tr('团队')}
  </span>
}
