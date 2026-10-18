import type { ArkmeBotSummary, ArkmeGroupBotCandidate } from '../types.js'

export interface MentionBotData {
  group: readonly ArkmeGroupBotCandidate[]
  private: readonly ArkmeBotSummary[]
}
export interface MentionBotSnapshot extends MentionBotData {
  ready: boolean
  loading: boolean
  error: boolean
}
export const EMPTY_MENTION_BOTS: MentionBotSnapshot = { group: [], private: [], ready: false, loading: false, error: false }
interface Entry { snapshot: MentionBotSnapshot; expiresAt: number; pending?: Promise<void> }

/** Renderer memory only. Account/environment and conversation are part of every key. */
export class MentionBotCache {
  private readonly entries = new Map<string, Entry>()
  private readonly listeners = new Set<() => void>()
  private revision = 0
  constructor(private readonly now: () => number = Date.now) {}
  readonly getRevision = () => this.revision
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  get(key: string | undefined): MentionBotSnapshot { return (key ? this.entries.get(key)?.snapshot : undefined) ?? EMPTY_MENTION_BOTS }
  clear(): void { this.entries.clear(); this.publish() }
  invalidate(key: string, removedBotRef?: string): void {
    const snapshot = this.get(key)
    this.entries.set(key, { snapshot: { ...snapshot, loading: false,
      group: removedBotRef === undefined ? snapshot.group : snapshot.group.filter(bot => bot.botRef !== removedBotRef) }, expiresAt: 0 })
    this.publish()
  }
  load(key: string, fetch: () => Promise<MentionBotData>, force = false): Promise<void> {
    const previous = this.entries.get(key)
    if (previous?.pending) return previous.pending
    if (!force && previous && this.now() < previous.expiresAt) return Promise.resolve()
    const entry: Entry = { snapshot: { ...this.get(key), loading: true, error: false }, expiresAt: 0 }
    this.entries.set(key, entry)
    entry.pending = Promise.resolve().then(fetch).then(data => {
      if (this.entries.get(key) !== entry) return
      entry.snapshot = { ...data, ready: true, loading: false, error: false }
      entry.expiresAt = this.now() + 5 * 60_000
    }).catch(() => {
      if (this.entries.get(key) !== entry) return
      entry.snapshot = { ...entry.snapshot, loading: false, error: true }
      entry.expiresAt = this.now() + 30_000
    }).finally(() => {
      delete entry.pending
      if (this.entries.get(key) === entry) this.publish()
    })
    this.publish()
    return entry.pending
  }
  private publish(): void { this.revision++; for (const listener of this.listeners) listener() }
}
export const mentionBotCache = new MentionBotCache()

export function mentionBotCacheKey(account: string | undefined, kind: string | undefined, sourceKey: string | undefined): string | undefined {
  if (!account || !sourceKey || (kind !== 'group_chat' && kind !== 'private_chat')) return undefined
  return JSON.stringify([account, kind, kind === 'private_chat' ? 'bots' : sourceKey])
}
