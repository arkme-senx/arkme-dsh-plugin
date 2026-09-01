import type { FetchLike } from './service.js'

export type ArkmeDesktopBridgeAction =
  | 'capabilities.get'
  | 'notification.show'
  | 'badge.applySnapshot'
  | 'account.scope.attest'
  | 'account.scope.prepare'
  | 'account.scope.commit'
  | 'account.scope.abort'
export type ArkmeDesktopBridgeOutcome = 'accepted' | 'duplicate' | 'unsupported' | 'native-failed' | 'expired' | 'rate-limited'

export interface ArkmeDesktopBridgeConfig {
  endpoint: string
  token: string
  sessionId: string
}

export interface ArkmeDesktopNotificationPayload {
  idempotencyKey: string
  kind: 'chat.message'
  occurredAtMillis: number
  expiresAtMillis: number
  presentation: { title: string; body: string }
  activation: { kind: 'chat-source'; sourceRef: string; sourceKey?: string }
}

export interface ArkmeDesktopBadgeSnapshotPayload {
  generation: number
  revision: number
  count: number
}

export interface ArkmeDesktopNotificationDispatchResult {
  /** True only when no native side effect was attempted, so Browser fallback is safe. */
  fallbackToBrowser: boolean
  outcome: ArkmeDesktopBridgeOutcome | 'unavailable'
}

interface ArkmeDesktopCapabilities {
  notificationShow: boolean
  badgeApplySnapshot: { mode: 'count' | 'dot' | 'unsupported' }
}

interface ArkmeDesktopBridgeResponse {
  ok: true
  value: Record<string, unknown>
}

const DESKTOP_BRIDGE_TIMEOUT_MS = 2_000
const DESKTOP_NOTIFICATION_RETRY_MS = 250
const MAX_NOTIFICATION_TITLE_LENGTH = 128
const MAX_NOTIFICATION_BODY_LENGTH = 512
const MAX_NATIVE_BADGE_COUNT = 999_999

function nonEmptyBounded(value: string | undefined, maxLength: number): string | undefined {
  const normalized = value?.trim() ?? ''
  return normalized !== '' && normalized.length <= maxLength ? normalized : undefined
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

/**
 * Resolve the native bridge only when the complete, client-injected contract is
 * present. Partial or non-loopback configuration is rejected as unavailable;
 * no credential is ever sent to a caller-controlled origin.
 */
export function arkmeDesktopBridgeConfigFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): ArkmeDesktopBridgeConfig | undefined {
  const rawEndpoint = env.ARKME_DESKTOP_BRIDGE_URL?.trim() ?? ''
  const token = nonEmptyBounded(env.ARKME_DESKTOP_BRIDGE_TOKEN, 512)
  const sessionId = nonEmptyBounded(env.ARKME_DESKTOP_BRIDGE_SESSION_ID, 160)
  if (rawEndpoint === '' && token === undefined && sessionId === undefined) return undefined
  if (rawEndpoint === '' || token === undefined || token.length < 16 || /\s/.test(token)
    || sessionId === undefined || sessionId.length < 8 || !/^[A-Za-z0-9._:-]+$/.test(sessionId)) return undefined
  let endpoint: URL
  try { endpoint = new URL(rawEndpoint) }
  catch { return undefined }
  if (endpoint.protocol !== 'http:' || !isLoopbackHostname(endpoint.hostname) || endpoint.port === ''
    || endpoint.username !== '' || endpoint.password !== '' || endpoint.pathname !== '/v1/actions'
    || endpoint.search !== '' || endpoint.hash !== '') return undefined
  return { endpoint: endpoint.toString(), token, sessionId }
}

function responseObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export async function requestArkmeDesktopBridge(
  config: ArkmeDesktopBridgeConfig,
  fetchImpl: FetchLike,
  action: ArkmeDesktopBridgeAction,
  payload: object,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(config.endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ schemaVersion: 1, sessionId: config.sessionId, action, payload }),
    signal: AbortSignal.timeout(DESKTOP_BRIDGE_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`desktop bridge returned HTTP ${String(response.status)}`)
  const body = responseObject(await response.json()) as ArkmeDesktopBridgeResponse | undefined
  const value = responseObject(body?.value)
  if (body?.ok !== true || value === undefined) throw new Error('desktop bridge returned an invalid response')
  return value
}

function outcomeFromValue(value: Record<string, unknown>): ArkmeDesktopBridgeOutcome | undefined {
  if (typeof value.accepted !== 'boolean') return undefined
  return value.outcome === 'accepted' || value.outcome === 'duplicate'
    || value.outcome === 'unsupported' || value.outcome === 'native-failed' || value.outcome === 'expired'
    || value.outcome === 'rate-limited'
    ? value.outcome
    : undefined
}

export class ArkmeDesktopAttentionBridge {
  private capabilities?: ArkmeDesktopCapabilities
  private badgeRevision = 0
  private badgeSourceRevision = 0
  private badgeGeneration: number
  private lastBadgeCount: number | undefined
  private badgeMutationTail: Promise<void> = Promise.resolve()

