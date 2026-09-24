import { reactionPreview } from './reaction-preview-store.js'
import type { ReactionNotification, ReactionNotificationPage, ReactionRequest } from '../reaction-contract.js'
import { callArkme } from './api.js'

type Transport = (request: ReactionRequest, signal: AbortSignal) => Promise<unknown>
/** One foreground inbox per account/window. Server revisions own read state. */
export class ReactionNotifications {
 private scope?: string
 private controller = new AbortController()
 private listeners = new Set<() => void>()
 private rows: ReactionNotification[] = []
 private version = 0
 private inflight: Promise<void> | undefined
 private highlightRevision = 0
 private highlight: { revision: number; sourceKey: string | undefined; itemUid: string; rows: ReactionNotification[]; active: boolean; expressionIdentity?: string } | undefined
 private highlightTimer: ReturnType<typeof setTimeout> | undefined
 private viewing = new Map<string, number>()
 private reading = new Set<string>()
 private acknowledged = new Map<string, number>()
 private timer?: ReturnType<typeof setTimeout>
 private retryMillis = 2_000
 private users = 0
 error = ''
 hasMore = false
 constructor(private transport: Transport = (input, signal) => callArkme('reactions', input, signal)) {}
 subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
 getSnapshot = () => this.version
 private publish() { this.version++; for (const fn of this.listeners) fn() }
 forSource(scope: string | undefined, sourceKey: string | undefined) { return scope === this.scope && sourceKey ? this.rows.filter(row => row.sourceKey === sourceKey) : [] }
 beginViewing(sourceKey: string, itemUid: string) {
  clearTimeout(this.highlightTimer); this.highlightTimer = undefined
  this.highlight = { revision: ++this.highlightRevision, sourceKey, itemUid, rows: this.rows.filter(row => row.sourceKey === sourceKey && row.itemUid === itemUid), active: false }
  this.viewing.clear()
  for (const row of this.rows) if (row.sourceKey === sourceKey && row.itemUid === itemUid) this.viewing.set(row.id, row.revision)
  this.publish()
 }
 beginHistoryViewing(scope: string, sourceKey: string | undefined, itemUid: string, expressionIdentity: string) {
  if (scope !== this.scope) return
  clearTimeout(this.highlightTimer); this.highlightTimer = undefined
  this.viewing.clear()
  this.highlight = { revision: ++this.highlightRevision, sourceKey, itemUid, rows: [], active: false, expressionIdentity }
  this.publish()
 }
 hasHistoryHighlight(scope: string, sourceKey: string | undefined, itemUid: string) {
  return scope === this.scope && this.highlight?.sourceKey === sourceKey && this.highlight?.itemUid === itemUid && this.highlight.expressionIdentity !== undefined
 }
 startHighlights(scope: string, sourceKey: string | undefined, itemUid: string) {
  const highlight = this.highlight
  if (scope !== this.scope || !highlight || highlight.sourceKey !== sourceKey || highlight.itemUid !== itemUid || highlight.active) return
  highlight.active = true
  this.highlightTimer = setTimeout(() => { if (this.highlight === highlight) { this.highlight = undefined; this.publish() } }, 2300)
  this.publish()
 }
 highlights(scope: string, sourceKey: string | undefined, itemUid: string | undefined) {
  const highlight = this.highlight
  return scope === this.scope && highlight?.active && highlight.sourceKey === sourceKey && highlight.itemUid === itemUid ? highlight : undefined
 }
 canAcknowledge(scope: string, item: ReactionNotification) {
  return scope === this.scope && this.viewing.get(item.id) === item.revision
 }
 acquire(scope: string) {
  if (this.scope !== scope || this.controller.signal.aborted) { this.stop(); this.scope = scope; this.controller = new AbortController(); this.rows = []; this.reading.clear(); this.viewing.clear(); this.acknowledged.clear(); this.error = ''; this.publish() }
  this.users++
  if (this.users === 1 && typeof document !== 'undefined') { document.addEventListener('visibilitychange', this.visibility); this.visibility() }
  return () => { if (this.scope === scope && --this.users === 0) this.stop() }
 }
 private stop() { clearTimeout(this.highlightTimer); this.highlight = undefined; this.viewing.clear(); clearTimeout(this.timer); this.controller.abort(); this.inflight = undefined; this.users = 0; if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visibility) }
 private visibility = () => { clearTimeout(this.timer); if (document.hidden) return; void this.refresh() }
 async refresh(): Promise<void> {
  if (this.inflight) return this.inflight
  if (!this.scope || this.controller.signal.aborted) return
  clearTimeout(this.timer)
  const scope = this.scope, signal = this.controller.signal
  const operation = (async () => {
   try {
    let cursor = '', hasMore = false
    const rows: ReactionNotification[] = []
    // Keep at most 200 actor/message rows; remaining persisted reminders enter as these are read.
    for (let pageIndex = 0; pageIndex < 4; pageIndex++) {
     const page = await this.transport({ action: 'notifications', accountKey: scope, after_id: cursor, limit: 50 }, signal) as ReactionNotificationPage
     if (signal.aborted) return
     rows.push(...page.items); hasMore = page.has_more
     if (!page.has_more) break
     if (!page.after_id || page.after_id === cursor) throw new Error('表态提醒加载不完整')
     cursor = page.after_id
    }
    let next = rows.filter(row => (this.acknowledged.get(row.id) ?? 0) < row.revision)
    const previous = new Map(this.rows.map(row => [row.id, row.revision]))
    const updated = next.filter(row => previous.get(row.id) !== row.revision)
    // Warm known message snapshots before exposing their new notification preview.
    // No timeline reads for unknown messages; cold navigation prepares those normally.
    if (updated.length) await reactionPreview.prepareNotifications(scope, updated, signal)
    if (signal.aborted) return
    next = next.filter(row => (this.acknowledged.get(row.id) ?? 0) < row.revision)
    const changed = this.error !== '' || this.hasMore !== hasMore || JSON.stringify(this.rows) !== JSON.stringify(next)
    this.rows = next; this.hasMore = hasMore; this.error = ''; this.retryMillis = 2_000; if (changed) this.publish()
   } catch (error) {
    if (!signal.aborted) { this.rows = []; this.error = error instanceof Error ? error.message : '表态提醒暂时无法加载'; this.retryMillis = Math.min(120_000, this.retryMillis * 2); this.publish() }
   }
  })()
  this.inflight = operation
  try { await operation } finally {
   if (!signal.aborted) { this.inflight = undefined; if (this.users && typeof document !== 'undefined' && !document.hidden) this.timer = setTimeout(() => { void this.refresh() }, this.retryMillis) }
  }
 }
 async seen(scope: string, items: readonly ReactionNotification[]) {
  if (scope !== this.scope || this.controller.signal.aborted) return
  const signal = this.controller.signal
  const batch = items.filter(item => !this.reading.has(item.id)).slice(0, 50)
  if (!batch.length) return
  for (const item of batch) this.reading.add(item.id)
  try {
   await this.transport({ action: 'notifications-read', accountKey: scope, items: batch.map(({ id, revision }) => ({ id, revision })) }, signal)
   if (signal.aborted) return
   for (const item of batch) { if (this.viewing.get(item.id) === item.revision) this.viewing.delete(item.id); this.acknowledged.set(item.id, item.revision); if (this.acknowledged.size > 200) this.acknowledged.delete(this.acknowledged.keys().next().value!) }
   this.rows = this.rows.filter(row => !batch.some(read => read.id === row.id && read.revision >= row.revision)); this.publish()
  } catch { /* Keep unread on failure. The next foreground poll permits another visible acknowledgement. */ }
  finally { if (!signal.aborted) for (const item of batch) this.reading.delete(item.id) }
 }
}
export const reactionNotifications = new ReactionNotifications()
