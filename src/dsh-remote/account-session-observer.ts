import { DSH_DIRECTORY_DELTA_MAX_BYTES, parseDshDirectoryDelta, type DshDirectoryDelta } from './account-session-directory.js'

/** Browser/SDK receive-only invalidation adapter; disposal aborts the subscription. */
export function observeDshAccountSession(route: string, fetchImpl: typeof fetch, target: { runtimeRef: string; sessionRef: string } | undefined, changed: (delta?: DshDirectoryDelta) => void, options: { signal?: AbortSignal; onError?: (error: unknown) => void } = {}): () => void {
    const controller = new AbortController()
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal
    void (async () => {
      const response = await fetchImpl(route, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: target ? 'remote.session.observe' : 'remote.sessions.observe', params: target ?? {} }), signal })
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
    })().catch(error => { if (!signal.aborted) options.onError?.(error) })
    return () => controller.abort()
}
