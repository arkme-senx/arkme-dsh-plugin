import { useEffect, useSyncExternalStore } from 'react'
import type {
  ArkmeOfficialNotification,
  ArkmeOfficialNotificationPage,
  ArkmeOfficialNotificationSummary,
} from '../official-notification-contract.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'

export interface OfficialNotificationSnapshot {
  scope?: string | undefined
  items: ArkmeOfficialNotification[]
  summary: ArkmeOfficialNotificationSummary
  nextCursor: string
  loading: boolean
  foregroundLoading: boolean
  error?: string | undefined
  ready: boolean
  revision: number
}
const EMPTY: OfficialNotificationSnapshot = {
  items: [],
  summary: { total: 0, unreadCount: 0 },
  nextCursor: '',
  loading: false,
  foregroundLoading: false,
  ready: false,
  revision: 0,
}
function currentScope() {
  const auth = arkmeAuthStore.getSnapshot().auth
  return auth?.status === 'authenticated'
    ? `${auth.environment}:${auth.userId}`
    : undefined
}
type ReadPriority = 'foreground' | 'background'
interface NotificationRead {
  controller: AbortController
  priority: ReadPriority
  promise: Promise<void>
}
export class OfficialNotificationStore {
  private snapshot = EMPTY
  private listeners = new Set<() => void>()
  private controller = new AbortController()
  private inflight: NotificationRead | undefined
  private generation = 0
  private pending: ReadPriority | undefined
  private users = 0
  private pages = 1
  private timer: ReturnType<typeof setInterval> | undefined
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  getSnapshot = () => this.snapshot
  private publish(next: OfficialNotificationSnapshot) {
    this.snapshot = next
    for (const fn of this.listeners) fn()
  }
  private stop() {
    this.generation++
    this.controller.abort()
    this.inflight?.controller.abort()
    this.inflight = undefined
    this.pending = undefined
    clearInterval(this.timer)
    this.timer = undefined
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.recover)
      window.removeEventListener('focus', this.recover)
    }
    if (typeof document !== 'undefined')
      document.removeEventListener('visibilitychange', this.recover)
  }
  acquire(scope?: string) {
    if (scope !== this.snapshot.scope || this.controller.signal.aborted) {
      this.stop()
      this.users = 0
      this.pages = 1
      this.controller = new AbortController()
      this.publish({ ...EMPTY, scope })
    }
    if (scope === undefined) return () => undefined
    this.users++
    if (this.users === 1) {
      if (typeof window !== 'undefined') {
        window.addEventListener('online', this.recover)
        window.addEventListener('focus', this.recover)
      }
      if (typeof document !== 'undefined')
        document.addEventListener('visibilitychange', this.recover)
      this.timer = setInterval(
        this.recover,
        60_000 + Math.floor(Math.random() * 5_000),
      )
      void this.refresh('background')
    }
    return () => {
      if (this.snapshot.scope === scope && --this.users === 0) this.stop()
    }
  }
  private recover = () => {
    if (typeof document === 'undefined' || !document.hidden) void this.refresh('background')
  }
  invalidate(scope?: string, priority: ReadPriority = 'background') {
    if (scope !== this.snapshot.scope) return
    this.generation++
    // A hint must not demote a user refresh whose stale result is now discarded.
    this.pending = priority === 'foreground' || this.inflight?.priority === 'foreground'
      || this.pending === 'foreground' ? 'foreground' : 'background'
    if (!this.inflight || priority === 'foreground') void this.refresh(this.pending)
  }
  async refresh(priority: ReadPriority = 'foreground'): Promise<void> {
    if (this.inflight) {
      if (priority === 'background' || this.inflight.priority === 'foreground') return this.inflight.promise
      // Only replace the read. A simultaneous mark-read command retains its lifecycle signal.
      this.inflight.controller.abort()
    }
    const { scope } = this.snapshot,
      generation = this.generation,
      pages = this.pages
    if (!scope || this.controller.signal.aborted || scope !== currentScope()) return
    if (this.pending === 'foreground') priority = 'foreground'
    this.pending = undefined
    const controller = new AbortController()
    const signal = controller.signal
    const operation: NotificationRead = { controller, priority, promise: Promise.resolve() }
    const valid = () =>
      this.inflight === operation &&
      !signal.aborted &&
      generation === this.generation &&
      scope === this.snapshot.scope &&
      scope === currentScope()
    const unsubscribe = arkmeAuthStore.subscribe(() => {
      // Remember a logout even if the same account logs in before this read resolves.
      if (scope !== currentScope()) controller.abort()
    })
    const options = priority === 'background' ? { priority: 'background' as const } : undefined
    // Install the operation before notifying subscribers, which may synchronously refresh.
    operation.promise = Promise.resolve().then(async () => {
      if (!valid()) return
      this.publish({
        ...this.snapshot,
        loading: true,
        foregroundLoading: priority === 'foreground',
        // Keep the retry action available while an automatic refresh waits for admission.
        error: priority === 'foreground' ? undefined : this.snapshot.error,
      })
      try {
        const summaryPromise = callArkme<ArkmeOfficialNotificationSummary>(
          'official-notifications.summary',
          undefined,
          signal,
          options,
        )
        const pagePromise = (async () => {
          let cursor = ''
          const items: ArkmeOfficialNotification[] = []
          for (let page = 0; page < pages; page++) {
            const value = await callArkme<ArkmeOfficialNotificationPage>(
              'official-notifications.list',
              { cursor },
              signal,
              options,
            )
            if (!valid()) break
            items.push(...value.items)
            cursor = value.nextCursor
            if (!cursor) break
          }
          return { items, nextCursor: cursor }
        })()
        const [summary, page] = await Promise.all([summaryPromise, pagePromise])
        if (valid())
          this.publish({
            scope,
            summary,
            ...page,
            loading: false,
            foregroundLoading: false,
            ready: true,
            revision: this.snapshot.revision + 1,
          })
      } catch (error) {
        if (valid())
          this.publish({
            ...this.snapshot,
            loading: false,
            foregroundLoading: false,
            ready: true,
            error:
              error instanceof Error ? error.message : '官方通知暂时不可用',
          })
      }
    }).finally(() => {
      unsubscribe()
      // Release a sibling summary/list if the other request failed first.
      controller.abort()
      if (this.inflight === operation) {
        this.inflight = undefined
        if (this.pending) void this.refresh(this.pending)
        else if (this.snapshot.loading)
          this.publish({ ...this.snapshot, loading: false, foregroundLoading: false })
      }
    })
    this.inflight = operation
    await operation.promise
  }
  async more() {
    if (this.inflight?.priority === 'foreground' || !this.snapshot.nextCursor) return
    this.pages++
    await this.refresh()
  }
  async read(scope: string, ids?: readonly string[]): Promise<void> {
    if (scope !== this.snapshot.scope || scope !== currentScope())
      throw new Error('账号已变化')
    const signal = this.controller.signal
    // Invalidate pre-write reads before issuing the command; a late list may not resurrect unread.
    this.generation++
    try {
      await callArkme<ArkmeOfficialNotificationSummary>(
        'official-notifications.read',
        { accountKey: scope, ...(ids === undefined ? { all: true } : { ids }) },
        signal,
      )
      // Only the owner knows the read-all snapshot. A concurrent publication
      // must retain its receipt state until the authoritative reconciliation.
    } finally {
      if (!signal.aborted && scope === this.snapshot.scope)
        this.invalidate(scope, 'foreground')
    }
  }
}
export const officialNotifications = new OfficialNotificationStore()
export function useOfficialNotifications(scope?: string) {
  const stored = useSyncExternalStore(
    officialNotifications.subscribe,
    officialNotifications.getSnapshot,
    officialNotifications.getSnapshot,
  )
  useEffect(() => officialNotifications.acquire(scope), [scope])
  return stored.scope === scope ? stored : EMPTY
}
