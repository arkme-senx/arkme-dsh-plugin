import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DshApiProxyAdapter,
  type DshPublicApiProxyLike,
  type DshRemoteApiProjectionEvent,
} from '../src/dsh-remote/api-proxy-adapter.js'
import { DshRemoteCommandLedger } from '../src/dsh-remote/command-ledger.js'
import { DshRemoteError } from '../src/dsh-remote/errors.js'
import { ArkmeRemoteRealtimeHost } from '../src/dsh-remote/host.js'
import type { DshRemoteControlPlane, DshRemoteRealtimeTransport } from '../src/dsh-remote/types.js'
import type { DshRemoteRuntimeSecretBroker } from '../src/dsh-remote/runtime-secret-broker.js'
import type { DshRemoteRuntimeStore } from '../src/dsh-remote/runtime-store.js'
import type { DshRemoteSessionOwnership } from '../src/dsh-remote/session-ownership-store.js'

class MemorySessionOwnership implements DshRemoteSessionOwnership {
  private readonly owners = new Map<string, string>()

  constructor(entries: Array<[string, string]> = []) {
    for (const [sessionRef, accountId] of entries) this.owners.set(sessionRef, accountId)
  }

  async claimUnownedAndListOwned(input: Parameters<DshRemoteSessionOwnership['claimUnownedAndListOwned']>[0]): Promise<Set<string>> {
    const owned = new Set<string>()
    const canClaim = input.canClaim?.() ?? true
    for (const sessionRef of input.sessionRefs) {
      if (!this.owners.has(sessionRef) && canClaim) this.owners.set(sessionRef, input.accountId)
      if (this.owners.get(sessionRef) === input.accountId) owned.add(sessionRef)
    }
    return owned
  }

  async listOwned(accountId: string, sessionRefs: readonly string[]): Promise<Set<string>> {
    return new Set(sessionRefs.filter(sessionRef => this.owners.get(sessionRef) === accountId))
  }

  async ownerAccountId(sessionRef: string): Promise<string | undefined> { return this.owners.get(sessionRef) }
}

function ok<T>(value: T, rpcId: string) { return { rpcId, result: { ok: true as const, value } } }

function inertHost(apiProxy: DshApiProxyAdapter, input: {
  controlPlane?: DshRemoteControlPlane
  ledger?: DshRemoteCommandLedger
  now?: () => number
  realtime?: DshRemoteRealtimeTransport
  sessionOwnership?: DshRemoteSessionOwnership
  yieldToEventLoop?: () => Promise<void>
} = {}): ArkmeRemoteRealtimeHost {
  return new ArkmeRemoteRealtimeHost({
    featureEnabled: true, profileRef: 'web', hostClientRef: 'host-client-01',
    readSession: async () => undefined,
    secretBroker: {} as DshRemoteRuntimeSecretBroker,
    runtimeStore: {} as DshRemoteRuntimeStore,
    sessionOwnership: input.sessionOwnership ?? new MemorySessionOwnership(),
    controlPlane: input.controlPlane ?? {} as DshRemoteControlPlane,
    realtime: input.realtime ?? {} as DshRemoteRealtimeTransport,
    apiProxy,
    ledgerForAccount: () => input.ledger ?? (() => { throw new Error('unused') })(),
    now: input.now ?? (() => 1_500),
    ...(input.yieldToEventLoop === undefined ? {} : { yieldToEventLoop: input.yieldToEventLoop }),
  })
}

afterEach(() => { vi.useRealTimers() })

async function flushLive(host: ArkmeRemoteRealtimeHost): Promise<void> {
  await (host as unknown as { flushPendingSessionEventBatches(): Promise<void> }).flushPendingSessionEventBatches()
}

