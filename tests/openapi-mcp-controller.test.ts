import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionCredentials, ArkmeSessionStore } from '../src/keychain-store.js'
import {
  ManagedOpenApiMcpController,
  ManagedOpenApiMcpExecutionSupersededError,
} from '../src/openapi-mcp/controller.js'
import { InvalidManagedOpenApiCredentialError } from '../src/openapi-mcp/credential-store.js'
import { ObservedArkmeSessionStore } from '../src/openapi-mcp/session-observer.js'
import type {
  ManagedOpenApiControlPlane, ManagedOpenApiControlResult, ManagedOpenApiCredential,
  ManagedOpenApiCredentialStore, OpenApiMcpMount, OpenApiMcpReconcileLock, OpenApiMcpRuntime,
} from '../src/openapi-mcp/types.js'
import { SecretValue } from '../src/secret-value.js'

const keyId1 = '0123456789abcdef01234567'
const apiKey1 = `arkme_${keyId1}_${'A'.repeat(43)}`
const apiKey2 = `arkme_${keyId1}_${'B'.repeat(43)}`
const revision1 = `sha256:${'a'.repeat(64)}`
const revision2 = `sha256:${'b'.repeat(64)}`
const runtimeRevision1 = 'mcp-runtime-v1'
const runtimeRevision2 = 'mcp-runtime-v2'
const now = 1_700_000_000_000

function jwt(userId: number, clientId: number): string {
  return `header.${Buffer.from(JSON.stringify({ user_id: userId, client_id: clientId, exp: 2_000_000_000 })).toString('base64url')}.signature`
}

function activeSession(): ArkmeSessionCredentials {
  return { userId: 42, accessToken: jwt(42, 7), refreshToken: 'refresh-secret' }
}

class MemorySessionStore implements ArkmeSessionStore {
  failWrite = false
  constructor(public value: ArkmeSessionCredentials | undefined, private readonly order?: string[]) {}
  async read(): Promise<ArkmeSessionCredentials | undefined> { return this.value }
  async write(value: ArkmeSessionCredentials): Promise<void> {
    this.order?.push('session-write')
    if (this.failWrite) throw new Error('session write failed')
    this.value = value
  }
  async delete(): Promise<void> { this.order?.push('session-delete'); this.value = undefined }
}

class MemoryCredentialStore implements ManagedOpenApiCredentialStore {
  failWrite = false
  order: string[] = []
  constructor(public value: ManagedOpenApiCredential | undefined) {}
  async read(): Promise<ManagedOpenApiCredential | undefined> { this.order.push('read'); return this.value === undefined ? undefined : { ...this.value } }
  async write(value: ManagedOpenApiCredential): Promise<void> {
    this.order.push('write')
    if (this.failWrite) throw new Error('secure write failed')
    this.value = { ...value }
  }
  async delete(): Promise<void> { this.order.push('delete'); this.value = undefined }
}

class FakeRuntime implements OpenApiMcpRuntime {
  mountedKeys: string[] = []
  unavailable: Array<() => void> = []
  disposed = 0
  failReady = false
  failDispose = false
  constructor(private readonly order: string[]) {}
  mount(apiKey: SecretValue, _signal: AbortSignal, onUnavailable: () => void): OpenApiMcpMount {
    this.order.push('mount')
    this.mountedKeys.push(apiKey.reveal())
    this.unavailable.push(onUnavailable)
    let active = true
    return {
      ready: async () => {
        if (this.failReady) throw new Error('activation failed')
      },
      dispose: async () => {
        if (!active) return
        if (this.failDispose) throw new Error('dispose failed')
        active = false
        this.disposed++
        this.order.push('dispose')
      },
    }
  }
}

class ImmediateLock implements OpenApiMcpReconcileLock {
  async run<T>(_signal: AbortSignal, operation: () => Promise<T>): Promise<T> { return await operation() }
}

