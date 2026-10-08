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
  error?: string | undefined
  ready: boolean
  revision: number
}
const EMPTY: OfficialNotificationSnapshot = {
  items: [],
  summary: { total: 0, unreadCount: 0 },
  nextCursor: '',
  loading: false,
  ready: false,
  revision: 0,
}
function currentScope() {
  const auth = arkmeAuthStore.getSnapshot().auth
  return auth?.status === 'authenticated'
    ? `${auth.environment}:${auth.userId}`
    : undefined
}
export class OfficialNotificationStore {
  private snapshot = EMPTY
  private listeners = new Set<() => void>()
  private controller = new AbortController()
  private inflight: Promise<void> | undefined
  private generation = 0
  private pending = false
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
    this.inflight = undefined
    this.pending = false
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
      void this.refresh()
    }
    return () => {
      if (this.snapshot.scope === scope && --this.users === 0) this.stop()
    }
  }
  private recover = () => {
    if (typeof document === 'undefined' || !document.hidden) void this.refresh()
  }
  invalidate(scope?: string) {
    if (scope !== this.snapshot.scope) return
    this.generation++
    this.pending = true
    if (!this.inflight) void this.refresh()
  }
  async refresh(): Promise<void> {
    if (this.inflight) return this.inflight
    this.pending = false
    const { scope } = this.snapshot,
      signal = this.controller.signal,
      generation = this.generation
    if (!scope || signal.aborted || scope !== currentScope()) return
    const valid = () =>
      !signal.aborted &&
      generation === this.generation &&
      scope === this.snapshot.scope &&
      scope === currentScope()
    const operation = (async () => {
      this.publish({ ...this.snapshot, loading: true, error: undefined })
      try {
        const summaryPromise = callArkme<ArkmeOfficialNotificationSummary>(
          'official-notifications.summary',
          undefined,
          signal,
        )
        const pagePromise = (async () => {
          let cursor = ''
          const items: ArkmeOfficialNotification[] = []
          for (let page = 0; page < this.pages; page++) {
            const value = await callArkme<ArkmeOfficialNotificationPage>(
              'official-notifications.list',
              { cursor },
              signal,
            )
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
            ready: true,
            revision: this.snapshot.revision + 1,
          })
      } catch (error) {
        if (valid())
          this.publish({
            ...this.snapshot,
            loading: false,
            ready: true,
            error:
              error instanceof Error ? error.message : '官方通知暂时不可用',
          })
      }
    })()
    this.inflight = operation
    try {
      await operation
    } finally {
      if (this.inflight === operation) {
        this.inflight = undefined
        if (this.pending) void this.refresh()
      }
    }
  }
  async more() {
    if (this.snapshot.loading || !this.snapshot.nextCursor) return
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
        this.invalidate(scope)
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
