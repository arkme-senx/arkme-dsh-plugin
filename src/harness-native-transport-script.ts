import type { SessionControlFrame } from '@deepseek-ai/dsh-api-session-controller/types'
import type { DshAccountSession } from './dsh-remote/account-session-types.js'

export interface HarnessNativeDirectory {
  publish(rows: readonly DshAccountSession[], localRuntimeRef?: string): void
  canonicalLocal?(sessionId: string): string | undefined
  preferredSession?(sessionId: string): string | undefined
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
  const canWrite = (id: string | undefined) => { const source = split(id); return !source || writable.get(source.runtime) === true }
  const availability = () => surface.setAttribute('data-arkme-source-writable', String(canWrite(selected)))
  const scheduleFailure = (id: string | undefined, code?: string) => {
    if (id !== selected) return
    if (code) surface.setAttribute('data-arkme-schedule-error', code)
    else surface.removeAttribute?.('data-arkme-schedule-error')
  }
  type Json = Record<string, any>
  const rows = new Map<string, DshAccountSession>()
  const summary = (row: DshAccountSession) => ({ sessionId: identity(row.runtimeRef, row.sessionRef), updatedAt: row.updatedAt,
    running: row.running, blank: row.blank, projections: { kind: 'cached', asOfSeq: row.projectionAsOfSeq ?? -1, values: { title: row.title || null } } })

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
  // A baseline starts a new native control generation; never inject a second one.
  const control = (frame: SessionControlFrame) => { for (const queue of controls) { if (frame.type === 'baseline') queue.end(); else queue.push(frame) } }
  const localRows = new Map<string, Json>(), folded = new Map<string, DshAccountSession>(), hiddenRemote = new Map<string, string>()
  const aliasCandidates = new Map<string, DshAccountSession[]>()
  let localRuntimeRef: string | undefined
  const redirect = (canonical: DshAccountSession) => {
    const previous = selected
    selected = canonical.local ? canonical.sessionRef : identity(canonical.runtimeRef, canonical.sessionRef)
    if (selected !== previous) { scheduleFailure(selected); emit({ type: 'emit', event: 'schedule/changed', args: [] }) }
    const doc = surface.ownerDocument
    doc.dispatchEvent(new doc.defaultView!.CustomEvent('arkme:native-session-open', { detail: {
      runtimeRef: canonical.local ? '' : canonical.runtimeRef, sessionRef: canonical.sessionRef,
      accountId: surface.getAttribute('data-arkme-account-id') ?? '', accountScope: surface.getAttribute('data-arkme-account-scope') ?? '',
    } }))
  }
  const matching = (local: Json): DshAccountSession | undefined => {
    const matches = (aliasCandidates.get(local.sessionId) ?? []).filter(row => {
      const cut = row.coveredLocalHistory
      return row.sessionRef === local.sessionId && !row.local && row.origin !== 'subagent'
        && (row.canonicalIdentity || (localRuntimeRef !== undefined && row.previousRuntimeRefs?.includes(localRuntimeRef)))
        && cut !== undefined && cut.runtimeRef === localRuntimeRef
    })
    const row = matches.length === 1 ? matches[0] : undefined
    // A verified native journal stays executable even when idle. Cloud history
    // must not displace its local owner after an upload or Runtime change.
    return row && !row.archived
      ? { ...row, coveredLocalHistory: { ...row.coveredLocalHistory!, source: 'local' } } : row
  }
  const preferred = (row: DshAccountSession) => row.coveredLocalHistory?.source === 'local' ? row.sessionRef : identity(row.runtimeRef, row.sessionRef)
  const hidden = (row: DshAccountSession) => row.coveredLocalHistory?.source === 'local' ? identity(row.runtimeRef, row.sessionRef) : row.sessionRef
  const reconcileLocal = (id: string) => {
    const local = localRows.get(id), next = local && matching(local), previous = folded.get(id)
    const oldHidden = previous && hidden(previous), nextHidden = next && hidden(next)
    if (previous) hiddenRemote.delete(identity(previous.runtimeRef, previous.sessionRef))
    if (next) {
      folded.set(id, next)
      if (next.coveredLocalHistory?.source === 'local') hiddenRemote.set(identity(next.runtimeRef, next.sessionRef), id)
      if (selected === nextHidden) redirect({ ...next, local: next.coveredLocalHistory?.source === 'local' })
    } else folded.delete(id)
    if (oldHidden && oldHidden !== nextHidden) {
      const oldRow = split(oldHidden) ? rows.get(oldHidden) : undefined
      const restored = oldRow ? summary(oldRow) : oldHidden === id ? local : undefined
      if (restored) emit({ type: 'emit', event: 'api-session/added', args: [restored] })
    }
    if (nextHidden && oldHidden !== nextHidden) emit({ type: 'emit', event: 'api-session/removed', args: [nextHidden] })
  }
  const remember = (local: Json) => {
    if (typeof local.sessionId !== 'string' || split(local.sessionId)) return
    if (!localRows.has(local.sessionId) && localRows.size >= 10_000) return
    // Only bounded list metadata is retained, never history or arbitrary projections.
    localRows.set(local.sessionId, { sessionId: local.sessionId, updatedAt: local.updatedAt, running: local.running, blank: local.blank,
      projections: { kind: local.projections?.kind ?? 'cached', asOfSeq: local.projections?.asOfSeq, values: { title: local.projections?.values?.title } } })
    reconcileLocal(local.sessionId)
  }
  const localFrame = (frame: Json): boolean => {
    if (frame.type === 'emit' && frame.event === 'schedule/changed' && split(selected)) return false
    if (frame.type === 'emit' && String(frame.event).startsWith('api-session/')) {
      const id = frame.event === 'api-session/added' ? frame.args[0]?.sessionId : frame.args[0]
      if (frame.event === 'api-session/added') remember(frame.args[0])
      else if (frame.event === 'api-session/removed') { localRows.delete(id); reconcileLocal(id) }
      else {
        const local = localRows.get(id)
        if (local && frame.event === 'api-session/activity') local.updatedAt = frame.args[1]
        if (local && frame.event === 'api-session/status') local.running = frame.args[1]
        reconcileLocal(id)
      }
      if (folded.get(id)?.coveredLocalHistory?.source !== 'local' && folded.has(id)) return false
    }
    if (frame.type === 'projection' && localRows.has(frame.sessionId)) {
      const local = localRows.get(frame.sessionId)!
      local.projections.asOfSeq = Math.max(local.projections.asOfSeq ?? -1, frame.seq)
      reconcileLocal(frame.sessionId)
    }
    return true
  }
  Object.assign(window, { __ARKME_NATIVE_DIRECTORY__: {
    publish(incoming: readonly DshAccountSession[], runtimeRef?: string) {
      const activeSource = split(selected)?.runtime
      const wasWritable = activeSource ? writable.get(activeSource) === true : true
      localRuntimeRef = runtimeRef
      const next = new Map(incoming.filter(row => !row.local && !row.archived && row.origin !== 'subagent').map(row => [identity(row.runtimeRef, row.sessionRef), row]))
      for (const id of rows.keys()) if (!next.has(id)) emit({ type: 'emit', event: 'api-session/removed', args: [id] })
      for (const [id, row] of next) {
        writable.set(row.runtimeRef, row.presence === 'online' && row.capabilities.includes('session.native'))
        const old = rows.get(id)
        if (hiddenRemote.has(id)) continue // Reconciliation below restores a source only if its proof expires.
        if (!old || old.title !== row.title || old.blank !== row.blank || old.projectionAsOfSeq !== row.projectionAsOfSeq) emit({ type: 'emit', event: 'api-session/added', args: [summary(row)] })
        if (old && old.updatedAt !== row.updatedAt) emit({ type: 'emit', event: 'api-session/activity', args: [id, row.updatedAt] })
        // Native additions seed new sessions; only status updates an existing session's running bit.
        if (old && old.running !== row.running) emit({ type: 'emit', event: 'api-session/status', args: [id, row.running] })
      }
      rows.clear(); for (const [id, row] of next) rows.set(id, row)
      for (const runtime of writable.keys()) if (![...rows.values()].some(row => row.runtimeRef === runtime)) writable.delete(runtime)
      // The account directory is authoritative only after full pagination.
      // Redirect a retained old selection through the existing native owner.
      const retired = split(selected)
      const canonical = retired && incoming.find(row => row.sessionRef === retired.id && ((row.local && row.runtimeRef === retired.runtime) || row.previousRuntimeRefs?.includes(retired.runtime)))
      if (canonical) redirect(canonical)
      aliasCandidates.clear()
      for (const row of incoming) if (row.coveredLocalHistory) {
        const candidates = aliasCandidates.get(row.sessionRef) ?? []
        candidates.push(row); aliasCandidates.set(row.sessionRef, candidates)
      }
      for (const id of localRows.keys()) reconcileLocal(id)
      availability()
      if (activeSource && wasWritable !== (writable.get(activeSource) === true)) {
        scheduleFailure(selected)
        emit({ type: 'emit', event: 'schedule/changed', args: [] })
      }
    },
    canonicalLocal(id: string) { const row = folded.get(id); return row && row.coveredLocalHistory?.source !== 'local' ? preferred(row) : undefined },
    preferredSession(id: string) { const row = folded.get(id); return row ? preferred(row) : hiddenRemote.get(id) },
    writable(id: string) { return canWrite(id) },
    select(id: string | undefined) {
      const changed = selected !== id
      selected = id
      if (id && folded.has(id) && preferred(folded.get(id)!) !== id) redirect(folded.get(id)!)
      else if (id && hiddenRemote.has(id)) redirect({ ...rows.get(id)!, local: true })
      availability()
      if (changed) { scheduleFailure(selected); emit({ type: 'emit', event: 'schedule/changed', args: [] }) }
    },
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
    let result: { ok: boolean; value: unknown; error?: { code?: string; message?: string } }
    if (['pull', 'close'].includes(String((body as { mode?: string }).mode))) {
      result = await streamRequest(params, scoped) as typeof result
    } else {
      const response = await fetch(route, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation: 'remote.session.native', params }), signal: scoped,
      })
      result = await response.json() as typeof result
      if (!response.ok) throw Object.assign(new Error(result.error?.message ?? '原生远程连接已断开'), { code: result.error?.code })
    }
    if (!result.ok) throw Object.assign(new Error(result.error?.message ?? '原生远程连接已断开'), { code: result.error?.code })
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
        if (page.sourceWritable === false) throw new Error('源实例当前不可写')
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
  type ControlFrames = Map<string, { value: SessionControlFrame; bytes: number }>
  const controlCuts = (frames: ControlFrames) => {
    const cuts = new Map<string, number>()
    for (const { value: frame } of frames.values()) {
      if (frame.type === 'baseline') for (const [id, block] of Object.entries(frame.value.projections)) cuts.set(id, Math.max(cuts.get(id) ?? -1, block.asOfSeq))
      else cuts.set(frame.sessionId, Math.max(cuts.get(frame.sessionId) ?? -1, frame.seq))
    }
    return cuts
  }
  const clearControl = (frames: ControlFrames) => control({ type: 'baseline', value: { projections: Object.fromEntries([...controlCuts(frames)].map(([id, asOfSeq]) => [id, { asOfSeq, values: {} }])) } })
  const sources = new Map<string, { users: number; abort: AbortController; clientId?: string; frames: ControlFrames; bytes: number }>()
  function retainSource(runtime: string, signal: AbortSignal): () => void {
    let source = sources.get(runtime)
    if (!source) {
      if (sources.size >= 8) throw new Error('打开的远程实例过多')
      const state = source = { users: 0, abort: new AbortController(), frames: new Map<string, { value: SessionControlFrame; bytes: number }>(), bytes: 0 }; sources.set(runtime, state)
      const scoped = AbortSignal.any([state.abort.signal, lifetime.signal])
      // Keep only the latest control value per field, to replay after a local
      // reconnect baseline. Journals/history remain in the native session store.
      const publish = (frame: SessionControlFrame) => {
        const key = frame.type === 'baseline' ? 'baseline' : JSON.stringify([frame.sessionId, frame.key])
        if (!state.frames.has(key) && state.frames.size >= 32768) throw new Error('远端控制状态数量超限')
        const bytes = JSON.stringify(frame).length * 2
        const total = state.bytes - (state.frames.get(key)?.bytes ?? 0) + bytes
        if (total > 64 * 1024 * 1024) throw new Error('远端控制状态大小超限')
        state.bytes = total; state.frames.set(key, { value: frame, bytes }); control(frame)
      }
      const pump = async (endpoint: string) => {
        while (!scoped.aborted) {
        try {
          if (writable.get(runtime) !== true) { await new Promise<void>(resolve => {
            const done = () => { clearTimeout(timer); scoped.removeEventListener('abort', done); resolve() }
            const timer = setTimeout(done, 1000); scoped.addEventListener('abort', done, { once: true })
          }); continue }
          for await (const frame of remoteStream(runtime, endpoint, { args: {} }, scoped)) {
            if (endpoint === '$events') {
              if (frame.type === 'ready') { (state as { clientId?: string }).clientId = frame.clientId; continue }
              if (frame.type === 'emit') {
                if (frame.event === 'schedule/changed') {
                  if (split(selected)?.runtime === runtime) emit({ type: 'emit', event: 'schedule/changed', args: [] })
                  continue
                }
                // Deployment-wide events must not invalidate another source's caches.
                if (!String(frame.event).startsWith('api-session/')) continue
                const args = [...frame.args]
                args[0] = frame.event === 'api-session/added' ? encodeSummary(runtime, args[0]) : identity(runtime, args[0])
                const id = frame.event === 'api-session/added' ? args[0].sessionId : args[0]
                if (hiddenRemote.has(id)) continue
                emit({ ...frame, args })
              } else emit({ ...frame, eventId: identity(runtime, frame.eventId), ...(frame.agentId ? { agentId: identity(runtime, frame.agentId) } : {}) })
            } else {
              const current = frame as SessionControlFrame
              if (current.type === 'baseline') {
                const projections = Object.fromEntries(Object.entries(current.value.projections).map(([id, block]) => [identity(runtime, id), block]))
                // A source baseline only replaces its own named Sessions. Empty
                // blocks clear removed projections without inventing newer cuts.
                for (const [id, asOfSeq] of controlCuts(state.frames)) if (!(id in projections)) projections[id] = { asOfSeq, values: {} }
                state.frames.clear(); state.bytes = 0
                publish({ type: 'baseline', value: { projections } })
              } else publish(nativeFrame(runtime, current) as SessionControlFrame)
            }
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
    const release = () => { if (released) return; released = true; signal.removeEventListener('abort', release); if (--owned.users === 0) { owned.abort.abort(); sources.delete(runtime); clearControl(owned.frames); owned.frames.clear() } }
    signal.addEventListener('abort', release, { once: true }); return release
  }
  const failure = (message: string) => ({ ok: false, error: { code: 'CAPABILITY_UNSUPPORTED', message, details: {} } })
  const hooks = {
    async fetch(input: string | URL, init: RequestInit) {
      // 0.2 passes document-relative strings (api/session/create), while older
      // callers supplied URL objects. Honor the embedded document's root base.
      const base = window.document?.baseURI ?? new URL('/', window.location.href).href
      const url = new URL(input, base)
      if (!url.pathname.startsWith('/api/')) return fetch(url, init)
      const message = JSON.parse(String(init.body)) as Json
      if (url.pathname !== `/api/${message.method}`) throw new Error('原生传输入口不一致')
      const target = addressed(message.payload)
      const schedule = /^schedule\/(catalog|list|history|update|delete)$/.test(message.method)
      const selectionAtRequest = selected
      // Native task details read a Host catalogue rather than a Session list.
      // Follow the selected source Host, never the preview computer's task store.
      if (message.method === 'schedule/catalog') target.runtime = split(selected)?.runtime
      const event = message.method === '$events/result' ? split(message.payload.args.eventId) : undefined
      if (event) {
        target.runtime = event.runtime; target.payload.args.eventId = event.id
        const clientId = sources.get(event.runtime)?.clientId
        if (!clientId) return Response.json({ type: 'server-response', rpcId: message.rpcId, result: failure('源实例交互已结束') })
        target.payload.args.clientId = clientId
      }
      if (!target.runtime) {
        const response = await fetch(url, init)
        if (message.method !== 'session/list' || !response.ok) return response
        const envelope = await response.json() as Json
        if (envelope.result?.ok) {
          const items = envelope.result.value.items as Json[]
          for (const item of items) remember(item)
          envelope.result.value.items = [...items.filter(item => !folded.has(item.sessionId) || folded.get(item.sessionId)?.coveredLocalHistory?.source === 'local'), ...[...rows.values()].filter(row => !hiddenRemote.has(identity(row.runtimeRef, row.sessionRef))).map(summary)]
        }
        return Response.json(envelope)
      }
      const endpoint = message.method
      const reads = ['session/page', 'messageFeedback/list', 'schedule/catalog', 'schedule/list', 'schedule/history']
      const writes = ['session/prompt', 'session/cancel', 'session/updateQueue', 'session/attachment', '$events/result']
      const allowed = [...reads, ...(writable.get(target.runtime) === true ? writes : [])]
      let result: any
      if (!allowed.includes(endpoint)) result = failure('其他电脑的会话仅支持只读查看，请在对话所属电脑上执行。')
      else {
        try { result = await request(target.runtime, { mode: 'call', endpoint, payload: target.payload }, init.signal ?? undefined) }
        catch (error) {
          if (!schedule || init.signal?.aborted) throw error
          result = { ok: false, error: { code: (error as { code?: string }).code ?? 'REMOTE_TRANSPORT_FAILED', message: '提醒暂时无法读取，请重试', details: {} } }
        }
      }
      if (schedule) {
        if (['schedule/list', 'schedule/catalog', 'schedule/history'].includes(endpoint)) {
          const owner = endpoint === 'schedule/catalog' ? selectionAtRequest : message.payload.args.request.sessionId
          scheduleFailure(owner, result.ok ? undefined : result.error?.code ?? 'REMOTE_TRANSPORT_FAILED')
        }
        // Only routing fields are qualified. Prompts and saved history stay exact.
        const qualify = (record: Json) => ({ ...record, sessionId: identity(target.runtime!, record.sessionId) })
        if (result.ok && endpoint === 'schedule/catalog') result = { ...result, value: result.value.map(qualify) }
      }
      return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
    },
    async *openStream(endpoint: string, payload: unknown, signal: AbortSignal) {
      const scoped = AbortSignal.any([signal, lifetime.signal]), target = addressed(payload)
      if (target.runtime) {
        if (endpoint !== 'session/follow') throw Object.assign(new Error('不支持该远端订阅'), { code: 'CAPABILITY_UNSUPPORTED', details: {} })
        // Keep an offline opening pending without polling the remote Host. The
        // native journal owns reconnection after an accepted stream ends.
        let accepted = false
        while (!scoped.aborted) {
          while (writable.get(target.runtime) !== true) {
            scoped.throwIfAborted()
            await new Promise<void>(resolve => {
              const done = () => { clearTimeout(timer); scoped.removeEventListener('abort', done); resolve() }
              const timer = setTimeout(done, 1000); scoped.addEventListener('abort', done, { once: true })
            })
          }
          scoped.throwIfAborted()
          const release = retainSource(target.runtime, scoped)
          try {
            for await (const frame of remoteStream(target.runtime, endpoint, target.payload, scoped)) {
              accepted = true; yield nativeFrame(target.runtime, frame)
            }
            if (accepted) return
            writable.set(target.runtime, false); availability()
          } catch (error) {
            if (scoped.aborted) throw error
            writable.set(target.runtime, false); availability()
            if (accepted) return // Native RemoteJournalStream opens a fresh generation.
          } finally { release() }
        }
        scoped.throwIfAborted()
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
                const merged = structuredClone(frame) as Extract<SessionControlFrame, { type: 'baseline' }>
                const projections = merged.value.projections as Record<string, any>
                for (const source of sources.values()) for (const { value } of source.frames.values()) {
                  if (value.type === 'baseline') Object.assign(projections, value.value.projections)
                  else {
                    const block = projections[value.sessionId] ??= { asOfSeq: value.seq, values: {} }
                    block.asOfSeq = Math.max(block.asOfSeq, value.seq); block.values[value.key] = value.value
                  }
                }
                if (localFrame(merged as Json)) queue.push(merged)
              } else if (localFrame(frame as Json)) queue.push(frame)
              if (first) {
                first = false; listeners.add(queue)
                if (endpoint === '$events') for (const row of rows.values()) if (!hiddenRemote.has(identity(row.runtimeRef, row.sessionRef))) queue.push({ type: 'emit', event: 'api-session/added', args: [summary(row)] })
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
  window.addEventListener('pagehide', () => { lifetime.abort(); socket?.close(); localSocket?.close(); for (const source of sources.values()) source.abort.abort(); sources.clear(); localRows.clear(); folded.clear(); hiddenRemote.clear() }, { once: true })
}

export const harnessNativeTransportScript = (route: string): string => `(${installNativeTransport.toString()})(${JSON.stringify(route)});`
