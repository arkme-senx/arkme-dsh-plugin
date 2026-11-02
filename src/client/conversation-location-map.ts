import type { ConversationLocationRecord } from '../conversation-location.js'
import type { LocationMarker, LocationViewport } from '../location-search.js'

const dateFormatters = new Map<string, Intl.DateTimeFormat>()
export function locationRecordDate(timestamp: number, timezone: string): string {
  let formatter = dateFormatters.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    dateFormatters.set(timezone, formatter)
    if (dateFormatters.size > 8) dateFormatters.delete(dateFormatters.keys().next().value!)
  }
  const parts = formatter.formatToParts(timestamp)
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-')
}
export function conversationLocationGroups(items: ConversationLocationRecord[], viewport: LocationViewport): Array<{ marker: LocationMarker; records: ConversationLocationRecord[] }> {
  const groups = new Map<string, ConversationLocationRecord[]>()
  const { bounds } = viewport, scale = 256 * 2 ** viewport.zoom
  for (const item of items) {
    if (item.latitude < bounds.swLat || item.latitude > bounds.neLat
      || (bounds.swLon > bounds.neLon ? item.longitude < bounds.swLon && item.longitude > bounds.neLon : item.longitude < bounds.swLon || item.longitude > bounds.neLon)) continue
    const sin = Math.sin(Math.max(-85, Math.min(85, item.latitude)) * Math.PI / 180)
    const x = (item.longitude + 180) / 360 * scale, y = (.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale
    const key = `${item.source}:${Math.floor(x / 48)}:${Math.floor(y / 48)}`
    const group = groups.get(key) ?? []; group.push(item); groups.set(key, group)
  }
  return [...groups].map(([key, records]) => ({ records, marker: { key,
    latitude: records.reduce((sum, record) => sum + record.latitude, 0) / records.length,
    longitude: records.reduce((sum, record) => sum + record.longitude, 0) / records.length,
    source: records[0]!.source, count: records.length,
    label: records.every(record => record.label === records[0]!.label) ? records[0]!.label : '', preview: '' } }))
}
