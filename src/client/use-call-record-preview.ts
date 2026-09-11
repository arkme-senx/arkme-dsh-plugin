import { useEffect, useRef, useState } from 'react'
import type { ArkmeCallDetail } from '../types.js'
import { callArkme } from './api.js'

/** Only fetch visible quick notes; abort on message/account changes and unmount. */
export function useCallRecordPreview(callRef: string | undefined, revision?: number | string) {
  const element = useRef<HTMLDivElement>(null)
  const [snapshot, setSnapshot] = useState<{ callRef: string; revision: number | string | undefined; detail?: ArkmeCallDetail; failed?: boolean }>()
  useEffect(() => {
    if (!callRef) return
    const controller = new AbortController()
    let started = false
    const fetchPreview = () => {
      if (started || controller.signal.aborted) return
      started = true
      void callArkme<ArkmeCallDetail>('calls.history.detail', { callRef }, controller.signal).then(detail => {
        if (!controller.signal.aborted) setSnapshot({ callRef, revision, detail })
      }).catch(() => {
        if (!controller.signal.aborted) setSnapshot({ callRef, revision, failed: true })
      })
    }
    const observer = typeof IntersectionObserver !== 'undefined' && element.current
      ? new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { fetchPreview(); observer?.disconnect() }
      }, { rootMargin: '160px' }) : undefined
    if (observer && element.current) observer.observe(element.current)
    else fetchPreview()
    return () => { observer?.disconnect(); controller.abort() }
  }, [callRef, revision])
  const current = snapshot?.callRef === callRef && snapshot?.revision === revision ? snapshot : undefined
  return { element, detail: current?.detail, failed: current?.failed === true }
}
