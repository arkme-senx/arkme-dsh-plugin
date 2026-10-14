import { automaticCapabilityKeys, type ArkmeCapabilitySetting, type ArkmeCapabilitySettings, type ArkmeCapabilityUpdate } from '../capabilities.js'
import { ArkmePluginError, objectValue, type ServiceRuntime } from './service.js'

function invalid(): never { throw new ArkmePluginError('capability-contract-invalid', '自动 AI 设置暂时无法确认，请重试', true, 502) }
export function parseCapability(raw: unknown): ArkmeCapabilitySetting {
  const value = objectValue(raw)
  if (!automaticCapabilityKeys.includes(value.key as never) || typeof value.title !== 'string' || typeof value.enabled !== 'boolean'
    || typeof value.version !== 'number' || !Number.isSafeInteger(value.version) || value.version < 0
    || typeof value.enabled_at !== 'number' || !Number.isSafeInteger(value.enabled_at) || value.enabled_at < 0
    || (value.enabled && (value.version === 0 || value.enabled_at === 0))) return invalid()
  return { key: value.key as ArkmeCapabilitySetting['key'], title: value.title, enabled: value.enabled, version: value.version, enabledAt: value.enabled_at }
}

export class CapabilityService {
  constructor(private readonly runtime: ServiceRuntime) {}
  private async session(expected?: string) {
    const session = await this.runtime.requireSession()
    const scope = `${this.runtime.config.environment}:${session.userId}`
    if (expected !== undefined && expected !== scope) throw new ArkmePluginError('capability-account-changed', '账号已切换，请重新读取设置', false, 409)
    return { session, scope }
  }
  async query(expectedScope?: string, signal?: AbortSignal): Promise<ArkmeCapabilitySettings> {
    const { session, scope } = await this.session(expectedScope)
    // Optional feature settings must not publish a Record-wide cooldown that
    // delays normal reads or writes. Existing request admission still applies.
    const raw = await this.runtime.authenticatedPost<unknown>('/api/v1/settings/capabilities/query', {}, session, signal, { lane: 'interactive-read', bypassCache: true, publishServiceCooldown: false })
    await this.session(scope)
    if (!Array.isArray(raw)) return invalid()
    const settings = raw.map(parseCapability)
    if (new Set(settings.map(item => item.key)).size !== settings.length) return invalid()
    return { accountScope: scope, settings }
  }
  async update(input: ArkmeCapabilityUpdate, expectedScope: string, signal?: AbortSignal): Promise<ArkmeCapabilitySettings> {
    if (!automaticCapabilityKeys.includes(input.key) || typeof input.enabled !== 'boolean' || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0
      || (input.enabled && input.billingConsent !== true) || !expectedScope) {
      throw new ArkmePluginError('capability-update-invalid', '请确认本次设置与 AI 额度使用说明', false, 400)
    }
    const { session, scope } = await this.session(expectedScope)
    const saved = parseCapability(await this.runtime.authenticatedPost<unknown>('/api/v1/settings/capabilities/update', { key: input.key, enabled: input.enabled, expected_version: input.expectedVersion }, session, signal, { publishServiceCooldown: false }))
    await this.session(scope)
    if (saved.key !== input.key || saved.enabled !== input.enabled || (saved.version !== input.expectedVersion && saved.version !== input.expectedVersion + 1)) return invalid()
    if (input.key === 'personal_profile' && input.enabled) await this.activateProfile(scope, signal)
    return this.query(scope, signal)
  }
  private async activateProfile(scope: string, signal?: AbortSignal): Promise<void> {
    const post = async (suffix: string, body: Record<string, unknown>) => {
      let { session } = await this.session(scope)
      const host = this.runtime.config.environment === 'prod' ? 'https://memory-core.jotmo.cc' : 'https://jotmo-memory-core.senguo.me'
      const request = () => this.runtime.post<Record<string, unknown>>(host, `/api/v1/personal-profile/v3/experience/${suffix}`, body, session.accessToken, [200], signal, false,
        this.runtime.authenticatedRequestOptions(session, 'intelligent', 'write', { bypassCache: true, publishServiceCooldown: false }))
      let result: Record<string, unknown>
      try { result = await request() } catch (error) {
        if (!(error instanceof ArkmePluginError) || !['auth-http-401', 'auth-http-403'].includes(error.code)) throw error
        session = await this.runtime.refreshAccessToken(session, signal)
        await this.session(scope)
        result = await request()
      }
      await this.session(scope)
      return result
    }
    const home = await post('activate', {})
    if (home.activated !== true) return invalid()
    const processing = objectValue(home.processing), job = objectValue(home.latest_job)
    if (processing.phase === 'paused' && job.last_error_code === 'capability_disabled' && typeof processing.rebuild_run_id === 'string' && processing.rebuild_run_id) {
      await post('rebuild/resume', { run_id: processing.rebuild_run_id })
    }
  }
}
