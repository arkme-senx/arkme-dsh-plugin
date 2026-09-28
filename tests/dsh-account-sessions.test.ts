import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DshNativeHistoryCache } from '../src/dsh-remote/native-history-cache.js'
import { DshRemoteFragmentReader } from '../src/dsh-remote/transport-fragment.js'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createArkmeHostApi } from '../src/host-api.js'
import { describe, expect, it, vi } from 'vitest'
import { DshAccountSessions } from '../src/dsh-remote/account-sessions.js'
import { dshRemoteOutboundPayloads } from '../src/dsh-remote/transport-fragment.js'
import type { DshRemoteRealtimeTransport, DshRemoteTrustedEventMetadata } from '../src/dsh-remote/types.js'
import { ArkmeSdk } from '../src/sdk/index.js'
import { accountSessionTools } from '../src/dsh-remote/account-session-tools.js'
import { ArkmePluginError } from '../src/arkme-service.js'

function fixture(online = true, historyCache?: DshNativeHistoryCache, localSession?: (runtime: string, session: string) => boolean) {
  let receive: Parameters<DshRemoteRealtimeTransport['subscribe']>[0]['onEvent'] | undefined
  const metadata: DshRemoteTrustedEventMetadata = { senderRole: 'host', runtimeRef: 'runtime-remote', acceptedAtMillis: Date.now(), targetHostLeaseGeneration: 8 }
  const transport: DshRemoteRealtimeTransport = {
    connect: vi.fn(async () => {}), disconnect: vi.fn(async () => {}), revalidate: vi.fn(), subscribeDisconnect: vi.fn(() => () => {}),
    registerHost: vi.fn(async () => ({ serviceLeaseGeneration: 1 })), unregisterHost: vi.fn(async () => {}),
    subscribe: vi.fn(async input => { receive = input.onEvent; return () => {} }),
    publish: vi.fn(async input => {
      receive?.({ protocol: 'dsh.remote', protocol_major: 1, kind: 'response', request_ref: input.payload.request_ref, operation: input.payload.operation, host_generation: 3, status: 'completed', result: input.payload.operation === 'session.history' ? { entries: [], hasMore: false } : { accepted: true } }, metadata)
      return { sequence: 1 }
    }),
  }
  const post = vi.fn(async (path: string, body?: Record<string, unknown>, _signal?: AbortSignal) => {
    if (path.endsWith('/sessions/execution')) return { runtime_ref: body?.runtime_ref, session_ref: body?.session_ref }
    if (path.endsWith('/desktops/list')) return { desktops: [{ desktop: { desktop_ref: 'desktop-remote', display_name: '旧电脑' }, runtimes: [{ runtime: { runtime_ref: 'runtime-remote', profile_ref: 'default', host_client_ref: 'secret-routing-client', host_generation: 3, capabilities: ['session.native', 'session.native.history'] }, presence: { presence: online ? 'online' : 'offline', lease_generation: online ? 8 : 0 } }] }] }
    if (path.endsWith('/sessions/account-list')) return { items: [{ runtime_ref: 'runtime-remote', session_ref: 'same-session', workspace_ref: '', title: '云端会话', source_updated_at: 1 }], next_cursor: { updated_at: 1, session_ref: 'same-session', runtime_ref: 'runtime-remote' } }
    if (path.endsWith('/session-turns/list')) return { items: [{ nodes: [{ node_ref: 'message:1', kind: 'user', anchor_seq: 1, ordinal: 0, data: { content: [{ type: 'text', text: '历史正文' }] } }] }], complete: true }
    throw new Error(path)
  })
  const requireAccount = vi.fn(async () => '3016')
  const directory = new DshAccountSessions({ request: { post }, requireAccount, localSession, ...(historyCache ? { historyCache } : {}), transport, connected: signal => transport.connect({ profileRef: 'controller-profile', clientRef: 'controller', signal }), localStatus: () => ({ contractVersion: 1, available: true, enabled: true, connected: true, runtimeRef: 'runtime-local', hostGeneration: 1, capabilities: [], revision: 1 }) })
  return { directory, post, transport, requireAccount, emit: (payload: Record<string, unknown>, overrides: Partial<DshRemoteTrustedEventMetadata> = {}) => receive?.(payload, { ...metadata, ...overrides }) }
}

