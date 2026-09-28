import { expect, it, vi } from 'vitest'
import { DshRemoteError } from '../src/dsh-remote/errors.js'
import { DshSessionChannelClient, DshSessionChannelHost } from '../src/dsh-remote/session-channel.js'
import type { DshRemoteRealtimeTransport, DshRemoteTrustedEventMetadata } from '../src/dsh-remote/types.js'
import { DshRemoteFragmentReader, dshRemoteOutboundPayloads } from '../src/dsh-remote/transport-fragment.js'

it('reassembles five interleaved startup replies on the one account channel', async () => {
  let receive: any
  const transport = { subscribeDisconnect: () => () => {},
    subscribe: async ({ onEvent }: any) => { receive = onEvent; return () => {} },
    publish: vi.fn(async () => ({ sequence: 1 })),
  } as unknown as DshRemoteRealtimeTransport
  const client = new DshSessionChannelClient(transport, async () => {}, vi.fn())
  const operations = ['snapshot.get', 'snapshot.get', 'snapshot.get', 'session.history', 'model.list'] as const
  const requests = operations.map((operation, index) => ({ protocol: 'dsh.remote' as const, protocol_major: 1 as const,
    kind: 'request' as const, request_ref: `startup-${index}`, host_generation: 1, issued_at: Date.now(),
    execute_before: Date.now() + 2000, operation, body: {} }))
  const pending = requests.map((request, index) => client.command(`host-${index % 3}`, request, new AbortController().signal))
  const checked = expect(Promise.all(pending)).resolves.toEqual(operations.map(() => ({ items: [] })))
  try {
    await vi.waitFor(() => expect(transport.publish).toHaveBeenCalledTimes(5))
    const fragments = requests.map((request, index) => dshRemoteOutboundPayloads({ kind: 'session.response',
      runtimeRef: `host-${index % 3}`, envelope: { ...request, kind: 'response', status: 'completed', result: { items: [] } },
    }, request.request_ref))
    for (let part = 0; part < 2; part++) for (const frames of fragments) receive(frames[part]!.value, { senderRole: 'host' })
    await checked
  } finally { client.close() }
})

it('only invalidates changed directory content or execution epochs and retries a failed notification', async () => {
  let epoch = 1, fail = false
  const frames: any[] = []
  const transport = { publish: async ({ payload }: any) => {
    if (payload.directoryChanged && fail) throw new Error('temporary publish failure')
    frames.push(payload); return { sequence: 1 }
  } } as unknown as DshRemoteRealtimeTransport
  const host = new DshSessionChannelHost({ transport, target: { runtimeRef: 'runtime', hostProfileRef: 'p', hostClientRef: 'c', hostLeaseGeneration: 1 },
    epoch: () => epoch, native: vi.fn(), failed: vi.fn() })
  const notifications = () => frames.filter(frame => frame.directoryChanged).length
  try {
    await host.directoryChanged(['session'], 'same')
    await host.directoryChanged(['session'], 'same')
    expect(notifications()).toBe(1)
    epoch = 2; fail = true
    await expect(host.directoryChanged(['session'], 'same')).rejects.toThrow('temporary')
    fail = false
    await host.directoryChanged(['session'], 'same')
    expect(notifications()).toBe(2)
    await host.directoryChanged(['session'], 'same')
    expect(notifications()).toBe(2)
    await host.directoryChanged([], 'removed')
    expect(notifications()).toBe(3)
  } finally { host.close() }
})

it('publishes the committed directory before waiting for readiness acknowledgements and serves immediate selection', async () => {
  const listeners = new Set<(payload: any, metadata: DshRemoteTrustedEventMetadata) => void>()
  let releaseReady!: () => void
  const readyAck = new Promise<void>(resolve => { releaseReady = resolve })
  const frames: any[] = []
  const transport = {
    subscribeDisconnect: () => () => {},
    subscribe: async ({ onEvent }: any) => { listeners.add(onEvent); return () => { listeners.delete(onEvent) } },
    publish: async ({ payload, direction }: any) => {
      frames.push(payload)
      if (payload.ready) await readyAck
      for (const receive of [...listeners]) receive(payload, { senderRole: direction === 'request' ? 'controller' : 'host' })
      return { sequence: 1 }
    },
  } as unknown as DshRemoteRealtimeTransport
  const native = vi.fn(async () => ({ ok: true, value: { writer: 'successor' } }))
  const host = new DshSessionChannelHost({ transport,
    target: { runtimeRef: 'successor', hostProfileRef: 'p', hostClientRef: 'c', hostLeaseGeneration: 1 },
    canonicalRuntime: () => 'origin', epoch: (runtime, session) => runtime === 'origin' && session === 'session' ? 2 : undefined,
    native, failed: error => { throw error },
  })
  await host.start()
  const client = new DshSessionChannelClient(transport, async () => {}, vi.fn())
  const abort = new AbortController(), changed = vi.fn()
  const observer = client.observeDirectory(abort.signal, changed)
  let publication: Promise<void> | undefined
  try {
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce())
    publication = host.directoryChanged(['session'], 'committed')
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2))
    expect(frames[0]).toMatchObject({ directoryChanged: true })
    expect(await client.request({ runtimeRef: 'origin', sessionRef: 'session' }, {
      mode: 'call', endpoint: 'session/page', payload: { args: { request: { address: { kind: 'session', sessionId: 'session' } } } },
    }, 'select-new-session', abort.signal)).toEqual({ ok: true, value: { writer: 'successor' } })
    expect(native).toHaveBeenCalledOnce()
    releaseReady(); await publication
    await host.directoryChanged(['session'], 'committed')
    expect(changed).toHaveBeenCalledTimes(2)
  } finally {
    releaseReady(); await publication
    abort.abort(); await observer
    client.close(); host.close()
  }
})

