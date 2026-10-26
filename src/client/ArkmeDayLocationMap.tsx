import type { ArkmeRecordLocationObservation } from '../types.js'
import type { DayActivityQuery } from './calendar-activity-model.js'
import { ArkmeLocationDialog } from './ArkmeLocationDialog.js'

export function ArkmeDayLocationMap({ query, initialLocation, onClose }: {
  query: DayActivityQuery; initialLocation?: ArkmeRecordLocationObservation; onClose(): void
}) {
  return <ArkmeLocationDialog initialDate={{ bucketDate: query.bucketDate, timezone: query.timezone }}
    {...(initialLocation ? { initialLocation } : {})} onClose={onClose}/>
}