describe('Arkme remote Host account contract', () => {
  it('never writes legacy history when the Turn Outbox is not ready', async () => {
    const appendSessionEvents = vi.fn(async () => ({}))
    const publishProjectionEvent = vi.fn(async () => undefined)
    const host = inertHost(new DshApiProxyAdapter({}), {
      controlPlane: { appendSessionEvents } as unknown as DshRemoteControlPlane,
    })
    Object.assign(host, {
      started: true, connected: true, accountId: '1', channelManager: { publishProjectionEvent },
      runtime: {
        runtimeRef: 'runtime-01', desktopRef: 'desktop-01', profileRef: 'web', accountId: '1',
        hostGeneration: 7, capabilities: ['session.events'], updatedAtMillis: 1,
      },
    })

    await (host as unknown as {
      publishProjectionEvent(value: DshRemoteApiProjectionEvent): Promise<void>
    }).publishProjectionEvent({
      kind: 'session-event', sessionId: 'session-01',
      entry: { event: { type: 'permission/preset', seq: 0, time: 1_400, data: {} } },
    })
    await flushLive(host)

    expect(appendSessionEvents).not.toHaveBeenCalled()
    expect(publishProjectionEvent).toHaveBeenCalledOnce()
  })

  it('routes live events to the Turn Outbox only when the rollout owner is installed', async () => {
    const appendSessionEvents = vi.fn(async () => ({}))
    const capture = vi.fn(async () => undefined)
    const host = inertHost(new DshApiProxyAdapter({}), {
      controlPlane: { appendSessionEvents } as unknown as DshRemoteControlPlane,
    })
    Object.assign(host, {
      started: true, connected: false, accountId: '1',
      turnUpload: { capture },
      runtime: {
        runtimeRef: 'runtime-01', desktopRef: 'desktop-01', profileRef: 'web', accountId: '1',
        hostGeneration: 7, capabilities: ['session.events'], updatedAtMillis: 1,
      },
    })

    await (host as unknown as {
      publishProjectionEvent(value: DshRemoteApiProjectionEvent): Promise<void>
    }).publishProjectionEvent({
      kind: 'session-event', sessionId: 'session-01',
      entry: { event: { type: 'turn/start', seq: 8, time: 1_400, data: {} } },
    })
    await flushLive(host)

    expect(capture).toHaveBeenCalledOnce()
    expect(appendSessionEvents).not.toHaveBeenCalled()
  })

  it('maps public ApiProxy events to Runtime channel projections without legacy writes', async () => {
    const publishProjectionEvent = vi.fn(async () => undefined)
    const appendSessionEvents = vi.fn(async () => ({}))
    const host = inertHost(new DshApiProxyAdapter({}), {
      controlPlane: { appendSessionEvents } as unknown as DshRemoteControlPlane,
    })
    Object.assign(host, {
      started: true, connected: true, channelManager: { publishProjectionEvent }, accountId: '1',
      runtime: {
        runtimeRef: 'runtime-01', profileRef: 'web', accountId: '1', hostGeneration: 7,
        capabilities: ['session.events'], updatedAtMillis: 1,
      },
    })
    const project = async (event: DshRemoteApiProjectionEvent) => {
      await (host as unknown as { publishProjectionEvent(value: DshRemoteApiProjectionEvent): Promise<void> })
        .publishProjectionEvent(event)
      await flushLive(host)
    }
    await project({
      kind: 'session-event', sessionId: 'session-01',
      entry: { event: { type: 'assistant/message', seq: 8, time: 1_400, data: {
        content: [{ type: 'text', text: 'answer' }], source: { kind: 'assistant' },
      } } },
    })
    expect(appendSessionEvents).not.toHaveBeenCalled()
    expect(publishProjectionEvent.mock.calls[0]![0]).toMatchObject({
      kind: 'event', host_generation: 7, operation: 'session.history', session_seq: 8,
      projection_as_of_seq: 8,
    })
    await project({ kind: 'mux-baseline', sessionId: 'session-01', lastSeq: 8, pendingInteractions: [] })
    expect(publishProjectionEvent.mock.calls[1]![0]).toMatchObject({
      kind: 'event', operation: 'snapshot.get', projection_as_of_seq: 8,
      body: { reason: 'mux-generation', session_ref: 'session-01', last_seq: 8 },
    })
    await project({
      kind: 'interactions', pendingInteractions: [{
        kind: 'question', interactionRpcRef: 'question-01', sessionId: 'session-01',
        questions: [{ id: 'large', question: '四'.repeat(50_000) }],
      }],
    })
    expect(publishProjectionEvent.mock.calls[2]![0]).toMatchObject({ body: { reason: 'projection-overflow' } })
    expect(publishProjectionEvent.mock.calls[2]![0]).not.toHaveProperty('body.pending_interactions')
  })

  it('publishes the owned public goal projection without creating another realtime operation', async () => {
    const publishProjectionEvent = vi.fn(async () => undefined)
    const host = inertHost(new DshApiProxyAdapter({}))
    const syncProjectionSnapshotSafely = vi.fn(async () => undefined)
    Object.assign(host, {
      started: true, connected: true, channelManager: { publishProjectionEvent }, accountId: '1',
      syncProjectionSnapshotSafely,
      runtime: {
        runtimeRef: 'runtime-01', profileRef: 'web', accountId: '1', hostGeneration: 7,
        capabilities: ['session.events'], updatedAtMillis: 1,
      },
    })

    await (host as unknown as {
      publishProjectionEvent(value: DshRemoteApiProjectionEvent): Promise<void>
    }).publishProjectionEvent({
      kind: 'session-projection', sessionId: 'session-01', key: 'goal', seq: 12,
      value: { goal: { objective: '完成任务', phase: 'active' } },
    })

    expect(publishProjectionEvent).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'snapshot.get', projection_as_of_seq: 12,
      body: { session_ref: 'session-01', session_projection: {
        key: 'goal', seq: 12, value: { goal: { objective: '完成任务', phase: 'active' } },
      } },
    }), expect.any(String))
    expect(syncProjectionSnapshotSafely).toHaveBeenCalledWith()
  })

  it('batches ordered live chunks without calling legacy history', async () => {
    vi.useFakeTimers()
    const appendSessionEvents = vi.fn(async () => ({}))
    const published = vi.fn(async () => undefined)
    const host = inertHost(new DshApiProxyAdapter({}), {
      controlPlane: { appendSessionEvents } as unknown as DshRemoteControlPlane,
    })
    Object.assign(host, {
      started: true, connected: true, channelManager: { publishProjectionEvent: published }, accountId: '1',
      runtime: {
        runtimeRef: 'runtime-01', profileRef: 'web', accountId: '1', hostGeneration: 7,
        capabilities: ['session.events'], updatedAtMillis: 1,
      },
    })
    const project = (seq: number) => (host as unknown as {
      publishProjectionEvent(value: DshRemoteApiProjectionEvent): Promise<void>
    }).publishProjectionEvent({
      kind: 'session-event', sessionId: 'session-01',
      entry: {
        event: { type: 'assistant/chunk', seq, time: 1_400 + seq, data: {} },
        presentation: { version: 1, format: 'content', tone: 'neutral' },
      },
    })

    await Promise.all([project(8), project(9), project(10)])

    expect(appendSessionEvents).not.toHaveBeenCalled()
    expect(published).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(40)

    expect(appendSessionEvents).not.toHaveBeenCalled()
    expect(published).toHaveBeenCalledOnce()
    expect(published).toHaveBeenCalledWith(expect.objectContaining({
      session_seq: 10,
      body: expect.objectContaining({ presentation_version: 1, entries: expect.arrayContaining([
        expect.objectContaining({ event: expect.objectContaining({ seq: 8 }) }),
        expect.objectContaining({ event: expect.objectContaining({ seq: 10 }) }),
      ]) }),
    }), expect.any(String), expect.any(Function))
  })

  it('keeps live batches independent across Sessions', async () => {
    vi.useFakeTimers()
    const published = vi.fn(async () => undefined)
    const host = inertHost(new DshApiProxyAdapter({}))
    Object.assign(host, {
      started: true, connected: true, channelManager: { publishProjectionEvent: published }, accountId: '1',
      runtime: {
        runtimeRef: 'runtime-01', profileRef: 'web', accountId: '1', hostGeneration: 7,
        capabilities: ['session.events'], updatedAtMillis: 1,
      },
    })
    const project = (sessionId: string, seq: number) => (host as unknown as {
      publishProjectionEvent(value: DshRemoteApiProjectionEvent): Promise<void>
    }).publishProjectionEvent({
      kind: 'session-event', sessionId,
      entry: { event: { type: 'assistant/chunk', seq, time: 1_400 + seq, data: {} } },
    })

    await Promise.all([project('session-a', 8), project('session-b', 3)])
    await vi.advanceTimersByTimeAsync(40)

    expect(published).toHaveBeenCalledTimes(2)
    expect(published.mock.calls.map(call => (call[0].body as { session_ref: string }).session_ref).sort())
      .toEqual(['session-a', 'session-b'])
  })

  it('flushes pending chunks with a semantic event and cancels the timer', async () => {
    vi.useFakeTimers()
    const appendSessionEvents = vi.fn(async () => ({}))
    const published = vi.fn(async () => undefined)
    const host = inertHost(new DshApiProxyAdapter({}), {
      controlPlane: { appendSessionEvents } as unknown as DshRemoteControlPlane,
    })
    Object.assign(host, {
      started: true, connected: true, channelManager: { publishProjectionEvent: published }, accountId: '1',
      runtime: {
        runtimeRef: 'runtime-01', profileRef: 'web', accountId: '1', hostGeneration: 7,
        capabilities: ['session.events'], updatedAtMillis: 1,
      },
    })
    const project = (seq: number, type: string) => (host as unknown as {
      publishProjectionEvent(value: DshRemoteApiProjectionEvent): Promise<void>
    }).publishProjectionEvent({
      kind: 'session-event', sessionId: 'session-01',
      entry: { event: { type, seq, time: 1_400 + seq, data: {} } },
    })

    await project(8, 'assistant/chunk')
    await project(9, 'assistant/chunk')
    await project(10, 'turn/start')
    await vi.advanceTimersByTimeAsync(0)

    expect(appendSessionEvents).not.toHaveBeenCalled()
    expect(published).toHaveBeenCalledOnce()
    expect(published).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ run_state: 'running', presentation_version: 1 }),
    }), expect.any(String), expect.any(Function))
    await vi.advanceTimersByTimeAsync(40)
    expect(appendSessionEvents).not.toHaveBeenCalled()
    expect(published).toHaveBeenCalledOnce()
  })

  it('flushes the final live chunk before a graceful lifecycle teardown', async () => {
    vi.useFakeTimers()
    const appendSessionEvents = vi.fn(async () => ({}))
    const published = vi.fn(async () => undefined)
    const host = inertHost(new DshApiProxyAdapter({}), {
      controlPlane: { appendSessionEvents } as unknown as DshRemoteControlPlane,
    })
    Object.assign(host, {
      started: true, connected: true, channelManager: { publishProjectionEvent: published }, accountId: '1',
      runtime: {
        runtimeRef: 'runtime-01', profileRef: 'web', accountId: '1', hostGeneration: 7,
        capabilities: ['session.events'], updatedAtMillis: 1,
      },
    })
    await (host as unknown as {
      publishProjectionEvent(value: DshRemoteApiProjectionEvent): Promise<void>
    }).publishProjectionEvent({
      kind: 'session-event', sessionId: 'session-01',
      entry: { event: { type: 'assistant/chunk', seq: 8, time: 1_408, data: {} } },
    })

    await (host as unknown as { flushPendingSessionEventBatches(): Promise<void> })
      .flushPendingSessionEventBatches()

    expect(appendSessionEvents).not.toHaveBeenCalled()
    expect(published).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(40)
    expect(appendSessionEvents).not.toHaveBeenCalled()
  })

  it('discards pending live chunks when an account transition suspends the Host', async () => {
    vi.useFakeTimers()
    const appendSessionEvents = vi.fn(async () => ({}))
    const published = vi.fn(async () => undefined)
    const host = inertHost(new DshApiProxyAdapter({}), {
      controlPlane: { appendSessionEvents } as unknown as DshRemoteControlPlane,
      realtime: { disconnect: async () => undefined } as unknown as DshRemoteRealtimeTransport,
    })
    Object.assign(host, {
      started: true, connected: true, channelManager: { publishProjectionEvent: published, close: async () => undefined }, accountId: '1',
      runtime: {
        runtimeRef: 'runtime-01', profileRef: 'web', accountId: '1', hostGeneration: 7,
        capabilities: ['session.events'], updatedAtMillis: 1,
      },
    })
    await (host as unknown as {
      publishProjectionEvent(value: DshRemoteApiProjectionEvent): Promise<void>
    }).publishProjectionEvent({
      kind: 'session-event', sessionId: 'session-01',
      entry: { event: { type: 'assistant/chunk', seq: 8, time: 1_408, data: {} } },
    })

    await host.suspend()
    await vi.advanceTimersByTimeAsync(40)

    expect(appendSessionEvents).not.toHaveBeenCalled()
    expect(published).not.toHaveBeenCalled()
  })

  it('flushes at the 50-event capacity and clears pending timers on lifecycle reset', async () => {
    vi.useFakeTimers()
    const appendSessionEvents = vi.fn(async () => ({}))
    const published = vi.fn(async () => undefined)
    const host = inertHost(new DshApiProxyAdapter({}), {
      controlPlane: { appendSessionEvents } as unknown as DshRemoteControlPlane,
    })
    Object.assign(host, {
      started: true, connected: true, channelManager: { publishProjectionEvent: published }, accountId: '1',
      runtime: {
        runtimeRef: 'runtime-01', profileRef: 'web', accountId: '1', hostGeneration: 7,
        capabilities: ['session.events'], updatedAtMillis: 1,
      },
    })
    const project = (seq: number) => (host as unknown as {
      publishProjectionEvent(value: DshRemoteApiProjectionEvent): Promise<void>
    }).publishProjectionEvent({
      kind: 'session-event', sessionId: 'session-01',
      entry: { event: { type: 'assistant/chunk', seq, time: 1_400 + seq, data: {} } },
    })

    await Promise.all(Array.from({ length: 50 }, (_, seq) => project(seq)))
    await vi.advanceTimersByTimeAsync(0)
    expect(appendSessionEvents).not.toHaveBeenCalled()
    expect(published).toHaveBeenCalledOnce()

    await project(50)
    ;(host as unknown as { clearPendingSessionEventBatches(): void }).clearPendingSessionEventBatches()
    await vi.advanceTimersByTimeAsync(40)
    expect(appendSessionEvents).not.toHaveBeenCalled()
    expect(published).toHaveBeenCalledOnce()
  })

  it('drops Backend and Realtime events for a Session owned by another Arkme account', async () => {
    const appendSessionEvents = vi.fn(async () => ({}))
    const publishProjectionEvent = vi.fn(async () => undefined)
    const host = inertHost(new DshApiProxyAdapter({}), {
      controlPlane: { appendSessionEvents } as unknown as DshRemoteControlPlane,
      sessionOwnership: new MemorySessionOwnership([['session-a', 'account-a']]),
    })
    Object.assign(host, {
      started: true, connected: true, accountId: 'account-b',
      channelManager: { publishProjectionEvent },
      runtime: {
        runtimeRef: 'runtime-b', profileRef: 'web', accountId: 'account-b',
        hostGeneration: 2, capabilities: ['session.events'], updatedAtMillis: 1,
      },
    })

    await (host as unknown as {
      publishProjectionEvent(value: DshRemoteApiProjectionEvent): Promise<void>
    }).publishProjectionEvent({
      kind: 'session-event', sessionId: 'session-a',
      entry: { event: { type: 'assistant/message', seq: 1, time: 1_400, data: {} } },
    })
    await flushLive(host)

    expect(appendSessionEvents).not.toHaveBeenCalled()
    expect(publishProjectionEvent).not.toHaveBeenCalled()
  })

  it('compacts only negotiated history replies and preserves raw archive input and cursors', async () => {
    const apiProxy = new DshApiProxyAdapter({})
    vi.spyOn(apiProxy, 'capabilities').mockReturnValue(['session.history', 'session.history.compact'])
    const event = (type: string, seq: number, extra = {}) => ({ event: { type, seq, time: seq, data: {}, ...extra } })
    const entries = [
      event('assistant/chunk', 1),
      event('assistant/message', 2, { surfaceOp: 'append', sourceEventSeqs: [1] }),
      event('tool/call', 3),
      event('tool/result', 4, { surfaceOp: 'append', sourceEventSeqs: [3] }),
      event('assistant/chunk', 5),
      event('assistant/message', 6, { surfaceOp: { replace: [2] }, sourceEventSeqs: [5] }),
      event('assistant/chunk', 7),
    ]
    const raw = { entries, hasMore: true, nextCursor: 1, projectionAsOfSeq: 7 }
    const history = vi.spyOn(apiProxy, 'history').mockResolvedValue(raw)
    const host = inertHost(apiProxy, {
      sessionOwnership: new MemorySessionOwnership([['session-a', 'account-a']]),
    })
    Object.assign(host, {
      started: true, connected: true, serviceLeaseGeneration: 9, accountId: 'account-a',
      runtime: { runtimeRef: 'runtime-a', profileRef: 'web', accountId: 'account-a',
        hostGeneration: 2, capabilities: ['session.history', 'session.history.compact'], updatedAtMillis: 1 },
    })
    for (const compact of [undefined, false, true]) {
      const response = await host.dispatchAuthorizedRequest({
        protocol: 'dsh.remote', protocol_major: 1, kind: 'request',
        request_ref: `history-${String(compact)}`, host_generation: 2,
        issued_at: 1_000, execute_before: 2_000, operation: 'session.history',
        body: { session_ref: 'session-a', before_seq: 9, limit: 10,
          ...(compact === undefined ? {} : { omit_superseded_chunks: compact }) },
      }, { serviceLeaseGeneration: 9, metadata: {
        senderRole: 'controller', runtimeRef: 'runtime-a', acceptedAtMillis: 1_400,
        targetHostLeaseGeneration: 9,
      } })
      expect(response).toMatchObject({ status: 'completed', result: {
        entries: compact === true ? entries.slice(1) : entries,
        hasMore: true, nextCursor: 1, projectionAsOfSeq: 7,
      } })
    }
    expect(history).toHaveBeenCalledWith({ sessionId: 'session-a', beforeSeq: 9, limit: 10 })
    expect(raw.entries).toHaveLength(7)
  })

  it('rejects a direct request for another account Session without touching DSH', async () => {
    const apiProxy = new DshApiProxyAdapter({})
    vi.spyOn(apiProxy, 'capabilities').mockReturnValue(['session.history'])
    const history = vi.spyOn(apiProxy, 'history')
    const host = inertHost(apiProxy, {
      sessionOwnership: new MemorySessionOwnership([['session-a', 'account-a']]),
      now: () => 1_500,
    })
    Object.assign(host, {
      started: true, connected: true, serviceLeaseGeneration: 9, accountId: 'account-b',
      runtime: {
        runtimeRef: 'runtime-b', profileRef: 'web', accountId: 'account-b',
        hostGeneration: 2, capabilities: ['session.history'], updatedAtMillis: 1,
      },
    })

    await expect(host.dispatchAuthorizedRequest({
      protocol: 'dsh.remote', protocol_major: 1, kind: 'request',
      request_ref: 'request-history-account-b', host_generation: 2,
      issued_at: 1_000, execute_before: 2_000, operation: 'session.history',
      body: { session_ref: 'session-a' },
    }, {
      serviceLeaseGeneration: 9,
      metadata: {
        senderRole: 'controller', runtimeRef: 'runtime-b', acceptedAtMillis: 1_400,
        targetHostLeaseGeneration: 9,
      },
    })).resolves.toMatchObject({ status: 'rejected', error: { code: 'SESSION_NOT_FOUND' } })
    expect(history).not.toHaveBeenCalled()
  })

  it('does not let a stale snapshot claim Sessions after the active account changes', async () => {
    const ownership = new MemorySessionOwnership()
    const apiProxy = new DshApiProxyAdapter({})
    vi.spyOn(apiProxy, 'capabilities').mockReturnValue(['workspace.list', 'session.list'])
    let resolveSnapshot!: (value: Awaited<ReturnType<DshApiProxyAdapter['snapshot']>>) => void
    const pendingSnapshot = new Promise<Awaited<ReturnType<DshApiProxyAdapter['snapshot']>>>(resolve => {
      resolveSnapshot = resolve
    })
    const snapshot = vi.spyOn(apiProxy, 'snapshot').mockImplementation(async () => await pendingSnapshot)
    const host = inertHost(apiProxy, { sessionOwnership: ownership, now: () => 1_500 })
    Object.assign(host, {
      started: true, connected: true, serviceLeaseGeneration: 9, accountId: 'account-a',
      runtime: {
        runtimeRef: 'runtime-a', profileRef: 'web', accountId: 'account-a',
        hostGeneration: 2, capabilities: ['workspace.list', 'session.list'], updatedAtMillis: 1,
      },
    })

    const response = host.dispatchAuthorizedRequest({
      protocol: 'dsh.remote', protocol_major: 1, kind: 'request',
      request_ref: 'request-snapshot-account-a', host_generation: 2,
      issued_at: 1_000, execute_before: 2_000, operation: 'snapshot.get', body: {},
    }, {
      serviceLeaseGeneration: 9,
      metadata: {
        senderRole: 'controller', runtimeRef: 'runtime-a', acceptedAtMillis: 1_400,
        targetHostLeaseGeneration: 9,
      },
    })
    await vi.waitFor(() => { expect(snapshot).toHaveBeenCalledOnce() })
    Object.assign(host, {
      accountId: 'account-b',
      runtime: {
        runtimeRef: 'runtime-b', profileRef: 'web', accountId: 'account-b',
        hostGeneration: 1, capabilities: ['workspace.list', 'session.list'], updatedAtMillis: 2,
      },
    })
    resolveSnapshot({
      projectionAsOfMillis: 1_500,
      workspaces: [],
      sessions: [{
        sessionId: 'late-session', workspaceId: 'workspace-1', updatedAt: 1,
        running: false, blank: false,
      }],
      pendingInteractions: [],
    })

    await expect(response).resolves.toMatchObject({
      status: 'rejected', error: { code: 'HOST_GENERATION_STALE' },
    })
    await expect(ownership.ownerAccountId('late-session')).resolves.toBeUndefined()
  })

  it('implicitly owns a remotely-created Session before DSH executes the create', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-host-create-owner-'))
    const workspace = join(directory, 'workspace')
    await mkdir(workspace)
    const ownership = new MemorySessionOwnership()
    let ownerAtCreate: string | undefined
    const create = vi.fn(async (request: {
      rpcId: string
      payload: { workspaceId: string; sessionId: string }
    }) => {
      ownerAtCreate = await ownership.ownerAccountId(request.payload.sessionId)
      return ok({ sessionId: request.payload.sessionId }, request.rpcId)
    })
    const api: DshPublicApiProxyLike = {
      workspace: { list: async request => ok({
        items: [{ workspaceId: 'workspace-1', path: workspace, title: 'Project', sessionIds: [] }],
      }, request.rpcId) },
      sessions: {
        list: async request => ok({ items: [] }, request.rpcId),
        create,
      },
    }
    const ledger = new DshRemoteCommandLedger(join(directory, 'ledger'), Buffer.alloc(32, 4), { now: () => 1_500 })
    const host = inertHost(new DshApiProxyAdapter(api), {
      ledger,
      sessionOwnership: ownership,
      now: () => 1_500,
    })
    Object.assign(host, {
      started: true, connected: true, serviceLeaseGeneration: 9, accountId: 'account-a', ledger,
      runtime: {
        runtimeRef: 'runtime-a', profileRef: 'web', accountId: 'account-a',
        hostGeneration: 2, capabilities: ['session.create'], updatedAtMillis: 1,
      },
    })

    const response = await host.dispatchAuthorizedRequest({
      protocol: 'dsh.remote', protocol_major: 1, kind: 'request',
      request_ref: 'request-create-account-a', host_generation: 2,
      issued_at: 1_000, execute_before: 2_000, operation: 'session.create',
      body: { workspace_ref: 'workspace-1' },
    }, {
      serviceLeaseGeneration: 9,
      metadata: {
        senderRole: 'controller', runtimeRef: 'runtime-a', acceptedAtMillis: 1_400,
        targetHostLeaseGeneration: 9,
      },
    })

    expect(response).toMatchObject({ status: 'completed', result: { sessionId: expect.any(String) } })
    const sessionId = (response.result as { sessionId: string }).sessionId
    expect(ownerAtCreate).toBe('account-a')
    await expect(ownership.ownerAccountId(sessionId)).resolves.toBe('account-a')
    expect(create).toHaveBeenCalledOnce()
    ledger.close()
  })

  it('uses account/runtime/request idempotency and replays a known DSH rejection without execution', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-host-command-'))
    const workspace = join(directory, 'workspace')
    await mkdir(workspace)
    const prompt = vi.fn(async (request: { rpcId: string }) => ({
      rpcId: request.rpcId,
      result: { ok: false as const, error: { code: 'agent-busy', message: 'busy' } },
    }))
    const api: DshPublicApiProxyLike = {
      workspace: { list: async request => ok({
        items: [{ workspaceId: 'workspace-1', path: workspace, title: 'Project', sessionIds: ['session-1'] }],
      }, request.rpcId) },
      sessions: {
        list: async request => ok({ items: [{ sessionId: 'session-1', updatedAt: 1, running: true, blank: false }] }, request.rpcId),
        prompt,
      },
    }
    const ledger = new DshRemoteCommandLedger(join(directory, 'ledger'), Buffer.alloc(32, 7), { now: () => 1_500 })
    const host = inertHost(new DshApiProxyAdapter(api), {
      ledger,
      now: () => 1_500,
      sessionOwnership: new MemorySessionOwnership([['session-1', '1']]),
    })
    Object.assign(host, {
      accountId: '1', started: true, connected: true, serviceLeaseGeneration: 9, ledger,
      runtime: {
        runtimeRef: 'runtime-01', desktopRef: 'desktop-01', profileRef: 'web', accountId: '1',
        hostGeneration: 7, capabilities: ['session.prompt'], updatedAtMillis: 1,
      },
    })
    const request = {
      protocol: 'dsh.remote', protocol_major: 1, kind: 'request', request_ref: 'request-test-01',
      host_generation: 7, issued_at: 1_000, execute_before: 2_000, operation: 'session.prompt',
      body: { session_ref: 'session-1', mode: 'queue', content: { type: 'text', text: 'hello' } },
    }
    const context = {
      serviceLeaseGeneration: 9,
      metadata: {
        senderRole: 'controller' as const, runtimeRef: 'runtime-01', acceptedAtMillis: 1_400,
        targetHostLeaseGeneration: 9,
      },
    }
    const first = await host.dispatchAuthorizedRequest(request, context)
    const duplicate = await host.dispatchAuthorizedRequest(request, context)
    expect(first).toMatchObject({ status: 'rejected', error: { code: 'SESSION_STATE_CHANGED' } })
    expect(duplicate).toMatchObject({ status: 'rejected', error: { code: 'SESSION_STATE_CHANGED' } })
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(prompt.mock.calls[0]![0]).toMatchObject({ payload: {
      sessionId: 'session-1', mode: 'queue', content: [{ type: 'text', text: 'hello' }],
    } })
    expect(ledger.get({ accountId: '1', runtimeRef: 'runtime-01', requestRef: 'request-test-01' })).toMatchObject({
      accountId: '1', runtimeRef: 'runtime-01', requestRef: 'request-test-01', state: 'completed',
    })
    ledger.close()
  })

  it('returns the stable DSH rpc id used to reconcile the optimistic prompt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-host-prompt-correlation-'))
    const workspace = join(directory, 'workspace')
    await mkdir(workspace)
    const prompt = vi.fn(async (request: { rpcId: string }) => ok({ accepted: true }, request.rpcId))
    const api: DshPublicApiProxyLike = {
      workspace: { list: async request => ok({
        items: [{ workspaceId: 'workspace-1', path: workspace, title: 'Project', sessionIds: ['session-1'] }],
      }, request.rpcId) },
      sessions: {
        list: async request => ok({
          items: [{ sessionId: 'session-1', updatedAt: 1, running: false, blank: false }],
        }, request.rpcId),
        prompt,
      },
    }
    const ledger = new DshRemoteCommandLedger(join(directory, 'ledger'), Buffer.alloc(32, 7), { now: () => 1_500 })
    const host = inertHost(new DshApiProxyAdapter(api), {
      ledger,
      now: () => 1_500,
      sessionOwnership: new MemorySessionOwnership([['session-1', '1']]),
    })
    Object.assign(host, {
      accountId: '1', started: true, connected: true, serviceLeaseGeneration: 9, ledger,
      runtime: {
        runtimeRef: 'runtime-01', desktopRef: 'desktop-01', profileRef: 'web', accountId: '1',
        hostGeneration: 7, capabilities: ['session.prompt'], updatedAtMillis: 1,
      },
    })
    const response = await host.dispatchAuthorizedRequest({
      protocol: 'dsh.remote', protocol_major: 1, kind: 'request', request_ref: 'request-correlation-01',
      host_generation: 7, issued_at: 1_000, execute_before: 2_000, operation: 'session.prompt',
      body: { session_ref: 'session-1', mode: 'queue', content: { type: 'text', text: 'hello' } },
    }, {
      serviceLeaseGeneration: 9,
      metadata: {
        senderRole: 'controller', runtimeRef: 'runtime-01', acceptedAtMillis: 1_400,
        targetHostLeaseGeneration: 9,
      },
    })

    const dshRpcId = prompt.mock.calls[0]![0].rpcId
    expect(response).toMatchObject({
      status: 'completed',
      result: { accepted: true, dsh_rpc_id: dshRpcId },
    })
    ledger.close()
  })

  it('reads and selects a Session model through the ledger and reconciles a crash without replay', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-host-model-command-'))
    const workspace = join(directory, 'workspace')
    await mkdir(workspace)
    let next: { provider: string; model: string; reasoningEffort?: string } | null = null
    const selectModel = vi.fn(async (request: {
      rpcId: string
      payload: { sessionId: string; provider: string; model: string; reasoningEffort?: string }
    }) => {
      next = {
        provider: request.payload.provider,
        model: request.payload.model,
        reasoningEffort: request.payload.reasoningEffort ?? 'high',
      }
      return ok({ selected: next }, request.rpcId)
    })
    const api: DshPublicApiProxyLike = {
      workspace: { list: async request => ok({
        items: [{ workspaceId: 'workspace-1', path: workspace, title: 'Project', sessionIds: ['session-1'] }],
      }, request.rpcId) },
      sessions: {
        list: async request => ok({ items: [{
          sessionId: 'session-1', updatedAt: 1, running: false, blank: false,
          projections: { asOfSeq: 5, values: { modelSelection: { lastUsed: null, next } } },
        }] }, request.rpcId),
        modelCatalog: async request => ok({
          default: { provider: 'deepseek-official', model: 'deepseek-chat' },
          routableProviders: ['deepseek-official', 'arkme-managed'],
          groups: [], failures: [],
        }, request.rpcId),
        selectModel,
      },
    }
    const ledger = new DshRemoteCommandLedger(join(directory, 'ledger'), Buffer.alloc(32, 9), { now: () => 1_500 })
    const host = inertHost(new DshApiProxyAdapter(api), {
      ledger,
      now: () => 1_500,
      sessionOwnership: new MemorySessionOwnership([['session-1', '1']]),
    })
    Object.assign(host, {
      accountId: '1', started: true, connected: true, serviceLeaseGeneration: 9, ledger,
      runtime: {
        runtimeRef: 'runtime-01', desktopRef: 'desktop-01', profileRef: 'web', accountId: '1',
        hostGeneration: 7, capabilities: ['session.model.get', 'session.model.select'], updatedAtMillis: 1,
      },
    })
    const context = {
      serviceLeaseGeneration: 9,
      metadata: {
        senderRole: 'controller' as const, runtimeRef: 'runtime-01', acceptedAtMillis: 1_400,
        targetHostLeaseGeneration: 9,
      },
    }
    const base = {
      protocol: 'dsh.remote', protocol_major: 1, kind: 'request', host_generation: 7,
      issued_at: 1_000, execute_before: 2_000,
    }
    await expect(host.dispatchAuthorizedRequest({
      ...base, request_ref: 'request-model-get', operation: 'session.model.get',
      body: { session_ref: 'session-1' },
    }, context)).resolves.toMatchObject({
      status: 'completed', result: { current: { provider: 'deepseek-official', model: 'deepseek-chat' } },
    })
    const selectRequest = {
      ...base, request_ref: 'request-model-select', operation: 'session.model.select',
      body: {
        session_ref: 'session-1', model_provider: 'arkme-managed', model_id: 'deepseek-v4-flash',
        reasoning_effort: 'max',
      },
    }
    await expect(host.dispatchAuthorizedRequest(selectRequest, context)).resolves.toMatchObject({
      status: 'completed', result: {
        selected: { provider: 'arkme-managed', model: 'deepseek-v4-flash', reasoningEffort: 'max' },
      },
    })
    await expect(host.dispatchAuthorizedRequest(selectRequest, context)).resolves.toMatchObject({
      status: 'duplicate', result: {
        selected: { provider: 'arkme-managed', model: 'deepseek-v4-flash', reasoningEffort: 'max' },
      },
    })
    expect(selectModel).toHaveBeenCalledTimes(1)

    ledger.begin({
      accountId: '1', runtimeRef: 'runtime-01', requestRef: 'request-model-crash',
      operation: 'session.model.select',
      arguments: {
        session_ref: 'session-1', model_provider: 'arkme-managed', model_id: 'deepseek-v4-flash',
        reasoning_effort: 'max',
      },
      executeBeforeMillis: 2_000,
    })
    await (host as unknown as { reconcileUnsettled(): Promise<void> }).reconcileUnsettled()
    expect(ledger.get({
      accountId: '1', runtimeRef: 'runtime-01', requestRef: 'request-model-crash',
    })).toMatchObject({
      state: 'completed',
      payload: { result: { value: { recovered: true, selected: {
        provider: 'arkme-managed', model: 'deepseek-v4-flash',
        reasoningEffort: 'max',
      } } } },
    })
    expect(selectModel).toHaveBeenCalledTimes(1)
    ledger.close()
  })

  it('returns typed rejections for wrong metadata, stale generations, and delayed delivery without DSH execution', async () => {
    const host = inertHost(new DshApiProxyAdapter({}), { now: () => 50_000 })
    Object.assign(host, {
      accountId: '1', started: true, connected: true, serviceLeaseGeneration: 9,
      runtime: { runtimeRef: 'runtime-01', profileRef: 'web', accountId: '1', hostGeneration: 7, capabilities: [], updatedAtMillis: 1 },
    })
    const request = {
      protocol: 'dsh.remote', protocol_major: 1, kind: 'request', request_ref: 'request-test-01',
      host_generation: 7, issued_at: 49_000, execute_before: 60_000, operation: 'capabilities.get', body: {},
    }
    await expect(host.dispatchAuthorizedRequest(request, {
      serviceLeaseGeneration: 9,
      metadata: { senderRole: 'controller', runtimeRef: 'runtime-other', acceptedAtMillis: 49_000, targetHostLeaseGeneration: 9 },
    })).resolves.toMatchObject({ status: 'rejected', error: { code: 'REMOTE_REQUEST_INVALID' } })
    await expect(host.dispatchAuthorizedRequest(request, {
      serviceLeaseGeneration: 8,
      metadata: { senderRole: 'controller', runtimeRef: 'runtime-01', acceptedAtMillis: 49_000, targetHostLeaseGeneration: 8 },
    })).resolves.toMatchObject({ status: 'rejected', error: { code: 'HOST_GENERATION_STALE' } })
    await expect(host.dispatchAuthorizedRequest(request, {
      serviceLeaseGeneration: 9,
      metadata: { senderRole: 'controller', runtimeRef: 'runtime-01', acceptedAtMillis: 1, targetHostLeaseGeneration: 9 },
    })).resolves.toMatchObject({ status: 'rejected', error: { code: 'COMMAND_EXPIRED' } })
    await expect(host.dispatchAuthorizedRequest({ ...request, host_generation: 6 }, {
      serviceLeaseGeneration: 9,
      metadata: { senderRole: 'controller', runtimeRef: 'runtime-01', acceptedAtMillis: 49_000, targetHostLeaseGeneration: 9 },
    })).resolves.toMatchObject({
      status: 'rejected', host_generation: 6, error: { code: 'HOST_GENERATION_STALE' },
    })
  })
})

