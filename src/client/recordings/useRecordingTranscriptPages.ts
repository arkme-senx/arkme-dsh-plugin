import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArkmeRecordingTranscriptPage } from '../../types.js'
import { appendRecordingTranscriptPage, isRecordingViewChanged, restoreRecordingTranscriptPrefix } from '../../recording-transcript-page.js'
import { callArkme } from '../api.js'

/** One mounted day owns continuation and refresh. A revision replacement is
 * published atomically after restoring its loaded range; no mixed pages. */
export function useRecordingTranscriptPages(page: ArkmeRecordingTranscriptPage | undefined, scope: string, onChange: (value: ArkmeRecordingTranscriptPage) => void) {
  const latest = useRef(page), currentScope = useRef(scope), publish = useRef(onChange)
  latest.current = page; currentScope.current = scope; publish.current = onChange
  const active = useRef<{ controller: AbortController; promise: Promise<ArkmeRecordingTranscriptPage | undefined> }>()
  const publishedView = useRef(page?.viewRef)
  const [loading, setLoading] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    setError(''); setLoading(false)
    return () => { active.current?.controller.abort(); active.current = undefined }
  }, [scope, page?.dateStamp, page?.transcriptSource])
  useEffect(() => {
    if (page?.viewRef !== publishedView.current) {
      active.current?.controller.abort(); active.current = undefined
      setError(''); setLoading(false)
    }
  }, [page?.viewRef])

  const read = useCallback(async (first?: ArkmeRecordingTranscriptPage, refresh = false, callerSignal?: AbortSignal): Promise<ArkmeRecordingTranscriptPage | undefined> => {
    const requestedOwner = currentScope.current
    callerSignal?.throwIfAborted()
    while (active.current !== undefined) {
      // A poll must not replace a prefix while its continuation is in flight.
      const pending = active.current.promise
      if (!refresh) return await pending
      try { await pending } catch { /* the refresh can repair a stale read */ }
    }
    callerSignal?.throwIfAborted()
    if (requestedOwner !== currentScope.current) throw new DOMException('录音读取已取消', 'AbortError')
    const start = latest.current, owner = currentScope.current
    if (start === undefined || !refresh && start.nextCursor === '') return start
    const controller = new AbortController()
    const abort = () => controller.abort()
    callerSignal?.addEventListener('abort', abort, { once: true })
    const ensureCurrent = () => {
      controller.signal.throwIfAborted()
      if (owner !== currentScope.current || latest.current?.viewRef !== start.viewRef) throw new DOMException('录音读取已取消', 'AbortError')
    }
    const fetchPage = async (cursor?: string) => {
      ensureCurrent()
      const value = await callArkme<ArkmeRecordingTranscriptPage>('recordings.transcript.page', {
        dateStamp: start.dateStamp, source: start.transcriptSource, ...(cursor ? { cursor } : {}),
      }, controller.signal)
      ensureCurrent()
      return value
    }
    const restore = async (initial?: ArkmeRecordingTranscriptPage) => {
      // Retry only verified content updates; never ask the reader to reset
      // the page manually while processing continues. Cancellation owns waits.
      for (;;) {
        try {
          return await restoreRecordingTranscriptPrefix(start, initial ?? await fetchPage(), fetchPage, controller.signal)
        } catch (reason) {
          if (!isRecordingViewChanged(reason)) throw reason
          initial = undefined
          await new Promise<void>((resolve, reject) => {
            const abortWait = () => { clearTimeout(timer); reject(new DOMException('录音读取已取消', 'AbortError')) }
            const timer = setTimeout(() => { controller.signal.removeEventListener('abort', abortWait); resolve() }, 250)
            if (controller.signal.aborted) abortWait()
            else controller.signal.addEventListener('abort', abortWait, { once: true })
          })
        }
      }
    }
    setLoading(true); setError('')
    const operation = { controller, promise: Promise.resolve<ArkmeRecordingTranscriptPage | undefined>(undefined) }
    operation.promise = (async () => {
      try {
        let merged: ArkmeRecordingTranscriptPage
        if (refresh) merged = await restore(first)
        else {
          try { merged = appendRecordingTranscriptPage(start, await fetchPage(start.nextCursor)) }
          catch (reason) {
            if (!isRecordingViewChanged(reason)) throw reason
            merged = await restore()
          }
        }
        ensureCurrent()
        latest.current = merged; publishedView.current = merged.viewRef; publish.current(merged)
        return merged
      } catch (reason) {
        if (!controller.signal.aborted && owner === currentScope.current && !(reason instanceof DOMException && reason.name === 'AbortError')) {
          setError(reason instanceof Error ? reason.message : '读取录音失败')
        }
        throw reason
      } finally {
        callerSignal?.removeEventListener('abort', abort)
        if (active.current === operation) { active.current = undefined; setLoading(false) }
      }
    })()
    active.current = operation
    return await operation.promise
  }, [])

  const next = useCallback(() => read(), [read])
  const refresh = useCallback((first: ArkmeRecordingTranscriptPage, signal?: AbortSignal) => read(first, true, signal), [read])
  const through = useCallback(async (time?: number, signal?: AbortSignal): Promise<ArkmeRecordingTranscriptPage | undefined> => {
    signal?.throwIfAborted()
    const owner = currentScope.current
    let value = latest.current
    const cursors = new Set<string>()
    while (value !== undefined && value.nextCursor !== '' && (time === undefined || (value.items.at(-1)?.startAtMillis ?? 0) <= time)) {
      signal?.throwIfAborted()
      if (owner !== currentScope.current) throw new DOMException('录音读取已取消', 'AbortError')
      const cursor = `${value.viewRef}:${value.nextCursor}`
      if (cursors.has(cursor)) throw new Error('录音分页未前进')
      cursors.add(cursor)
      value = await next()
    }
    signal?.throwIfAborted()
    if (owner !== currentScope.current) throw new DOMException('录音读取已取消', 'AbortError')
    return value
  }, [next])

  return { next, refresh, through, loading, error }
}
