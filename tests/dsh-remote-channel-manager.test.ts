import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSecureValueStore } from '../src/keychain-store.js'
import { DshRemoteHostChannelManager } from '../src/dsh-remote/channel-manager.js'
import { DshRemoteError } from '../src/dsh-remote/errors.js'
import { DshRemoteRuntimeSecretBroker } from '../src/dsh-remote/runtime-secret-broker.js'
import type {
  DshRemoteRealtimePayload,
  DshRemoteRealtimeTransport,
  DshRemoteRuntimeTarget,
  DshRemoteTrustedEventMetadata,
} from '../src/dsh-remote/types.js'

class MemorySecrets implements ArkmeSecureValueStore {
  readonly values = new Map<string, string>()
  async read(account: string): Promise<string | undefined> { return this.values.get(account) }
  async write(account: string, value: string): Promise<void> { this.values.set(account, value) }
  async delete(account: string): Promise<void> { this.values.delete(account) }
}

class FakeRealtime implements DshRemoteRealtimeTransport {
  subscriptions: Array<{ target: DshRemoteRuntimeTarget; afterSequence?: number }> = []
  publishes: Array<{ target: DshRemoteRuntimeTarget; direction: string; payload: Record<string, unknown> }> = []
  onEvent: ((payload: DshRemoteRealtimePayload, metadata: DshRemoteTrustedEventMetadata) => void) | undefined
  failReplayOnce = false
  subscribeDisconnect(): () => void { return () => undefined }
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async registerHost(): Promise<{ serviceLeaseGeneration: number }> { return { serviceLeaseGeneration: 9 } }
  async unregisterHost(): Promise<void> {}
  async subscribe(input: Parameters<DshRemoteRealtimeTransport['subscribe']>[0]): Promise<() => void> {
    this.subscriptions.push({ target: input.target, ...(input.afterSequence === undefined ? {} : { afterSequence: input.afterSequence }) })
    if (this.failReplayOnce) {
      this.failReplayOnce = false
      throw new DshRemoteError('REPLAY_GAP', 'gap', true)
    }
    this.onEvent = input.onEvent
    return () => { this.onEvent = undefined }
  }
  async publish(input: Parameters<DshRemoteRealtimeTransport['publish']>[0]): Promise<{ sequence: number }> {
    this.publishes.push({ target: input.target, direction: input.direction, payload: input.payload })
    return { sequence: this.publishes.length }
  }
  event(payload: DshRemoteRealtimePayload, metadata: DshRemoteTrustedEventMetadata): void { this.onEvent?.(payload, metadata) }
}

function response(requestRef: string): Record<string, unknown> {
  return {
    protocol: 'dsh.remote', protocol_major: 1, kind: 'response', request_ref: requestRef,
    status: 'completed', host_generation: 3, issued_at: 1_000,
    operation: 'capabilities.get', body: {}, result: {},
  }
}

function managerFixture(): {
  manager: DshRemoteHostChannelManager
  realtime: FakeRealtime
  dispatch: ReturnType<typeof vi.fn>
  fatals: unknown[]
} {
  const realtime = new FakeRealtime()
  const dispatch = vi.fn(async () => response('request-01') as never)
  const fatals: unknown[] = []
  const manager = new DshRemoteHostChannelManager({
    accountId: '42', profileRef: 'web', hostClientRef: 'host-client-01', runtimeRef: 'runtime-01',
    realtime, secretBroker: new DshRemoteRuntimeSecretBroker(new MemorySecrets()), dispatch,
    onFatal: error => { fatals.push(error) },
  })
  return { manager, realtime, dispatch, fatals }
}

const controllerMetadata = (generation: number, sequence = 1): DshRemoteTrustedEventMetadata => ({
  senderRole: 'controller', runtimeRef: 'runtime-01', acceptedAtMillis: 1_000,
  targetHostLeaseGeneration: generation, transportSequence: sequence,
})

describe('account-scoped Runtime channel manager', () => {
  it('subscribes with generation 0, then publishes only with the activated lease', async () => {
    const { manager, realtime, dispatch } = managerFixture()
    await manager.prepare()
    expect(realtime.subscriptions[0]!.target).toMatchObject({ runtimeRef: 'runtime-01', hostLeaseGeneration: 0 })
    await manager.activate(9)
    realtime.event({ kind: 'request' }, controllerMetadata(9))
    await vi.waitFor(() => { expect(dispatch).toHaveBeenCalledOnce() })
    await vi.waitFor(() => { expect(realtime.publishes).toHaveLength(1) })
    expect(realtime.publishes[0]).toMatchObject({
      target: { runtimeRef: 'runtime-01', hostLeaseGeneration: 9 }, direction: 'response',
    })
  })

  it('buffers the narrow service-register race until the positive lease is activated', async () => {
    const { manager, realtime, dispatch } = managerFixture()
    await manager.prepare()
    realtime.event({ kind: 'request' }, controllerMetadata(9))
    await Promise.resolve()
    expect(dispatch).not.toHaveBeenCalled()
    await manager.activate(9)
    expect(dispatch).toHaveBeenCalledOnce()
  })

  it('ignores Host echoes but treats a stale controller generation as fatal', async () => {
    const { manager, realtime, dispatch, fatals } = managerFixture()
    await manager.prepare()
    await manager.activate(9)
    realtime.event({ kind: 'response' }, { ...controllerMetadata(9), senderRole: 'host' })
    await Promise.resolve()
    expect(dispatch).not.toHaveBeenCalled()
    realtime.event({ kind: 'request' }, controllerMetadata(8))
    await vi.waitFor(() => { expect(fatals).toHaveLength(1) })
    expect(fatals[0]).toMatchObject({ code: 'HOST_GENERATION_STALE', retryable: true })
  })

  it('recovers a replay gap by subscribing at the live head', async () => {
    const { manager, realtime } = managerFixture()
    realtime.failReplayOnce = true
    await manager.prepare()
    expect(realtime.subscriptions).toEqual([
      { target: expect.objectContaining({ hostLeaseGeneration: 0 }), afterSequence: 0 },
      { target: expect.objectContaining({ hostLeaseGeneration: 0 }) },
    ])
  })

  it('persists the Runtime cursor without any Binding key', async () => {
    const secrets = new MemorySecrets()
    const realtime = new FakeRealtime()
    const broker = new DshRemoteRuntimeSecretBroker(secrets)
    const manager = new DshRemoteHostChannelManager({
      accountId: '42', profileRef: 'web', hostClientRef: 'host-client-01', runtimeRef: 'runtime-01',
      realtime, secretBroker: broker, dispatch: async () => response('request-01') as never, onFatal: () => undefined,
    })
    await manager.prepare()
    await manager.activate(9)
    realtime.event({ kind: 'request' }, controllerMetadata(9, 17))
    await vi.waitFor(() => { expect(realtime.publishes).toHaveLength(1) })
    await manager.close()
    await expect(broker.runtimeCursor({ accountId: '42', runtimeRef: 'runtime-01', channelRef: 'runtime-01' })).resolves.toBe(17)
    expect([...secrets.values.values()].join('\n')).not.toContain('binding')
  })
})