describe('account DSH directory and controller', () => {
  it('opts in to canonical tombstones without requiring a deleted runtime to remain discoverable', async () => {
    const f = fixture(), original = f.post.getMockImplementation()!
    f.post.mockImplementation(async (path, body, signal) => path.endsWith('/sessions/account-list') ? {
      includes_deleted: true,
      items: [{ runtime_ref: 'deleted-runtime', session_ref: 'deleted-session', workspace_ref: '', source_updated_at: 10, host_generation: 3, projection_at: 20, deleted_at: 21 }],
    } as never : original(path, body, signal))
    const page = await f.directory.list({ includeDeleted: true })
    expect(f.post).toHaveBeenCalledWith('/api/v1/dsh-remote/sessions/account-list', { limit: 50, include_deleted: true }, expect.any(AbortSignal))
    expect(page).toMatchObject({ includesDeleted: true, items: [{ runtimeRef: 'deleted-runtime', sessionRef: 'deleted-session', deleted: true, directoryVersion: [3, 20] }] })
    expect(f.transport.connect).not.toHaveBeenCalled()
    f.directory.close()
  })
  it('uses page workspaces without per-runtime lookups, including an empty server join', async () => {
    const f = fixture(), original = f.post.getMockImplementation()!
    let workspaces: Record<string, unknown>[] = [{ runtime_ref: 'runtime-remote', workspace_ref: 'w', title: '当前工作区' }, { runtime_ref: 'different-runtime', workspace_ref: 'w', title: '不能串用' }]
    f.post.mockImplementation(async path => path.endsWith('/sessions/account-list') ? {
      items: [{ runtime_ref: 'runtime-remote', session_ref: 'same-session', workspace_ref: 'w', source_updated_at: 1 }], workspaces,
    } as never : original(path))
    expect((await f.directory.list()).items[0].workspaceName).toBe('当前工作区')
    workspaces = []
    expect((await f.directory.list()).items[0].workspaceName).toBe('工作区信息暂不可用')
    expect(f.post.mock.calls.some(([path]) => path.endsWith('/workspaces/list'))).toBe(false)
    f.directory.close()
  })
  it('keeps the canonical address but uses native identity for a verified shared local session', async () => {
    const f = fixture(true, undefined, (runtime, session) => runtime === 'runtime-remote' && session === 'same-session')
    expect((await f.directory.list()).items[0]).toMatchObject({ runtimeRef: 'runtime-remote', local: true, localTakeover: true })
    f.directory.close()
  })
  it.each([true, false])('routes a taken-over session with directory loaded=%s', async loaded => {
    const f = fixture(), original = f.post.getMockImplementation()!
    f.post.mockImplementation(async path => path.endsWith('/sessions/account-list') ? {
      items: [{ runtime_ref: 'runtime-original', executor_runtime_ref: 'runtime-remote', session_ref: 'same-session', workspace_ref: '', source_updated_at: 1 }],
    } as never : path.endsWith('/sessions/execution') ? { executor_runtime_ref: 'runtime-remote' } as never : original(path))
    if (loaded) await f.directory.list()
    await f.directory.native({ runtimeRef: 'runtime-original', sessionRef: 'same-session', requestRef: 'cold-follow', body: {
      mode: 'pull', streamRef: 'cold-follow', endpoint: 'session/follow',
      payload: { args: { request: { address: { kind: 'session', sessionId: 'same-session' } } } },
    } })
    await f.directory.command({runtimeRef: 'runtime-original', sessionRef: 'same-session', operation: 'session.cancel', requestRef: 'handoff-command'})
    expect(f.transport.publish).toHaveBeenCalledWith(expect.objectContaining({target: expect.objectContaining({runtimeRef: 'runtime-remote'})}))
    await f.directory.read({runtimeRef: 'runtime-original', sessionRef: 'same-session'})
    expect(f.post).toHaveBeenCalledWith('/api/v1/dsh-remote/session-turns/list', expect.objectContaining({runtime_ref: 'runtime-original'}), expect.any(AbortSignal))
    f.directory.close()
  })

  it('keeps runtime identity, includes ungrouped sessions, and hides private routing fields', async () => {
    const f = fixture()
    const page = await f.directory.list()
    expect(page).toMatchObject({ contractVersion: 1, items: [{ runtimeRef: 'runtime-remote', sessionRef: 'same-session', workspaceRef: '', local: false, desktopName: '旧电脑', sameDesktop: false, runtimeName: 'default' }] })
    expect(JSON.stringify(page)).not.toContain('secret-routing-client')
    expect(f.post).toHaveBeenCalledWith('/api/v1/dsh-remote/sessions/account-list', { limit: 50 }, expect.any(AbortSignal))
    await f.directory.list({ limit: 2, cursor: page.nextCursor, runtime_ref: 'must-not-filter', user_id: 999 })
    expect(f.post).toHaveBeenCalledWith('/api/v1/dsh-remote/sessions/account-list', { limit: 2, cursor: page.nextCursor }, expect.any(AbortSignal))
    expect(f.transport.connect).not.toHaveBeenCalled()
    const tool = accountSessionTools(f.directory).find(tool => tool.name === 'arkme_dsh_sessions')!
    const value = await tool.execute({}, { signal: new AbortController().signal } as never)
    expect(JSON.parse(String(value))).toEqual(page)
  })

  it('compares stable desktop identities even when names match and the local instance has no sessions', async () => {
    const f = fixture()
    const post = f.post.getMockImplementation()!
    f.post.mockImplementation(async path => path.endsWith('/desktops/list') ? {
      desktops: ['local', 'remote'].map(desktop => ({
        desktop: { desktop_ref: `desktop-${desktop}`, display_name: '同名电脑' },
        runtimes: (desktop === 'local' ? ['local', 'sibling'] : ['remote']).map(runtime => ({
          runtime: { runtime_ref: `runtime-${runtime}`, profile_ref: runtime, host_client_ref: 'client', host_generation: 1 },
          presence: { presence: 'online', lease_generation: 1 },
        })),
      })),
    } as never : path.endsWith('/sessions/account-list') ? {
      items: ['sibling', 'remote'].map(runtime => ({ runtime_ref: `runtime-${runtime}`, session_ref: 'session', workspace_ref: '', source_updated_at: 1 })),
    } as never : post(path))
    const page = await f.directory.list()
    expect(page.items.map(row => [row.runtimeName, row.sameDesktop, row.local])).toEqual([
      ['sibling', true, false], ['remote', false, false],
    ])
  })

  it('reads durable offline history without connecting to or executing on another Host', async () => {
    const f = fixture(false)
    const history = await f.directory.read({ runtimeRef: 'runtime-remote', sessionRef: 'same-session' })
    expect(history.nodes).toHaveLength(1)
    expect(history).toMatchObject({ complete: true, online: false })
    await expect(f.directory.command({ runtimeRef: 'runtime-remote', sessionRef: 'same-session', operation: 'session.cancel', requestRef: 'request-0001' })).rejects.toMatchObject({ code: 'RUNTIME_OFFLINE' })
    expect(f.transport.connect).not.toHaveBeenCalled()
  })

  it('rejects unknown account runtimes and routes a valid command with exact writer and lease generations', async () => {
    const f = fixture()
    await expect(f.directory.command({ runtimeRef: 'other-account', sessionRef: 'same-session' })).rejects.toMatchObject({ code: 'REMOTE_NOT_FOUND' })
    await expect(f.directory.command({ runtimeRef: 'runtime-remote', sessionRef: 'same-session', operation: 'session.cancel', requestRef: 'request-0001', body: { session_ref: 'forged' } })).resolves.toEqual({ accepted: true })
    expect(f.transport.publish).toHaveBeenCalledWith(expect.objectContaining({ target: { runtimeRef: 'runtime-remote', hostProfileRef: 'default', hostClientRef: 'secret-routing-client', hostLeaseGeneration: 8 }, payload: expect.objectContaining({ host_generation: 3, body: { session_ref: 'same-session' } }) }))
    expect(f.transport.registerHost).not.toHaveBeenCalled()
    expect(f.transport.disconnect).not.toHaveBeenCalled()
  })

  it('shares an observed runtime connection with requests and releases it on disposal', async () => {
    const f = fixture(), controller = new AbortController(), changed = vi.fn()
    const watch = f.directory.observe({ runtimeRef: 'runtime-remote', sessionRef: 'same-session' }, controller.signal, changed)
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce())
    await f.directory.read({ runtimeRef: 'runtime-remote', sessionRef: 'same-session' })
    expect(f.transport.connect).toHaveBeenCalledOnce()
    expect(f.transport.disconnect).not.toHaveBeenCalled()
    const event = { protocol: 'dsh.remote', protocol_major: 1, kind: 'event', host_generation: 3, body: { session_ref: 'same-session' } }
    f.emit(event, { runtimeRef: 'other-runtime' }); f.emit(event, { senderRole: 'controller' }); f.emit(event, { targetHostLeaseGeneration: 9 }); f.emit({ ...event, host_generation: 4 })
    expect(changed).toHaveBeenCalledOnce()
    f.emit(event); expect(changed).toHaveBeenCalledTimes(2)
    controller.abort(); await watch
    expect(f.transport.disconnect).not.toHaveBeenCalled()
  })

  it('account disposal invalidates in-flight reads even when an HTTP adapter ignores cancellation', async () => {
    const f = fixture()
    let resolve!: (value: Record<string, unknown>) => void
    f.post.mockImplementationOnce(() => new Promise<Record<string, unknown>>(done => { resolve = done }) as never)
    const pending = f.directory.list()
    await vi.waitFor(() => expect(f.post).toHaveBeenCalled())
    f.directory.close(); resolve({ items: [] })
    await expect(pending).rejects.toThrow('会话账号已切换')
  })

  it('reassembles out-of-order typed history and rejects conflicting or oversized fragments', () => {
    const value = { protocol: 'dsh.remote', body: { text: '正文'.repeat(30_000) } }
    const frames = dshRemoteOutboundPayloads(value, 'test').map(frame => frame.value as Record<string, unknown>)
    const reader = new DshRemoteFragmentReader()
    let result: unknown
    for (const frame of [...frames].reverse()) result = reader.accept(frame)
    expect(result).toEqual(value)
    const conflict = new DshRemoteFragmentReader()
    conflict.accept(frames[0]!)
    expect(() => conflict.accept({ ...frames[0], chunk: Buffer.from('changed').toString('base64url') })).toThrow('冲突')
    expect(() => new DshRemoteFragmentReader().accept({ ...frames[0], payload_bytes: 64 * 1024 * 1024 + 1 })).toThrow('无效')
  })

  it('bounds a shared fragment reader by 128 transfers and total reservations, releasing only a failed transfer', () => {
    const frames = Array.from({ length: 129 }, (_, id) => dshRemoteOutboundPayloads({ id, items: [] }, String(id)).map(frame => frame.value as Record<string, unknown>))
    const reader = new DshRemoteFragmentReader(128)
    for (const pair of frames.slice(0, 128)) expect(reader.accept(pair[0]!)).toBeUndefined()
    expect(() => reader.accept(frames[128]![0]!)).toThrow('超过接收上限')
    expect(() => reader.accept({ ...frames[0]![0], chunk: '*' })).toThrow('无效')
    expect(reader.accept(frames[128]![0]!)).toBeUndefined()
    expect(reader.accept(frames[128]![1]!)).toEqual({ id: 128, items: [] })
    expect(reader.accept(frames[1]![1]!)).toEqual({ id: 1, items: [] })

    const budget = new DshRemoteFragmentReader(128)
    budget.accept({ ...frames[0]![0], payload_bytes: 64 * 1024 * 1024 })
    expect(() => budget.accept(frames[1]![0]!)).toThrow('超过接收上限')
    expect(() => budget.accept({ ...frames[0]![0], payload_bytes: 0 })).toThrow('无效')
    budget.accept(frames[1]![0]!)
    expect(budget.accept(frames[1]![1]!)).toEqual({ id: 1, items: [] })
  })

  it('SDK validates contract version and cancellation closes the event stream', async () => {
    let request: RequestInit | undefined
    const sdk = new ArkmeSdk({ fetchImpl: vi.fn(async (_url, init) => { request = init; return new Response(JSON.stringify({ ok: true, value: { contractVersion: 2, items: [] } })) }) as typeof fetch })
    await expect(sdk.listDshAccountSessions()).rejects.toThrow('版本')
    expect(JSON.parse(String(request?.body)).operation).toBe('remote.sessions.list')
    let signal: AbortSignal | undefined
    const changed = vi.fn(), failed = vi.fn()
    const streamSdk = new ArkmeSdk({ fetchImpl: vi.fn(async (_url, init) => {
      signal = init?.signal ?? undefined
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"changed":true}\n')); signal?.addEventListener('abort', () => controller.close(), { once: true }) } }), { headers: { 'content-type': 'application/x-ndjson' } })
    }) as typeof fetch })
    const dispose = streamSdk.observeDshAccountSession({ runtimeRef: 'runtime', sessionRef: 'session' }, changed, { onError: failed })
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce())
    dispose(); await Promise.resolve()
    expect(signal?.aborted).toBe(true); expect(failed).not.toHaveBeenCalled()
  })
})

