import type { ArkmeSourceSendResult, ArkmeTimelineItem } from '../types.js'
import type { ArkmeUnifiedTimelineWindow } from '../unified-chat-timeline.js'
import { ConfirmedSendRetentionOwner } from './confirmed-send-retention.js'
import { ARKME_CONVERSATION_TIMELINE_FRESH_MILLIS } from './conversation-memory-cache.js'
import { compareTimelineMessages } from './timeline-message-order.js'
import { retainPartialTimelineMedia } from './timeline-media.js'

// UI-only metadata survives immutable item updates but is never serialized to Host/cache APIs.
const presentationKey = Symbol('conversation-message-presentation')
const sendFailure = Symbol('conversation-message-send-failure')
const localSubmission = Symbol('conversation-message-local-submission')
interface SendFailure { state: 'failed' | 'uncertain'; message: string }
type PresentedMessage = ArkmeTimelineItem & { [presentationKey]?: string; [sendFailure]?: SendFailure | undefined; [localSubmission]?: true | undefined }
function messagePresentation(item: ArkmeTimelineItem): Pick<PresentedMessage, typeof presentationKey | typeof localSubmission> {
  const key = (item as PresentedMessage)[presentationKey]
  return key === undefined ? {} : { [presentationKey]: key, [localSubmission]: (item as PresentedMessage)[localSubmission] }
}
export function conversationMessageRenderKey(item: ArkmeTimelineItem): string {
  return (item as PresentedMessage)[presentationKey] ?? `message:${item.timelineEventId ?? item.itemUid}`
}
export function conversationMessageSendFailure(item: ArkmeTimelineItem): SendFailure | undefined {
  return (item as PresentedMessage)[sendFailure]
}
export function conversationMessageDefaultUnread(item: ArkmeTimelineItem): boolean {
  return (item as PresentedMessage)[localSubmission] === true && item.status >= 0 && conversationMessageSendFailure(item) === undefined
}

export function mergeConversationMessages(current: ArkmeTimelineItem[], incoming: ArkmeTimelineItem[]): ArkmeTimelineItem[] {
  const identity = (item: ArkmeTimelineItem) => item.timelineEventId ?? item.itemUid
  const map = new Map<string, PresentedMessage>(current.map(item => [identity(item), item]))
  for (const item of incoming) {
    const key = identity(item)
    const previous = map.get(key) ?? map.get(item.itemUid)
    const version = item.recordVersion ?? item.version ?? 0
    const previousVersion = previous?.recordVersion ?? previous?.version ?? 0
    // Live deltas and reads may arrive out of order. Keep the authoritative
    // record snapshot and its matching action reference together.
    if (previous?.status === 1 && item.status === 1 && version > 0 && previousVersion > 0
      && previousVersion > version) continue
    if (previous && identity(previous) !== key) map.delete(identity(previous))
    map.set(key, {
      ...retainPartialTimelineMedia(previous, item),
      ...messagePresentation(previous ?? item),
      [sendFailure]: item.status === 1 ? undefined : sendFailure in item ? conversationMessageSendFailure(item)
        : previous ? conversationMessageSendFailure(previous) : undefined,
      ...(previous?.aiPolish !== undefined && item.aiPolish === undefined ? { aiPolish: previous.aiPolish } : {}),
      ...(previous?.recordDurationMillis !== undefined && item.recordDurationMillis === undefined
        ? { recordDurationMillis: previous.recordDurationMillis } : {}),
      ...(previous?.editDurationMillis !== undefined && item.editDurationMillis === undefined
        ? { editDurationMillis: previous.editDurationMillis } : {}),
      ...(previous?.captureContext !== undefined && item.captureContext === undefined
        ? { captureContext: previous.captureContext } : {}),
      ...(previous?.locationCapture !== undefined && item.locationCapture === undefined
        ? { locationCapture: previous.locationCapture } : {}),
      ...(previous?.messageActionRef !== undefined && item.messageActionRef === undefined
        ? { messageActionRef: previous.messageActionRef } : {}),
      ...(previous?.mentions !== undefined && item.mentions === undefined
        ? { mentions: previous.mentions } : {}),
      ...(previous?.selfRole !== undefined && item.selfRole === undefined
        ? { selfRole: previous.selfRole } : {}),
    })
  }
  return [...map.values()].sort(compareTimelineMessages)
}

