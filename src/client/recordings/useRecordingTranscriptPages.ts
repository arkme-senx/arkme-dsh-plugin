import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArkmeRecordingTranscriptPage } from '../../types.js'
import { appendRecordingTranscriptPage } from '../../recording-transcript-page.js'
import { callArkme } from '../api.js'

/** One in-flight continuation per view, shared by scroll, seek and full reads. */
export function useRecordingTranscriptPages(page: ArkmeRecordingTranscriptPage | undefined, scope: string, onChange: (value: ArkmeRecordingTranscriptPage) => void) {
  const latest = useRef(page), currentScope = useRef(scope), publish = useRef(onChange)
  latest.current = page; currentScope.current = scope; publish.current = onChange
  const active = useRef<{ controller: AbortController; promise: Promise<ArkmeRecordingTranscriptPage | undefined> }>()
  const [loading, setLoading] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    setError(''); setLoading(false)
    return () => { active.current?.controller.abort(); active.current = undefined }
  }, [scope, page?.dateStamp, page?.transcriptSource, page?.viewRef])

  const next = useCallback(async (): Promise<ArkmeRecordingTranscriptPage | undefined> => {
    if (active.current !== undefined) return await active.current.promise
    const start = latest.current, owner = currentScope.current
    if (start === undefined || start.nextCursor === '') return start
    const controller = new AbortController()
    setLoading(true); setError('')
    const operation = { controller, promise: Promise.resolve<ArkmeRecordingTranscriptPage | undefined>(undefined) }
    operation.promise = (async () => {
      try {
        const result = await callArkme<ArkmeRecordingTranscriptPage>('recordings.transcript.page', {
          dateStamp: start.dateStamp, source: start.transcriptSource, cursor: start.nextCursor,
        }, controller.signal)
        controller.signal.throwIfAborted()
        const current = latest.current
        if (owner !== currentScope.current || current?.viewRef !== start.viewRef || current.nextCursor !== start.nextCursor) throw new DOMException('录音读取已取消', 'AbortError')
        const merged = appendRecordingTranscriptPage(current, result)
        latest.current = merged; publish.current(merged)
        return merged
      } catch (reason) {
        if (!controller.signal.aborted && owner === currentScope.current) setError(reason instanceof Error ? reason.message : '读取录音失败')
        throw reason
      } finally {
        if (active.current === operation) { active.current = undefined; setLoading(false) }
      }
    })()
    active.current = operation
    return await operation.promise
  }, [])

  const through = useCallback(async (time?: number, signal?: AbortSignal): Promise<ArkmeRecordingTranscriptPage | undefined> => {
    signal?.throwIfAborted()
    const owner = currentScope.current, view = latest.current?.viewRef
    let value = latest.current
    const cursors = new Set<string>()
    while (value !== undefined && value.nextCursor !== '' && (time === undefined || (value.items.at(-1)?.startAtMillis ?? 0) <= time)) {
      signal?.throwIfAborted()
      if (owner !== currentScope.current || latest.current?.viewRef !== view) throw new DOMException('录音读取已取消', 'AbortError')
      if (cursors.has(value.nextCursor)) throw new Error('录音分页未前进')
      cursors.add(value.nextCursor)
      value = await next()
    }
    signal?.throwIfAborted()
    if (owner !== currentScope.current || latest.current?.viewRef !== view) throw new DOMException('录音读取已取消', 'AbortError')
    return value
  }, [next])

  return { next, through, loading, error }
}
