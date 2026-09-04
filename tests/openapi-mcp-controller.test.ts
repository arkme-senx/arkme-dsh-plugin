import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { ArkmeSessionCredentials, ArkmeSessionStore } from '../src/keychain-store.js'
import {
  ManagedOpenApiMcpController,
} from '../src/openapi-mcp/controller.js'
import { InvalidManagedOpenApiCredentialError } from '../src/openapi-mcp/credential-store.js'
import { ObservedArkmeSessionStore } from '../src/openapi-mcp/session-observer.js'
import type {
  ManagedOpenApiControlPlane, ManagedOpenApiControlResult, ManagedOpenApiCredential,
  ManagedOpenApiCredentialStore, OpenApiMcpManifest, OpenApiMcpManifestSource,
  OpenApiMcpMount, OpenApiMcpReconcileLock, OpenApiMcpRuntime,
} from '../src/openapi-mcp/types.js'
import {
  ManagedOpenApiCredentialRejectedError,
  ManagedOpenApiCredentialSupersededError,
  ManagedOpenApiMcpExecutionSupersededError,
} from '../src/openapi-mcp/types.js'
import { SecretValue } from '../src/secret-value.js'

const keyId1 = '0123456789abcdef01234567'
const apiKey1 = `arkme_${keyId1}_${'A'.repeat(43)}`
const apiKey2 = `arkme_${keyId1}_${'B'.repeat(43)}`
const apiKey1Digest = createHash('sha256').update(apiKey1, 'utf8').digest('hex')
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
  mountedManifests: OpenApiMcpManifest[] = []
  unavailable: Array<() => void> = []
  disposed = 0
  failReady = false
  failDispose = false
  constructor(private readonly order: string[]) {}
  mount(apiKey: SecretValue, manifest: OpenApiMcpManifest, _signal: AbortSignal, onUnavailable: () => void): OpenApiMcpMount {
    this.order.push('mount')
    this.mountedKeys.push(apiKey.reveal())
    this.mountedManifests.push({ ...manifest })
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

function issued(apiKey = apiKey1, generation = 1): ManagedOpenApiControlResult {
  return {
    state: 'issued', keyId: keyId1, generation, apiKey, expiresAtMillis: now + 30 * 24 * 60 * 60_000,
    reconcileAfterSeconds: 21_600,
  }
}

function ready(generation = 1): ManagedOpenApiControlResult {
  return {
    state: 'ready', keyId: keyId1, generation, expiresAtMillis: now + 30 * 24 * 60 * 60_000,
    reconcileAfterSeconds: 21_600,
  }
}

function manifest(catalogRevision = revision1, runtimeRevision = runtimeRevision1): OpenApiMcpManifest {
  return { catalogRevision, runtimeRevision, endpointPath: '/mcp/managed', pollAfterSeconds: 300 }
}

function stored(generation = 1): ManagedOpenApiCredential {
  return { schemaVersion: 1, userId: 42, loginDeviceId: 7, keyId: keyId1, generation, apiKey: apiKey1, expiresAtMillis: now + 24 * 60 * 60_000 }
}

function storedFor(userId: number, loginDeviceId: number): ManagedOpenApiCredential {
  return { ...stored(), userId, loginDeviceId }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline })
  return { promise, resolve, reject }
}

function setup(input: {
  credential?: ManagedOpenApiCredential
  ensure?: ManagedOpenApiControlResult
  manifest?: OpenApiMcpManifest
  mountMcp?: boolean
  now?: () => number
} = {}) {
  const order: string[] = []
  const session = new MemorySessionStore(activeSession())
  const credentials = new MemoryCredentialStore(input.credential)
  credentials.order = order
  const runtime = new FakeRuntime(order)
  const control: ManagedOpenApiControlPlane = {
    ensure: vi.fn(async () => input.ensure ?? issued()),
    disconnect: vi.fn(async () => undefined),
  }
  const manifestSource: OpenApiMcpManifestSource = { read: vi.fn(async () => input.manifest ?? manifest()) }
  const logger = { warn: vi.fn() }
  const controller = new ManagedOpenApiMcpController({
    mountMcp: input.mountMcp ?? true, sessionStore: session,
    accessCredentialProvider: { resolveManagedAccessCredential: vi.fn(async () => new SecretValue('access-secret')) },
    controlPlane: control, manifestSource, credentialStore: credentials, runtime, reconcileLock: new ImmediateLock(), logger,
    now: input.now ?? (() => now), random: () => 0.5,
  })
  return { controller, session, credentials, runtime, control, manifestSource, order, logger }
}

