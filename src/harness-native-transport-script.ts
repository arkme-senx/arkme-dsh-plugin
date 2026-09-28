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
      const wasWritable = canWrite(selected)
      const previousSelection = split(selected)
      localIdentities.clear()
      for (const row of incoming) if (row.local) localIdentities.add(`${row.runtimeRef}:${row.sessionRef}`)
      localRuntimeRef = runtimeRef
      const next = new Map(incoming.filter(row => (!row.local || row.localTakeover) && !row.archived && row.origin !== 'subagent').map(row => [identity(row.runtimeRef, row.sessionRef), row]))
      for (const id of rows.keys()) if (!next.has(id)) emit({ type: 'emit', event: 'api-session/removed', args: [id] })
      for (const [id, row] of next) {
        const old = rows.get(id)
        if (!old || old.presence !== row.presence || old.capabilities.join() !== row.capabilities.join())
          writable.set(sourceId(row.runtimeRef, row.sessionRef), row.capabilities.includes('session.native.channel') || row.presence === 'online' && row.capabilities.includes('session.native'))
        if (hiddenRemote.has(id)) continue // Reconciliation below restores a source only if its proof expires.
        if (!old || old.title !== row.title || old.blank !== row.blank || old.projectionAsOfSeq !== row.projectionAsOfSeq) emit({ type: 'emit', event: 'api-session/added', args: [summary(row)] })
        if (old && old.updatedAt !== row.updatedAt) emit({ type: 'emit', event: 'api-session/activity', args: [id, row.updatedAt] })
        // Native additions seed new sessions; only status updates an existing session's running bit.
        if (old && old.running !== row.running) emit({ type: 'emit', event: 'api-session/status', args: [id, row.running] })
      }
      rows.clear(); for (const [id, row] of next) rows.set(id, row)
      const currentSources = new Set([...rows.values()].map(row => sourceId(row.runtimeRef, row.sessionRef)))
      for (const id of writable.keys()) if (!currentSources.has(id)) writable.delete(id)
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
      const currentSelection = split(selected)
      if (selectionKnown && (previousSelection?.runtime !== currentSelection?.runtime || previousSelection?.id !== currentSelection?.id)) changeSelection()
      availability()
      if (wasWritable !== canWrite(selected)) {
        scheduleFailure(selected)
        emit({ type: 'emit', event: 'schedule/changed', args: [] })
      }
    },
    canonicalLocal(id: string) { const row = folded.get(id); return row && row.coveredLocalHistory?.source !== 'local' ? preferred(row) : undefined },
    preferredSession(id: string) { const row = folded.get(id); return row ? preferred(row) : hiddenRemote.get(id) },
    writable: canWrite,
    select(id: string | undefined) {
      if (selectionKnown && selected === id) return
      const previous = split(selected), next = split(id), known = selectionKnown
      selected = id; selectionKnown = true
      if (id && folded.has(id) && preferred(folded.get(id)!) !== id) redirect(folded.get(id)!)
      else if (id && hiddenRemote.has(id)) redirect({ ...rows.get(id)!, local: true })
      // Session Controller retains visited journals off-screen. Only their
      // selected remote source needs live I/O; the native journal keeps its view.
      if (!known || previous?.runtime !== next?.runtime || previous?.id !== next?.id) changeSelection()
      availability()
      scheduleFailure(selected); emit({ type: 'emit', event: 'schedule/changed', args: [] })
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
          if (page.sourceWritable === false) throw new Error('源实例当前不可写')
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
  const sources = new Map<string, { runtime: string; sessionRef: string | undefined; users: number; abort: AbortController; clientId?: string; baseline: Json | undefined; releaseTimer: ReturnType<typeof setTimeout> | undefined; frames: ControlFrames; bytes: number; retryDelay: number; retry: Promise<void> | undefined }>()
  function releaseUnusedSource(key: string) {
    const owned = sources.get(key)
    if (!owned || owned.users) return
    clearTimeout(owned.releaseTimer); owned.abort.abort(); sources.delete(key)
    const cuts = controlCuts(owned.frames)
    for (const [id, block] of Object.entries(owned.baseline?.projections ?? {}) as Array<[string, { asOfSeq: number }]>) cuts.set(id, Math.max(cuts.get(id) ?? -1, block.asOfSeq))
    control({ type: 'baseline', value: { projections: Object.fromEntries([...cuts].map(([id, asOfSeq]) => [id, { asOfSeq, values: {} }])) } })
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
      const state = source = { runtime, sessionRef, baseline: undefined as Json | undefined, releaseTimer: undefined as ReturnType<typeof setTimeout> | undefined, users: 0, abort: new AbortController(), frames: new Map<string, { value: SessionControlFrame; bytes: number }>(), bytes: 0, retryDelay: 250, retry: undefined as Promise<void> | undefined }; sources.set(key, state)
      const scoped = AbortSignal.any([state.abort.signal, lifetime.signal])
      // Keep only the latest control value per field, to replay after a local
      // reconnect baseline. Journals/history remain in the native session store.
      const publish = (frame: SessionControlFrame) => {
        const key = frame.type === 'baseline' ? 'baseline' : JSON.stringify([frame.sessionId, frame.type, frame.key])
        if (frame.type === 'projection' && frame.seq <= ((state.frames.get(key)?.value as { seq?: number } | undefined)?.seq ?? state.baseline?.projections[frame.sessionId]?.asOfSeq ?? -1)) return
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
                if (frame.event === 'schedule/changed') {
                  if (split(selected)?.runtime === runtime) emit({ type: 'emit', event: 'schedule/changed', args: [] })
                  continue
                }
                // Deployment-wide events must not invalidate another source's caches.
                if (!String(frame.event).startsWith('api-session/')) continue
                const args = [...frame.args]
                const id = frame.event === 'api-session/added' ? args[0].sessionId : args[0]
                if (id !== sessionRef) continue
                args[0] = frame.event === 'api-session/added' ? encodeSummary(runtime, args[0]) : identity(runtime, args[0])
                const encodedId = frame.event === 'api-session/added' ? args[0].sessionId : args[0]
                if (hiddenRemote.has(encodedId)) continue
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
              state.baseline = { projections: { [id]: frame.value.projections[sessionRef!] ?? { asOfSeq: -1, values: {} } } }
              state.frames.clear(); state.bytes = JSON.stringify(state.baseline).length * 2
              if (state.bytes > 64 * 1024 * 1024) throw new Error('远端控制状态大小超限')
              rebaselineControls()
            } else if (frame.sessionId === sessionRef) publish(nativeFrame(runtime, frame) as SessionControlFrame)
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
        const source = sources.get(event.runtime)
        if (!source?.clientId) throw new Error('源实例交互已结束')
        target.runtime = source.runtime; target.sessionRef = source.sessionRef
        target.payload.args.eventId = event.id; target.payload.args.clientId = source.clientId
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
      // Phase one: only actions with complete per-session routing are admitted.
      const allowed = ['session/page', 'session/prompt', 'session/cancel', 'session/rename', 'session/selectModel', 'session/updateQueue', 'session/attachment', 'messageFeedback/list', 'messageFeedback/put', 'messageFeedback/delete', 'sessionFeedback/record', 'workspace/archiveSession', '$events/result', 'schedule/catalog', 'schedule/list', 'schedule/history', 'schedule/update', 'schedule/delete']
      let result: any
      if (!allowed.includes(endpoint)) result = failure('其他电脑的会话仅支持只读查看，请在对话所属电脑上执行。')
      else {
        try { result = await request(target.runtime, { mode: 'call', endpoint, payload: target.payload }, init.signal ?? undefined, target.sessionRef) }
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
                  for (const field of ['projections']) Object.assign(baseline[field], source.baseline[field])
                }
                queue.push({ type: 'baseline', value: baseline })
                for (const source of sources.values()) for (const cached of source.frames.values()) queue.push(cached.value)
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
  window.addEventListener('pagehide', () => { lifetime.abort(); socket?.close(); localSocket?.close(); for (const source of sources.values()) { clearTimeout(source.releaseTimer); source.abort.abort() }; sources.clear(); localRows.clear(); folded.clear(); hiddenRemote.clear() }, { once: true })
}

export const harnessNativeTransportScript = (route: string): string => `(${installNativeTransport.toString()})(${JSON.stringify(route)});`
