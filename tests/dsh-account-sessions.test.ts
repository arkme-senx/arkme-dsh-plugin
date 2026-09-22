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

function fixture(online = true, historyCache?: DshNativeHistoryCache) {
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
  const post = vi.fn(async (path: string) => {
    if (path.endsWith('/desktops/list')) return { desktops: [{ desktop: { desktop_ref: 'desktop-remote', display_name: '旧电脑' }, runtimes: [{ runtime: { runtime_ref: 'runtime-remote', profile_ref: 'default', host_client_ref: 'secret-routing-client', host_generation: 3, capabilities: ['session.native', 'session.native.history'] }, presence: { presence: online ? 'online' : 'offline', lease_generation: online ? 8 : 0 } }] }] }
    if (path.endsWith('/sessions/account-list')) return { items: [{ runtime_ref: 'runtime-remote', session_ref: 'same-session', workspace_ref: '', title: '云端会话', source_updated_at: 1 }], next_cursor: { updated_at: 1, session_ref: 'same-session', runtime_ref: 'runtime-remote' } }
    if (path.endsWith('/session-turns/list')) return { items: [{ nodes: [{ node_ref: 'message:1', kind: 'user', anchor_seq: 1, ordinal: 0, data: { content: [{ type: 'text', text: '历史正文' }] } }] }], complete: true }
    throw new Error(path)
  })
  const requireAccount = vi.fn(async () => '3016')
  const directory = new DshAccountSessions({ request: { post }, requireAccount, ...(historyCache ? { historyCache } : {}), createTransport: () => transport, profileRef: 'controller-profile', clientRef: 'controller', localStatus: () => ({ contractVersion: 1, available: true, enabled: true, connected: true, runtimeRef: 'runtime-local', hostGeneration: 1, capabilities: [], revision: 1 }) })
  return { directory, post, transport, requireAccount, emit: (payload: Record<string, unknown>, overrides: Partial<DshRemoteTrustedEventMetadata> = {}) => receive?.(payload, { ...metadata, ...overrides }) }
}

describe('account DSH directory and controller', () => {
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
    expect(f.transport.disconnect).toHaveBeenCalledOnce()
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
    expect(f.transport.disconnect).toHaveBeenCalledOnce()
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
    stop(); await vi.waitFor(()=>expect(f.transport.disconnect).toHaveBeenCalledOnce())
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
    expect(f.transport.disconnect).toHaveBeenCalledOnce()
  } finally { f.directory.close() }
})

it('shares discovery without letting one cancelled caller abort its peer', async () => {
  const f = fixture(), abort = new AbortController(), post = f.post.getMockImplementation()!
  let resolve!: (value: any) => void, discoverySignal!: AbortSignal
  f.post.mockImplementationOnce((_path, _body, signal) => { discoverySignal = signal!; return new Promise(done => { resolve = done }) as never })
  const params = { runtimeRef: 'runtime-remote', sessionRef: 'same-session' }
  const cancelled = f.directory.read(params, abort.signal).catch(error => error)
  const kept = f.directory.read(params)
  await vi.waitFor(() => expect(f.post).toHaveBeenCalledOnce())
  abort.abort(new Error('consumer cancelled'))
  expect((await cancelled).message).toBe('consumer cancelled')
  expect(discoverySignal.aborted).toBe(false)
  resolve(await post('/api/v1/dsh-remote/desktops/list'))
  await expect(kept).resolves.toMatchObject({ complete: true })
  f.directory.close()
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
    expect(f.transport.disconnect).toHaveBeenCalledTimes(2)
    await f.directory.native(params)
    f.directory.close()
    expect(f.transport.disconnect).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  } finally { f.directory.close(); vi.useRealTimers() }
})

it('rechecks retained routing after five seconds and fences a replaced Host generation', async () => {
  vi.useFakeTimers()
  const f = fixture(), post = f.post.getMockImplementation()!
  const params = { runtimeRef: 'runtime-remote', requestRef: 'request-stream-01', body: { mode: 'pull', streamRef: 'stream-01', endpoint: '$events', payload: { args: {} } } }
  try {
    await f.directory.native(params)
    await vi.advanceTimersByTimeAsync(5_001)
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
    expect(f.transport.disconnect).toHaveBeenCalledOnce()
    expect(f.transport.subscribe).toHaveBeenLastCalledWith(expect.objectContaining({ target: expect.objectContaining({ hostLeaseGeneration: 9 }) }))
  } finally { f.directory.close(); vi.useRealTimers() }
})