export function applyConversationSendResult(
  current: ArkmeTimelineItem[],
  optimisticItemUid: string,
  result: ArkmeSourceSendResult,
  fallback?: ArkmeTimelineItem,
): ArkmeTimelineItem[] {
  const returned = current.find(item => item.itemUid === result.itemUid)
  const optimistic = current.find(item => item.itemUid === optimisticItemUid)
  const candidate = returned ?? optimistic ?? fallback
  if (candidate === undefined) return current
  const { aiPolish: _optimisticAiPolish, ...candidateBase } = candidate
  const base = {
    ...candidateBase,
    ...(candidate.recordDurationMillis === undefined && optimistic?.recordDurationMillis !== undefined
      ? { recordDurationMillis: optimistic.recordDurationMillis } : {}),
    ...(candidate.editDurationMillis === undefined && optimistic?.editDurationMillis !== undefined
      ? { editDurationMillis: optimistic.editDurationMillis } : {}),
    ...(candidate.captureContext === undefined && optimistic?.captureContext !== undefined
      ? { captureContext: optimistic.captureContext } : {}),
    ...(candidate.mentions === undefined && optimistic?.mentions !== undefined
      ? { mentions: optimistic.mentions } : {}),
    ...(candidate.selfRole === undefined && optimistic?.selfRole !== undefined
      ? { selfRole: optimistic.selfRole } : {}),
  }
  const confirmed: PresentedMessage = {
    ...base,
    [localSubmission]: result.localState === 'failed' ? undefined : (base as PresentedMessage)[localSubmission],
    itemUid: result.itemUid,
    status: result.status,
    ...(result.messageActionRef === undefined ? {} : { messageActionRef: result.messageActionRef }),
    ...(result.recordTopicAssignmentRef === undefined ? {} : { recordTopicAssignmentRef: result.recordTopicAssignmentRef }),
    ...(result.sequence === undefined ? {} : { sequence: result.sequence }),
    ...(result.aiPolish === undefined ? {} : {
      aiPolish: result.aiPolish,
      ...(result.aiPolish.state === 'polished' && result.aiPolish.polishedText !== undefined
        ? { textContent: result.aiPolish.polishedText }
        : {}),
    }),
  }
  return mergeConversationMessages(
    current.filter(item => item.itemUid !== optimisticItemUid && item.itemUid !== result.itemUid),
    [confirmed],
  )
}


interface Submission {
  sourceKey: string
  originalUid: string
  relationUid?: string
  item: ArkmeTimelineItem
  pending: boolean
  removed?: boolean
  expiresAtMillis: number
}

/** One account-scoped merge owner for local sends, receipts, live deltas and read snapshots. */
export class ArkmeConversationMessageMergeOwner extends ConfirmedSendRetentionOwner<ArkmeTimelineItem> {
  private readonly submissions = new Map<string, Submission>()
  constructor(private readonly capacity = 64) {
    super({ maxItems: capacity, ttlMillis: ARKME_CONVERSATION_TIMELINE_FRESH_MILLIS * 4,
      key: item => item.itemUid, canRetain: item => item.isMe && item.status >= 0,
      isAuthoritative: item => item.messageActionRef !== undefined, merge: mergeConversationMessages })
  }

  assertCanBegin(now = Date.now()): void {
    this.prune(now)
    if (this.submissions.size >= this.capacity && [...this.submissions.values()].every(entry => entry.pending)) {
      throw new Error('正在发送的消息较多，请等待发送完成后再试')
    }
  }

  begin(sourceKey: string, item: ArkmeTimelineItem, relationUid?: string): ArkmeTimelineItem {
    this.assertCanBegin()
    while (this.submissions.size >= this.capacity) {
      const completed = [...this.submissions].find(([, entry]) => !entry.pending)
      if (!completed) break
      this.submissions.delete(completed[0])
    }
    const previous = this.submissions.get(`${sourceKey}\0${item.itemUid}`)
    const presented = { ...item, [presentationKey]: conversationMessageRenderKey(previous?.item ?? item), [sendFailure]: undefined, [localSubmission]: true as const }
    this.submissions.set(`${sourceKey}\0${item.itemUid}`, {
      sourceKey, originalUid: item.itemUid, item: presented, pending: true, expiresAtMillis: Infinity,
      ...(relationUid === undefined ? {} : { relationUid }),
    })
    return presented
  }

  /** ACK can arrive after a read or live delta. Always upsert and keep newer record content. */
  confirm(sourceKey: string, originalUid: string, result: ArkmeSourceSendResult,
    fallback: ArkmeTimelineItem, current: ArkmeTimelineItem[]): ArkmeTimelineItem[] {
    const entry = this.submissions.get(`${sourceKey}\0${originalUid}`)
    if (entry?.removed) { this.submissions.delete(`${sourceKey}\0${originalUid}`); return current }
    const local = entry ? mergeConversationMessages([fallback], [entry.item])[0]! : fallback
    const updated = applyConversationSendResult([local], local.itemUid, result, fallback)[0]!
    const existing = current.find(item => local.timelineEventId
      ? item.timelineEventId === local.timelineEventId
      : item.itemUid === result.itemUid && (!entry?.relationUid || item.timelineOrderTie === entry.relationUid))
    const canonical = existing?.timelineEventId ? existing : local.timelineEventId ? local : undefined
    const confirmed = canonical ? mergeConversationMessages([updated], [canonical])[0]! : updated
    if (entry) {
      entry.item = confirmed
      entry.pending = false
      entry.expiresAtMillis = Date.now() + ARKME_CONVERSATION_TIMELINE_FRESH_MILLIS * 4
    } else if (result.localState === 'synced') super.retain(sourceKey, confirmed)
    return mergeConversationMessages(current.filter(item => item.timelineEventId
      || item.itemUid !== originalUid && item.itemUid !== result.itemUid), [confirmed])
  }

