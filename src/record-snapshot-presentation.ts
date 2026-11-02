/** Presentation of Record properties shared by every conversation. */
const stringValue = (v: unknown): string => typeof v === 'string' ? v : ''
const objectValue = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const finiteNumberValue = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) ? v : undefined
const numberValue = (v: unknown): number => finiteNumberValue(v) ?? 0
const firstSnapshotText = (...values: unknown[]): string | undefined => values.map(v => stringValue(v).trim()).find(Boolean)

export function snapshotDateLabel(value: number | undefined): string | undefined {
  if (value === undefined) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}


export function snapshotMovement(value: Record<string, unknown>): string | undefined {
  const rawSpeed = value.speed ?? value.speed_mps ?? value.speedMetersPerSecond
  const speed = numberValue(rawSpeed)
  if (typeof rawSpeed === 'number' && Number.isFinite(rawSpeed)) {
    const kmh = Math.round(speed * 3.6)
    return kmh <= 2 ? '静止' : kmh <= 5 ? `缓慢移动（${String(kmh)}km/h）` : kmh <= 60 ? `移动（${String(kmh)}km/h）` : `高速移动（${String(kmh)}km/h）`
  }
  if (typeof value.activity !== 'number' || !Number.isFinite(value.activity)) return undefined
  const activity = Math.trunc(value.activity)
  return activity === 0 ? '静止' : activity === 1 ? '步行' : activity === 2 ? '跑步' : activity === 3 ? '骑行' : activity === 4 ? '驾车' : undefined
}


export function snapshotWeatherText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const direct = stringValue(value).trim()
    if (direct !== '') return direct
    const weather = objectValue(value)
    if (Object.keys(weather).length === 0) continue
    const temperature = finiteNumberValue(weather.temp ?? weather.temperature)
    const condition = firstSnapshotText(
      weather.weather, weather.weatherText, weather.weather_text,
      weather.condition_ch, weather.conditionCh, weather.condition,
    )
    if (temperature !== undefined || condition !== undefined) {
      return `${temperature === undefined ? '' : `${String(Math.round(temperature))}°`}${temperature === undefined || condition === undefined ? '' : ' '}${condition ?? ''}`.trim()
    }
  }
  return undefined
}

export function snapshotPositionLabel(position: Record<string, unknown>): string {
  const area = [firstSnapshotText(position.city)?.replace(/市$/, ''), firstSnapshotText(position.county)?.replace(/(区|县|市)$/, '')].filter(Boolean).join('·')
  return [area, firstSnapshotText(position.road), firstSnapshotText(position.poi, position.poi_name, position.poiName)].join('')
}
