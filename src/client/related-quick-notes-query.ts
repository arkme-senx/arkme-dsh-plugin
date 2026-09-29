import type { ArkmeRelatedQuickNoteList } from '../types.js'
import { ArkmeClientError, callArkme } from './api.js'

type Operation = 'source.related-quick-notes.from-message' | 'source.related-quick-notes.from-moment'

function delay(millis: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, millis)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

/** One recovery owner: at most two reads within one five-second lifetime. */
export async function loadRelatedQuickNotes(operation: Operation, params: Record<string, unknown>, signal: AbortSignal): Promise<ArkmeRelatedQuickNoteList> {
  const deadline = performance.now() + 5_000
  let lastResult: ArkmeRelatedQuickNoteList | undefined
  let lastError: unknown
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted()
    if (attempt > 0 && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      if (lastResult !== undefined) return lastResult
      throw lastError
    }
    const controller = new AbortController()
    const abort = () => { controller.abort(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    const remaining = deadline - performance.now()
    if (remaining <= 0) {
      signal.removeEventListener('abort', abort)
      if (lastResult !== undefined) return lastResult
      throw new DOMException('相关快记加载超时', 'TimeoutError')
    }
    const timeout = setTimeout(() => controller.abort(new DOMException('相关快记加载超时', 'TimeoutError')), remaining)
    let retryDelay = 1_500
    try {
      const list = await callArkme<ArkmeRelatedQuickNoteList>(operation, params, controller.signal)
      if (attempt > 0 || list.items.length > 0 || !list.retryable || list.recallMode === 'embedding') return list
      retryDelay = list.retryAfterMillis
      lastResult = list
    } catch (error) {
      signal.throwIfAborted()
      const retryable = controller.signal.aborted || (error instanceof ArkmeClientError && error.body.retryable) || error instanceof TypeError
      // A failed optional recovery must not turn a completed fallback response
      // into a new visible failure. Keep the latest response; never cache it.
      if (attempt > 0 && retryable && lastResult !== undefined) return lastResult
      if (attempt > 0 || !retryable) throw error
      lastError = error
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
    }
    // No automatic retry once the view is hidden. The active caller keeps its
    // generation guard, so late completions never overwrite another record.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      if (lastResult !== undefined) return lastResult
      throw lastError
    }
    const waitMillis = Math.min(30_000, Math.max(1_000, retryDelay)) + Math.random() * 300
    if (deadline - performance.now() <= waitMillis + 1_000) {
      if (lastResult !== undefined) return lastResult
      throw lastError
    }
    await delay(waitMillis, signal)
  }
}
