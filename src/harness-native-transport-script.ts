import type { DshAccountSession } from './dsh-remote/account-session-types.js'

export interface HarnessNativeDirectory {
  publish(rows: readonly DshAccountSession[]): void
  writable(sessionId: string): boolean
  select(sessionId: string | undefined): void
}
export type HarnessNativeWindow = Window & { __ARKME_NATIVE_DIRECTORY__?: HarnessNativeDirectory }

/** One native client per account. Routing identities never enter stored source journals. */
function installNativeTransport(route: string): void {
  if (new URLSearchParams(window.location.search).get('arkme-harness-embed') !== '1') return
  const surface = window.frameElement?.parentElement
  if (!surface?.getAttribute('data-arkme-account-id')) return
  const lifetime = new AbortController()
  const writable = new Map<string, boolean>()
  let selected: string | undefined
  const identity = (runtime: string, id: string) => `arkme:${encodeURIComponent(runtime)}:${encodeURIComponent(id)}`
  const split = (id: unknown): { runtime: string; id: string } | undefined => {
    if (typeof id !== 'string' || !id.startsWith('arkme:')) return
    const parts = id.split(':')
    if (parts.length !== 3) throw new Error('会话来源标识无效')
    const runtime = decodeURIComponent(parts[1]!), value = decodeURIComponent(parts[2]!)
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(runtime) || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new Error('会话来源标识无效')
    return { runtime, id: value }
  }
  const availability = () => surface.setAttribute('data-arkme-source-writable', String(!split(selected) || writable.get(split(selected)!.runtime) === true))
  type Json = Record<string, any>
  const rows = new Map<string, DshAccountSession>()
  const summary = (row: DshAccountSession) => ({ sessionId: identity(row.runtimeRef, row.sessionRef), updatedAt: row.updatedAt,
    running: row.running, blank: row.blank, projections: { asOfSeq: row.projectionAsOfSeq ?? -1, values: { title: row.title || null } } })

  // Bounded queues hold protocol frames, never another copy of conversation state.
  function inbox(signal: AbortSignal) {
    const values: Array<{ value: unknown; bytes: number }> = []
    let bytes = 0
    let wake: (() => void) | undefined, failure: unknown, ended = false
    const abort = () => { failure = signal.reason; wake?.() }
    signal.addEventListener('abort', abort, { once: true })
    return {
      push(value: unknown) { if (ended || failure) return; const size = JSON.stringify(value).length * 2; if (values.length >= 2048 || bytes + size > 64 * 1024 * 1024) { this.fail(new Error('会话订阅消费过慢')); return }; bytes += size; values.push({ value, bytes: size }); wake?.() },
      fail(error: unknown) { failure = error; wake?.() },
      end() { ended = true; wake?.() },
      async *read() {
        try { while (true) { signal.throwIfAborted(); if (failure) throw failure; if (values.length) { const item = values.shift()!; bytes -= item.bytes; yield item.value } else if (ended) return; else await new Promise<void>(resolve => { wake = resolve }) } }
        finally { signal.removeEventListener('abort', abort); values.length = 0; ended = true }
      },
    }
  }
  const events = new Set<ReturnType<typeof inbox>>(), controls = new Set<ReturnType<typeof inbox>>()
  const emit = (frame: Json) => { for (const queue of events) queue.push(frame) }
  const control = (frame: Json) => { for (const queue of controls) queue.push(frame) }
  Object.assign(window, { __ARKME_NATIVE_DIRECTORY__: {
    publish(incoming: readonly DshAccountSession[]) {
      const next = new Map(incoming.filter(row => !row.local && !row.archived && row.origin !== 'subagent').map(row => [identity(row.runtimeRef, row.sessionRef), row]))
      for (const id of rows.keys()) if (!next.has(id)) emit({ type: 'emit', event: 'api-session/removed', args: [id] })
      for (const [id, row] of next) {
        writable.set(row.runtimeRef, row.presence === 'online' && row.capabilities.includes('session.native'))
        const old = rows.get(id)
        if (!old || old.title !== row.title || old.blank !== row.blank || old.projectionAsOfSeq !== row.projectionAsOfSeq) emit({ type: 'emit', event: 'api-session/added', args: [summary(row)] })
        if (old && old.updatedAt !== row.updatedAt) emit({ type: 'emit', event: 'api-session/activity', args: [id, row.updatedAt] })
        // Native additions seed new sessions; only status updates an existing session's running bit.
        if (old && old.running !== row.running) emit({ type: 'emit', event: 'api-session/status', args: [id, row.running] })
      }
      rows.clear(); for (const [id, row] of next) rows.set(id, row)
      for (const runtime of writable.keys()) if (![...rows.values()].some(row => row.runtimeRef === runtime)) writable.delete(runtime)
      availability()
    },
    writable(id: string) { const source = split(id); return !source || writable.get(source.runtime) === true },
    select(id: string | undefined) { selected = id; availability() },
  } satisfies HarnessNativeDirectory })
  let socket: WebSocket | undefined
  const pending = new Map<string, { frame: string; resolve(value: unknown): void; reject(error: Error): void; stop(): void }>()
  const streamRequest = (params: object, signal: AbortSignal) => new Promise<unknown>((resolve, reject) => {
    signal.throwIfAborted()
    if (pending.size >= 64) throw new Error('原生订阅请求数量超限')
    if (!socket || socket.readyState > WebSocket.OPEN) {
      for (const item of pending.values()) { item.stop(); item.reject(new Error('原生远程连接已断开')) }
      pending.clear()
      const next = socket = new WebSocket(`${route}/native-streams`)
      const closed = () => {
        if (socket !== next) return
        socket = undefined
        for (const item of pending.values()) { item.stop(); item.reject(new Error('原生远程连接已断开')) }
        pending.clear()
      }
      next.onopen = () => { if (socket !== next) return; for (const item of pending.values()) next.send(item.frame) }
      next.onerror = () => { closed(); next.close() }
      next.onclose = closed
      next.onmessage = event => {
        try {
          const result = JSON.parse(String(event.data)) as { id: string }
          const item = pending.get(result.id)
          if (item) { pending.delete(result.id); item.stop(); item.resolve(result) }
        } catch { closed(); next.close() }
      }
    }
    const id = crypto.randomUUID()
    const abort = () => {
      pending.delete(id)
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id, cancel: true }))
      reject(new DOMException('订阅已取消', 'AbortError'))
    }
    const item = { frame: JSON.stringify({ id, params }), resolve, reject, stop: () => signal.removeEventListener('abort', abort) }
    pending.set(id, item); signal.addEventListener('abort', abort, { once: true })
    if (socket.readyState === WebSocket.OPEN) socket.send(item.frame)
  })
  const request = async (runtimeRef: string, body: object, signal?: AbortSignal) => {
    const scoped = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal
    const params = { runtimeRef, body, requestRef: crypto.randomUUID() }
    let result: { ok: boolean; value: unknown; error?: { message?: string } }
    if (['pull', 'close'].includes(String((body as { mode?: string }).mode))) {
      result = await streamRequest(params, scoped) as typeof result
    } else {
      const response = await fetch(route, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation: 'remote.session.native', params }), signal: scoped,
      })
      result = await response.json() as typeof result
      if (!response.ok) throw new Error(result.error?.message ?? '原生远程连接已断开')
    }
    if (!result.ok) throw new Error(result.error?.message ?? '原生远程连接已断开')
    const value = result.value as { sourceWritable?: boolean }
    if (value.sourceWritable !== undefined) { writable.set(runtimeRef, value.sourceWritable); availability() }
    return result.value
  }

  // Local requests retain the complete native Gateway and its browser authentication.
  // Implement the documented Remote mux carrier, without reaching into Gateway internals.
  let localSocket: WebSocket | undefined
  const localStreams = new Map<string, { frame: string; queue: ReturnType<typeof inbox> }>()
  async function* localStream(endpoint: string, payload: unknown, signal: AbortSignal) {
    const id = crypto.randomUUID(), queue = inbox(signal)
    if (localStreams.size >= 64) throw new Error('原生订阅请求数量超限')
    if (!localSocket || localSocket.readyState > WebSocket.OPEN) {
      const url = new URL('/api/remote.mux', window.location.href); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const next = localSocket = new WebSocket(url)
      const closed = () => { if (localSocket !== next) return; localSocket = undefined; for (const item of localStreams.values()) item.queue.fail(new Error('本机连接已断开')); localStreams.clear() }
      next.onopen = () => { if (localSocket === next) for (const item of localStreams.values()) next.send(item.frame) }
      next.onclose = closed; next.onerror = () => { closed(); next.close() }
      next.onmessage = event => {
        try {
          const frame = JSON.parse(String(event.data)), item = localStreams.get(frame.streamId)
          if (!item) return
          if (frame.type === 'item') item.queue.push(frame.value)
          else if (frame.type === 'end') item.queue.end()
          else if (frame.type === 'error') item.queue.fail(new Error(frame.error?.message || '本机订阅失败'))
          else throw new Error('原生订阅帧无效')
        } catch { closed(); next.close() }
      }
    }
    const carrier = localSocket, frame = JSON.stringify({ type: 'open', streamId: id, endpoint, payload })
    localStreams.set(id, { frame, queue })
    if (carrier.readyState === WebSocket.OPEN) carrier.send(frame)
    try { yield* queue.read() }
    finally { localStreams.delete(id); if (carrier.readyState === WebSocket.OPEN) carrier.send(JSON.stringify({ type: 'cancel', streamId: id })) }
  }
  async function* remoteStream(runtime: string, endpoint: string, payload: unknown, signal: AbortSignal) {
    const streamRef = crypto.randomUUID()
    let opening = true
    try {
      while (!signal.aborted) {
        const page = await request(runtime, { mode: 'pull', streamRef, ...(opening ? { endpoint, payload } : {}) }, signal) as Json
        opening = false
        for (const value of page.items) { signal.throwIfAborted(); yield value }
        if (page.done) return
      }
    } finally { void request(runtime, { mode: 'close', streamRef }).catch(() => undefined) }
  }
  // Decode only declared routing fields. Never recursively rewrite user content.
  function addressed(payload: unknown) {
    const value = structuredClone(payload) as Json, args = value.args ?? {}, body = args.request ?? {}
    let runtime: string | undefined, local = false
    const decode = (owner: Json, key: string) => {
      const source = split(owner[key]); if (!source) { if (typeof owner[key] === 'string') local = true; return }
      if (runtime && runtime !== source.runtime) throw new Error('请求不能跨实例混用会话')
      runtime = source.runtime; owner[key] = source.id
    }
    for (const key of ['agent', 'agentId', 'sessionId', 'parentSessionId']) decode(args, key)
    for (const key of ['sessionId', 'parentSessionId', 'workspaceId']) decode(body, key)
    if (body.address) for (const key of ['sessionId', 'parentSessionId', 'childSessionId']) decode(body.address, key)
    if (runtime && local) throw new Error('请求不能跨实例混用会话')
    return { runtime, payload: value }
  }
  const encodeSummary = (runtime: string, value: Json) => ({ ...value, sessionId: identity(runtime, value.sessionId), ...(value.parentSessionId ? { parentSessionId: identity(runtime, value.parentSessionId) } : {}) })
  function nativeFrame(runtime: string, frame: Json): Json {
    // Journal records remain byte-for-byte semantic source values. Only the
    // envelope header carries the virtual identity used by the native view.
    return { ...frame, ...(frame.header ? { header: { ...frame.header, id: identity(runtime, frame.header.id) } } : {}),
      ...(frame.sessionId ? { sessionId: identity(runtime, frame.sessionId) } : {}) }
  }
  const sources = new Map<string, { users: number; abort: AbortController; clientId?: string; frames: Map<string, { value: Json; bytes: number }>; bytes: number }>()
  function retainSource(runtime: string, signal: AbortSignal): () => void {
    let source = sources.get(runtime)
    if (!source) {
      if (sources.size >= 8) throw new Error('打开的远程实例过多')
      const state = source = { users: 0, abort: new AbortController(), frames: new Map<string, { value: Json; bytes: number }>(), bytes: 0 }; sources.set(runtime, state)
      const scoped = AbortSignal.any([state.abort.signal, lifetime.signal])
      // Keep only the latest control value per field, to replay after a local
      // reconnect baseline. Journals/history remain in the native session store.
      const publish = (frame: Json) => {
        const key = JSON.stringify([frame.sessionId, frame.type, frame.key])
        if (!state.frames.has(key) && state.frames.size >= 32768) throw new Error('远端控制状态数量超限')
        const bytes = JSON.stringify(frame).length * 2
        const total = state.bytes - (state.frames.get(key)?.bytes ?? 0) + bytes
        if (total > 64 * 1024 * 1024) throw new Error('远端控制状态大小超限')
        state.bytes = total; state.frames.set(key, { value: frame, bytes }); control(frame)
      }
      const pump = async (endpoint: string) => {
        while (!scoped.aborted) {
        try {
          for await (const frame of remoteStream(runtime, endpoint, { args: {} }, scoped)) {
            if (endpoint === '$events') {
              if (frame.type === 'ready') { (state as { clientId?: string }).clientId = frame.clientId; continue }
              if (frame.type === 'emit') {
                // Deployment-wide events must not invalidate another source's caches.
                if (!String(frame.event).startsWith('api-session/')) continue
                const args = [...frame.args]
                args[0] = frame.event === 'api-session/added' ? encodeSummary(runtime, args[0]) : identity(runtime, args[0])
                emit({ ...frame, args })
              } else emit({ ...frame, eventId: identity(runtime, frame.eventId), ...(frame.agentId ? { agentId: identity(runtime, frame.agentId) } : {}) })
            } else if (frame.type === 'baseline') {
              for (const { value: previous } of state.frames.values()) {
                if (previous.type === 'queue') control({ ...previous, items: [] })
                else if (previous.type === 'jobs') control({ ...previous, jobs: [] })
              }
              state.frames.clear(); state.bytes = 0
              for (const [id, items] of Object.entries(frame.value.queues)) publish({ type: 'queue', sessionId: identity(runtime, id), items })
              for (const [id, jobs] of Object.entries(frame.value.jobs)) publish({ type: 'jobs', sessionId: identity(runtime, id), jobs })
              for (const [id, block] of Object.entries(frame.value.projections) as Array<[string, Json]>) for (const [key, value] of Object.entries(block.values)) publish({ type: 'projection', sessionId: identity(runtime, id), key, value, seq: block.asOfSeq })
            } else publish(nativeFrame(runtime, frame))
          }
        } catch { if (!scoped.aborted) { writable.set(runtime, false); availability() } }
        if (!scoped.aborted) await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); scoped.removeEventListener('abort', done); resolve() }
          const timer = setTimeout(done, 1000); scoped.addEventListener('abort', done, { once: true })
        })
        }
      }
      void pump('$events'); void pump('session/control')
    }
    source.users++
    let released = false
    const owned = source
    const release = () => { if (released) return; released = true; signal.removeEventListener('abort', release); if (--owned.users === 0) { owned.abort.abort(); sources.delete(runtime); for (const { value: frame } of owned.frames.values()) { if (frame.type === 'queue') control({ ...frame, items: [] }); else if (frame.type === 'jobs') control({ ...frame, jobs: [] }) }; owned.frames.clear() } }
    signal.addEventListener('abort', release, { once: true }); return release
  }
  const failure = (message: string) => ({ ok: false, error: { code: 'CAPABILITY_UNSUPPORTED', message, details: {} } })
  const hooks = {
    async fetch(url: URL, init: RequestInit) {
      if (!url.pathname.startsWith('/api/')) return fetch(url, init)
      const message = JSON.parse(String(init.body)) as Json
      if (url.pathname !== `/api/${message.method}`) throw new Error('原生传输入口不一致')
      const target = addressed(message.payload)
      const event = message.method === '$events/result' ? split(message.payload.args.eventId) : undefined
      if (event) {
        target.runtime = event.runtime; target.payload.args.eventId = event.id
        const clientId = sources.get(event.runtime)?.clientId
        if (!clientId) throw new Error('源实例交互已结束')
        target.payload.args.clientId = clientId
      }
      if (!target.runtime) {
        const response = await fetch(url, init)
        if (message.method !== 'session/list' || !response.ok) return response
        const envelope = await response.json() as Json
        if (envelope.result?.ok) envelope.result.value.items.push(...[...rows.values()].map(summary))
        return Response.json(envelope)
      }
      const endpoint = message.method
      // Phase one: only actions with complete per-session routing are admitted.
      const allowed = ['session/page', 'session/prompt', 'session/cancel', 'session/rename', 'session/updateQueue', 'session/attachment', 'messageFeedback/list', 'messageFeedback/put', 'messageFeedback/delete', 'sessionFeedback/record', 'workspace/archiveSession', '$events/result']
      let result: unknown
      if (!allowed.includes(endpoint)) result = failure('此操作暂需在会话所属电脑执行')
      else result = await request(target.runtime, { mode: 'call', endpoint, payload: target.payload }, init.signal ?? undefined)
      return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
    },
    async *openStream(endpoint: string, payload: unknown, signal: AbortSignal) {
      const scoped = AbortSignal.any([signal, lifetime.signal]), target = addressed(payload)
      if (target.runtime) {
        const release = retainSource(target.runtime, scoped)
        try { for await (const frame of remoteStream(target.runtime, endpoint, target.payload, scoped)) yield nativeFrame(target.runtime, frame) }
        finally { release() }
        return
      }
      if (endpoint !== '$events' && endpoint !== 'session/control') { yield* localStream(endpoint, payload, scoped); return }
      const controller = new AbortController(), combined = AbortSignal.any([scoped, controller.signal]), queue = inbox(combined)
      const listeners = endpoint === '$events' ? events : controls
      try {
        let first = true
        const pump = (async () => {
          try {
            for await (const frame of localStream(endpoint, payload, combined)) {
              queue.push(frame)
              if (endpoint === 'session/control' && (frame as Json).type === 'baseline') for (const source of sources.values()) for (const cached of source.frames.values()) queue.push(cached.value)
              if (first) {
                first = false; listeners.add(queue)
                if (endpoint === '$events') for (const row of rows.values()) queue.push({ type: 'emit', event: 'api-session/added', args: [summary(row)] })
              }
            }
            queue.end()
          } catch (error) { queue.fail(error) }
        })()
        void pump
        yield* queue.read()
      } finally { listeners.delete(queue); controller.abort() }
    },
  }
  Object.assign(window, { __DSH_TRANSPORT__: hooks })
  window.addEventListener('pagehide', () => { lifetime.abort(); socket?.close(); localSocket?.close(); for (const source of sources.values()) source.abort.abort(); sources.clear() }, { once: true })
}

export const harnessNativeTransportScript = (route: string): string => `(${installNativeTransport.toString()})(${JSON.stringify(route)});`
