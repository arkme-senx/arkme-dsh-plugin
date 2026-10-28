import { useEffect, useState } from 'react'
import type { StatisticsDetail, StatisticsPoint, StatisticsQuery, StatisticsRecordPage } from '../../statistics-contract.js'
import { callArkme } from '../api.js'
import { withArkmeReadDeadline } from '../read-deadline.js'

export type StatisticsResource<T> = { value?: T; loading: boolean; error: string }
export const statisticsError = (error: unknown) => error instanceof Error ? error.message : '读取失败，请重试'
export function useStatistics<T extends StatisticsDetail | StatisticsPoint[] | StatisticsRecordPage | import('../../analytics-contract.js').PersonalKeywordSummary>(
  kind: 'detail' | 'active' | 'long' | 'keywords', query: StatisticsQuery, enabled: boolean, revision: number,
) {
  const key = JSON.stringify([query, revision]), [result, setResult] = useState<{ key: string; state: StatisticsResource<T> }>()
  useEffect(() => {
    if (!enabled) return
    const c = new AbortController()
    setResult({ key, state: { loading: true, error: '' } })
    void withArkmeReadDeadline(signal => callArkme<T>(`statistics.${kind}`, { ...query }, signal), c.signal)
      .then(value => { if (!c.signal.aborted) setResult({ key, state: { value, loading: false, error: '' } }) })
      .catch(error => { if (!c.signal.aborted) setResult({ key, state: { loading: false, error: statisticsError(error) } }) })
    return () => c.abort()
  }, [kind, key, enabled])
  return enabled && result?.key === key ? result.state : { loading: enabled, error: '' } as StatisticsResource<T>
}
