import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react'
import type { ArkmeSocialAccessSnapshot, ArkmeSourceItem } from '../types.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { SocialAccessSnapshotStorage, type SocialAccessSnapshots } from './social-access-snapshot-storage.js'
import { withArkmeReadDeadline } from './read-deadline.js'

export function isSocialSource(source: Pick<ArkmeSourceItem, 'kind'> | undefined): boolean {
  return source?.kind === 'private_chat' || source?.kind === 'group_chat'
}
export class SocialAccessStore {
  private state: { accountKey?: string; allowed: boolean | null; resolved: boolean } = { allowed: null, resolved: false }
  private readonly listeners = new Set<() => void>()
  private generation = 0
  private flight: Promise<void> | undefined
  constructor(private readonly load: () => Promise<ArkmeSocialAccessSnapshot>, private readonly snapshots?: SocialAccessSnapshots) {}
  getSnapshot = () => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  activate(accountKey: string | undefined): void {
    if (this.state.accountKey === accountKey) return
    if (this.state.accountKey !== undefined) this.snapshots?.remove(this.state.accountKey)
    this.generation++; this.flight = undefined
    const allowed = accountKey === undefined ? null : this.snapshots?.read(accountKey) ?? null
    this.publish(accountKey === undefined ? { allowed: null, resolved: false } : { accountKey, allowed, resolved: allowed !== null })
  }
  refresh(): Promise<void> {
    if (this.state.accountKey === undefined) return Promise.resolve()
    if (this.flight !== undefined) return this.flight
    const generation = this.generation
    const accountKey = this.state.accountKey
    const pending = this.load().then(result => {
      if (generation !== this.generation) return
      if (typeof result.allowed === 'boolean') {
        this.snapshots?.write(accountKey, result.allowed)
        if (!this.state.resolved || result.allowed !== this.state.allowed) {
          this.publish({ accountKey, allowed: result.allowed, resolved: true })
        }
      }
    }).catch(() => {
      // Transport failure does not revoke this account's confirmed presentation.
      // Host and service owners still authorize operations; activation clears it.
    }).finally(() => {
      if (generation === this.generation && !this.state.resolved) {
        this.publish({ ...this.state, resolved: true })
      }
      if (this.flight === pending) this.flight = undefined
    })
    this.flight = pending
    return pending
  }
  private publish(next: typeof this.state): void { this.state = next; for (const listener of this.listeners) listener() }
}
export const socialAccessStore = new SocialAccessStore(
  () => withArkmeReadDeadline(
    signal => callArkme<ArkmeSocialAccessSnapshot>('social.access', {}, signal),
    AbortSignal.timeout(3000),
  ),
  new SocialAccessSnapshotStorage(),
)

/** Restore display before paint; anonymous surfaces keep their existing behavior. */
export function useSocialAccessPresentation(): { visible: boolean; ready: boolean } {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const accountKey = auth?.status === 'authenticated' ? `${auth.environment}:${String(auth.userId)}` : undefined
  const snapshot = useSyncExternalStore(socialAccessStore.subscribe, socialAccessStore.getSnapshot, socialAccessStore.getSnapshot)
  useLayoutEffect(() => {
    socialAccessStore.activate(accountKey)
    void socialAccessStore.refresh()
  }, [accountKey])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void socialAccessStore.refresh() }
    if (typeof document === 'undefined') return
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => { document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh) }
  }, [accountKey])
  return {
    visible: auth?.status === 'logged-out' || auth?.status === 'authenticated' && snapshot.accountKey === accountKey && snapshot.allowed === true,
    ready: auth?.status !== 'authenticated' || snapshot.accountKey === accountKey && snapshot.resolved,
  }
}

export function useSocialAccess(): boolean { return useSocialAccessPresentation().visible }
