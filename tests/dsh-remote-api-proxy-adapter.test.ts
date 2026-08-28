import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DshApiProxyAdapter, type DshPublicApiProxyLike } from '../src/dsh-remote/api-proxy-adapter.js'
import { dshRemoteFrameByteLengths } from '../src/dsh-remote/realtime-transport.js'
import { dshRemoteOutboundPayloads } from '../src/dsh-remote/transport-fragment.js'
import {
  DSH_REMOTE_MAX_FRAME_BYTES,
  DSH_REMOTE_MAX_PAGE_RESULT_BYTES,
  DSH_REMOTE_MAX_SNAPSHOT_BYTES,
} from '../src/dsh-remote/types.js'

function ok<T>(value: T, rpcId = 'rpc') { return { rpcId, result: { ok: true as const, value } } }

function expectFitsFrames(operation: 'session.list' | 'session.history' | 'snapshot.get', result: unknown): void {
  const response = {
    protocol: 'dsh.remote', protocol_major: 1, kind: 'response', request_ref: 'r'.repeat(128),
    status: 'completed', host_generation: Number.MAX_SAFE_INTEGER, issued_at: Number.MAX_SAFE_INTEGER,
    operation, body: {}, result,
  }
  const sizes = dshRemoteFrameByteLengths({
    target: {
      runtimeRef: 'r'.repeat(128), hostProfileRef: 'p'.repeat(128), hostClientRef: 'c'.repeat(128),
      hostLeaseGeneration: Number.MAX_SAFE_INTEGER,
    },
    commandId: `response_${'r'.repeat(119)}`, direction: 'response', payload: response, senderRole: 'host',
  })
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(DSH_REMOTE_MAX_PAGE_RESULT_BYTES)
  expect(sizes.publish).toBeLessThanOrEqual(DSH_REMOTE_MAX_FRAME_BYTES)
  expect(sizes.event).toBeLessThanOrEqual(DSH_REMOTE_MAX_FRAME_BYTES)
}

function expectFitsFragmentedFrames(operation: 'session.history', result: unknown): void {
  const response = {
    protocol: 'dsh.remote', protocol_major: 1, kind: 'response', request_ref: 'r'.repeat(128),
    status: 'completed', host_generation: Number.MAX_SAFE_INTEGER, issued_at: Number.MAX_SAFE_INTEGER,
    operation, body: {}, result,
  }
  const frames = dshRemoteOutboundPayloads(response, 'response-history-test')
  expect(frames.length).toBeGreaterThan(1)
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(DSH_REMOTE_MAX_SNAPSHOT_BYTES)
  for (const [index, frame] of frames.entries()) {
    const sizes = dshRemoteFrameByteLengths({
      target: {
        runtimeRef: 'r'.repeat(128), hostProfileRef: 'p'.repeat(128), hostClientRef: 'c'.repeat(128),
        hostLeaseGeneration: Number.MAX_SAFE_INTEGER,
      },
      commandId: `response_${'r'.repeat(100)}_${String(index)}`,
      direction: 'response', payload: frame.value as Record<string, unknown>,
      senderRole: 'host',
    })
    expect(sizes.publish).toBeLessThanOrEqual(DSH_REMOTE_MAX_FRAME_BYTES)
    expect(sizes.event).toBeLessThanOrEqual(DSH_REMOTE_MAX_FRAME_BYTES)
  }
}

async function fakeApi(): Promise<{ api: DshPublicApiProxyLike; prompt: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh remote workspace '))
  await mkdir(join(directory, 'project'))
  const prompt = vi.fn(async (request: { rpcId: string }) => ok({ accepted: true as const }, request.rpcId))
  const cancel = vi.fn(async (request: { rpcId: string }) => ok({ accepted: true as const }, request.rpcId))
  return {
    prompt,
    cancel,
    api: {
      workspace: { list: async request => ok({
        items: [{ workspaceId: 'workspace-1', path: join(directory, 'project'), title: 'Project', sessionIds: ['session-1'] }],
        archivedSessionIds: [],
      }, request.rpcId) },
      sessions: {
        list: async request => ok({ items: [{
          sessionId: 'session-1', updatedAt: 100, running: true, blank: false,
          projections: { asOfSeq: 8, values: { title: 'Remote Session' } },
        }] }, request.rpcId),
        create: async request => ok({ sessionId: request.payload.sessionId }, request.rpcId),
        history: async request => ok({
          events: [{ event: { type: 'user/message', seq: 8, time: 100, data: { text: 'hello' } } }],
          hasMore: false, projections: { asOfSeq: 8, values: {} },
        }, request.rpcId),
        prompt,
        cancel,
      },
    },
  }
}

