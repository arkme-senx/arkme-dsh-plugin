import { DSH_DIRECTORY_DELTA_MAX_BYTES, parseDshDirectoryDelta, type DshDirectoryDelta } from './account-session-directory.js'
import { runArkmeBrowserRequest } from '../sdk/browser-request-admission.js'

/** Browser/SDK receive-only invalidation adapter; disposal aborts the subscription. */
export function observeDshAccountSession(route: string, fetchImpl: typeof fetch, target: { runtimeRef: string; sessionRef: string } | undefined, changed: (delta?: DshDirectoryDelta) => void, options: { signal?: AbortSignal; onError?: (error: unknown) => void } = {}): () => void {
    const controller = new AbortController()
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal
    let socket: WebSocket | undefined, timer: ReturnType<typeof setTimeout> | undefined
    let established = false, fallbackStarted = false
    const closeSocket = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      if (socket) { socket.onopen = null; socket.onmessage = null; socket.onclose = null; socket.onerror = null; socket.close(); socket = undefined }
    }
    const fail = (error: unknown) => {
      if (signal.aborted) return
      controller.abort(); closeSocket(); options.onError?.(error)
    }
    signal.addEventListener('abort', closeSocket, { once: true })
    const legacy = () => {
      if (signal.aborted || fallbackStarted) return
      fallbackStarted = true; closeSocket()
      void runArkmeBrowserRequest('remote.sessions.observe', signal, async scoped => {
      const response = await fetchImpl(route, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: target ? 'remote.session.observe' : 'remote.sessions.observe', params: target ?? {} }), signal: scoped! })
      if (!response.ok || !response.headers.get('content-type')?.includes('application/x-ndjson') || !response.body) throw new Error('远程连接不可用')
      const reader = response.body.getReader(), decoder = new TextDecoder()
      let buffer = ''
      try {
        while (!signal.aborted) {
          const { value, done } = await reader.read()
          if (done) throw new Error('远程连接已断开')
          buffer += decoder.decode(value, { stream: true })
          let end: number
          while ((end = buffer.indexOf('\n')) >= 0) {
            if (end > DSH_DIRECTORY_DELTA_MAX_BYTES + 4096) throw new Error('远程通知格式无效')
            const message = JSON.parse(buffer.slice(0, end)) as { changed?: boolean; directoryDelta?: unknown; error?: string }
            buffer = buffer.slice(end + 1)
            if (message.error) throw new Error(message.error)
            if (message.changed && !signal.aborted) changed(parseDshDirectoryDelta(message.directoryDelta))
          }
          if (buffer.length > DSH_DIRECTORY_DELTA_MAX_BYTES + 4096) throw new Error('远程通知格式无效')
        }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
      }).catch(fail)
    }
    if (!signal.aborted && typeof window !== 'undefined' && typeof WebSocket === 'function') {
      try {
        const next = socket = new WebSocket(`${route}/native-streams?observe=1`)
        timer = setTimeout(legacy, 5000)
        next.onopen = () => { if (!signal.aborted) next.send(JSON.stringify({ id: 'observe', params: { ...target, body: { mode: 'observe' } } })) }
        next.onmessage = event => {
          try {
            if (typeof event.data !== 'string' || event.data.length > DSH_DIRECTORY_DELTA_MAX_BYTES + 4096) throw new Error('远程通知格式无效')
            const message = JSON.parse(event.data)
            if (message.id !== 'observe') return
            if (message.ok === false) {
              if (!established && message.error?.code === 'REMOTE_REQUEST_INVALID') { legacy(); return }
              throw new Error(message.error?.message ?? '远程连接不可用')
            }
            if (message.event !== 'directory-changed') return
            established = true
            if (timer !== undefined) clearTimeout(timer)
            timer = undefined
            if (!signal.aborted) changed(parseDshDirectoryDelta(message.directoryDelta))
          } catch (error) { fail(error) }
        }
        next.onerror = () => { if (!established) legacy(); else fail(new Error('远程连接已断开')) }
        next.onclose = () => { if (!established) legacy(); else fail(new Error('远程连接已断开')) }
      } catch { legacy() }
    } else legacy()
    return () => controller.abort()
}
