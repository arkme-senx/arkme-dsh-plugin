import type { ReactionRequest, ReactionSnapshot } from '../reaction-contract.js'
import type { WorldReactionContext, WorldReactionContextPage } from '../world-reaction-contract.js'
import { WORLD_REACTION_PENDING } from '../world-reaction-contract.js'
import { callArkme, ArkmeClientError } from './api.js'
import { ReactionPreviewStore } from './reaction-preview-store.js'
import { withArkmeReadDeadline } from './read-deadline.js'

export type WorldReactionContextState = { status: 'loading' | 'ready' | 'error' | 'unsupported' | 'unavailable'; context?: WorldReactionContext; message?: string }
type Entry = { refs: number; state: WorldReactionContextState; preparedAt: number }
type Prepare = (accountKey: string, refs: string[], signal: AbortSignal) => Promise<WorldReactionContextPage>

/** Batch mounted World cards. Missing server support is remembered until an explicit retry. */
export class WorldReactionContexts {
  private scope: string | undefined
  private controller = new AbortController()
  private entries = new Map<string, Entry>()
  private listeners = new Set<() => void>()
  private revision = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private reading = false
  private unsupported = false
  constructor(private readonly prepare: Prepare = (accountKey, recordRefs, signal) => withArkmeReadDeadline(readSignal => callArkme('world.reactions.prepare', { accountKey, recordRefs }, readSignal), signal)) {}
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  readonly getSnapshot = () => this.revision
  setScope(scope?: string) {
    if (scope === this.scope) return
    this.controller.abort(); this.controller = new AbortController(); clearTimeout(this.timer); this.timer = undefined
    this.scope = scope; this.entries.clear(); this.reading = false; this.unsupported = false; this.publish()
  }
  state(scope: string, ref: string) { return scope === this.scope ? this.entries.get(ref)?.state : undefined }
  watch(scope: string, ref: string) {
    if (scope !== this.scope) return () => {}
    let entry = this.entries.get(ref)
    if (!entry) {
      entry = { refs: 0, state: this.unsupported ? { status: 'unsupported', message: WORLD_REACTION_PENDING } : { status: 'loading' }, preparedAt: 0 }
      this.entries.set(ref, entry)
    } else if ((!entry.refs && ['unavailable', 'error'].includes(entry.state.status)) || (entry.state.status === 'ready' && Date.now() - entry.preparedAt > 5 * 60_000)) entry.state = { status: 'loading' }
    entry.refs++; this.schedule(); this.publish()
    return () => {
      if (scope !== this.scope || this.entries.get(ref) !== entry) return
      entry.refs = Math.max(0, entry.refs - 1)
      if (this.entries.size > 200) for (const [key, value] of this.entries) { if (!value.refs) this.entries.delete(key); if (this.entries.size <= 200) break }
    }
  }
  retry(scope: string, ref: string) {
    if (scope !== this.scope) return
    const entry = this.entries.get(ref)
    if (!entry) return
    this.unsupported = false; entry.state = { status: 'loading' }; this.publish(); this.schedule()
  }
  unavailable(scope: string, targetId: string) {
    if (scope !== this.scope) return
    for (const entry of this.entries.values()) if (entry.state.context?.target.id === targetId) entry.state = { status: 'unavailable', message: '这条内容已更新或不再公开，请刷新世界' }
    this.publish()
  }
  reprepare(scope: string, targetId: string) {
    if (scope !== this.scope) return
    for (const [ref, entry] of this.entries) if (entry.state.context?.target.id === targetId) { this.retry(scope, ref); break }
  }
  markUnsupported(scope: string) {
    if (scope !== this.scope) return
    this.unsupported = true
    for (const entry of this.entries.values()) if (entry.state.status !== 'unavailable') entry.state = { status: 'unsupported', message: WORLD_REACTION_PENDING }
    this.publish()
  }
  private schedule() { if (!this.timer && !this.reading) this.timer = setTimeout(() => { this.timer = undefined; void this.flush() }, 40) }
  private async flush() {
    const scope = this.scope, signal = this.controller.signal
    if (!scope || this.reading) return
    const batch = [...this.entries].filter(([, entry]) => entry.refs > 0 && entry.state.status === 'loading').slice(0, 50)
    if (!batch.length) return
    this.reading = true
    try {
      const page = await this.prepare(scope, batch.map(([ref]) => ref), signal)
      if (signal.aborted || scope !== this.scope) return
      const contexts = new Map(page.items.map(item => [item.recordRef, item]))
      const unavailable = new Set(page.unavailableRecordRefs)
      for (const [ref, entry] of batch) {
        const context = contexts.get(ref)
        entry.state = context ? { status: 'ready', context } : unavailable.has(ref) ? { status: 'unavailable', message: '这条内容已更新或不再公开，请刷新世界' } : { status: 'error', message: '世界表态数据不完整，请重试' }
        entry.preparedAt = Date.now()
      }
    } catch (error) {
      if (signal.aborted || scope !== this.scope) return
      const unsupported = error instanceof ArkmeClientError && ['world-reactions-unavailable', 'world-reactions-contract-invalid'].includes(error.body.code)
      if (unsupported) this.unsupported = true
      for (const entry of (unsupported ? this.entries.values() : batch.map(([, entry]) => entry))) {
        if (entry.state.status === 'loading') entry.state = { status: unsupported ? 'unsupported' : 'error', message: unsupported ? WORLD_REACTION_PENDING : error instanceof Error ? error.message : '世界表态加载失败，请重试' }
      }
    } finally { if (!signal.aborted && scope === this.scope) { this.reading = false; this.publish(); this.schedule() } }
  }
  private publish() { this.revision++; this.listeners.forEach(listener => listener()) }
}

export const worldReactionContexts = new WorldReactionContexts()
export const worldReactionPreview = new ReactionPreviewStore(async (input: ReactionRequest, signal?: AbortSignal) => {
  try {
    const result = await callArkme<unknown>('world.reactions', input, signal)
    if (input.action === 'query') {
      const returned = new Set((result as { items: ReactionSnapshot[] }).items.map(item => item.target_id))
      for (const target of input.targets) if (!returned.has(target.id)) worldReactionContexts.unavailable(input.accountKey, target.id)
    }
    return result
  } catch (error) {
    if (error instanceof ArkmeClientError && ['world-reactions-unavailable', 'world-reactions-contract-invalid'].includes(error.body.code)) worldReactionContexts.markUnsupported(input.accountKey)
    if (error instanceof ArkmeClientError && error.body.code === 'world-reactions-context-expired') {
      const targets = input.action === 'query' ? input.targets : 'target' in input ? [input.target] : []
      for (const target of targets) worldReactionContexts.reprepare(input.accountKey, target.id)
    }
    throw error
  }
})
