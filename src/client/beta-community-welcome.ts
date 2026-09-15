import type { ArkmeAuthSnapshot, ArkmeSourceItem } from '../types.js'
import { arkmeChatSourceIdentityKey } from './source-identity.js'
import type { ArkmeDSHBetaCommunityJoinResult } from '../dsh-beta-community.js'

export interface BetaCommunityWelcome {
  accountKey: string
  sourceRef: string
  sourceKey?: string
  title: string
  occurredAtMillis: number
}

export function welcomeAccountKey(auth: ArkmeAuthSnapshot | undefined): string | undefined {
  return auth?.status === 'authenticated' ? `${auth.environment}:${String(auth.userId)}` : undefined
}

// A single local presentation record, never a chat message or a server write.
// Keeping only the most recent join bounds both memory and browser storage.
const storageKey = 'arkme.beta-community-welcome.v1'
function restore(): BetaCommunityWelcome | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (value && typeof value.accountKey === 'string' && typeof value.sourceRef === 'string'
      && typeof value.title === 'string' && Number.isFinite(value.occurredAtMillis)) return value
  } catch { /* Storage may be unavailable; joining still works. */ }
  return undefined
}

export class BetaCommunityWelcomeStore {
  private value: BetaCommunityWelcome | undefined
  private listeners = new Set<() => void>()
  constructor(initial?: BetaCommunityWelcome, private persist: (value: BetaCommunityWelcome) => void = () => {}) {
    this.value = initial
  }
  getSnapshot = () => this.value
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  joined(result: ArkmeDSHBetaCommunityJoinResult, accountKey: string | undefined, currentAccountKey: string | undefined) {
    if (!accountKey || accountKey !== currentAccountKey || result.status !== 'joined') return
    this.value = { accountKey, sourceRef: result.source.sourceRef, sourceKey: arkmeChatSourceIdentityKey(result.source),
      title: result.source.displayName, occurredAtMillis: Date.now() }
    try { this.persist(this.value) } catch { /* Do not turn a successful join into a failure. */ }
    this.listeners.forEach(listener => listener())
  }

  resolveLegacySource(expected: BetaCommunityWelcome, source: ArkmeSourceItem) {
    if (this.value !== expected || expected.sourceKey || source.kind !== 'group_chat' || !source.sourceKey?.trim()) return
    this.value = { ...expected, sourceKey: source.sourceKey }
    try { this.persist(this.value) } catch { /* Keep the resolved identity in memory. */ }
    this.listeners.forEach(listener => listener())
  }
}

export function welcomeMatchesSource(welcome: BetaCommunityWelcome | undefined, accountKey: string | undefined, source: ArkmeSourceItem | undefined): boolean {
  return welcome !== undefined && accountKey !== undefined && welcome.accountKey === accountKey
    && source?.kind === 'group_chat'
    && (welcome.sourceKey ? welcome.sourceKey === arkmeChatSourceIdentityKey(source) : welcome.sourceRef === source.sourceRef)
}

export const betaCommunityWelcomeStore = new BetaCommunityWelcomeStore(restore(), value => {
  localStorage.setItem(storageKey, JSON.stringify(value))
})

export function welcomeDraft(current: string, lastSuggestion: string | undefined, suggestion: string): string {
  return current === '' || current === lastSuggestion ? suggestion : current
}