it('retries an execution notice failure before remembering the directory fingerprint', async () => {
  let fail = true
  const frames: any[] = []
  const transport = { publish: async ({ payload }: any) => {
    frames.push(payload)
    if (payload.ready && fail) throw new Error('ready acknowledgement lost')
    return { sequence: 1 }
  } } as unknown as DshRemoteRealtimeTransport
  const host = new DshSessionChannelHost({ transport,
    target: { runtimeRef: 'runtime', hostProfileRef: 'p', hostClientRef: 'c', hostLeaseGeneration: 1 },
    epoch: () => 2, native: vi.fn(), failed: vi.fn(),
  })
  try {
    await expect(host.directoryChanged(['session'], 'same')).rejects.toThrow('ready acknowledgement lost')
    fail = false
    await host.directoryChanged(['session'], 'same')
    expect(frames.map(value => value.ready ? 'ready' : 'directory')).toEqual(['directory', 'ready', 'directory', 'ready'])
    await host.directoryChanged(['session'], 'same')
    expect(frames).toHaveLength(4)
  } finally { host.close() }
})

it('keeps one observer connection while A/B exchange execution and sends only to the active writer', async () => {
  const listeners = new Set<(payload: any, metadata: DshRemoteTrustedEventMetadata) => void>()
  const makeTransport = (name: string) => ({
    connect: vi.fn(async () => {}), disconnect: vi.fn(async () => {}), revalidate() {},
    subscribeDisconnect: vi.fn(() => () => {}), registerHost: vi.fn(), unregisterHost: vi.fn(),
    subscribe: vi.fn(async ({ onEvent, signal }: any) => { listeners.add(onEvent); const close = () => { listeners.delete(onEvent) }; signal.addEventListener('abort', close, { once: true }); return close }),
    publish: vi.fn(async ({ payload, direction }: any) => {
      // Real Windows clock may lead the producer by seconds; use the shared protocol window.
      if (payload.kind === 'session.request') payload = { ...payload, expiresAt: payload.expiresAt + 2_000 }
      for (const receive of [...listeners]) receive(payload, { runtimeRef: name, senderRole: direction === 'request' ? 'controller' : 'host', targetHostLeaseGeneration: 1, acceptedAtMillis: Date.now() })
      return { sequence: 1 }
    }),
  } satisfies DshRemoteRealtimeTransport)
  let owner = 'A', epoch = 1
  const failures: unknown[] = [], accepted: string[] = []
  const host = (name: string) => {
    const opened = new Set<string>()
    return new DshSessionChannelHost({ transport: makeTransport(name),
      target: { runtimeRef: name, hostProfileRef: 'profile', hostClientRef: name, hostLeaseGeneration: 1 },
      epoch: (runtime, session) => runtime === 'origin-runtime' && session === 'session-one' ? owner === name ? epoch : owner === 'handoff' ? 0 : -epoch : undefined,
      failed: error => failures.push(error),
      native: async (_runtime, _session, body, signal) => {
        if (body.mode === 'call') { accepted.push(name); return { ok: true, value: name } }
        const id = String(body.streamRef)
        if (!opened.has(id)) { opened.add(id); return { items: [{ type: 'snapshot', cursor: epoch, records: [] }] } }
        return await new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); if (signal.aborted) reject(signal.reason) })
      },
    })
  }
  const a = host('A'), b = host('B'), transport = makeTransport('C'), disconnected = vi.fn()
  await a.start(); await b.start()
  const c = new DshSessionChannelClient(transport, signal => transport.connect({ profileRef: 'profile-C', clientRef: 'client-C', signal }), disconnected)
  const address = { runtimeRef: 'origin-runtime', sessionRef: 'session-one' }, signal = new AbortController().signal
  const open = (streamRef: string) => c.request(address, { mode: 'pull', endpoint: 'session/follow', streamRef, payload: { args: { request: { address: { kind: 'session', sessionId: 'session-one' } } } } }, `open-${streamRef}`, signal)
  const send = (n: number) => c.request(address, { mode: 'call', endpoint: 'session/prompt', payload: { args: { request: { sessionId: 'session-one', mode: 'queue', requestId: `prompt-${n}` } } } }, `request-${n}`, signal)
  const directoryAbort = new AbortController(), directoryChanged = vi.fn()
  const directory = c.observeDirectory(directoryAbort.signal, directoryChanged)
  try {
    await vi.waitFor(() => expect(directoryChanged).toHaveBeenCalledOnce())
    await a.directoryChanged()
    expect(directoryChanged).toHaveBeenCalledTimes(2)
    expect(await open('stream-one')).toMatchObject({ items: [{ cursor: 1 }] })
    expect(await Promise.all([1, 2, 3].map(send))).toEqual(Array(3).fill({ ok: true, value: 'A' }))
    const oldPull = c.request(address, { mode: 'pull', streamRef: 'stream-one' }, 'request-pull', signal)
    a.close() // Abrupt source loss cannot signal end to C. B must resume observation.
    owner = 'handoff'
    const queued = send(4) // No writer is active yet; this request must survive the gap.
    await new Promise(resolve => setTimeout(resolve, 120))
    owner = 'B'; epoch++
    expect(await queued).toEqual({ ok: true, value: 'B' })
    expect(await oldPull).toEqual({ items: [], done: true })
    await c.request(address, { mode: 'close', streamRef: 'stream-one' }, 'close-stream-one', signal)
    a.close() // The observing connection must not depend on the original Host.
    expect(await open('stream-two')).toMatchObject({ items: [{ cursor: 2 }] })
    expect(await send(5)).toEqual({ ok: true, value: 'B' })
    expect(accepted).toEqual(['A', 'A', 'A', 'B', 'B'])
    expect(transport.connect).toHaveBeenCalledOnce(); expect(transport.subscribe).toHaveBeenCalledOnce()
    expect(transport.disconnect).not.toHaveBeenCalled(); expect(disconnected).not.toHaveBeenCalled()
    expect(failures).toEqual([])
  } finally { directoryAbort.abort(); await directory; c.close(); a.close(); b.close() }
})


