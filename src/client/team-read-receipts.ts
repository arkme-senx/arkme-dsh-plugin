import type { TeamMessage, TeamReceipts, TeamReceiptMember, TeamReceiptSummaryBatch } from '../team-app-contract.js'
import { callArkme } from './api.js'

export interface TeamReceiptState { value?: TeamReceipts; error?: string | undefined; loading: boolean; at: number }
export const emptyTeamReceipt: TeamReceiptState = { loading: false, at: 0 }
export function mergeTeamReceiptMembers(previous: TeamReceiptMember[], next: TeamReceiptMember[]) {
  const items = [...previous], positions = new Map(items.flatMap((m, i) => m.key ? [[m.key, i] as const] : []))
  for (const member of next) {
    const index = member.key ? positions.get(member.key) : undefined
    if (index !== undefined) items[index] = member
    else { if (member.key) positions.set(member.key, items.length); items.push(member) }
  }
  return items
}
export function teamReceiptCounts(value?: TeamReceipts) {
  const v = value?.summary
  return v && [v.total, v.read, v.unread].every(n => Number.isSafeInteger(n) && n >= 0) && v.read + v.unread === v.total ? v : undefined
}

/** Account/conversation-scoped projection. Visible rows load summaries, never rosters. */
export class TeamReceiptStore {
  private controller = new AbortController()
  private states = new Map<string, TeamReceiptState>()
  private listeners = new Set<() => void>()
  private accessListeners = new Set<() => void>()
  private readListeners = new Set<(state: {lastSeq: number; myReadSeq: number; unread: number}) => void>()
  private visible = new Map<string, { message: TeamMessage; count: number }>()
  private details = new Map<string, {message: TeamMessage; count: number}>()
  private queue: Array<() => Promise<void>> = []
  private pending = new Map<string, Promise<void>>()
  private detailDirty = new Set<string>()
  private active = 0
  private owners = 0
  private summaryTimer: ReturnType<typeof setTimeout> | undefined
  private summaryRunning = false
  private summaryAgain = false
  private detailTimes = new Map<string, number>()
  retain() {
    this.owners++
    return () => { this.owners--; queueMicrotask(() => { if (!this.owners) this.dispose() }) }
  }
  constructor(private accountKey: string) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  subscribeAccessLost = (listener: () => void) => { this.accessListeners.add(listener); return () => { this.accessListeners.delete(listener) } }
  subscribeReadState = (listener: (state: {lastSeq:number; myReadSeq:number; unread:number}) => void) => { this.readListeners.add(listener); return () => { this.readListeners.delete(listener) } }
  get = (key: string) => this.states.get(key) ?? emptyTeamReceipt
  private emit() { for (const listener of this.listeners) listener() }
  watch(message: TeamMessage) {
    const old = this.visible.get(message.key)
    this.visible.set(message.key, { message, count: (old?.count ?? 0) + 1 })
    this.scheduleSummaries()
    return () => { const current = this.visible.get(message.key); if (current && --current.count <= 0) this.visible.delete(message.key) }
  }
  watchDetail(message: TeamMessage) {
    const old = this.details.get(message.key)
    this.details.set(message.key, {message, count: (old?.count ?? 0) + 1})
    void this.load(message)
    return () => { const current = this.details.get(message.key); if (current && --current.count <= 0) this.details.delete(message.key) }
  }
  refreshVisible(force = false) {
    if (force) for (const {message} of this.visible.values()) { const old = this.get(message.key); this.states.set(message.key, {...old, at: 0}) }
    this.scheduleSummaries()
    for (const {message} of this.details.values()) void this.load(message, false, force)
  }
  dispose() {
    this.controller.abort(); if (this.summaryTimer) clearTimeout(this.summaryTimer)
    this.visible.clear(); this.details.clear(); this.states.clear(); this.emit(); this.listeners.clear(); this.readListeners.clear(); this.accessListeners.clear()
  }
  private pump() {
    while (this.active < 2 && this.queue.length) {
      const job = this.queue.shift()!; this.active++
      void job().finally(() => { this.active--; this.pump() })
    }
  }
  private enqueue(job: () => Promise<void>) {
    const result = new Promise<void>(resolve => this.queue.push(async () => { try { await job() } finally { resolve() } }))
    this.pump(); return result
  }
  private fail(keys: string[], error: unknown) {
    const body = (error as { body?: {code?:string; httpStatus?:number} })?.body
    const lost = /not_accessible|account-changed|auth/u.test(body?.code ?? '') || [401,403].includes(body?.httpStatus ?? 0)
    if (lost) { this.controller.abort(); this.visible.clear(); this.details.clear(); this.states.clear(); for (const listener of this.accessListeners) listener() }
    for (const key of keys) this.states.set(key, {...(!lost ? this.get(key) : emptyTeamReceipt), loading:false, at:Date.now(), error:'阅读状态暂未更新，请重试'})
  }
  private scheduleSummaries() {
    if (this.controller.signal.aborted) return
    if (this.summaryRunning) { this.summaryAgain = true; return }
    if (!this.summaryTimer) this.summaryTimer = setTimeout(() => { this.summaryTimer = undefined; void this.summaries() }, 0)
  }
  private async summaries() {
    if (this.controller.signal.aborted) return
    const messages = [...this.visible.values()].map(v => v.message).filter(m => !this.get(m.key).at || Date.now() - this.get(m.key).at >= 15_000)
    if (!messages.length) return
    this.summaryRunning = true; this.summaryAgain = false
    try {
      for (let i = 0; i < messages.length; i += 50) {
        const batch = messages.slice(i,i+50)
        await this.enqueue(async () => {
          if (this.controller.signal.aborted) return
          try {
            const result = await callArkme<TeamReceiptSummaryBatch>('team.app.receipt-summaries', {messageRefs:batch.map(m => m.ref), expectedAccountKey:this.accountKey},this.controller.signal)
            if (this.controller.signal.aborted) return
            const byKey = new Map(result.items.map(item => [item.key,item]))
            if (byKey.size !== batch.length || batch.some(m => !byKey.has(m.key))) throw new Error('阅读状态返回不完整')
            for (const m of batch) {
              const old = this.get(m.key), item = byKey.get(m.key)!
              this.states.set(m.key,{...old, value:{...old.value, members:old.value?.members ?? [], ...item}, error:undefined, at:Date.now()})
            }
            for (const listener of this.readListeners) listener(result)
          } catch (error) { if (!this.controller.signal.aborted) this.fail(batch.map(m => m.key),error) }
          this.emit()
        })
      }
    } finally {
      this.summaryRunning = false
      if (this.summaryAgain) { for (const {message} of this.visible.values()) { const old=this.get(message.key);this.states.set(message.key,{...old,at:0}) }; this.scheduleSummaries() }
    }
  }
  load(message: TeamMessage, more = false, force = false): Promise<void> {
    if (this.controller.signal.aborted) return Promise.resolve()
    const pending = this.pending.get(message.key)
    // An invalidation during a detail request must survive request coalescing.
    if (pending) {
      if (!force || this.detailDirty.has(message.key)) return pending
      this.detailDirty.add(message.key)
      return pending.then(() => { this.detailDirty.delete(message.key); return this.load(message,false,true) })
    }
    const before = this.get(message.key)
    if (!force && !more && Date.now() - (this.detailTimes.get(message.key) ?? 0) < 15_000) return Promise.resolve()
    if (more && (!before.value?.hasMore || !before.value.nextCursor)) return Promise.resolve()
    this.states.set(message.key, { ...before, loading: true }); this.emit()
    const promise = this.enqueue(async () => {
      try {
        if (this.controller.signal.aborted) return
        const fetchPage = (cursor?: string) => callArkme<TeamReceipts>('team.app.receipts', { messageRef: message.ref, expectedAccountKey: this.accountKey,
          ...(cursor ? { cursor } : {}) }, this.controller.signal)
        let value = await fetchPage(more ? before.value?.nextCursor : undefined)
        let members = mergeTeamReceiptMembers(more ? before.value?.members ?? [] : [], value.members)
        const cursors = new Set<string>()
        while (!more && members.length < (before.value?.members.length ?? 0) && value.hasMore) {
          if (!value.nextCursor || cursors.has(value.nextCursor)) throw new Error('阅读状态分页异常，请重试')
          cursors.add(value.nextCursor); value = await fetchPage(value.nextCursor)
          const next = mergeTeamReceiptMembers(members, value.members)
          if (value.hasMore && next.length === members.length) throw new Error('阅读状态分页异常，请重试')
          members = next
        }
        if (!this.controller.signal.aborted) { this.states.set(message.key, { value: { ...value, members }, loading: false, at: Date.now() }); this.detailTimes.set(message.key,Date.now()) }
      } catch (error) { if (!this.controller.signal.aborted) this.fail([message.key],error) }
      finally { this.pending.delete(message.key); this.emit() }
    })
    this.pending.set(message.key,promise)
    return promise
  }
}
