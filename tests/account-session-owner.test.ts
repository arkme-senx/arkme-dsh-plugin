import { describe, expect, test, vi } from 'vitest'
import {
  ArkmeAccountSessionOwner,
  createArkmeAccountSessionOwner,
  type ArkmeAccountScopeBridge,
} from '../src/account-session-owner.js'
import type { ArkmeSessionCredentials, ArkmeSessionStore } from '../src/keychain-store.js'

function credentials(userId: number, accessToken = `access-${String(userId)}`): ArkmeSessionCredentials {
  return { userId, accessToken, refreshToken: `refresh-${String(userId)}` }
}

function fixture(initial?: ArkmeSessionCredentials, commitStatus: 'ready' | 'relaunch' = 'ready') {
  let value = initial
  const store: ArkmeSessionStore = {
    read: vi.fn(async () => value),
    write: vi.fn(async next => { value = next }),
    delete: vi.fn(async () => { value = undefined }),
  }
  const bridge: ArkmeAccountScopeBridge = {
    attest: vi.fn(async () => ({ status: 'ready' })),
    prepare: vi.fn(async () => ({ transitionRef: 'scope-transition-1' })),
    commit: vi.fn(async () => ({ status: commitStatus })),
    abort: vi.fn(async () => ({ status: 'ready' })),
  }
  return { bridge, owner: new ArkmeAccountSessionOwner(store, bridge, true), store }
}

