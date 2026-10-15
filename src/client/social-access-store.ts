import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react'
import type { ArkmeAuthSnapshot, ArkmeUserProfileSnapshot, ArkmeSourceItem } from '../types.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { SocialAccessSnapshotStorage, type SocialAccessSnapshots } from './social-access-snapshot-storage.js'
import { withArkmeReadDeadline } from './read-deadline.js'
import { arkmeUi } from './ui-controller.js'

export const SOCIAL_ACCESS_TTL_MS = 60_000
export const SOCIAL_ACCESS_READ_TIMEOUT_MS = 5_000
const RETRY_BASE_MS = 5_000
export interface SocialAccessSnapshot { userId: number; allowed: boolean | null; checkedAtMillis?: number }

export function isSocialSource(source: Pick<ArkmeSourceItem, 'kind'> | undefined): boolean {
  return source?.kind === 'private_chat' || source?.kind === 'group_chat'
}
export class SocialAccessStore {
  private state: { accountKey?: string; allowed: boolean | null; resolved: boolean } = { allowed: null, resolved: false }
  private readonly listeners = new Set<() => void>()
  private generation = 0
  private accountRevision: number | string = 0
  private flight: Promise<void> | undefined
  private controller: AbortController | undefined
  private checkedAtMillis = 0
  private retryAtMillis = 0
  private failures = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private revalidationUsers = 0
  private stopRevalidation: (() => void) | undefined
  constructor(
    private readonly load: (signal: AbortSignal, remote: boolean) => Promise<SocialAccessSnapshot>,
    private readonly snapshots?: SocialAccessSnapshots,
  ) {}
  getSnapshot = () => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  confirm(accountKey: string, allowed: boolean): void {
    if (this.state.accountKey !== accountKey) this.activate(accountKey)
    this.invalidateRead()
    this.accept(allowed, Date.now())
    this.schedule()
  }
  confirmProfile(snapshot: ArkmeUserProfileSnapshot): void {
    const auth = arkmeAuthStore.getSnapshot().auth
    if (auth?.status !== 'authenticated' || snapshot.profile === null || snapshot.profile.userId !== auth.userId
      || this.state.accountKey !== `${auth.environment}:${auth.userId}`
      || !snapshot.cachedAtMillis || snapshot.cachedAtMillis < this.checkedAtMillis) return
    this.invalidateRead()
    this.accept(!!snapshot.profile.contact.phoneMasked?.trim(), snapshot.cachedAtMillis)
    this.schedule()
  }
  activate(accountKey: string | undefined, accountRevision?: number | string): void {
    const changedAccount = this.state.accountKey !== accountKey
    if (!changedAccount && (accountRevision === undefined || this.accountRevision === accountRevision)) return
    this.accountRevision = accountRevision ?? 0
    this.invalidateRead()
    if (!changedAccount) { this.schedule(); return }
    if (this.state.accountKey !== undefined) this.snapshots?.remove(this.state.accountKey)
    const entry = accountKey === undefined ? null : this.snapshots?.readConfirmation?.(accountKey)
    const allowed = entry?.allowed ?? (accountKey === undefined ? null : this.snapshots?.read(accountKey) ?? null)
    this.checkedAtMillis = entry?.checkedAtMillis ?? 0
    this.failures = 0; this.retryAtMillis = 0
    this.publish(accountKey === undefined ? { allowed: null, resolved: false } : { accountKey, allowed, resolved: allowed !== null })
    this.schedule()
  }
  /** Adopt binding confirmations from another window without another profile request. */
  syncStoredConfirmation(): void {
    const key = this.state.accountKey
    const entry = key === undefined ? null : this.snapshots?.readConfirmation?.(key)
    if (!entry || entry.checkedAtMillis < this.checkedAtMillis
      || (entry.checkedAtMillis === this.checkedAtMillis && entry.allowed === this.state.allowed)) return
    this.invalidateRead()
    this.checkedAtMillis = entry.checkedAtMillis
    this.failures = 0; this.retryAtMillis = 0
    this.publish({ ...this.state, allowed: entry.allowed, resolved: true })
    this.schedule()
  }
  refreshIfStale(): Promise<void> {
    this.syncStoredConfirmation()
    if (this.flight !== undefined) return this.flight
    const now = Date.now()
    if (this.state.accountKey === undefined || now < this.retryAtMillis
      || (this.state.allowed !== null && this.checkedAtMillis > 0 && now >= this.checkedAtMillis
        && now - this.checkedAtMillis < SOCIAL_ACCESS_TTL_MS)) return Promise.resolve()
    // Bootstrap from the existing local profile only when no confirmation exists.
    return this.refresh(this.state.allowed !== null)
  }
  /** Explicit refresh bypasses freshness/cooldown, but still shares the current read. */
  refresh(remote = true): Promise<void> {
    if (this.state.accountKey === undefined) return Promise.resolve()
    if (this.flight !== undefined) return this.flight
    const generation = this.generation
    const accountKey = this.state.accountKey
    const controller = new AbortController()
    this.controller = controller
    const deadline = setTimeout(() => controller.abort(new Error('手机号状态刷新超时')), SOCIAL_ACCESS_READ_TIMEOUT_MS)
    const pending = withArkmeReadDeadline(signal => this.load(signal, remote), controller.signal).then(result => {
      if (generation !== this.generation) return
      this.syncStoredConfirmation()
      if (generation !== this.generation) return
      if (!accountKey.endsWith(`:${result.userId}`) || typeof result.allowed !== 'boolean') throw new Error('Account binding fact unavailable')
      this.accept(result.allowed, result.checkedAtMillis ?? Date.now())
    }).catch(() => {
      if (generation !== this.generation) return
      // Failure never revokes a confirmed state or advances its confirmation time.
      this.failures = Math.min(this.failures + 1, 5)
      this.retryAtMillis = Date.now() + Math.min(SOCIAL_ACCESS_TTL_MS, RETRY_BASE_MS * 2 ** (this.failures - 1))
    }).finally(() => {
      clearTimeout(deadline)
      if (generation === this.generation && !this.state.resolved) this.publish({ ...this.state, resolved: true })
      if (this.flight === pending) { this.flight = undefined; this.controller = undefined }
      this.schedule()
    })
    this.flight = pending
    this.schedule()
    return pending
  }
  /** One timer/listener set per UI store, shared by every mounted consumer. */
  startRevalidation(): () => void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
    this.revalidationUsers++
    if (this.revalidationUsers === 1) {
      const refresh = () => {
        this.syncStoredConfirmation()
        if (document.visibilityState !== 'hidden') void this.refreshIfStale()
        this.schedule()
      }
      window.addEventListener('focus', refresh)
      window.addEventListener('online', refresh)
      window.addEventListener('storage', refresh)
      document.addEventListener('visibilitychange', refresh)
      this.stopRevalidation = () => {
        window.removeEventListener('focus', refresh)
        window.removeEventListener('online', refresh)
        window.removeEventListener('storage', refresh)
        document.removeEventListener('visibilitychange', refresh)
      }
      refresh()
    }
    let stopped = false
    return () => {
      if (stopped) return
      stopped = true
      if (--this.revalidationUsers === 0) {
        this.stopRevalidation?.(); this.stopRevalidation = undefined
        if (this.timer !== undefined) clearTimeout(this.timer)
        this.timer = undefined
        // An explicit action may still be joining the bounded read; do not cancel it.
      }
    }
  }
  private invalidateRead(): void {
    this.generation++
    this.controller?.abort()
    this.controller = undefined; this.flight = undefined
  }
  private accept(allowed: boolean, checkedAtMillis: number): void {
    this.checkedAtMillis = checkedAtMillis
    this.failures = 0; this.retryAtMillis = 0
    this.snapshots?.write(this.state.accountKey!, allowed, checkedAtMillis)
    if (!this.state.resolved || this.state.allowed !== allowed) this.publish({ ...this.state, allowed, resolved: true })
  }
  private schedule(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    if (!this.revalidationUsers || this.flight || this.state.accountKey === undefined || document.visibilityState === 'hidden') return
    const now = Date.now()
    const due = this.state.allowed === null || this.checkedAtMillis <= 0 || now < this.checkedAtMillis
      ? now : this.checkedAtMillis + SOCIAL_ACCESS_TTL_MS
    this.timer = setTimeout(() => { this.timer = undefined; void this.refreshIfStale() }, Math.max(0, due - now, this.retryAtMillis - now))
  }
  private publish(next: typeof this.state): void { this.state = next; for (const listener of this.listeners) listener() }
}
// Only the initial hydration uses the local profile. Expiry must reach the remote owner.
export async function loadSocialAccess(signal: AbortSignal, remote = false): Promise<SocialAccessSnapshot> {
  const expectedUserId = arkmeAuthStore.getSnapshot().auth?.userId
  let refreshed = remote
  let snapshot = await callArkme<ArkmeUserProfileSnapshot>(remote ? 'user.profile.refresh' : 'user.profile', undefined, signal).catch(error => {
    signal.throwIfAborted()
    if (remote) throw error
    // A missing/unreadable local profile is not a binding decision. Try its
    // remote owner within the same bounded initial read.
    return { profile: null, cachedAtMillis: 0, revision: 0 }
  })
  if (!remote && (!snapshot?.profile || (expectedUserId !== undefined && snapshot.profile.userId !== expectedUserId))) {
    refreshed = true
    snapshot = await callArkme<ArkmeUserProfileSnapshot>('user.profile.refresh', undefined, signal)
  }
  if (!snapshot?.profile) throw new Error('Account profile unavailable')
  return { userId: snapshot.profile.userId, allowed: (snapshot.profile.contact.phoneMasked?.trim() ?? '') !== '',
    // Local profile updates do not prove when the phone fact was last verified.
    checkedAtMillis: refreshed ? Date.now() : 0 }
}
export const socialAccessStore = new SocialAccessStore(loadSocialAccess, new SocialAccessSnapshotStorage())

