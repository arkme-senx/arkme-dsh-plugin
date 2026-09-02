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
  })
}

afterEach(() => { vi.useRealTimers() })

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

  it('continues backfilling later sessions after one retained history is corrupt', async () => {
    const apiProxy = new DshApiProxyAdapter({})
    vi.spyOn(apiProxy, 'sessions').mockResolvedValue({
      items: [
        {
          sessionId: 'session-corrupt', workspaceId: 'workspace-01', updatedAt: 2,
          running: false, blank: false, projectionAsOfSeq: 8,
        },
        {
          sessionId: 'session-good', workspaceId: 'workspace-01', updatedAt: 1,
          running: false, blank: false, projectionAsOfSeq: 3,
        },
      ],
    })
    vi.spyOn(apiProxy, 'history').mockImplementation(async input => {
      if (input.sessionId === 'session-corrupt') {
        throw new DshRemoteError('REMOTE_INVALID_RESPONSE', 'corrupt history', true)
      }
      return {
        entries: [{ event: { type: 'user/message', seq: 3, time: 3, data: { text: 'good' } } }],
        hasMore: false,
        projectionAsOfSeq: 3,
      }
    })
    const appendSessionEvents = vi.fn(async () => ({}))
    const completeSessionEventHistory = vi.fn(async () => ({}))
    const host = inertHost(apiProxy, {
      controlPlane: {
        sessionEventSyncStatuses: async () => ({ items: [
          {
            session_ref: 'session-corrupt', projection_as_of_seq: 8,
            last_event_seq: -1, history_complete_through_seq: -2,
          },
          {
            session_ref: 'session-good', projection_as_of_seq: 3,
            last_event_seq: -1, history_complete_through_seq: -2,
          },
        ] }),
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

    await expect(
      (host as unknown as { reconcileAllHistory(): Promise<void> }).reconcileAllHistory(),
    ).rejects.toMatchObject({ code: 'REMOTE_INVALID_RESPONSE' })
    expect(appendSessionEvents).toHaveBeenCalledOnce()
    expect(appendSessionEvents).toHaveBeenCalledWith(expect.objectContaining({
      session_ref: 'session-good',
    }))
    expect(completeSessionEventHistory).toHaveBeenCalledWith(expect.objectContaining({
      session_ref: 'session-good', through_seq: 3,
    }))
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

  it('batches ordered live chunks without waiting for Backend history latency', async () => {
    vi.useFakeTimers()
    const pendingAppends: Array<() => void> = []
    const appendSessionEvents = vi.fn(async () => await new Promise<void>(resolve => {
      pendingAppends.push(resolve)
    }))
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

    expect(appendSessionEvents).toHaveBeenCalledOnce()
    expect(appendSessionEvents).toHaveBeenCalledWith(expect.objectContaining({
      entries: [
        expect.objectContaining({ event: expect.objectContaining({ seq: 8 }) }),
        expect.objectContaining({ event: expect.objectContaining({ seq: 9 }) }),
        expect.objectContaining({ event: expect.objectContaining({ seq: 10 }) }),
      ],
    }))
    expect((appendSessionEvents.mock.calls[0]![0].entries as Array<Record<string, unknown>>)
      .every(entry => !Object.hasOwn(entry, 'presentation'))).toBe(true)
    expect(published).toHaveBeenCalledOnce()
    expect(published).toHaveBeenCalledWith(expect.objectContaining({
      session_seq: 10,
      body: expect.objectContaining({ presentation_version: 1, entries: expect.arrayContaining([
        expect.objectContaining({ event: expect.objectContaining({ seq: 8 }) }),
        expect.objectContaining({ event: expect.objectContaining({ seq: 10 }) }),
      ]) }),
    }), expect.any(String))
    for (const resolve of pendingAppends) resolve()
  })

  it('keeps live batches independent across Sessions', async () => {
    vi.useFakeTimers()
    const appendSessionEvents = vi.fn(async () => await new Promise<void>(() => undefined))
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

    expect(appendSessionEvents).toHaveBeenCalledOnce()
    expect((appendSessionEvents.mock.calls[0]![0].entries as Array<{ event: { seq: number } }>).map(item => item.event.seq))
      .toEqual([8, 9, 10])
    expect(published).toHaveBeenCalledOnce()
    expect(published).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ run_state: 'running', presentation_version: 1 }),
    }), expect.any(String))
    await vi.advanceTimersByTimeAsync(40)
    expect(appendSessionEvents).toHaveBeenCalledOnce()
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

    expect(appendSessionEvents).toHaveBeenCalledOnce()
    expect(published).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(40)
    expect(appendSessionEvents).toHaveBeenCalledOnce()
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
    expect(appendSessionEvents).toHaveBeenCalledOnce()
    expect((appendSessionEvents.mock.calls[0]![0].entries as unknown[])).toHaveLength(50)
    expect(published).toHaveBeenCalledOnce()

    await project(50)
    ;(host as unknown as { clearPendingSessionEventBatches(): void }).clearPendingSessionEventBatches()
    await vi.advanceTimersByTimeAsync(40)
    expect(appendSessionEvents).toHaveBeenCalledOnce()
    expect(published).toHaveBeenCalledOnce()
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

    await vi.waitFor(() => {
      expect(syncProjectionSnapshot).toHaveBeenCalledOnce()
      expect(appendSessionEvents).toHaveBeenCalledTimes(2)
    })
    expect(syncProjectionSnapshot).toHaveBeenCalledWith(true)
    expect(publishProjectionEvent).toHaveBeenCalledOnce()
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

    expect(appendSessionEvents).not.toHaveBeenCalled()
    expect(publishProjectionEvent).not.toHaveBeenCalled()
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
