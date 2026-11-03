/** Frozen, owner-verified Arko result referenced by an actual user reply. */
export interface ArkmeThoughtReplySnapshot {
  thoughtId: string
  recordUid: string
  generation: number
  visibility: 'user' | 'members'
  content: string
}
export function thoughtReplyFromWire(value: unknown): ArkmeThoughtReplySnapshot | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  if (row.version !== 1 || !['record', 'chat'].includes(String(row.kind))
    || typeof row.thought_id !== 'string' || !row.thought_id || row.thought_id.length > 256
    || typeof row.record_uid !== 'string' || !row.record_uid || row.record_uid.length > 256
    || !Number.isSafeInteger(row.generation) || Number(row.generation) <= 0
    || !['user', 'members'].includes(String(row.visibility))
    || typeof row.content !== 'string' || !row.content.trim() || row.content.length > 131_072) return undefined
  return { thoughtId: row.thought_id, recordUid: row.record_uid, generation: Number(row.generation),
    visibility: row.visibility as 'user' | 'members', content: row.content }
}
