export interface ReactionExpression { text: string; emoji?: string; hand?: string; color?: string }
export type ReactionTargetRef = { id: string } & ({ sourceRef: string; messageActionRef: string; worldRecordRef?: never } | { worldRecordRef: string; sourceRef?: never; messageActionRef?: never })
export interface ReactionSelection { key: string; expression: ReactionExpression; at: number }
export interface ReactionState { revision: number; selections: ReactionSelection[] }
export interface ReactionActor { userId: number; displayName: string; groupNickname?: string; avatarRef?: string }
export interface ReactionGroup { actors?: ReactionActor[]; key: string; expression: ReactionExpression; count: number }
export interface ReactionSnapshot { target_id: string; mine: ReactionState; groups: ReactionGroup[]; has_more: boolean; actors_visible: boolean; private: boolean }
export interface ReactionLibrary { revision: number; items: ReactionExpression[] }
export interface ReactionSetResult { outcome: 'updated' | 'unchanged' | 'idempotent' | 'revision_conflict'; state: ReactionState }
export interface ReactionLibraryResult { outcome: 'updated' | 'idempotent' | 'revision_conflict'; library: ReactionLibrary }
export interface ReactionActorPage { items: ReactionActor[]; has_more: boolean }
export interface ReactionGroupPage { items: ReactionGroup[]; has_more: boolean }
export interface ReactionOriginalMessage { source: import('./types.js').ArkmeSourceItem; itemUid: string; recordOwnerUserId: number; sendAtMillis: number }
export interface ReactionHistoryContext { sourceName?: string | undefined; authorName?: string | undefined; avatar?: Pick<import('./types.js').ArkmeSourceItem, 'avatarRef' | 'avatarRefs' | 'groupAvatar'>; originalMessage?: ReactionOriginalMessage | undefined }
export interface ReactionHistoryEvent extends ReactionHistoryContext { event_uid: string; target_id: string; expression: ReactionExpression; active: boolean; at: number; source_kind?: string; text?: string; restricted: boolean }
export interface ReactionHistoryPage { items: ReactionHistoryEvent[]; before_at?: number; before_id?: string; has_more: boolean }
export interface ReactionReceivedEvent extends ReactionHistoryEvent { actor_user_id: number; private: boolean; target?: ReactionTargetRef }
export interface ReactionReceivedPage { items: ReactionReceivedEvent[]; before_at?: number; before_id?: string; has_more: boolean }
export interface ReactionHistoryPolicy { revision: number; locked: boolean }
export interface ReactionHistoryPolicyResult { outcome: 'updated' | 'unchanged' | 'revision_conflict'; policy: ReactionHistoryPolicy }
export type ReactionResponse<R extends ReactionRequest> = R extends { action: 'notifications' } ? ReactionNotificationPage : R extends { action: 'notifications-read' } ? { ok: boolean } : R extends { action: 'query' } ? { items: ReactionSnapshot[] }
  : R extends { action: 'set' } ? ReactionSetResult : R extends { action: 'actors' } ? ReactionActorPage
  : R extends { action: 'groups' } ? ReactionGroupPage : R extends { action: 'received' } ? ReactionReceivedPage : R extends { action: 'history-policy-query' } ? ReactionHistoryPolicy : R extends { action: 'history-policy-set' } ? ReactionHistoryPolicyResult : R extends { action: 'history' } ? ReactionHistoryPage : R extends { action: 'library-query' } ? ReactionLibrary : ReactionLibraryResult
export type ReactionRequest = { accountKey: string } & (
 | { action: 'notifications'; after_id?: string; limit: number }
 | { action: 'notifications-read'; items: { id: string; revision: number }[] }
 | { action: 'query'; targets: ReactionTargetRef[] }
 | { action: 'set'; target: ReactionTargetRef; expression: ReactionExpression; active: boolean; expected_revision: number; request_id: string }
 | { action: 'actors'; target: ReactionTargetRef; key: string; after_user_id: number; limit: number }
 | { action: 'groups'; target: ReactionTargetRef; after_key: string; limit: number }
 | { action: 'history'; start_at: number; end_at: number; before_at?: number; before_id?: string; limit: number }
 | { action: 'received'; before_at?: number; before_id?: string; limit: number; world_only: boolean }
 | { action: 'history-policy-query' }
 | { action: 'history-policy-set'; expected_revision: number; locked: boolean }
 | { action: 'library-query' }
 | { action: 'library-set'; items: ReactionExpression[]; expected_revision: number; request_id: string }
)

export interface ReactionNotification {
 id: string; revision: number; actorUserId: number; sourceKey: string; itemUid: string; recordOwnerUserId: number; sendAtMillis: number; text: string; selections: ReactionSelection[]
}
export interface ReactionNotificationPage { items: ReactionNotification[]; after_id: string; has_more: boolean }
