import { describe, expect, it } from 'vitest'
import { conversationLocationGroups, locationRecordDate } from '../src/client/conversation-location-map.js'
import type { ConversationLocationRecord } from '../src/conversation-location.js'
import { worldLocationViewport } from '../src/location-search.js'
const point = (key: string, longitude = 114, source = 'my_sent') => ({ key, latitude: 30, longitude, source, label: '地点' }) as ConversationLocationRecord
describe('conversation location map projection', () => {
  it('groups positions while preserving every location record and source category', () => {
    const groups = conversationLocationGroups([point('snapshot'), point('sent'), point('received', 114, 'received_group')], worldLocationViewport)
    expect(groups).toHaveLength(2)
    expect(groups.map(group => group.marker.count).sort()).toEqual([1, 2])
    expect(groups.flatMap(group => group.records.map(item => item.key)).sort()).toEqual(['received', 'sent', 'snapshot'])
  })
  it('filters a wrapped date-line viewport correctly', () => {
    const groups = conversationLocationGroups([point('east', 179), point('west', -179), point('outside', 0)], {
      bounds: { swLat: -85, neLat: 85, swLon: 170, neLon: -170 }, zoom: 3,
    })
    expect(groups.flatMap(group => group.records.map(item => item.key)).sort()).toEqual(['east', 'west'])
  })
  it('uses the selected timezone and message send date, including DST dates', () => {
    const timestamp = Date.parse('2026-11-02T00:30:00Z')
    expect(locationRecordDate(timestamp, 'Asia/Shanghai')).toBe('2026-11-02')
    expect(locationRecordDate(timestamp, 'America/Los_Angeles')).toBe('2026-11-01')
  })
})
