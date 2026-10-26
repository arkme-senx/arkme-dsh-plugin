import type {MessageUnderlineChange,MessageUnderlineSnapshot} from './message-annotations.js'
export type {MessageUnderline,MessageUnderlineChange,MessageUnderlineSnapshot} from './message-annotations.js'
import type { TeamConversation, TeamPage, TeamSide, TeamTimeline } from './team-app-contract.js'
import type { TeamSendInput, TeamSendTask } from './team-send-contract.js'

export type { TeamConversation, TeamMessage, TeamPage, TeamReplyTarget, TeamReplyPreview, TeamSide, TeamTimeline } from './team-app-contract.js'
export type { TeamSendInput, TeamSendTask } from './team-send-contract.js'
export type TeamMessageReadOptions = { beforeSeq?: number; limit?: number; messageRef?: string }
export type TeamReportReason = 'spam'|'harassment'|'illegal'|'privacy'|'other'
export interface TeamReportResult {reportUid:string}
export type TeamMarkAudience = 'team'|'conversation'
export type TeamForwardDestination={kind:'source';sourceRef:string}|{kind:'team';conversationRef:string}
export interface TeamForwardInput {
 conversationRef:string;selections:{messageRef:string;version:number}[];target:TeamForwardDestination
 /** Keep these identities unchanged when a delivery result is unknown. */
 requestId:string;recordUid:string;sendAtMillis:number
 commentText?:string;commentRecordUid?:string
}
export interface TeamMessagePort {
 forwardTeamMessages(input:TeamForwardInput,signal?:AbortSignal):Promise<import('./types.js').ArkmeSourceSendResult>
 createTeamMessageCopyLink(conversationRef:string,selections:{messageRef:string;version:number}[],signal?:AbortSignal):Promise<import('./types.js').ArkmeMessageCopyLinkResult>

 reportTeamMessage(conversationRef:string,messageRef:string,version:number,reason:TeamReportReason,description?:string,signal?:AbortSignal):Promise<TeamReportResult>

  preflightTeamMessages(conversationRef:string,selections:{messageRef:string;version:number}[],signal?:AbortSignal):Promise<import('./team-app-contract.js').TeamMessage[]>
  readTeamMarks(conversationRef:string,audience:TeamMarkAudience,markRefs:string[],signal?:AbortSignal):Promise<{actionRef:string;snapshot:MessageUnderlineSnapshot}[]>
  changeTeamMark(conversationRef:string,audience:TeamMarkAudience,markRef:string,change:MessageUnderlineChange,signal?:AbortSignal):Promise<MessageUnderlineSnapshot>
  listTeamConversations(side: TeamSide, options?: {cursor?: string;limit?: number}, signal?: AbortSignal): Promise<TeamPage<TeamConversation>>
  readTeamMessages(conversationRef: string, options?: TeamMessageReadOptions, signal?: AbortSignal): Promise<TeamTimeline>
  sendTeamMessage(command: TeamSendInput, signal?: AbortSignal): Promise<TeamSendTask>
  teamMessageTasks(conversationRef: string, signal?: AbortSignal): Promise<TeamSendTask[]>
  updateTeamSend(conversationRef: string, taskRef: string, action: 'retry'|'cancel', signal?: AbortSignal): Promise<TeamSendTask>
}
