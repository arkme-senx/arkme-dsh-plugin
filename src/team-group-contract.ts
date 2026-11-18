import type { ArkmeTeam, ArkmeSourceItem } from './types.js'

/** Team membership supplies identity candidates. It does not grant teammates group access. */
export interface TeamGroupContext {
  state: 'ready' | 'backend_pending'
  teams: Array<ArkmeTeam & { representation?: TeamRepresentationSelection }>
  /** Unknown on current backend; a future roster binding suppresses identity choice. */
  groupJoinAt?: number
  membershipPolicy?: 'independent' | 'team_roster' | 'unknown'
  fixedIdentity?: TeamGroupIdentity
}
export interface TeamGroupPending { state: 'backend_pending' }
export const TEAM_GROUP_PENDING_TEXT = '后端接口开发中，开发完成后此功能完整可用。'

export function canChooseTeamGroupIdentity(value?: TeamGroupContext): boolean {
  return value !== undefined && value.state === 'ready' && value.membershipPolicy !== 'team_roster'
    && value.teams.some(team => !!team.jotmoId && !!team.teamRef)
}

/** Only public presentation. Never includes a team's private member list or settings. */
export interface TeamPublicCard {
  name: string
  jotmoId: string
  avatar?: ArkmeTeam['avatar']
  contact: { state: 'available'; publicRef: string } | { state: 'disabled' } | {state:'unavailable'}
  description?: string
  navigation?: {kind:'contact'|'inbox'|'none';teamRef?:string}
}

export interface TeamRepresentationSelection {teamRef:string;membershipKind:'owner'|'member';membershipRevision:number;groupJoinAt:number;groupMembershipUid?:string;groupMembershipRevision?:number}
export interface TeamRepresentationDisplay {name:string;jotmoId:string}
export interface TeamRepresentationSnapshot extends TeamRepresentationSelection, TeamRepresentationDisplay {}
export interface TeamGroupIdentity {team:ArkmeTeam;selection:TeamRepresentationSelection}
export interface TeamRepresentationSendOptions {representation?:TeamRepresentationSelection;sendAtMillis?:number}

export interface TeamGroupJoinContext {
  state:'ready' | 'backend_pending'
  teams:Array<ArkmeTeam & {key:string;joined:boolean;revision:number}>
}
export type TeamGroupCommandAction = 'join'|'leave'|'remove'|'approve'|'reject'
export interface TeamGroupCommandInput {
  sourceRef:string;teamRef:string;requestUid:string;action:TeamGroupCommandAction
  expectedRevision:number;admissionRef?:string
}
export interface TeamGroupCommandResult {
  state:'joined'|'pending'|'rejected'|'left'|'removed'|'not_found'
  accessStatus:'available'|'unavailable'|'unknown'
  receiptRef?:string;revision?:number
}
export interface TeamGroupParticipant {key:string;mentionRef:string;teamRef:string;name:string;jotmoId:string;revision:number;canLeave?:boolean}
export interface TeamGroupApproval {key:string;revision:number;admissionRef:string;teamRef:string;name:string;jotmoId:string;requestedAt:number}
export interface TeamGroupParticipantsPage extends TeamGroupPage<TeamGroupParticipant> {canManage:boolean;leaveAvailable:boolean}
export type TeamGroupRequest =
  | {operation:'join-context';sourceRef:string}
  | {operation:'command';command:TeamGroupCommandInput}
  | {operation:'status';requestUid:string}
  | {operation:'participants'|'approvals';sourceRef:string;cursor?:string;limit?:number}
  | {operation:'directory';teamRef:string;cursor?:string;limit?:number}
export interface TeamGroupPage<T> {items:T[];hasMore:boolean;nextCursor?:string}
export type TeamGroupResponse = TeamGroupJoinContext | TeamGroupCommandResult | TeamGroupParticipantsPage | TeamGroupPage<TeamGroupApproval|ArkmeSourceItem>

export interface TeamGroupSourceCard {
  ref:string;key:string;source:ArkmeSourceItem;activityAt:number;latestRef:string
}
export type TeamWorkspaceEntry =
  | {kind:'customer';key:string;activityAt:number;conversation:import('./team-app-contract.js').TeamConversation;sourceCard?:TeamGroupSourceCard}
  | {kind:'group';key:string;activityAt:number;source:ArkmeSourceItem;entryKey:string;entryRef:string}
export interface TeamWorkspacePage extends TeamGroupPage<TeamWorkspaceEntry> {
  complete:boolean;unavailableSources:string[];resetRequired:boolean
}
export interface TeamGroupOccurrence {ref:string;key:string;sequence:number;occurredAt:number}
export interface TeamGroupOccurrencePage extends TeamGroupPage<TeamGroupOccurrence> {source:ArkmeSourceItem}
export interface TeamWorkspaceFolder {
 channel:import('./team-app-contract.js').TeamChannel
 activityAt:number;preview:string;unread:number;groupCount:number;hasPublished:boolean
 groups:Array<{sourceKey:string;unread:number;lastSeq:number}>
}
export type TeamWorkspaceRequest =
  | {operation:'folders';teamRef?:string}
  | {operation:'resolve-entries';teamRef:string;entries:import('./team-entry-preference-contract.js').TeamEntryReference[]}
  | {operation:'preferences';action:'query';params:{entries:import('./team-entry-preference-contract.js').TeamEntryReference[]}}
  | {operation:'preferences';action:'list';params:{cursor?:string}}
  | {operation:'preferences';action:'change';params:Omit<import('./team-entry-preference-contract.js').TeamEntryPreferenceCommand,'scope'>}
  | {operation:'page';teamRef:string;cursor?:string;limit?:number}
  | {operation:'cards';conversationRef:string;cursor?:string;limit?:number}
  | {operation:'occurrences';conversationRef:string;cardRef:string;cursor?:string;limit?:number}
  | {operation:'locate';anchorRef:string}
export type TeamWorkspaceResponse=TeamWorkspaceFolder[]|import('./team-entry-preference-contract.js').TeamEntryPreferencePage|TeamWorkspacePage|TeamGroupPage<TeamGroupSourceCard>|TeamGroupOccurrencePage|{source:ArkmeSourceItem;item:import('./types.js').ArkmeTimelineItem}