it('routes typed commands by canonical session across generations without executing queued peer copies', async () => {
  const receivers = new Set<any>(), replies: any[] = [], calls: string[] = [], failures: unknown[] = []
  let owner = 'A'
  const transport = { subscribe: async ({ onEvent }: any) => { receivers.add(onEvent); return () => receivers.delete(onEvent) },
    publish: async ({ payload, direction }: any) => { replies.push(payload); for (const receive of receivers) receive(payload, { senderRole: direction === 'event' ? 'host' : 'controller', acceptedAtMillis: Date.now() }); return { sequence: 1 } },
  } as unknown as DshRemoteRealtimeTransport
  const create = (name: string) => new DshSessionChannelHost({ transport,
    target: { runtimeRef: name, hostProfileRef: name, hostClientRef: name, hostLeaseGeneration: 7 },
    epoch: (runtime, session) => runtime === 'origin' && session === 'session-one' ? owner === name ? 2 : -2 : undefined,
    native: async () => undefined, failed: error => failures.push(error),
    command: async (_runtime, request) => { calls.push(name); return { ...request, kind: 'response', host_generation: 99, status: 'completed', result: { accepted: true } } },
  })
  const a = create('A'), b = create('B'); await a.start(); await b.start()
  const send = (ref: string, role = 'controller') => {
    for (const receive of receivers) receive({ kind: 'session.command', runtimeRef: 'origin', envelope: {
      protocol: 'dsh.remote', protocol_major: 1, kind: 'request', request_ref: ref, host_generation: 1,
      issued_at: Date.now(), execute_before: Date.now() + 10_000, operation: 'session.prompt',
      body: { session_ref: 'session-one', mode: 'queue', content: { type: 'text', text: 'hello' } },
    } }, { senderRole: role, acceptedAtMillis: Date.now() })
  }
  try {
    send('first-request'); await vi.waitFor(() => expect(replies).toHaveLength(1))
    owner = 'B'; a.close()
    await new Promise(resolve => setTimeout(resolve, 130))
    expect(calls).toEqual(['A']) // Reply retired B's buffered copy.
    send('second-request'); await vi.waitFor(() => expect(replies).toHaveLength(2))
    send('untrusted', 'host'); await new Promise(resolve => setTimeout(resolve, 110))
    expect(calls).toEqual(['A', 'B']); expect(failures).toEqual([])
  } finally { a.close(); b.close() }
})

it.each(['completed', 'exit', 'publication-failed'] as const)('keeps a fragmented read with its live producer and recovers after %s', async outcome => {
  const receivers = new Set<(payload: any, metadata: DshRemoteTrustedEventMetadata) => void>()
  const waiting = Promise.withResolvers<void>()
  let owner = 'A', firstPart: any
  const calls: string[] = []
  const metadata = (name: string, role: 'host' | 'controller' | 'service'): DshRemoteTrustedEventMetadata => ({
    runtimeRef: name, senderRole: role, targetHostLeaseGeneration: 7, acceptedAtMillis: Date.now(),
  })
  const emit = (payload: any, meta: DshRemoteTrustedEventMetadata) => { for (const receive of receivers) receive(payload, meta) }
  const transport = (name: string) => ({
    subscribeDisconnect: () => () => {},
    subscribe: async ({ onEvent }: any) => { receivers.add(onEvent); return () => { receivers.delete(onEvent) } },
    publish: async ({ payload, direction, signal }: any) => {
      if (name === 'A' && payload.kind === 'fragment') {
        if (payload.fragment_index === 0) firstPart = payload
        else await Promise.race([waiting.promise, new Promise<void>((_, reject) => {
          if (signal.aborted) reject(signal.reason)
          else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })])
      }
      signal.throwIfAborted()
      emit(payload, metadata(name, direction === 'event' ? 'host' : 'controller'))
      return { sequence: 1 }
    },
  } as unknown as DshRemoteRealtimeTransport)
  const value = { entries: [{ seq: 1, content: 'history'.repeat(12_000) }], hasMore: false }
  const makeHost = (name: string) => new DshSessionChannelHost({ transport: transport(name),
    target: { runtimeRef: name, hostProfileRef: name, hostClientRef: name, hostLeaseGeneration: 7 },
    epoch: () => owner === name ? 2 : -2, native: vi.fn(), failed: vi.fn(),
    command: async (_runtime, request) => { calls.push(name); return { ...request, kind: 'response', status: 'completed', body: {}, result: value } },
  })
  const a = makeHost('A'), b = makeHost('B')
  await a.start(); await b.start()
  const client = new DshSessionChannelClient(transport('C'), async () => {}, vi.fn())
  const request = client.command('origin', { protocol: 'dsh.remote', protocol_major: 1, kind: 'request', request_ref: 'read-with-handoff',
    host_generation: 1, issued_at: Date.now(), execute_before: Date.now() + 3000, operation: 'session.history', body: { session_ref: 'session-one' },
  }, new AbortController().signal)
  void request.catch(() => undefined)
  try {
    await vi.waitFor(() => expect(firstPart).toBeTruthy())
    owner = 'B'
    const failed = { kind: 'session.response', readResponseFailed: { ...firstPart.readResponse, transferRef: firstPart.transfer_ref } }
    emit(failed, metadata('A', 'controller'))
    emit(failed, { ...metadata('A', 'host'), targetHostLeaseGeneration: 6 })
    emit({ ...failed, readResponseFailed: { ...failed.readResponseFailed, transferRef: 'unrelated' } }, metadata('A', 'host'))
    emit({ kind: 'session.presence', runtimeRef: 'A', leaseGeneration: 6, online: false }, metadata('A', 'service'))
    await new Promise(resolve => setTimeout(resolve, 180))
    expect(calls).toEqual(['A'])
    if (outcome === 'exit') {
      a.close()
      emit({ kind: 'session.presence', runtimeRef: 'A', leaseGeneration: 7, online: false }, metadata('A', 'service'))
    } else if (outcome === 'publication-failed') waiting.reject(new Error('partial publish failed while service remains online'))
    else waiting.resolve()
    await expect(request).resolves.toEqual(value)
    expect(calls).toEqual(outcome === 'completed' ? ['A'] : ['A', 'B'])
  } finally { waiting.resolve(); client.close(); a.close(); b.close() }
})

