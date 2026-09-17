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
  revalidate(): void {}
  subscriptions: Array<{ target: DshRemoteRuntimeTarget; afterSequence?: number }> = []
  publishes: Array<{ target: DshRemoteRuntimeTarget; commandId: string; direction: string; payload: Record<string, unknown> }> = []
  onEvent: ((payload: DshRemoteRealtimePayload, metadata: DshRemoteTrustedEventMetadata) => void) | undefined
  failReplayOnce = false
  failPublishCount = 0
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
    this.publishes.push({ target: input.target, commandId: input.commandId, direction: input.direction, payload: input.payload })
    if (this.failPublishCount > 0) {
      this.failPublishCount -= 1
      throw new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'retry publish', true)
    }
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
  diagnostics: ReturnType<typeof vi.fn>
} {
  const realtime = new FakeRealtime()
  const dispatch = vi.fn(async () => response('request-01') as never)
  const fatals: unknown[] = []
  const diagnostics = vi.fn()
  const manager = new DshRemoteHostChannelManager({
    accountId: '42', profileRef: 'web', hostClientRef: 'host-client-01', runtimeRef: 'runtime-01',
    realtime, secretBroker: new DshRemoteRuntimeSecretBroker(new MemorySecrets()), dispatch,
    onProjectionError: error => { fatals.push({ projection: error }) },
    onFatal: error => { fatals.push(error) },
    onDiagnostic: diagnostics,
  })
  return { manager, realtime, dispatch, fatals, diagnostics }
}

const controllerMetadata = (generation: number, sequence = 1): DshRemoteTrustedEventMetadata => ({
  senderRole: 'controller', runtimeRef: 'runtime-01', acceptedAtMillis: 1_000,
  targetHostLeaseGeneration: generation, transportSequence: sequence,
})