describe('managed OpenAPI MCP controller', () => {
  it('never guards a foreign Arkme MCP namespace before owning a managed mount', async () => {
    const fixture = setup()

    expect(fixture.controller.guardToolExecution('mcp__arkme__foreign_tool')).toBeUndefined()
    await fixture.controller.dispose()

    const disabled = new ManagedOpenApiMcpController({
      mountMcp: false,
      sessionStore: fixture.session,
      accessCredentialProvider: { resolveManagedAccessCredential: vi.fn(async () => new SecretValue('access-secret')) },
      controlPlane: fixture.control,
      manifestSource: fixture.manifestSource,
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

  it('keeps credential-backed REST available when managed MCP mounting is disabled', async () => {
    const fixture = setup({ mountMcp: false })

    fixture.controller.start()
    expect(fixture.control.ensure).not.toHaveBeenCalled()
    const credential = await fixture.controller.executeWithCredential(
      new AbortController().signal,
      async apiKey => apiKey.reveal(),
    )

    expect(credential).toBe(apiKey1)
    expect(fixture.control.ensure).toHaveBeenCalledOnce()
    expect(fixture.manifestSource.read).not.toHaveBeenCalled()
    expect(fixture.runtime.mountedKeys).toEqual([])
    expect(fixture.controller.status()).toMatchObject({
      state: 'inactive', retryable: false, userAction: 'none',
    })
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

  it('self-disconnects a valid cached credential when startup finds no active session', async () => {
    const fixture = setup({ credential: stored(), ensure: ready() })
    fixture.session.value = undefined

    await fixture.controller.retry()

    expect(fixture.control.ensure).not.toHaveBeenCalled()
    expect(fixture.control.disconnect).toHaveBeenCalledWith(expect.any(SecretValue), expect.any(AbortSignal))
    expect(vi.mocked(fixture.control.disconnect).mock.calls[0]?.[0].reveal()).toBe(apiKey1)
    expect(fixture.credentials.value).toBeUndefined()
    expect(fixture.runtime.mountedKeys).toEqual([])
    expect(fixture.controller.status()).toMatchObject({ state: 'inactive', userAction: 'login' })
    await fixture.controller.dispose()
  })

  it('self-disconnects a cached credential owned by another principal before issuing for the current session', async () => {
    const fixture = setup({ credential: stored(), ensure: issued(apiKey2, 2) })
    fixture.session.value = { userId: 99, accessToken: jwt(99, 8), refreshToken: 'refresh-new' }

    await fixture.controller.retry()

    expect(fixture.control.disconnect).toHaveBeenCalledWith(expect.any(SecretValue), expect.any(AbortSignal))
    expect(vi.mocked(fixture.control.disconnect).mock.calls[0]?.[0].reveal()).toBe(apiKey1)
    expect(fixture.control.ensure).toHaveBeenCalledWith(expect.any(SecretValue), undefined, expect.any(AbortSignal))
    expect(fixture.credentials.value).toMatchObject({ userId: 99, loginDeviceId: 8, apiKey: apiKey2 })
    expect(fixture.runtime.mountedKeys).toEqual([apiKey2])
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
    const fixture = setup({ credential: stored(), ensure: ready(), manifest: manifest(revision1) })
    await fixture.controller.retry()
    vi.mocked(fixture.manifestSource.read).mockResolvedValue(manifest(revision2))
    await fixture.controller.retry()

    expect(fixture.control.ensure).toHaveBeenCalledWith(
      expect.any(SecretValue), { keyId: keyId1, generation: 1, keyDigest: apiKey1Digest }, expect.any(AbortSignal),
    )
    expect(fixture.runtime.mountedKeys).toEqual([apiKey1, apiKey1])
    expect(fixture.runtime.mountedManifests.map(value => value.catalogRevision)).toEqual([revision1, revision2])
    expect(fixture.runtime.disposed).toBe(1)
    expect(fixture.credentials.value).not.toHaveProperty('mcpRevision')
    await fixture.controller.dispose()
  })

  it('remounts for an MCP runtime contract revision without rotating or rewriting the API key', async () => {
    const fixture = setup({ credential: stored(), ensure: ready(), manifest: manifest(revision1, runtimeRevision1) })
    await fixture.controller.retry()
    const writesBeforeUpdate = fixture.order.filter(value => value === 'write').length
    vi.mocked(fixture.manifestSource.read).mockResolvedValue(manifest(revision1, runtimeRevision2))

    await fixture.controller.retry()

    expect(fixture.runtime.mountedKeys).toEqual([apiKey1, apiKey1])
    expect(fixture.runtime.mountedManifests.map(value => value.runtimeRevision)).toEqual([runtimeRevision1, runtimeRevision2])
    expect(fixture.runtime.disposed).toBe(1)
    expect(fixture.order.filter(value => value === 'write')).toHaveLength(writesBeforeUpdate)
    await fixture.controller.dispose()
  })

  it('polls the MCP manifest independently without refreshing the Access credential or API Key lease', async () => {
    vi.useFakeTimers()
    try {
      const fixture = setup({ credential: stored(), ensure: ready(), manifest: manifest(revision1) })
      await fixture.controller.retry()
      vi.mocked(fixture.manifestSource.read).mockResolvedValue(manifest(revision2))

      await vi.advanceTimersByTimeAsync(300_000)
      await Promise.resolve()
      await Promise.resolve()

      expect(fixture.control.ensure).toHaveBeenCalledOnce()
      expect(fixture.manifestSource.read).toHaveBeenCalledTimes(2)
      expect(fixture.runtime.mountedManifests.map(value => value.catalogRevision)).toEqual([revision1, revision2])
      expect(fixture.controller.status().state).toBe('ready')
      await fixture.controller.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps retrying manifest rollout failures on the short update cadence until a matching instance is available', async () => {
    vi.useFakeTimers()
    try {
      const fixture = setup({ credential: stored(), ensure: ready(), manifest: manifest(revision1) })
      await fixture.controller.retry()
      vi.mocked(fixture.manifestSource.read)
        .mockRejectedValueOnce(new Error('old rollout instance'))
        .mockRejectedValueOnce(new Error('old rollout instance'))
        .mockRejectedValueOnce(new Error('old rollout instance'))
        .mockRejectedValueOnce(new Error('old rollout instance'))
        .mockResolvedValue(manifest(revision2))

      await vi.advanceTimersByTimeAsync(300_000)
      await vi.advanceTimersByTimeAsync(60_000)
      await vi.advanceTimersByTimeAsync(300_000)
      await vi.advanceTimersByTimeAsync(300_000)
      await vi.advanceTimersByTimeAsync(300_000)

      expect(fixture.control.ensure).toHaveBeenCalledOnce()
      expect(fixture.manifestSource.read).toHaveBeenCalledTimes(6)
      expect(fixture.runtime.mountedManifests.map(value => value.catalogRevision)).toEqual([revision1, revision2])
      expect(fixture.controller.status().state).toBe('ready')
      await fixture.controller.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('silently reconciles and remounts a rotated credential on the server-provided lease cadence', async () => {
    vi.useFakeTimers()
    try {
      const fixture = setup({ credential: stored(), ensure: ready() })
      await fixture.controller.retry()
      vi.mocked(fixture.control.ensure).mockResolvedValue(issued(apiKey2, 2))

      await vi.advanceTimersByTimeAsync(21_600_000)

      expect(fixture.control.ensure).toHaveBeenCalledTimes(2)
      expect(fixture.credentials.value).toMatchObject({ generation: 2, apiKey: apiKey2 })
      expect(fixture.runtime.mountedKeys).toEqual([apiKey1, apiKey2])
      expect(fixture.controller.status().state).toBe('ready')
      await fixture.controller.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a healthy mount usable when a manifest poll is temporarily unavailable', async () => {
    const fixture = setup({ credential: stored(), ensure: ready() })
    await fixture.controller.retry()
    vi.mocked(fixture.manifestSource.read).mockRejectedValueOnce(new Error('manifest unavailable'))

    await fixture.controller.retry()

    expect(fixture.runtime.mountedKeys).toEqual([apiKey1])
    expect(fixture.runtime.disposed).toBe(0)
    expect(fixture.controller.status()).toMatchObject({ state: 'ready', retryable: false })
    expect(fixture.controller.guardToolExecution('mcp__arkme__profile_get')).toBeUndefined()
    await fixture.controller.dispose()
  })

  it('keeps a healthy mount usable through a control-plane failure and recovers automatically', async () => {
    vi.useFakeTimers()
    try {
      const fixture = setup({ credential: stored(), ensure: ready() })
      await fixture.controller.retry()
      vi.mocked(fixture.control.ensure).mockRejectedValueOnce(new Error('control unavailable'))

      await fixture.controller.retry()

      expect(fixture.control.ensure).toHaveBeenCalledTimes(2)
      expect(fixture.controller.status()).toMatchObject({
        state: 'ready', retryable: false, userAction: 'none', nextReconcileAtMillis: now + 60_000,
      })
      expect(fixture.controller.guardToolExecution('mcp__arkme__profile_get')).toBeUndefined()
      expect(fixture.runtime.disposed).toBe(0)

      await vi.advanceTimersByTimeAsync(60_000)
      await Promise.resolve()
      await Promise.resolve()

      expect(fixture.control.ensure).toHaveBeenCalledTimes(3)
      expect(fixture.runtime.mountedKeys).toEqual([apiKey1])
      expect(fixture.controller.status().state).toBe('ready')
      await fixture.controller.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('denies a stale mounted generation after another controller advances secure storage', async () => {
    const fixture = setup({ credential: stored(), ensure: ready() })
    await fixture.controller.retry()
    fixture.credentials.value = { ...stored(2), apiKey: apiKey2 }
    vi.mocked(fixture.control.ensure).mockRejectedValueOnce(new Error('control unavailable'))

    await fixture.controller.retry()

    expect(fixture.controller.status()).toMatchObject({ state: 'degraded', retryable: true })
    expect(fixture.controller.guardToolExecution('mcp__arkme__profile_get')).toContain('not ready')
    const execute = vi.fn(async () => ({ isError: false, content: [] }) as ToolExecutionResult)
    await expect(fixture.controller.executeManagedTool(
      'mcp__arkme__profile_get', new AbortController().signal, execute,
    )).rejects.toBeInstanceOf(ManagedOpenApiMcpExecutionSupersededError)
    expect(execute).not.toHaveBeenCalled()
    expect(fixture.runtime.disposed).toBe(0)

    vi.mocked(fixture.control.ensure).mockResolvedValue(ready(2))
    await fixture.controller.retry()

    expect(fixture.runtime.mountedKeys).toEqual([apiKey1, apiKey2])
    expect(fixture.runtime.disposed).toBe(1)
    expect(fixture.controller.status().state).toBe('ready')
    await fixture.controller.dispose()
  })

  it('never lets control-plane backoff outlive the current credential and rotates at expiry', async () => {
    vi.useFakeTimers()
    try {
      let currentNow = now
      const fixture = setup({ credential: stored(), ensure: ready(), now: () => currentNow })
      await fixture.controller.retry()
      const expiresAtMillis = fixture.credentials.value?.expiresAtMillis
      if (expiresAtMillis === undefined) throw new Error('missing managed credential expiry')
      currentNow = expiresAtMillis - 30_000
      vi.mocked(fixture.control.ensure)
        .mockRejectedValueOnce(new Error('control unavailable'))
        .mockResolvedValueOnce({
          ...issued(apiKey2, 2),
          expiresAtMillis: expiresAtMillis + 30 * 24 * 60 * 60_000,
        })

      await fixture.controller.retry()

      expect(fixture.controller.status()).toMatchObject({
        state: 'ready', retryable: false, userAction: 'none', nextReconcileAtMillis: expiresAtMillis,
      })
      const execute = vi.fn(async () => ({ isError: false, content: [] }) as ToolExecutionResult)
      currentNow = expiresAtMillis
      await expect(fixture.controller.executeManagedTool(
        'mcp__arkme__profile_get', new AbortController().signal, execute,
      )).rejects.toBeInstanceOf(ManagedOpenApiMcpExecutionSupersededError)
      expect(execute).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(30_000)
      await Promise.resolve()
      await Promise.resolve()

      expect(fixture.control.ensure).toHaveBeenCalledTimes(3)
      expect(fixture.credentials.value).toMatchObject({ generation: 2, apiKey: apiKey2 })
      expect(fixture.runtime.mountedKeys).toEqual([apiKey1, apiKey2])
      expect(fixture.controller.status().state).toBe('ready')
      await fixture.controller.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a healthy mount usable through a transient active-session read failure', async () => {
    vi.useFakeTimers()
    try {
      const fixture = setup({ credential: stored(), ensure: ready() })
      await fixture.controller.retry()
      vi.spyOn(fixture.session, 'read')
        .mockRejectedValueOnce(new Error('keychain temporarily unavailable'))
        .mockRejectedValueOnce(new Error('keychain temporarily unavailable'))

      await fixture.controller.retry()

      expect(fixture.controller.status()).toMatchObject({
        state: 'ready', retryable: false, userAction: 'none', nextReconcileAtMillis: now + 60_000,
      })
      expect(fixture.controller.guardToolExecution('mcp__arkme__profile_get')).toBeUndefined()
      expect(fixture.runtime.disposed).toBe(0)

      await vi.advanceTimersByTimeAsync(60_000)
      await Promise.resolve()
      await Promise.resolve()

      expect(fixture.control.ensure).toHaveBeenCalledTimes(2)
      expect(fixture.runtime.mountedKeys).toEqual([apiKey1])
      expect(fixture.controller.status().state).toBe('ready')
      await fixture.controller.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('quarantines an expired credential and recovers automatically with a newly issued generation', async () => {
    vi.useFakeTimers()
    try {
      let currentNow = now
      const fixture = setup({ credential: stored(), ensure: ready(), now: () => currentNow })
      await fixture.controller.retry()
      currentNow = now + 30 * 24 * 60 * 60_000 + 1
      vi.mocked(fixture.control.ensure)
        .mockRejectedValueOnce(new Error('control unavailable'))
        .mockResolvedValueOnce({
          ...issued(apiKey2, 2),
          expiresAtMillis: currentNow + 30 * 24 * 60 * 60_000,
        })

      await fixture.controller.retry()

      expect(fixture.controller.status()).toMatchObject({
        state: 'degraded', retryable: true, userAction: 'none',
        nextReconcileAtMillis: currentNow + 60_000,
      })

      await vi.advanceTimersByTimeAsync(60_000)
      await Promise.resolve()
      await Promise.resolve()

      expect(fixture.control.ensure).toHaveBeenCalledTimes(3)
      expect(fixture.credentials.value).toMatchObject({ generation: 2, apiKey: apiKey2 })
      expect(fixture.runtime.mountedKeys).toEqual([apiKey1, apiKey2])
      expect(fixture.runtime.disposed).toBe(1)
      expect(fixture.controller.status().state).toBe('ready')
      await fixture.controller.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails closed on an unattested rollout candidate and recovers automatically on a matching instance', async () => {
    vi.useFakeTimers()
    try {
      const fixture = setup({ credential: stored(), ensure: ready(), manifest: manifest(revision1) })
      await fixture.controller.retry()
      vi.mocked(fixture.manifestSource.read).mockResolvedValue(manifest(revision2))
      fixture.runtime.failReady = true

      await fixture.controller.retry()

      expect(fixture.controller.status()).toMatchObject({ state: 'degraded', retryable: true })
      expect(fixture.controller.guardToolExecution('mcp__arkme__profile_get')).toBeUndefined()
      expect(fixture.runtime.mountedManifests.at(-1)?.catalogRevision).toBe(revision2)

      fixture.runtime.failReady = false
      await vi.advanceTimersByTimeAsync(60_000)
      await Promise.resolve()
      await Promise.resolve()

      expect(fixture.controller.status().state).toBe('ready')
      expect(fixture.runtime.mountedManifests.at(-1)?.catalogRevision).toBe(revision2)
      await fixture.controller.dispose()
    } finally {
      vi.useRealTimers()
    }
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
    const fixture = setup({ credential: stored(), ensure: ready(), manifest: manifest(revision1) })
    await fixture.controller.retry()
    fixture.runtime.failDispose = true
    vi.mocked(fixture.manifestSource.read).mockResolvedValue(manifest(revision2))

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
    const late = Promise.withResolvers<{ isError: false; value: string; content: [] }>()
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
    late.resolve({ isError: false, value: 'old-account-private-result', content: [] })

    const failure = await running.catch(error => error as unknown)
    expect(failure).toBeInstanceOf(ManagedOpenApiMcpExecutionSupersededError)
    expect(String(failure)).not.toContain('old-account-private-result')
    expect(dispatchedSignal?.aborted).toBe(true)
    fixture.controller.rolledBack(ticket)
    await vi.waitFor(() => { expect(fixture.controller.status().state).toBe('ready') })
    await fixture.controller.dispose()
  })

  it('reapplies the account fence synchronously when a retry remounted the old principal before commit', async () => {
    const fixture = setup({ credential: stored(), ensure: ready() })
    await fixture.controller.retry()
    const next = { userId: 99, accessToken: jwt(99, 8), refreshToken: 'refresh-new' }

    const ticket = await fixture.controller.prepare(activeSession(), next)
    await fixture.controller.retry()
    expect(fixture.controller.guardToolExecution('mcp__arkme__profile_get')).toBeUndefined()

    fixture.session.value = next
    vi.mocked(fixture.control.ensure).mockResolvedValueOnce(issued(apiKey2, 2))
    fixture.controller.committed(ticket)

    expect(fixture.controller.guardToolExecution('mcp__arkme__profile_get')).toContain('not ready')
    await vi.waitFor(() => {
      expect(fixture.credentials.value).toMatchObject({ userId: 99, loginDeviceId: 8, apiKey: apiKey2 })
      expect(fixture.controller.status().state).toBe('ready')
    })
    await fixture.controller.dispose()
  })

  it('does not carry an old account retry backoff into the committed next principal', async () => {
    vi.useFakeTimers()
    try {
      const fixture = setup()
      vi.mocked(fixture.control.ensure).mockRejectedValue(new Error('control unavailable'))
      await fixture.controller.retry()
      await vi.advanceTimersByTimeAsync(60_000)
      await vi.advanceTimersByTimeAsync(5 * 60_000)
      await vi.advanceTimersByTimeAsync(30 * 60_000)

      const next = { userId: 99, accessToken: jwt(99, 8), refreshToken: 'refresh-new' }
      const ticket = await fixture.controller.prepare(activeSession(), next)
      fixture.session.value = next
      fixture.controller.committed(ticket)

      await vi.advanceTimersByTimeAsync(0)
      await Promise.resolve()
      expect(fixture.controller.status().state).toBe('degraded')
      expect(fixture.controller.status().nextReconcileAtMillis).toBe(now + 60_000)
      await fixture.controller.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries a transient active-session read failure instead of treating it as logout', async () => {
    vi.useFakeTimers()
    try {
      const fixture = setup({ credential: stored(), ensure: ready() })
      vi.spyOn(fixture.session, 'read')
        .mockRejectedValueOnce(new Error('keychain temporarily unavailable'))
        .mockRejectedValueOnce(new Error('keychain temporarily unavailable'))

      await fixture.controller.retry()

      expect(fixture.controller.status()).toMatchObject({
        state: 'degraded', retryable: true, userAction: 'none', nextReconcileAtMillis: now + 60_000,
      })
      expect(fixture.control.ensure).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(60_000)
      await vi.waitFor(() => { expect(fixture.controller.status().state).toBe('ready') })

      expect(fixture.control.ensure).toHaveBeenCalledOnce()
      expect(fixture.runtime.mountedKeys).toEqual([apiKey1])
      await fixture.controller.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns managed tool failures unchanged and deduplicates one background credential recovery', async () => {
    const fixture = setup({ credential: stored(), ensure: ready() })
    await fixture.controller.retry()
    vi.mocked(fixture.control.ensure).mockResolvedValue(issued(apiKey2, 2))
    const toolFailure = {
      isError: true,
      content: [{ type: 'text' as const, text: 'domain request failed' }],
      error: { message: 'domain request failed' },
    }

    const results = await Promise.all([1, 2].map(async () => await fixture.controller.executeManagedTool(
      'mcp__arkme__profile_get', new AbortController().signal, async () => toolFailure,
    )))

    expect(results).toEqual([toolFailure, toolFailure])
    await vi.waitFor(() => { expect(fixture.control.ensure).toHaveBeenCalledTimes(2) })
    await vi.waitFor(() => { expect(fixture.credentials.value).toMatchObject({ generation: 2, apiKey: apiKey2 }) })
    expect(fixture.runtime.mountedKeys).toEqual([apiKey1, apiKey2])
    expect(fixture.controller.status().state).toBe('ready')
    await fixture.controller.dispose()
  })

  it('does not quarantine or remount tools when background diagnosis confirms the current credential', async () => {
    const fixture = setup({ credential: stored(), ensure: ready() })
    await fixture.controller.retry()
    const toolFailure = {
      isError: true,
      content: [{ type: 'text' as const, text: 'tool arguments are invalid' }],
      error: { message: 'tool arguments are invalid' },
    }

    await expect(fixture.controller.executeManagedTool(
      'mcp__arkme__profile_get', new AbortController().signal, async () => toolFailure,
    )).resolves.toEqual(toolFailure)

    await vi.waitFor(() => { expect(fixture.control.ensure).toHaveBeenCalledTimes(2) })
    expect(fixture.runtime.mountedKeys).toEqual([apiKey1])
    expect(fixture.runtime.disposed).toBe(0)
    expect(fixture.controller.status().state).toBe('ready')
    expect(fixture.controller.guardToolExecution('mcp__arkme__profile_get')).toBeUndefined()
    await fixture.controller.dispose()
  })

  it('remounts a rotated secret when the stable key identity advances generation', async () => {
    const fixture = setup({ credential: stored(), ensure: ready() })
    await fixture.controller.retry()
    vi.mocked(fixture.control.ensure).mockResolvedValue(issued(apiKey2, 2))
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
      disconnect: vi.fn(async () => undefined),
    }
    const controller = new ManagedOpenApiMcpController({
      mountMcp: true, sessionStore: observedSession,
      accessCredentialProvider: { resolveManagedAccessCredential: vi.fn(async () => new SecretValue('access-secret')) },
      controlPlane: control, manifestSource: { read: vi.fn(async () => manifest()) },
      credentialStore: credentials, runtime, reconcileLock: new ImmediateLock(),
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
      disconnect: vi.fn(async () => undefined),
    }
    const controller = new ManagedOpenApiMcpController({
      mountMcp: true, sessionStore: observedSession,
      accessCredentialProvider: {
        resolveManagedAccessCredential: vi.fn(async () => {
          await observedSession.delete()
          throw new Error('login expired')
        }),
      },
      controlPlane: control, manifestSource: { read: vi.fn(async () => manifest()) },
      credentialStore: credentials, runtime, reconcileLock: new ImmediateLock(),
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
      disconnect: vi.fn(async () => undefined),
    }
    const controller = new ManagedOpenApiMcpController({
      mountMcp: true, sessionStore: observedSession,
      accessCredentialProvider: { resolveManagedAccessCredential: vi.fn(async () => new SecretValue('access-secret')) },
      controlPlane: control, manifestSource: { read: vi.fn(async () => manifest()) },
      credentialStore: credentials, runtime: new FakeRuntime([]), reconcileLock: new ImmediateLock(),
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

  it('preserves a credential already owned by the committed next principal during delayed cleanup', async () => {
    const innerSession = new MemorySessionStore(activeSession())
    const credentials = new MemoryCredentialStore(storedFor(99, 8))
    const runtime = new FakeRuntime([])
    const control: ManagedOpenApiControlPlane = {
      ensure: vi.fn(async () => ready()),
      disconnect: vi.fn(async () => undefined),
    }
    const controller = new ManagedOpenApiMcpController({
      mountMcp: true, sessionStore: innerSession,
      accessCredentialProvider: { resolveManagedAccessCredential: vi.fn(async () => new SecretValue('access-secret')) },
      controlPlane: control, manifestSource: { read: vi.fn(async () => manifest()) },
      credentialStore: credentials, runtime, reconcileLock: new ImmediateLock(),
      logger: { warn: vi.fn() }, now: () => now, random: () => 0.5,
    })
    const next = { userId: 99, accessToken: jwt(99, 8), refreshToken: 'refresh-new' }

    const ticket = await controller.prepare(activeSession(), next)
    innerSession.value = next
    controller.committed(ticket)
    await vi.waitFor(() => { expect(controller.status().state).toBe('ready') })

    expect(control.disconnect).not.toHaveBeenCalled()
    expect(credentials.value).toMatchObject({ userId: 99, loginDeviceId: 8, apiKey: apiKey1 })
    expect(runtime.mountedKeys).toEqual([apiKey1])
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
        disconnect,
      }
      const controller = new ManagedOpenApiMcpController({
        mountMcp: true, sessionStore: observedSession,
        accessCredentialProvider: { resolveManagedAccessCredential: vi.fn(async () => new SecretValue('access-secret')) },
        controlPlane: control, manifestSource: { read: vi.fn(async () => manifest()) },
        credentialStore: credentials, runtime: new FakeRuntime([]), reconcileLock: new ImmediateLock(),
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
      disconnect: vi.fn(async () => undefined),
    }
    const controller = new ManagedOpenApiMcpController({
      mountMcp: true, sessionStore: observedSession,
      accessCredentialProvider: { resolveManagedAccessCredential: vi.fn(async () => new SecretValue('access-secret')) },
      controlPlane: control, manifestSource: { read: vi.fn(async () => manifest()) },
      credentialStore: credentials, runtime, reconcileLock: new ImmediateLock(),
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
      mount: vi.fn((_apiKey, _manifest, signal) => ({
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
      disconnect: vi.fn(async () => undefined),
    }
    const controller = new ManagedOpenApiMcpController({
      mountMcp: true, sessionStore: observedSession,
      accessCredentialProvider: { resolveManagedAccessCredential: vi.fn(async () => new SecretValue('access-secret')) },
      controlPlane: control, manifestSource: { read: vi.fn(async () => manifest()) },
      credentialStore: credentials, runtime, reconcileLock: new ImmediateLock(),
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

  it('leases the current managed key without exposing it in controller state', async () => {
    const fixture = setup()
    await fixture.controller.retry()

    const value = await fixture.controller.executeWithCredential(
      new AbortController().signal,
      async (key, signal) => ({ key: key.reveal(), aborted: signal.aborted }),
    )

    expect(value).toEqual({ key: apiKey1, aborted: false })
    expect(JSON.stringify(fixture.controller.status())).not.toContain(apiKey1)
    await fixture.controller.dispose()
  })

  it('shares cold credential preparation and does not lease a cached key before control-plane confirmation', async () => {
    const fixture = setup({ credential: stored() })
    const confirmation = deferred<ManagedOpenApiControlResult>()
    vi.mocked(fixture.control.ensure).mockImplementationOnce(async () => await confirmation.promise)
    const execute = vi.fn(async (key: SecretValue) => key.reveal())

    const first = fixture.controller.executeWithCredential(new AbortController().signal, execute)
    const second = fixture.controller.executeWithCredential(new AbortController().signal, execute)
    await vi.waitFor(() => { expect(fixture.control.ensure).toHaveBeenCalledOnce() })
    expect(execute).not.toHaveBeenCalled()

    confirmation.resolve(ready())
    await expect(Promise.all([first, second])).resolves.toEqual([apiKey1, apiKey1])
    expect(fixture.control.ensure).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledTimes(2)
    await fixture.controller.dispose()
  })

  it('fences a cold credential waiter when its account generation changes', async () => {
    const fixture = setup({ credential: stored() })
    const confirmation = deferred<ManagedOpenApiControlResult>()
    vi.mocked(fixture.control.ensure).mockImplementationOnce(async () => await confirmation.promise)
    const execute = vi.fn(async (key: SecretValue) => key.reveal())
    const pending = fixture.controller.executeWithCredential(new AbortController().signal, execute)
    await vi.waitFor(() => { expect(fixture.control.ensure).toHaveBeenCalledOnce() })

    const ticket = await fixture.controller.prepare(activeSession(), {
      userId: 99,
      accessToken: jwt(99, 8),
      refreshToken: 'new-refresh',
    })
    confirmation.resolve(ready())

    await expect(pending).rejects.toBeInstanceOf(ManagedOpenApiCredentialSupersededError)
    expect(execute).not.toHaveBeenCalled()
    fixture.controller.rolledBack(ticket)
    await fixture.controller.dispose()
  })

  it('aborts an in-flight REST credential lease as soon as the account changes', async () => {
    const fixture = setup()
    await fixture.controller.retry()
    const pending = fixture.controller.executeWithCredential(
      new AbortController().signal,
      async (_key, signal) => await new Promise<string>((resolve, reject) => {
        signal.addEventListener('abort', () => { reject(signal.reason) }, { once: true })
        void resolve
      }),
    )

    await fixture.controller.prepare(activeSession(), {
      userId: 99,
      accessToken: jwt(99, 8),
      refreshToken: 'new-refresh',
    })

    await expect(pending).rejects.toBeInstanceOf(ManagedOpenApiCredentialSupersededError)
    await fixture.controller.dispose()
  })

  it('feeds a REST key rejection back into the existing credential reconciler', async () => {
    const fixture = setup()
    await fixture.controller.retry()
    await expect(fixture.controller.executeWithCredential(
      new AbortController().signal,
      async () => { throw new ManagedOpenApiCredentialRejectedError() },
    )).rejects.toBeInstanceOf(ManagedOpenApiCredentialRejectedError)

    await vi.waitFor(() => { expect(fixture.control.ensure).toHaveBeenCalledTimes(2) })
    await fixture.controller.dispose()
  })
})
