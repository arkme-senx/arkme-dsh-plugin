/** Proposed view contract. No endpoint is implied; Chat remains the timeline owner. */
export interface OfflineContextEvidence {
  id: string
  startAtMillis: number
  endAtMillis: number
  speaker: string
  text: string
  soundSource: 'in_person' | 'playback' | 'unknown'
  /** Host-issued references, never raw object-store URLs or inferred identities. */
  transcriptRef?: string
  playbackRef?: string
}

export interface OfflineContextMessage {
  messageRef: string
  label: string
  excerpt: string
  occurredAtMillis: number
}

export interface OfflineContextEntry {
  id: string
  revision: string
  conversationKey: string
  conversationName: string
  conversationKind: 'private_chat' | 'group_chat'
  startAtMillis: number
  endAtMillis: number
  title: string
  summary: string[]
  participants: string[]
  reason: string
  state: 'suggested' | 'linked' | 'dismissed'
  visibility: 'private' | 'shared'
  sourceState: 'available' | 'changed' | 'unavailable'
  messages: OfflineContextMessage[]
  evidence: OfflineContextEvidence[]
  selectedEvidenceIds: string[]
}

export type OfflineContextChange =
  | { kind: 'confirm' }
  | { kind: 'dismiss'; reason: 'unrelated' | 'playback' | 'remove' }
  | { kind: 'restore' }
  | { kind: 'range'; evidenceIds: string[] }
  | { kind: 'relink'; messageRef: string }
  | { kind: 'share'; includeTranscript: boolean }

export interface OfflineContextAction {
  requestId: string
  entryId: string
  expectedRevision: string
  conversationKey: string
  change: OfflineContextChange
}

/** An ambiguous write cannot be treated as failure or automatically replayed. */
export type OfflineContextReceipt = { status: 'applied' } | { status: 'unknown' }
export interface OfflineContextActions {
  change(action: OfflineContextAction): Promise<OfflineContextReceipt>
  reconcile(action: OfflineContextAction): Promise<'applied' | 'not_applied' | 'pending'>
  openMessage(messageRef: string): void | Promise<void>
  openTranscript(transcriptRef: string): void | Promise<void>
  play(playbackRef: string): void | Promise<void>
}

export function selectedOfflineEvidence(entry: OfflineContextEntry): OfflineContextEvidence[] {
  const ids = new Set(entry.selectedEvidenceIds)
  return entry.evidence.filter(item => ids.has(item.id)).sort((a, b) => a.startAtMillis - b.startAtMillis)
}

/** Select a continuous speech range; UI never guesses a new source interval. */
export function offlineEvidenceRange(entry: OfflineContextEntry, first: string, last: string): string[] {
  const start = entry.evidence.findIndex(item => item.id === first)
  const end = entry.evidence.findIndex(item => item.id === last)
  if (start < 0 || end < start) return []
  return entry.evidence.slice(start, end + 1).map(item => item.id)
}

export function canShareOfflineContext(entry: OfflineContextEntry): boolean {
  const evidence = selectedOfflineEvidence(entry)
  return entry.state === 'linked' && entry.visibility === 'private' && entry.sourceState === 'available'
    && evidence.length > 0 && evidence.length === new Set(entry.selectedEvidenceIds).size
    && evidence.every(item => item.soundSource !== 'playback')
}

/** Provisional candidates stay outside the confirmed timeline. Identities are scoped by the caller. */
export function confirmedOfflineContexts(entries: readonly OfflineContextEntry[], conversationKey: string): OfflineContextEntry[] {
  const unique = new Map<string, OfflineContextEntry>()
  for (const entry of entries) {
    if (entry.conversationKey === conversationKey) unique.set(entry.id, entry)
  }
  return [...unique.values()].filter(entry => entry.state === 'linked')
    .sort((a, b) => a.startAtMillis - b.startAtMillis || a.id.localeCompare(b.id))
}
