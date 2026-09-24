import type { ReactionExpression, ReactionLibrary, ReactionLibraryResult, ReactionRequest } from '../reaction-contract.js'
import { callArkme, ArkmeClientError } from './api.js'

type Transport = (input: ReactionRequest, signal?: AbortSignal) => Promise<unknown>
/** One account-scoped server snapshot. Failed/ambiguous writes retain their request identity. */
export class ReactionLibraryStore {
  private scope: string | undefined
  private controller = new AbortController()
  private value: ReactionLibrary | undefined
  private loading: Promise<ReactionLibrary> | undefined
  private saving = false
  private pending: Extract<ReactionRequest, { action: 'library-set' }> | undefined
  private revision = 0
  private listeners = new Set<() => void>()
  constructor(private readonly transport: Transport = (input, signal) => callArkme('reactions', input, signal)) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot = () => this.revision
  private publish() { this.revision++; this.listeners.forEach(listener => listener()) }
  setScope(scope?: string) {
    if (this.scope === scope) return
    this.controller.abort(); this.controller = new AbortController(); this.scope = scope
    this.value = undefined; this.loading = undefined; this.saving = false; this.pending = undefined; this.publish()
  }
  read(scope: string) { return this.scope === scope ? this.value : undefined }
  async retry(scope: string) { if (this.pending) return this.save(scope, this.pending.items); return this.load(scope) }
  async load(scope: string): Promise<ReactionLibrary> {
    if (!scope || scope !== this.scope) throw new Error('账号已变化，请重新打开')
    if (this.loading) return this.loading
    const signal = this.controller.signal
    const operation = this.transport({ action: 'library-query', accountKey: scope }, signal).then(raw => {
      if (signal.aborted || scope !== this.scope) throw new Error('账号已变化')
      const value = raw as ReactionLibrary
      if (!Number.isSafeInteger(value.revision) || !Array.isArray(value.items)) throw new Error('短语数据不完整')
      this.value = value; this.publish(); return value
    })
    this.loading = operation
    try { return await operation } finally { if (this.loading === operation) this.loading = undefined }
  }
  async save(scope: string, items: ReactionExpression[]): Promise<ReactionLibrary> {
    if (scope !== this.scope || !this.value) throw new Error('请先加载短语')
    if (this.saving) throw new Error('正在保存，请稍候')
    if (items.length > 58) throw new Error('最多保存 58 条短语')
    // A new user action cannot silently overwrite an uncertain earlier write.
    if (this.pending && JSON.stringify(this.pending.items) !== JSON.stringify(items)) throw new Error('上次保存结果未确认，请重试上次操作')
    const command = this.pending ?? { action: 'library-set' as const, accountKey: scope, items, expected_revision: this.value.revision, request_id: crypto.randomUUID() }
    this.pending = command; this.saving = true
    const signal = this.controller.signal
    try {
      const result = await this.transport(command, signal) as ReactionLibraryResult
      if (signal.aborted || scope !== this.scope) throw new Error('账号已变化')
      this.value = result.library; this.pending = undefined; this.publish()
      if (result.outcome === 'revision_conflict') throw new Error('短语已在其他设备更新，已刷新，请重新操作')
      return result.library
    } catch (error) { if (!signal.aborted && error instanceof ArkmeClientError && !error.body.retryable) this.pending = undefined; throw error }
    finally { if (!signal.aborted) this.saving = false }
  }
}
export const reactionLibrary = new ReactionLibraryStore()
