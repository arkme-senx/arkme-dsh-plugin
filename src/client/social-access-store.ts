import { useEffect, useSyncExternalStore } from 'react'
import type { ArkmeSocialAccessSnapshot, ArkmeSourceItem } from '../types.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'

export function isSocialSource(source: Pick<ArkmeSourceItem, 'kind'> | undefined): boolean {
  return source?.kind === 'private_chat' || source?.kind === 'group_chat'
}
export class SocialAccessStore {
  private state: { accountKey?: string; allowed: boolean | null } = { allowed: null }
  private readonly listeners = new Set<() => void>()
  private generation = 0
  private flight: Promise<void> | undefined
  constructor(private readonly load: () => Promise<ArkmeSocialAccessSnapshot>) {}
  getSnapshot = () => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  activate(accountKey: string | undefined): void {
    if (this.state.accountKey === accountKey) return
    this.generation++; this.flight = undefined
    this.publish(accountKey === undefined ? { allowed: null } : { accountKey, allowed: null })
  }
  refresh(): Promise<void> {
    if (this.state.accountKey === undefined) return Promise.resolve()
    if (this.flight !== undefined) return this.flight
    const generation = this.generation
    const accountKey = this.state.accountKey
    const pending = this.load().then(result => {
      if (generation === this.generation) this.publish({ accountKey, allowed: result.allowed })
    }).catch(() => {
      if (generation === this.generation) this.publish({ accountKey, allowed: null })
    }).finally(() => { if (this.flight === pending) this.flight = undefined })
    this.flight = pending
    return pending
  }
  private publish(next: typeof this.state): void { this.state = next; for (const listener of this.listeners) listener() }
}
export const socialAccessStore = new SocialAccessStore(() => callArkme<ArkmeSocialAccessSnapshot>('social.access'))

/** Memory-only presentation state. Anonymous surfaces keep their existing behavior. */
export function useSocialAccess(): boolean {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const accountKey = auth?.status === 'authenticated' ? `${auth.environment}:${String(auth.userId)}` : undefined
  const snapshot = useSyncExternalStore(socialAccessStore.subscribe, socialAccessStore.getSnapshot, socialAccessStore.getSnapshot)
  useEffect(() => {
    socialAccessStore.activate(accountKey)
    void socialAccessStore.refresh()
    const refresh = () => { if (document.visibilityState === 'visible') void socialAccessStore.refresh() }
    if (typeof document === 'undefined') return
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => { document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh) }
  }, [accountKey])
  return auth?.status === 'logged-out' || auth?.status === 'authenticated' && snapshot.accountKey === accountKey && snapshot.allowed === true
}