function liveHost() {
  const adapter = new DshApiProxyAdapter({})
  const published = vi.fn(async (_value: Record<string, unknown>, _ref: string, _timing?: unknown) => undefined)
  const capture = vi.fn(async (_ref: string, _entries: Array<{ event: { seq: number } }>) => undefined)
  const host = inertHost(adapter)
  Object.assign(host, { started: true, connected: true, accountId: '1',
    channelManager: { publishProjectionEvent: published }, turnUpload: { capture },
    runtime: { runtimeRef: 'runtime-01', profileRef: 'web', accountId: '1', hostGeneration: 7,
      capabilities: ['session.events', 'session.history'], updatedAtMillis: 1 },
  })
  const enqueue = (seq: number, sessionId = 'session-01') => (host as unknown as {
    publishProjectionEvent(event: DshRemoteApiProjectionEvent): Promise<void>
  }).publishProjectionEvent({ kind: 'session-event', sessionId,
    entry: { event: { type: seq % 100 === 0 ? 'turn/start' : 'assistant/chunk', seq, time: seq + 1, data: {} } },
  })
  const clear = () => (host as unknown as { clearPendingSessionEventBatches(): void }).clearPendingSessionEventBatches()
  return { host, adapter, published, capture, enqueue, clear }
}

it('awaits capture once, consumes exhausted wire failures and lets the next batch proceed', async () => {
  vi.useFakeTimers()
  const { host, published, capture, enqueue, clear } = liveHost()
  const gate = Promise.withResolvers<void>()
  capture.mockImplementationOnce(async () => { await gate.promise })
  published.mockRejectedValueOnce(new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'ACK failed', true))
  await enqueue(0); await vi.advanceTimersByTimeAsync(0)
  expect(capture).toHaveBeenCalledOnce(); expect(published).not.toHaveBeenCalled()
  for (let seq = 1; seq <= 100; seq++) await enqueue(seq)
  gate.resolve(); await flushLive(host)
  expect(capture.mock.calls.flatMap(([, entries]) => entries.map(e => e.event.seq)))
    .toEqual(Array.from({ length: 101 }, (_, i) => i))
  expect(published).toHaveBeenCalledTimes(3)
  await vi.advanceTimersByTimeAsync(3000)
  expect(capture).toHaveBeenCalledTimes(3)
  clear()
})

