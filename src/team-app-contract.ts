import type { ArkmeMessageQuote } from './message-quote.js'
import type { TeamNotificationPolicy } from './team-notification-contract.js'
import type { ArkmeTeam, ArkmeTeamMember } from './types.js'
import type { ArkmeTeamAvatar } from './team-profile-contract.js'
import type { TeamMemberCodexSync } from './team-member-codex-sync.js'

/** Built-in App transport. SDK and Tools expose the typed TeamMessagePort. */
export type TeamAppOperation = `team.app.${
  'external.list' | 'external.mine' | 'external.share' | 'external.unshare' | 'external.page' | 'directory' | 'teams' | 'members' | 'member.remove' | 'leave' | 'create' | 'create.check' | 'join'
  | 'source' | 'channel' | 'channel.configure' | 'official' | 'open' | 'conversations' | 'timeline'
  | 'extensions' | 'copy-link' | 'report' | 'preflight' | 'locate' | 'send.enqueue' | 'send.tasks' | 'send.retry-task' | 'send.cancel-task' | 'send' | 'send.status' | 'edit' | 'delete' | 'cancel' | 'home.visibility' | 'read' | 'receipts' | 'receipt-summaries' | 'read-states' | 'block'
  | 'profile.get' | 'profile.update' | 'profile.status' | 'profile.avatar.upload' | 'profile.avatar.abort'
  | 'notification-policy.get' | 'notification-policy.set' | 'notification.open'
  | 'entries.cached' | 'entries.query' | 'entries.list' | 'entries.change'
  | 'attention' | 'join.status' | 'applications' | 'application.decide' | 'image'
  | 'mark.capabilities' | 'mark.list' | 'mark.change' | 'official.membership'
  | 'visitor.private.open' | 'person.private.open' | 'people.remarks' | 'outbound.open'
  | 'group.context' | 'group.join' | 'group.directory'
  | 'internal-group.prepare'
  | 'public-card' | 'member-candidates' | 'members.add'
  | 'world.view' | 'world.prepare'
  | 'local-mark.capabilities' | 'local-mark.list' | 'local-mark.change'
}`
export type TeamSide = 'team' | 'external'
/** Presentation-only status; current membership is resolved against the official target by the Host. */
export interface TeamOfficialMembership { jotmoId: string; isMember: boolean }
export interface TeamIdentity {
  nickname: string; imageRef?: string; imageKey?: string
  /** Viewer-scoped identity; never a display-name match or a public account id. */
  personKey?: string; personRef?: string; isMe?: boolean
  publicNickname?: string
  /** Current entitlement from the identity's member_type, never inferred from missing data. */
  memberType?: 'free' | 'vip' | 'svip' | 'unknown'
}
export interface TeamChannel {
  entryKey?: string
  avatar?: ArkmeTeamAvatar
  teamRef: string; name: string; jotmoId: string; imageRef?: string; imageKey?: string; publicRef: string
  link: string; enabled: boolean; revision: number; canManage: boolean
  /** Older Host responses and retained snapshots use canManage when absent. */
  canPause?: boolean
}
export interface TeamConversation {
  entryKey?: string
  ref: string; key: string; channel: TeamChannel; visitor?: TeamIdentity; side: TeamSide
  lastSeq: number; latestTeamReplySeq: number; myReadSeq: number; unread: number; needsReply: boolean
  notificationPolicy?: TeamNotificationPolicy; attentionUnread?: number
  blocked: boolean; revision: number; updatedAt: number
  preview?: { text: string; status: string; hasMedia: boolean; templateKind?: number }
}
export interface TeamMention { personRef: string; displayName: string; startIndex: number; length: number }
export interface TeamContent { mentions?: TeamMention[]; text_content: string; title?: string; template_kind: number; display_kind?: number; content_payload?: Record<string, unknown> }
export interface TeamMedia { ref: string; key: string; url: string; name: string; mimeType: string; size: number; kind: number }
export interface TeamMessage {
 forwardRecords?: import('./types.js').ArkmeForwardRecordsPreview
  ref: string; key: string; seq: number; revision: number; side: TeamSide; sender: TeamIdentity
  own: boolean; state: string; createdAt: number; canEdit: boolean; canDelete: boolean
  content?: TeamContent; version: number; contentStatus: string; media: TeamMedia[]
  reply?: TeamReplyPreview | undefined
  mediaComplete?: boolean
  recipientRead?: boolean
  /** Sealed, viewer-scoped snapshot for private local annotations, not Chat actions. */
  localMarkRef?: string
}
export interface TeamPage<T> { items: T[]; hasMore: boolean; nextCursor?: string }
export interface TeamTimeline { conversation: TeamConversation; messages: TeamMessage[]; hasMore: boolean; beforeSeq: number }
export interface TeamOpen { channel: TeamChannel; openInbox: boolean; conversation?: TeamConversation }
export interface TeamSendResult { message?: TeamMessage; reason?: string }
export interface TeamReceiptMember extends TeamIdentity { key?: string; isMe?: boolean; read?: boolean; readAt?: number }
export interface TeamReceiptCounts { read: number; unread: number; total: number }
export interface TeamMessageReceiptSummary { key: string; summary?: TeamReceiptCounts; teamRead?: boolean; visitorRead?: boolean }
export interface TeamReceiptSummaryBatch { items: TeamMessageReceiptSummary[]; lastSeq: number; myReadSeq: number; unread: number }
export interface TeamReceipts {
  summary?: TeamReceiptCounts
  hasMore?: boolean; nextCursor?: string; teamRead?: boolean; visitorRead?: boolean
  /** Whether the sender is reliably excluded from the recipient population. */
  senderExcluded?: boolean
  members: TeamReceiptMember[]
}
export interface TeamMembers {
  team: ArkmeTeam; items: Array<ArkmeTeamMember & { key: string; canRemove: boolean; codexSync?: TeamMemberCodexSync }>; totalCount: number; hasMore: boolean; nextPageCursor?: string
  /** Optional presentation has its own lifecycle; unavailable is not an empty avatar. */
  avatarState?: 'pending' | 'ready' | 'unavailable'
}
export interface TeamApplication { ref: string; name: string; state: string; revision: number; requestedAt: number }

export interface TeamAttention { external: boolean; team: boolean; applications?: boolean }

export interface TeamHomeVisibility { showInHome: boolean; version: number }

export interface TeamJotmoIdAvailability { available: boolean; reason: string }

export interface TeamRecordSource { name: string; conversationRef: string }

/** Immutable reply selection retained by the existing durable send owner. */
export interface TeamReplyTarget {
  messageRef: string; messageKey: string; version: number; text: string; senderName: string; title?: string; media?: TeamMedia[]
  quote?: ArkmeMessageQuote
}
export interface TeamReplyPreview {
  ref: string; key: string; seq: number; version: number; state: 'available' | 'edited' | 'unavailable'
  text: string; sender: TeamIdentity; title?: string; media?: TeamMedia[]; quote?: ArkmeMessageQuote
}
export type TeamConversationReadState = {key: string; accessible: false}
  | {key: string; accessible: true; notificationPolicy?: TeamNotificationPolicy; lastSeq: number; myReadSeq: number; unread: number}

export interface TeamExtensionPage { message: TeamMessage; items: TeamMessage[]; totalCount: number; hasMore: boolean; nextSeq: number; throughSeq: number }