it('does not let an old producer first fragment or release replace a newer live read producer', async () => {
  let receive!: (payload: any, metadata: DshRemoteTrustedEventMetadata) => void, active = false
  const command = vi.fn(async (_runtime, request) => ({ ...request, kind: 'response' as const, status: 'completed' as const, body: {}, result: {} }))
  const transport = { subscribe: async ({ onEvent }: any) => { receive = onEvent; return () => {} }, publish: vi.fn(async () => ({ sequence: 1 })) } as unknown as DshRemoteRealtimeTransport
  const host = new DshSessionChannelHost({ transport, target: { runtimeRef: 'C', hostProfileRef: 'C', hostClientRef: 'C', hostLeaseGeneration: 1 },
    epoch: () => active ? 3 : -3, command, native: vi.fn(), failed: vi.fn() })
  const metadata = (runtimeRef: string, senderRole: 'host' | 'service' | 'controller'): DshRemoteTrustedEventMetadata => ({ runtimeRef, senderRole, targetHostLeaseGeneration: 7, acceptedAtMillis: Date.now() })
  const request = { protocol: 'dsh.remote', protocol_major: 1, kind: 'request', request_ref: 'read-standby', host_generation: 1,
    issued_at: Date.now(), execute_before: Date.now() + 3000, operation: 'session.history', body: { session_ref: 'session' } }
  const correlation = { runtimeRef: 'origin', requestRef: request.request_ref, sessionRef: 'session', operation: 'session.history' }
  const frames = (seed: string) => dshRemoteOutboundPayloads({ kind: 'session.response', runtimeRef: 'origin', envelope: { ...request, kind: 'response', body: {}, status: 'completed', result: { entries: [] } } }, seed)
    .map(frame => ({ ...(frame.value as Record<string, unknown>), readResponse: correlation }))
  const a = frames('A'), b = frames('B')
  await host.start()
  try {
    receive({ kind: 'session.command', runtimeRef: 'origin', envelope: request }, metadata('controller', 'controller'))
    receive(a[0], metadata('A', 'host'))
    receive({ kind: 'session.presence', runtimeRef: 'A', leaseGeneration: 7, online: false }, metadata('A', 'service'))
    receive(b[0], metadata('B', 'host'))
    active = true
    receive({ ...b[1], chunk: '*' }, metadata('controller', 'controller'))
    receive({ ...b[1], kind: 'invalid' }, metadata('controller', 'controller'))
    receive({ ...b[1], chunk: '*' }, metadata('A', 'host'))
    receive(a[0], metadata('A', 'host'))
    receive({ kind: 'session.response', readResponseFailed: { ...correlation, transferRef: a[0]!.transfer_ref } }, metadata('A', 'host'))
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(command).not.toHaveBeenCalled()
    for (const frame of b.slice(1)) receive(frame, metadata('B', 'host'))
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(command).not.toHaveBeenCalled()
  } finally { host.close() }
})

it('bounds a partial read reservation by the existing fragment validation and lifetime', () => {
  const now = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  const correlation = { runtimeRef: 'origin', requestRef: 'read', sessionRef: 'session', operation: 'session.history' }
  const frames = dshRemoteOutboundPayloads({ entries: [] }, 'reader-life').map(frame => ({ ...(frame.value as Record<string, unknown>), readResponse: correlation }))
  const reader = new DshRemoteFragmentReader()
  try {
    reader.accept(frames[0]!)
    expect(reader.hasTransfer(String(frames[0]!.transfer_ref))).toBe(true)
    expect(() => reader.accept({ ...frames[1], readResponse: { ...correlation, sessionRef: 'different' } })).toThrow('分片信息冲突')
    expect(reader.hasTransfer(String(frames[0]!.transfer_ref))).toBe(false)
    reader.accept(frames[0]!)
    clock.mockReturnValue(now + 45_001)
    expect(reader.hasTransfer(String(frames[0]!.transfer_ref))).toBe(false)
  } finally { clock.mockRestore() }
})

