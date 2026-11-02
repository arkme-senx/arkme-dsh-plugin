import { pointsUnits, type ArkmeAiPointsAccount } from '../ai-points.js'
import type { UnifiedModelCatalog } from '../model-directory.js'

export interface ModelAccountSnapshot {
  scope?: string | undefined
  catalog?: UnifiedModelCatalog | undefined
  account?: ArkmeAiPointsAccount | undefined
  catalogError?: string | undefined
  accountError?: string | undefined
  loading: boolean
}
/** Renderer-local, account-fenced owner shared by every model picker. */
export class UnifiedModelStore {
  private state: ModelAccountSnapshot = { loading: false }
  private listeners = new Set<() => void>()
  private controller: AbortController | undefined
  private pending: Promise<void> | undefined
  private refreshedAt = 0
  constructor(private readonly read: (operation: 'models.directory' | 'account.points.query', scope: string, signal: AbortSignal) => Promise<unknown>, private readonly now = Date.now) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = () => this.state
  private publish(next: ModelAccountSnapshot) { this.state = next; for (const listener of this.listeners) listener() }
  activate(scope?: string) {
    if (scope === this.state.scope) return
    this.controller?.abort(); this.pending = undefined; this.refreshedAt = 0
    this.publish({ scope, loading: false })
  }
  refresh(scope: string, force = false): Promise<void> {
    if (this.state.scope !== scope) return Promise.resolve()
    if (this.pending) return this.pending
    if (!force && this.refreshedAt && this.now() - this.refreshedAt < 30_000) return Promise.resolve()
    const controller = new AbortController(); this.controller = controller
    this.publish({ ...this.state, loading: true })
    const valid = () => !controller.signal.aborted && this.state.scope === scope && this.controller === controller
    const pending = Promise.allSettled([
      this.read('models.directory', scope, controller.signal).then(raw => {
        const value = raw as UnifiedModelCatalog
        if (value.accountScope !== scope || !Array.isArray(value.models)) throw new Error('模型目录与当前账号不匹配')
        if (valid()) this.publish({ ...this.state, catalog: value, catalogError: undefined })
      }).catch(error => { if (valid()) this.publish({ ...this.state, catalogError: error instanceof Error ? error.message : '模型目录读取失败' }) }),
      this.read('account.points.query', scope, controller.signal).then(raw => {
        const value = raw as ArkmeAiPointsAccount
        if (value.accountScope !== scope || value.unit !== 'ai_points') throw new Error('积分数据与当前账号不匹配')
        pointsUnits(value.availablePoints); pointsUnits(value.reservedPoints)
        if (valid()) this.publish({ ...this.state, account: value, accountError: undefined })
      }).catch(error => { if (valid()) this.publish({ ...this.state, account: undefined, accountError: error instanceof Error ? error.message : '积分读取失败' }) }),
    ]).then(() => {
      if (valid()) { this.refreshedAt = this.now(); this.publish({ ...this.state, loading: false }) }
    }).finally(() => { if (this.pending === pending) this.pending = undefined })
    this.pending = pending; return pending
  }
}
