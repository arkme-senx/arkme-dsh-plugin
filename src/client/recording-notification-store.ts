import { useEffect, useSyncExternalStore } from 'react'
import { EMPTY_RECORDING_WORKFLOW, type RecordingWorkflowPage } from '../recording-workflow-contract.js'
import { arkmeAuthStore } from './auth-store.js'
import { callArkme } from './api.js'

interface Snapshot extends RecordingWorkflowPage {
  scope?: string | undefined
  loading: boolean
  ready: boolean
  error?: string | undefined
}
const EMPTY: Snapshot = { ...EMPTY_RECORDING_WORKFLOW, loading: false, ready: false }
function currentScope() {
  const auth = arkmeAuthStore.getSnapshot().auth
  return auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : undefined
}
export class RecordingNotificationStore {
  private snapshot = EMPTY
  private listeners = new Set<() => void>()
  private users = 0
  private controller: AbortController | undefined
  private inflight: Promise<void> | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private checkedAt = 0
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  getSnapshot = () => this.snapshot
  private publish(value: Snapshot) { this.snapshot = value; for (const listener of this.listeners) listener() }
  private stop() {
    clearInterval(this.timer); this.timer = undefined
    this.controller?.abort(); this.controller = undefined; this.inflight = undefined
    if (typeof window !== 'undefined') { window.removeEventListener('focus', this.recover); window.removeEventListener('online', this.recover) }
  }
  acquire(scope?: string) {
    if (scope !== this.snapshot.scope) {
      this.stop(); this.users = 0; this.checkedAt = 0
      this.publish({ ...EMPTY, scope })
    }
    if (!scope) return () => {}
    this.users++
    if (this.users === 1) {
      this.timer = setInterval(this.recover, 60_000)
      if (typeof window !== 'undefined') { window.addEventListener('focus', this.recover); window.addEventListener('online', this.recover) }
      void this.refresh()
    }
    return () => { if (scope === this.snapshot.scope && --this.users === 0) this.stop() }
  }
  private recover = () => {
    if (typeof document !== 'undefined' && document.hidden) return
    if (!this.snapshot.supported && this.snapshot.ready && Date.now() - this.checkedAt < 300_000) return
    void this.refresh()
  }
  async refresh(more = false): Promise<void> {
    if (this.inflight) return this.inflight
    const scope = this.snapshot.scope, cursor = more ? this.snapshot.nextCursor : ''
    if (!scope || scope !== currentScope() || (more && !cursor)) return
    const controller = new AbortController()
    this.controller = controller
    const valid = () => !controller.signal.aborted && this.controller === controller && scope === this.snapshot.scope && scope === currentScope()
    const unsubscribe = arkmeAuthStore.subscribe(() => { if (scope !== currentScope()) controller.abort() })
    const operation = Promise.resolve().then(async () => {
      this.publish({ ...this.snapshot, loading: true, error: undefined })
      try {
        const page = await callArkme<RecordingWorkflowPage>('recordings.workflow', { operation: 'query', cursor }, controller.signal, { priority: 'background' })
        if (!valid()) return
        this.checkedAt = Date.now()
        const merged = new Map((page.supported ? this.snapshot.items : []).map(item => [item.id, item]))
        for (const item of page.items) merged.set(item.id, item)
        this.publish({ ...page, scope, loading: false, ready: true,
          items: [...merged.values()].sort((a, b) => b.atMillis - a.atMillis),
          nextCursor: !page.supported || more || this.snapshot.items.length <= 50 ? page.nextCursor : this.snapshot.nextCursor,
        })
      } catch (error) {
        if (valid()) this.publish({ ...this.snapshot, loading: false, error: error instanceof Error ? error.message : '录音通知暂时不可用' })
      }
    })
    this.inflight = operation
    try { await operation } finally { unsubscribe(); if (this.inflight === operation) this.inflight = undefined }
  }
  async read(scope: string, ids?: string[]) {
    if (scope !== this.snapshot.scope || scope !== currentScope()) return
    const throughSequence = this.snapshot.throughSequence
    const readIds = new Set(ids ?? this.snapshot.items.map(item => item.id))
    if (!ids && !throughSequence) return
    const controller = new AbortController()
    const unsubscribe = arkmeAuthStore.subscribe(() => { if (scope !== currentScope()) controller.abort() })
    try {
      await callArkme('recordings.workflow', { operation: 'read', accountKey: scope, ...(ids ? { ids } : { throughSequence }) }, controller.signal)
      if (controller.signal.aborted || scope !== this.snapshot.scope || scope !== currentScope()) return
      // Retain the event timestamp so reading a notice never changes chat ordering.
      this.controller?.abort(); this.inflight = undefined
      const items = this.snapshot.items.map(item => readIds.has(item.id) ? { ...item, readAtMillis: Date.now() } : item)
      this.publish({ ...this.snapshot, items })
      await this.refresh()
    } finally { unsubscribe() }
  }
}
export const recordingNotifications = new RecordingNotificationStore()
export function useRecordingNotifications(scope?: string) {
  const snapshot = useSyncExternalStore(recordingNotifications.subscribe, recordingNotifications.getSnapshot, recordingNotifications.getSnapshot)
  useEffect(() => recordingNotifications.acquire(scope), [scope])
  return snapshot.scope === scope ? snapshot : EMPTY
}
