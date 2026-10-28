import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ArkmeAccountSessionOwner, type ArkmeAccountScopeBridge } from '../src/account-session-owner.js'
import { ArkmeWindowsCredentialStore } from '../src/keychain-store.js'
import { ArkmeRemoteRealtimeHost, type ArkmeRemoteRealtimeHostOptions } from '../src/dsh-remote/host.js'
import { DshRemoteTurnUploadOutbox } from '../src/dsh-remote/turn-upload-outbox.js'
import type { DshRemoteControlPlane } from '../src/dsh-remote/types.js'
import { AuthService } from '../src/services/auth-service.js'
import { ProfileService } from '../src/services/profile-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../src/services/service.js'

const session = { userId: 42, accessToken: 'test-access', refreshToken: 'test-refresh' }
const config = { environment: 'test', authBaseUrl: 'https://auth.test', requestTimeoutMs: 1000 } as ArkmeServiceConfig
const json = (data: unknown, status = 200) => new Response(JSON.stringify({ code: 200, data }), { status })

function fixture(fetchImpl: typeof fetch) {
  let persisted: string | undefined = JSON.stringify(session)
  const backend = {
    read: vi.fn(async () => persisted),
    write: vi.fn(async (_service: string, _account: string, payload: string) => { persisted = payload }),
    delete: vi.fn(async () => { persisted = undefined }),
  }
  const store = new ArkmeWindowsCredentialStore('test-logout', backend)
  const bridge: ArkmeAccountScopeBridge = {
    attest: vi.fn(async () => ({ status: 'ready' })),
    prepare: vi.fn(async () => ({ transitionRef: 'test-transition' })),
    commit: vi.fn(async () => ({ status: 'ready' })),
    abort: vi.fn(async () => ({ status: 'ready' })),
  }
  const owner = new ArkmeAccountSessionOwner(store, bridge, true)
  const runtime = new ServiceRuntime(config, store, {} as StateStore, fetchImpl, undefined, owner)
  const auth = new AuthService(runtime, new ProfileService(runtime), { clearAccountState() {}, reconnectChatRealtime() {} })
  return { auth, runtime, owner, store, backend, bridge }
}

