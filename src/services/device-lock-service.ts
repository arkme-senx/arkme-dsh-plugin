import type { ArkmeDeviceLockSnapshot } from '../device-lock-contract.js'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'
import { arkmeDesktopBridgeConfigFromEnv, requestArkmeDesktopBridge, type ArkmeDesktopBridgeAction, type ArkmeDesktopBridgeConfig } from './desktop-attention-bridge.js'
import { DeviceControlRealtime, deviceControlRealtimeOrigin } from './device-control-realtime.js'

interface NativeSnapshot {
  supported: boolean; locked: boolean; sessionEnded: boolean; needsCredentials: boolean; message: string
  userId?: number; clientId?: number; sessionId?: string; operationState?: ArkmeDeviceLockSnapshot['operationState']
}
const unavailable: ArkmeDeviceLockSnapshot = { available: false, locked: false, sessionEnded: false, message: '' }
function sameLogin(session: ArkmeSessionCredentials, native: NativeSnapshot): boolean {
  try {
    const claims = JSON.parse(Buffer.from(session.accessToken.split('.')[1] ?? '', 'base64url').toString()) as Record<string, unknown>
    return session.userId === native.userId && claims.client_id === native.clientId
      && (claims.session_id === native.sessionId || claims.session_id === undefined || claims.session_id === '')
  } catch { return false }
}

