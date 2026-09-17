import { useEffect, useState } from 'react'
import { dayActivityQueryKey, type DayActivityLocationDetail, type DayActivityQuery, type DayActivityReader } from './calendar-activity-model.js'

/** Explicit, cancellable read: rendering a day/record never fetches every location. */
export function useDayActivityLocation(query: DayActivityQuery, activityId: string | undefined, snapshotId: string | undefined, reader?: DayActivityReader) {
  const key = JSON.stringify([dayActivityQueryKey(query), activityId, snapshotId])
  const [revision, retry] = useState(0)
  const [state, setState] = useState<{ key: string; loading: boolean; value?: DayActivityLocationDetail; error?: string }>({ key, loading: false })
  useEffect(() => {
    const controller = new AbortController()
    setState({ key, loading: !!activityId && !!snapshotId && !!reader?.loadLocation })
    if (activityId && snapshotId && reader?.loadLocation) {
      void Promise.resolve().then(() => {
        controller.signal.throwIfAborted()
        return reader.loadLocation!(query, activityId, { signal: controller.signal, snapshotId })
      }).then(value => {
        if (controller.signal.aborted) return
        if (dayActivityQueryKey(value.query) !== dayActivityQueryKey(query) || value.activityId !== activityId || value.snapshotId !== snapshotId) {
          throw new Error('地点结果已变化，请刷新当天活动')
        }
        setState({ key, loading: false, value })
      }).catch(error => {
        if (!controller.signal.aborted) setState({ key, loading: false, error: error instanceof Error ? error.message : '地点暂不可用，请重试' })
      })
    }
    return () => controller.abort()
    // key includes every date/account/filter/activity/read-session dimension.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reader, revision])
  return { loading: state.key === key ? state.loading : !!activityId,
    value: state.key === key ? state.value : undefined, error: state.key === key ? state.error : undefined,
    retry: () => retry(value => value + 1) }
}