function issued(apiKey = apiKey1, revision = revision1, generation = 1): ManagedOpenApiControlResult {
  return {
    state: 'issued', keyId: keyId1, generation, apiKey, expiresAtMillis: now + 30 * 24 * 60 * 60_000,
    reconcileAfterSeconds: 21_600, mcpCatalogRevision: revision, mcpRuntimeRevision: runtimeRevision1,
  }
}

function ready(revision = revision1, generation = 1, runtimeRevision = runtimeRevision1): ManagedOpenApiControlResult {
  return {
    state: 'ready', keyId: keyId1, generation, expiresAtMillis: now + 30 * 24 * 60 * 60_000,
    reconcileAfterSeconds: 21_600, mcpCatalogRevision: revision, mcpRuntimeRevision: runtimeRevision,
  }
}

function stored(generation = 1): ManagedOpenApiCredential {
  return { schemaVersion: 1, userId: 42, loginDeviceId: 7, keyId: keyId1, generation, apiKey: apiKey1, expiresAtMillis: now + 24 * 60 * 60_000 }
}

function setup(input: { credential?: ManagedOpenApiCredential; ensure?: ManagedOpenApiControlResult } = {}) {
  const order: string[] = []
  const session = new MemorySessionStore(activeSession())
  const credentials = new MemoryCredentialStore(input.credential)
  credentials.order = order
  const runtime = new FakeRuntime(order)
  const control: ManagedOpenApiControlPlane = {
    ensure: vi.fn(async () => input.ensure ?? issued()),
    reauthorize: vi.fn(async () => issued(apiKey2, revision2, 2) as Extract<ManagedOpenApiControlResult, { state: 'issued' }>),
    disconnect: vi.fn(async () => undefined),
  }
  const logger = { warn: vi.fn() }
  const controller = new ManagedOpenApiMcpController({
    enabled: true, sessionStore: session,
    accessCredentialProvider: { resolveManagedAccessCredential: vi.fn(async () => new SecretValue('access-secret')) },
    controlPlane: control, credentialStore: credentials, runtime, reconcileLock: new ImmediateLock(), logger,
    now: () => now, random: () => 0.5,
  })
  return { controller, session, credentials, runtime, control, order, logger }
}

