import type { ArkmeRelatedQuickNoteList } from '../types.js'
import type { ArkmeRelatedQuickNotesLoadState } from './ArkmeRelatedQuickNotes.js'
import { ArkmeClientError, callArkme } from './api.js'

type Operation = 'source.related-quick-notes.from-message' | 'source.related-quick-notes.from-moment'

export function relatedQuickNotesState(list: ArkmeRelatedQuickNoteList): ArkmeRelatedQuickNotesLoadState {
  if (list.items.length > 0) return { kind: 'success', list }
  if (list.recallMode === 'embedding') return { kind: 'empty' }
  return { kind: 'error', message: '相关快记暂时不可用', retryable: list.retryable }
}

function delay(millis: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, millis)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

/** One recovery owner: at most two reads, with real cancellation per attempt. */
export async function loadRelatedQuickNotes(operation: Operation, params: Record<string, unknown>, signal: AbortSignal): Promise<ArkmeRelatedQuickNoteList> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted()
    const controller = new AbortController()
    const abort = () => { controller.abort(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => controller.abort(new DOMException('相关快记加载超时', 'TimeoutError')), 5_000)
    let retryDelay = 1_500
    try {
      const list = await callArkme<ArkmeRelatedQuickNoteList>(operation, params, controller.signal)
      if (attempt > 0 || list.items.length > 0 || !list.retryable || list.recallMode === 'embedding') return list
      retryDelay = list.retryAfterMillis
    } catch (error) {
      signal.throwIfAborted()
      const retryable = controller.signal.aborted || (error instanceof ArkmeClientError && error.body.retryable) || error instanceof TypeError
      if (attempt > 0 || !retryable) throw error
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
    }
    // No automatic retry once the view is hidden. The active caller keeps its
    // generation guard, so late completions never overwrite another record.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') throw new Error('相关快记暂时不可用')
    await delay(Math.min(30_000, Math.max(1_000, retryDelay)) + Math.random() * 300, signal)
  }
}