describe('logout across Remote and credential lifecycles', () => {
  it('finishes expiration and logout while Remote startup is awaiting the rejected refresh', async () => {
    const fetchImpl = vi.fn(async () => json({}, 401)) as unknown as typeof fetch
    const f = fixture(fetchImpl)
    await f.owner.start()
    const host = new ArkmeRemoteRealtimeHost({
      featureEnabled: true, profileRef: 'test', hostClientRef: 'test-host', platform: 'win32',
      readSession: async () => await f.owner.scopedSession() ? { userId: 42, clientId: 9 } : undefined,
      apiProxy: { capabilities: () => ['model.list'], subscribeProjectionEvents: () => () => {}, startEvents: () => () => {} },
      secretBroker: { ledgerKey: async () => Buffer.alloc(32, 7) },
      runtimeStore: {
        activateRuntime: async () => ({ runtimeRef: 'test-runtime', hostGeneration: 1, capabilities: [], updatedAtMillis: 1 }),
        account: async () => ({ displayName: 'Test Windows' }),
      },
      ledgerForAccount: () => ({ unsettledForReconciliation: () => [], cleanup() {}, close() {} }),
      realtime: { subscribeDisconnect: () => () => {}, disconnect: async () => {} },
      controlPlane: { registerDesktop: async (body: Record<string, unknown>, signal: AbortSignal) =>
        await f.runtime.authenticatedDshRemotePost('/test-register', body, undefined, signal) },
    } as unknown as ArkmeRemoteRealtimeHostOptions)
    let lifecycle = Promise.resolve()
    const unsubscribe = f.owner.subscribe(() => {
      if (!f.owner.ready()) host.cancelPendingConnection()
      const reconcile = async () => { if (f.owner.ready()) await host.start(); else await host.suspend() }
      lifecycle = lifecycle.then(reconcile, reconcile)
    })
    f.owner.attachScopeCloseBarrier(async () => { await lifecycle })
    try {
      await vi.waitFor(() => expect(f.backend.delete).toHaveBeenCalledOnce())
      await expect(f.auth.logout()).resolves.toMatchObject({ status: 'logged-out' })
      expect(await f.store.read()).toBeUndefined()
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    } finally {
      unsubscribe()
      await lifecycle
      await host.stop()
    }
  })

  it('closes a real history outbox when its expired request initiated account cleanup', async () => {
    const f = fixture(async () => json({}, 401))
    await f.owner.start()
    const directory = await mkdtemp(join(tmpdir(), 'arkme logout history '))
    const outbox = new DshRemoteTurnUploadOutbox({
      directory, profileRef: 'test', key: Buffer.alloc(32, 7),
      controlPlane: {
        prepareSessionTurnUpload: async (body: Record<string, unknown>, signal: AbortSignal) =>
          await f.runtime.authenticatedDshRemotePost('/test-upload', body, undefined, signal),
      } as unknown as DshRemoteControlPlane,
    })
    // Remote suspend awaits this same outbox.close() before deleting credentials.
    f.owner.attachScopeCloseBarrier(async () => { await outbox.close() })
    try {
      await outbox.capture('session-1', [
        { event: { type: 'turn/start', seq: 1, time: 1, data: {} } },
        { event: { type: 'turn/end', seq: 2, time: 2, data: {} } },
      ])
      await outbox.activate({ runtimeRef: 'test-runtime', profileRef: 'test', accountId: '42', hostGeneration: 1, capabilities: [], updatedAtMillis: 1 })
      await outbox.drain()
      await expect(f.auth.logout()).resolves.toMatchObject({ status: 'logged-out' })
      expect(f.backend.delete).toHaveBeenCalledOnce()
      expect(await f.auth.authStatus()).toMatchObject({ status: 'logged-out' })
      expect(f.bridge.commit).toHaveBeenCalledOnce()
    } finally {
      await outbox.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('detaches an aborted refresh waiter and keeps the shared refresh for other callers', async () => {
    const response = Promise.withResolvers<Response>()
    const fetchImpl = vi.fn(async () => await response.promise) as unknown as typeof fetch
    const f = fixture(fetchImpl)
    const abort = new AbortController()
    const first = f.runtime.refreshAccessToken(session, abort.signal)
    const firstResult = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce())
    abort.abort()
    await firstResult
    const second = f.runtime.refreshAccessToken(session)
    response.resolve(json({ access_token: 'new-access' }))
    await expect(second).resolves.toMatchObject({ accessToken: 'new-access' })
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(f.backend.write).toHaveBeenCalledOnce()
  })

  it('does not restore credentials when a refresh is queued behind explicit logout', async () => {
    const f = fixture(async () => json({ access_token: 'stale-access' }))
    await f.owner.start()
    const prepared = Promise.withResolvers<void>()
    const allowPrepare = Promise.withResolvers<void>()
    vi.mocked(f.bridge.prepare).mockImplementation(async () => {
      prepared.resolve()
      await allowPrepare.promise
      return { transitionRef: 'test-transition' }
    })
    const abort = new AbortController()
    let stopped: Promise<unknown> = Promise.resolve()
    f.owner.attachScopeCloseBarrier(async () => { abort.abort(); await stopped })
    const logout = f.auth.logout()
    await prepared.promise
    stopped = f.runtime.refreshAccessToken(session, abort.signal).catch(error => error)
    const shared = f.runtime.refreshAccessToken(session)
    const result = expect(shared).rejects.toMatchObject({ code: 'login-context-changed' })
    allowPrepare.resolve()
    await expect(logout).resolves.toMatchObject({ status: 'logged-out' })
    await result
    expect(await f.store.read()).toBeUndefined()
    expect(f.backend.write).not.toHaveBeenCalled()
  })
})
