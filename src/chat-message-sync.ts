import type { ArkmeUnifiedTimelineEvent } from './unified-chat-timeline.js'

/** Public facts. Counts describe one frozen cohort, never read acknowledgements. */
export interface ArkmeMessageSyncProgress {
  accountKey: string
  cycle: number
  revision: number
  phase: 'idle' | 'discovering' | 'syncing' | 'paused' | 'unsupported'
  completed: number
  total: number
  pending: number
  terminal: number
  retryAtMillis?: number
  reason?: 'network' | 'storage' | 'authentication' | 'upstream' | 'capacity'
}

export type ChatSyncState = 'available' | 'removed' | 'restricted' | 'pending' | 'missing'
export interface ChatSyncWork {
  id: string; revision: number; version: number; state: ChatSyncState; sequence: number; unread: boolean
  eventId?: string
  itemKey?: string
  event?: ArkmeUnifiedTimelineEvent
}
export interface ChatSyncSession {
  uid: string; kind: number; membership: number; accessible: boolean; complete: boolean
  position: Record<string, unknown>; cacheRequired: boolean; work: ChatSyncWork[]
  scope?: string; sourceKey?: string
}
export interface ChatSyncPage {
  checkpoint: string; hasMore: boolean; retry: boolean; manifest: boolean; sessions: ChatSyncSession[]
  /** Raw authorized bodies exist only between transport and Host projection. */
  bodies: Map<string, Record<string, unknown>[]>
}
export interface ChatSyncPlan { progress: ArkmeMessageSyncProgress; checkpoint: string; epoch: number; active: boolean }
export interface ChatSyncBatch { uid: string; kind: number; membership: number; work: ChatSyncWork[] }
export interface ChatSyncLocalPage { events: ArkmeUnifiedTimelineEvent[]; before?: number; revision: number }
export type ChatSyncCommand =
  | { action: 'begin'; account: string }
  | { action: 'status'; account: string }
  | { action: 'ack'; account: string; sourceKey: string; through: number }
  | { action: 'manifest' | 'commit'; account: string; epoch: number; expectedCheckpoint: string; page: Omit<ChatSyncPage, 'bodies'>; ticket: number; now: number }
  | { action: 'freeze' | 'finish'; account: string; epoch: number }
  | { action: 'pending'; account: string; epoch: number; now: number; limit: number }
  | { action: 'ranges'; account: string; epoch: number }
  | { action: 'read'; scope: string; anchorId?: string; limit: number; before?: number }

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid message sync object')
  return value as Record<string, unknown>
}
const integer = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('Invalid message sync number')
  return Number(value)
}
const text = (value: unknown, max = 256): string => {
  if (typeof value !== 'string' || !value || value.length > max) throw new Error('Invalid message sync identity')
  return value
}
const bool = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw new Error('Invalid message sync flag')
  return value
}
export function parseChatSyncPage(raw: unknown, manifest: boolean): ChatSyncPage {
  const data = object(raw)
  if ((data.manifest_only === true) !== manifest || !Array.isArray(data.sessions) || data.sessions.length > 50) throw new Error('Invalid message sync page')
  const page: ChatSyncPage = { checkpoint: text(data.checkpoint, 2 * 1024 * 1024), hasMore: bool(data.has_more), retry: bool(data.retry), manifest, sessions: [], bodies: new Map() }
  const seen = new Set<string>(); let count = 0
  for (const rawSession of data.sessions) {
    const value = object(rawSession), position = object(value.position)
    const uid = text(value.chat_session_uid), accessible = bool(value.accessible)
    if (seen.has(uid)) throw new Error('Duplicate message sync session')
    seen.add(uid)
    const kind = integer(value.session_kind), membership = integer(value.membership_version)
    if (accessible && ![1, 2, 3].includes(kind)) throw new Error('Invalid message sync session kind')
    integer(position.cursor); bool(position.initialized)
    const cacheRequired = value.cache_required === true
    if (value.cache_required !== undefined) bool(value.cache_required)
    if (cacheRequired && (!manifest || !accessible || value.complete !== false || position.initialized !== false || !page.hasMore)) throw new Error('Invalid message sync cache recovery')
    const rows = manifest ? value.manifest ?? [] : value.items
    if (!Array.isArray(rows) || (!accessible || cacheRequired) && rows.length) throw new Error('Invalid message sync identities')
    count += rows.length
    if (count > (manifest ? 1000 : 100)) throw new Error('Message sync page exceeds capacity')
    const ids = new Set<string>()
    const work = rows.map(rawWork => {
      const item = object(rawWork), id = text(item.rel_uid), state = item.state as ChatSyncState
      if (ids.has(id) || !['available', 'removed', 'restricted', 'pending', 'missing'].includes(state)) throw new Error('Invalid message sync work')
      ids.add(id)
      if (!manifest && state === 'available' && (!item.relation || !item.record || object(item.relation).rel_uid !== id)) throw new Error('Missing message sync body')
      return { id, state, revision: integer(item.revision), version: integer(item.record_version),
        sequence: integer(item.seq ?? (item.relation ? object(item.relation).seq : 0) ?? 0), unread: bool(item.unread ?? true) }
    })
    page.sessions.push({ uid, kind, membership, accessible, complete: bool(value.complete), position, cacheRequired, work })
    if (!manifest) page.bodies.set(uid, rows.map(object))
  }
  return page
}
