import { afterEach, describe, expect, it, vi } from 'vitest'
import { createArkmeSdk, ArkmeClientError } from '../src/sdk/index.js'
import type { ArkmeProviderState } from '../src/types.js'

function success(value: unknown): Response {
  return new Response(JSON.stringify({ ok: true, value }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => { vi.useRealTimers() })

describe('Arkme SDK', () => {
  it('binds the default browser fetch to the global receiver', async () => {
    const originalFetch = globalThis.fetch
    const receiverFetch = vi.fn(function (this: unknown) {
      expect(this).toBe(globalThis)
      return Promise.resolve(success({ status: 'logged-out', environment: 'test' }))
    }) as unknown as typeof fetch
    globalThis.fetch = receiverFetch
    try {
      const sdk = createArkmeSdk()
      await expect(sdk.authStatus()).resolves.toMatchObject({ status: 'logged-out' })
      expect(receiverFetch).toHaveBeenCalledOnce()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('encapsulates the Provider route and validates the contract version', async () => {
    const calls: Array<{ operation: string; params?: Record<string, unknown> }> = []
    const sdk = createArkmeSdk({
      fetchImpl: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as { operation: string; params?: Record<string, unknown> }
        calls.push(request)
        if (request.operation === 'provider.capabilities') {
          return success({
            contractVersion: 1,
            provider: '@senguoyun/dsh-arkme',
            sdk: '@senguoyun/dsh-arkme/sdk',
            environment: 'test',
            features: {
              authStatus: true, cachedSnapshot: true, remoteRefresh: true, search: true,
              createText: true, retryOutbox: true, revisionPolling: true, userProfile: true, imageRead: true,
            },
            limits: { maxTextLength: 20_000, maxSearchResults: 30, maxSyncPages: 20, maxImageBytes: 2_097_152 },
          })
        }
        if (request.operation === 'records.search') {
          return success({ items: [], cacheComplete: true, cachedAtMillis: 1, revision: 4 })
        }
        if (request.operation === 'user.profile.refresh') {
          return success({
            profile: {
              userId: 1, displayName: '昵称', nickname: '昵称', avatarRef: '', arkmeId: 'arkme-id',
              accountType: 1, createdAt: 1, bindings: { apple: false, wechat: true, google: false }, contact: {},
            },
            cachedAtMillis: 1,
            revision: 5,
          })
        }
        if (request.operation === 'image.read') {
          return success({ mediaType: 'image/png', bytes: 8, dataBase64: 'iVBORw0KGgo=' })
        }
        if (request.operation === 'records.create') return success({ recordUid: request.params?.recordUid, status: 1 })
        throw new Error(`unexpected ${request.operation}`)
      },
    })

    await expect(sdk.capabilities()).resolves.toMatchObject({ contractVersion: 1 })
    await expect(sdk.search('复盘', { limit: 5, syncAll: true })).resolves.toMatchObject({ revision: 4 })
    await expect(sdk.profile({ refresh: true })).resolves.toMatchObject({
      profile: { displayName: '昵称' }, revision: 5,
    })
    const image = await sdk.readImage('1_1700000000_1_0.png')
    expect(image).toMatchObject({ mediaType: 'image/png', bytes: 8 })
    expect(sdk.imageDataUrl(image)).toBe('data:image/png;base64,iVBORw0KGgo=')
    await expect(sdk.createText('保存内容', { recordUid: 'a5d8df82-5b62-5b22-8f76-916a751ad63c' }))
      .resolves.toMatchObject({ status: 1 })
    expect(calls).toMatchObject([
      { operation: 'provider.capabilities' },
      { operation: 'records.search', params: { query: '复盘', limit: 5, syncAll: true } },
      { operation: 'user.profile.refresh' },
      { operation: 'image.read', params: { imageRef: '1_1700000000_1_0.png' } },
      {
        operation: 'records.create',
        params: { recordUid: 'a5d8df82-5b62-5b22-8f76-916a751ad63c', textContent: '保存内容' },
      },
    ])
    expect(() => createArkmeSdk({ route: 'https://example.com/api' })).toThrow(/same-origin/)
  })

  it('exposes unified source directory, timeline, and send operations', async () => {
    const calls: Array<{ operation: string; params?: Record<string, unknown> }> = []
    const sdk = createArkmeSdk({
      fetchImpl: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as { operation: string; params?: Record<string, unknown> }
        calls.push(request)
        if (request.operation === 'sources.list') return success({ directory: 'root', items: [], hasMore: false })
        if (request.operation === 'source.timeline') return success({
          source: { sourceRef: 'source-1', kind: 'private_chat', displayName: '小林', activeAtMillis: 0, unreadCount: 0 },
          items: [], hasMore: false,
        })
        if (request.operation === 'source.send-text') return success({
          sourceRef: 'source-1', itemUid: request.params?.recordUid, status: 1, localState: 'synced',
        })
        throw new Error(`unexpected ${request.operation}`)
      },
    })

    await expect(sdk.listSources('root')).resolves.toMatchObject({ directory: 'root' })
    await expect(sdk.readSource('source-1')).resolves.toMatchObject({ source: { displayName: '小林' } })
    await expect(sdk.sendText('source-1', '你好', { recordUid: 'record-1', relationUid: 'rel-1' }))
      .resolves.toMatchObject({ itemUid: 'record-1' })
    expect(calls).toMatchObject([
      { operation: 'sources.list', params: { directory: 'root' } },
      { operation: 'source.timeline', params: { sourceRef: 'source-1' } },
      { operation: 'source.send-text', params: { sourceRef: 'source-1', textContent: '你好', recordUid: 'record-1', relationUid: 'rel-1' } },
    ])
  })

  it('notifies subscribers only when auth identity or revision changes', async () => {
    vi.useFakeTimers()
    const states: ArkmeProviderState[] = [
      { contractVersion: 1, environment: 'test', authStatus: 'authenticated', userId: 1, revision: 2 },
      { contractVersion: 1, environment: 'test', authStatus: 'authenticated', userId: 1, revision: 2 },
      { contractVersion: 1, environment: 'test', authStatus: 'authenticated', userId: 1, revision: 3 },
    ]
    let index = 0
    const sdk = createArkmeSdk({
      fetchImpl: async () => success(states[Math.min(index++, states.length - 1)]),
    })
    const listener = vi.fn()
    const unsubscribe = sdk.subscribe(listener, { intervalMs: 500 })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(500)
    expect(listener.mock.calls.map(call => call[0].revision)).toEqual([2, 3])
    unsubscribe()
  })

  it('maps Provider failures to ArkmeClientError', async () => {
    const sdk = createArkmeSdk({
      fetchImpl: async () => new Response(JSON.stringify({
        ok: false,
        error: { code: 'login-required', message: '请先登录 Arkme', retryable: false },
      })),
    })
    await expect(sdk.state()).rejects.toBeInstanceOf(ArkmeClientError)
  })
})
