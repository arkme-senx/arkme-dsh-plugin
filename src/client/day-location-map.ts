import type { DayLocationPoint } from './day-location-reader.js'

export function mapPosition(latitude: number, longitude: number): { x: number; y: number } {
  const sin = Math.sin(Math.max(-85.05112878, Math.min(85.05112878, latitude)) * Math.PI / 180)
  return { x: (longitude + 180) / 360, y: .5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI) }
}

export function nearestWorldX(x: number, center: number): number { return x + Math.round(center - x) }

export function fitDayLocations(points: readonly DayLocationPoint[], width: number, height: number) {
  if (!points.length) return { x: .5, y: .5, zoom: 2 }
  const first = mapPosition(points[0]!.location.latitude, points[0]!.location.longitude)
  const positions = points.map(point => {
    const value = mapPosition(point.location.latitude, point.location.longitude)
    return { x: nearestWorldX(value.x, first.x), y: value.y }
  })
  const xs = positions.map(p => p.x), ys = positions.map(p => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const zoom = Math.floor(Math.min(Math.log2(Math.max(80, width - 100) / (256 * Math.max(maxX - minX, .000001))),
    Math.log2(Math.max(80, height - 100) / (256 * Math.max(maxY - minY, .000001)))))
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom: Math.max(2, Math.min(16, zoom)) }
}

export function groupDayLocationPoints(points: readonly DayLocationPoint[]): DayLocationPoint[][] {
  const groups = new Map<string, DayLocationPoint[]>()
  for (const point of points) {
    const key = `${point.location.latitude.toFixed(5)},${point.location.longitude.toFixed(5)}`
    groups.set(key, [...(groups.get(key) ?? []), point])
  }
  return [...groups.values()]
}