it.each(['failed', 'offline', 'replaced'] as const)('releases only the authenticated partial read reservation after %s', reason => {
  const reader = new DshRemoteFragmentReader(128), a = { runtimeRef: 'A', leaseGeneration: 7 }, b = { runtimeRef: 'B', leaseGeneration: 8 }
  const readResponse = { runtimeRef: 'origin', requestRef: 'large-read', sessionRef: 'session', operation: 'session.history' }
  const frame = (seed: string) => ({ ...(dshRemoteOutboundPayloads({ entries: [] }, seed)[0]!.value as Record<string, unknown>), payload_bytes: 33 * 1024 * 1024, readResponse })
  const old = frame('old'), next = frame('new'), release = { ...readResponse, transferRef: old.transfer_ref }
  reader.accept(old, a)
  expect(() => reader.accept(next, b)).toThrow('超过接收上限')
  reader.releaseReadResponse(release, b)
  reader.releaseReadResponse({ ...release, requestRef: 'other' }, a)
  reader.releaseReadResponse(release, { ...a, leaseGeneration: 6 })
  reader.releaseProducer('A', 6, false)
  expect(reader.hasTransfer(String(old.transfer_ref))).toBe(true)
  if (reason === 'failed') reader.releaseReadResponse(release, a)
  else reader.releaseProducer('A', reason === 'offline' ? 7 : 8, reason === 'replaced')
  expect(reader.hasTransfer(String(old.transfer_ref))).toBe(false)
  expect(() => reader.accept(next, b)).not.toThrow()
  expect(reader.hasTransfer(String(next.transfer_ref))).toBe(true)
})

it.each(['failed', 'offline'] as const)('keeps the Node caller pending when a >32MiB read resumes after %s', reason => {
  let receive!: (value: any, metadata: DshRemoteTrustedEventMetadata) => void
  const transport = { subscribeDisconnect: () => () => {}, subscribe: async ({ onEvent }: any) => { receive = onEvent; return () => {} }, publish: vi.fn(async () => ({ sequence: 1 })) } as unknown as DshRemoteRealtimeTransport
  const client = new DshSessionChannelClient(transport, async () => {}, vi.fn())
  const now = Date.now(), envelope = { protocol: 'dsh.remote' as const, protocol_major: 1 as const, kind: 'request' as const,
    request_ref: 'read-budget', host_generation: 1, issued_at: now, execute_before: now + 3000, operation: 'session.history' as const, body: { session_ref: 'session' } }
  const readResponse = { runtimeRef: 'origin', requestRef: envelope.request_ref, sessionRef: 'session', operation: 'session.history' }
  const frame = (seed: string) => ({ ...(dshRemoteOutboundPayloads({ entries: [] }, seed)[0]!.value as Record<string, unknown>), payload_bytes: 33 * 1024 * 1024, readResponse })
  const old = frame('old'), next = frame('new')
  const meta = (runtimeRef: string, senderRole: 'host' | 'service' = 'host'): DshRemoteTrustedEventMetadata => ({ runtimeRef, senderRole, targetHostLeaseGeneration: 7, acceptedAtMillis: now })
  let rejected = false
  const request = client.command('origin', envelope, new AbortController().signal).catch(() => { rejected = true })
  return (async () => {
    try {
      await vi.waitFor(() => expect(transport.publish).toHaveBeenCalledOnce())
      receive(old, meta('A'))
      receive(reason === 'failed' ? { kind: 'session.response', readResponseFailed: { ...readResponse, transferRef: old.transfer_ref } }
        : { kind: 'session.presence', runtimeRef: 'A', leaseGeneration: 7, online: false }, meta('A', reason === 'failed' ? 'host' : 'service'))
      receive(next, meta('B'))
      await Promise.resolve(); await Promise.resolve()
      expect(rejected).toBe(false)
    } finally { client.close(); await request }
  })()
})

it('waits for a successor opening before ending only the old native generation and ignores its late frames', async () => {
  let receiver: any
  const transport = { subscribeDisconnect: () => () => {}, subscribe: async ({ onEvent }: any) => { receiver = onEvent; return () => {} },
    publish: vi.fn(async () => ({ sequence: 1 })) } as unknown as DshRemoteRealtimeTransport
  const client = new DshSessionChannelClient(transport, async () => {}, vi.fn()), signal = new AbortController().signal
  const address = { runtimeRef: 'origin', sessionRef: 'session' }
  const send = (epoch: number, value?: any, error?: any) => receiver({ kind: 'session.response', ...address, requestRef: 'open', streamRef: 'stream', epoch, value, error }, { senderRole: 'host' })
  try {
    const opening = client.request(address, { mode: 'pull', endpoint: 'session/control', streamRef: 'stream', payload: { args: {} } }, 'open', signal)
    await vi.waitFor(() => expect(transport.publish).toHaveBeenCalledOnce())
    send(1, { items: [{ type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } }] })
    expect(await opening).toMatchObject({ items: [{ type: 'baseline' }], done: false })
    const next = client.request(address, { mode: 'pull', streamRef: 'stream' }, 'pull', signal)
    let settled = false; void next.then(() => { settled = true })
    send(1, { items: [], done: true })
    await new Promise(resolve => setTimeout(resolve, 120))
    expect(settled).toBe(false)
    expect(transport.publish).toHaveBeenCalledTimes(2)
    send(2, { items: [{ type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } }] })
    expect(await next).toEqual({ items: [], done: true })
    send(1, { items: [{ type: 'projection', sessionId: 'session', key: 'bad', value: true, seq: 999999 }] })
    expect(transport.publish).toHaveBeenCalledTimes(2)
  } finally { client.close() }
})