describe('Arkme account session owner', () => {
  test('attests the persisted account before exposing it to remote consumers', async () => {
    const { bridge, owner } = fixture(credentials(42))

    expect(await owner.scopedSession()).toBeUndefined()
    await owner.start()

    expect(bridge.attest).toHaveBeenCalledWith({ kind: 'account', userId: 42 })
    expect(await owner.scopedSession()).toEqual(credentials(42))
  })

  test('prepares, writes, and commits a guest-to-account claim in order', async () => {
    const { bridge, owner, store } = fixture()
    await owner.start()
    const events: string[] = []
    vi.mocked(bridge.prepare).mockImplementation(async () => { events.push('prepare'); return { transitionRef: 'scope-transition-1' } })
    vi.mocked(store.write).mockImplementation(async () => { events.push('write') })
    vi.mocked(bridge.commit).mockImplementation(async () => { events.push('commit'); return { status: 'ready' } })

    await owner.write(credentials(42))

    expect(events).toEqual(['prepare', 'write', 'commit'])
    expect(store.write).toHaveBeenCalledWith(credentials(42))
  })

  test('waits for Remote scope shutdown before mutating credentials', async () => {
    const { bridge, owner, store } = fixture()
    await owner.start()
    const events: string[] = []
    vi.mocked(bridge.prepare).mockImplementation(async () => {
      events.push('prepare')
      return { transitionRef: 'scope-transition-1' }
    })
    owner.attachScopeCloseBarrier(async () => { events.push('remote-stopped') })
    vi.mocked(store.write).mockImplementation(async () => { events.push('write') })
    vi.mocked(bridge.commit).mockImplementation(async () => {
      events.push('commit')
      return { status: 'ready' }
    })

    await owner.write(credentials(42))

    expect(events).toEqual(['prepare', 'remote-stopped', 'write', 'commit'])
  })

  test('does not change credentials when prepare fails', async () => {
    const current = credentials(42)
    const { bridge, owner, store } = fixture(current)
    await owner.start()
    vi.mocked(bridge.prepare).mockRejectedValue(new Error('bridge unavailable'))

    await expect(owner.delete()).rejects.toThrow('bridge unavailable')

    expect(store.delete).not.toHaveBeenCalled()
    expect(await owner.scopedSession()).toEqual(current)
  })

  test('aborts without credential changes when Remote shutdown fails', async () => {
    const current = credentials(42)
    const { bridge, owner, store } = fixture(current)
    await owner.start()
    owner.attachScopeCloseBarrier(async () => { throw new Error('remote stop failed') })

    await expect(owner.delete()).rejects.toThrow('remote stop failed')

    expect(store.delete).not.toHaveBeenCalled()
    expect(bridge.abort).toHaveBeenCalledWith('scope-transition-1')
    expect(await owner.scopedSession()).toEqual(current)
  })

  test('aborts the prepared transition when credential persistence fails', async () => {
    const { bridge, owner, store } = fixture()
    await owner.start()
    vi.mocked(store.write).mockRejectedValue(new Error('keychain failed'))

    await expect(owner.write(credentials(42))).rejects.toThrow('keychain failed')

    expect(bridge.abort).toHaveBeenCalledWith('scope-transition-1')
    expect(bridge.commit).not.toHaveBeenCalled()
  })

  test('keeps remote consumers gated while the client relaunches', async () => {
    const { owner } = fixture(undefined, 'relaunch')
    await owner.start()

    await owner.write(credentials(42))

    expect(await owner.scopedSession()).toBeUndefined()
  })

  test('refreshes credentials for the same account without switching scope', async () => {
    const { bridge, owner, store } = fixture(credentials(42))
    await owner.start()

    await owner.write(credentials(42, 'updated-access'))

    expect(store.write).toHaveBeenCalledWith(credentials(42, 'updated-access'))
    expect(bridge.prepare).not.toHaveBeenCalled()
  })

  test('marks an empty guest scope so an existing account container can be restored', async () => {
    const { bridge, owner } = fixture()
    owner.attachGuestConversationProbe(async () => false)
    await owner.start()

    await owner.write(credentials(42))

    expect(bridge.prepare).toHaveBeenCalledWith({ kind: 'account', userId: 42, claimCurrentGuest: false })
  })

  test('uses the client account-scope wire actions without exposing credentials', async () => {
    let value: ArkmeSessionCredentials | undefined
    const store: ArkmeSessionStore = {
      read: async () => value,
      write: async next => { value = next },
      delete: async () => { value = undefined },
    }
    const requests: Array<Record<string, unknown>> = []
    const fetchImpl = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push(body)
      const action = body.action
      const result = action === 'account.scope.prepare'
        ? { transitionRef: 'scope-transition-1' }
        : { status: 'ready' }
      return new Response(JSON.stringify({ ok: true, value: result }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    const owner = createArkmeAccountSessionOwner(store, fetchImpl, {
      ARKME_ACCOUNT_SCOPE_REQUIRED: '1',
      ARKME_DESKTOP_BRIDGE_URL: 'http://127.0.0.1:3210/v1/actions',
      ARKME_DESKTOP_BRIDGE_TOKEN: 'desktop_bridge_token_0123456789abcdef',
      ARKME_DESKTOP_BRIDGE_SESSION_ID: 'desktop-session-1',
    })

    await owner.start()
    await owner.write(credentials(42))

    expect(requests.map(request => request.action)).toEqual([
      'account.scope.attest', 'account.scope.prepare', 'account.scope.commit',
    ])
    expect(JSON.stringify(requests)).not.toContain('access-42')
    expect(JSON.stringify(requests)).not.toContain('refresh-42')
  })

  test('does not send account actions to an old desktop bridge without the required capability env', async () => {
    const store: ArkmeSessionStore = {
      read: async () => credentials(42),
      write: async () => undefined,
      delete: async () => undefined,
    }
    const fetchImpl = vi.fn() as typeof fetch
    const owner = createArkmeAccountSessionOwner(store, fetchImpl, {
      ARKME_DESKTOP_BRIDGE_URL: 'http://127.0.0.1:3210/v1/actions',
      ARKME_DESKTOP_BRIDGE_TOKEN: 'desktop_bridge_token_0123456789abcdef',
      ARKME_DESKTOP_BRIDGE_SESSION_ID: 'desktop-session-1',
    })

    await owner.start()

    expect(await owner.scopedSession()).toEqual(credentials(42))
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
