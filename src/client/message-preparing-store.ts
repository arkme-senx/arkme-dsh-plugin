import type { ArkmeChatClientEvent } from '../types.js'

type PreparingHint = Extract<ArkmeChatClientEvent, { type: 'message-preparing' }>
type MessageArrived = Extract<ArkmeChatClientEvent, { type: 'message-arrived' }>

interface Entry {
  sourceKey: string
  actorKey: string
  version: number
  eventAt: number
  retainUntil: number
  messageArrivedOrder?: ChatStreamOrder
  hint?: PreparingHint
}

interface ChatStreamOrder {
  generation: number
  revision: number
}

const MAX_ENTRIES = 256
const MAX_ACTIVE_MS = 30_000
const MARKER_TTL_MS = 30_000

export class ArkmeMessagePreparingStore {
  private accountScope: string | undefined
  private readonly entries = new Map<string, Entry>()
  private readonly listeners = new Set<() => void>()
  private revision = 0
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly now = () => Date.now()) {}

  activateAccount(scope: string | undefined): void {
    if (this.accountScope === scope) return
    this.accountScope = scope
    this.reset()
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  readonly getSnapshot = (): number => this.revision

  get(sourceKey: string, accountScope = this.accountScope): readonly PreparingHint[] {
    if (accountScope === undefined || accountScope !== this.accountScope) return []
    return [...this.entries.values()].flatMap(entry => entry.sourceKey === sourceKey
      && entry.hint !== undefined && entry.hint.expireAtMillis > this.now() ? [entry.hint] : [])
      .sort((left, right) => right.eventAtMillis - left.eventAtMillis || left.actorKey.localeCompare(right.actorKey))
  }

  apply(hint: PreparingHint): void {
    if (this.accountScope === undefined || !validIdentity(hint)
      || ![hint.prepareAtMillis, hint.expireAtMillis, hint.stateVersion, hint.eventAtMillis]
        .every(value => Number.isSafeInteger(value) && value > 0)
      || (hint.preparingState !== 1 && hint.preparingState !== 2)
      || hint.expireAtMillis < hint.prepareAtMillis
      || hint.eventAtMillis > this.now() + MAX_ACTIVE_MS
      || !validChatStreamOrder(hint)) return
    const key = identity(hint)
    const previous = this.entries.get(key)
    if (previous?.messageArrivedOrder !== undefined
      && compareChatStreamOrder(chatStreamOrder(hint), previous.messageArrivedOrder) <= 0) return
    const canceled = hint.preparingState === 2
    if (previous !== undefined && (hint.stateVersion < previous.version
      || (hint.stateVersion === previous.version
        && (!canceled || previous.hint === undefined)
        && (previous.hint === undefined || hint.eventAtMillis <= previous.eventAt)))) return
    if (!canceled && hint.expireAtMillis <= this.now()) return
    const expireAt = Math.min(hint.expireAtMillis, this.now() + MAX_ACTIVE_MS)
    this.put(key, {
      sourceKey: hint.sourceKey, actorKey: hint.actorKey, version: hint.stateVersion, eventAt: hint.eventAtMillis,
      retainUntil: (canceled ? this.now() : expireAt) + MARKER_TTL_MS,
      ...(previous?.messageArrivedOrder === undefined ? {} : { messageArrivedOrder: previous.messageArrivedOrder }),
      ...(canceled ? {} : { hint: { ...hint, expireAtMillis: expireAt } }),
    })
  }

  messageArrived(event: MessageArrived): void {
    if (this.accountScope === undefined || !validIdentity(event)
      || !Number.isSafeInteger(event.revision) || event.revision < 0
      || !Number.isSafeInteger(event.eventAtMillis) || event.eventAtMillis <= 0
      || !validChatStreamOrder(event)) return
    const key = identity(event)
    const previous = this.entries.get(key)
    const arrivedOrder = chatStreamOrder(event)
    if (previous?.messageArrivedOrder !== undefined
      && compareChatStreamOrder(arrivedOrder, previous.messageArrivedOrder) <= 0) return
    // t17 event_at is not a preparing version. The Chat SSE order only fences
    // asynchronous Host projection: an older arrival cannot clear newer input,
    // while a delayed older input cannot revive after an observed message.
    if (previous?.hint !== undefined
      && compareChatStreamOrder(arrivedOrder, chatStreamOrder(previous.hint)) < 0) {
      this.put(key, { ...previous, messageArrivedOrder: arrivedOrder })
      return
    }
    this.put(key, {
      sourceKey: event.sourceKey, actorKey: event.actorKey,
      version: previous?.version ?? 0, eventAt: previous?.eventAt ?? event.eventAtMillis,
      retainUntil: this.now() + MARKER_TTL_MS, messageArrivedOrder: arrivedOrder,
    })
  }

  reset(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.entries.clear()
    this.notify()
  }

  private put(key: string, entry: Entry): void {
    this.entries.delete(key)
    this.entries.set(key, entry)
    if (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!)
    this.schedule()
    this.notify()
  }

  private notify(): void {
    this.revision++
    for (const listener of this.listeners) listener()
  }

  private schedule(): void {
    clearTimeout(this.timer)
    if (this.entries.size === 0) { this.timer = undefined; return }
    let nextExpiry = Number.POSITIVE_INFINITY
    for (const entry of this.entries.values()) nextExpiry = Math.min(nextExpiry, entry.hint?.expireAtMillis ?? entry.retainUntil)
    this.timer = setTimeout(() => {
      const now = this.now()
      for (const [key, entry] of this.entries) {
        if (entry.retainUntil <= now) this.entries.delete(key)
        else if (entry.hint !== undefined && entry.hint.expireAtMillis <= now) delete entry.hint
      }
      this.schedule()
      this.notify()
    }, Math.max(0, nextExpiry - this.now()))
  }
}

function validIdentity(value: { sourceKey: string; actorKey: string }): boolean {
  return typeof value.sourceKey === 'string' && value.sourceKey.trim() !== ''
    && typeof value.actorKey === 'string' && value.actorKey.trim() !== ''
}

function identity(value: { sourceKey: string; actorKey: string }): string {
  return JSON.stringify([value.sourceKey, value.actorKey])
}

function validChatStreamOrder(value: { chatConnectionGeneration: number; chatRevision: number }): boolean {
  return Number.isSafeInteger(value.chatConnectionGeneration) && value.chatConnectionGeneration > 0
    && Number.isSafeInteger(value.chatRevision) && value.chatRevision > 0
}

function chatStreamOrder(value: { chatConnectionGeneration: number; chatRevision: number }): ChatStreamOrder {
  return { generation: value.chatConnectionGeneration, revision: value.chatRevision }
}

function compareChatStreamOrder(left: ChatStreamOrder, right: ChatStreamOrder): number {
  return left.generation - right.generation || left.revision - right.revision
}

export const arkmeMessagePreparing = new ArkmeMessagePreparingStore()