/** Host credential/lifecycle adapter. Only Electron's native owner can apply or release a lock. */
export class DeviceLockService {
  private state = unavailable
  private task: Promise<ArkmeDeviceLockSnapshot> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private boundToken = ''
  private supported: boolean | undefined
  private refreshAgain = false
  private readonly realtime: DeviceControlRealtime
  constructor(private readonly runtime: ServiceRuntime, private readonly localLogout: (expected: ArkmeSessionCredentials) => Promise<unknown>,
    private readonly config: ArkmeDesktopBridgeConfig | undefined = arkmeDesktopBridgeConfigFromEnv(process.env)) {
    this.realtime = new DeviceControlRealtime(deviceControlRealtimeOrigin(runtime.config), () => {
      if (this.disposed) return
      if (this.task !== undefined) this.refreshAgain = true
      else void this.refresh().catch(() => undefined)
    })
  }
  peek(): ArkmeDeviceLockSnapshot { return this.state }
  private async bridge(action: ArkmeDesktopBridgeAction, payload: object = {}): Promise<NativeSnapshot> {
    if (this.config === undefined) throw new ArkmePluginError('device-lock-unavailable', '当前桌面暂不支持锁定', false, 501)
    return await requestArkmeDesktopBridge(this.config, this.runtime.fetchImpl, action, payload, 30000) as unknown as NativeSnapshot
  }
  private project(native: NativeSnapshot, ready: boolean): ArkmeDeviceLockSnapshot {
    this.state = { available: ready && native.supported, locked: native.locked, sessionEnded: native.sessionEnded, message: native.message,
      ...(native.operationState === undefined ? {} : { operationState: native.operationState }) }
    return this.state
  }
  refresh(): Promise<ArkmeDeviceLockSnapshot> {
    if (this.config === undefined || this.disposed) return Promise.resolve(this.state)
    if (this.task !== undefined) return this.task
    const task = this.refreshCurrent().catch(error => {
      this.state = { ...this.state, available: false, message: this.state.locked ? '设备状态同步中，请稍后重试' : '' }
      throw error
    }).finally(() => {
      if (this.task === task) this.task = undefined
      clearTimeout(this.timer)
      if (!this.disposed) {
        const pending = this.state.operationState !== undefined && !['completed', 'closed'].includes(this.state.operationState)
        const delay = this.refreshAgain ? 0 : this.realtime.connected && !pending ? 60000 : this.state.available ? 5000 : 30000
        this.refreshAgain = false
        this.timer = setTimeout(() => { void this.refresh().catch(() => undefined) }, delay); this.timer.unref()
      }
    })
    this.task = task; return task
  }
  private async nativeSupported(): Promise<boolean> {
    if (this.config === undefined) return false
    if (this.supported !== undefined) return this.supported
    const value = await requestArkmeDesktopBridge(this.config, this.runtime.fetchImpl, 'capabilities.get', {})
    const capabilities = value.capabilities as { deviceLock?: { version?: number } } | undefined
    this.supported = capabilities?.deviceLock?.version === 1
    return this.supported
  }
  private async refreshCurrent(): Promise<ArkmeDeviceLockSnapshot> {
    if (!await this.nativeSupported() || this.disposed) return this.state
    let native = await this.bridge('device.lock.status')
    if (!native.supported && !native.locked) return this.project(native, false)
    let session = await this.runtime.accountScopedSession()
    if (this.disposed) return this.state
    if (native.sessionEnded && session !== undefined && sameLogin(session, native)) {
      await this.localLogout(session); session = undefined
    }
    if (session === undefined) {
      this.realtime.close(); this.boundToken = ''
      native = await this.bridge('device.lock.sync')
      if (native.sessionEnded && await this.runtime.sessionStore.read() === undefined) native = await this.bridge('device.lock.cleanup')
      return this.project(native, false)
    }
    if (this.boundToken !== session.accessToken || native.needsCredentials || native.sessionId === undefined || !sameLogin(session, native)) {
      if (native.needsCredentials) session = await this.runtime.refreshAccessToken(session)
      native = await this.bridge('device.lock.bind', { accessToken: session.accessToken })
      this.boundToken = session.accessToken
    }
    native = await this.bridge('device.lock.sync')
    if (native.needsCredentials) {
      session = await this.runtime.refreshAccessToken(session)
      native = await this.bridge('device.lock.bind', { accessToken: session.accessToken }); this.boundToken = session.accessToken
    }
    if (native.sessionEnded && sameLogin(session, native)) {
      this.realtime.close(); await this.localLogout(session)
      native = await this.bridge('device.lock.cleanup'); this.boundToken = ''; return this.project(native, false)
    }
    // A stopped Host or replaced login must not start a late orphan transport.
    const current = await this.runtime.accountScopedSession()
    if (this.disposed || current?.userId !== session.userId || current?.refreshToken !== session.refreshToken) return this.project(native, false)
    if (native.sessionId !== undefined) this.realtime.connect(session.userId, native.sessionId, session.accessToken)
    return this.project(native, this.boundToken !== '')
  }
  async lock(): Promise<ArkmeDeviceLockSnapshot> {
    if (this.disposed || !await this.nativeSupported()) throw new ArkmePluginError('device-lock-unavailable', '当前桌面暂不支持锁定', false, 501)
    const native = await this.bridge('device.lock.status')
    const session = await this.runtime.accountScopedSession()
    if (this.disposed || session === undefined || (native.sessionId !== undefined && !sameLogin(session, native)) || native.sessionEnded) throw new ArkmePluginError('login-context-changed', '登录状态已变化，请重试', true, 409)
    // Only local identity and native capability gate locking, never remote I/O.
    return this.project(await this.bridge('device.lock.lock'), true)
  }
  async requestUnlock(): Promise<ArkmeDeviceLockSnapshot> {
    if (this.disposed || !await this.nativeSupported()) throw new ArkmePluginError('device-lock-unavailable', '当前桌面暂不支持解锁', false, 501)
    const native = await this.bridge('device.lock.status')
    const session = await this.runtime.accountScopedSession()
    if (this.disposed || session === undefined || !sameLogin(session, native)) throw new ArkmePluginError('login-context-changed', '登录状态已变化，请重试', true, 409)
    if (native.sessionEnded) return this.refresh()
    // Local OS authentication must remain reachable while remote sync is down.
    // The native owner alone verifies credentials and applies the unlock fact.
    return this.project(await this.bridge('device.lock.unlock'), true)
  }
  async beforeLogout(expected?: ArkmeSessionCredentials): Promise<boolean> {
    if (!await this.nativeSupported()) return false
    // Once this login is bound, inability to revoke is an error, never a local
    // success. Older clients/backends with no binding retain existing logout.
    const native = await this.bridge('device.lock.status')
    const session = await this.runtime.accountScopedSession()
    if (expected !== undefined && (session?.userId !== expected.userId || session?.refreshToken !== expected.refreshToken)) throw new ArkmePluginError('login-context-changed', '登录状态已变化，请重试', true, 409)
    if (session === undefined || native.sessionId === undefined || !sameLogin(session, native)) return false
    this.project(await this.bridge('device.lock.logout', { sessionId: native.sessionId }), true); return true
  }
  async afterLogout(): Promise<void> { this.realtime.close(); this.boundToken = ''; const native = await this.bridge('device.lock.status'); this.project(native.sessionEnded ? await this.bridge('device.lock.cleanup') : native, false) }
  dispose(): void { this.disposed = true; clearTimeout(this.timer); this.realtime.close(); this.boundToken = '' }
}
