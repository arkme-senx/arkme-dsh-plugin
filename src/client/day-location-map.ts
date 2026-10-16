import type { DayLocationPoint } from './day-location-reader.js'

export function groupDayLocationPoints(points: readonly DayLocationPoint[]): DayLocationPoint[][] {
  const groups = new Map<string, DayLocationPoint[]>()
  for (const point of points) {
    const key = `${point.location.latitude.toFixed(5)},${point.location.longitude.toFixed(5)}`
    const group = groups.get(key)
    if (group) group.push(point)
    else groups.set(key, [point])
  }
  return [...groups.values()]
}