describe('account-scoped Runtime channel manager', () => {
  it('redelivers a ledger result without reusing the previous response delivery ID', async () => {
    const { manager, realtime, dispatch, fatals } = managerFixture()
    await manager.prepare()
    manager.activate(9)
    realtime.event({ ...response('request-01'), kind: 'request' }, controllerMetadata(9))
    await vi.waitFor(() => { expect(realtime.publishes).toHaveLength(1) })
    dispatch.mockResolvedValueOnce({ ...response('request-01'), status: 'duplicate', issued_at: 2_000 } as never)
    realtime.failPublishCount = 1
    realtime.event({ ...response('request-01'), kind: 'request' }, controllerMetadata(9, 2))
    await vi.waitFor(() => { expect(realtime.publishes).toHaveLength(3) })
    const [first, retried, publishRetry] = realtime.publishes
    expect(retried!.commandId).not.toBe(first!.commandId)
    expect(publishRetry!.commandId).toBe(retried!.commandId)
    expect(publishRetry!.payload).toEqual(retried!.payload)
    expect(publishRetry!.payload).toMatchObject({ request_ref: 'request-01', status: 'duplicate' })
    expect(fatals).toEqual([])
    await manager.close()
  })

  it('correlates request processing and publish acknowledgement without logging bodies', async () => {
    const { manager, realtime, diagnostics } = managerFixture()
    await manager.prepare()
    manager.activate(9)
    realtime.event({ ...response('request-01'), kind: 'request', body: { content: 'private prompt' } }, controllerMetadata(9))
    await vi.waitFor(() => { expect(diagnostics).toHaveBeenCalledWith('host_response_publish_finished', expect.objectContaining({ completed: true })) })
    expect(diagnostics.mock.calls.map(([event]) => event)).toEqual(['host_request_received', 'host_request_processed', 'host_response_publish_finished'])
    for (const [, fields] of diagnostics.mock.calls) expect(fields).toMatchObject({ user_id: '42', runtime_ref: 'runtime-01', request_ref: 'request-01', operation: 'capabilities.get' })
    expect(JSON.stringify(diagnostics.mock.calls)).not.toContain('private prompt')
    diagnostics.mockImplementation(() => { throw new Error('logger unavailable') })
    realtime.event({ ...response('request-02'), kind: 'request' }, controllerMetadata(9, 2))
    await vi.waitFor(() => { expect(realtime.publishes).toHaveLength(2) })
    await manager.close()
  })

  it('distinguishes completed processing from a failed response publish', async () => {
    const { manager, realtime, diagnostics } = managerFixture()
    realtime.failPublishCount = 3
    await manager.prepare()
    manager.activate(9)
    realtime.event({ ...response('request-01'), kind: 'request' }, controllerMetadata(9))
    await vi.waitFor(() => { expect(diagnostics).toHaveBeenCalledWith('host_response_publish_failed', expect.objectContaining({ request_ref: 'request-01', error_code: 'REMOTE_TRANSPORT_FAILED' })) })
    expect(diagnostics).toHaveBeenCalledWith('host_request_processed', expect.objectContaining({ status: 'completed' }))
    expect(diagnostics).toHaveBeenCalledWith('host_response_publish_finished', expect.objectContaining({ completed: false }))
    await manager.close()
  })

  it('reports a response skipped because the channel closed during dispatch', async () => {
    const { manager, realtime, dispatch, diagnostics, fatals } = managerFixture()
    await manager.prepare()
    manager.activate(9)
    dispatch.mockImplementationOnce(async () => {
      await manager.close()
      return response('request-01') as never
    })
    realtime.event({ ...response('request-01'), kind: 'request' }, controllerMetadata(9))
    await vi.waitFor(() => { expect(diagnostics).toHaveBeenCalledWith('host_response_publish_failed', expect.objectContaining({ request_ref: 'request-01', error_code: 'HOST_CHANNEL_NOT_READY' })) })
    expect(realtime.publishes).toHaveLength(0)
    expect(fatals).toEqual([])
  })

  it('keeps successful native stream polling out of request logs', async () => {
    const { manager, realtime, diagnostics } = managerFixture()
    await manager.prepare()
    manager.activate(9)
    for (let i = 0; i < 20; i++) realtime.event({
      ...response(`poll-request-${i}`), kind: 'request', operation: 'session.native', body: { mode: 'pull' },
    }, controllerMetadata(9, i + 1))
    await vi.waitFor(() => { expect(realtime.publishes).toHaveLength(20) })
    expect(diagnostics).not.toHaveBeenCalled()
    await manager.close()
  })

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

  it('ignores Host echoes and delegates stale controller leases without restarting the Host', async () => {
    const { manager, realtime, dispatch, fatals } = managerFixture()
    await manager.prepare()
    await manager.activate(9)
    realtime.event({ kind: 'response' }, { ...controllerMetadata(9), senderRole: 'host' })
    await Promise.resolve()
    expect(dispatch).not.toHaveBeenCalled()
    realtime.event({ kind: 'request' }, controllerMetadata(8))
    await vi.waitFor(() => { expect(dispatch).toHaveBeenCalledOnce() })
    await vi.waitFor(() => { expect(realtime.publishes).toHaveLength(1) })
    expect(dispatch.mock.calls[0]![1]).toMatchObject({
      serviceLeaseGeneration: 9,
      metadata: { targetHostLeaseGeneration: 8 },
    })
    expect(fatals).toEqual([])
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
      realtime, secretBroker: broker, dispatch: async () => response('request-01') as never,
      onProjectionError: () => undefined, onFatal: () => undefined,
    })
    await manager.prepare()
    await manager.activate(9)
    realtime.event({ kind: 'request' }, controllerMetadata(9, 17))
    await vi.waitFor(() => { expect(realtime.publishes).toHaveLength(1) })
    await manager.close()
    await expect(broker.runtimeCursor({ accountId: '42', runtimeRef: 'runtime-01', channelRef: 'runtime-01' })).resolves.toBe(17)
    expect([...secrets.values.values()].join('\n')).not.toContain('binding')
  })

  it('persists the new sequence after a rollback instead of keeping the rejected future cursor', async () => {
    const broker = new DshRemoteRuntimeSecretBroker(new MemorySecrets())
    const route = { accountId: '42', runtimeRef: 'runtime-01', channelRef: 'runtime-01' }
    await broker.putRuntimeCursor({ ...route, lastTransportSequence: 11844 })
    const realtime = new FakeRealtime()
    realtime.failReplayOnce = true
    const options = {
      ...route, profileRef: 'web', hostClientRef: 'host-client-01', realtime, secretBroker: broker,
      dispatch: async () => response('request-01') as never,
      onProjectionError: () => undefined, onFatal: (error: unknown) => { throw error },
    }
    const manager = new DshRemoteHostChannelManager(options)
    await manager.prepare()
    await expect(broker.runtimeCursor(route)).resolves.toBe(0)
    manager.activate(9)
    realtime.event({ kind: 'request' }, controllerMetadata(9, 21))
    await vi.waitFor(() => { expect(realtime.publishes).toHaveLength(1) })
    await manager.close()
    await expect(broker.runtimeCursor(route)).resolves.toBe(21)
    const reopened = new DshRemoteHostChannelManager(options)
    await reopened.prepare()
    expect(realtime.subscriptions.at(-1)?.afterSequence).toBe(21)
    await reopened.close()
  })

  it('fragments multi-megabyte responses without treating them as a fatal channel error', async () => {
    const { manager, realtime, dispatch, fatals } = managerFixture()
    dispatch.mockResolvedValue({ ...response('request-01'), result: { blob: 'x'.repeat(5 * 1024 * 1024) } })
    await manager.prepare()
    await manager.activate(9)
    realtime.event({ kind: 'request' }, controllerMetadata(9))
    await vi.waitFor(() => { expect(realtime.publishes.length).toBeGreaterThan(1) })
    expect(realtime.publishes.every(item => item.payload.kind === 'fragment')).toBe(true)
    expect(new Set(realtime.publishes.map(item => item.commandId)).size).toBe(realtime.publishes.length)
    expect(fatals).toEqual([])
  })

  it('retries a retryable frame with the same idempotent command id', async () => {
    vi.useFakeTimers()
    const { manager, realtime } = managerFixture()
    realtime.failPublishCount = 2
    await manager.prepare()
    await manager.activate(9)
    const publish = manager.publishProjectionEvent({ kind: 'event' }, 'projection-01')
    await vi.advanceTimersByTimeAsync(300)
    await publish
    expect(realtime.publishes).toHaveLength(3)
    expect(new Set(realtime.publishes.map(item => item.commandId))).toEqual(new Set(['projection-01']))
    vi.useRealTimers()
  })
})


