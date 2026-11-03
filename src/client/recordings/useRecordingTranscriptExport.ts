import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { ArkmeRecordingTranscriptPage } from '../../types.js'

type ExportJob = { scope: string; controller: AbortController }
type ExportState = { scope: string; pending: boolean; error: string }
type ReadThrough = (time?: number, signal?: AbortSignal) => Promise<ArkmeRecordingTranscriptPage | undefined>

/** Keep one full-text export attached to the visible account, day and tab. */
export function useRecordingTranscriptExport(scope: string, through: ReadThrough) {
  const currentScope = useRef(scope), active = useRef<ExportJob>()
  currentScope.current = scope
  const [state, setState] = useState<ExportState>()
  useLayoutEffect(() => {
    setState(undefined)
    return () => {
      active.current?.controller.abort()
      active.current = undefined
    }
  }, [scope])

  const run = useCallback(async (consume: (page: ArkmeRecordingTranscriptPage) => void) => {
    if (active.current?.scope === currentScope.current) return
    const job: ExportJob = { scope: currentScope.current, controller: new AbortController() }
    active.current = job
    const isCurrent = () => active.current === job && currentScope.current === job.scope && !job.controller.signal.aborted
    setState({ scope: job.scope, pending: true, error: '' })
    try {
      const page = await through(undefined, job.controller.signal)
      if (!isCurrent()) return
      if (page === undefined) throw new Error('转写尚未就绪')
      // Consume synchronously after checking scope: a late response must never
      // download an earlier date/account or publish feedback into another tab.
      consume(page)
      setState(undefined)
    } catch (reason) {
      if (isCurrent()) setState(reason instanceof Error && reason.name === 'AbortError'
        ? undefined : { scope: job.scope, pending: false, error: '完整转写读取失败，请重试' })
    } finally {
      if (active.current === job) active.current = undefined
    }
  }, [through])

  return { run, pending: state?.scope === scope && state.pending, error: state?.scope === scope ? state.error : '' }
}
