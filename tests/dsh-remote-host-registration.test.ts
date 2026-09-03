import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeSecureValueStore } from '../src/keychain-store.js'
import { DshApiProxyAdapter, type DshPublicApiProxyLike } from '../src/dsh-remote/api-proxy-adapter.js'
import { DshRemoteCommandLedger } from '../src/dsh-remote/command-ledger.js'
import type { DshRemoteHistoryEntry } from '../src/dsh-remote/dsh-event-contract.js'
import { DshRemoteError } from '../src/dsh-remote/errors.js'
import {
  ArkmeRemoteRealtimeHost,
  type DshRemoteSessionPersistenceLike,
} from '../src/dsh-remote/host.js'
import { DshRemoteRuntimeStore } from '../src/dsh-remote/runtime-store.js'
import { DshRemoteRuntimeSecretBroker } from '../src/dsh-remote/runtime-secret-broker.js'
import { DshRemoteSessionOwnershipStore } from '../src/dsh-remote/session-ownership-store.js'
import type { DshRemoteTurnUploadOutbox } from '../src/dsh-remote/turn-upload-outbox.js'
import type {
  DshRemoteControlPlane,
  DshRemoteRealtimePayload,
  DshRemoteRealtimeTransport,
  DshRemoteTrustedEventMetadata,
} from '../src/dsh-remote/types.js'

class MemorySecrets implements ArkmeSecureValueStore {
  private readonly values = new Map<string, string>()
  async read(account: string): Promise<string | undefined> { return this.values.get(account) }
  async write(account: string, value: string): Promise<void> { this.values.set(account, value) }
  async delete(account: string): Promise<void> { this.values.delete(account) }
}

class FakeRealtime implements DshRemoteRealtimeTransport {
  readonly calls: string[] = []
  connectWaiter: Promise<void> | undefined
  onEvent: ((payload: DshRemoteRealtimePayload, metadata: DshRemoteTrustedEventMetadata) => void) | undefined
  private disconnectListener: ((error: Error) => void) | undefined
  subscribeDisconnect(listener: (error: Error) => void): () => void {
    this.disconnectListener = listener
    return () => { this.disconnectListener = undefined }
  }
  async connect(): Promise<void> { this.calls.push('connect'); await this.connectWaiter }
  async disconnect(): Promise<void> { this.calls.push('disconnect') }
  async registerHost(): Promise<{ serviceLeaseGeneration: number }> { this.calls.push('register'); return { serviceLeaseGeneration: 9 } }
  async unregisterHost(): Promise<void> { this.calls.push('unregister') }
  async subscribe(input: Parameters<DshRemoteRealtimeTransport['subscribe']>[0]): Promise<() => void> {
    this.calls.push(`subscribe:${input.target.hostLeaseGeneration}`)
    this.onEvent = input.onEvent
    return () => { this.calls.push('unsubscribe'); this.onEvent = undefined }
  }
  async publish(): Promise<{ sequence: number }> { this.calls.push('publish'); return { sequence: 1 } }
  emitDisconnect(error: Error): void { this.disconnectListener?.(error) }
}

function apiProxy(): DshApiProxyAdapter {
  const api: DshPublicApiProxyLike = {
    workspace: { list: async request => ({
      rpcId: request.rpcId,
      result: { ok: true, value: { items: [{ workspaceId: 'workspace-01', path: '/repo', title: 'Repo', sessionIds: ['session-01'] }] } },
    }) },
    sessions: { list: async request => ({
      rpcId: request.rpcId,
      result: { ok: true, value: { items: [{ sessionId: 'session-01', updatedAt: 1_000, running: false, blank: false, cwd: '/repo' }] } },
    }) },
  }
  return new DshApiProxyAdapter(api)
}

