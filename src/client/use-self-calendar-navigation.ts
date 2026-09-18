import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { ArkmeCalendarDayRecordPage, ArkmeCalendarAnchor, ArkmeCalendarMomentAnchor } from '../types.js'
import { callArkme } from './api.js'
import { withArkmeReadDeadline } from './read-deadline.js'

export interface SelfCalendarDateSelection { bucketDate: string; timezone: string; anchor?: ArkmeCalendarAnchor; momentAnchor?: ArkmeCalendarMomentAnchor }
export interface SelfCalendarNavigationStatus extends SelfCalendarDateSelection {
  phase: 'loading' | 'error'
  error?: string
}

/** Owns both the calendar request and its subsequent timeline locate, not the popover lifetime. */
export function useSelfCalendarNavigation(options: {
  scopeKey: string
  sourceRef: string | undefined
  targetRevision: number | undefined
  locate(item: ArkmeCalendarAnchor): number
  locateMoment?(item: ArkmeCalendarMomentAnchor): number
  cancelTarget(revision: number): void
}) {
  const callbacks = useRef(options)
  callbacks.current = options
  const [status, setStatus] = useState<SelfCalendarNavigationStatus>()
  const job = useRef<{
    controller: AbortController; selection: SelfCalendarDateSelection
    revision: number | undefined; initialRevision: number | undefined; failed: boolean; startingLocate: boolean
  }>()
  const cancel = useCallback(() => {
    const previous = job.current
    job.current = undefined
    previous?.controller.abort()
    if (previous?.revision !== undefined) callbacks.current.cancelTarget(previous.revision)
    setStatus(undefined)
  }, [])
  useLayoutEffect(() => {
    cancel()
    return cancel
  }, [options.scopeKey, cancel])
  useLayoutEffect(() => {
    const current = job.current
    if (current === undefined || current.failed && options.targetRevision === undefined) return
    // The UI store may notify synchronously inside locate(), before it returns its revision.
    if (current.startingLocate) {
      current.revision = options.targetRevision
      return
    }
    if (options.targetRevision !== (current.revision ?? current.initialRevision)) cancel()
  }, [options.targetRevision, cancel])

  const select = useCallback((selection: SelfCalendarDateSelection) => {
    cancel()
    const sourceRef = callbacks.current.sourceRef
    if (sourceRef === undefined) return
    const current = { controller: new AbortController(), selection, revision: undefined as number | undefined,
      initialRevision: callbacks.current.targetRevision, failed: false, startingLocate: false }
    job.current = current
    setStatus({ ...selection, phase: 'loading' })
    const request = selection.momentAnchor !== undefined ? Promise.resolve(selection.momentAnchor)
      : selection.anchor !== undefined ? Promise.resolve(selection.anchor)
      : withArkmeReadDeadline(signal => callArkme<ArkmeCalendarDayRecordPage>('calendar.records', {
      sourceRef, ...selection, limit: 1,
    }, signal), current.controller.signal).then(page => page.items[0])
    void request.then(item => {
      if (job.current !== current || current.controller.signal.aborted) return
      if (item === undefined) throw new Error('这一天没有可查看的记录，请重新选择日期')
      current.startingLocate = true
      try {
        if ('momentId' in item) {
          if (!callbacks.current.locateMoment) throw new Error('当前会话暂不支持互动定位')
          current.revision = callbacks.current.locateMoment(item)
        } else current.revision = callbacks.current.locate(item)
      }
      finally { current.startingLocate = false }
    }).catch(error => {
      if (job.current !== current || current.controller.signal.aborted) return
      current.failed = true
      setStatus({ ...selection, phase: 'error', error: error instanceof Error ? error.message : '暂时无法定位这一天的记录' })
    })
  }, [cancel])

  const finish = useCallback((revision: number, error?: string): boolean => {
    const current = job.current
    if (current?.revision !== revision) return false
    if (error !== undefined) {
      current.failed = true
      setStatus({ ...current.selection, phase: 'error', error })
    }
    else {
      job.current = undefined
      setStatus(undefined)
    }
    return true
  }, [])
  const owns = useCallback((revision: number) => job.current?.revision === revision, [])
  const retry = useCallback(() => { if (job.current !== undefined) select(job.current.selection) }, [select])
  return { status, select, cancel, finish, owns, retry }
}
