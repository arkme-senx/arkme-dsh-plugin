import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecordingEntityItem, RecordingEntityOccurrence, RecordingEntityOccurrences } from '../../recording-entity-contract.js'
import { callArkme } from '../api.js'
import { withArkmeReadDeadline } from '../read-deadline.js'

interface LoadedMentions { key: string; items: RecordingEntityOccurrence[]; nextOffset: number; hasMore: boolean }

/** One expanded entity owns a cancellable request and a version-bound, bounded prefix. */
export function useRecordingEntityOccurrences(entity: RecordingEntityItem | undefined, version: string | undefined, active: boolean, participantKey?: string) {
  const key = JSON.stringify([version, entity?.key, participantKey])
  const owner = useRef({ key, active })
  owner.current = { key, active }
  const reference = useRef(entity?.entityRef)
  reference.current = entity?.entityRef
  const loaded = useRef<LoadedMentions>()
  const pending = useRef<AbortController>()
  const [detail, setDetail] = useState<LoadedMentions>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const loadMore = useCallback(() => {
    if (!active || !owner.current.active || owner.current.key !== key || !reference.current || pending.current) return
    const previous = loaded.current?.key === key ? loaded.current : undefined
    if (previous && !previous.hasMore) return
    const offset = previous?.nextOffset ?? 0
    const controller = new AbortController()
    pending.current = controller
    setLoading(true); setError(false)
    void withArkmeReadDeadline(signal => callArkme<RecordingEntityOccurrences>('recordings.entities.occurrences', {
      entityRef: reference.current!, offset, limit: 50,
      ...(participantKey ? { participantKey } : {}),
    }, signal), controller.signal).then(value => {
      if (controller.signal.aborted) return
      const nextOffset = offset + value.items.length
      if (value.version !== version || value.offset !== offset || value.items.length > 50 || nextOffset > 10000
        || (value.hasMore && (nextOffset === offset || nextOffset >= 10000))) throw new Error('Invalid entity mention page')
      const next = { key, items: [...previous?.items ?? [], ...value.items], nextOffset, hasMore: value.hasMore }
      loaded.current = next; setDetail(next)
    }).catch(() => { if (!controller.signal.aborted) setError(true) })
      .finally(() => {
        if (pending.current !== controller) return
        pending.current = undefined
        if (!controller.signal.aborted) setLoading(false)
      })
  }, [key, version, active, participantKey])
  useEffect(() => {
    setLoading(false); setError(false)
    if (loaded.current?.key !== key) { loaded.current = undefined; setDetail(undefined) }
    if (active && !loaded.current) loadMore()
    return () => { pending.current?.abort(); pending.current = undefined }
  }, [key, active, loadMore])
  return { detail: detail?.key === key ? detail : undefined, loading, error, loadMore }
}