describe('public DSH ApiProxy remote adapter', () => {
  it('feature-detects only public capabilities and projects registered workspaces', async () => {
    const { api } = await fakeApi()
    const adapter = new DshApiProxyAdapter(api)
    expect(adapter.capabilities()).toContain('workspace.list')
    expect(adapter.capabilities()).not.toContain('interaction.approval.respond')
    await expect(adapter.snapshot()).resolves.toMatchObject({
      workspaces: [{ workspaceId: 'workspace-1', available: true }],
      sessions: [{ sessionId: 'session-1', workspaceId: 'workspace-1', title: 'Remote Session' }],
    })
  })

  it('preallocates a stable SessionId and never accepts cwd from the controller', async () => {
    const { api } = await fakeApi()
    const adapter = new DshApiProxyAdapter(api)
    const first = await adapter.createSession({ workspaceId: 'workspace-1', dshRpcId: 'rpc-1' })
    const second = await adapter.createSession({ workspaceId: 'workspace-1', dshRpcId: 'rpc-1' })
    expect(second.sessionId).toBe(first.sessionId)
    expect(first.sessionId).toMatch(/^[a-f0-9-]{36}$/)
    await expect(adapter.createSession({ workspaceId: 'workspace-1', dshRpcId: 'rpc-other-binding' }))
      .resolves.not.toEqual(first)
  })

  it('reconciles a created Session by its deterministic request identity', async () => {
    const { api } = await fakeApi()
    const adapter = new DshApiProxyAdapter(api)
    const created = await adapter.createSession({ workspaceId: 'workspace-1', dshRpcId: 'rpc-1' })
    api.workspace!.list = async request => ok({
      items: [{ workspaceId: 'workspace-1', path: process.cwd(), title: 'Project', sessionIds: [created.sessionId] }],
    }, request.rpcId)
    api.sessions!.list = async request => ok({ items: [{
      sessionId: created.sessionId, updatedAt: 100, running: false, blank: true,
    }] }, request.rpcId)
    await expect(adapter.reconcileCreatedSession({ workspaceId: 'workspace-1', dshRpcId: 'rpc-1' }))
      .resolves.toEqual({ sessionId: created.sessionId })
    await expect(adapter.reconcileCreatedSession({ workspaceId: 'workspace-1', dshRpcId: 'other-rpc' }))
      .resolves.toBeUndefined()
  })

  it('forwards bounded text with explicit queue/steer and rejects attachments and slash commands first', async () => {
    const { api, prompt } = await fakeApi()
    const adapter = new DshApiProxyAdapter(api)
    await adapter.prompt({ sessionId: 'session-1', mode: 'steer', content: [{ type: 'text', text: 'guide now' }], dshRpcId: 'rpc-1' })
    expect(prompt).toHaveBeenCalledWith({ rpcId: 'rpc-1', payload: {
      sessionId: 'session-1', mode: 'steer', content: [{ type: 'text', text: 'guide now' }],
    } })
    await expect(adapter.prompt({
      sessionId: 'session-1', mode: 'queue', content: [{ type: 'image', data: 'secret' }], dshRpcId: 'rpc-2',
    })).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' })
    await expect(adapter.prompt({
      sessionId: 'session-1', mode: 'queue', content: [{ type: 'text', text: '/approve everything' }], dshRpcId: 'rpc-3',
    })).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' })
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('treats cancel on an idle Session as idempotent success', async () => {
    const { api, cancel } = await fakeApi()
    api.sessions!.list = async request => ok({ items: [{ sessionId: 'session-1', updatedAt: 100, running: false, blank: false }] }, request.rpcId)
    const adapter = new DshApiProxyAdapter(api)
    await expect(adapter.cancel({ sessionId: 'session-1', dshRpcId: 'rpc-1' })).resolves.toEqual({ accepted: true })
    expect(cancel).not.toHaveBeenCalled()
  })

  it('fails closed for allowed-once when rc.7 cannot project a complete approval view', async () => {
    const { api } = await fakeApi()
    async function* mux() {
      yield { rpcId: 'approval-rpc', payload: {
        type: 'approval/requested', sessionId: 'session-1', approvalId: 'approval-1', toolName: 'shell', reason: 'run command',
      } }
      await new Promise(() => undefined)
    }
    api.events = { mux: () => mux() }
    api.respond = vi.fn(async () => ({ accepted: true as const }))
    const adapter = new DshApiProxyAdapter(api)
    const stop = adapter.startEvents()
    await vi.waitFor(() => { expect(adapter.pending()).toHaveLength(1) })
    await expect(adapter.answerApproval({
      interactionRpcRef: 'approval-rpc', sessionId: 'session-1', approvalId: 'approval-1', outcome: 'allowed-once',
    })).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' })
    await expect(adapter.answerApproval({
      interactionRpcRef: 'approval-rpc', sessionId: 'session-1', approvalId: 'approval-1', outcome: 'rejected',
    })).resolves.toBeUndefined()
    stop()
  })

  it('forwards the complete public HistoryEntry including content blocks, tool data and view', async () => {
    const { api } = await fakeApi()
    api.sessions!.history = async request => ok({
      events: [
        { event: { type: 'user/message', seq: 1, time: 1, data: {
          content: [
            { type: 'text', text: 'safe text' },
            { type: 'image', data: 'base64-secret-image' },
            { type: 'future-block', raw: 'secret-unknown' },
          ],
          source: { kind: 'user', rpcId: 'remote_exact_rpc', private: 'hidden' },
        } } },
        { event: { type: 'tool/call', seq: 2, time: 2, data: { args: { token: 'secret-tool-args' } } },
          view: { for: 'call' as const, view: { card: 'generic', html: 'secret-view' } } },
      ],
      hasMore: false,
    }, request.rpcId)
    const adapter = new DshApiProxyAdapter(api)
    const page = await adapter.history({ sessionId: 'session-1' })
    expect(page.entries[0]).toEqual({ event: { type: 'user/message', seq: 1, time: 1, data: {
      content: [
        { type: 'text', text: 'safe text' },
        { type: 'image', data: 'base64-secret-image' },
        { type: 'future-block', raw: 'secret-unknown' },
      ],
      source: { kind: 'user', rpcId: 'remote_exact_rpc', private: 'hidden' },
    } } })
    const encoded = JSON.stringify(page)
    expect(encoded).toContain('base64-secret-image')
    expect(encoded).toContain('secret-unknown')
    expect(encoded).toContain('secret-tool-args')
    expect(encoded).toContain('secret-view')
    expect(page.entries[1]?.view).toEqual({ for: 'call', view: { card: 'generic', html: 'secret-view' } })
    expect(adapter.historyContainsRpcId(page.entries, 'remote_exact_rpc')).toBe(true)
    expect(adapter.historyContainsRpcId(page.entries, 'safe text')).toBe(false)
  })

  it('keeps the contiguous raw ApiProxy history interval without confusing source kind with visibility', async () => {
    const { api } = await fakeApi()
    api.sessions!.history = async request => ok({
      events: [
        { event: { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } } },
        { event: { type: 'user/message', seq: 2, time: 2, data: {
          content: [{ type: 'text', text: 'private model context' }],
          source: { kind: 'plugin', plugin: 'system-prompt' },
        } } },
        { event: { type: 'user/message', seq: 3, time: 3, data: {
          content: [{ type: 'text', text: 'human prompt' }],
          source: { kind: 'user', rpcId: 'human-rpc' },
        } } },
        { event: { type: 'tool/call', seq: 4, time: 4, data: { arguments: 'secret' } } },
        { event: { type: 'assistant/message', seq: 5, time: 5, data: {
          turn: 1,
          step: 1,
          message: {
            role: 'assistant',
            content: [{ type: 'reasoning', text: 'private reasoning' }, { type: 'text', text: 'assistant answer' }],
            source: { kind: 'model', provider: 'deepseek', model: 'test' },
          },
        } } },
        { event: { type: 'turn/end', seq: 6, time: 6, data: { turn: 1 } } },
      ],
      hasMore: false,
    }, request.rpcId)
    const adapter = new DshApiProxyAdapter(api)

    const page = await adapter.history({ sessionId: 'session-1' })

    expect(page.hasMore).toBe(false)
    expect(page.entries.map(entry => entry.event.type)).toEqual([
      'turn/start', 'user/message', 'user/message', 'tool/call', 'assistant/message', 'turn/end',
    ])
    expect(page.entries[1]?.event.data).toMatchObject({ source: { kind: 'plugin' } })
    expect(page.entries[4]?.event.data).toMatchObject({
      message: { content: [{ type: 'reasoning', text: 'private reasoning' }, { type: 'text', text: 'assistant answer' }] },
    })
    expect(page.nextCursor).toBeUndefined()
    expect(JSON.stringify(page)).toContain('private model context')
    expect(JSON.stringify(page)).toContain('private reasoning')
    expect(JSON.stringify(page)).toContain('secret')
    expect(JSON.stringify(page)).not.toContain('暂不支持')
  })

  it('paginates list/history/snapshot by item count, cursor and outer-frame budget', async () => {
    const { api } = await fakeApi()
    const sessionIds = Array.from({ length: 50 }, (_, index) => `session-${String(index).padStart(3, '0')}-${'s'.repeat(230)}`)
    api.workspace!.list = async request => ok({ items: [{
      workspaceId: `workspace-${'w'.repeat(240)}`, path: process.cwd(), title: 'Large Project', sessionIds,
    }] }, request.rpcId)
    api.sessions!.list = async request => ok({ items: sessionIds.map((sessionId, index) => ({
      sessionId, updatedAt: 10_000 - index, running: false, blank: false,
      projections: { asOfSeq: index + 1, values: { title: '🙂'.repeat(100) } },
    })) }, request.rpcId)
    api.sessions!.history = async request => ok({
      events: Array.from({ length: 50 }, (_, index) => ({ event: {
        type: 'assistant/message', seq: index + 1, time: index + 1,
        data: { content: [{ type: 'text', text: '四'.repeat(20_000) }] },
      } })),
      hasMore: false,
    }, request.rpcId)
    const adapter = new DshApiProxyAdapter(api)

    const list = await adapter.sessions({ limit: 50 })
    expect(list.items.length).toBeGreaterThan(0)
    expect(list.items.length).toBeLessThan(50)
    expect(list.nextCursor).toBeTruthy()
    expectFitsFrames('session.list', list)
    await expect(adapter.cancel({ sessionId: sessionIds.at(-1)!, dshRpcId: 'rpc-last-page' }))
      .resolves.toEqual({ accepted: true })

    const history = await adapter.history({ sessionId: sessionIds[0]!, limit: 50 })
    expect(history.entries.length).toBeGreaterThan(0)
    expect(history.entries.length).toBeLessThan(50)
    expect(history.nextCursor).toBeTypeOf('number')
    expectFitsFragmentedFrames('session.history', history)

    const snapshot = await adapter.snapshot({ limit: 50 })
    expect(snapshot.nextCursor).toBeTruthy()
    expectFitsFrames('snapshot.get', snapshot)
  })

  it('recovers a failed public event mux with bounded backoff and stop prevents another subscription', async () => {
    const { api } = await fakeApi()
    let calls = 0
    api.events = { mux: (_request, signal) => (async function* () {
      calls++
      if (calls === 1) throw new Error('first mux failed')
      yield { rpcId: 'question-replayed-01', payload: {
        type: 'question/requested', sessionId: 'session-1', questions: [{
          id: 'continue', question: '继续吗？', options: [{ label: '继续' }], private: 'not projected',
        }],
      } }
      await new Promise<void>(resolve => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    })() }
    const adapter = new DshApiProxyAdapter(api, { eventRetryBaseMillis: 10 })
    const stop = adapter.startEvents()
    await vi.waitFor(() => {
      expect(calls).toBe(2)
      expect(adapter.pending()).toMatchObject([{ questions: [{ id: 'continue', question: '继续吗？' }] }])
      expect(JSON.stringify(adapter.pending())).not.toContain('not projected')
    })
    stop()
    await new Promise(resolve => { setTimeout(resolve, 30) })
    expect(calls).toBe(2)
  })

  it('projects real mux session events, baselines and full pending interaction state without mixing their cursors', async () => {
    const { api } = await fakeApi()
    async function* mux() {
      yield { rpcId: 'subscribed-session-01', payload: {
        type: 'session/subscribed', sessionId: 'session-1', lastSeq: 7,
      } }
      yield { rpcId: 'turn-start-01', payload: {
        type: 'session/event', sessionId: 'session-1',
        event: { type: 'turn/start', seq: 8, time: 100, data: { turn: 1 } },
      } }
      yield { rpcId: 'plugin-context-01', payload: {
        type: 'session/event', sessionId: 'session-1',
        event: { type: 'user/message', seq: 9, time: 100, data: {
          content: [{ type: 'text', text: 'private context' }], source: { kind: 'plugin', plugin: 'test' },
        } },
      } }
      yield { rpcId: 'session-event-01', payload: {
        type: 'session/event', sessionId: 'session-1',
        event: { type: 'assistant/message', seq: 10, time: 101, data: {
          message: { content: [{ type: 'text', text: 'live answer' }], source: { kind: 'model' } }, private: 'hidden',
        } },
      } }
      yield { rpcId: 'question-live-01', payload: {
        type: 'question/requested', sessionId: 'session-1', questions: [{ id: 'q', question: '继续吗？' }],
      } }
      await new Promise(() => undefined)
    }
    api.events = { mux: () => mux() }
    const adapter = new DshApiProxyAdapter(api)
    const projected: unknown[] = []
    adapter.subscribeProjectionEvents(event => { projected.push(event) })
    const stop = adapter.startEvents()
    await vi.waitFor(() => { expect(projected).toHaveLength(5) })
    expect(projected[0]).toEqual({
      kind: 'mux-baseline', sessionId: 'session-1', lastSeq: 7, pendingInteractions: [],
    })
    expect(projected[1]).toMatchObject({
      kind: 'session-event', sessionId: 'session-1',
      entry: { event: { type: 'turn/start', seq: 8, data: { turn: 1 } } },
    })
    expect(projected[2]).toMatchObject({
      kind: 'session-event', sessionId: 'session-1',
      entry: { event: { type: 'user/message', seq: 9, data: { source: { kind: 'plugin' } } } },
    })
    expect(projected[3]).toMatchObject({
      kind: 'session-event', sessionId: 'session-1',
      entry: { event: { type: 'assistant/message', seq: 10, data: {
        message: { content: [{ type: 'text', text: 'live answer' }] }, private: 'hidden',
      } } },
    })
    expect(JSON.stringify(projected[3])).toContain('hidden')
    expect(JSON.stringify(projected)).toContain('private context')
    expect(projected[4]).toMatchObject({
      kind: 'interactions', pendingInteractions: [{
        kind: 'question', interactionRpcRef: 'question-live-01', sessionId: 'session-1',
      }],
    })
    stop()
  })

  it('keeps a large live event complete while rejecting a partial oversized question projection', async () => {
    const { api } = await fakeApi()
    async function* mux() {
      yield { rpcId: 'large-event-01', payload: {
        type: 'session/event', sessionId: 'session-1',
        event: { type: 'assistant/message', seq: 9, time: 102, data: {
          content: Array.from({ length: 8 }, (_, index) => ({
            type: 'text', text: `${String(index)}-${'四'.repeat(5_000)}`,
          })),
        } },
      } }
      yield { rpcId: 'large-question-01', payload: {
        type: 'question/requested', sessionId: 'session-1',
        questions: Array.from({ length: 16 }, (_, index) => ({
          id: `question-${String(index)}`, question: '问'.repeat(4_000), detail: '详'.repeat(8_000),
        })),
      } }
      await new Promise(() => undefined)
    }
    api.events = { mux: () => mux() }
    const adapter = new DshApiProxyAdapter(api)
    const projected: unknown[] = []
    adapter.subscribeProjectionEvents(event => { projected.push(event) })
    const stop = adapter.startEvents()
    await vi.waitFor(() => { expect(projected).toHaveLength(1) })
    expect(Buffer.byteLength(JSON.stringify(projected[0]))).toBeGreaterThan(24 * 1024)
    expect(JSON.stringify(projected[0])).toContain(`7-${'四'.repeat(5_000)}`)
    expect(adapter.pending()).toEqual([])
    stop()
  })
})
