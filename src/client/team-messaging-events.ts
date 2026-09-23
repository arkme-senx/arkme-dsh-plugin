import { arkmeUi } from './ui-controller.js'
import type { TeamConversation } from '../team-app-contract.js'
export type TeamMessageIntent = { kind: 'conversation'; conversation: TeamConversation } | { kind: 'inbox'; side?: 'team' | 'external' } | { kind: 'official' } | { kind: 'team'; teamRef: string } | { kind: 'link'; publicRef: string }
const openListeners = new Set<(intent: TeamMessageIntent) => void>()
const changeListeners = new Set<(account: string) => void>()
export function openTeamMessages(intent: TeamMessageIntent): void { arkmeUi.showTeamConversation(intent); for (const listener of openListeners) listener(intent) }
export function subscribeTeamMessageOpen(listener: (intent: TeamMessageIntent) => void): () => void { openListeners.add(listener); return () => { openListeners.delete(listener) } }
export function invalidateTeamMessages(account: string): void { for (const listener of changeListeners) listener(account) }
export function subscribeTeamMessageChanges(listener: (account: string) => void): () => void { changeListeners.add(listener); return () => { changeListeners.delete(listener) } }
