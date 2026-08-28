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
