import type { ArkmeRecordingDay, ArkmeRecordingDayPartial } from '../../types.js'

/** Never fill unread projections from a different date/account snapshot. */
export function mergeRecordingDayParts(previous: ArkmeRecordingDay | undefined, next: ArkmeRecordingDayPartial): ArkmeRecordingDay | undefined {
  const current = previous?.dateStamp === next.dateStamp ? previous : undefined
  const transcript = next.transcript ?? current?.transcript
  if (!transcript) return undefined
  return { totalDurationMillis: next.totalDurationMillis ?? current?.totalDurationMillis ?? transcript.totalDurationMillis,
    ...(current?.coverage ? { coverage: current.coverage } : {}),
    ...(current?.metrics ? { metrics: current.metrics } : {}),
    summary: current?.summary ?? { state: 'empty', message: '', items: [] },
    timeline: current?.timeline ?? { state: 'empty', message: '', items: [] }, ...next, transcript }
}
