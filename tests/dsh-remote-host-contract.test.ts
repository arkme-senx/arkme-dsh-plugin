import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
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

function ok<T>(value: T, rpcId: string) { return { rpcId, result: { ok: true as const, value } } }

function inertHost(apiProxy: DshApiProxyAdapter, input: {
  controlPlane?: DshRemoteControlPlane
  ledger?: DshRemoteCommandLedger
  now?: () => number
} = {}): ArkmeRemoteRealtimeHost {
  return new ArkmeRemoteRealtimeHost({
    featureEnabled: true, profileRef: 'web', hostClientRef: 'host-client-01',
    readSession: async () => undefined,
    secretBroker: {} as DshRemoteRuntimeSecretBroker,
    runtimeStore: {} as DshRemoteRuntimeStore,
    controlPlane: input.controlPlane ?? {} as DshRemoteControlPlane,
    realtime: {} as DshRemoteRealtimeTransport,
    apiProxy,
    ledgerForAccount: () => input.ledger ?? (() => { throw new Error('unused') })(),
    now: input.now ?? (() => 1_500),
  })
}

describe('Arkme remote Host account contract', () => {
  it('persists DSH events to Backend even while Realtime is disconnected', async () => {
    const appendSessionEvents = vi.fn(async () => ({}))
    const host = inertHost(new DshApiProxyAdapter({}), {
      controlPlane: { appendSessionEvents } as unknown as DshRemoteControlPlane,
    })
    Object.assign(host, {
      started: true, connected: false, accountId: '1',
      runtime: {
        runtimeRef: 'runtime-01', desktopRef: 'desktop-01', profileRef: 'web', accountId: '1',
        hostGeneration: 7, capabilities: ['session.events'], updatedAtMillis: 1,
      },
    })

    await (host as unknown as {
      publishProjectionEvent(value: DshRemoteApiProjectionEvent): Promise<void>
    }).publishProjectionEvent({
      kind: 'session-event', sessionId: 'session-01',
      entry: { event: { type: 'user/message', seq: 8, time: 1_400, data: { text: 'offline' } } },
    })

    expect(appendSessionEvents).toHaveBeenCalledOnce()
    expect(appendSessionEvents).toHaveBeenCalledWith(expect.objectContaining({
      runtime_ref: 'runtime-01', session_ref: 'session-01',
    }))
  })

  it('backfills every retained DSH history page before advancing completeness', async () => {
    const apiProxy = new DshApiProxyAdapter({})
    vi.spyOn(apiProxy, 'sessions').mockResolvedValue({
      items: [{
        sessionId: 'session-01', workspaceId: 'workspace-01', updatedAt: 1,
        running: false, blank: false, projectionAsOfSeq: 8,
      }],
    })
    const history = vi.spyOn(apiProxy, 'history')
      .mockResolvedValueOnce({
        entries: [
          { event: { type: 'user/message', seq: 7, time: 7, data: { text: 'newer' } } },
          { event: { type: 'assistant/message', seq: 8, time: 8, data: { text: 'tail' } } },
        ],
        hasMore: true, nextCursor: 7, projectionAsOfSeq: 8,
      })
      .mockResolvedValueOnce({
        entries: [
          { event: { type: 'user/message', seq: 0, time: 0, data: { text: 'oldest' } } },
        ],
        hasMore: false, projectionAsOfSeq: 8,
      })
    const appendSessionEvents = vi.fn(async () => ({}))
    const completeSessionEventHistory = vi.fn(async () => ({}))
    const host = inertHost(apiProxy, {
      controlPlane: {
        sessionEventSyncStatuses: async () => ({
          items: [{
            session_ref: 'session-01', projection_as_of_seq: 8,
            last_event_seq: -1, history_complete_through_seq: -2,
          }],
        }),
        appendSessionEvents,
        completeSessionEventHistory,
      } as unknown as DshRemoteControlPlane,
    })
    Object.assign(host, {
      started: true, accountId: '1',
      runtime: {
        runtimeRef: 'runtime-01', desktopRef: 'desktop-01', profileRef: 'web', accountId: '1',
        hostGeneration: 7, capabilities: ['session.list', 'session.history'], updatedAtMillis: 1,
      },
    })

    await (host as unknown as { reconcileAllHistory(): Promise<void> }).reconcileAllHistory()

    expect(history.mock.calls).toEqual([
      [{ sessionId: 'session-01', limit: 50 }],
      [{ sessionId: 'session-01', limit: 50, beforeSeq: 7 }],
    ])
    expect(appendSessionEvents).toHaveBeenCalledTimes(2)
    expect(completeSessionEventHistory.mock.invocationCallOrder[0]).toBeGreaterThan(
      appendSessionEvents.mock.invocationCallOrder.at(-1)!,
    )
    expect(completeSessionEventHistory).toHaveBeenCalledWith({
      runtime_ref: 'runtime-01', host_generation: 7,
      session_ref: 'session-01', through_seq: 8,
    })
  })

  it('rebuilds completed Turns when raw history is already complete and advances the Turn cut last', async () => {
    const apiProxy = new DshApiProxyAdapter({})
    vi.spyOn(apiProxy, 'sessions').mockResolvedValue({
      items: [{
        sessionId: 'session-turns', workspaceId: 'workspace-01', updatedAt: 1,
        running: false, blank: false, projectionAsOfSeq: 3,
      }],
    })
    vi.spyOn(apiProxy, 'history').mockResolvedValue({
      entries: [
        { event: { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } } },
        { event: { type: 'user/message', seq: 1, time: 1, surfaceOp: 'append', data: {
          id: 'message-1', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }],
        } } },
        { event: { type: 'assistant/message', seq: 2, time: 2, surfaceOp: 'append', data: {
          turn: 1, step: 1, message: { content: [{ type: 'text', text: 'world' }] },
        } } },
        { event: { type: 'turn/end', seq: 3, time: 3, data: { turn: 1, reason: { kind: 'completed' } } } },
      ],
      hasMore: false,
      projectionAsOfSeq: 3,
    })
    const appendSessionEvents = vi.fn(async () => ({}))
    const completeSessionEventHistory = vi.fn(async () => ({}))
    const syncSessionTurns = vi.fn(async () => ({}))
    const completeSessionTurnHistory = vi.fn(async () => ({}))
    const host = inertHost(apiProxy, {
      controlPlane: {
        sessionEventSyncStatuses: async () => ({ items: [{
          session_ref: 'session-turns', projection_as_of_seq: 3,
          last_event_seq: 3, history_complete_through_seq: 3,
          turn_projection_as_of_seq: -1, turn_projection_complete_through_seq: -2,
        }] }),
        appendSessionEvents,
        completeSessionEventHistory,
        syncSessionTurns,
        completeSessionTurnHistory,
      } as unknown as DshRemoteControlPlane,
    })
    Object.assign(host, {
      started: true, accountId: '1',
      runtime: {
        runtimeRef: 'runtime-01', desktopRef: 'desktop-01', profileRef: 'web', accountId: '1',
        hostGeneration: 7, capabilities: ['session.list', 'session.history'], updatedAtMillis: 1,
      },
    })

    await (host as unknown as { reconcileAllHistory(): Promise<void> }).reconcileAllHistory()

    expect(syncSessionTurns).toHaveBeenCalledWith(expect.objectContaining({
      session_ref: 'session-turns',
      items: [expect.objectContaining({
        turn_ref: 'turn:0:3', start_seq: 0, end_seq: 3, status: 'completed',
        nodes: [
          expect.objectContaining({ node_ref: 'message:message-1', kind: 'user' }),
          expect.objectContaining({ node_ref: 'assistant:1:1', kind: 'assistant' }),
        ],
      })],
    }))
    expect(completeSessionTurnHistory.mock.invocationCallOrder[0]).toBeGreaterThan(
      syncSessionTurns.mock.invocationCallOrder[0]!,
    )
    expect(completeSessionTurnHistory).toHaveBeenCalledWith({
      runtime_ref: 'runtime-01', host_generation: 7,
      session_ref: 'session-turns', through_seq: 3,
    })
  })

  it('keeps Turn completeness conservative when retained history contains an orphan turn/end', async () => {
    const apiProxy = new DshApiProxyAdapter({})
    vi.spyOn(apiProxy, 'sessions').mockResolvedValue({
      items: [{
        sessionId: 'session-orphan', workspaceId: 'workspace-01', updatedAt: 1,
        running: false, blank: false, projectionAsOfSeq: 9,
      }],
    })
    vi.spyOn(apiProxy, 'history').mockResolvedValue({
      entries: [
        { event: { type: 'assistant/message', seq: 8, time: 8, surfaceOp: 'append', data: {
          turn: 3, step: 1, message: { content: [{ type: 'text', text: 'retained tail' }] },
        } } },
        { event: { type: 'turn/end', seq: 9, time: 9, data: { turn: 3, reason: { kind: 'completed' } } } },
      ],
      hasMore: false,
      projectionAsOfSeq: 9,
    })
    const completeSessionTurnHistory = vi.fn(async () => ({}))
    const host = inertHost(apiProxy, {
      controlPlane: {
        sessionEventSyncStatuses: async () => ({ items: [{
          session_ref: 'session-orphan', projection_as_of_seq: 9,
          last_event_seq: 9, history_complete_through_seq: 9,
          turn_projection_as_of_seq: -1, turn_projection_complete_through_seq: -2,
        }] }),
        appendSessionEvents: async () => ({}),
        completeSessionEventHistory: async () => ({}),
        syncSessionTurns: async () => ({}),
        completeSessionTurnHistory,
      } as unknown as DshRemoteControlPlane,
    })
    Object.assign(host, {
      started: true, accountId: '1',
      runtime: {
        runtimeRef: 'runtime-01', desktopRef: 'desktop-01', profileRef: 'web', accountId: '1',
        hostGeneration: 7, capabilities: ['session.list', 'session.history'], updatedAtMillis: 1,
      },
    })

    await (host as unknown as { reconcileAllHistory(): Promise<void> }).reconcileAllHistory()

    expect(completeSessionTurnHistory).not.toHaveBeenCalled()
  })

  it('splits one message-bounded DSH page into Backend batches of at most 100 events', async () => {
    const apiProxy = new DshApiProxyAdapter({})
    vi.spyOn(apiProxy, 'sessions').mockResolvedValue({
      items: [{
        sessionId: 'large-session', workspaceId: 'workspace-01', updatedAt: 1,
        running: false, blank: false, projectionAsOfSeq: 200,
      }],
    })
    vi.spyOn(apiProxy, 'history').mockResolvedValue({
      entries: Array.from({ length: 201 }, (_, seq) => ({
        event: { type: 'event', seq, time: seq, data: {} },
      })),
      hasMore: false,
      projectionAsOfSeq: 200,
    })
    const appendSessionEvents = vi.fn(async () => ({}))
    const completeSessionEventHistory = vi.fn(async () => ({}))
    const host = inertHost(apiProxy, {
      controlPlane: {
        sessionEventSyncStatuses: async () => ({ items: [{
          session_ref: 'large-session', projection_as_of_seq: 200,
          last_event_seq: -1, history_complete_through_seq: -2,
        }] }),
        appendSessionEvents,
        completeSessionEventHistory,
      } as unknown as DshRemoteControlPlane,
    })
    Object.assign(host, {
      started: true, accountId: '1',
      runtime: {
        runtimeRef: 'runtime-01', desktopRef: 'desktop-01', profileRef: 'web', accountId: '1',
        hostGeneration: 7, capabilities: ['session.list', 'session.history'], updatedAtMillis: 1,
      },
    })

    await (host as unknown as { reconcileAllHistory(): Promise<void> }).reconcileAllHistory()

    expect(appendSessionEvents.mock.calls.map(call => (call[0].entries as unknown[]).length))
      .toEqual([100, 100, 1])
    expect(completeSessionEventHistory).toHaveBeenCalledWith(expect.objectContaining({
      session_ref: 'large-session', through_seq: 200,
    }))
  })

  it('skips a DSH history traversal already proven complete by Backend', async () => {
    const apiProxy = new DshApiProxyAdapter({})
    vi.spyOn(apiProxy, 'sessions').mockResolvedValue({
      items: [{
        sessionId: 'session-01', workspaceId: 'workspace-01', updatedAt: 1,
        running: false, blank: false, projectionAsOfSeq: 8,
      }],
    })
    const history = vi.spyOn(apiProxy, 'history')
    const completeSessionEventHistory = vi.fn(async () => ({}))
    const host = inertHost(apiProxy, {
      controlPlane: {
        sessionEventSyncStatuses: async () => ({
          items: [{
            session_ref: 'session-01', projection_as_of_seq: 8,
            last_event_seq: 8, history_complete_through_seq: 8,
          }],
        }),
        appendSessionEvents: async () => ({}),
        completeSessionEventHistory,
      } as unknown as DshRemoteControlPlane,
    })
    Object.assign(host, {
      started: true, accountId: '1',
      runtime: {
        runtimeRef: 'runtime-01', desktopRef: 'desktop-01', profileRef: 'web', accountId: '1',
        hostGeneration: 7, capabilities: ['session.list', 'session.history'], updatedAtMillis: 1,
      },
    })

    await (host as unknown as { reconcileAllHistory(): Promise<void> }).reconcileAllHistory()

    expect(history).not.toHaveBeenCalled()
    expect(completeSessionEventHistory).not.toHaveBeenCalled()
  })

  it('marks an empty retained DSH history complete at seq -1', async () => {
    const apiProxy = new DshApiProxyAdapter({})
    vi.spyOn(apiProxy, 'sessions').mockResolvedValue({
      items: [{
        sessionId: 'empty-session', workspaceId: 'workspace-01', updatedAt: 1,
        running: false, blank: true, projectionAsOfSeq: -1,
      }],
    })
    vi.spyOn(apiProxy, 'history').mockResolvedValue({
      entries: [], hasMore: false, projectionAsOfSeq: -1,
    })
    const appendSessionEvents = vi.fn(async () => ({}))
    const completeSessionEventHistory = vi.fn(async () => ({}))
    const host = inertHost(apiProxy, {
      controlPlane: {
        sessionEventSyncStatuses: async () => ({ items: [{
          session_ref: 'empty-session', projection_as_of_seq: -1,
          last_event_seq: -1, history_complete_through_seq: -2,
        }] }),
        appendSessionEvents,
        completeSessionEventHistory,
      } as unknown as DshRemoteControlPlane,
    })
    Object.assign(host, {
      started: true, accountId: '1',
      runtime: {
        runtimeRef: 'runtime-01', desktopRef: 'desktop-01', profileRef: 'web', accountId: '1',
        hostGeneration: 7, capabilities: ['session.list', 'session.history'], updatedAtMillis: 1,
      },
    })

    await (host as unknown as { reconcileAllHistory(): Promise<void> }).reconcileAllHistory()

    expect(appendSessionEvents).not.toHaveBeenCalled()
    expect(completeSessionEventHistory).toHaveBeenCalledWith(expect.objectContaining({
      session_ref: 'empty-session', through_seq: -1,
    }))
  })

  it('does not advance completeness when DSH history pagination loops', async () => {
    const apiProxy = new DshApiProxyAdapter({})
    vi.spyOn(apiProxy, 'sessions').mockResolvedValue({
      items: [{
        sessionId: 'session-loop', workspaceId: 'workspace-01', updatedAt: 1,
        running: false, blank: false, projectionAsOfSeq: 8,
      }],
    })
    const history = vi.spyOn(apiProxy, 'history')
      .mockResolvedValueOnce({
        entries: [{ event: { type: 'event', seq: 7, time: 7, data: {} } }],
        hasMore: true, nextCursor: 7, projectionAsOfSeq: 8,
      })
      .mockResolvedValueOnce({
        entries: [{ event: { type: 'event', seq: 6, time: 6, data: {} } }],
        hasMore: true, nextCursor: 7, projectionAsOfSeq: 8,
      })
    const completeSessionEventHistory = vi.fn(async () => ({}))
    const host = inertHost(apiProxy, {
      controlPlane: {
        sessionEventSyncStatuses: async () => ({ items: [{
          session_ref: 'session-loop', projection_as_of_seq: 8,
          last_event_seq: -1, history_complete_through_seq: -2,
        }] }),
        appendSessionEvents: async () => ({}),
        completeSessionEventHistory,
      } as unknown as DshRemoteControlPlane,
    })
    Object.assign(host, {
      started: true, accountId: '1',
      runtime: {
        runtimeRef: 'runtime-01', desktopRef: 'desktop-01', profileRef: 'web', accountId: '1',
        hostGeneration: 7, capabilities: ['session.list', 'session.history'], updatedAtMillis: 1,
      },
    })

    let failure: unknown
    try {
      await (host as unknown as { reconcileAllHistory(): Promise<void> }).reconcileAllHistory()
    } catch (error) {
      failure = error
    }
    expect(history.mock.calls.map(call => call[0].beforeSeq)).toEqual([undefined, 7])
    expect(failure).toMatchObject({ code: 'REMOTE_INVALID_RESPONSE' })
    expect(completeSessionEventHistory).not.toHaveBeenCalled()
  })

  it('does not project a late old-account history failure onto the new account', async () => {
    const apiProxy = new DshApiProxyAdapter({})
    let rejectSessions!: (error: unknown) => void
    vi.spyOn(apiProxy, 'sessions').mockImplementation(async () => await new Promise((_, reject) => {
      rejectSessions = reject
    }))
    const host = inertHost(apiProxy)
    Object.assign(host, {
      started: true, accountId: '1',
      runtime: {
        runtimeRef: 'runtime-01', desktopRef: 'desktop-01', profileRef: 'web', accountId: '1',
        hostGeneration: 7, capabilities: ['session.list', 'session.history'], updatedAtMillis: 1,
      },
    })

    const reconciliation = (host as unknown as {
      reconcileAllHistorySafely(): Promise<void>
    }).reconcileAllHistorySafely()
    Object.assign(host, {
      accountId: '2',
      runtime: {
        runtimeRef: 'runtime-02', desktopRef: 'desktop-02', profileRef: 'web', accountId: '2',
        hostGeneration: 1, capabilities: ['session.list', 'session.history'], updatedAtMillis: 2,
      },
    })
    rejectSessions(new DshRemoteError('REMOTE_NETWORK_UNAVAILABLE', 'old account failed', true))
    await reconciliation

    expect(host.getStatus()).toMatchObject({ accountId: '2', runtimeRef: 'runtime-02' })
    expect(host.getStatus().unavailableReason).not.toBe('old account failed')
  })

  it('maps public ApiProxy events to Backend history and Runtime channel projections', async () => {
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
    }
    await project({
      kind: 'session-event', sessionId: 'session-01',
      entry: { event: { type: 'assistant/message', seq: 8, time: 1_400, data: {
        content: [{ type: 'text', text: 'answer' }], source: { kind: 'assistant' },
      } } },
    })
    expect(appendSessionEvents).toHaveBeenCalledWith(expect.objectContaining({
      runtime_ref: 'runtime-01', host_generation: 7, session_ref: 'session-01',
    }))
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

  it('syncs a newly-created session row before retrying its first Backend event append', async () => {
    const publishProjectionEvent = vi.fn(async () => undefined)
    const appendSessionEvents = vi.fn()
      .mockRejectedValueOnce(new DshRemoteError(
        'REMOTE_NOT_FOUND',
        'missing session projection',
      ))
      .mockResolvedValueOnce({})
    const host = inertHost(new DshApiProxyAdapter({}), {
      controlPlane: { appendSessionEvents } as unknown as DshRemoteControlPlane,
    })
    const syncProjectionSnapshot = vi.fn(async () => undefined)
    Object.assign(host, {
      started: true,
      connected: true,
      channelManager: { publishProjectionEvent },
      accountId: '1',
      syncProjectionSnapshot,
      runtime: {
        runtimeRef: 'runtime-01', profileRef: 'web', accountId: '1', hostGeneration: 7,
        capabilities: ['session.events'], updatedAtMillis: 1,
      },
    })

    await (host as unknown as {
      publishProjectionEvent(value: DshRemoteApiProjectionEvent): Promise<void>
    }).publishProjectionEvent({
      kind: 'session-event',
      sessionId: 'new-session',
      entry: { event: { type: 'assistant/message', seq: 0, time: 1_400, data: {} } },
    })

    expect(syncProjectionSnapshot).toHaveBeenCalledOnce()
    expect(syncProjectionSnapshot).toHaveBeenCalledWith(true)
    expect(appendSessionEvents).toHaveBeenCalledTimes(2)
    expect(publishProjectionEvent).toHaveBeenCalledOnce()
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
    const host = inertHost(new DshApiProxyAdapter(api), { ledger, now: () => 1_500 })
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

  it('rejects wrong account-channel metadata, stale lease, and delayed delivery before DSH execution', async () => {
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
    })).rejects.toMatchObject({ code: 'REMOTE_REQUEST_INVALID' })
    await expect(host.dispatchAuthorizedRequest(request, {
      serviceLeaseGeneration: 8,
      metadata: { senderRole: 'controller', runtimeRef: 'runtime-01', acceptedAtMillis: 49_000, targetHostLeaseGeneration: 8 },
    })).rejects.toMatchObject({ code: 'HOST_GENERATION_STALE' })
    await expect(host.dispatchAuthorizedRequest(request, {
      serviceLeaseGeneration: 9,
      metadata: { senderRole: 'controller', runtimeRef: 'runtime-01', acceptedAtMillis: 1, targetHostLeaseGeneration: 9 },
    })).rejects.toMatchObject({ code: 'COMMAND_EXPIRED' })
  })
})