it('discovers and reads account sessions through an unmodified official DSH session ToolRuntime', async () => {
  const ctx = new Context(), f = fixture(false)
  try {
    await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
    for (const tool of accountSessionTools(f.directory)) ctx.tools.register(tool)
    const session = ctx.sessions.create(), agent = { id: session.id, session }
    expect(ctx.tools.schemas(agent as never).map(t => t.name)).toEqual(expect.arrayContaining(['arkme_dsh_sessions','arkme_dsh_session_read','arkme_dsh_session_command']))
    for (const [name,args] of [['arkme_dsh_sessions',{}],['arkme_dsh_session_read',{runtime_ref:'runtime-remote',session_ref:'same-session'}]] as const) {
      const result = await ctx.tools.execute({callId:CallId(name),name,arguments:args,agent:agent as never,signal:new AbortController().signal})
      expect(result.isError).toBe(false)
      expect(String(result.value)).toContain(name === 'arkme_dsh_sessions' ? '云端会话' : '历史正文')
      expect(String(result.value)).not.toContain('secret-routing-client')
    }
  } finally { f.directory.close(); await ctx.fiber.dispose() }
})

it('serves SDK through the HTTP boundary, rejects originless writes and releases an aborted stream', async () => {
  const f = fixture(), options = { expectedPort: 0, allowNonLoopback: false, accountSessions: () => f.directory }
  const server = createServer(createArkmeHostApi({} as never, options))
  server.listen(0,'127.0.0.1'); await once(server,'listening')
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing address')
  options.expectedPort=address.port
  const origin=`http://127.0.0.1:${address.port}`, sdk=new ArkmeSdk({fetchImpl:async (path,init)=>await fetch(new URL(String(path),origin),init)})
  try {
    expect((await sdk.listDshAccountSessions()).items[0]?.sessionRef).toBe('same-session')
    await expect(sdk.commandDshAccountSession({runtimeRef:'runtime-remote',sessionRef:'same-session',requestRef:'request-0001',operation:'session.cancel'})).rejects.toThrow('当前 DSH 页面')
    expect(f.transport.publish).not.toHaveBeenCalled()
    const changed=vi.fn(), stop=sdk.observeDshAccountSession({runtimeRef:'runtime-remote',sessionRef:'same-session'},changed)
    await vi.waitFor(()=>expect(changed).toHaveBeenCalledOnce())
    stop(); await vi.waitFor(()=>expect(f.transport.disconnect).not.toHaveBeenCalled())
    const catalogChanged = vi.fn(), stopCatalog = sdk.observeDshAccountSessions(catalogChanged)
    await vi.waitFor(() => expect(catalogChanged).toHaveBeenCalledOnce())
    f.emit({ kind: 'session.response', directoryChanged: true })
    await vi.waitFor(() => expect(catalogChanged).toHaveBeenCalledTimes(2))
    const directoryDelta = { version: 1, sessions: [{ runtime_ref: 'runtime-remote', session_ref: 'same-session', workspace_ref: 'workspace',
      host_generation: 2, projection_at: 3, source_updated_at: 4, running: false, blank: false, archived: false, title: 'x'.repeat(5000) }] }
    f.emit({ kind: 'session.response', directoryChanged: true, directoryDelta })
    await vi.waitFor(() => expect(catalogChanged).toHaveBeenCalledTimes(3))
    expect(catalogChanged.mock.lastCall?.[0]).toEqual({ ...directoryDelta, sessions: [{ ...directoryDelta.sessions[0], localTakeover: false }] })
    f.emit({ kind: 'session.response', directoryChanged: true, directoryDelta: { ...directoryDelta, version: 99 } })
    await vi.waitFor(() => expect(catalogChanged).toHaveBeenCalledTimes(4))
    expect(catalogChanged.mock.lastCall?.[0]).toBeUndefined()
    stopCatalog()
    f.requireAccount.mockRejectedValue(new ArkmePluginError('login-required', '请先登录当前 Arkme 账号', false, 401))
    const denied = await fetch(`${origin}/arkme-self/api`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'remote.sessions.list', params: {} }) })
    expect(denied.status).toBe(401)
    expect(await denied.json()).toMatchObject({ ok: false, error: { code: 'login-required', retryable: false } })
  } finally { f.directory.close(); server.closeAllConnections(); server.close(); await once(server,'close') }
})