  /** Transfer to the durable file owner, or cancel a failed/cancelled request. */
  releasePending(sourceKey: string, originalUid: string): void {
    const key = `${sourceKey}\0${originalUid}`
    if (this.submissions.get(key)?.pending) this.submissions.delete(key)
  }

  fail(sourceKey: string, originalUid: string, message: string, uncertain: boolean, current: ArkmeTimelineItem[]): ArkmeTimelineItem[] {
    const entry = this.submissions.get(`${sourceKey}\0${originalUid}`)
    if (!entry || entry.removed) { this.releasePending(sourceKey, originalUid); return current }
    entry.pending = false
    // A live canonical message is stronger evidence than a lost HTTP response.
    if (entry.item.status !== 1 || !entry.item.timelineEventId) {
      entry.item = { ...entry.item, [sendFailure]: { state: uncertain ? 'uncertain' : 'failed', message } } as PresentedMessage
    }
    entry.expiresAtMillis = entry.item.status === 1 ? Date.now() + ARKME_CONVERSATION_TIMELINE_FRESH_MILLIS * 4 : Infinity
    return mergeConversationMessages(current, [entry.item])
  }

  override forget(sourceKey: string, ids: readonly string[]): void {
    super.forget(sourceKey, ids)
    const removed = new Set(ids)
    for (const [key, entry] of this.submissions) {
      if (entry.sourceKey === sourceKey && (removed.has(entry.originalUid) || removed.has(entry.item.itemUid))) {
        if (entry.pending) entry.removed = true
        else this.submissions.delete(key)
      }
    }
  }

  removeOccurrences(sourceKey: string, keys: ReadonlySet<string>): void {
    for (const [key, entry] of this.submissions) {
      if (entry.sourceKey === sourceKey && keys.has(entry.item.timelineItemKey ?? '')) {
        super.forget(sourceKey, [entry.originalUid, entry.item.itemUid])
        if (entry.pending) entry.removed = true
        else this.submissions.delete(key)
      }
    }
  }

  override clear(): void { super.clear(); this.submissions.clear() }

  override merge(sourceKey: string, incoming: ArkmeTimelineItem[], now = Date.now(),
    previous: readonly ArkmeTimelineItem[] = [], window?: ArkmeUnifiedTimelineWindow): ArkmeTimelineItem[] {
    this.prune(now)
    const incomingIds = new Set(incoming.map(item => item.timelineEventId ?? item.itemUid))
    const matchingPrevious = previous.filter(item => incomingIds.has(item.timelineEventId ?? item.itemUid))
    const authoritative = mergeConversationMessages(matchingPrevious, incoming)
    const byEvent = new Map(authoritative.map(item => [item.timelineEventId, item]))
    const byRelation = new Map(authoritative.filter(item => item.timelineOrderTie).map(item => [item.timelineOrderTie, item]))
    const byUid = new Map<string, ArkmeTimelineItem | undefined>()
    for (const item of authoritative) byUid.set(item.itemUid, byUid.has(item.itemUid) ? undefined : item)
    const local: ArkmeTimelineItem[] = []
    const ready = window?.sources.some(source => source.source === 'messages' && source.status === 'ready')
    const sequences = incoming.flatMap(item => (item.sequence ?? 0) > 0 ? [item.sequence!] : [])
    const first = Math.min(...sequences), last = Math.max(0, ...sequences)
    for (const [key, entry] of this.submissions) {
      if (entry.sourceKey !== sourceKey || entry.removed) continue
      const match = entry.item.timelineEventId ? byEvent.get(entry.item.timelineEventId)
        : (entry.relationUid ? byRelation.get(entry.relationUid) : undefined)
          ?? byUid.get(entry.item.itemUid) ?? byUid.get(entry.originalUid)
      if (match) {
        const merged = mergeConversationMessages([{ ...entry.item, itemUid: match.itemUid }], [match])[0]!
        entry.item = merged
        const index = authoritative.indexOf(match)
        authoritative[index] = merged
      } else {
        // A stale tail is not deletion. Only complete coverage or an explicit removal can retire it.
        const sequence = entry.item.sequence ?? 0
        if (!entry.pending && ready && sequence > 0 && sequence >= first && sequence <= last) {
          super.forget(sourceKey, [entry.originalUid, entry.item.itemUid])
          this.submissions.delete(key)
          continue
        }
        // This is a local receipt overlay, not an additional canonical/history window.
        const { timelineEventId: _event, ...overlay } = entry.item
        local.push(overlay)
      }
    }
    return mergeConversationMessages(local, super.merge(sourceKey, authoritative, now))
  }

  private prune(now: number): void {
    for (const [key, entry] of this.submissions) if (!entry.pending && entry.expiresAtMillis <= now) this.submissions.delete(key)
  }
}
