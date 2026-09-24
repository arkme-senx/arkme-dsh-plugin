import type { ArkmeTeam, ArkmeTeamMember } from './types.js'

/** Built-in App UI contract, deliberately absent from the public SDK and model Tools. */
export type TeamAppOperation = `team.app.${
  'directory' | 'teams' | 'members' | 'member.remove' | 'leave' | 'create' | 'join'
  | 'channel' | 'channel.configure' | 'official' | 'open' | 'conversations' | 'timeline'
  | 'send' | 'send.status' | 'send.confirm' | 'edit' | 'delete' | 'cancel' | 'home.visibility' | 'read' | 'receipts' | 'block'
  | 'attention' | 'join.status' | 'applications' | 'application.decide' | 'media' | 'image'
}`
export type TeamSide = 'team' | 'external'
export interface TeamIdentity { nickname: string; imageRef?: string }
export interface TeamChannel {
  teamRef: string; name: string; jotmoId: string; imageRef?: string; publicRef: string
  link: string; enabled: boolean; revision: number; canManage: boolean
}
export interface TeamConversation {
  ref: string; key: string; channel: TeamChannel; visitor?: TeamIdentity; side: TeamSide
  lastSeq: number; latestTeamReplySeq: number; myReadSeq: number; unread: number; needsReply: boolean
  blocked: boolean; revision: number; updatedAt: number
  preview?: { text: string; status: string; hasMedia: boolean }
}
export interface TeamContent { text_content: string; title?: string; template_kind: number; display_kind?: number; content_payload?: Record<string, unknown> }
export interface TeamMedia { ref: string; name: string; mimeType: string; size: number; kind: number }
export interface TeamMessage {
  ref: string; key: string; seq: number; revision: number; side: TeamSide; sender: TeamIdentity
  own: boolean; state: string; createdAt: number; canEdit: boolean; canDelete: boolean
  content?: TeamContent; version: number; contentStatus: string; media: TeamMedia[]
}
export interface TeamPage<T> { items: T[]; hasMore: boolean; nextCursor?: string }
export interface TeamTimeline { conversation: TeamConversation; messages: TeamMessage[]; hasMore: boolean; beforeSeq: number }
export interface TeamOpen { channel: TeamChannel; openInbox: boolean; conversation?: TeamConversation }
export interface TeamSendResult { message?: TeamMessage; reason?: string }
export interface TeamReceipts { hasMore?: boolean; nextCursor?: string; teamRead: boolean; visitorRead: boolean; members: Array<TeamIdentity & { read: boolean; readAt: number }> }
export interface TeamMembers { team: ArkmeTeam; items: Array<ArkmeTeamMember & { canRemove: boolean }>; totalCount: number; hasMore: boolean; nextPageCursor?: string }
export interface TeamApplication { ref: string; name: string; state: string; revision: number; requestedAt: number }

export interface TeamAttention { external: boolean; team: boolean; applications?: boolean }

export interface TeamHomeVisibility { showInHome: boolean; version: number }
