import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import type { LoginDeviceRequest, LoginDeviceResult, LoginDevice, DeviceOperation } from '../login-devices-contract.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'

type Ref = { scope: string; type: 'device' | 'cursor' | 'ticket'; expires: number; value: Record<string, unknown> }
const invalid = () => new ArkmePluginError('login-devices-invalid', '设备状态已变化，请刷新后重试', false, 409)
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid()
  return raw as Record<string, unknown>
}
function integer(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) throw invalid()
  return raw
}
function text(raw: unknown, max = 512): string {
  if (typeof raw !== 'string' || raw.length > max) throw invalid()
  return raw
}

/** The only owner for UI, SDK and Tools; no polling, per-window cache or credentials in projections. */
export class LoginDevicesService {
  constructor(private readonly runtime: ServiceRuntime, private readonly now = Date.now) {}
  private refKey: Promise<Buffer> | undefined
  private freshListsUntil = 0
  private key() {
    return this.refKey ??= this.runtime.stateStore.uniqueCode().then(secret => createHash('sha256').update('login-devices:v1:').update(secret).digest()).catch(error => { this.refKey = undefined; throw error })
  }
  private async seal(scope: string, type: Ref['type'], value: Ref['value'], lifetime = 15 * 60_000) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', await this.key(), iv)
    const encrypted = Buffer.concat([cipher.update(JSON.stringify({ scope, type, value, expires: this.now() + lifetime })), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')
  }
  private async open(scope: string, type: Ref['type'], input: unknown, allowExpired = false) {
    try {
      const bytes = Buffer.from(text(input, 4096), 'base64url')
      if (bytes.length < 29) throw invalid()
      const decipher = createDecipheriv('aes-256-gcm', await this.key(), bytes.subarray(0, 12))
      decipher.setAuthTag(bytes.subarray(12, 28))
      const ref = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')) as Ref
      if (ref.type !== type || ref.scope !== scope || !Number.isFinite(ref.expires) || (!allowExpired && ref.expires <= this.now())) throw invalid()
      return object(ref.value)
    } catch { throw invalid() }
  }
  private async session(scope: string) {
    const session = await this.runtime.requireSession()
    if (scope !== `${this.runtime.config.environment}:${session.userId}`) throw new ArkmePluginError('login-devices-account-changed', '账号已切换，请重新打开设备管理', false, 409)
    return session
  }
  async execute(input: LoginDeviceRequest, signal?: AbortSignal): Promise<LoginDeviceResult> {
    const request = object(input) as unknown as LoginDeviceRequest
    const scope = text(request.accountScope, 128), session = await this.session(scope)
    const binding = (credentials: typeof session) => {
      let sid: unknown
      try { sid = JSON.parse(Buffer.from(credentials.accessToken.split('.')[1] ?? '', 'base64url').toString('utf8')).sid } catch { /* Older credentials are bound to their refresh identity. */ }
      return createHash('sha256').update(typeof sid === 'string' && sid ? sid : credentials.refreshToken).digest('hex')
    }
    const login = binding(session), refScope = `${scope}:${login}`
    const requestScope = this.runtime.requestScope(session.userId), readPrefix = `login-devices:${login}:`
    const check = async () => { if (binding(await this.session(scope)) !== login) throw new ArkmePluginError('login-devices-account-changed', '登录状态已变化，请重新打开设备管理', false, 409) }
    const read = async (path: string, body: Record<string, unknown>) => {
      if ((path === 'list' || path === 'trusted') && this.freshListsUntil > this.now()) body = { ...body, fresh: true }
      const revision = this.runtime.readRevision(requestScope)
      const raw = await this.runtime.authenticatedAuthReadPost<unknown>(`/api/v1/login-devices/${path}`, body, session, signal, {
        key: `${readPrefix}${path}:${JSON.stringify(body)}`, cacheMs: 0, failureCooldownMs: 0, cancelWhenUnobserved: true,
      })
      await check()
      if (this.runtime.readRevision(requestScope) !== revision) throw invalid()
      return object(raw)
    }
    const write = async (path: string, body: Record<string, unknown>) => {
      this.runtime.invalidateKey(requestScope, readPrefix)
      try {
        const raw = await this.runtime.authenticatedAuthPost<unknown>(`/api/v1/login-devices/${path}`, body, session, signal)
        await check()
        return object(raw)
      } finally {
        // Cover the owner's five-second display cache and a bounded in-flight fill, including unknown write outcomes.
        this.freshListsUntil = Math.max(this.freshListsUntil, this.now() + 10_000)
        this.runtime.invalidateKey(requestScope, readPrefix)
      }
    }
    switch (request.action) {
      case 'list': case 'trusted': {
        const after = request.cursor ? await this.open(refScope, 'cursor', request.cursor) : { page: request.action, after: 0 }
        if (after.page !== request.action) throw invalid()
        const raw = await read(request.action, { after_client_id: integer(after.after), limit: 50 })
        if (!Array.isArray(raw.items) || raw.items.length > 50 || typeof raw.count_complete !== 'boolean') throw invalid()
        const capabilities = object(raw.capabilities)
        const items: LoginDevice[] = await Promise.all(raw.items.map(async item => {
          const d = object(item), client = integer(d.client_id), revision = integer(d.revision), sid = text(d.session_ref, 128)
          if (!client || !revision || !/^[A-Za-z0-9_-]{16,128}$/.test(sid) || typeof d.is_current !== 'boolean') throw invalid()
          return {
            id: createHash('sha256').update(await this.key()).update(`${scope}:${client}`).digest('hex'),
            ref: await this.seal(refScope, 'device', { client_id: client, session_ref: sid, revision, name: text(d.name, 120), current: d.is_current, platform: text(d.platform, 32) }),
            name: text(d.name, 120), platform: text(d.platform, 32), isCurrent: d.is_current,
            presence: d.presence === 'online' || d.presence === 'offline' ? d.presence : 'unknown',
            lastActiveAt: d.last_active_at ? integer(d.last_active_at) : null,
            canLogout: capabilities.logout === true && !d.is_current, canForget: capabilities.trusted === true && !d.is_current,
            notificationsSupported: d.notifications_supported === true,
          }
        }))
        const next = integer(raw.next_client_id)
        return { accountScope: scope, items, total: integer(raw.total), countComplete: raw.count_complete,
          observedAt: integer(raw.server_time), ...(next ? { cursor: await this.seal(refScope, 'cursor', { page: request.action, after: next }) } : {}) }
      }
      case 'events': {
        const cursor = request.cursor ? await this.open(refScope, 'cursor', request.cursor) : { page: 'events', after: '' }
        if (cursor.page !== 'events') throw invalid()
        const raw = await read('events', { cursor: text(cursor.after, 256), limit: 50 })
        if (!Array.isArray(raw.items) || raw.items.length > 50) throw invalid()
        const items = raw.items.map(item => { const e = object(item); return { id: text(e.id, 160), at: integer(e.at), name: text(e.name, 120), kind: text(e.kind, 32), method: e.method === undefined ? '' : text(e.method, 64) } })
        return { accountScope: scope, items, coverageStart: integer(raw.coverage_start), ...(raw.next_cursor ? { cursor: await this.seal(refScope, 'cursor', { page: 'events', after: text(raw.next_cursor, 256) }) } : {}) }
      }
      case 'prepare': {
        if (request.kind !== 'logout' && request.kind !== 'forget') throw invalid()
        const d = await this.open(refScope, 'device', request.ref)
        if (d.current) throw invalid()
        const ticket = await this.seal(refScope, 'ticket', { ...d, kind: request.kind, request_id: randomUUID() }, 5 * 60_000)
        return { accountScope: scope, ticket, kind: request.kind, name: text(d.name, 120), expiresAt: this.now() + 5 * 60_000 }
      }
      case 'confirm': case 'operation': {
        const d = await this.open(refScope, 'ticket', request.ticket, request.action === 'operation')
        if (d.kind !== 'logout' && d.kind !== 'forget') throw invalid()
        const result = (raw?: Record<string, unknown>): DeviceOperation => {
          let applied = false
          if (raw && raw.found !== false) {
            const receipt = object(raw.operation)
            if (receipt.request_id !== d.request_id || receipt.kind !== d.kind || integer(receipt.revision) !== integer(d.revision) + 1) throw invalid()
            applied = raw.credential_revoked === true
          }
          return { accountScope: scope, ticket: request.ticket, kind: d.kind as 'logout' | 'forget', state: applied ? 'applied' : 'unknown',
            cleanup: raw?.cleanup_state === 'complete' ? 'complete' : 'pending' }
        }
        if (request.action === 'operation') return result(await read('operation', { client_id: d.client_id, request_id: d.request_id }))
        try { return result(await write(d.kind, { client_id: d.client_id, session_ref: d.session_ref, revision: d.revision, request_id: d.request_id })) }
        catch (error) {
          if (error instanceof ArkmePluginError && (error.httpStatus === 409 || error.httpStatus === 400 || error.code === 'login-devices-account-changed')) throw error
          // A lost acknowledgement never authorizes a new operation ID.
          await check()
          try { return result(await read('operation', { client_id: d.client_id, request_id: d.request_id })) }
          catch { await check(); return result() }
        }
      }
      case 'notifications': case 'set-notifications': {
        const d = await this.open(refScope, 'device', request.ref)
        if (d.platform !== 'ios' && d.platform !== 'android') throw invalid()
        const body = { client_id: d.client_id, session_ref: d.session_ref }
        let raw: Record<string, unknown>
        if (request.action === 'set-notifications') {
          if (typeof request.messages !== 'boolean' || typeof request.calls !== 'boolean' || !/^[A-Za-z0-9_-]{16,128}$/.test(request.requestId)) throw invalid()
          raw = await write('notifications/set', { ...body, messages: request.messages, calls: request.calls, revision: integer(request.revision), request_id: request.requestId })
        } else raw = await read('notifications/get', body)
        if (typeof raw.messages !== 'boolean' || typeof raw.calls !== 'boolean' || typeof raw.supported !== 'boolean') throw invalid()
        return { accountScope: scope, name: text(d.name, 120), messages: raw.messages, calls: raw.calls, supported: raw.supported, revision: integer(raw.revision) }
      }
      default: throw invalid()
    }
  }
}