it('does not turn an unknown native business error into a retryable carrier failure', async () => {
  const listeners = new Set<any>(), replies: any[] = []
  const transport = { subscribe: async ({ onEvent }: any) => { listeners.add(onEvent); return () => listeners.delete(onEvent) },
    publish: async ({ payload }: any) => { replies.push(payload); return { sequence: replies.length } } } as unknown as DshRemoteRealtimeTransport
  const host = new DshSessionChannelHost({ transport, target: { runtimeRef: 'origin', hostProfileRef: 'p', hostClientRef: 'c', hostLeaseGeneration: 1 },
    epoch: () => 1, native: async () => { throw new Error('bad projection contract') }, failed: () => {} })
  await host.start()
  try {
    for (const receive of listeners) receive({ kind: 'session.request', runtimeRef: 'origin', sessionRef: 'session', requestRef: 'request-native', expiresAt: Date.now() + 10000,
      body: { mode: 'pull', endpoint: 'session/control', streamRef: 'stream-native', payload: { args: {} } } }, { senderRole: 'controller' })
    await vi.waitFor(() => expect(replies).toHaveLength(1))
    expect(replies[0].error).toEqual({ code: 'REMOTE_TRANSPORT_FAILED', message: 'bad projection contract', retryable: false })
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(replies).toHaveLength(1)
  } finally { host.close() }
})

it.each(['native', 'call'] as const)('does not turn a successful %s result into an execution error when its publish ACK times out', async owner => {
  vi.useFakeTimers()
  let receive: any, rejectAck!: (error: Error) => void
  const ack = new Promise<never>((_resolve, reject) => { rejectAck = reject })
  const replies: any[] = [], failed = vi.fn()
  const transport = { subscribe: async ({ onEvent }: any) => { receive = onEvent; return () => {} },
    publish: vi.fn(async ({ payload }: any) => { replies.push(payload); await ack; return { sequence: 1 } }),
  } as unknown as DshRemoteRealtimeTransport
  const native = vi.fn(async () => ({ accepted: true })), call = vi.fn(async () => ({ accepted: true }))
  const host = new DshSessionChannelHost({ transport,
    target: { runtimeRef: 'origin', hostProfileRef: 'p', hostClientRef: 'c', hostLeaseGeneration: 1 },
    epoch: () => 1, native, ...(owner === 'call' ? { call } : {}), failed })
  const request = { kind: 'session.request', runtimeRef: 'origin', sessionRef: 'session', requestRef: 'accepted-once', expiresAt: Date.now() + 30000,
    body: { mode: 'call', endpoint: 'session/prompt', payload: { args: { request: { sessionId: 'session', mode: 'queue', requestId: 'prompt-once' } } } } }
  try {
    await host.start()
    receive(request, { senderRole: 'controller' })
    await vi.advanceTimersByTimeAsync(250)
    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({ requestRef: request.requestRef, value: { accepted: true } })
    // A duplicate while the original ACK is outstanding must not run again.
    receive(request, { senderRole: 'controller' })
    const timeout = new DshRemoteError('REMOTE_TRANSPORT_FAILED', 'Realtime channel.published 响应超时', true)
    rejectAck(timeout)
    await vi.advanceTimersByTimeAsync(1000)
    expect(failed).toHaveBeenCalledExactlyOnceWith(timeout)
    expect(replies).toHaveLength(1)
    expect(owner === 'call' ? call : native).toHaveBeenCalledOnce()
    expect(owner === 'call' ? native : call).not.toHaveBeenCalled()
  } finally { host.close(); vi.useRealTimers() }
})

it.each(['native', 'call'] as const)('returns an actual %s execution failure in one error response', async owner => {
  vi.useFakeTimers()
  let receive: any
  const replies: any[] = [], failed = vi.fn()
  const transport = { subscribe: async ({ onEvent }: any) => { receive = onEvent; return () => {} },
    publish: vi.fn(async ({ payload }: any) => { replies.push(payload); return { sequence: 1 } }),
  } as unknown as DshRemoteRealtimeTransport
  const error = new DshRemoteError('REMOTE_PERMISSION_DENIED', 'execution denied', false)
  const execute = vi.fn(async () => { throw error })
  const host = new DshSessionChannelHost({ transport,
    target: { runtimeRef: 'origin', hostProfileRef: 'p', hostClientRef: 'c', hostLeaseGeneration: 1 },
    epoch: () => 1, native: execute, ...(owner === 'call' ? { call: execute } : {}), failed })
  try {
    await host.start()
    receive({ kind: 'session.request', runtimeRef: 'origin', sessionRef: 'session', requestRef: 'failed-once', expiresAt: Date.now() + 30000,
      body: { mode: 'call', endpoint: 'session/prompt', payload: { args: { request: { sessionId: 'session', mode: 'queue', requestId: 'prompt-failed' } } } } }, { senderRole: 'controller' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(execute).toHaveBeenCalledOnce()
    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({ requestRef: 'failed-once', error: { code: error.code, message: error.message, retryable: false } })
    expect(replies[0]).not.toHaveProperty('value')
    expect(failed).not.toHaveBeenCalled()
  } finally { host.close(); vi.useRealTimers() }
})

it('only reopens the addressed session after a cold successor advertises its canonical ownership', async () => {
  let receiver: any
  const payloads: any[] = []
  const transport = { subscribeDisconnect: () => () => {}, subscribe: async ({ onEvent }: any) => { receiver = onEvent; return () => {} },
    publish: async ({ payload }: any) => { payloads.push(payload); return { sequence: payloads.length } } } as unknown as DshRemoteRealtimeTransport
  const client = new DshSessionChannelClient(transport, async () => {}, vi.fn())
  const abort = new AbortController()
  const open = (session: string) => client.request({ runtimeRef: 'origin', sessionRef: session }, { mode: 'pull', streamRef: session,
    endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId: session } } } } }, `open-${session}`, abort.signal).catch(() => undefined)
  const first = open('one'), second = open('two')
  await vi.waitFor(() => expect(payloads).toHaveLength(2))
  const metadata = { senderRole: 'host', runtimeRef: 'successor', acceptedAtMillis: Date.now(), targetHostLeaseGeneration: 200 }
  receiver({ kind: 'session.response', ready: true }, metadata)
  receiver({ kind: 'session.response', ready: true, runtimeRef: 'unrelated' }, metadata)
  await Promise.resolve(); expect(payloads).toHaveLength(2)
  receiver({ kind: 'session.response', ready: true, runtimeRef: 'origin', sessionRef: 'one', epoch: 2 }, metadata)
  await vi.waitFor(() => expect(payloads).toHaveLength(3))
  expect(payloads[2]).toMatchObject({ sessionRef: 'one', requestRef: 'open-one', body: { mode: 'pull' } })
  abort.abort(); await Promise.all([first, second]); client.close()
})

