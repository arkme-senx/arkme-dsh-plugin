import type { TeamConversation } from './team-app-contract.js'

/** References keep their issuing scope. Display labels are never authorization inputs. */
export type TeamOutboundRecipient =
  | { kind: 'chat-member'; sourceRef: string; memberRef: string }
  | { kind: 'directory-contact'; contactRef: string }
  | { kind: 'contact-lookup'; contactRef: string }
  | { kind: 'public-person'; userId: number }
  | { kind: 'profile-link'; url: string; expectedUserId: number }

export type TeamOutboundOpenResult = { state: 'ready'; conversation: TeamConversation }

export function validTeamOutboundRecipient(value: unknown): value is TeamOutboundRecipient {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const ref = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.length <= 32_768
  if (v.kind === 'profile-link') return ref(v.url) && typeof v.expectedUserId === 'number' && Number.isSafeInteger(v.expectedUserId) && v.expectedUserId > 0
  if (v.kind === 'public-person') return typeof v.userId === 'number' && Number.isSafeInteger(v.userId) && v.userId > 0
  return v.kind === 'chat-member' ? ref(v.sourceRef) && ref(v.memberRef)
    : (v.kind === 'directory-contact' || v.kind === 'contact-lookup') && ref(v.contactRef)
}

export interface TeamOutboundTargetPort {
 resolve(recipient: TeamOutboundRecipient, session: import('./keychain-store.js').ArkmeSessionCredentials, signal?: AbortSignal): Promise<import('./record-owner-id.js').RecordOwnerId>
}
export interface TeamOutboundRecovery { teamId: string; targetId: string; selection: string }
