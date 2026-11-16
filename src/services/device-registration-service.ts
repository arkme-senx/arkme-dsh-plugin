import { randomUUID } from 'node:crypto'
import { platform } from 'node:os'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import { ServiceRuntime, objectValue, stringValue } from './service.js'

type Registration = { registration_generation: string; client_id: number }
type Binding = { binding_generation: string }
interface Scope {
  session: ArkmeSessionCredentials
  clientId: number
  requestId: string
  bindingRequestId: string
  expectedGeneration: string | undefined
  device?: Registration
  binding?: Binding
  registrationId?: string
  active: boolean
  running: boolean
  stopped: boolean
  failures: number
  reconciliations: number
  abort: AbortController
  timer?: ReturnType<typeof setTimeout>
}
// One Host owner per active account. SDK readiness is supplied by the existing
// elected call receiver, never inferred from obtaining credentials.
export class DeviceRegistrationService {
  private scope: Scope | undefined
  constructor(private readonly runtime: ServiceRuntime) {}

  start(session: ArkmeSessionCredentials): void {
    let clientId: number
    try {
      const claims = JSON.parse(Buffer.from(session.accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'))
      clientId = claims.client_id
    } catch { return }
    if (!Number.isSafeInteger(clientId) || clientId <= 0) return
    if (this.scope?.session.userId === session.userId && this.scope.clientId === clientId) {
      this.scope.session = session
      return
    }
    this.stop()
    const scope: Scope = { session, clientId, requestId: randomUUID(), bindingRequestId: randomUUID(),
      expectedGeneration: undefined, active: true, running: false, stopped: false, failures: 0, reconciliations: 0, abort: new AbortController() }
    this.scope = scope
    void this.tick(scope)
  }

  async ready(accountUserId: number, registrationId: string): Promise<void> {
    const session = await this.runtime.requireSession()
    if (session.userId !== accountUserId) return
    this.start(session)
    const scope = this.scope
    if (!scope || scope.session.userId !== accountUserId || !registrationId.trim()) return
    if (scope.registrationId && scope.registrationId !== registrationId) return
    scope.registrationId = registrationId
    if (scope.timer) clearTimeout(scope.timer)
    void this.tick(scope)
  }
  // Game SDK readiness uses the same registration owner as existing callers.
  // Never create a competing owner or unregister it when a game window closes.
  async waitUntilReady(accountUserId: number, registrationId: string): Promise<void> {
    await this.ready(accountUserId, registrationId)
    const scope = this.scope
    const deadline = Date.now() + 15000
    while (scope && this.current(scope) && Date.now() < deadline) {
      if (scope.binding && scope.registrationId === registrationId) return
      if (!scope.running) await this.tick(scope)
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('设备 IM 登记尚未完成，请重试')
  }

  activity(): void { if (this.scope) this.scope.active = true }
  clearUser(userId: number): void { if (this.scope?.session.userId === userId) this.stop() }
  dispose(): void { this.stop() }

  private async post<T>(scope: Scope, path: string, body: Record<string, unknown>): Promise<T> {
    return await this.runtime.authenticatedWebrtcPost<T>(path, body, scope.session, scope.abort.signal)
  }
  private current(scope: Scope): boolean { return this.scope === scope && !scope.stopped }
  private async tick(scope: Scope): Promise<void> {
    if (!this.current(scope) || scope.running) return
    scope.running = true
    try {
      const session = await this.runtime.accountScopedSession()
      if (!this.current(scope)) return
      if (!session || session.userId !== scope.session.userId) { this.stop(); return }
      scope.session = session
      if (!scope.device) {
        if (scope.expectedGeneration === undefined) {
          let cursor = ''
          scope.expectedGeneration = ''
          do {
            const page: { items: Registration[]; next_cursor?: string } = await this.post(scope, '/api/v1/device/list', { limit: 100, cursor })
            const existing = page.items.find(item => item.client_id === scope.clientId)
            if (existing) { scope.expectedGeneration = existing.registration_generation; break }
            cursor = page.next_cursor ?? ''
          } while (cursor && this.current(scope))
        }
        const result = await this.post<{ device: Registration }>(scope, '/api/v1/device/register', {
          platform: 5, os: platform(), client_version_name: this.runtime.config.appVersion ?? '', client_version_code: 0,
          request_id: scope.requestId, expected_generation: scope.expectedGeneration,
        })
        if (!this.current(scope)) return
        if (!result.device?.registration_generation) throw new Error('device registration response invalid')
        scope.device = result.device
      }
      if (!this.current(scope)) return
      if (scope.registrationId && !scope.binding) {
        const binding = await this.post<Binding>(scope, '/api/v1/device/im-binding/register', {
          registration_generation: scope.device.registration_generation,
          registration_id: scope.registrationId, request_id: scope.bindingRequestId,
        })
        if (!this.current(scope)) return
        if (!binding.binding_generation) throw new Error('IM binding response invalid')
        scope.binding = binding
      }
      const active = scope.active
      scope.active = false
      try {
        await this.post(scope, '/api/v1/device/heartbeat', {
          registration_generation: scope.device.registration_generation, event: active ? 'app_active' : 'heartbeat',
        })
      } catch (error) { scope.active ||= active; throw error }
      scope.failures = 0
    } catch (error) {
      // Stale ownership is not an invitation to repeatedly take over another owner.
      // Reconcile once; repeated fencing stops this owner. Transient failures retry
      // the exact same request ID to recover a lost successful response.
      scope.failures += 1
      const data = objectValue((error as { responseData?: unknown })?.responseData)
      if (stringValue(data.reason) === 'stale_generation') {
        if (scope.reconciliations++ === 0) {
          delete scope.device
          delete scope.binding
          scope.expectedGeneration = undefined
          scope.requestId = randomUUID()
          scope.bindingRequestId = randomUUID()
        } else scope.stopped = true
      }
    } finally {
      scope.running = false
      if (this.current(scope)) {
        const wait = scope.failures ? Math.min(30_000, 1000 * 2 ** Math.min(scope.failures, 5)) * (0.8 + Math.random() * 0.4) : 30_000
        scope.timer = setTimeout(() => { void this.tick(scope) }, wait)
        scope.timer.unref?.()
      }
    }
  }
  private stop(): void {
    const scope = this.scope
    this.scope = undefined
    if (!scope) return
    scope.stopped = true
    scope.abort.abort()
    if (scope.timer) clearTimeout(scope.timer)
    // Cleanup uses the captured OLD account token with a bounded lifetime. It
    // must not refresh/login or borrow credentials from the newly active account.
    const signal = AbortSignal.timeout(2000)
    const cleanup = async (path: string, body: Record<string, unknown>) => {
      try { await this.runtime.post(this.runtime.config.webrtcBaseUrl, path, body, scope.session.accessToken, [200], signal) } catch { /* lease expiry preserves honest offline state */ }
    }
    if (scope.device) {
      const generation = scope.device.registration_generation
      void (async () => {
        if (scope.binding) await cleanup('/api/v1/device/im-binding/unregister', {
          registration_generation: generation, binding_generation: scope.binding.binding_generation,
        })
        await cleanup('/api/v1/device/unregister', { registration_generation: generation })
      })()
    }
  }
}