it('creates only in the selected runtime workspace without injecting a source session id', async () => {
  const f = fixture()
  await f.directory.command({ runtimeRef: 'runtime-remote', operation: 'session.create', requestRef: 'request-create-01', body: { workspace_ref: 'workspace-remote' } })
  expect(f.transport.publish).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ operation: 'session.create', body: { workspace_ref: 'workspace-remote' } }), target: expect.objectContaining({ runtimeRef: 'runtime-remote' }) }))
})

it('hydrates a warm native opening from SQLite, serves cached pages without a remote RPC and isolates account changes', async () => {
  const path = mkdtempSync(join(tmpdir(), 'native account cache ')), cache = new DshNativeHistoryCache(path), f = fixture(true, cache)
  const records = Array.from({ length: 30 }, (_, seq) => ({ type: 'event' as const, event: { seq, type: seq % 6 === 0 ? 'turn/start' : 'user/message', data: {} } }))
  const snapshot = { type: 'snapshot', cursor: 29, records, hasMore: false, header: { id: 'same-session' }, assistantStream: { revision: 0 }, projections: { asOfSeq: 29, values: {} } }
  let reply: unknown = { items: [snapshot] }
  f.transport.publish = vi.fn(async input => {
    f.emit({ protocol: 'dsh.remote', protocol_major: 1, kind: 'response', request_ref: input.payload.request_ref, operation: 'session.native', host_generation: 3, status: 'completed', result: reply })
    return { sequence: 1 }
  })
  const address = { kind: 'session', sessionId: 'same-session' }
  const open = (streamRef: string) => f.directory.native({ runtimeRef: 'runtime-remote', requestRef: 'request-' + streamRef, body: { mode: 'pull', streamRef, endpoint: 'session/follow', payload: { args: { request: { address, assistantStream: true } } } } })
  try {
    expect(await open('cold-0001')).toEqual({ items: [snapshot], sourceWritable: true })
    f.directory.close()
    reply = { items: [{ ...snapshot, records: [] }] }
    expect(await open('warm-0001')).toEqual({ items: [snapshot], sourceWritable: true })
    expect(f.transport.publish).toHaveBeenLastCalledWith(expect.objectContaining({ payload: expect.objectContaining({ body: expect.objectContaining({ afterSeq: 29 }) }) }))
    const count = vi.mocked(f.transport.publish).mock.calls.length
    expect(await f.directory.native({ runtimeRef: 'runtime-remote', requestRef: 'page-0001', body: { mode: 'call', endpoint: 'session/page', payload: { args: { request: { address, throughSeq: 29 } } } } })).toEqual({ ok: true, value: { records, hasMore: false }, sourceWritable: true })
    expect(vi.mocked(f.transport.publish).mock.calls).toHaveLength(count)
    f.directory.close(); f.requireAccount.mockResolvedValue('another-account'); reply = { items: [snapshot] }
    await open('other-001')
    expect(vi.mocked(f.transport.publish).mock.calls.at(-1)![0].payload.body).not.toHaveProperty('afterSeq')
  } finally { f.directory.close(); cache.close(); rmSync(path, { recursive: true, force: true }) }
})

it('bootstraps an offline account instance, admits an empty history, blocks writes and reconnects to a restored source', async () => {
  const f = fixture(false), post = f.post.getMockImplementation()!
  f.post.mockImplementation(async path => path.endsWith('/sessions/list') ? { items: [{ session_ref: 'same-session', title: '空会话', source_updated_at: 1 }] } as never
    : path.endsWith('/session-events/list') ? { entries: [] } as never
    : path.endsWith('/session-turn-objects/list') ? { items: [] } as never : post(path))
  const native = (body: object) => f.directory.native({ runtimeRef: 'runtime-remote', requestRef: 'request-test', body })
  const events = { mode: 'pull', streamRef: 'events', endpoint: '$events', payload: { args: {} } }
  expect(await native(events)).toMatchObject({ sourceWritable: false, items: [{ type: 'ready' }] })
  expect(await native({ mode: 'pull', streamRef: 'history', endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId: 'same-session' } } } } })).toMatchObject({ sourceWritable: false, items: [{ records: [], cursor: -1 }] })
  await expect(native({ mode: 'call', endpoint: 'session/prompt', payload: { args: {} } })).rejects.toMatchObject({ code: 'RUNTIME_OFFLINE' })
  expect(f.transport.connect).not.toHaveBeenCalled()
  f.post.mockImplementation(async path => {
    const value = await post(path)
    if (path.endsWith('/desktops/list')) value.desktops![0]!.runtimes[0]!.presence = { presence: 'online', lease_generation: 8 }
    return value
  })
  await f.directory.list({}) // The existing directory push/list wakes only restored cloud leases.
  await expect(native({ mode: 'pull', streamRef: 'events' })).rejects.toMatchObject({ code: 'REMOTE_NOT_FOUND' })
  await native({ ...events, streamRef: 'restored' })
  expect(f.transport.connect).toHaveBeenCalledOnce()
  f.directory.close()
})

it('resolves workspace names with at most four concurrent source reads', async () => {
  const f = fixture(), sources = Array.from({ length: 6 }, (_, i) => `runtime-${i}`)
  const pending: Array<() => void> = []
  let inFlight = 0, peak = 0
  f.post.mockImplementation((async (path: string) => {
    if (path.endsWith('/desktops/list')) return { desktops: [{ desktop: { desktop_ref: 'desktop' }, runtimes: sources.map(runtime_ref => ({ runtime: { runtime_ref, profile_ref: 'web', host_client_ref: 'client', host_generation: 1 }, presence: {} })) }] }
    if (path.endsWith('/sessions/account-list')) return { items: sources.map(runtime_ref => ({ runtime_ref, session_ref: 'session', workspace_ref: 'workspace' })) }
    inFlight++; peak = Math.max(peak, inFlight)
    await new Promise<void>(resolve => pending.push(resolve)); inFlight--
    return { items: [{ workspace_ref: 'workspace', title: 'repo' }] }
  }) as never)
  const result = f.directory.list()
  await vi.waitFor(() => expect(pending).toHaveLength(4))
  pending.splice(0).forEach(resolve => resolve())
  await vi.waitFor(() => expect(pending).toHaveLength(2))
  pending.splice(0).forEach(resolve => resolve())
  expect((await result).items.map(row => row.workspaceName)).toEqual(sources.map(() => 'repo'))
  expect(peak).toBe(4)
  f.directory.close()
})

 it('retains one channel and discovery across sequential native pulls until explicit close', async () => {
  const f = fixture()
  const params = { runtimeRef: 'runtime-remote', requestRef: 'request-stream-01', body: { mode: 'pull', streamRef: 'stream-01', endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId: 'same-session' } } } } } }
  try {
    await f.directory.native(params)
    await f.directory.native({ ...params, body: { mode: 'pull', streamRef: 'stream-01' } })
    await f.directory.native({ ...params, body: { mode: 'pull', streamRef: 'stream-01' } })
    expect(f.transport.connect).toHaveBeenCalledOnce()
    expect(f.transport.disconnect).not.toHaveBeenCalled()
    expect(f.post.mock.calls.filter(([path]) => path.endsWith('/desktops/list'))).toHaveLength(1)
    await f.directory.native({ ...params, body: { mode: 'close', streamRef: 'stream-01' } })
    expect(f.transport.disconnect).not.toHaveBeenCalled()
  } finally { f.directory.close() }
})