it('a buffered request uses the same projection-error policy as a live request', async () => {
  const { manager, realtime, fatals } = managerFixture()
  const failure = new DshRemoteError('REMOTE_REQUEST_INVALID', 'large projection', false, { logicalTooLarge: true })
  vi.spyOn(realtime, 'publish').mockRejectedValue(failure)
  await manager.prepare()
  realtime.event({ kind: 'request' }, controllerMetadata(9))
  manager.activate(9)
  await vi.waitFor(() => { expect(fatals).toEqual([{ projection: failure }]) })
  expect(manager.status().ready).toBe(true)
  await manager.close()
})

it('separates outbound queue time from ACK time and contains diagnostic failures', async () => {
  const { manager, realtime } = managerFixture()
  await manager.prepare(); await manager.activate(9)
  let now = 0
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
  const gate = Promise.withResolvers<void>()
  const timings: unknown[] = []
  vi.spyOn(realtime, 'publish').mockImplementationOnce(async () => { await gate.promise; return { sequence: 1 } })
  try {
    const first = manager.publishProjectionEvent({ kind: 'event' }, 'first', timing => { timings.push(timing) })
    await Promise.resolve()
    now = 10
    const second = manager.publishProjectionEvent({ kind: 'event' }, 'second', timing => {
      timings.push(timing); throw new Error('diagnostic failed')
    })
    now = 80; gate.resolve()
    await Promise.all([first, second])
    expect(timings).toEqual([
      { queueMs: 0, publishMs: 80, completed: true },
      { queueMs: 70, publishMs: 0, completed: true },
    ])
    vi.spyOn(realtime, 'publish').mockRejectedValueOnce(new DshRemoteError('REMOTE_INVALID_RESPONSE', 'invalid', false))
    const timing = vi.fn()
    await expect(manager.publishProjectionEvent({ kind: 'event' }, 'failed', timing)).rejects.toThrow('invalid')
    expect(timing).toHaveBeenCalledWith({ queueMs: 0, publishMs: 0, completed: false })
  } finally { clock.mockRestore(); await manager.close() }
})

it('reassembles native attachment requests only from the current authenticated controller lease', async () => {
  const { dshRemoteOutboundPayloads } = await import('../src/dsh-remote/transport-fragment.js')
  const { manager, realtime, dispatch, fatals } = managerFixture()
  await manager.prepare(); await manager.activate(9)
  const payload = { protocol: 'dsh.remote', kind: 'request', operation: 'session.native', body: { data: 'a'.repeat(100_000) } }
  const frames = dshRemoteOutboundPayloads(payload, 'attachment')
  for (const frame of frames) realtime.event(frame.value as never, controllerMetadata(8))
  await Promise.resolve(); expect(dispatch).not.toHaveBeenCalled()
  for (const frame of [...frames].reverse()) realtime.event(frame.value as never, controllerMetadata(9))
  await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce())
  expect(dispatch.mock.calls[0]![0]).toEqual(payload)
  expect(fatals).toEqual([])
  await manager.close()
})
