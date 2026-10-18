import type { TeamMessage, TeamReceipts, TeamReceiptMember } from '../team-app-contract.js'
import { callArkme } from './api.js'

export interface TeamReceiptState { value?: TeamReceipts; error?: string; loading: boolean; at: number }
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
  if (!value || value.hasMore !== false || value.senderExcluded !== true
    || value.members.some(m => !m.key || typeof m.read !== 'boolean')) return undefined
  const members = mergeTeamReceiptMembers([], value.members)
  return { read: members.filter(m => m.read).length, unread: members.filter(m => !m.read).length, total: members.length }
}

/** One account/conversation owner. Bounded visible-row reads; never reloads the timeline. */
export class TeamReceiptStore {
  private controller = new AbortController()
  private states = new Map<string, TeamReceiptState>()
  private listeners = new Set<() => void>()
  private visible = new Map<string, { message: TeamMessage; count: number }>()
  private queue: Array<() => Promise<void>> = []
  private pending = new Map<string, Promise<void>>()
  private active = 0
  private owners = 0
  retain() {
    this.owners++
    return () => { this.owners--; queueMicrotask(() => { if (!this.owners) this.dispose() }) }
  }
  constructor(private accountKey: string) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  get = (key: string) => this.states.get(key) ?? emptyTeamReceipt
  private emit() { for (const listener of this.listeners) listener() }
  watch(message: TeamMessage) {
    const old = this.visible.get(message.key)
    this.visible.set(message.key, { message, count: (old?.count ?? 0) + 1 })
    void this.load(message)
    return () => { const current = this.visible.get(message.key); if (current && --current.count <= 0) this.visible.delete(message.key) }
  }
  refreshVisible(force = false) { for (const { message } of this.visible.values()) void this.load(message, false, force) }
  dispose() { this.controller.abort(); this.visible.clear(); this.states.clear(); this.emit(); this.listeners.clear() }
  private pump() {
    while (this.active < 2 && this.queue.length) {
      const job = this.queue.shift()!; this.active++
      void job().finally(() => { this.active--; this.pump() })
    }
  }
  load(message: TeamMessage, more = false, force = false): Promise<void> {
    if (this.controller.signal.aborted) return Promise.resolve()
    const pending = this.pending.get(message.key); if (pending) return pending
    const before = this.get(message.key)
    if (!force && !more && before.at && Date.now() - before.at < 15_000) return Promise.resolve()
    if (more && (!before.value?.hasMore || !before.value.nextCursor)) return Promise.resolve()
    let done!: () => void
    const promise = new Promise<void>(resolve => { done = resolve }); this.pending.set(message.key, promise)
    this.states.set(message.key, { ...before, loading: true }); this.emit()
    this.queue.push(async () => {
      try {
        if (this.controller.signal.aborted) return
        const fetchPage = (cursor?: string) => callArkme<TeamReceipts>('team.app.receipts', { messageRef: message.ref, expectedAccountKey: this.accountKey,
          ...(cursor ? { cursor } : {}) }, this.controller.signal)
        let value = await fetchPage(more ? before.value?.nextCursor : undefined)
        let members = mergeTeamReceiptMembers(more ? before.value?.members ?? [] : [], value.members)
        const cursors = new Set<string>()
        // Refresh already opened pages, retaining the user's detail scope.
        while (!more && members.length < (before.value?.members.length ?? 0) && value.hasMore) {
          if (!value.nextCursor || cursors.has(value.nextCursor)) throw new Error('阅读状态分页异常，请重试')
          cursors.add(value.nextCursor)
          value = await fetchPage(value.nextCursor)
          const next = mergeTeamReceiptMembers(members, value.members)
          if (value.hasMore && next.length === members.length) throw new Error('阅读状态分页异常，请重试')
          members = next
        }
        if (!this.controller.signal.aborted) this.states.set(message.key, { value: { ...value, members }, loading: false, at: Date.now() })
      } catch (error) {
        if (!this.controller.signal.aborted) {
          const body = (error as { body?: { code?: string; httpStatus?: number } })?.body
          const lost = /not_accessible|account-changed|auth/u.test(body?.code ?? '') || [401, 403].includes(body?.httpStatus ?? 0)
          if (lost) { this.controller.abort(); this.visible.clear(); this.states.clear() }
          this.states.set(message.key, { ...(!lost && before.value ? { value: before.value } : {}), loading: false, at: Date.now(), error: '阅读状态暂未更新，请重试' })
        }
      } finally { this.pending.delete(message.key); this.emit(); done() }
    })
    this.pump()
    return promise
  }
}
