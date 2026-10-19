import type { TeamConversation } from '../team-app-contract.js'
import { ArkmeMembershipBadge } from './ArkmeMembershipBadge.js'

/** The same star as private chats, attached only to the external visitor's name. */
export function TeamVisitorMembership({ conversation }: { conversation: TeamConversation }) {
  const type = conversation.side === 'team' ? conversation.visitor?.memberType : undefined
  if (type !== 'vip' && type !== 'svip') return null
  return <ArkmeMembershipBadge memberType={type} />
}
