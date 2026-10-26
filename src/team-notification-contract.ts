/** Personal preference shared by both conversation sides; refs are account-bound. */
export interface TeamNotificationPolicy { muted: boolean; policyVersion: number; notifyAfterSeq: number }
export interface TeamNotificationEntry {
  conversationRef: string; displayName: string; side: 'team' | 'external'; policy: TeamNotificationPolicy
}
export interface TeamNotificationPage { items: TeamNotificationEntry[]; hasMore: boolean; nextCursor?: string }
export interface TeamNotificationPort {
  listTeamNotificationConversations(side: 'team' | 'external', cursor?: string, signal?: AbortSignal): Promise<TeamNotificationPage>
  getTeamNotificationPolicy(conversationRef: string, signal?: AbortSignal): Promise<TeamNotificationPolicy>
  setTeamNotificationPolicy(conversationRef: string, muted: boolean, signal?: AbortSignal): Promise<TeamNotificationPolicy>
}
export const defaultTeamNotificationPolicy: TeamNotificationPolicy = Object.freeze({ muted: false, policyVersion: 0, notifyAfterSeq: 0 })
export function mergeTeamNotificationPolicy(current: TeamNotificationPolicy | undefined, next: TeamNotificationPolicy | undefined): TeamNotificationPolicy {
  const a = current ?? defaultTeamNotificationPolicy, b = next ?? defaultTeamNotificationPolicy
  return b.policyVersion >= a.policyVersion ? b : a
}