describe('managed OpenAPI MCP controller', () => {
  it('never guards a foreign Arkme MCP namespace before owning a managed mount', async () => {
    const fixture = setup()

    expect(fixture.controller.guardToolExecution('mcp__arkme__foreign_tool')).toBeUndefined()
    await fixture.controller.dispose()

    const disabled = new ManagedOpenApiMcpController({
      enabled: false,
      sessionStore: fixture.session,
      accessCredentialProvider: { resolveManagedAccessCredential: vi.fn(async () => new SecretValue('access-secret')) },
      controlPlane: fixture.control,
      credentialStore: fixture.credentials,
      runtime: fixture.runtime,
      reconcileLock: new ImmediateLock(),
      logger: fixture.logger,
    })
    expect(disabled.guardToolExecution('mcp__arkme__foreign_tool')).toBeUndefined()
    await disabled.dispose()
  })

  it('durably stores newly issued plaintext before mounting the official MCP runtime', async () => {
    const fixture = setup()
    await fixture.controller.retry()

    expect(fixture.order.indexOf('write')).toBeLessThan(fixture.order.indexOf('mount'))
    expect(fixture.runtime.mountedKeys).toEqual([apiKey1])
    expect(fixture.controller.status()).toMatchObject({ state: 'ready', retryable: false, userAction: 'none' })
    expect(fixture.controller.guardToolExecution('mcp__arkme__profile_get')).toBeUndefined()
    expect(JSON.stringify(fixture.controller.status())).not.toContain(keyId1)
    expect(JSON.stringify(fixture.controller.status())).not.toContain('42')
    await fixture.controller.dispose()
  })

  it('repairs a malformed secure credential by rotating through the control plane', async () => {
    const fixture = setup()
    vi.spyOn(fixture.credentials, 'read').mockRejectedValueOnce(
      new InvalidManagedOpenApiCredentialError('invalid stored credential'),
    )

    await fixture.controller.retry()

    expect(fixture.control.ensure).toHaveBeenCalledWith(expect.any(SecretValue), undefined, expect.any(AbortSignal))
    expect(fixture.credentials.value?.keyId).toBe(keyId1)
    expect(fixture.runtime.mountedKeys).toEqual([apiKey1])
    expect(fixture.logger.warn).toHaveBeenCalledWith(expect.stringContaining('(%s)'), 'credential-invalid')
    await fixture.controller.dispose()
  })

  it('skips superseded queued reconciliations instead of issuing or rotating twice', async () => {
    const fixture = setup()

    fixture.controller.start()
    await fixture.controller.retry()

    expect(fixture.control.ensure).toHaveBeenCalledOnce()
    expect(fixture.runtime.mountedKeys).toEqual([apiKey1])
    await fixture.controller.dispose()
  })

  it('remounts for a server catalog revision without recreating the API key', async () => {
    const fixture = setup({ credential: stored(), ensure: ready(revision1) })
    await fixture.controller.retry()
    vi.mocked(fixture.control.ensure).mockResolvedValue(ready(revision2))
    await fixture.controller.retry()

    expect(fixture.control.ensure).toHaveBeenCalledWith(
      expect.any(SecretValue), { keyId: keyId1, generation: 1 }, expect.any(AbortSignal),
    )
    expect(fixture.control.reauthorize).not.toHaveBeenCalled()
    expect(fixture.runtime.mountedKeys).toEqual([apiKey1, apiKey1])
    expect(fixture.runtime.disposed).toBe(1)
    expect(fixture.credentials.value).not.toHaveProperty('mcpRevision')
    await fixture.controller.dispose()
  })

  it('remounts for an MCP runtime contract revision without rotating or rewriting the API key', async () => {
    const fixture = setup({ credential: stored(), ensure: ready(revision1) })
    await fixture.controller.retry()
    const writesBeforeUpdate = fixture.order.filter(value => value === 'write').length
    vi.mocked(fixture.control.ensure).mockResolvedValue(ready(revision1, 1, runtimeRevision2))

    await fixture.controller.retry()

    expect(fixture.control.reauthorize).not.toHaveBeenCalled()
    expect(fixture.runtime.mountedKeys).toEqual([apiKey1, apiKey1])
    expect(fixture.runtime.disposed).toBe(1)
    expect(fixture.order.filter(value => value === 'write')).toHaveLength(writesBeforeUpdate)
    await fixture.controller.dispose()
  })

  it('persists a renewed expiry without remounting an unchanged MCP contract', async () => {
    const fixture = setup({ credential: stored(), ensure: ready() })

    await fixture.controller.retry()
    await fixture.controller.retry()

    expect(fixture.credentials.value?.expiresAtMillis).toBe(now + 30 * 24 * 60 * 60_000)
    expect(fixture.runtime.mountedKeys).toEqual([apiKey1])
    await fixture.controller.dispose()
  })

  it('retains and quarantines mount ownership when teardown fails, then retries cleanup before remounting', async () => {
    const fixture = setup({ credential: stored(), ensure: ready(revision1) })
    await fixture.controller.retry()
    fixture.runtime.failDispose = true
    vi.mocked(fixture.control.ensure).mockResolvedValue(ready(revision2))

    await fixture.controller.retry()

    expect(fixture.controller.status()).toMatchObject({ state: 'degraded', retryable: true })
    expect(fixture.controller.guardToolExecution('mcp__arkme__profile_get')).toContain('not ready')
    expect(fixture.runtime.mountedKeys).toEqual([apiKey1])

    fixture.runtime.failDispose = false
    await fixture.controller.retry()

    expect(fixture.runtime.mountedKeys).toEqual([apiKey1, apiKey1])
    expect(fixture.controller.status().state).toBe('ready')
    expect(fixture.controller.guardToolExecution('mcp__arkme__profile_get')).toBeUndefined()
    await fixture.controller.dispose()
  })

  it('retains a failed activating mount when its cleanup fails, then recovers without overlapping mounts', async () => {
    const fixture = setup({ credential: stored(), ensure: ready() })
    fixture.runtime.failReady = true
    fixture.runtime.failDispose = true

    await fixture.controller.retry()

    expect(fixture.controller.status()).toMatchObject({ state: 'degraded', retryable: true })
    expect(fixture.controller.guardToolExecution('mcp__arkme__profile_get')).toContain('not ready')
    expect(fixture.runtime.mountedKeys).toEqual([apiKey1])

    fixture.runtime.failReady = false
    fixture.runtime.failDispose = false
    await fixture.controller.retry()

    expect(fixture.runtime.mountedKeys).toEqual([apiKey1, apiKey1])
    expect(fixture.runtime.disposed).toBe(1)
    expect(fixture.controller.status().state).toBe('ready')
    await fixture.controller.dispose()
  })

  it('automatically rebuilds the same mount after the official MCP runtime loses all managed tools', async () => {
    vi.useFakeTimers()
    try {
      const fixture = setup({ credential: stored(), ensure: ready() })
      await fixture.controller.retry()

      fixture.runtime.unavailable[0]?.()

      expect(fixture.controller.status()).toMatchObject({ state: 'degraded', retryable: true })
      expect(fixture.controller.guardToolExecution('mcp__arkme__profile_get')).toContain('not ready')
      await vi.advanceTimersByTimeAsync(60_000)
      await Promise.resolve()
      await Promise.resolve()

      expect(fixture.runtime.mountedKeys).toEqual([apiKey1, apiKey1])
      expect(fixture.controller.status().state).toBe('ready')
      await fixture.controller.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts an in-flight old-account call and discards its late result during a session switch', async () => {
    const fixture = setup({ credential: stored(), ensure: ready() })
    await fixture.controller.retry()
    const late = Promise.withResolvers<string>()
    let dispatchedSignal: AbortSignal | undefined
    const running = fixture.controller.executeManagedTool(
      'mcp__arkme__profile_get',
      new AbortController().signal,
      async signal => {
        dispatchedSignal = signal
        return await late.promise
      },
    )
    await vi.waitFor(() => { expect(dispatchedSignal).toBeDefined() })

    const ticket = await fixture.controller.prepare(
      activeSession(),
      { userId: 99, accessToken: jwt(99, 8), refreshToken: 'refresh-new' },
    )
    late.resolve('old-account-private-result')

    const failure = await running.catch(error => error as unknown)
    expect(failure).toBeInstanceOf(ManagedOpenApiMcpExecutionSupersededError)
    expect(String(failure)).not.toContain('old-account-private-result')
    expect(dispatchedSignal?.aborted).toBe(true)
    fixture.controller.rolledBack(ticket)
    await vi.waitFor(() => { expect(fixture.controller.status().state).toBe('ready') })
    await fixture.controller.dispose()
  })

  it('stops background recreation after revocation and only explicit reauthorization issues again', async () => {
    const fixture = setup({ credential: stored(), ensure: {
      state: 'reauthorization_required', reconcileAfterSeconds: 21_600,
      mcpCatalogRevision: revision1, mcpRuntimeRevision: runtimeRevision1,
    } })
    await fixture.controller.retry()
    expect(fixture.controller.status()).toMatchObject({ state: 'reauthorization-required', userAction: 'reauthorize' })
    expect(fixture.credentials.value).toBeUndefined()
    expect(fixture.control.reauthorize).not.toHaveBeenCalled()

    await fixture.controller.reauthorize()
    expect(fixture.control.reauthorize).toHaveBeenCalledOnce()
    expect(fixture.credentials.value).toMatchObject({ keyId: keyId1, generation: 2 })
    expect(fixture.runtime.mountedKeys.at(-1)).toBe(apiKey2)
    expect(fixture.controller.status().state).toBe('ready')
    await fixture.controller.dispose()
  })

  it('remounts a rotated secret when the stable key identity advances generation', async () => {
    const fixture = setup({ credential: stored(), ensure: ready() })
    await fixture.controller.retry()
    vi.mocked(fixture.control.ensure).mockResolvedValue(issued(apiKey2, revision1, 2))
    await fixture.controller.retry()

    expect(fixture.runtime.mountedKeys).toEqual([apiKey1, apiKey2])
    expect(fixture.runtime.disposed).toBe(1)
    expect(fixture.credentials.value).toMatchObject({ keyId: keyId1, generation: 2, apiKey: apiKey2 })
    await fixture.controller.dispose()
  })

  it('disconnects a response-loss issuance when secure persistence fails and never mounts it', async () => {
    const fixture = setup()
    fixture.credentials.failWrite = true
    await fixture.controller.retry()

    expect(fixture.control.disconnect).toHaveBeenCalledWith(expect.any(SecretValue), expect.any(AbortSignal))
    expect(vi.mocked(fixture.control.disconnect).mock.calls[0]?.[0].reveal()).toBe(apiKey1)
    expect(fixture.runtime.mountedKeys).toEqual([])
    expect(fixture.controller.status()).toMatchObject({ state: 'degraded', retryable: true })
    await fixture.controller.dispose()
  })

  it('does not deadlock or orphan an issued key when session deletion races the control response', async () => {
    const order: string[] = []
    const innerSession = new MemorySessionStore(activeSession())
    const observedSession = new ObservedArkmeSessionStore(innerSession)
    const credentials = new MemoryCredentialStore(undefined)
    credentials.order = order
    const runtime = new FakeRuntime(order)
    const control: ManagedOpenApiControlPlane = {
      ensure: vi.fn(async () => {
        await observedSession.delete()
        return issued()
      }),
      reauthorize: vi.fn(async () => issued() as Extract<ManagedOpenApiControlResult, { state: 'issued' }>),
      disconnect: vi.fn(async () => undefined),
    }
    const controller = new ManagedOpenApiMcpController({
      enabled: true, sessionStore: observedSession,
      accessCredentialProvider: { resolveManagedAccessCredential: vi.fn(async () => new SecretValue('access-secret')) },
      controlPlane: control, credentialStore: credentials, runtime, reconcileLock: new ImmediateLock(),
      logger: { warn: vi.fn() }, now: () => now, random: () => 0.5,
    })
    observedSession.attach(controller)

    await expect(Promise.race([
      controller.retry(),
      new Promise((_, reject) => setTimeout(() => { reject(new Error('lifecycle deadlocked')) }, 500)),
    ])).resolves.toMatchObject({ state: 'inactive' })
    expect(control.disconnect).toHaveBeenCalledWith(expect.any(SecretValue), expect.any(AbortSignal))
    expect(vi.mocked(control.disconnect).mock.calls[0]?.[0].reveal()).toBe(apiKey1)
    expect(credentials.value).toBeUndefined()
    expect(runtime.mountedKeys).toEqual([])
    await controller.dispose()
  })

  it('does not deadlock when Access refresh invalidates the observed session', async () => {
    const order: string[] = []
    const innerSession = new MemorySessionStore(activeSession())
    const observedSession = new ObservedArkmeSessionStore(innerSession)
    const credentials = new MemoryCredentialStore(undefined)
    credentials.order = order
    const runtime = new FakeRuntime(order)
    const control: ManagedOpenApiControlPlane = {
      ensure: vi.fn(async () => issued()),
      reauthorize: vi.fn(async () => issued() as Extract<ManagedOpenApiControlResult, { state: 'issued' }>),
      disconnect: vi.fn(async () => undefined),
    }
    const controller = new ManagedOpenApiMcpController({
      enabled: true, sessionStore: observedSession,
      accessCredentialProvider: {
        resolveManagedAccessCredential: vi.fn(async () => {
          await observedSession.delete()
          throw new Error('login expired')
        }),
      },
      controlPlane: control, credentialStore: credentials, runtime, reconcileLock: new ImmediateLock(),
      logger: { warn: vi.fn() }, now: () => now, random: () => 0.5,
    })
    observedSession.attach(controller)

    await expect(Promise.race([
      controller.retry(),
      new Promise((_, reject) => setTimeout(() => { reject(new Error('lifecycle deadlocked')) }, 500)),
    ])).resolves.toMatchObject({ state: 'inactive' })
    expect(control.ensure).not.toHaveBeenCalled()
    expect(credentials.value).toBeUndefined()
    await controller.dispose()
  })

  it('recovers a secure credential for logout cleanup before the first reconciliation reads it', async () => {
    const innerSession = new MemorySessionStore(activeSession())
    const observedSession = new ObservedArkmeSessionStore(innerSession)
    const credentials = new MemoryCredentialStore(stored())
    const control: ManagedOpenApiControlPlane = {
      ensure: vi.fn(async () => issued()),
      reauthorize: vi.fn(async () => issued() as Extract<ManagedOpenApiControlResult, { state: 'issued' }>),
      disconnect: vi.fn(async () => undefined),
    }
    const controller = new ManagedOpenApiMcpController({
      enabled: true, sessionStore: observedSession,
      accessCredentialProvider: { resolveManagedAccessCredential: vi.fn(async () => new SecretValue('access-secret')) },
      controlPlane: control, credentialStore: credentials, runtime: new FakeRuntime([]), reconcileLock: new ImmediateLock(),
      logger: { warn: vi.fn() }, now: () => now, random: () => 0.5,
    })
    observedSession.attach(controller)

    await observedSession.delete()
    await vi.waitFor(() => {
      expect(control.disconnect).toHaveBeenCalledWith(expect.any(SecretValue), expect.any(AbortSignal))
    })
    const disconnectToken = vi.mocked(control.disconnect).mock.calls[0]?.[0]
    expect(disconnectToken?.reveal()).toBe(apiKey1)
    expect(credentials.value).toBeUndefined()
    await controller.dispose()
  })

  it('retries API-Key self-disconnect in memory with one bounded schedule', async () => {
    vi.useFakeTimers()
    try {
      const innerSession = new MemorySessionStore(activeSession())
      const observedSession = new ObservedArkmeSessionStore(innerSession)
      const credentials = new MemoryCredentialStore(stored())
      const disconnect = vi.fn()
        .mockRejectedValueOnce(new Error('network unavailable'))
        .mockRejectedValueOnce(new Error('network unavailable'))
        .mockResolvedValueOnce(undefined)
      const control: ManagedOpenApiControlPlane = {
        ensure: vi.fn(async () => issued()),
        reauthorize: vi.fn(async () => issued() as Extract<ManagedOpenApiControlResult, { state: 'issued' }>),
        disconnect,
      }
      const controller = new ManagedOpenApiMcpController({
        enabled: true, sessionStore: observedSession,
        accessCredentialProvider: { resolveManagedAccessCredential: vi.fn(async () => new SecretValue('access-secret')) },
        controlPlane: control, credentialStore: credentials, runtime: new FakeRuntime([]), reconcileLock: new ImmediateLock(),
        logger: { warn: vi.fn() }, now: () => now, random: () => 0.5,
      })
      observedSession.attach(controller)

      await observedSession.delete()
      await vi.advanceTimersByTimeAsync(6_000)
      await Promise.resolve()

      expect(disconnect).toHaveBeenCalledTimes(3)
      expect(disconnect.mock.calls.map(call => (call[0] as SecretValue).reveal())).toEqual([apiKey1, apiKey1, apiKey1])
      await controller.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('remounts the original account after a failed session switch even when teardown is still pending', async () => {
    const innerSession = new MemorySessionStore(activeSession())
    const observedSession = new ObservedArkmeSessionStore(innerSession)
    const credentials = new MemoryCredentialStore(stored())
    let releaseFirstDispose: (() => void) | undefined
    const firstDisposeGate = new Promise<void>(resolve => { releaseFirstDispose = resolve })
    let mountCount = 0
    const runtime: OpenApiMcpRuntime = {
      mount: vi.fn(() => {
        mountCount++
        const current = mountCount
        return {
          ready: async () => undefined,
          dispose: async () => {
            if (current === 1) await firstDisposeGate
          },
        }
      }),
    }
    const control: ManagedOpenApiControlPlane = {
      ensure: vi.fn(async () => ready()),
      reauthorize: vi.fn(async () => issued() as Extract<ManagedOpenApiControlResult, { state: 'issued' }>),
      disconnect: vi.fn(async () => undefined),
    }
    const controller = new ManagedOpenApiMcpController({
      enabled: true, sessionStore: observedSession,
      accessCredentialProvider: { resolveManagedAccessCredential: vi.fn(async () => new SecretValue('access-secret')) },
      controlPlane: control, credentialStore: credentials, runtime, reconcileLock: new ImmediateLock(),
      logger: { warn: vi.fn() }, now: () => now, random: () => 0.5,
    })
    observedSession.attach(controller)
    await controller.retry()
    expect(mountCount).toBe(1)

    innerSession.failWrite = true
    await expect(observedSession.write({ userId: 99, accessToken: jwt(99, 8), refreshToken: 'refresh-new' }))
      .rejects.toThrow('session write failed')
    expect(controller.status().state).not.toBe('ready')
    expect(controller.guardToolExecution('mcp__arkme__profile_get')).toContain('not ready')

    releaseFirstDispose?.()
    await vi.waitFor(() => {
      expect(mountCount).toBe(2)
      expect(controller.status().state).toBe('ready')
    })
    expect(controller.guardToolExecution('mcp__arkme__profile_get')).toBeUndefined()
    await controller.dispose()
  })

  it('does not block account visibility on MCP teardown and denies stale tool execution immediately', async () => {
    const order: string[] = []
    const innerSession = new MemorySessionStore(activeSession(), order)
    const observedSession = new ObservedArkmeSessionStore(innerSession)
    const credentials = new MemoryCredentialStore(undefined)
    const runtime: OpenApiMcpRuntime = {
      mount: vi.fn((_apiKey, signal) => ({
        ready: async () => await new Promise<void>((_resolve, reject) => {
          order.push('mount-start')
          const aborted = () => {
            setTimeout(() => {
              order.push('mount-abort-cleanup')
              reject(signal.reason)
            }, 10)
          }
          signal.addEventListener('abort', aborted, { once: true })
        }),
        dispose: async () => undefined,
      })),
    }
    const control: ManagedOpenApiControlPlane = {
      ensure: vi.fn(async () => issued()),
      reauthorize: vi.fn(async () => issued() as Extract<ManagedOpenApiControlResult, { state: 'issued' }>),
      disconnect: vi.fn(async () => undefined),
    }
    const controller = new ManagedOpenApiMcpController({
      enabled: true, sessionStore: observedSession,
      accessCredentialProvider: { resolveManagedAccessCredential: vi.fn(async () => new SecretValue('access-secret')) },
      controlPlane: control, credentialStore: credentials, runtime, reconcileLock: new ImmediateLock(),
      logger: { warn: vi.fn() }, now: () => now, random: () => 0.5,
    })
    observedSession.attach(controller)

    const initialReconcile = controller.retry()
    await vi.waitFor(() => { expect(order).toContain('mount-start') })
    await observedSession.write({ userId: 99, accessToken: jwt(99, 8), refreshToken: 'refresh-new' })

    expect(order).toContain('session-write')
    expect(controller.guardToolExecution('mcp__arkme__profile_get')).toContain('not ready')
    await vi.waitFor(() => { expect(order).toContain('mount-abort-cleanup') })
    expect(order.indexOf('session-write')).toBeLessThan(order.indexOf('mount-abort-cleanup'))
    await initialReconcile
    await controller.dispose()
  })

  it('isolate failures to managed tools while preserving a safe public status', async () => {
    const fixture = setup()
    vi.mocked(fixture.control.ensure).mockRejectedValueOnce(new Error('network contains access-secret'))
    await fixture.controller.retry()

    expect(fixture.controller.status()).toMatchObject({ state: 'degraded', retryable: true, userAction: 'none' })
    expect(fixture.logger.warn).toHaveBeenCalledWith(expect.stringContaining('(%s)'), 'runtime')
    expect(JSON.stringify(fixture.logger.warn.mock.calls)).not.toContain('access-secret')
    await fixture.controller.dispose()
  })
})
