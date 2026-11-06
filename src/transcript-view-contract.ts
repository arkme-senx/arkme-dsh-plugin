import type { LocalTranscriptEntry } from './local-transcript-state.js'
import { readMessageQuote, type ArkmeMessageQuote } from './message-quote.js'
export interface TranscriptViewTarget {
  kind: 'recording' | 'call'
  source_uid: string
  segment_uid: string
}
export type TranscriptViewReference =
  | { kind: 'recording'; itemRef: string }
  | { kind: 'call'; callRef: string; target: TranscriptViewTarget }
export type TranscriptViewSourceReference =
  | TranscriptViewReference
  | { kind: 'recording'; sessionRef: string }
  | { kind: 'call'; callRef: string }
export interface TranscriptViewCommand {
  operation_id: string
  expected_revision: number
  original_version: string
  action:
    | 'replace'
    | 'restore'
    | 'add_mark'
    | 'remove_mark'
    | 'import'
    | 'retry_pending'
  anchor?: ArkmeMessageQuote
  replacement?: string
  annotation_id?: string
  import_text?: string
  import_marks?: Array<{ id: string; anchor: ArkmeMessageQuote }>
}
export interface TranscriptViewSnapshot extends TranscriptViewTarget {
  revision: number
  original_version: string
  original_digest: string
  original: string
  text: string
  marks: Array<{
    id: string
    anchor: ArkmeMessageQuote
    state: 'available' | 'stale'
  }>
  original_changed: boolean
  previous_text?: string
  complete: true
}
export interface PersonalTranscriptEntry extends LocalTranscriptEntry {
  originalVersion: string
  originalDigest: string
  originalChanged: boolean
  previousText?: string
  legacy?: LocalTranscriptEntry
  pendingCommand?: TranscriptViewCommand
}
export interface TranscriptViewReceipt {
  operation_id: string
  accepted_revision: number
  accepted_at: number
  target: TranscriptViewTarget
}
export interface TranscriptViewAttempt {
  fingerprint: string
  target: TranscriptViewTarget
  command: TranscriptViewCommand
}
export interface TranscriptViewReadItem {
  id: string
  ref: string
  knownRevision?: number
  knownOriginalVersion?: string
  knownPendingOperationId?: string
}
export function personalTranscriptEntry(
  snapshot: TranscriptViewSnapshot,
  userId: number,
): PersonalTranscriptEntry {
  if (
    !snapshot ||
    snapshot.complete !== true ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 0 ||
    typeof snapshot.original !== 'string' ||
    typeof snapshot.text !== 'string' ||
    !Array.isArray(snapshot.marks) ||
    snapshot.marks.length > 500 ||
    typeof snapshot.original_changed !== 'boolean' ||
    typeof snapshot.original_version !== 'string' ||
    !snapshot.original_version ||
    snapshot.original_version.length > 512 ||
    !/^[a-f0-9]{64}$/.test(snapshot.original_digest)
  )
    throw new Error('转写更正响应无效')
  if (
    new Set(snapshot.marks.map((mark) => mark.id)).size !==
      snapshot.marks.length ||
    snapshot.marks.some(
      (mark) =>
        !mark ||
        typeof mark.id !== 'string' ||
        !mark.id ||
        !['available', 'stale'].includes(mark.state) ||
        !readMessageQuote(mark.anchor),
    )
  )
    throw new Error('转写标记响应无效')
  return {
    revision: snapshot.revision,
    original: snapshot.original,
    text: snapshot.text,
    originalVersion: snapshot.original_version,
    originalDigest: snapshot.original_digest,
    originalChanged: snapshot.original_changed,
    ...(typeof snapshot.previous_text === 'string'
      ? { previousText: snapshot.previous_text }
      : {}),
    marks: snapshot.marks.map((mark) => ({
      ...mark,
      actorId: userId,
      actorName: '你',
      mine: true,
    })),
  }
}

export interface TranscriptViewSavedPage {
  historical: true
  items: Array<
    TranscriptViewTarget & {
      revision: number
      original_version: string
      original: string
      text: string
      marks: TranscriptViewSnapshot['marks']
    }
  >
  next_cursor: string
}
export interface TranscriptViewPort {
  transcriptViewCapabilities(signal?: AbortSignal): Promise<{
    protocol_version: number
    supported: boolean
    max_batch: number
    accountKey: string
  }>
  readTranscriptViews(
    account: string,
    scope: string,
    items: TranscriptViewReadItem[],
    signal?: AbortSignal,
  ): Promise<Record<string, PersonalTranscriptEntry>>
  changeTranscriptView(
    account: string,
    ref: string,
    input: TranscriptViewCommand,
    signal?: AbortSignal,
  ): Promise<PersonalTranscriptEntry>
  savedTranscriptViews(
    account: string,
    ref: string,
    after?: string,
    signal?: AbortSignal,
  ): Promise<TranscriptViewSavedPage>
  transcriptViewReceipt(
    account: string,
    operationId: string,
    signal?: AbortSignal,
  ): Promise<{ receipt: TranscriptViewReceipt | null }>
  importLocalTranscriptView(
    account: string,
    scope: string,
    item: TranscriptViewReadItem,
    operationId: string,
    signal?: AbortSignal,
  ): Promise<PersonalTranscriptEntry>
}

export function transcriptViewStableJSON(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v !== null && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, item]) => item !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, canonical(item)]),
          )
        : v
  return JSON.stringify(canonical(value))
}
