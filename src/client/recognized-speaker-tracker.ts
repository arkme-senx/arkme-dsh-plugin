import type { ArkmeRecordingSpeakerCandidate } from '../types.js'
import type { UnmarkedSpeakerRow } from './recognized-speaker-order.js'
import { arkmeAuthStore } from './auth-store.js'

interface VisitRecord { known: string[]; current: string[]; pending: string[] }
export interface SpeakerEntrySnapshot { total?: number; newCount?: number; checkedAt: number }
type LocalStorage = Pick<Storage, 'getItem' | 'setItem'>
const empty: SpeakerEntrySnapshot = { checkedAt: 0 }
const storageKey = (account: string) => `dsh-arkme:speaker-visits:v1:${account}`
const storage = (): LocalStorage | undefined => { try { return window.localStorage } catch { return undefined } }

export function markedSpeakerKeys(options: readonly ArkmeRecordingSpeakerCandidate[]): string[] {
  return [...new Set(options.filter(option => option.kind === 'speaker').map(option => `m:${option.personKey || option.optionKey}`))]
}

/** Only complete identity snapshots can establish a baseline or produce a precise delta.
 * A removed identity may be a merge/recluster; without lineage we suppress ambiguous
 * additions for that transition rather than presenting a false "new person".
 */
export class RecognizedSpeakerTracker {
  private readonly records = new Map<string, VisitRecord>()
  private readonly snapshots = new Map<string, SpeakerEntrySnapshot>()
  private readonly listeners = new Set<() => void>()
  constructor(private readonly getStorage: () => LocalStorage | undefined = storage) {}
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  get = (account: string | undefined): SpeakerEntrySnapshot => account === undefined ? empty : this.snapshots.get(account) ?? empty
  private emit(account: string, snapshot: SpeakerEntrySnapshot): void {
    this.snapshots.set(account, snapshot)
    for (const listener of this.listeners) listener()
  }
  private read(account: string): VisitRecord | undefined {
    if (this.records.has(account)) return this.records.get(account)
    try {
      const value = JSON.parse(this.getStorage()?.getItem(storageKey(account)) ?? 'null') as VisitRecord | null
      if (value !== null && ['known', 'current', 'pending'].every(key => {
        const list = value[key as keyof VisitRecord]
        return Array.isArray(list) && list.length <= 20_000 && list.every(item => typeof item === 'string' && item.length <= 256)
      })) { this.records.set(account, value); return value }
    } catch { /* Start a quiet baseline if local data is unavailable or invalid. */ }
    return undefined
  }
  private save(account: string, value: VisitRecord): void {
    this.records.set(account, value)
    try { this.getStorage()?.setItem(storageKey(account), JSON.stringify(value)) } catch { /* Session-only fallback. */ }
  }
  setTotal(account: string, total: number): void {
    if (!Number.isSafeInteger(total) || total < 0) return
    const previous = this.get(account)
    this.emit(account, previous.total === total ? { ...previous, total } : { total, checkedAt: 0 })
  }
  uncertain(account: string): void {
    // Keep the last known total, but do not advertise a precise unread delta.
    const previous = this.get(account)
    this.emit(account, { ...(previous.total === undefined ? {} : { total: previous.total }), checkedAt: 0 })
  }
  acknowledge(account: string): void {
    const previous = this.read(account)
    if (previous === undefined) return
    this.save(account, { ...previous, pending: [] })
    this.emit(account, { ...this.get(account), newCount: 0 })
  }
  observe(account: string, options: readonly ArkmeRecordingSpeakerCandidate[], candidates: readonly UnmarkedSpeakerRow[], viewed = false): void {
    const marked = markedSpeakerKeys(options)
    if (candidates.some(candidate => !candidate.identityKey)) { this.uncertain(account); return }
    const current = [...new Set([...marked, ...candidates.map(candidate => `u:${candidate.identityKey!}`)])]
    const previous = this.read(account)
    const known = new Set(previous?.known ?? [])
    const currentSet = new Set(current)
    const removed = previous?.current.some(key => !currentSet.has(key)) ?? false
    const additions = previous === undefined || removed ? [] : current.filter(key => !known.has(key))
    const pending = viewed ? [] : [...new Set([...(previous?.pending ?? []).filter(key => currentSet.has(key)), ...additions])]
    current.forEach(key => known.add(key))
    // Never evict individual identities and misreport them as new later.
    const record = known.size > 20_000 ? { known: current, current, pending: [] } : { known: [...known], current, pending }
    this.save(account, record)
    this.emit(account, { total: current.length, newCount: record.pending.length, checkedAt: Date.now() })
  }
  clearSession(): void { this.snapshots.clear(); this.records.clear(); for (const listener of this.listeners) listener() }
}

export const recognizedSpeakerTracker = new RecognizedSpeakerTracker()
let activeAccount = ''
arkmeAuthStore.subscribe(() => {
  const auth = arkmeAuthStore.getSnapshot().auth
  const next = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : ''
  if (next !== activeAccount) { activeAccount = next; recognizedSpeakerTracker.clearSession() }
})
