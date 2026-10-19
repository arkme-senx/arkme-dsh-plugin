import type { TeamConversation } from '../team-app-contract.js'
import { ArkmeMembershipBadge } from './ArkmeMembershipBadge.js'

/** The same star as private chats, attached only to the external visitor's name. */
export function TeamVisitorMembership({ conversation }: { conversation: TeamConversation }) {
  const type = conversation.side === 'team' ? conversation.visitor?.memberType : undefined
  if (type !== 'vip' && type !== 'svip') return null
  return <span title={type === 'svip' ? 'SVIP 会员' : 'VIP 会员'} style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
    <ArkmeMembershipBadge memberType={type} />
  </span>
}