/** Invoke only after the existing bind/unbind command has confirmed the owner fact. */
export function confirmPhoneBinding(auth: ArkmeAuthSnapshot, bound: boolean): void {
  const current = arkmeAuthStore.getSnapshot().auth
  if (auth.status !== 'authenticated' || auth.userId === undefined || current?.status !== 'authenticated'
    || current.environment !== auth.environment || current.userId !== auth.userId) return
  socialAccessStore.confirm(`${auth.environment}:${auth.userId}`, bound)
}
const readAccountRevision = () => arkmeUi.getSnapshot().authRevision

export function usePhoneBindingStatus(enabled = true): { bound: boolean | null; ready: boolean } {
  const authState = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const auth = authState.auth
  const accountKey = auth?.status === 'authenticated' ? `${auth.environment}:${String(auth.userId)}` : undefined
  const accountRevision = useSyncExternalStore(arkmeUi.subscribe, readAccountRevision, readAccountRevision)
  const snapshot = useSyncExternalStore(socialAccessStore.subscribe, socialAccessStore.getSnapshot, socialAccessStore.getSnapshot)
  useLayoutEffect(() => {
    socialAccessStore.activate(accountKey, accountRevision)
    if (enabled) void socialAccessStore.refreshIfStale()
  }, [accountKey, accountRevision, enabled])
  useEffect(() => enabled ? socialAccessStore.startRevalidation() : undefined, [enabled])
  return {
    bound: auth?.status === 'authenticated' && snapshot.accountKey === accountKey ? snapshot.allowed : null,
    ready: authState.checked && (auth?.status !== 'authenticated' || snapshot.accountKey === accountKey && snapshot.resolved),
  }
}
