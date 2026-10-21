import { useSyncExternalStore } from 'react'
import { arkmeAuthStore } from './auth-store.js'
import type { DayActivityQuery, DayActivityReader } from './calendar-activity-model.js'
import { localDayBounds } from './documented-day-activity-reader.js'
import { useDayActivities } from './use-day-activities.js'
import { useReactionHistory } from './use-reaction-history.js'

/** The calendar owns one day's reads; changing presentation does not restart them. */
export function useDayTimelineData(query: DayActivityQuery, reader: DayActivityReader | undefined,
  refreshVersion = 0, enabled = true, privacyRevision = 0) {
  const activities = useDayActivities(query, reader, refreshVersion, enabled)
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const scope = auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : undefined
  const [start, end] = localDayBounds(query)
  const reactions = useReactionHistory(enabled && scope === query.accountScope ? scope : undefined, start, end, refreshVersion, privacyRevision)
  return { activities, reactions }
}

export type DayTimelineData = ReturnType<typeof useDayTimelineData>
