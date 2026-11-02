import { arkmeUi } from './ui-controller.js'
import type { TeamChannel, TeamConversation, TeamMessageChangeHint } from '../team-app-contract.js'
export type TeamMessageIntent = { kind: 'conversation'; conversation: TeamConversation } | { kind: 'inbox'; side?: 'team' | 'external' } | { kind: 'official' } | { kind: 'team'; teamRef: string; channel?: TeamChannel } | { kind: 'link'; publicRef: string }
const openListeners = new Set<(intent: TeamMessageIntent) => void>()
const changeListeners = new Set<(account: string, receiptOnly?: boolean, change?:TeamMessageChangeHint) => void>()
export function openTeamMessages(intent: TeamMessageIntent): void { arkmeUi.showTeamConversation(intent); for (const listener of openListeners) listener(intent) }
export function subscribeTeamMessageOpen(listener: (intent: TeamMessageIntent) => void): () => void { openListeners.add(listener); return () => { openListeners.delete(listener) } }
export function invalidateTeamMessages(account: string, receiptOnly = false, change?:TeamMessageChangeHint): void { for (const listener of changeListeners) listener(account, receiptOnly,change) }
export function subscribeTeamMessageChanges(listener: (account: string, receiptOnly?: boolean, change?:TeamMessageChangeHint) => void): () => void { changeListeners.add(listener); return () => { changeListeners.delete(listener) } }