it('does not broadcast readiness on lease renewal and announces only changed session epochs', async () => {
  const frames: any[] = []
  const transport = { subscribe: async () => () => {}, publish: async ({ payload }: any) => { frames.push(payload); return { sequence: frames.length } } } as unknown as DshRemoteRealtimeTransport
  let epoch = 2
  const host = new DshSessionChannelHost({ transport, target: { runtimeRef: 'successor', hostProfileRef: 'p', hostClientRef: 'c', hostLeaseGeneration: 0 },
    canonicalRuntime: () => 'origin', epoch: () => epoch, native: async () => undefined, failed: error => { throw error } })
  await host.start(); host.activate(2); host.activate(3)
  await host.directoryChanged(['one']); await host.directoryChanged(['one'])
  epoch++; await host.directoryChanged(['one'])
  expect(frames.filter(value => value.ready)).toEqual([
    { kind: 'session.response', runtimeRef: 'successor', ready: true },
    { kind: 'session.response', runtimeRef: 'origin', sessionRef: 'one', epoch: 2, ready: true },
    { kind: 'session.response', runtimeRef: 'origin', sessionRef: 'one', epoch: 3, ready: true },
  ])
  host.close()
})

it('resets only a confirmed replay gap cursor and partial fragments without replaying commands', async () => {
  let receive: any, failed: any
  const transport = { subscribeDisconnect: () => () => {},
    subscribe: async ({ onEvent, onError }: any) => { receive = onEvent; failed = onError; return () => {} },
    publish: vi.fn(async () => ({ sequence: 1 })),
  } as unknown as DshRemoteRealtimeTransport
  const client = new DshSessionChannelClient(transport, async () => {}, vi.fn())
  const signal = new AbortController().signal
  const request = (id: string) => ({ protocol: 'dsh.remote' as const, protocol_major: 1 as const,
    kind: 'request' as const, request_ref: id, host_generation: 1, issued_at: Date.now(),
    execute_before: Date.now() + 2000, operation: 'snapshot.get' as const, body: {} })
  const old = request('before-gap'), fresh = request('after-gap')
  const response = (envelope: ReturnType<typeof request>) => dshRemoteOutboundPayloads({ kind: 'session.response', runtimeRef: 'host',
    envelope: { ...envelope, kind: 'response', status: 'completed', result: { marker: envelope.request_ref, items: [] } },
  }, 'reused-transfer').map(frame => ({ ...frame, value: { ...(frame.value as object), transfer_ref: 'same-transfer-id' } }))
  const before = client.command('host', old, signal)
  const rejected = expect(before).rejects.toMatchObject({ code: 'REPLAY_GAP' })
  try {
    await vi.waitFor(() => expect(transport.publish).toHaveBeenCalledTimes(1))
    receive(response(old)[0]!.value, { senderRole: 'host', transportSequence: 16760 })
    // This callback follows the transport's authoritative replay rejection.
    failed(new DshRemoteError('REPLAY_GAP', 'expired shared sequence', true))
    await rejected
    const after = client.command('host', fresh, signal)
    const completed = expect(after).resolves.toEqual({ marker: 'after-gap', items: [] })
    await vi.waitFor(() => expect(transport.publish).toHaveBeenCalledTimes(2))
    const frames = response(fresh)
    receive(frames[0]!.value, { senderRole: 'host', transportSequence: 1 })
    // Normal duplicates remain ignored, rather than being treated as resets.
    receive(response(old)[0]!.value, { senderRole: 'host', transportSequence: 1 })
    receive(frames[1]!.value, { senderRole: 'host', transportSequence: 2 })
    await completed
    expect(transport.publish).toHaveBeenCalledTimes(2)
  } finally { client.close() }
})

