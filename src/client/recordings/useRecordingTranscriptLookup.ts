import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArkmeRecordingDaySearchCandidate, ArkmeRecordingSearchIdentity, ArkmeRecordingTranscriptLocation, ArkmeRecordingWindow } from '../../types.js'
import { ArkmeClientError, callArkme } from '../api.js'
import { withArkmeReadDeadline } from '../read-deadline.js'
import { recordingSearchTargetHash } from './recording-search-target.js'
import { findRecordingTranscriptMatches } from './recording-transcript-search.js'

type LocationRequest = { dateStamp: number; startAtMillis: number; window?: ArkmeRecordingWindow } & (
  { target: ArkmeRecordingSearchIdentity } | { identityHash: string; query?: string }
)
type LocationState = { kind: 'loading' | 'missing' | 'unsupported' }
  | { kind: 'ready'; value: ArkmeRecordingTranscriptLocation }
  | { kind: 'error'; message: string }

export function useRecordingTranscriptLocation(scope: string) {
  const [result, setResult] = useState<{ scope: string; state: LocationState }>()
  const active = useRef<AbortController>()
  const lastRequest = useRef<LocationRequest>()
  const currentScope = useRef(scope)
  currentScope.current = scope
  const clear = useCallback(() => {
    active.current?.abort()
    active.current = undefined
    lastRequest.current = undefined
    setResult(undefined)
  }, [])
  useEffect(() => () => { active.current?.abort() }, [scope])

  const locate = useCallback(async (request: LocationRequest) => {
    active.current?.abort()
    const controller = new AbortController()
    const requestScope = currentScope.current
    active.current = controller
    lastRequest.current = request
    const publish = (state: LocationState) => {
      if (!controller.signal.aborted && currentScope.current === requestScope) setResult({ scope: requestScope, state })
    }
    publish({ kind: 'loading' })
    try {
      const identityHash = 'target' in request ? await recordingSearchTargetHash(request.target) : request.identityHash
      const version = 'target' in request ? request.target.transcriptVersion : undefined
      const { dateStamp, startAtMillis } = request
      const value = await withArkmeReadDeadline(signal => callArkme<ArkmeRecordingTranscriptLocation | null>('recordings.transcript.locate', {
        dateStamp, startAtMillis, identityHash, ...(version ? { version } : {}),
        ...(request.window ? { window: request.window } : {}),
      }, signal), controller.signal)
      const query = 'query' in request ? request.query : undefined
      const matches = !query || value && findRecordingTranscriptMatches(value.items.filter(item => item.itemId === value.focusItemId), query).length > 0
      publish(value && matches ? { kind: 'ready', value } : { kind: 'missing' })
    } catch (error) {
      if (error instanceof ArkmeClientError && error.body.code === 'operation-unknown') publish({ kind: 'unsupported' })
      else publish({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }, [])
  return { state: result?.scope === scope ? result.state : undefined, locate, clear,
    clearCandidate: () => { if (lastRequest.current && 'identityHash' in lastRequest.current) clear() },
    retry: () => { if (lastRequest.current) void locate(lastRequest.current) } }
}

const emptyCandidates: readonly ArkmeRecordingDaySearchCandidate[] = []
export function useRecordingDaySearchCandidates(scope: string, dateStamp: number, query: string, enabled: boolean) {
  const [result, setResult] = useState<{ scope: string; query: string; items: ArkmeRecordingDaySearchCandidate[] }>()
  useEffect(() => {
    if (!enabled || !query) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void withArkmeReadDeadline(signal => callArkme<ArkmeRecordingDaySearchCandidate[]>('recordings.transcript.search', { dateStamp, query }, signal), controller.signal)
        .then(items => { if (!controller.signal.aborted && Array.isArray(items)) setResult({ scope, query, items }) })
        .catch(() => { /* Continue matching the day document if the search service is unavailable. */ })
    }, 450)
    return () => { clearTimeout(timer); controller.abort() }
  }, [scope, dateStamp, query, enabled])
  return enabled && result?.scope === scope && result.query === query ? result.items : emptyCandidates
}