it('finishes an old capture without sending after an account epoch change', async () => {
  vi.useFakeTimers()
  const { host, published, capture, enqueue, clear } = liveHost()
  const gate = Promise.withResolvers<void>()
  capture.mockImplementationOnce(async () => { await gate.promise })
  await enqueue(0); await vi.advanceTimersByTimeAsync(0)
  expect(capture).toHaveBeenCalledOnce()
  const internal = host as unknown as { accountGeneration: number }
  internal.accountGeneration++
  gate.resolve(); await flushLive(host)
  expect(published).not.toHaveBeenCalled()
  await enqueue(1); await flushLive(host)
  expect(published).toHaveBeenCalledOnce()
  expect(capture.mock.calls.map(([, entries]) => entries.map(e => e.event.seq))).toEqual([[0], [1]])
  clear()
})

it('replays bounded overflow including a newly observed session using the live ownership policy', async () => {
  vi.useFakeTimers()
  const { host, adapter, capture, enqueue, clear } = liveHost()
  const gate = Promise.withResolvers<void>()
  capture.mockImplementationOnce(async () => { await gate.promise })
  const history = vi.spyOn(adapter, 'history').mockImplementation(async ({ sessionId, beforeSeq }) => {
    const upper = (beforeSeq ?? 4202) - 1
    // A short tail page with gaps forces the Host to shrink a requested forward range.
    const start = Math.max(0, upper - 19)
    return { entries: Array.from({ length: upper - start + 1 }, (_, i) => ({
      event: { type: 'assistant/chunk', seq: start + i, time: start + i + 1, data: {} },
    })), hasMore: start > 0, ...(start > 0 ? { nextCursor: start } : {}),
      ...(beforeSeq === undefined ? { projectionAsOfSeq: sessionId === 'session-02' ? 1 : 4201 } : {}),
    }
  })
  await enqueue(0); await vi.advanceTimersByTimeAsync(0)
  for (let seq = 1; seq <= 4201; seq++) await enqueue(seq)
  await enqueue(0, 'session-02'); await enqueue(1, 'session-02')
  gate.resolve(); await flushLive(host)
  expect(history).toHaveBeenCalled()
  for (const [ref, count] of [['session-01', 4202], ['session-02', 2]] as const) {
    expect(capture.mock.calls.filter(([sessionRef]) => sessionRef === ref).flatMap(([, entries]) => entries.map(e => e.event.seq)))
      .toEqual(Array.from({ length: count }, (_, i) => i))
  }
  clear()
})

it('records delivery stage totals with account correlation only after the report interval', async () => {
  vi.useFakeTimers()
  const { host, published, enqueue, clear } = liveHost()
  const diagnostic = vi.fn()
  Object.assign(host, { diagnostic })
  published.mockImplementation(async (_value, _ref, callback) => {
    (callback as (timing: unknown) => void)({ queueMs: 2, publishMs: 80, completed: true })
  })
  await enqueue(0); await flushLive(host)
  expect(diagnostic).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(10_000)
  ;(host as unknown as { reportLiveDelivery(): void }).reportLiveDelivery()
  expect(diagnostic).toHaveBeenCalledOnce()
  expect(diagnostic).toHaveBeenCalledWith('live_delivery_window', expect.objectContaining({
    user_id: '1', runtime_ref: 'runtime-01', batch_count: 1, event_count: 1, incomplete_batches: 0,
    channel_queue_ms_sum: 2, publish_ack_ms_sum: 80, capture_ms_sum: 0,
  }))
  clear()
  ;(host as unknown as { reportLiveDelivery(): void }).reportLiveDelivery()
  expect(diagnostic).toHaveBeenCalledOnce()
})
