import { describe, expect, it, vi } from 'vitest'
import { readDayLocations } from '../src/client/day-location-reader.js'
import { fitDayLocations, mapPosition, nearestWorldX } from '../src/client/day-location-map.js'
import type { callArkme } from '../src/client/api.js'

const query = { bucketDate: '2026-10-08', timezone: 'Asia/Shanghai' }
const location = { source: 'device', latitude: 30, longitude: 114, label: '办公楼' }
const record = (id: string, extra = {}) => ({ record_projection: { recordUid: id, sendAtMillis: 1000,
  locationRef: `ref-${id}`, protected: false, accessState: 'available', ...extra } })

describe('complete daily recorded locations', () => {
  it('paginates raw records independently of filters and groups, rechecks visibility, and deduplicates', async () => {
    const read = vi.fn(async (operation, params) => {
      if (operation === 'calendar.activity') return !params.body.cursor_record_uid
        ? { items: [record('one'), record('protected', { protected: true })], has_more: true, next_cursor: { cursor_record_uid: 'one', cursor_send_at: 1000 } }
        : { items: [record('one'), record('two'), record('revoked'), record('no-location')], has_more: false }
      const id = params.locationRef.slice(4)
      return { recordUid: id, access: id === 'revoked' ? 'restricted' : 'available', ...(id !== 'no-location' ? { location } : {}) }
    })
    const value = await readDayLocations(query, new AbortController().signal, () => {}, read as typeof callArkme)
    expect(value).toMatchObject({ complete: true, failed: 0, scanned: 5 })
    expect(value.points.map(point => point.id)).toEqual(['one', 'two'])
    expect(read.mock.calls.filter(call => call[0] === 'calendar.record-location')).toHaveLength(4)
    expect(read.mock.calls[0]![1].body).toMatchObject({ bucket_date: query.bucketDate, timezone: query.timezone, limit: 50 })
  })
  it('does not show stale coordinates after a failed permission read and reports partial results', async () => {
    const read = vi.fn(async operation => {
      if (operation === 'calendar.activity') return { items: [record('old', { locationObservation: location })], has_more: false }
      throw new Error('offline')
    })
    expect(await readDayLocations(query, new AbortController().signal, () => {}, read as typeof callArkme))
      .toMatchObject({ points: [], complete: false, failed: 1 })
  })
  it('distinguishes an empty day from cancellation and repeated cursors', async () => {
    const empty = vi.fn(async () => ({ items: [], has_more: false }))
    expect(await readDayLocations(query, new AbortController().signal, () => {}, empty as typeof callArkme)).toMatchObject({ points: [], complete: true })
    const repeated = vi.fn(async () => ({ items: [], has_more: true, next_cursor: { cursor_record_uid: 'same' } }))
    await expect(readDayLocations(query, new AbortController().signal, () => {}, repeated as typeof callArkme)).rejects.toThrow('分页未推进')
    const controller = new AbortController(); controller.abort()
    await expect(readDayLocations(query, controller.signal, () => {}, empty as typeof callArkme)).rejects.toThrow()
  })
  it('fits points across the date line without zooming out to the whole world', () => {
    const points = [179.9, -179.9].map((longitude, index) => ({ id: String(index), recordedAtMillis: 1, location: { ...location, source: 'device' as const, longitude } }))
    const camera = fitDayLocations(points, 600, 400)
    expect(camera.zoom).toBeGreaterThan(9)
    expect(Math.abs(nearestWorldX(mapPosition(30, -179.9).x, camera.x) - camera.x)).toBeLessThan(.001)
  })
})
