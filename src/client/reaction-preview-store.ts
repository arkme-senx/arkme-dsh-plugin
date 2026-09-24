import type { ArkmeSourceKind } from '../types.js'
import type { ReactionHistoryContext, ReactionRequest, ReactionSnapshot, ReactionSetResult, ReactionExpression, ReactionActorPage, ReactionGroupPage, ReactionTargetRef } from '../reaction-contract.js'
import { expressionLabel, labelExpression, expressionIdentity } from './reaction-expression.js'
import { reactionLibrary } from './reaction-library.js'
import { callArkme, ArkmeClientError } from './api.js'

export type ReactionPreviewTarget = ReactionTargetRef & { source: string; sourceKind?: ArkmeSourceKind; text: string; sourceKey?: string | undefined; itemUid?: string }
export interface ReactionPreviewEvent extends ReactionHistoryContext { id: string; eventId?: string; expression?: ReactionExpression; restricted?: boolean; source: string; sourceKind?: ArkmeSourceKind; text: string; label: string; added: boolean; at: number }
type Transport = (input: ReactionRequest, signal?: AbortSignal) => Promise<unknown>
/** Server-owned state. Poll mounted targets only; retain at most 400 recent inactive snapshots in this account/window. */
export class ReactionPreviewStore {
  private scope: string | undefined
  private controller = new AbortController()
  private targets = new Map<string, { target: ReactionPreviewTarget; count: number }>()
  private states = new Map<string, ReactionSnapshot>()
  private inactive = new Set<string>()
  private knownTargets = new Map<string, ReactionPreviewTarget>()
  private failures = new Map<string, string>()
  private listeners = new Set<() => void>()
  private revision = 0
  private refreshing: Promise<void> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private timerDue = 0
  private refreshAgain = false
  private retryMillis = 2000
  private pending: Extract<ReactionRequest, { action: 'set' }> | undefined
  private writing = false
  constructor(private readonly transport: Transport = (input, signal) => callArkme('reactions', input, signal)) {}
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  readonly getSnapshot = () => this.revision
  isScope(scope: string) { return this.scope === scope }
  setScope(scope?: string) {
    if (this.scope === scope) return
    this.controller.abort(); this.controller = new AbortController(); this.scope = scope
    this.stop(); this.targets.clear(); this.states.clear(); this.inactive.clear(); this.knownTargets.clear(); this.failures.clear(); this.pending = undefined; this.writing = false; this.refreshing = undefined; this.refreshAgain = false; this.retryMillis = 2000
    reactionLibrary.setScope(scope); this.publish()
  }
  watch(scope: string, target: ReactionPreviewTarget): () => void {
    if (scope !== this.scope) return () => {}
    const existing = this.targets.get(target.id)
    if (!existing && this.targets.size >= 200) { this.failures.set(target.id, '请打开消息后刷新表态'); return () => { this.failures.delete(target.id) } }
    this.inactive.delete(target.id)
    this.knownTargets.set(target.id, target)
    this.targets.set(target.id, { target, count: (existing?.count ?? 0) + 1 })
    if (this.refreshing) this.refreshAgain = true
    this.schedule(40)
    if (this.targets.size === 1 && typeof document !== 'undefined') document.addEventListener('visibilitychange', this.visibility)
    return () => {
      if (scope !== this.scope) return
      const current = this.targets.get(target.id)
      if (current && current.count > 1) current.count--
      else {
        this.targets.delete(target.id); this.failures.delete(target.id)
        // Conversation switches release polling, not the last confirmed display.
        // Returning mounts revalidate immediately using the newest opaque refs.
        if (this.states.has(target.id)) this.inactive.add(target.id)
        else this.knownTargets.delete(target.id)
        while (this.inactive.size > 400) {
          const oldest = this.inactive.values().next().value!
          this.inactive.delete(oldest); this.states.delete(oldest); this.knownTargets.delete(oldest)
        }
      }
      if (!this.targets.size) this.stop()
    }
  }
  async prepare(scope: string, targets: ReactionPreviewTarget[], signal: AbortSignal, force = false): Promise<void> {
    if (scope !== this.scope || signal.aborted) return
    const missing = targets.filter(target => force || !this.states.has(target.id)).slice(0, 200)
    if (!missing.length) return
    const releases = missing.map(target => this.watch(scope, target))
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let finish!: () => void
    const deadline = new Promise<void>(resolve => {
      finish = resolve
      timer = setTimeout(resolve, 1500)
      signal.addEventListener('abort', resolve as () => void, { once: true })
    })
    const alreadyReading = this.refreshing !== undefined
    const load = async () => {
      await this.refresh()
      // An earlier mounted-message read may have started before these targets joined.
      if (active && !signal.aborted && scope === this.scope && (alreadyReading || missing.some(target => !this.states.has(target.id) && !this.failures.has(target.id)))) await this.refresh()
    }
    try { await Promise.race([load(), deadline]) }
    finally {
      active = false
      clearTimeout(timer); signal.removeEventListener('abort', finish)
      releases.forEach(release => release())
    }
  }
  async prepareNotifications(scope: string, messages: readonly { sourceKey: string; itemUid: string }[], signal: AbortSignal) {
    if (scope !== this.scope || !messages.length) return
    const ids = new Set(messages.map(item => JSON.stringify([item.sourceKey, item.itemUid])))
    const targets = [...this.knownTargets.values()].filter(target => ids.has(JSON.stringify([target.sourceKey, target.itemUid])))
    await this.prepare(scope, targets, signal, true)
  }
  updateTarget(scope: string, target: ReactionPreviewTarget) {
    if (scope !== this.scope) return
    const current = this.targets.get(target.id)
    if (current) { current.target = target; this.knownTargets.set(target.id, target) }
  }
  private visibility = () => { if (!document.hidden) this.schedule(0); else { clearTimeout(this.timer); this.timer = undefined; this.timerDue = 0 } }
  private stop() { clearTimeout(this.timer); this.timer = undefined; this.timerDue = 0; if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visibility) }
  private schedule(delay: number) {
    if (!this.targets.size || (typeof document !== 'undefined' && document.hidden)) return
    const due = Date.now() + delay
    if (this.timer !== undefined && this.timerDue <= due) return
    clearTimeout(this.timer); this.timerDue = due
    this.timer = setTimeout(() => { this.timer = undefined; this.timerDue = 0; void this.refresh().catch(() => {}).finally(() => this.schedule(this.retryMillis)) }, delay)
  }
  snapshot(id: string) { return this.states.get(id) }
  busy(_id: string) { return this.writing }
  error(id: string) { return this.failures.get(id) }
  selections(id: string): readonly string[] { return this.states.get(id)?.mine.selections.map(item => expressionLabel(item.expression)) ?? [] }
  async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing
    const scope = this.scope, signal = this.controller.signal
    if (!scope) return
    const operation = (async () => {
      let failed = false
      const entries = new Map(this.targets)
      const targets = [...entries.values()].map(item => item.target)
      for (let offset = 0; offset < targets.length; offset += 50) {
        const batch = targets.slice(offset, offset + 50)
        const before = JSON.stringify(batch.map(t => [this.states.get(t.id), this.failures.get(t.id)]))
        try {
          const page = await this.transport({ action: 'query', accountKey: scope, targets: batch }, signal) as { items: ReactionSnapshot[] }
          if (signal.aborted) return
          const returned = new Set(page.items.map(item => item.target_id))
          for (const target of batch) if (this.targets.get(target.id) === entries.get(target.id)) {
            this.failures.delete(target.id)
            if (!returned.has(target.id)) { this.states.delete(target.id); this.failures.set(target.id, '消息已不可访问') }
          }
          for (const item of page.items) if (entries.has(item.target_id) && this.targets.get(item.target_id) === entries.get(item.target_id)) {
            // A read dispatched before a successful write cannot roll that actor's state back.
            const previous = this.states.get(item.target_id)
            if (!previous || previous.mine.revision <= item.mine.revision) this.states.set(item.target_id, item)
          }
        } catch (error) {
          if (signal.aborted) return
          failed = true
          for (const target of batch) if (this.targets.get(target.id) === entries.get(target.id)) { this.states.delete(target.id); this.failures.set(target.id, error instanceof Error ? error.message : '表态加载失败') }
        }
        if (!signal.aborted && before !== JSON.stringify(batch.map(t => [this.states.get(t.id), this.failures.get(t.id)]))) this.publish()
      }
      if (!signal.aborted) this.retryMillis = failed ? Math.min(120000, this.retryMillis * 2) : 2000
    })()
    this.refreshing = operation
    try { await operation } finally {
      if (this.refreshing === operation) {
        this.refreshing = undefined
        if (this.refreshAgain) { this.refreshAgain = false; this.schedule(0) }
      }
    }
  }
  async toggle(scope: string, target: ReactionPreviewTarget, label: string, expression?: ReactionExpression): Promise<boolean> {
    if (scope !== this.scope || this.writing) return false
    const chosen = expression ?? labelExpression(label)
    const signal = this.controller.signal
    this.writing = true
    this.failures.delete(target.id); this.publish()
    try {
      // Resolve an uncertain earlier command before accepting a different action,
      // even when its message has left the viewport. Reuse its exact request ID.
      if (this.pending && (this.pending.target.id !== target.id || expressionIdentity(this.pending.expression) !== expressionIdentity(chosen))) {
        const previous = this.pending
        const recovered = await this.transport(previous, signal) as ReactionSetResult
        if (signal.aborted) return false
        this.pending = undefined
        const old = this.states.get(previous.target.id)
        if (old) this.states.set(previous.target.id, { ...old, mine: recovered.state })
        if (recovered.outcome === 'revision_conflict') throw new Error('上次表态已在其他设备更新，请重新选择')
        await this.refresh()
      }
      if (!this.states.has(target.id)) await this.refresh()
      const state = this.states.get(target.id)
      if (signal.aborted || !state) throw new Error('请先成功加载消息表态')
      const selected = state.mine.selections.find(item => expressionIdentity(item.expression) === expressionIdentity(chosen))
      if (this.pending && (this.pending.target.id !== target.id || expressionIdentity(this.pending.expression) !== expressionIdentity(chosen))) throw new Error('上次表态结果未确认，请再次点击原表态重试')
      const command = this.pending ?? { action: 'set' as const, accountKey: scope, target, expression: chosen, active: !selected, expected_revision: state.mine.revision, request_id: crypto.randomUUID() }
      this.pending = command
      const result = await this.transport(command, signal) as ReactionSetResult
      if (signal.aborted) return false
      this.pending = undefined
      this.states.set(target.id, this.applyConfirmedState(this.states.get(target.id) ?? state, result.state, scope))
      if (result.outcome === 'revision_conflict') throw new Error('表态已在其他设备更新，请重新选择')
      this.failures.delete(target.id); this.publish()
      // Do not hold the click open while unrelated mounted messages refresh.
      void this.refresh().catch(() => {})
      return true
    } catch (error) {
      if (!signal.aborted && error instanceof ArkmeClientError && !error.body.retryable) this.pending = undefined
      if (!signal.aborted) { this.failures.set(target.id, error instanceof Error ? error.message : '表态失败，请重试'); this.publish() }
      return false
    } finally { if (!signal.aborted) { this.writing = false; this.publish() } }
  }
  private applyConfirmedState(snapshot: ReactionSnapshot, mine: ReactionSetResult['state'], scope: string): ReactionSnapshot {
    const before = new Map(snapshot.mine.selections.map(item => [item.key, item]))
    const after = new Map(mine.selections.map(item => [item.key, item]))
    const groups = new Map(snapshot.groups.map(group => [group.key, { ...group }]))
    const userId = Number(scope.split(':').at(-1))
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      const delta = Number(after.has(key)) - Number(before.has(key))
      if (!delta) continue
      const previous = groups.get(key)
      const count = Math.max(0, (previous?.count ?? 0) + delta)
      if (!count) { groups.delete(key); continue }
      const selection = after.get(key) ?? before.get(key)!
      const actors = (previous?.actors ?? []).filter(actor => actor.userId !== userId)
      if (delta > 0 && snapshot.actors_visible && Number.isSafeInteger(userId)) actors.push({ userId, displayName: '我' })
      groups.set(key, { key, expression: selection.expression, count, actors: actors.slice(0, 3) })
    }
    return { ...snapshot, mine, groups: [...groups.values()] }
  }
  async actors(scope: string, target: ReactionPreviewTarget, key: string, after = 0, signal?: AbortSignal): Promise<ReactionActorPage> {
    if (scope !== this.scope) throw new Error('账号已变化')
    const result = await this.transport({ action: 'actors', accountKey: scope, target, key, after_user_id: after, limit: 30 }, signal) as ReactionActorPage
    if (scope !== this.scope) throw new Error('账号已变化')
    return result
  }
  async groups(scope: string, target: ReactionPreviewTarget, after: string, signal?: AbortSignal): Promise<ReactionGroupPage> {
    if (scope !== this.scope) throw new Error('账号已变化')
    const result = await this.transport({ action: 'groups', accountKey: scope, target, after_key: after, limit: 30 }, signal) as ReactionGroupPage
    if (scope !== this.scope) throw new Error('账号已变化')
    return result
  }
  private publish() { this.revision++; this.listeners.forEach(listener => listener()) }
}
export const reactionPreview = new ReactionPreviewStore()
