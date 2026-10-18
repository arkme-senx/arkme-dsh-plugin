import { readMessageQuote, type ArkmeMessageQuote } from './message-quote.js'

export interface MessageUnderline {
  id: string
  actorId: number
  actorName: string
  mine: boolean
  anchor: ArkmeMessageQuote
  state: 'available' | 'stale'
  pending?: boolean
}
export interface MessageUnderlineSnapshot { revision: number; accessible: boolean; items: MessageUnderline[] }
export interface MessageUnderlineCapabilities { supported: boolean; maxLength: number; storage?: 'local' | 'cloud' }
export type MessageUnderlineChange = { operationId: string; kind: 'add'; anchor: ArkmeMessageQuote }
  | { operationId: string; kind: 'remove'; annotationId: string }
const idPattern = /^[A-Za-z0-9._:-]{1,128}$/u
export function underlineId(value: unknown): value is string { return typeof value === 'string' && idPattern.test(value) }
export function underlineCapabilities(value: unknown): MessageUnderlineCapabilities {
  const v = value as Record<string, unknown> | undefined
  return { supported: v?.enabled === true && v.protocol_version === 1 && v.projection === 'arkme-text-v1'
    && Number.isSafeInteger(v.max_length) && Number(v.max_length) > 0,
  maxLength: Number.isSafeInteger(v?.max_length) ? Math.max(0, Math.min(2000, Number(v?.max_length))) : 0 }
}
/** Complete, permission-checked snapshots only. The actor cannot choose whether a mark is mine. */
export function readUnderlineSnapshot(value: unknown, viewerId: number): MessageUnderlineSnapshot {
  const v = value as Record<string, unknown> | undefined
  if (!v || v.complete !== true || !Number.isSafeInteger(v.revision) || Number(v.revision) < 0 || typeof v.accessible !== 'boolean') throw new Error('标记响应不完整，请重试')
  if (!v.accessible) return { revision: Number(v.revision), accessible: false, items: [] }
  if (!Array.isArray(v.annotations) || v.annotations.length > 500) throw new Error('标记响应不完整，请重试')
  const seen = new Set<string>()
  const items = v.annotations.map(raw => {
    const a = raw as Record<string, unknown>
    const anchor = readMessageQuote(a.anchor)
    if (!underlineId(a.annotation_uid) || seen.has(a.annotation_uid) || !Number.isSafeInteger(a.actor_user_id) || Number(a.actor_user_id) <= 0
      || typeof a.actor_name !== 'string' || !a.actor_name.trim() || a.actor_name.length > 100
      || !anchor || (a.state !== 'available' && a.state !== 'stale')) throw new Error('标记响应无效，请重试')
    seen.add(a.annotation_uid)
    return { id: a.annotation_uid, actorId: Number(a.actor_user_id), actorName: a.actor_name,
      mine: Number(a.actor_user_id) === viewerId, anchor, state: a.state } as MessageUnderline
  })
  return { revision: Number(v.revision), accessible: true, items }
}

/** Newer reads never replace a pending write, and older revisions never resurrect removed marks. */
export function acceptUnderlineSnapshot(previous: MessageUnderlineSnapshot | undefined, next: MessageUnderlineSnapshot, pending = false) {
  if (!next.accessible) return { ...next, items: [] }
  return pending || (previous && previous.revision > next.revision) ? previous : next
}
