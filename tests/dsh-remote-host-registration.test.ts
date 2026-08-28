import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeSecureValueStore } from '../src/keychain-store.js'
import { DshApiProxyAdapter, type DshPublicApiProxyLike } from '../src/dsh-remote/api-proxy-adapter.js'
import { DshRemoteCommandLedger } from '../src/dsh-remote/command-ledger.js'
import { ArkmeRemoteRealtimeHost } from '../src/dsh-remote/host.js'
import { DshRemoteRuntimeStore } from '../src/dsh-remote/runtime-store.js'
import { DshRemoteRuntimeSecretBroker } from '../src/dsh-remote/runtime-secret-broker.js'
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
  onEvent: ((payload: DshRemoteRealtimePayload, metadata: DshRemoteTrustedEventMetadata) => void) | undefined
  private disconnectListener: ((error: Error) => void) | undefined
  subscribeDisconnect(listener: (error: Error) => void): () => void {
    this.disconnectListener = listener
    return () => { this.disconnectListener = undefined }
  }
  async connect(): Promise<void> { this.calls.push('connect') }
  async disconnect(): Promise<void> { this.calls.push('disconnect') }
  async registerHost(): Promise<{ serviceLeaseGeneration: number }> { this.calls.push('register'); return { serviceLeaseGeneration: 9 } }
  async unregisterHost(): Promise<void> { this.calls.push('unregister') }
  async subscribe(input: Parameters<DshRemoteRealtimeTransport['subscribe']>[0]): Promise<() => void> {
    this.calls.push(`subscribe:${input.target.hostLeaseGeneration}`)
    this.onEvent = input.onEvent
    return () => { this.calls.push('unsubscribe'); this.onEvent = undefined }
  }
  async publish(): Promise<{ sequence: number }> { this.calls.push('publish'); return { sequence: 1 } }
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

async function fixture(input: { featureEnabled?: boolean; session?: () => { userId: number; clientId: number } | undefined } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-remote-host-'))
  const realtime = new FakeRealtime()
  const controlCalls: Array<{ name: string; value: Record<string, unknown> }> = []
  const controlPlane: DshRemoteControlPlane = {
    registerDesktop: async value => { controlCalls.push({ name: 'desktop', value }); return { desktop_ref: 'desktop-01' } },
    registerRuntime: async (_desktopRef, value) => { controlCalls.push({ name: 'runtime', value }); return { runtime_ref: 'runtime-01', host_generation: 1 } },
    syncWorkspaces: async value => { controlCalls.push({ name: 'workspaces', value }); return {} },
    syncSessions: async value => { controlCalls.push({ name: 'sessions', value }); return {} },
    appendSessionEvents: async value => { controlCalls.push({ name: 'events', value }); return {} },
  }
  const adapter = apiProxy()
  const host = new ArkmeRemoteRealtimeHost({
    featureEnabled: input.featureEnabled ?? true,
    profileRef: 'web', hostClientRef: 'host-client-01', displayName: 'My Mac',
    readSession: async () => input.session === undefined ? { userId: 42, clientId: 9 } : input.session(),
    secretBroker: new DshRemoteRuntimeSecretBroker(new MemorySecrets()),
    runtimeStore: new DshRemoteRuntimeStore(directory),
    controlPlane, realtime, apiProxy: adapter,
    ledgerForAccount: (_accountId, key) => new DshRemoteCommandLedger(join(directory, 'ledger'), key),
    now: () => 2_000,
  })
  return { host, realtime, controlCalls, adapter }
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
    const { host, realtime, controlCalls } = await fixture()
    await host.start()
    expect(controlCalls.map(call => call.name)).toEqual(['desktop', 'runtime', 'workspaces', 'sessions'])
    expect(controlCalls[1]!.value).toMatchObject({
      profile_ref: 'web', host_client_ref: 'host-client-01', protocol: 'dsh.remote', protocol_major: 1,
    })
    expect(controlCalls[2]!.value).toMatchObject({
      runtime_ref: 'runtime-01', host_generation: 1,
      items: [{ workspace_ref: 'workspace-01', projection_at: 2_000 }],
    })
    expect(controlCalls[3]!.value).toMatchObject({
      runtime_ref: 'runtime-01', host_generation: 1,
      items: [{ session_ref: 'session-01', workspace_ref: 'workspace-01', projection_at: 2_000 }],
    })
    expect(realtime.calls.slice(0, 3)).toEqual(['connect', 'subscribe:0', 'register'])
    expect(host.getStatus()).toMatchObject({ enabled: true, connected: true, accountId: '42', runtimeRef: 'runtime-01' })
    expect(JSON.stringify(controlCalls)).not.toMatch(/pairing|binding|credential|grant/)
    await host.stop()
  })

  it('unregisters the Host lease before unsubscribing and disconnecting', async () => {
    const { host, realtime } = await fixture()
    await host.start()
    await host.stop()
    const tail = realtime.calls.slice(-3)
    expect(tail).toEqual(['unregister', 'unsubscribe', 'disconnect'])
  })

  it('emits explicit tombstones when a previously projected workspace and session disappear', async () => {
    const { host, controlCalls, adapter } = await fixture()
    await host.start()
    vi.spyOn(adapter, 'workspaces').mockResolvedValue([])
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
})
