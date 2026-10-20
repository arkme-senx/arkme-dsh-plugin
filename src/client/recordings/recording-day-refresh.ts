import type { ArkmeRecordingDay } from '../../types.js'

/** A day read can succeed while one of its independent sections fails. */
export function reconcileRecordingDayRefresh(previous: ArkmeRecordingDay | undefined, next: ArkmeRecordingDay): { day: ArkmeRecordingDay; error: string } {
  if (!previous || previous.dateStamp !== next.dateStamp) return { day: next, error: '' }
  const failed = (['transcript', 'summary', 'timeline'] as const)
    .filter(key => next[key].state === 'error' && previous[key].state !== 'error')
  if (failed.length === 0) return { day: next, error: '' }
  return {
    day: {
      ...next,
      ...Object.fromEntries(failed.map(key => [key, previous[key]])),
      ...(failed.includes('transcript') ? { coverage: previous.coverage, totalDurationMillis: previous.totalDurationMillis } : {}),
    },
    error: failed.map(key => next[key].message).filter(Boolean).join('；') || '更新失败',
  }
}