it('shares discovery without letting one cancelled caller abort its peer', async () => {
  const f = fixture(), abort = new AbortController(), post = f.post.getMockImplementation()!
  let resolve!: (value: any) => void, discoverySignal!: AbortSignal
  f.post.mockImplementation((path, body, signal) => {
    if (!path.endsWith('/desktops/list')) return post(path, body, signal)
    discoverySignal = signal!; return new Promise(done => { resolve = done }) as never
  })
  const params = { runtimeRef: 'runtime-remote', sessionRef: 'same-session' }
  const cancelled = f.directory.read(params, abort.signal).catch(error => error)
  const kept = f.directory.read(params)
  await vi.waitFor(() => expect(f.post.mock.calls.filter(([path]) => path.endsWith('/desktops/list'))).toHaveLength(1))
  abort.abort(new Error('consumer cancelled'))
  expect((await cancelled).message).toBe('consumer cancelled')
  expect(discoverySignal.aborted).toBe(false)
  resolve(await post('/api/v1/dsh-remote/desktops/list'))
  await expect(kept).resolves.toMatchObject({ complete: true })
  f.directory.close()
})

it('shares one live execution route across follow, control, events and prompts without polling it', async () => {
  const f = fixture(), cancel = new AbortController(), post = f.post.getMockImplementation()!
  let resolve!: () => void, lookupSignal!: AbortSignal
  f.post.mockImplementation(async (path, body, signal) => {
    if (path.endsWith('/sessions/execution')) {
      lookupSignal = signal!
      await new Promise<void>(done => { resolve = done })
    }
    return post(path, body, signal)
  })
  const params = { runtimeRef: 'runtime-remote', sessionRef: 'same-session', requestRef: 'route-test' }
  const open = (endpoint: string, signal?: AbortSignal) => f.directory.native({ ...params, body: {
    mode: 'pull', streamRef: 'stream-' + endpoint.replace(/[^a-z]/g, '-'), endpoint, payload: { args: { request: { address: { kind: 'session', sessionId: 'same-session' } } } },
  } }, signal)
  try {
    const departing = open('session/follow', cancel.signal).catch(error => error)
    const staying = open('session/control'), events = open('$events')
    await vi.waitFor(() => expect(resolve).toBeDefined())
    cancel.abort(new Error('left page'))
    expect((await departing).message).toBe('left page')
    expect(lookupSignal.aborted).toBe(false)
    resolve(); await Promise.all([staying, events])
    for (let i = 0; i < 10; i++) await f.directory.native({ ...params, body: { mode: 'pull', streamRef: 'stream-session-control' } })
    await f.directory.native({ ...params, body: { mode: 'call', endpoint: 'session/prompt', payload: { args: { request: {
      sessionId: 'same-session', requestId: 'original-prompt', mode: 'queue', content: [{ type: 'text', text: 'hello' }],
    } } } } })
    expect(f.post.mock.calls.filter(([path]) => path.endsWith('/sessions/execution'))).toHaveLength(1)
    for (const streamRef of ['session/control', '$events']) await f.directory.native({ ...params, body: { mode: 'close', streamRef: 'stream-' + streamRef.replace(/[^a-z]/g, '-') } })
    expect(f.post.mock.calls.filter(([path]) => path.endsWith('/sessions/execution'))).toHaveLength(1)
    expect(f.transport.disconnect).not.toHaveBeenCalled()
  } finally { f.directory.close() }
})

it('invalidates all session subscriptions on handoff, closes the original Host and preserves other sessions', async () => {
  const f = fixture(), post = f.post.getMockImplementation()!
  const params = { runtimeRef: 'runtime-remote', sessionRef: 'same-session', requestRef: 'handoff-test' }
  const request = (streamRef: string, mode: string, endpoint?: string) => f.directory.native({ ...params, requestRef: 'request-' + streamRef.replace(/[^a-z]/g, '-') + '-' + mode, body: {
    mode, streamRef: 'stream-' + streamRef.replace(/[^a-z]/g, '-'), ...(endpoint ? { endpoint, payload: { args: { request: { address: { kind: 'session', sessionId: 'same-session' } } } } } : {}),
  } })
  const reply = (input: any, result: any) => f.emit({ protocol: 'dsh.remote', protocol_major: 1, kind: 'response', request_ref: input.payload.request_ref,
    operation: 'session.native', host_generation: 3, status: 'completed', result }, { runtimeRef: input.target.runtimeRef })
  try {
    for (const endpoint of ['session/follow', 'session/control', '$events']) await request(endpoint, 'pull', endpoint)
    await f.directory.native({ ...params, sessionRef: 'other', body: { mode: 'pull', streamRef: 'other-stream', endpoint: '$events', payload: { args: {} } } })
    vi.mocked(f.transport.publish).mockImplementation(async input => {
      if ((input.payload.body as any).streamRef === 'stream-session-follow') reply(input, { items: [], done: true })
      return { sequence: 1 }
    })
    const controls = request('session/control', 'pull').catch(error => error)
    const events = request('$events', 'pull').catch(error => error)
    await vi.waitFor(() => expect(f.transport.publish).toHaveBeenCalledTimes(6))
    expect(await request('session/follow', 'pull')).toMatchObject({ done: true })
    for (const result of await Promise.all([controls, events])) expect(result).toMatchObject({ code: 'REMOTE_NOT_FOUND', retryable: true })
    vi.mocked(f.transport.publish).mockImplementation(async input => { reply(input, { items: [] }); return { sequence: 1 } })
    const queries = () => f.post.mock.calls.filter(([path]) => path.endsWith('/sessions/execution')).length
    expect(queries()).toBe(2)
    await f.directory.native({ ...params, sessionRef: 'other', body: { mode: 'pull', streamRef: 'other-stream' } })
    for (const endpoint of ['session/follow', 'session/control', '$events']) await request(endpoint, 'close')
    expect(queries()).toBe(2)
    const closes = vi.mocked(f.transport.publish).mock.calls.filter(([x]) => (x.payload.body as any).mode === 'close')
    expect(closes.map(([x]) => x.target.runtimeRef)).toEqual(['runtime-remote', 'runtime-remote', 'runtime-remote'])
    await f.directory.native({ ...params, sessionRef: 'other', body: { mode: 'close', streamRef: 'other-stream' } })
    f.post.mockImplementation(async (path, body, signal) => {
      const value = await post(path, body, signal)
      if (path.endsWith('/sessions/execution')) return { executor_runtime_ref: 'runtime-next' } as never
      if (path.endsWith('/desktops/list')) value.desktops![0]!.runtimes[0]!.runtime.runtime_ref = 'runtime-next'
      return value
    })
    await request('new-follow', 'pull', 'session/follow')
    expect(queries()).toBe(3)
    expect(f.transport.publish).toHaveBeenLastCalledWith(expect.objectContaining({ target: expect.objectContaining({ runtimeRef: 'runtime-next' }) }))
  } finally { f.directory.close() }
})

