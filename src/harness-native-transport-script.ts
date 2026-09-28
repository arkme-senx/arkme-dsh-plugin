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
  let selectionKnown = false, selectionChanged = new AbortController()
  const localIdentities = new Set<string>()
  const identity = (runtime: string, id: string) => localIdentities.has(`${runtime}:${id}`) ? id : `arkme:${encodeURIComponent(runtime)}:${encodeURIComponent(id)}`
  const split = (id: unknown): { runtime: string; id: string } | undefined => {
    if (typeof id !== 'string') return
    if (!id.startsWith('arkme:')) { const row = [...rows.values()].find(row => row.localTakeover && row.local && row.sessionRef === id); return row ? { runtime: row.runtimeRef, id } : undefined }
    const parts = id.split(':')
    if (parts.length !== 3) throw new Error('会话来源标识无效')
    const runtime = decodeURIComponent(parts[1]!), value = decodeURIComponent(parts[2]!)
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(runtime) || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new Error('会话来源标识无效')
    return { runtime, id: value }
  }
  const sourceId = (runtime: string, session: string) => JSON.stringify([runtime, session])
  const canWrite = (id: unknown) => { const source = split(id); return !source || writable.get(sourceId(source.runtime, source.id)) === true }
  const availability = () => surface.setAttribute('data-arkme-source-writable', String(canWrite(selected)))
  type Json = Record<string, any>
  const rows = new Map<string, DshAccountSession>()
  const summary = (row: DshAccountSession) => ({ sessionId: identity(row.runtimeRef, row.sessionRef), updatedAt: row.updatedAt,
    running: row.running, blank: row.blank, projections: { asOfSeq: row.projectionAsOfSeq ?? -1, values: { title: row.title || null } } })

  // Bounded queues hold protocol frames, never another copy of conversation state.
  function inbox(signal: AbortSignal) {
    const values: Array<{ value: unknown; bytes: number }> = []
    let bytes = 0
    let wake: (() => void) | undefined, failure: unknown, ended = false, restarting = false
    const abort = () => { failure = signal.reason; wake?.() }
    signal.addEventListener('abort', abort, { once: true })
    return {
      push(value: unknown) { if (ended || failure || restarting) return; const size = JSON.stringify(value).length * 2; if (values.length >= 2048 || bytes + size > 64 * 1024 * 1024) { this.fail(new Error('会话订阅消费过慢')); return }; bytes += size; values.push({ value, bytes: size }); wake?.() },
      fail(error: unknown) { failure = error; wake?.() },
      end() { ended = true; wake?.() },
      restart() { restarting = true; wake?.() },
      async *read() {
        try { while (true) { signal.throwIfAborted(); if (failure) throw failure; if (values.length) { const item = values.shift()!; bytes -= item.bytes; yield item.value } else if (restarting) throw carrierFailure('控制状态已更新，恢复完整基线'); else if (ended) return; else await new Promise<void>(resolve => { wake = resolve }) } }
        finally { signal.removeEventListener('abort', abort); values.length = 0; ended = true }
      },
    }
  }
  const events = new Set<ReturnType<typeof inbox>>(), controls = new Set<ReturnType<typeof inbox>>()
  const emit = (frame: Json) => { for (const queue of events) queue.push(frame) }
  const control = (frame: Json) => { for (const queue of controls) queue.push(frame) }
  const rebaselineControls = () => { for (const queue of controls) queue.restart() }
  const changeSelection = () => {
    const previous = selectionChanged; selectionChanged = new AbortController(); previous.abort()
    for (const key of sources.keys()) releaseUnusedSource(key)
  }
  Object.assign(window, { __ARKME_NATIVE_DIRECTORY__: {
    publish(incoming: readonly DshAccountSession[]) {
      const previousSelection = split(selected)
      localIdentities.clear()
      for (const row of incoming) if (row.local) localIdentities.add(`${row.runtimeRef}:${row.sessionRef}`)
      const next = new Map(incoming.filter(row => (!row.local || row.localTakeover) && !row.archived && row.origin !== 'subagent').map(row => [identity(row.runtimeRef, row.sessionRef), row]))
      for (const id of rows.keys()) if (!next.has(id)) emit({ type: 'emit', event: 'api-session/removed', args: [id] })
      for (const [id, row] of next) {
        const old = rows.get(id)
        if (!old || old.presence !== row.presence || old.capabilities.join() !== row.capabilities.join())
          writable.set(sourceId(row.runtimeRef, row.sessionRef), row.capabilities.includes('session.native.channel') || row.presence === 'online' && row.capabilities.includes('session.native'))
        if (!old || old.title !== row.title || old.blank !== row.blank || old.projectionAsOfSeq !== row.projectionAsOfSeq) emit({ type: 'emit', event: 'api-session/added', args: [summary(row)] })
        if (old && old.updatedAt !== row.updatedAt) emit({ type: 'emit', event: 'api-session/activity', args: [id, row.updatedAt] })
        // Native additions seed new sessions; only status updates an existing session's running bit.
        if (old && old.running !== row.running) emit({ type: 'emit', event: 'api-session/status', args: [id, row.running] })
      }
      rows.clear(); for (const [id, row] of next) rows.set(id, row)
      const currentSources = new Set([...rows.values()].map(row => sourceId(row.runtimeRef, row.sessionRef)))
      for (const id of writable.keys()) if (!currentSources.has(id)) writable.delete(id)
      const currentSelection = split(selected)
      if (selectionKnown && (previousSelection?.runtime !== currentSelection?.runtime || previousSelection?.id !== currentSelection?.id)) changeSelection()
      availability()
    },
    writable: canWrite,
    select(id: string | undefined) {
      if (selectionKnown && selected === id) return
      const previous = split(selected), next = split(id), known = selectionKnown
      selected = id; selectionKnown = true
      // Session Controller retains visited journals off-screen. Only their
      // selected remote source needs live I/O; the native journal keeps its view.
      if (!known || previous?.runtime !== next?.runtime || previous?.id !== next?.id) changeSelection()
      availability()
    },
  } satisfies HarnessNativeDirectory })
  const carrierFailure = (message: string) => Object.assign(new Error(message), { dshRemoteStreamFailure: { kind: 'carrier' } })
  const remoteFailure = (error?: { message?: string; code?: string; retryable?: boolean }) => {
    const message = error?.message ?? '原生远程连接已断开'
    return error?.retryable === true ? carrierFailure(message) : Object.assign(new Error(message), {
      dshRemoteStreamFailure: { kind: 'remote', code: error?.code ?? 'REMOTE_TRANSPORT_FAILED', details: {} },
    })
  }
  const isCarrierFailure = (error: any) => error?.dshRemoteStreamFailure?.kind === 'carrier'
  let socket: WebSocket | undefined
  const pending = new Map<string, { frame: string; resolve(value: unknown): void; reject(error: Error): void; stop(): void }>()
  const streamRequest = (params: object, signal: AbortSignal) => new Promise<unknown>((resolve, reject) => {
    signal.throwIfAborted()
    if (pending.size >= 64) throw new Error('原生订阅请求数量超限')
    if (!socket || socket.readyState > WebSocket.OPEN) {
      for (const item of pending.values()) { item.stop(); item.reject(carrierFailure('原生远程连接已断开')) }
      pending.clear()
      const next = socket = new WebSocket(`${route}/native-streams`)
      const closed = () => {
        if (socket !== next) return
        socket = undefined
        for (const item of pending.values()) { item.stop(); item.reject(carrierFailure('原生远程连接已断开')) }
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
  const request = async (runtimeRef: string, body: object, signal?: AbortSignal, sessionRef?: string) => {
    const scoped = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal
    const anchor = split(selected)
    const session = sessionRef ?? (anchor?.runtime === runtimeRef ? anchor.id : undefined)
    const params = { runtimeRef, body, requestRef: crypto.randomUUID(), ...(session ? { sessionRef: session } : {}) }
    let result: { ok: boolean; value: unknown; error?: { message?: string; code?: string; retryable?: boolean } }
    if (['pull', 'close'].includes(String((body as { mode?: string }).mode))) {
      result = await streamRequest(params, scoped) as typeof result
    } else {
      const response = await fetch(route, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation: 'remote.session.native', params }), signal: scoped,
      })
      result = await response.json() as typeof result
      if (!response.ok) throw remoteFailure(result.error)
    }
    scoped.throwIfAborted()
    if (!result.ok) throw remoteFailure(result.error)
    const value = result.value as { sourceWritable?: boolean }
    if (session && (body as Json).mode !== 'close' && value.sourceWritable !== undefined) { writable.set(sourceId(runtimeRef, session), value.sourceWritable); availability() }
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
      const closed = () => { if (localSocket !== next) return; localSocket = undefined; for (const item of localStreams.values()) item.queue.fail(carrierFailure('本机连接已断开')); localStreams.clear() }
      next.onopen = () => { if (localSocket === next) for (const item of localStreams.values()) next.send(item.frame) }
      next.onclose = closed; next.onerror = () => { closed(); next.close() }
      next.onmessage = event => {
        try {
          const frame = JSON.parse(String(event.data)), item = localStreams.get(frame.streamId)
          if (!item) return
          if (frame.type === 'item') item.queue.push(frame.value)
          else if (frame.type === 'end') item.queue.end()
          else if (frame.type === 'error') item.queue.fail(remoteFailure(frame.error))
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
  async function* remoteStream(runtime: string, endpoint: string, payload: unknown, signal: AbortSignal, sessionRef: string | undefined, sourceKey: string) {
    let delivered = false
    while (!signal.aborted) {
      const streamRef = crypto.randomUUID()
      let opening = true
      try {
        while (!signal.aborted) {
          const page = await request(runtime, { mode: 'pull', streamRef, ...(opening ? { endpoint, payload } : {}) }, signal, sessionRef) as Json
          opening = false
          for (const value of page.items) {
            signal.throwIfAborted(); delivered = true
            const source = sources.get(sourceKey); if (source) source.retryDelay = 250
            yield value
          }
          // These are live subscriptions. Handoff may end the old carrier,
          // including before its first frame; it must not end the logical stream.
          if (page.done) throw carrierFailure('源订阅已结束，正在重新连接')
        }
      } catch (error) {
        signal.throwIfAborted()
        if (!isCarrierFailure(error) || delivered) throw error
        // Before the first frame it is safe to reopen in this generation. After
        // a baseline, let DSH create a new generation and reconcile its journal.
        await retrySource(sourceKey, signal)
      } finally { void request(runtime, { mode: 'close', streamRef }, AbortSignal.timeout(3_000), sessionRef).catch(() => undefined) }
    }
    signal.throwIfAborted()
  }
  // Decode only declared routing fields. Never recursively rewrite user content.
  function addressed(payload: unknown) {
    const value = structuredClone(payload) as Json, args = value.args ?? {}, body = args.request ?? {}
    let runtime: string | undefined, sessionRef: string | undefined, local = false
    const decode = (owner: Json, key: string) => {
      const source = split(owner[key]); if (!source) { if (typeof owner[key] === 'string') local = true; return }
      if (runtime && runtime !== source.runtime) throw new Error('请求不能跨实例混用会话')
      runtime = source.runtime; owner[key] = source.id
      if (key !== 'workspaceId' && key !== 'childSessionId') sessionRef ??= source.id
    }
    for (const key of ['agent', 'agentId', 'sessionId', 'parentSessionId']) decode(args, key)
    for (const key of ['sessionId', 'parentSessionId', 'workspaceId']) decode(body, key)
    if (body.address) for (const key of ['sessionId', 'parentSessionId', 'childSessionId']) decode(body.address, key)
    if (runtime && local) throw new Error('请求不能跨实例混用会话')
    return { runtime, sessionRef, payload: value }
  }
  const encodeSummary = (runtime: string, value: Json) => ({ ...value, sessionId: identity(runtime, value.sessionId), ...(value.parentSessionId ? { parentSessionId: identity(runtime, value.parentSessionId) } : {}) })
  function nativeFrame(runtime: string, frame: Json): Json {
    // Journal records remain byte-for-byte semantic source values. Only the
    // envelope header carries the virtual identity used by the native view.
    return { ...frame, ...(frame.header ? { header: { ...frame.header, id: identity(runtime, frame.header.id) } } : {}),
      ...(frame.sessionId ? { sessionId: identity(runtime, frame.sessionId) } : {}) }
  }
  const sources = new Map<string, { runtime: string; sessionRef: string | undefined; users: number; abort: AbortController; clientId?: string; baseline: Json | undefined; releaseTimer: ReturnType<typeof setTimeout> | undefined; frames: Map<string, { value: Json; bytes: number }>; bytes: number; retryDelay: number; retry: Promise<void> | undefined }>()
  function releaseUnusedSource(key: string) {
    const owned = sources.get(key)
    if (!owned || owned.users) return
    clearTimeout(owned.releaseTimer); owned.abort.abort(); sources.delete(key)
    for (const { value: frame } of owned.frames.values()) {
      if (frame.type === 'queue') control({ ...frame, items: [] })
      else if (frame.type === 'jobs') control({ ...frame, jobs: [] })
    }
    if (owned.baseline) {
      for (const sessionId of Object.keys(owned.baseline.queues)) control({ type: 'queue', sessionId, items: [] })
      for (const sessionId of Object.keys(owned.baseline.jobs)) control({ type: 'jobs', sessionId, jobs: [] })
    }
    owned.frames.clear()
  }
  async function selectedSource(runtime: string, sessionRef: string | undefined, signal: AbortSignal): Promise<AbortSignal> {
    while (true) {
      signal.throwIfAborted()
      const current = split(selected), changed = selectionChanged.signal
      if (!selectionKnown || current?.runtime === runtime && current.id === sessionRef) return changed
      await new Promise<void>((resolve, reject) => {
        const stop = () => { changed.removeEventListener('abort', wake); signal.removeEventListener('abort', cancel) }
        const wake = () => { stop(); resolve() }
        const cancel = () => { stop(); reject(signal.reason) }
        changed.addEventListener('abort', wake, { once: true }); signal.addEventListener('abort', cancel, { once: true })
        if (signal.aborted) cancel(); else if (changed.aborted) wake()
      })
    }
  }
  async function retrySource(sourceKey: string, signal: AbortSignal): Promise<void> {
    const source = sources.get(sourceKey)
    if (!source) { signal.throwIfAborted(); throw carrierFailure('源订阅已释放') }
    if (!source.retry) {
      const scoped = AbortSignal.any([source.abort.signal, lifetime.signal])
      source.retry = new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); scoped.removeEventListener('abort', done); resolve() }
        const timer = setTimeout(done, source.retryDelay + Math.floor(Math.random() * source.retryDelay / 4))
        scoped.addEventListener('abort', done, { once: true }); if (scoped.aborted) done()
      }).finally(() => { source.retry = undefined })
      source.retryDelay = Math.min(5_000, source.retryDelay * 2)
    }
    // One session source retry clock; a departing consumer must not cancel its peers.
    await new Promise<void>((resolve, reject) => {
      const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason) }
      signal.addEventListener('abort', abort, { once: true })
      source.retry!.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
      if (signal.aborted) abort()
    })
  }
  function retainSource(runtime: string, sessionRef: string | undefined, signal: AbortSignal) {
    // A creator's sessions may run on different executors after handoff.
    const key = [...sources].find(([, source]) => source.runtime === runtime && source.sessionRef === sessionRef)?.[0] ?? crypto.randomUUID()
    let source = sources.get(key)
    if (!source) {
      if (sources.size >= 8) throw new Error('打开的远程会话过多')
      const state = source = { runtime, sessionRef, baseline: undefined as Json | undefined, releaseTimer: undefined as ReturnType<typeof setTimeout> | undefined, users: 0, abort: new AbortController(), frames: new Map<string, { value: Json; bytes: number }>(), bytes: 0, retryDelay: 250, retry: undefined as Promise<void> | undefined }; sources.set(key, state)
      const scoped = AbortSignal.any([state.abort.signal, lifetime.signal])
      // Keep only the latest control value per field, to replay after a local
      // reconnect baseline. Journals/history remain in the native session store.
      const publish = (frame: Json) => {
        const key = JSON.stringify([frame.sessionId, frame.type, frame.key])
        if (frame.type === 'projection' && frame.seq <= (state.frames.get(key)?.value.seq ?? state.baseline?.projections[frame.sessionId]?.asOfSeq ?? -1)) return
        if (!state.frames.has(key) && state.frames.size >= 32768) throw new Error('远端控制状态数量超限')
        const bytes = JSON.stringify(frame).length * 2
        const total = state.bytes - (state.frames.get(key)?.bytes ?? 0) + bytes
        if (total > 64 * 1024 * 1024) throw new Error('远端控制状态大小超限')
        state.bytes = total; state.frames.set(key, { value: frame, bytes }); control(frame)
      }
      const pump = async (endpoint: string) => {
        while (!scoped.aborted) {
        try {
          for await (const frame of remoteStream(runtime, endpoint, { args: {} }, scoped, sessionRef, key)) {
            if (endpoint === '$events') {
              if (frame.type === 'ready') { (state as { clientId?: string }).clientId = frame.clientId; continue }
              if (frame.type === 'emit') {
                // Deployment-wide events must not invalidate another source's caches.
                if (!String(frame.event).startsWith('api-session/')) continue
                const args = [...frame.args]
                const id = frame.event === 'api-session/added' ? args[0].sessionId : args[0]
                if (id !== sessionRef) continue
                args[0] = frame.event === 'api-session/added' ? encodeSummary(runtime, args[0]) : identity(runtime, args[0])
                emit({ ...frame, args })
              } else {
                if (frame.type === 'waterfall' && frame.agentId !== sessionRef) {
                  await request(runtime, { mode: 'call', endpoint: '$events/result', payload: { args: { clientId: (state as { clientId?: string }).clientId, eventId: frame.eventId, outcome: { kind: 'next' } } } }, scoped, sessionRef)
                  continue
                }
                emit({ ...frame, eventId: `arkme:${encodeURIComponent(key)}:${encodeURIComponent(frame.eventId)}`, ...(frame.agentId ? { agentId: identity(runtime, frame.agentId) } : {}) })
              }
            } else if (frame.type === 'baseline') {
              // Keep the authoritative cut intact. Missing projection keys and
              // lost speculative values require DSH's truncate/seed semantics.
              const id = identity(runtime, sessionRef!)
              state.baseline = { queues: { [id]: frame.value.queues[sessionRef!] ?? [] },
                jobs: { [id]: frame.value.jobs[sessionRef!] ?? [] },
                projections: { [id]: frame.value.projections[sessionRef!] ?? { asOfSeq: -1, values: {} } } }
              state.frames.clear(); state.bytes = JSON.stringify(state.baseline).length * 2
              if (state.bytes > 64 * 1024 * 1024) throw new Error('远端控制状态大小超限')
              rebaselineControls()
            } else if (frame.sessionId === sessionRef) publish(nativeFrame(runtime, frame))
          }
          return
        } catch (error) {
          if (scoped.aborted) return
            if (!isCarrierFailure(error)) return
          await retrySource(key, scoped).catch(() => undefined)
        }
        }
      }
      void pump('$events'); void pump('session/control')
    }
    clearTimeout(source.releaseTimer)
    source.users++
    let released = false
    const owned = source
    const release = () => {
      if (released) return
      released = true; signal.removeEventListener('abort', release)
      if (--owned.users !== 0) return
      // The official journal immediately reacquires during a logical restart.
      // Preserve its source/control baseline across that microtask handoff.
      owned.releaseTimer = setTimeout(() => releaseUnusedSource(key), 0)
    }
    signal.addEventListener('abort', release, { once: true }); return { key, release }
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
        const source = sources.get(event.runtime)
        if (!source?.clientId) throw new Error('源实例交互已结束')
        target.runtime = source.runtime; target.sessionRef = source.sessionRef
        target.payload.args.eventId = event.id; target.payload.args.clientId = source.clientId
      }
      if (!target.runtime) {
        const response = await fetch(url, init)
        if (message.method !== 'session/list' || !response.ok) return response
        const envelope = await response.json() as Json
        if (envelope.result?.ok) envelope.result.value.items.push(...[...rows.values()].filter(row => !row.local).map(summary))
        return Response.json(envelope)
      }
      const endpoint = message.method
      // Phase one: only actions with complete per-session routing are admitted.
      const allowed = ['session/page', 'session/prompt', 'session/cancel', 'session/rename', 'session/selectModel', 'session/updateQueue', 'session/attachment', 'messageFeedback/list', 'messageFeedback/put', 'messageFeedback/delete', 'sessionFeedback/record', 'workspace/archiveSession', '$events/result']
      let result: unknown
      if (!allowed.includes(endpoint)) result = failure('此操作暂需在会话所属电脑执行')
      else result = await request(target.runtime, { mode: 'call', endpoint, payload: target.payload }, init.signal ?? undefined, target.sessionRef)
      return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
    },
    async *openStream(endpoint: string, payload: unknown, signal: AbortSignal) {
      const scoped = AbortSignal.any([signal, lifetime.signal]), target = addressed(payload)
      if (target.runtime) {
        let selection: AbortSignal | undefined
        if (endpoint === 'session/follow') do { selection = await selectedSource(target.runtime, target.sessionRef, scoped) } while (selection.aborted)
        scoped.throwIfAborted()
        const active = selection ? AbortSignal.any([scoped, selection]) : scoped
        const { key, release } = retainSource(target.runtime, target.sessionRef, active)
        try { for await (const frame of remoteStream(target.runtime, endpoint, target.payload, active, target.sessionRef, key)) yield nativeFrame(target.runtime, frame) }
        catch (error) { scoped.throwIfAborted(); if (!selection?.aborted) throw error }
        finally { release() }
        if (selection?.aborted) {
          await selectedSource(target.runtime, target.sessionRef, scoped)
          // A resumed journal needs a new authoritative baseline. Reuse the
          // official generation transition once, without retrying off-screen.
          throw carrierFailure('会话已重新选中，恢复历史基线')
        }
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
              if (endpoint === 'session/control' && (frame as Json).type === 'baseline') {
                const baseline = structuredClone((frame as Json).value)
                for (const source of sources.values()) if (source.baseline) {
                  for (const field of ['queues', 'jobs', 'projections']) Object.assign(baseline[field], source.baseline[field])
                }
                queue.push({ type: 'baseline', value: baseline })
                for (const source of sources.values()) for (const cached of source.frames.values()) queue.push(cached.value)
              } else queue.push(frame)
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
  window.addEventListener('pagehide', () => { lifetime.abort(); socket?.close(); localSocket?.close(); for (const source of sources.values()) { clearTimeout(source.releaseTimer); source.abort.abort() }; sources.clear() }, { once: true })
}

export const harnessNativeTransportScript = (route: string): string => `(${installNativeTransport.toString()})(${JSON.stringify(route)});`