  constructor(
    private readonly config: ArkmeDesktopBridgeConfig | undefined = arkmeDesktopBridgeConfigFromEnv(process.env),
    private readonly fetchImpl: FetchLike = fetch,
    badgeGeneration: number = Number(process.hrtime.bigint() / 1_000n),
  ) {
    this.badgeGeneration = Number.isSafeInteger(badgeGeneration) && badgeGeneration > 0
      ? badgeGeneration
      : Math.max(1, Date.now() * 1_000)
  }

  available(): boolean { return this.config !== undefined }

  async showNotification(payload: ArkmeDesktopNotificationPayload): Promise<ArkmeDesktopNotificationDispatchResult> {
    // Notification authorization can change while the app is running. Refresh
    // this cheap loopback handshake for each intent instead of pinning a denied
    // or newly-granted OS state for the whole Harness lease.
    const capabilities = await this.readCapabilities(true)
    if (capabilities?.notificationShow !== true) {
      return { fallbackToBrowser: true, outcome: capabilities === undefined ? 'unavailable' : 'unsupported' }
    }
    const boundedPayload: ArkmeDesktopNotificationPayload = {
      ...payload,
      presentation: {
        title: payload.presentation.title.trim().slice(0, MAX_NOTIFICATION_TITLE_LENGTH),
        body: payload.presentation.body.trim().slice(0, MAX_NOTIFICATION_BODY_LENGTH),
      },
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const value = await this.request('notification.show', boundedPayload)
        const outcome = outcomeFromValue(value) ?? 'native-failed'
        if (outcome !== 'native-failed' || attempt > 0) return { fallbackToBrowser: false, outcome }
      } catch {
        // Capability ownership was established before this side-effecting
        // request. Retry only the same idempotency key; never Browser-double.
        if (attempt > 0) return { fallbackToBrowser: false, outcome: 'native-failed' }
      }
      await new Promise<void>(resolve => { setTimeout(resolve, DESKTOP_NOTIFICATION_RETRY_MS) })
    }
    return { fallbackToBrowser: false, outcome: 'native-failed' }
  }

  async applyBadgeSummary(summary: { count: number; revision: number }): Promise<boolean> {
    const count = Math.min(MAX_NATIVE_BADGE_COUNT, Math.max(0, Math.trunc(Number.isFinite(summary.count) ? summary.count : 0)))
    const revision = Math.trunc(summary.revision)
    if (!Number.isSafeInteger(revision) || revision <= 0) return false
    const pending = this.badgeMutationTail.then(async () => await this.applyBadgeSnapshotSerial(count, revision))
    this.badgeMutationTail = pending.then(() => undefined, () => undefined)
    return await pending
  }

  async resetBadgeCount(): Promise<boolean> {
    const pending = this.badgeMutationTail.then(async () => {
      this.badgeGeneration += 1
      this.badgeRevision = 0
      this.badgeSourceRevision = 0
      this.lastBadgeCount = undefined
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (await this.applyBadgeSnapshotSerial(0, 1)) return true
      }
      return false
    })
    this.badgeMutationTail = pending.then(() => undefined, () => undefined)
    return await pending
  }

  private async applyBadgeSnapshotSerial(count: number, sourceRevision: number): Promise<boolean> {
    if (sourceRevision < this.badgeSourceRevision
      || (sourceRevision === this.badgeSourceRevision && count === this.lastBadgeCount)) return true
    const capabilities = await this.readCapabilities()
    if (capabilities === undefined) return this.config === undefined
    if (capabilities.badgeApplySnapshot.mode === 'unsupported') return true
    const revision = Math.max(sourceRevision, this.badgeRevision + 1)
    try {
      const value = await this.request('badge.applySnapshot', {
        generation: this.badgeGeneration,
        revision,
        count,
      } satisfies ArkmeDesktopBadgeSnapshotPayload)
      const outcome = outcomeFromValue(value)
      if (outcome !== 'accepted' && outcome !== 'duplicate') return false
      this.badgeRevision = revision
      this.badgeSourceRevision = sourceRevision
      this.lastBadgeCount = count
      return true
    } catch {
      return false
    }
  }

  private async readCapabilities(refresh = false): Promise<ArkmeDesktopCapabilities | undefined> {
    if (this.config === undefined) return undefined
    if (!refresh && this.capabilities !== undefined) return this.capabilities
    try {
      const value = await this.request('capabilities.get', {})
      if (value.schemaVersion !== 1 || value.sessionId !== this.config.sessionId) return undefined
      const capabilities = responseObject(value.capabilities)
      const badge = responseObject(capabilities?.badgeApplySnapshot)
      const mode = badge?.mode
      if (capabilities?.notificationShow !== true && capabilities?.notificationShow !== false) return undefined
      if (mode !== 'count' && mode !== 'dot' && mode !== 'unsupported') return undefined
      this.capabilities = {
        notificationShow: capabilities.notificationShow,
        badgeApplySnapshot: { mode },
      }
      return this.capabilities
    } catch {
      return undefined
    }
  }

  private async request(action: ArkmeDesktopBridgeAction, payload: object): Promise<Record<string, unknown>> {
    const config = this.config
    if (config === undefined) throw new Error('desktop bridge unavailable')
    return await requestArkmeDesktopBridge(config, this.fetchImpl, action, payload)
  }
}