it('releases idle native leases, invalidates disconnected channels, and cancels account discovery', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const params = { runtimeRef: 'runtime-remote', requestRef: 'request-stream-01', body: { mode: 'pull', streamRef: 'stream-01', endpoint: '$events', payload: { args: {} } } }
  try {
    await f.directory.native(params)
    const disconnect = vi.mocked(f.transport.subscribeDisconnect).mock.calls[0]![0]
    disconnect(new Error('lost'))
    await f.directory.native(params)
    expect(f.transport.connect).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(45_001)
    expect(f.transport.disconnect).not.toHaveBeenCalled()
    await f.directory.native(params)
    f.directory.close()
    expect(f.transport.disconnect).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  } finally { f.directory.close(); vi.useRealTimers() }
})

it('keeps a live route beyond five seconds and re-resolves on a Host disconnect', async () => {
  vi.useFakeTimers()
  const f = fixture(), post = f.post.getMockImplementation()!
  const params = { runtimeRef: 'runtime-remote', requestRef: 'request-stream-01', body: { mode: 'pull', streamRef: 'stream-01', endpoint: '$events', payload: { args: {} } } }
  try {
    await f.directory.native(params)
    await vi.advanceTimersByTimeAsync(5_001)
    await f.directory.native({ ...params, body: { mode: 'pull', streamRef: 'stream-01' } })
    expect(f.post.mock.calls.filter(([path]) => path.endsWith('/desktops/list'))).toHaveLength(1)
    vi.mocked(f.transport.subscribeDisconnect).mock.calls[0]![0](new Error('Host replaced'))
    f.post.mockImplementation(async path => {
      const value = await post(path)
      if (path.endsWith('/desktops/list')) { const row = value.desktops![0]!.runtimes[0]!; row.runtime.host_generation = 4; row.presence.lease_generation = 9 }
      return value
    })
    vi.mocked(f.transport.publish).mockImplementation(async input => {
      f.emit({ protocol: 'dsh.remote', protocol_major: 1, kind: 'response', request_ref: input.payload.request_ref, operation: 'session.native', host_generation: 4, status: 'completed', result: {} }, { targetHostLeaseGeneration: 9 })
      return { sequence: 1 }
    })
    await f.directory.native(params)
    expect(f.transport.connect).toHaveBeenCalledTimes(2)
    expect(f.transport.disconnect).not.toHaveBeenCalled()
    expect(f.transport.subscribe).toHaveBeenLastCalledWith(expect.objectContaining({ target: expect.objectContaining({ hostLeaseGeneration: 9 }) }))
  } finally { f.directory.close(); vi.useRealTimers() }
})

it('re-resolves a stale executor using a fresh transport attempt and the same native prompt identity', async () => {
  const f = fixture(); let attempts = 0
  vi.mocked(f.transport.publish).mockImplementation(async input => {
    const prompt = (input.payload.body as any).endpoint === 'session/prompt'
    f.emit({ protocol: 'dsh.remote', protocol_major: 1, kind: 'response', request_ref: input.payload.request_ref,
      operation: 'session.native', host_generation: 3, status: 'completed',
      ...(prompt && attempts++ === 0 ? { error: { code: 'SESSION_STATE_CHANGED', retryable: true } } : { result: { ok: true, value: { accepted: true } } }),
    }); return { sequence: 1 }
  })
  const params = { runtimeRef: 'runtime-remote', sessionRef: 'same-session', requestRef: 'burst-command', body: {
    mode: 'call', endpoint: 'session/prompt', payload: { args: { request: { sessionId: 'same-session', requestId: 'burst-prompt', mode: 'queue', content: [{ type: 'text', text: 'hello' }] } } },
  } }
  try {
    await f.directory.native({ ...params, requestRef: 'active-before-handoff', body: { mode: 'pull', streamRef: 'active-before-handoff', endpoint: '$events', payload: { args: {} } } })
    expect(await f.directory.native(params)).toMatchObject({ ok: true, value: { accepted: true } })
    expect(f.post.mock.calls.filter(([path]) => path.endsWith('/sessions/execution'))).toHaveLength(2)
    const sent = vi.mocked(f.transport.publish).mock.calls.map(([call]) => call.payload).filter(payload => (payload.body as any).endpoint === 'session/prompt')
    expect(sent[0].request_ref).toBe('burst-command')
    expect(sent[1].request_ref).not.toBe(sent[0].request_ref)
    for (const payload of sent) expect(payload).toMatchObject({ body: params.body })
  } finally { f.directory.close() }
})


function stableNativeRouteFixture() {
  const f = fixture(), original = f.post.getMockImplementation()!, reader = new DshRemoteFragmentReader()
  const held: Record<string, unknown>[] = []
  f.post.mockImplementation(async (path, body, signal) => {
    const result = await original(path, body, signal)
    if (path.endsWith('/desktops/list')) (result as any).desktops[0].runtimes[0].runtime.capabilities.push('session.native.channel')
    return result
  })
  const respond = (request: Record<string, unknown>) => {
    const body = request.body as Record<string, unknown>
    f.emit({ kind: 'session.response', runtimeRef: request.runtimeRef, sessionRef: request.sessionRef,
      requestRef: request.requestRef, ...(body.mode === 'pull' ? { streamRef: body.streamRef } : {}), epoch: 2,
      value: body.mode === 'pull' ? { items: [{ type: 'snapshot', records: [], cursor: 2 }] } : { ok: true } })
  }
  f.transport.publish = vi.fn(async input => {
    const request = reader.accept(input.payload)
    if (request?.kind === 'session.request') {
      const body = request.body as Record<string, unknown>
      if (request.sessionRef === 'in-flight' && body.mode === 'call') held.push(request)
      else if (body.mode !== 'close') respond(request)
    }
    return { sequence: 1 }
  })
  const native = (sessionRef: string, mode = 'pull') => f.directory.native({ runtimeRef: 'runtime-remote', sessionRef,
    requestRef: `request-${sessionRef}-${mode}`, body: { mode, streamRef: `stream-${sessionRef}`,
      ...(mode === 'close' ? {} : { endpoint: mode === 'call' ? 'session/page' : 'session/follow',
        payload: { args: { request: { address: { kind: 'session', sessionId: sessionRef } } } } }) } })
  return { ...f, native, held, respond }
}