it('records body-free sizes and aggregate ACK timing for a fragmented stable typed response', async () => {
  let receive: (payload: any, metadata: any) => void = () => {}
  const onDiagnostic = vi.fn(), published: any[] = []
  const transport = { subscribe: async ({ onEvent }: any) => { receive = onEvent; return () => {} },
    publish: async ({ payload }: any) => { published.push(payload); return { sequence: published.length } },
  } as unknown as DshRemoteRealtimeTransport
  const value = { privateBody: 'sensitive-body'.repeat(8000) }
  const host = new DshSessionChannelHost({ transport, target: { runtimeRef: 'runtime', hostProfileRef: 'p', hostClientRef: 'c', hostLeaseGeneration: 1 },
    epoch: () => 1, native: vi.fn(), failed: vi.fn(), onDiagnostic,
    command: async (_runtime, request) => ({ ...request, kind: 'response', status: 'completed', result: value }),
  })
  try {
    await host.start()
    receive({ kind: 'session.command', runtimeRef: 'runtime', envelope: { protocol: 'dsh.remote', protocol_major: 1, kind: 'request',
      request_ref: 'measure-history', host_generation: 1, issued_at: Date.now(), execute_before: Date.now() + 2000,
      operation: 'session.history', body: { session_ref: 'session' } } }, { senderRole: 'controller', transportSequence: 44 })
    await vi.waitFor(() => expect(onDiagnostic).toHaveBeenCalledWith('host_response_publish_finished', expect.objectContaining({
      stage: 'sessions_v1', request_ref: 'measure-history', operation: 'session.history',
      payload_bytes: expect.any(Number), fragment_count: 4, frame_ack_max_ms: expect.any(Number), publish_ack_ms: expect.any(Number), completed: true,
    })))
    expect(published).toHaveLength(4)
    expect(onDiagnostic.mock.calls.map(([event]) => event)).toEqual(['host_request_received', 'host_request_processed', 'host_response_publish_finished'])
    expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain('sensitive-body')
  } finally { host.close() }
})


it('recovers an opening cold local owner once and serves the original account subscription', async () => {
  const listeners = new Set<(payload: any, metadata: any) => void>()
  const transport = {
    subscribeDisconnect: () => () => {},
    subscribe: async ({ onEvent }: any) => { listeners.add(onEvent); return () => { listeners.delete(onEvent) } },
    publish: async ({ payload, direction }: any) => { for (const receive of [...listeners]) receive(payload, { senderRole: direction === 'request' ? 'controller' : 'host' }); return { sequence: 1 } },
  } as unknown as DshRemoteRealtimeTransport
  let epoch = -1
  const recover = vi.fn(async () => { epoch = 2 })
  const native = vi.fn(async () => ({ items: [{ type: 'snapshot', cursor: 18, records: [] }], done: true }))
  const failed = vi.fn()
  const host = new DshSessionChannelHost({ transport, target: { runtimeRef: 'successor', hostProfileRef: 'p', hostClientRef: 'c', hostLeaseGeneration: 1 },
    epoch: () => epoch, recover, native, failed } as any)
  await host.start()
  const client = new DshSessionChannelClient(transport, async () => {}, vi.fn())
  const cancel = new AbortController()
  try {
    const result = client.request({ runtimeRef: 'canonical', sessionRef: 'cold' }, { mode: 'pull', streamRef: 'cold-read', endpoint: 'session/follow',
      payload: { args: { request: { address: { kind: 'session', sessionId: 'cold' } } } } }, 'cold-opening', cancel.signal)
    const caught = result.catch(error => error)
    expect(await Promise.race([caught, new Promise(resolve => setTimeout(() => resolve('stalled'), 500))])).toMatchObject({ items: [{ type: 'snapshot', cursor: 18 }] })
    expect(recover).toHaveBeenCalledOnce()
    expect(native).toHaveBeenCalledOnce()
    expect(failed).not.toHaveBeenCalled()
  } finally { cancel.abort(); client.close(); host.close() }
})


it('restores a cold typed history through the same opening hook without retrying writes', async () => {
  let receive: any, epoch = -1
  const transport = { subscribe: async ({ onEvent }: any) => { receive = onEvent; return () => {} }, publish: vi.fn(async () => ({ sequence: 1 })) } as any
  const recover = vi.fn(async () => { epoch = 2 })
  const command = vi.fn(async (_runtime, request) => ({ ...request, kind: 'response', status: 'completed', result: { entries: [] } }))
  const failed = vi.fn(), host = new DshSessionChannelHost({ transport, target: { runtimeRef: 'successor', hostProfileRef: 'p', hostClientRef: 'c', hostLeaseGeneration: 1 },
    epoch: () => epoch, recover, command, native: vi.fn(), failed })
  await host.start()
  const envelope = (operation: string, request_ref: string) => ({ protocol: 'dsh.remote', protocol_major: 1, kind: 'request', host_generation: 1,
    issued_at: Date.now(), execute_before: Date.now() + 2000, operation, request_ref, body: { session_ref: 'cold' } })
  try {
    receive({ kind: 'session.command', runtimeRef: 'canonical', envelope: envelope('session.cancel', 'cold-write') }, { senderRole: 'controller' })
    expect(recover).not.toHaveBeenCalled(); expect(command).not.toHaveBeenCalled()
    receive({ kind: 'session.command', runtimeRef: 'canonical', envelope: envelope('session.history', 'cold-read') }, { senderRole: 'controller' })
    await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(2))
    expect(recover).toHaveBeenCalledExactlyOnceWith('canonical', 'cold', { operation: 'session.history', session_ref: 'cold' }, expect.any(AbortSignal))
    expect(command.mock.calls.map(([, request]) => request.request_ref).sort()).toEqual(['cold-read', 'cold-write'])
    expect(failed).not.toHaveBeenCalled()
  } finally { host.close() }
})


it('does not resume cloud leases from a late ready after the account consumer is closed', async () => {
  let receive: any
  const transport = { subscribeDisconnect: () => () => {}, subscribe: async ({ onEvent }: any) => { receive = onEvent; return () => {} } } as any
  const resume = vi.fn(), client = new DshSessionChannelClient(transport, async () => {}, vi.fn(), resume)
  await vi.waitFor(() => expect(receive).toBeTypeOf('function'))
  client.close()
  receive({ kind: 'session.response', runtimeRef: 'canonical', sessionRef: 'cold', ready: true, epoch: 2 }, { senderRole: 'host' })
  expect(resume).not.toHaveBeenCalled()
})
