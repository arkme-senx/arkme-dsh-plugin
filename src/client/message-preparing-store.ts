import type { ArkmeChatClientEvent } from '../types.js'

type PreparingHint = Extract<ArkmeChatClientEvent, { type: 'message-preparing' }>
type MessageArrived = Extract<ArkmeChatClientEvent, { type: 'message-arrived' }>

interface Entry {
  sourceKey: string
  actorKey: string
  version: number
  eventAt: number
  retainUntil: number
  hint?: PreparingHint
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
      || hint.eventAtMillis > this.now() + MAX_ACTIVE_MS) return
    const key = identity(hint)
    const previous = this.entries.get(key)
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
      ...(canceled ? {} : { hint: { ...hint, expireAtMillis: expireAt } }),
    })
  }

  messageArrived(event: MessageArrived): void {
    if (this.accountScope === undefined || !validIdentity(event)
      || !Number.isSafeInteger(event.revision) || event.revision < 0
      || !Number.isSafeInteger(event.eventAtMillis) || event.eventAtMillis <= 0) return
    const key = identity(event)
    const previous = this.entries.get(key)
    // t17 event_at can be a client-supplied send/attach time, not a preparing
    // version or a server ordering clock. Clear like the native client, retaining
    // only a version we actually observed. Unknown later hints rely on their TTL.
    // Consumers share this store: a lagging duplicate must not clear a newer Host delivery.
    if (previous === undefined || previous.hint === undefined
      || previous.hint.revision > event.revision) return
    this.put(key, {
      sourceKey: event.sourceKey, actorKey: event.actorKey,
      version: previous.version, eventAt: previous.eventAt, retainUntil: this.now() + MARKER_TTL_MS,
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

export const arkmeMessagePreparing = new ArkmeMessagePreparingStore()
