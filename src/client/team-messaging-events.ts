import { arkmeUi } from './ui-controller.js'
import type { TeamChannel, TeamConversation, TeamMessageChangeHint } from '../team-app-contract.js'
export type TeamMessageIntent = { kind: 'conversation'; conversation: TeamConversation } | { kind: 'inbox'; side?: 'team' | 'external' } | { kind: 'official' } | { kind: 'team'; teamRef: string; channel?: TeamChannel } | { kind: 'link'; publicRef: string }
const openListeners = new Set<(intent: TeamMessageIntent) => void>()
const changeListeners = new Set<(account: string, receiptOnly?: boolean, change?:TeamMessageChangeHint) => void>()
const workspaceListeners=new Set<(account:string,canonicalGroupKey?:string)=>void>()
export function openTeamMessages(intent: TeamMessageIntent): void { arkmeUi.showTeamConversation(intent); for (const listener of openListeners) listener(intent) }
export function subscribeTeamMessageOpen(listener: (intent: TeamMessageIntent) => void): () => void { openListeners.add(listener); return () => { openListeners.delete(listener) } }
export function invalidateTeamMessages(account: string, receiptOnly = false, change?:TeamMessageChangeHint): void { for (const listener of changeListeners) listener(account, receiptOnly,change) }
export function refreshPublishedTeamMessages(account: string, conversationKey: string): void {
  invalidateTeamMessages(account, false, { kind: 'team.message.published', conversationKeys: [conversationKey] })
}
export function invalidateTeamMessageKeys(account: string, conversationKey: string, keys: readonly string[]): void {
  if (!keys.length) return
  invalidateTeamMessages(account, false, {
    kind: 'team.message.changed', conversationKeys: [conversationKey],
    ...(keys.length === 1 ? { messageKey: keys[0]! } : { messageKeys: [...new Set(keys)] }),
  })
}
export function revokeTeamConversationRead(account: string, conversationKey: string): void {
  invalidateTeamMessages(account, false, { kind: 'team.access.revoked', conversationKeys: [conversationKey] })
}
export function subscribeTeamMessageChanges(listener: (account: string, receiptOnly?: boolean, change?:TeamMessageChangeHint) => void): () => void { changeListeners.add(listener); return () => { changeListeners.delete(listener) } }
export function invalidateTeamWorkspace(account:string,canonicalGroupKey?:string):void {for(const listener of workspaceListeners)listener(account,canonicalGroupKey)}
export function subscribeTeamWorkspaceChanges(listener:(account:string,canonicalGroupKey?:string)=>void):()=>void {workspaceListeners.add(listener);return()=>{workspaceListeners.delete(listener)}}
