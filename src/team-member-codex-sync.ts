/** Team-scoped presentation, not account history or permission to read a task. */
export type TeamMemberCodexSync =
  | { state: 'not_connected'; hasConversations: false; canViewConversations: false }
  | { state: 'enabled' | 'paused' | 'disabled'; hasConversations: boolean; canViewConversations: boolean }
  | { state: 'unavailable'; reason: 'unsupported' | 'failed' | 'invalid' }

/** Optional v1 extension to team/members/list. Missing data never means not connected. */
export function readTeamMemberCodexSync(value: unknown): TeamMemberCodexSync {
  if (value === undefined || value === null) return { state: 'unavailable', reason: 'unsupported' }
  const invalid = { state: 'unavailable', reason: 'invalid' } as const
  if (typeof value !== 'object' || Array.isArray(value)) return invalid
  const data = value as Record<string, unknown>
  if (data.version !== 1) return invalid
  if (data.state === 'unavailable') return { state: 'unavailable', reason: 'failed' }
  if (typeof data.has_conversations !== 'boolean' || typeof data.can_view_conversations !== 'boolean') return invalid
  if (data.state === 'not_connected') return !data.has_conversations && !data.can_view_conversations
    ? { state: 'not_connected', hasConversations: false, canViewConversations: false } : invalid
  if (data.state !== 'enabled' && data.state !== 'paused' && data.state !== 'disabled') return invalid
  return { state: data.state, hasConversations: data.has_conversations, canViewConversations: data.can_view_conversations }
}