it('reclaims idle native routes across more than 64 sequential sessions before their idle expiry', async () => {
  vi.useFakeTimers()
  const f = stableNativeRouteFixture(), started = Date.now()
  try {
    for (let index = 0; index < 66; index++) {
      await expect(f.native(`visited-${index}`)).resolves.toMatchObject({ items: [{ cursor: 2 }] })
      await f.native(`visited-${index}`, 'close')
    }
    await expect(f.native('visited-0')).resolves.toMatchObject({ items: [{ cursor: 2 }] })
    expect(Date.now()).toBe(started)
    expect(f.transport.connect).toHaveBeenCalledOnce()
    expect(f.transport.subscribe).toHaveBeenCalledOnce()
    expect(f.transport.disconnect).not.toHaveBeenCalled()
  } finally { f.directory.close(); vi.useRealTimers() }
})

it('keeps the 64 active native route limit and reclaims only a released route', async () => {
  vi.useFakeTimers()
  const f = stableNativeRouteFixture()
  try {
    for (let index = 0; index < 64; index++) await f.native(`active-${index}`)
    await expect(f.native('overflow')).rejects.toMatchObject({ code: 'RUNTIME_LIMIT_REACHED', message: '原生会话连接数量超限' })
    await f.native('active-0', 'close')
    await expect(f.native('overflow')).resolves.toMatchObject({ items: [{ cursor: 2 }] })
    await expect(f.native('active-1', 'call')).resolves.toMatchObject({ ok: true })
    expect(f.post.mock.calls.filter(([path, body]) => path.endsWith('/sessions/execution') && body?.session_ref === 'active-1')).toHaveLength(1)
    expect(f.transport.connect).toHaveBeenCalledOnce()
  } finally { f.directory.close(); vi.useRealTimers() }
})

it('does not evict an in-flight native request while reclaiming idle routes', async () => {
  vi.useFakeTimers()
  const f = stableNativeRouteFixture()
  const pending = f.native('in-flight', 'call')
  const outcome = pending.then(value => ({ value }), error => ({ error }))
  try {
    for (let index = 0; index < 66; index++) {
      await f.native(`idle-${index}`)
      await f.native(`idle-${index}`, 'close')
    }
    expect(f.held).toHaveLength(1)
    const lookup = f.post.mock.calls.find(([path, body]) => path.endsWith('/sessions/execution') && body?.session_ref === 'in-flight')
    expect(lookup?.[2]?.aborted).toBe(false)
    f.respond(f.held[0]!)
    await expect(outcome).resolves.toMatchObject({ value: { ok: true } })
    expect(f.post.mock.calls.filter(([path, body]) => path.endsWith('/sessions/execution') && body?.session_ref === 'in-flight')).toHaveLength(1)
  } finally { f.directory.close(); await outcome; vi.useRealTimers() }
})

it('retains the session channel through all native generation closures without resolving a new executor', async () => {
  const f = fixture(), original = f.post.getMockImplementation()!, reader = new DshRemoteFragmentReader()
  f.post.mockImplementation(async (path, body, signal) => {
    const result = await original(path, body, signal)
    if (path.endsWith('/desktops/list')) (result as any).desktops[0].runtimes[0].runtime.capabilities.push('session.native.channel')
    return result
  })
  f.transport.publish = vi.fn(async input => {
    const request = reader.accept(input.payload)
    if (request?.kind === 'session.request') {
      const body = request.body as Record<string, unknown>
      if (body.mode !== 'close') f.emit({ kind: 'session.response', runtimeRef: request.runtimeRef, sessionRef: request.sessionRef,
        requestRef: request.requestRef, ...(body.mode === 'pull' ? { streamRef: body.streamRef } : {}), epoch: 2,
        value: body.mode === 'pull' ? { items: [{ type: 'snapshot', records: [], cursor: 2 }] } : { ok: true } })
    }
    return { sequence: 1 }
  })
  const params = { runtimeRef: 'runtime-remote', sessionRef: 'same-session', requestRef: 'channel-request' }
  try {
    for (const streamRef of ['stream-generation-one', 'stream-generation-two']) {
      await expect(f.directory.native({ ...params, body: { mode: 'pull', streamRef, endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId: 'same-session' } } } } } })).resolves.toMatchObject({ items: [{ cursor: 2 }] })
      await f.directory.native({ ...params, body: { mode: 'close', streamRef } })
    }
    await f.directory.native({ ...params, body: { mode: 'call', endpoint: 'session/prompt', payload: { args: { request: { sessionId: 'same-session', requestId: 'native-request', mode: 'queue' } } } } })
    expect(f.post.mock.calls.filter(([path]) => path.endsWith('/sessions/execution'))).toHaveLength(1)
    expect(f.transport.connect).toHaveBeenCalledOnce()
    expect(f.transport.subscribe).toHaveBeenCalledOnce()
    expect(f.transport.disconnect).not.toHaveBeenCalled()
  } finally { f.directory.close() }
})

it('uses negotiated stable native and typed protocols despite old offline/generation state without per-command discovery', async () => {
  const f = fixture(false), original = f.post.getMockImplementation()!
  f.post.mockImplementation(async (path, body, signal) => {
    const result = await original(path, body, signal)
    if (path.endsWith('/desktops/list')) {
      const row = (result as any).desktops[0].runtimes[0]
      row.runtime.capabilities.push('session.native.channel', 'session.commands.channel')
      row.runtime.host_generation = 99999999
    }
    return result
  })
  f.transport.publish = vi.fn(async ({ payload }) => {
    if (payload.kind === 'session.request') f.emit({ ...payload, requestRef: payload.requestRef, kind: 'session.response', epoch: 1,
      value: { ok: true, value: { title: 'live' } } })
    if (payload.kind === 'session.command') {
      const envelope = payload.envelope as any
      f.emit({ kind: 'session.response', runtimeRef: payload.runtimeRef,
        envelope: { ...envelope, kind: 'response', status: 'completed', result: envelope.operation === 'session.history' ? { entries: [], hasMore: false } : { accepted: true } } })
    }
    return { sequence: 1 }
  })
  const address = { runtimeRef: 'runtime-remote', sessionRef: 'same-session' }
  try {
    await f.directory.list()
    f.post.mockClear()
    await expect(f.directory.native({ ...address, requestRef: 'native-ready', body: { mode: 'call', endpoint: 'session/page', payload: { args: {} } } })).resolves.toMatchObject({ sourceWritable: true })
    for (const id of ['request-one', 'request-two']) {
      await f.directory.command({ ...address, operation: 'session.cancel', requestRef: id })
      await f.directory.read({ ...address, source: 'host' })
    }
    expect(f.post).not.toHaveBeenCalled()
    expect(f.transport.connect).toHaveBeenCalledOnce()
    expect(f.transport.subscribe).toHaveBeenCalledOnce()
    f.directory.close()
    await f.directory.command({ ...address, operation: 'session.cancel', requestRef: 'new-account' })
    expect(f.post.mock.calls.some(([path]) => path.endsWith('/sessions/execution'))).toBe(true)
  } finally { f.directory.close() }
})

