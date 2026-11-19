import { useEffect, useSyncExternalStore } from 'react'
import type { RecordingFavorite } from '../recording-favorite-contract.js'
import { favoriteAccount, favoriteChanges, recordingFavorites } from './recording-favorite-client.js'

interface Snapshot { scope?: string | undefined; items: RecordingFavorite[]; unreadCount: number; nextCursor?: string | undefined; readThrough?: string | undefined; loading: boolean; ready: boolean; error?: string | undefined }
const EMPTY: Snapshot = { items: [], unreadCount: 0, loading: false, ready: false }
export class RecordingFavoriteNotificationStore {
  private state = EMPTY
  private listeners = new Set<() => void>()
  private users = new Set<symbol>()
  private controller: AbortController | undefined
  private flight: Promise<void> | undefined
  private dirty = false
  private release: (() => void) | undefined
  private readAt = new Map<string, number>()
  getSnapshot = () => this.state
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  private publish(value: Snapshot) { this.state = value; for (const listener of this.listeners) listener() }
  private stop() {
    this.controller?.abort(); this.controller = undefined; this.flight = undefined; this.release?.(); this.release = undefined
    if (typeof window !== 'undefined') { window.removeEventListener('focus', this.recover); window.removeEventListener('online', this.recover); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.recover) }
  }
  acquire(scope?: string) {
    if (scope !== this.state.scope) { this.stop(); this.users.clear(); this.readAt.clear(); this.publish({ ...EMPTY, scope }) }
    if (!scope) return () => {}
    const token = Symbol(); this.users.add(token)
    if (this.users.size === 1) {
      this.release = favoriteChanges.subscribe(account => this.invalidate(account))
      if (typeof window !== 'undefined') { window.addEventListener('focus', this.recover); window.addEventListener('online', this.recover) }
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.recover)
      void this.refresh()
    }
    return () => { this.users.delete(token); if (!this.users.size) this.stop() }
  }
  private recover = () => { if ((typeof document === 'undefined' || !document.hidden)) this.invalidate(this.state.scope) }
  invalidate(scope?: string) { if (scope && scope === this.state.scope) { this.dirty = true; if (this.users.size && (typeof document === 'undefined' || !document.hidden)) void this.refresh() } }
  async refresh(more = false): Promise<void> {
    if (this.flight) return this.flight
    const scope = this.state.scope, cursor = more ? this.state.nextCursor : undefined
    if (!scope || scope !== favoriteAccount() || more && !cursor) return
    const controller = new AbortController(); this.controller = controller; this.dirty = false
    const valid = () => !controller.signal.aborted && this.controller === controller && favoriteAccount() === scope
    this.publish({ ...this.state, loading: true, error: undefined })
    const operation = Promise.resolve().then(async () => {
      try {
        const [page, summary] = await Promise.all([
          recordingFavorites({ action: 'notifications', accountKey: scope, ...(cursor ? { cursor } : {}) }, controller.signal),
          recordingFavorites({ action: 'summary', accountKey: scope }, controller.signal),
        ])
        if (!valid()) return
        const merged = new Map((more ? this.state.items : []).map(item => [item.favoriteRef, item]))
        for (const item of page.items) merged.set(item.favoriteRef, { ...item, readAtMillis: Math.max(item.readAtMillis, this.readAt.get(item.favoriteRef) ?? 0) })
        const items = [...merged.values()].slice(-300)
        this.publish({ scope, items, unreadCount: summary.unreadCount, nextCursor: page.nextCursor, readThrough: summary.readThrough, loading: false, ready: true })
        for (const ref of this.readAt.keys()) if (!merged.has(ref)) this.readAt.delete(ref)
      } catch (error) { if (valid()) this.publish({ ...this.state, loading: false, error: error instanceof Error ? error.message : '收藏通知暂不可用' }) }
    })
    this.flight = operation
    try { await operation } finally {
      if (this.flight === operation) { this.flight = undefined; if (this.dirty && valid() && this.users.size && (typeof document === 'undefined' || !document.hidden)) void this.refresh() }
    }
  }
  async read(scope: string, items: readonly RecordingFavorite[], signal: AbortSignal) {
    if (scope !== this.state.scope || scope !== favoriteAccount()) return
    for (const item of items.slice(0, 50)) {
      if (item.readAtMillis || this.readAt.has(item.favoriteRef) || !this.state.items.some(row => row.favoriteRef === item.favoriteRef)) continue
      await recordingFavorites({ action: 'read', accountKey: scope, favoriteRef: item.favoriteRef }, signal)
      if (signal.aborted || scope !== this.state.scope || scope !== favoriteAccount()) return
      const now = Date.now(); this.readAt.set(item.favoriteRef, now)
      this.publish({ ...this.state, unreadCount: Math.max(0, this.state.unreadCount - 1), items: this.state.items.map(row => row.favoriteRef === item.favoriteRef ? { ...row, readAtMillis: now } : row) })
    }
    const summary = await recordingFavorites({ action: 'summary', accountKey: scope }, signal)
    if (!signal.aborted && scope === this.state.scope && scope === favoriteAccount()) this.publish({ ...this.state, unreadCount: summary.unreadCount, readThrough: summary.readThrough })
  }
}
export const recordingFavoriteNotifications = new RecordingFavoriteNotificationStore()
export function useRecordingFavoriteNotifications(scope?: string) {
  const snapshot = useSyncExternalStore(recordingFavoriteNotifications.subscribe, recordingFavoriteNotifications.getSnapshot, recordingFavoriteNotifications.getSnapshot)
  useEffect(() => recordingFavoriteNotifications.acquire(scope), [scope])
  return snapshot.scope === scope ? snapshot : EMPTY
}
