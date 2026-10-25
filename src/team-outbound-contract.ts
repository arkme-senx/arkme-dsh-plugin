import type { TeamConversation } from './team-app-contract.js'

/** References keep their issuing scope. Display labels are never authorization inputs. */
export type TeamOutboundRecipient =
  | { kind: 'chat-member'; sourceRef: string; memberRef: string }
  | { kind: 'directory-contact'; contactRef: string }
  | { kind: 'contact-lookup'; contactRef: string }

export type TeamOutboundOpenResult =
  | { state: 'backend_pending' }
  | { state: 'ready'; conversation: TeamConversation }

export const TEAM_OUTBOUND_PENDING_TEXT = '后端接口开发中，开发完成后此功能完整可用。'

export function validTeamOutboundRecipient(value: unknown): value is TeamOutboundRecipient {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const ref = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.length <= 32_768
  return v.kind === 'chat-member' ? ref(v.sourceRef) && ref(v.memberRef)
    : (v.kind === 'directory-contact' || v.kind === 'contact-lookup') && ref(v.contactRef)
}
