import type { TeamOutboundRecipient } from '../team-outbound-contract.js'

export interface TeamOutboundPerson {
  recipient: TeamOutboundRecipient
  displayName: string
  avatarRef?: string | undefined
}
export interface TeamOutboundIntent {
 requestUid?: string
  accountKey: string
  /** Stable public team identity, since encrypted team references rotate. */
  teamJotmoId?: string | undefined
  person?: TeamOutboundPerson | undefined
}
const listeners = new Set<(intent: TeamOutboundIntent) => void>()
export function openTeamOutbound(intent: TeamOutboundIntent): void { for (const listener of listeners) listener(intent) }
export function subscribeTeamOutbound(listener: (intent: TeamOutboundIntent) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
