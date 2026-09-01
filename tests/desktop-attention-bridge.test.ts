import { describe, expect, it, vi } from 'vitest'
import {
  ArkmeDesktopAttentionBridge,
  arkmeDesktopBridgeConfigFromEnv,
} from '../src/services/desktop-attention-bridge.js'

const config = {
  endpoint: 'http://127.0.0.1:43127/v1/actions',
  token: '0123456789abcdef0123456789abcdef',
  sessionId: 'desktop-session-1',
}

function success(value: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ ok: true, value }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function capabilities(notificationShow = true, mode: 'count' | 'dot' | 'unsupported' = 'count') {
  return success({
    schemaVersion: 1,
    sessionId: config.sessionId,
    capabilities: { notificationShow, badgeApplySnapshot: { mode } },
  })
}

describe('Arkme desktop attention bridge', () => {
  it('accepts only a complete loopback action endpoint', () => {
    expect(arkmeDesktopBridgeConfigFromEnv({
      ARKME_DESKTOP_BRIDGE_URL: config.endpoint,
      ARKME_DESKTOP_BRIDGE_TOKEN: config.token,
      ARKME_DESKTOP_BRIDGE_SESSION_ID: config.sessionId,
    })).toEqual(config)
    expect(arkmeDesktopBridgeConfigFromEnv({
      ARKME_DESKTOP_BRIDGE_URL: 'https://127.0.0.1:43127/v1/actions',
      ARKME_DESKTOP_BRIDGE_TOKEN: config.token,
      ARKME_DESKTOP_BRIDGE_SESSION_ID: config.sessionId,
    })).toBeUndefined()
    expect(arkmeDesktopBridgeConfigFromEnv({
      ARKME_DESKTOP_BRIDGE_URL: 'http://example.com:43127/v1/actions',
      ARKME_DESKTOP_BRIDGE_TOKEN: config.token,
      ARKME_DESKTOP_BRIDGE_SESSION_ID: config.sessionId,
    })).toBeUndefined()
    expect(arkmeDesktopBridgeConfigFromEnv({
      ARKME_DESKTOP_BRIDGE_URL: config.endpoint,
      ARKME_DESKTOP_BRIDGE_TOKEN: config.token,
    })).toBeUndefined()
  })

  it('uses the shared wire schema and enforces client title/body bounds', async () => {
    const requests: Array<Record<string, unknown>> = []
    const fetchImpl = vi.fn(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push(request)
      if (request.action === 'capabilities.get') return capabilities()
      return success({ accepted: false, outcome: 'expired' })
    }) as typeof fetch
    const bridge = new ArkmeDesktopAttentionBridge(config, fetchImpl)

    await expect(bridge.showNotification({
      idempotencyKey: 'event-1',
      kind: 'chat.message',
      occurredAtMillis: 100,
      expiresAtMillis: 200,
      presentation: { title: '题'.repeat(140), body: '文'.repeat(530) },
      activation: { kind: 'chat-source', sourceRef: 'opaque-source-ref', sourceKey: 'stable-source-key' },
    })).resolves.toEqual({ fallbackToBrowser: false, outcome: 'expired' })

    expect(requests[1]).toMatchObject({
      schemaVersion: 1,
      sessionId: config.sessionId,
      action: 'notification.show',
      payload: {
        idempotencyKey: 'event-1',
        kind: 'chat.message',
        activation: { kind: 'chat-source', sourceRef: 'opaque-source-ref', sourceKey: 'stable-source-key' },
      },
    })
    const payload = requests[1]!.payload as { presentation: { title: string; body: string } }
    expect(payload.presentation.title).toHaveLength(128)
    expect(payload.presentation.body).toHaveLength(512)
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: `Bearer ${config.token}` })
  })

  it('falls back only before native ownership and never double-sends uncertain or rate-limited requests', async () => {
    const unsupported = new ArkmeDesktopAttentionBridge(config, vi.fn(async () => capabilities(false)) as typeof fetch)
    await expect(unsupported.showNotification({
      idempotencyKey: 'unsupported', kind: 'chat.message', occurredAtMillis: 1, expiresAtMillis: 2,
      presentation: { title: '标题', body: '正文' }, activation: { kind: 'chat-source', sourceRef: 'source' },
    })).resolves.toEqual({ fallbackToBrowser: true, outcome: 'unsupported' })

    let calls = 0
    const uncertain = new ArkmeDesktopAttentionBridge(config, vi.fn(async () => {
      calls += 1
      if (calls === 1) return capabilities()
      throw new Error('response lost')
    }) as typeof fetch)
    await expect(uncertain.showNotification({
      idempotencyKey: 'uncertain', kind: 'chat.message', occurredAtMillis: 1, expiresAtMillis: 2,
      presentation: { title: '标题', body: '正文' }, activation: { kind: 'chat-source', sourceRef: 'source' },
    })).resolves.toEqual({ fallbackToBrowser: false, outcome: 'native-failed' })
    expect(calls).toBe(3)

    const limitedFetch = vi.fn(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { action: string }
      return request.action === 'capabilities.get' ? capabilities() : success({ accepted: false, outcome: 'rate-limited' })
    }) as typeof fetch
    const limited = new ArkmeDesktopAttentionBridge(config, limitedFetch)
    await expect(limited.showNotification({
      idempotencyKey: 'limited', kind: 'chat.message', occurredAtMillis: 1, expiresAtMillis: 2,
      presentation: { title: '标题', body: '正文' }, activation: { kind: 'chat-source', sourceRef: 'source' },
    })).resolves.toEqual({ fallbackToBrowser: false, outcome: 'rate-limited' })
    expect(limitedFetch).toHaveBeenCalledTimes(2)
  })

  it('refreshes notification authorization between intents in the same Harness lease', async () => {
    let capabilityReads = 0
    const fetchImpl = vi.fn(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { action: string }
      if (request.action === 'capabilities.get') {
        capabilityReads += 1
        return capabilities(capabilityReads > 1)
      }
      return success({ accepted: true, outcome: 'accepted' })
    }) as typeof fetch
    const bridge = new ArkmeDesktopAttentionBridge(config, fetchImpl)
    const notification = (idempotencyKey: string) => ({
      idempotencyKey, kind: 'chat.message' as const, occurredAtMillis: 1, expiresAtMillis: 2,
      presentation: { title: '标题', body: '正文' }, activation: { kind: 'chat-source' as const, sourceRef: 'source' },
    })

    await expect(bridge.showNotification(notification('before-grant')))
      .resolves.toEqual({ fallbackToBrowser: true, outcome: 'unsupported' })
    await expect(bridge.showNotification(notification('after-grant')))
      .resolves.toEqual({ fallbackToBrowser: false, outcome: 'accepted' })
    expect(capabilityReads).toBe(2)
  })

  it('sends absolute badge snapshots and rejects older summary revisions', async () => {
    const requests: Array<Record<string, unknown>> = []
    const bridge = new ArkmeDesktopAttentionBridge(config, vi.fn(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push(request)
      return request.action === 'capabilities.get' ? capabilities() : success({ accepted: true, outcome: 'accepted' })
    }) as typeof fetch, 1)

    await expect(bridge.applyBadgeSummary({ count: 7, revision: 100 })).resolves.toBe(true)
    await expect(bridge.applyBadgeSummary({ count: 99, revision: 90 })).resolves.toBe(true)
    await expect(bridge.applyBadgeSummary({ count: 8, revision: 100 })).resolves.toBe(true)
    await expect(bridge.applyBadgeSummary({ count: 1_500_000, revision: 101 })).resolves.toBe(true)
    await expect(bridge.resetBadgeCount()).resolves.toBe(true)

    expect(requests.filter(request => request.action === 'badge.applySnapshot').map(request => request.payload)).toEqual([
      { generation: 1, revision: 100, count: 7 },
      { generation: 1, revision: 101, count: 8 },
      { generation: 1, revision: 102, count: 999_999 },
      { generation: 2, revision: 1, count: 0 },
    ])
  })

  it('uses a process-monotonic producer generation across plugin reloads', async () => {
    const requests: Array<Record<string, unknown>> = []
    const fetchImpl = vi.fn(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push(request)
      return request.action === 'capabilities.get' ? capabilities() : success({ accepted: true, outcome: 'accepted' })
    }) as typeof fetch

    await new ArkmeDesktopAttentionBridge(config, fetchImpl, 100)
      .applyBadgeSummary({ count: 1, revision: 1 })
    await new ArkmeDesktopAttentionBridge(config, fetchImpl, 200)
      .applyBadgeSummary({ count: 2, revision: 1 })

    expect(requests.filter(request => request.action === 'badge.applySnapshot').map(request => request.payload))
      .toEqual([
        { generation: 100, revision: 1, count: 1 },
        { generation: 200, revision: 1, count: 2 },
      ])
  })

  it('retries an account-reset zero snapshot with the same generation and revision', async () => {
    const snapshots: Array<Record<string, unknown>> = []
    let badgeAttempts = 0
    const bridge = new ArkmeDesktopAttentionBridge(config, vi.fn(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>
      if (request.action === 'capabilities.get') return capabilities()
      snapshots.push(request.payload as Record<string, unknown>)
      badgeAttempts += 1
      return success(badgeAttempts === 1
        ? { accepted: false, outcome: 'native-failed' }
        : { accepted: true, outcome: 'accepted' })
    }) as typeof fetch, 50)

    await expect(bridge.resetBadgeCount()).resolves.toBe(true)
    expect(snapshots).toEqual([
      { generation: 51, revision: 1, count: 0 },
      { generation: 51, revision: 1, count: 0 },
    ])
  })
})