it('observes the account directory without executor discovery and ignores controller-forged notifications', async () => {
  const f = fixture(), controller = new AbortController(), changed = vi.fn()
  const watch = f.directory.observeDirectory(controller.signal, changed)
  await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce())
  expect(f.post).not.toHaveBeenCalled()
  f.emit({ kind: 'session.response', directoryChanged: true }, { senderRole: 'controller' })
  expect(changed).toHaveBeenCalledOnce()
  f.emit({ kind: 'session.response', directoryChanged: true })
  expect(changed).toHaveBeenCalledTimes(2)
  controller.abort(); await watch
  f.emit({ kind: 'session.response', directoryChanged: true })
  expect(changed).toHaveBeenCalledTimes(2)
  f.directory.close()
})

it('keeps verified cloud history when a stable executor is absent and resumes only after directory availability', async () => {
  const f = fixture(false), original = f.post.getMockImplementation()!
  let online = false
  f.post.mockImplementation(async (path, body, signal) => {
    if (path.endsWith('/sessions/list')) return { items: [{ session_ref: 'same-session', title: 'empty', source_updated_at: 1 }] } as never
    if (path.endsWith('/session-events/list')) return { entries: [] } as never
    if (path.endsWith('/session-turn-objects/list')) return { items: [] } as never
    const result = await original(path, body, signal)
    if (path.endsWith('/desktops/list')) {
      const row = (result as any).desktops[0].runtimes[0]
      row.runtime.capabilities.push('session.native.channel')
      row.presence = { presence: online ? 'online' : 'offline', lease_generation: online ? 8 : 0 }
    }
    return result
  })
  f.transport.publish = vi.fn(async ({ payload }) => {
    if (online && payload.kind === 'session.request') f.emit({ ...payload, kind: 'session.response', epoch: 2, streamRef: (payload.body as any).streamRef,
      value: { items: [{ type: 'snapshot', cursor: -1, records: [], assistantStream: { revision: 0 } }] } })
    return { sequence: 1 }
  })
  const timeout = AbortSignal.timeout.bind(AbortSignal)
  const timer = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => timeout(ms === 20_000 ? 10 : ms))
  const address = { runtimeRef: 'runtime-remote', sessionRef: 'same-session' }
  const opening = { mode: 'pull', streamRef: 'cloud-test', endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId: 'same-session' } } } } }
  const native = (body: object) => f.directory.native({ ...address, requestRef: 'cloud-test-request', body })
  try {
    await f.directory.list()
    await expect(native(opening)).resolves.toMatchObject({ sourceWritable: false, items: [{ type: 'snapshot', records: [] }] })
    const sent = vi.mocked(f.transport.publish).mock.calls.length
    const next = native({ mode: 'pull', streamRef: 'cloud-test' })
    const resumed = expect(next).rejects.toMatchObject({ code: 'REMOTE_NOT_FOUND', retryable: true })
    await new Promise(resolve => setImmediate(resolve))
    expect(vi.mocked(f.transport.publish).mock.calls.length).toBe(sent)
    online = true
    await f.directory.list()
    await resumed
    await expect(native(opening)).resolves.toMatchObject({ sourceWritable: true, items: [{ type: 'snapshot' }] })
    expect(f.transport.connect).toHaveBeenCalledOnce()
    expect(f.transport.subscribe).toHaveBeenCalledOnce()
  } finally { timer.mockRestore(); f.directory.close() }
})

it('resumes an existing cloud-only page on canonical ready without a directory HTTP refresh', async () => {
  const f = fixture(false), original = f.post.getMockImplementation()!
  let online = false
  f.post.mockImplementation(async (path, body, signal) => {
    if (path.endsWith('/sessions/list')) return { items: [{ session_ref: 'same-session', title: 'empty', source_updated_at: 1 }] } as never
    if (path.endsWith('/session-events/list')) return { entries: [] } as never
    if (path.endsWith('/session-turn-objects/list')) return { items: [] } as never
    const result = await original(path, body, signal)
    if (path.endsWith('/desktops/list')) {
      const row = (result as any).desktops[0].runtimes[0]
      row.runtime.capabilities.push('session.native.channel')
      row.presence = { presence: online ? 'online' : 'offline', lease_generation: online ? 8 : 0 }
    }
    return result
  })
  f.transport.publish = vi.fn(async ({ payload }) => {
    if (online && payload.kind === 'session.request') f.emit({ ...payload, kind: 'session.response', epoch: 2, streamRef: (payload.body as any).streamRef,
      value: { items: [{ type: 'snapshot', cursor: -1, records: [], assistantStream: { revision: 0 } }] } })
    return { sequence: 1 }
  })
  const timeout = AbortSignal.timeout.bind(AbortSignal)
  const timer = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => timeout(ms === 20_000 ? 10 : ms))
  const address = { runtimeRef: 'runtime-remote', sessionRef: 'same-session' }
  const opening = { mode: 'pull', streamRef: 'cloud-test', endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId: 'same-session' } } } } }
  const native = (body: object) => f.directory.native({ ...address, requestRef: 'cloud-test-request', body })
  try {
    await f.directory.list()
    await expect(native(opening)).resolves.toMatchObject({ sourceWritable: false, items: [{ type: 'snapshot', records: [] }] })
    const sent = vi.mocked(f.transport.publish).mock.calls.length
    const next = native({ mode: 'pull', streamRef: 'cloud-test' })
    const resumed = expect(next).rejects.toMatchObject({ code: 'REMOTE_NOT_FOUND', retryable: true })
    await new Promise(resolve => setImmediate(resolve))
    expect(vi.mocked(f.transport.publish).mock.calls.length).toBe(sent)
    online = true
    const reads = f.post.mock.calls.length
    let settled = false
    void next.then(() => { settled = true }, () => { settled = true })
    f.emit({ kind: 'session.response', ready: true, runtimeRef: 'runtime-other', sessionRef: 'same-session', epoch: 2 })
    f.emit({ kind: 'session.response', ready: true, runtimeRef: 'runtime-remote', sessionRef: 'other-session', epoch: 2 })
    f.emit({ kind: 'session.response', ready: true, runtimeRef: 'runtime-remote', sessionRef: 'same-session', epoch: 0 })
    f.emit({ kind: 'session.response', ready: true, runtimeRef: 'runtime-remote', sessionRef: 'same-session', epoch: 2 }, { senderRole: 'controller' })
    await new Promise(resolve => setImmediate(resolve))
    expect(settled).toBe(false)
    f.emit({ kind: 'session.response', ready: true, runtimeRef: 'runtime-remote', sessionRef: 'same-session', epoch: 2 })
    await resumed
    expect(f.post.mock.calls).toHaveLength(reads)
    await expect(native(opening)).resolves.toMatchObject({ sourceWritable: true, items: [{ type: 'snapshot' }] })
    expect(f.transport.connect).toHaveBeenCalledOnce()
    expect(f.transport.subscribe).toHaveBeenCalledOnce()
  } finally { timer.mockRestore(); f.directory.close() }
})
