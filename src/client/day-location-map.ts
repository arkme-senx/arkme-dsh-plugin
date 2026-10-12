import type { DayLocationPoint } from './day-location-reader.js'

export function groupDayLocationPoints(points: readonly DayLocationPoint[]): DayLocationPoint[][] {
  const groups = new Map<string, DayLocationPoint[]>()
  for (const point of points) {
    const key = `${point.location.latitude.toFixed(5)},${point.location.longitude.toFixed(5)}`
    groups.set(key, [...(groups.get(key) ?? []), point])
  }
  return [...groups.values()]
}
