import type { ArkmeSocialAccessSnapshot } from '../types.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'

/** Account owner decides; this service only deduplicates concurrent reads, never caches grants. */
export class SocialAccessService {
  private generation = 0
  private flight: { generation: number; revision: number; refresh: boolean; promise: Promise<ArkmeSocialAccessSnapshot> } | undefined
  private readonly unsubscribe: () => void
  constructor(private readonly runtime: ServiceRuntime) {
    this.unsubscribe = runtime.subscribeAccountScope(() => { this.generation++; this.flight = undefined })
  }
  dispose(): void { this.generation++; this.flight = undefined; this.unsubscribe() }
  async status(refresh = false): Promise<ArkmeSocialAccessSnapshot> {
    const session = await this.runtime.requireSession()
    const generation = this.generation
    // Existing account/profile writes invalidate this scope even when the user
    // stays logged in. A post-write read must not join a pre-write request.
    const revision = this.runtime.readRevision(this.runtime.requestScope(session.userId))
    if (this.flight?.generation === generation && this.flight.revision === revision && (!refresh || this.flight.refresh)) return await this.flight.promise
    const promise = (async (): Promise<ArkmeSocialAccessSnapshot> => {
      try {
        const result = await this.runtime.authenticatedAuthPost<{ allowed?: unknown }>('/api/v1/social-access/status', { refresh }, session, AbortSignal.timeout(2_000))
        if (typeof result.allowed !== 'boolean') throw new Error('invalid social access response')
        if (generation !== this.generation || (await this.runtime.requireSession()).userId !== session.userId) {
          throw new ArkmePluginError('account-changed', '账号已切换，请重新操作', false, 409)
        }
        return { userId: session.userId, allowed: result.allowed, ...(result.allowed ? {} : { reason: 'PHONE_BINDING_REQUIRED' as const }) }
      } catch (error) {
        if (generation !== this.generation || error instanceof ArkmePluginError && ['account-changed', 'login-required', 'login-expired'].includes(error.code)) throw error
        return { userId: session.userId, allowed: null, reason: 'SOCIAL_ACCESS_UNAVAILABLE' }
      }
    })()
    this.flight = { generation, revision, refresh, promise }
    try { return await promise } finally { if (this.flight?.promise === promise) this.flight = undefined }
  }
  async require(): Promise<void> {
    const snapshot = await this.status()
    if (snapshot.allowed === true) return
    if (snapshot.allowed === false) throw new ArkmePluginError('PHONE_BINDING_REQUIRED', '绑定手机号后可使用社交功能', false, 403)
    throw new ArkmePluginError('SOCIAL_ACCESS_UNAVAILABLE', '社交服务暂时不可用，请稍后重试', true, 503)
  }
}