async function fixture(input: {
  featureEnabled?: boolean
  session?: () => { userId: number; clientId: number } | undefined
  now?: () => number
  turnUploadForAccount?: (
    accountId: string,
    key: Buffer,
    maxObjectBytes: number,
    callbacks: { onError: (error: unknown, sessionRef?: string) => void; onFinalized: (sessionRef: string) => void },
  ) => DshRemoteTurnUploadOutbox
  turnObjectCapabilities?: () => Promise<Record<string, unknown>>
  knownHistorySessions?: (input: Record<string, unknown>, signal?: AbortSignal) => Promise<Record<string, unknown>>
  sessionPersistence?: DshRemoteSessionPersistenceLike
  yieldToEventLoop?: () => Promise<void>
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-remote-host-'))
  const realtime = new FakeRealtime()
  const controlCalls: Array<{ name: string; value: Record<string, unknown> }> = []
  const controlPlane: DshRemoteControlPlane = {
    registerDesktop: async value => { controlCalls.push({ name: 'desktop', value }); return { desktop_ref: 'desktop-01' } },
    registerRuntime: async (_desktopRef, value) => { controlCalls.push({ name: 'runtime', value }); return { runtime_ref: 'runtime-01', host_generation: 1 } },
    syncWorkspaces: async value => { controlCalls.push({ name: 'workspaces', value }); return {} },
    syncSessions: async value => { controlCalls.push({ name: 'sessions', value }); return {} },
    completeProjectionSnapshot: async value => { controlCalls.push({ name: 'complete', value }); return {} },
    appendSessionEvents: async value => { controlCalls.push({ name: 'events', value }); return {} },
    sessionEventSyncStatuses: async value => {
      controlCalls.push({ name: 'event-status', value })
      return { items: [] }
    },
    completeSessionEventHistory: async value => {
      controlCalls.push({ name: 'event-complete', value })
      return {}
    },
    turnObjectUploadCapabilities: input.turnObjectCapabilities ?? (async () => input.turnUploadForAccount === undefined
      ? { available: false }
      : {
          available: true, storage_version: 'oss_turn_v1', coverage: 'live_completed_turns',
          content_encoding: 'gzip', max_object_bytes: 1024,
        }),
    ...(input.knownHistorySessions === undefined ? {} : { knownHistorySessions: input.knownHistorySessions }),
  }
  const adapter = apiProxy()
  const sessionOwnership = new DshRemoteSessionOwnershipStore(directory, 'web')
  const host = new ArkmeRemoteRealtimeHost({
    featureEnabled: input.featureEnabled ?? true,
    profileRef: 'web', hostClientRef: 'host-client-01', displayName: 'My Mac',
    readSession: async () => input.session === undefined ? { userId: 42, clientId: 9 } : input.session(),
    secretBroker: new DshRemoteRuntimeSecretBroker(new MemorySecrets()),
    runtimeStore: new DshRemoteRuntimeStore(directory),
    sessionOwnership,
    controlPlane, realtime, apiProxy: adapter,
    ledgerForAccount: (_accountId, key) => new DshRemoteCommandLedger(join(directory, 'ledger'), key),
    ...(input.turnUploadForAccount === undefined ? {} : { turnUploadForAccount: input.turnUploadForAccount }),
    ...(input.sessionPersistence === undefined ? {} : { sessionPersistence: input.sessionPersistence }),
    ...(input.yieldToEventLoop === undefined ? {} : { yieldToEventLoop: input.yieldToEventLoop }),
    now: input.now ?? (() => 2_000),
  })
  return { host, realtime, controlCalls, adapter, sessionOwnership }
}

function historyEvent(type: string, seq: number): DshRemoteHistoryEntry['event'] {
  return { type, seq, time: seq, data: type === 'turn/end' ? { reason: { kind: 'completed' } } : {} }
}

function historyOutbox() {
  const revisions = new Map<string, string>()
  return {
    activate: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    capture: vi.fn(async () => undefined),
    needsHistoryRevision: vi.fn((sessionRef: string, revision: string) => revisions.get(sessionRef) !== revision),
    queueHistoryFinalization: vi.fn((sessionRef: string, revision: string) => { revisions.set(sessionRef, revision) }),
  }
}

afterEach(() => { vi.useRealTimers() })

describe('Host login-only registration lifecycle', () => {
  it('does nothing when the rollout feature is disabled', async () => {
    const { host, realtime, controlCalls } = await fixture({ featureEnabled: false })
    await host.start()
    expect(host.getStatus()).toMatchObject({ available: false, enabled: false, connected: false })
    expect(controlCalls).toEqual([])
    expect(realtime.calls).toEqual([])
    await host.stop()
  })

  it('registers Backend projections, subscribes before Host lease, and uses no authorization control plane', async () => {
    const { host, realtime, controlCalls, sessionOwnership } = await fixture()
    await host.start()
    await expect(sessionOwnership.ownerAccountId('session-01')).resolves.toBe('42')
    expect(controlCalls.map(call => call.name)).toEqual(['desktop', 'runtime', 'workspaces', 'sessions', 'complete'])
    expect(controlCalls[1]!.value).toMatchObject({
      profile_ref: 'web', host_client_ref: 'host-client-01', protocol: 'dsh.remote', protocol_major: 1,
    })
    expect(controlCalls[2]!.value).toMatchObject({
      runtime_ref: 'runtime-01', host_generation: 1,
      snapshot_ref: 'snap_1_2000',
      items: [{ workspace_ref: 'workspace-01', projection_at: 2_000, order_index: 0 }],
    })
    expect(controlCalls[3]!.value).toMatchObject({
      runtime_ref: 'runtime-01', host_generation: 1,
      snapshot_ref: 'snap_1_2000',
      items: [{ session_ref: 'session-01', workspace_ref: 'workspace-01', projection_at: 2_000, order_index: 0, archived: false }],
    })
    expect(controlCalls[4]!.value).toEqual({
      runtime_ref: 'runtime-01', host_generation: 1, snapshot_ref: 'snap_1_2000',
      workspace_count: 1, session_count: 1,
    })
    expect(realtime.calls.slice(0, 3)).toEqual(['connect', 'subscribe:0', 'register'])
    expect(host.getStatus()).toMatchObject({ enabled: true, connected: true, accountId: '42', runtimeRef: 'runtime-01' })
    expect(JSON.stringify(controlCalls)).not.toMatch(/pairing|binding|credential|grant/)
    await host.stop()
  })

  it('does not project or transfer a Session that belongs to another Arkme account', async () => {
    const { host, controlCalls, sessionOwnership } = await fixture({
      session: () => ({ userId: 84, clientId: 10 }),
    })
    await sessionOwnership.claimUnownedAndListOwned({
      accountId: '42',
      sessionRefs: ['session-01'],
      origin: 'existing-at-login',
      nowMillis: 1_000,
    })

    await host.start()

    expect(controlCalls.find(call => call.name === 'sessions')?.value).toMatchObject({ items: [] })
    await expect(sessionOwnership.ownerAccountId('session-01')).resolves.toBe('42')
    await host.stop()
  })

  it('unregisters the Host lease before unsubscribing and disconnecting', async () => {
    const { host, realtime } = await fixture()
    await host.start()
    await host.stop()
    const tail = realtime.calls.slice(-3)
    expect(tail).toEqual(['unregister', 'unsubscribe', 'disconnect'])
  })

  it('closes the old account Turn outbox before activating a new account scope', async () => {
    let current = { userId: 42, clientId: 9 }
    const outboxes: Array<{ activate: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> = []
    const { host } = await fixture({
      session: () => current,
      turnUploadForAccount: () => {
        const value = { activate: vi.fn(), close: vi.fn(async () => undefined) }
        outboxes.push(value)
        return value as unknown as DshRemoteTurnUploadOutbox
      },
    })
    await host.start()
    await vi.waitFor(() => { expect(outboxes).toHaveLength(1) })
    let releaseTail!: () => void
    const tail = new Promise<void>(resolve => { releaseTail = resolve })
    Object.assign(host, { liveProjectionTails: new Map([['session-01', tail]]) })
    current = { userId: 43, clientId: 10 }
    const switching = (host as unknown as { syncSession(): Promise<void> }).syncSession()
    await Promise.resolve()
    expect(outboxes[0]!.close).not.toHaveBeenCalled()
    releaseTail()
    await switching

    await vi.waitFor(() => { expect(outboxes).toHaveLength(2) })
    expect(outboxes[0]!.close).toHaveBeenCalledOnce()
    expect(outboxes[0]!.close.mock.invocationCallOrder[0]).toBeLessThan(
      outboxes[1]!.activate.mock.invocationCallOrder[0]!,
    )
    await host.stop()
  })

  it('does not gate realtime startup on Turn object capability discovery', async () => {
    let resolveCapabilities!: (value: Record<string, unknown>) => void
    const capabilities = new Promise<Record<string, unknown>>(resolve => { resolveCapabilities = resolve })
    const factory = vi.fn(() => ({
      activate: vi.fn(),
      close: vi.fn(async () => undefined),
    }) as unknown as DshRemoteTurnUploadOutbox)
    const { host } = await fixture({
      turnUploadForAccount: factory,
      turnObjectCapabilities: async () => await capabilities,
    })

    await host.start()
    expect(host.getStatus().connected).toBe(true)
    expect(factory).not.toHaveBeenCalled()

    resolveCapabilities({
      available: true, storage_version: 'oss_turn_v1',
      coverage: 'live_completed_turns', content_encoding: 'gzip', max_object_bytes: 2048,
    })
    await vi.waitFor(() => {
      expect(factory).toHaveBeenCalledWith('42', expect.any(Buffer), 2048, expect.objectContaining({
        onError: expect.any(Function), onFinalized: expect.any(Function),
      }))
    })
    await host.stop()
  })

  it('retries a transient Turn object capability failure without reconnecting the account', async () => {
    let now = 2_000
    const capabilities = vi.fn(async () => {
      if (capabilities.mock.calls.length === 1) throw new TypeError('temporary network failure')
      return {
        available: true, storage_version: 'oss_turn_v1', coverage: 'live_completed_turns',
        content_encoding: 'gzip', max_object_bytes: 2048,
      }
    })
    const outbox = historyOutbox()
    const factory = vi.fn(() => outbox as unknown as DshRemoteTurnUploadOutbox)
    const { host } = await fixture({
      now: () => now,
      turnUploadForAccount: factory,
      turnObjectCapabilities: capabilities,
    })
    await host.start()
    expect(host.getStatus().connected).toBe(true)
    await vi.waitFor(() => { expect(capabilities).toHaveBeenCalledOnce() })
    expect(factory).not.toHaveBeenCalled()

    now += 30_001
    await (host as unknown as { syncSession(): Promise<void> }).syncSession()
    await vi.waitFor(() => { expect(factory).toHaveBeenCalledOnce() })
    expect(outbox.activate).toHaveBeenCalledOnce()
    await host.stop()
  })

  it('closes a failed Outbox activation and keeps the legacy path available', async () => {
    const close = vi.fn(async () => undefined)
    const { host } = await fixture({
      turnUploadForAccount: () => ({
        activate: vi.fn(async () => { throw new Error('corrupt local spool') }),
        close,
      }) as unknown as DshRemoteTurnUploadOutbox,
    })

    await host.start()
    expect(host.getStatus().connected).toBe(true)
    await vi.waitFor(() => { expect(close).toHaveBeenCalledOnce() })
    expect((host as unknown as { turnUpload?: unknown }).turnUpload).toBeUndefined()
    await host.stop()
  })

  it('emits explicit tombstones when a previously projected workspace and session disappear', async () => {
    const { host, controlCalls, adapter } = await fixture()
    await host.start()
    vi.spyOn(adapter, 'workspaceInventory').mockResolvedValue({
      items: [], archivedSessionIds: [],
    })
    vi.spyOn(adapter, 'sessions').mockResolvedValue({ items: [] })

    await (host as unknown as {
      syncProjectionSnapshot(force: boolean): Promise<void>
    }).syncProjectionSnapshot(true)

    const workspace = controlCalls.filter(call => call.name === 'workspaces').at(-1)!.value
    const session = controlCalls.filter(call => call.name === 'sessions').at(-1)!.value
    expect(workspace).toMatchObject({
      items: [{ workspace_ref: 'workspace-01', deleted: true }],
    })
    expect(session).toMatchObject({
      items: [{
        workspace_ref: 'workspace-01',
        session_ref: 'session-01',
        deleted: true,
      }],
    })
    await host.stop()
  })

  it('serializes full snapshots so completion cannot overtake another page chain', async () => {
    const { host, controlCalls } = await fixture()
    await host.start()
    controlCalls.splice(0)
    const internal = host as unknown as {
      syncProjectionSnapshot(force: boolean): Promise<void>
    }
    await Promise.all([
      internal.syncProjectionSnapshot(true),
      internal.syncProjectionSnapshot(true),
    ])
    expect(controlCalls.map(call => call.name)).toEqual([
      'workspaces', 'sessions', 'complete',
      'workspaces', 'sessions', 'complete',
    ])
    const snapshotRefs = controlCalls.map(call => call.value.snapshot_ref)
    expect(new Set(snapshotRefs.slice(0, 3)).size).toBe(1)
    expect(new Set(snapshotRefs.slice(3)).size).toBe(1)
    expect(snapshotRefs[0]).not.toBe(snapshotRefs[3])
    await host.stop()
  })

  it('does not repeat a complete Backend projection inside the 30 second metadata interval', async () => {
    let now = 2_000
    const { host, controlCalls } = await fixture({ now: () => now })
    await host.start()
    controlCalls.splice(0)
    const internal = host as unknown as {
      syncProjectionSnapshotSafely(force?: boolean): Promise<void>
    }

    now = 20_000
    await internal.syncProjectionSnapshotSafely()
    expect(controlCalls).toEqual([])

    now = 32_001
    await internal.syncProjectionSnapshotSafely()
    expect(controlCalls.map(call => call.name)).toEqual([
      'workspaces', 'sessions', 'complete',
    ])
    await host.stop()
  })

  it('activates after login and tears down immediately after logout', async () => {
    vi.useFakeTimers()
    let current: { userId: number; clientId: number } | undefined
    const { host, realtime } = await fixture({ session: () => current })
    await host.start()
    expect(host.getStatus().connected).toBe(false)
    current = { userId: 42, clientId: 9 }
    await (host as unknown as { syncSession(): Promise<void> }).syncSession()
    expect(host.getStatus().connected).toBe(true)
    current = undefined
    await (host as unknown as { syncSession(): Promise<void> }).syncSession()
    expect(host.getStatus()).toMatchObject({ enabled: false, connected: false })
    expect(realtime.calls).toContain('unregister')
    await host.stop()
  })

  it('keeps session polling behind one reconnect flight', async () => {
    vi.useFakeTimers()
    const { host, realtime } = await fixture()
    await host.start()
    const reconnect = Promise.withResolvers<void>()
    realtime.connectWaiter = reconnect.promise

    realtime.emitDisconnect(new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'offline', true))
    await (host as unknown as { syncSession(): Promise<void> }).syncSession()
    expect(realtime.calls.filter(call => call === 'connect')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(30_000)
    vi.useRealTimers()
    await vi.waitFor(() => {
      expect(realtime.calls.filter(call => call === 'connect')).toHaveLength(2)
    })

    const firstPoll = (host as unknown as { syncSession(): Promise<void> }).syncSession()
    const secondPoll = (host as unknown as { syncSession(): Promise<void> }).syncSession()
    await Promise.resolve()
    expect(realtime.calls.filter(call => call === 'connect')).toHaveLength(2)
    reconnect.resolve()
    await Promise.all([firstPoll, secondPoll])
    expect(host.getStatus().connected).toBe(true)
    await host.stop()
  })

  it('does not reconnect a non-retryable transport failure', async () => {
    vi.useFakeTimers()
    const { host, realtime } = await fixture()
    await host.start()
    realtime.emitDisconnect(new DshRemoteError('REMOTE_PROTOCOL_UNSUPPORTED', 'upgrade required', false))
    await (host as unknown as { syncSession(): Promise<void> }).syncSession()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(realtime.calls.filter(call => call === 'connect')).toHaveLength(1)
    await host.stop()
  })

  it('does not register a stale Host lease when stopped during reconnect', async () => {
    vi.useFakeTimers()
    const { host, realtime } = await fixture()
    await host.start()
    const reconnect = Promise.withResolvers<void>()
    realtime.connectWaiter = reconnect.promise
    realtime.emitDisconnect(new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'offline', true))

    await vi.advanceTimersByTimeAsync(30_000)
    vi.useRealTimers()
    await vi.waitFor(() => {
      expect(realtime.calls.filter(call => call === 'connect')).toHaveLength(2)
    })

    const connectionFlight = (host as unknown as { connectionFlight?: Promise<void> }).connectionFlight
    await host.stop()
    reconnect.resolve()
    await connectionFlight?.catch(() => undefined)
    expect(host.getStatus().connected).toBe(false)
    expect(realtime.calls.filter(call => call === 'register')).toHaveLength(1)
  })

  it('reports history synchronization separately from connection availability', async () => {
    const { host } = await fixture()
    await host.start()
    const internal = host as unknown as {
      connectionError?: DshRemoteError
      historySyncError?: DshRemoteError
      projectionError?: DshRemoteError
    }
    internal.historySyncError = new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'history unavailable', true)
    internal.projectionError = new DshRemoteError('CAPABILITY_UNSUPPORTED', 'projection unavailable', false)
    expect(host.getStatus()).toMatchObject({
      connected: true,
      historySyncWarning: 'history unavailable',
      projectionWarning: 'projection unavailable',
    })
    expect(host.getStatus().unavailableReason).toBeUndefined()

    internal.connectionError = new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'connection unavailable', true)
    expect(host.getStatus()).toMatchObject({
      unavailableReason: 'connection unavailable',
      historySyncWarning: 'history unavailable',
      projectionWarning: 'projection unavailable',
    })
    await host.stop()
  })

  it('projects background finalization failure and recovery without changing Host connection health', async () => {
    const outbox = historyOutbox()
    let callbacks: { onError: (error: unknown, sessionRef?: string) => void; onFinalized: (sessionRef: string) => void } | undefined
    const { host } = await fixture({
      turnUploadForAccount: (_accountId, _key, _maxObjectBytes, value) => {
        callbacks = value
        return outbox as unknown as DshRemoteTurnUploadOutbox
      },
    })
    await host.start()
    await vi.waitFor(() => { expect(callbacks).toBeDefined() })

    callbacks!.onError(new DshRemoteError('REMOTE_NETWORK_UNAVAILABLE', 'finalization unavailable', true), 'session-01')
    expect(host.getStatus()).toMatchObject({ connected: true, historySyncWarning: 'finalization unavailable' })
    expect(host.getStatus().unavailableReason).toBeUndefined()

    callbacks!.onFinalized('session-02')
    expect(host.getStatus().historySyncWarning).toBe('finalization unavailable')
    callbacks!.onFinalized('session-01')
    expect(host.getStatus().historySyncWarning).toBeUndefined()
    expect(host.getStatus().connected).toBe(true)
    await host.stop()
  })

  it('requeues only Backend-known cold sessions and checkpoints the stable DSH revision', async () => {
    const outbox = historyOutbox()
    const readFrom = vi.fn(async (sessionRef: string) => ({
      meta: { id: sessionRef },
      events: [
        historyEvent('session/start', 0),
        historyEvent('turn/start', 1), historyEvent('assistant/message', 2), historyEvent('turn/end', 3),
        historyEvent('turn/start', 4), historyEvent('turn/end', 5),
      ],
    }))
    const knownHistorySessions = vi.fn(async () => ({ session_refs: ['session-01'] }))
    const { host } = await fixture({
      turnUploadForAccount: () => outbox as unknown as DshRemoteTurnUploadOutbox,
      turnObjectCapabilities: async () => ({
        available: true, storage_version: 'oss_turn_v1', coverage: 'live_completed_turns',
        backfill_mode: 'local_persistence_v1', content_encoding: 'gzip', max_object_bytes: 1024,
      }),
      knownHistorySessions,
      sessionPersistence: {
        listSnapshots: async () => [
          { header: { id: 'session-01' }, revision: 'revision-1' },
          { header: { id: 'session-from-another-account' }, revision: 'revision-x' },
        ],
        readFrom,
      },
      yieldToEventLoop: async () => undefined,
    })
    await host.start()
    await vi.waitFor(() => { expect(outbox.activate).toHaveBeenCalledOnce() })
    const internal = host as unknown as {
      runtime: { runtimeRef: string }
      backfillOneHistorySession(accountId: string, runtime: unknown, signal: AbortSignal): Promise<boolean>
    }

    await expect(internal.backfillOneHistorySession('42', internal.runtime, new AbortController().signal))
      .resolves.toBe(true)
    expect(knownHistorySessions).toHaveBeenCalledWith({
      session_refs: ['session-01'],
    }, expect.any(AbortSignal))
    expect(readFrom).toHaveBeenCalledOnce()
    expect(readFrom).toHaveBeenCalledWith('session-01', 0, expect.any(AbortSignal))
    expect(outbox.capture.mock.calls.map(call => call[1].map(entry => entry.event.seq))).toEqual([
      [1, 2, 3], [4, 5],
    ])
    expect(outbox.queueHistoryFinalization).toHaveBeenCalledWith('session-01', 'revision-1', 5)

    await expect(internal.backfillOneHistorySession('42', internal.runtime, new AbortController().signal))
      .resolves.toBe(false)
    expect(readFrom).toHaveBeenCalledOnce()
    await host.stop()
  })

  it('does not checkpoint a session whose persistence revision changes during the read', async () => {
    const outbox = historyOutbox()
    let snapshotCall = 0
    const readFrom = vi.fn(async () => ({
      meta: { id: 'session-01' },
      events: [historyEvent('turn/start', 1), historyEvent('turn/end', 2)],
    }))
    const { host } = await fixture({
      turnUploadForAccount: () => outbox as unknown as DshRemoteTurnUploadOutbox,
      turnObjectCapabilities: async () => ({
        available: true, storage_version: 'oss_turn_v1', coverage: 'live_completed_turns',
        backfill_mode: 'local_persistence_v1', content_encoding: 'gzip', max_object_bytes: 1024,
      }),
      knownHistorySessions: async () => ({ session_refs: ['session-01'] }),
      sessionPersistence: {
        listSnapshots: async () => [{
          header: { id: 'session-01' },
          revision: snapshotCall++ === 0 ? 'revision-1' : 'revision-2',
        }],
        readFrom,
      },
      yieldToEventLoop: async () => undefined,
    })
    await host.start()
    await vi.waitFor(() => { expect(outbox.activate).toHaveBeenCalledOnce() })
    const internal = host as unknown as {
      runtime: { runtimeRef: string }
      backfillOneHistorySession(accountId: string, runtime: unknown, signal: AbortSignal): Promise<boolean>
    }

    await expect(internal.backfillOneHistorySession('42', internal.runtime, new AbortController().signal))
      .resolves.toBe(true)
    expect(outbox.queueHistoryFinalization).not.toHaveBeenCalled()
    await host.stop()
  })

  it('backfills a completed Turn from the current Session after delayed Outbox activation', async () => {
    const outbox = historyOutbox()
    const readFrom = vi.fn(async () => ({
      meta: { id: 'session-01' },
      events: [historyEvent('turn/start', 1), historyEvent('assistant/message', 2), historyEvent('turn/end', 3)],
    }))
    const knownHistorySessions = vi.fn(async () => ({ session_refs: ['session-01'] }))
    const { host } = await fixture({
      turnUploadForAccount: () => outbox as unknown as DshRemoteTurnUploadOutbox,
      turnObjectCapabilities: async () => ({
        available: true, storage_version: 'oss_turn_v1', coverage: 'live_completed_turns',
        backfill_mode: 'local_persistence_v1', content_encoding: 'gzip', max_object_bytes: 1024,
      }),
      knownHistorySessions,
      sessionPersistence: {
        listSnapshots: async () => [{ header: { id: 'session-01' }, revision: 'revision-1' }],
        readFrom,
      },
    })
    await host.start()
    await vi.waitFor(() => { expect(outbox.activate).toHaveBeenCalledOnce() })
    const internal = host as unknown as {
      runtime: { runtimeRef: string }
      backfillOneHistorySession(accountId: string, runtime: unknown, signal: AbortSignal): Promise<boolean>
    }

    await expect(internal.backfillOneHistorySession('42', internal.runtime, new AbortController().signal))
      .resolves.toBe(true)
    expect(knownHistorySessions).toHaveBeenCalledOnce()
    expect(readFrom).toHaveBeenCalledOnce()
    expect(outbox.capture).toHaveBeenCalledWith('session-01', [
      { event: historyEvent('turn/start', 1) },
      { event: historyEvent('assistant/message', 2) },
      { event: historyEvent('turn/end', 3) },
    ])
    expect(outbox.queueHistoryFinalization).toHaveBeenCalledWith('session-01', 'revision-1', 3)
    await host.stop()
  })

  it('aborts a cold history read when realtime user work arrives', async () => {
    const outbox = historyOutbox()
    let readStarted!: () => void
    const started = new Promise<void>(resolve => { readStarted = resolve })
    const readFrom = vi.fn(async (_sessionRef: string, _fromSeq: number, signal?: AbortSignal) => {
      readStarted()
      return await new Promise<never>((_resolve, reject) => {
        signal?.addEventListener('abort', () => { reject(signal.reason) }, { once: true })
      })
    })
    const { host } = await fixture({
      turnUploadForAccount: () => outbox as unknown as DshRemoteTurnUploadOutbox,
      turnObjectCapabilities: async () => ({
        available: true, storage_version: 'oss_turn_v1', coverage: 'live_completed_turns',
        backfill_mode: 'local_persistence_v1', content_encoding: 'gzip', max_object_bytes: 1024,
      }),
      knownHistorySessions: async () => ({ session_refs: ['session-01'] }),
      sessionPersistence: {
        listSnapshots: async () => [{ header: { id: 'session-01' }, revision: 'revision-1' }],
        readFrom,
      },
    })
    await host.start()
    await vi.waitFor(() => { expect(outbox.activate).toHaveBeenCalledOnce() })
    const controller = new AbortController()
    const internal = host as unknown as {
      runtime: { runtimeRef: string }
      historyObjectBackfillController?: AbortController
      backfillOneHistorySession(accountId: string, runtime: unknown, signal: AbortSignal): Promise<boolean>
      publishProjectionEvent(event: unknown): Promise<void>
    }
    internal.historyObjectBackfillController = controller
    const backfill = internal.backfillOneHistorySession('42', internal.runtime, controller.signal)
    await started
    Object.assign(host, { connected: false })
    await internal.publishProjectionEvent({
      kind: 'session-event', sessionId: 'session-01',
      entry: { event: historyEvent('turn/start', 10) },
    })

    await expect(backfill).rejects.toBeDefined()
    expect(controller.signal.aborted).toBe(true)
    expect(outbox.capture).toHaveBeenCalledWith('session-01', [{ event: historyEvent('turn/start', 10) }])
    await host.stop()
  })

  it('feeds a 100k-event historical Turn to the durable outbox in bounded chunks', async () => {
    const outbox = historyOutbox()
    const events = [historyEvent('turn/start', 1)]
    for (let seq = 2; seq <= 100_001; seq += 1) events.push(historyEvent('assistant/chunk', seq))
    events.push(historyEvent('turn/end', 100_002))
    const { host } = await fixture({
      turnUploadForAccount: () => outbox as unknown as DshRemoteTurnUploadOutbox,
      turnObjectCapabilities: async () => ({
        available: true, storage_version: 'oss_turn_v1', coverage: 'live_completed_turns',
        backfill_mode: 'local_persistence_v1', content_encoding: 'gzip', max_object_bytes: 1024,
      }),
      knownHistorySessions: async () => ({ session_refs: ['session-01'] }),
      sessionPersistence: {
        listSnapshots: async () => [{ header: { id: 'session-01' }, revision: 'revision-large' }],
        readFrom: async () => ({ meta: { id: 'session-01' }, events }),
      },
      yieldToEventLoop: async () => undefined,
    })
    await host.start()
    await vi.waitFor(() => { expect(outbox.activate).toHaveBeenCalledOnce() })
    const internal = host as unknown as {
      runtime: { runtimeRef: string }
      backfillOneHistorySession(accountId: string, runtime: unknown, signal: AbortSignal): Promise<boolean>
    }

    await expect(internal.backfillOneHistorySession('42', internal.runtime, new AbortController().signal))
      .resolves.toBe(true)
    expect(outbox.capture).toHaveBeenCalledTimes(Math.ceil(events.length / 50))
    expect(outbox.capture.mock.calls.every(call => call[1].length <= 50)).toBe(true)
    expect(outbox.queueHistoryFinalization).toHaveBeenCalledWith('session-01', 'revision-large', 100_002)
    await host.stop()
  })
})
