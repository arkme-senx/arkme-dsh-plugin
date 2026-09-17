import { describe, expect, it, vi } from 'vitest'
import { CalendarService } from '../src/services/calendar-service.js'
import { recordLocationObservation } from '../src/record-location-observation.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'

const at = Date.parse('2026-09-19T10:00:00+08:00')
const fact = { source_kind: 1, lat: 30.52, lon: 114.31, captured_at: at }
const record = (changes: Record<string, unknown> = {}) => ({ record_uid: 'mine', send_at: at,
  record_core: { record_uid: 'mine', owner_user_id: 42, content_access_state: 1, send_at: at, text_content: '文字' }, ...changes })
function setup(items = [record({ location: fact })]) {
  const runtime = { config: { recordBaseUrl: 'https://owner.test' },
    requireSession: vi.fn(async () => ({ userId: 42 })),
    authenticatedCalendarPost: vi.fn(async () => ({ items, has_more: false })),
    authenticatedPost: vi.fn(async (path: string) => path.endsWith('/detail') ? record({ location: fact })
      : { record_uid: 'mine', position_detail: { city: '武汉市', county: '洪山区', road: '高新大道' } }),
  }
  const privacy = { lockedRecordUids: vi.fn(async () => new Set<string>()) }
  const media = { hydrateRecordMediaPage: vi.fn(async () => ({ displayItemsByRecordUid: new Map(), unavailableRecordUids: new Set() })) }
  const records = { recordTimelineItemFromRaw: vi.fn(() => ({ textContent: '文字' })) }
  const source = { searchTargetSource: vi.fn(async () => undefined), chatSourcesBySessionUids: vi.fn(async () => new Map()) }
  const service = new CalendarService(runtime as never, privacy as never, media as never, records as never, source as never)
  const issue = async () => (await service.dayRecords({ bucketDate: '2026-09-19', timezone: 'Asia/Shanghai' })).items[0]!.locationRef!
  return { service, runtime, privacy, issue }
}

describe('historical device location projection', () => {
  it('uses explicit capture time and device label; never the time of reading', () => {
    expect(recordLocationObservation({ location: fact, capture_context: { client_name: '手机' } })).toMatchObject({
      source: 'device', latitude: 30.52, longitude: 114.31, capturedAtMillis: at, deviceLabel: '手机',
    })
    expect(recordLocationObservation({ location: { ...fact, captured_at: undefined } })).not.toHaveProperty('capturedAtMillis')
    expect(recordLocationObservation({ location: { ...fact, captured_at: at / 1000 } })?.capturedAtMillis).toBe(at)
  })
  it.each([undefined, 0, -1, NaN, Infinity, 9e15])('keeps an invalid/missing capture time unknown: %s', captured_at => {
    expect(recordLocationObservation({ location: { ...fact, captured_at } })).not.toHaveProperty('capturedAtMillis')
  })
  it('rejects shared places, unknown origins and forwarded/embedded locations', () => {
    for (const location of [{ ...fact, source_kind: 2 }, { lat: 30.52, lon: 114.31 }]) {
      expect(recordLocationObservation({ location })).toBeUndefined()
    }
    expect(recordLocationObservation({ content_payload: { location: fact, location_mentions: [fact] } })).toBeUndefined()
    expect(recordLocationObservation({ location: { ...fact, source_kind: 2 } }, { location: fact })).toBeUndefined()
  })
  it.each([{ lat: 100 }, { lon: 190 }, { lat: NaN }, { lat: 0, lon: 0 }, { lon: '114.31' }])('rejects malformed coordinates: %j', changes => {
    expect(recordLocationObservation({ location: { ...fact, ...changes } })).toBeUndefined()
  })
  it('enriches an explicit fact without replacing its coordinates with another point', () => {
    expect(recordLocationObservation({ location: fact }, { position_detail: { city: '武汉市', road: '高新大道' } })?.label).toBe('武汉市高新大道')
    expect(recordLocationObservation({ location: fact }, { location: { ...fact, lat: 31 }, position_detail: { city: '错误地点' } })?.label).toBeUndefined()
  })
})

describe('calendar location read capability', () => {
  it('projects inline facts without extra reads, then uses only existing detail endpoints on demand', async () => {
    const { service, runtime, issue } = setup()
    const ref = await issue()
    expect(runtime.authenticatedPost).not.toHaveBeenCalled()
    const result = await service.recordLocation(ref)
    expect(result).toMatchObject({ recordUid: 'mine', access: 'available', location: { capturedAtMillis: at, label: '武汉市洪山区高新大道' } })
    expect(runtime.authenticatedPost.mock.calls.map(call => call[0])).toEqual(['/api/v1/records/detail', '/api/v1/records/location/context/get'])
  })
  it('does not issue capabilities or project location for another owner or restricted records', async () => {
    const other = record({ record_core: { record_uid: 'mine', owner_user_id: 7, content_access_state: 1 } , location: fact })
    const { service } = setup([other, record({ record_uid: 'locked', record_core: { record_uid: 'locked', content_access_state: 2 }, location: fact })])
    const page = await service.dayRecords({ bucketDate: '2026-09-19' })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).not.toHaveProperty('locationRef')
    expect(page.items[0]).not.toHaveProperty('locationObservation')
  })
  it('rejects fabricated, expired, disposed and cross-account references before reading', async () => {
    const { service, runtime, issue } = setup()
    await expect(service.recordLocation('mine')).rejects.toMatchObject({ code: 'calendar-location-ref-invalid' })
    const ref = await issue()
    runtime.requireSession.mockResolvedValue({ userId: 43 })
    await expect(service.recordLocation(ref)).rejects.toMatchObject({ code: 'calendar-location-ref-invalid' })
    runtime.requireSession.mockResolvedValue({ userId: 42 })
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000)
    await expect(service.recordLocation(ref)).rejects.toMatchObject({ code: 'calendar-location-ref-invalid' })
    clock.mockRestore()
    service.dispose()
    await expect(service.recordLocation(ref)).rejects.toMatchObject({ code: 'calendar-location-ref-invalid' })
    expect(runtime.authenticatedPost).not.toHaveBeenCalled()
  })
  it('checks the environment and abort signal', async () => {
    const { service, runtime, issue } = setup()
    const ref = await issue()
    runtime.config.recordBaseUrl = 'https://another.test'
    await expect(service.recordLocation(ref)).rejects.toMatchObject({ code: 'calendar-location-ref-invalid' })
    const controller = new AbortController(); controller.abort()
    await expect(service.recordLocation(ref, controller.signal)).rejects.toThrow()
    expect(runtime.authenticatedPost).not.toHaveBeenCalled()
  })
  it('rechecks owner/access and locks without leaking coordinates', async () => {
    const { service, runtime, privacy, issue } = setup()
    const ref = await issue()
    privacy.lockedRecordUids.mockResolvedValue(new Set(['mine']))
    expect(await service.recordLocation(ref)).toEqual({ recordUid: 'mine', access: 'restricted' })
    expect(runtime.authenticatedPost).not.toHaveBeenCalled()
    privacy.lockedRecordUids.mockResolvedValue(new Set())
    for (const core of [{ owner_user_id: 7, content_access_state: 1 }, { owner_user_id: 42, content_access_state: 2 }, { content_access_state: 1 }]) {
      runtime.authenticatedPost.mockResolvedValueOnce(record({ record_core: { record_uid: 'mine', ...core }, location: fact }))
      expect(await service.recordLocation(ref)).toEqual({ recordUid: 'mine', access: 'restricted' })
    }
    expect(runtime.authenticatedPost.mock.calls.every(call => call[0].endsWith('/detail'))).toBe(true)
  })
  it('surfaces upstream failure rather than claiming there was no location', async () => {
    const { service, runtime, issue } = setup()
    const ref = await issue()
    runtime.authenticatedPost.mockRejectedValueOnce(new Error('offline'))
    await expect(service.recordLocation(ref)).rejects.toThrow('offline')
    runtime.authenticatedPost.mockResolvedValueOnce(record({ location: fact })).mockRejectedValueOnce(new Error('context offline'))
    await expect(service.recordLocation(ref)).rejects.toThrow('context offline')
  })
  it('rejects mismatched record/context and a mid-flight account switch', async () => {
    const { service, runtime, issue } = setup()
    const ref = await issue()
    runtime.authenticatedPost.mockResolvedValueOnce(record({ record_core: { record_uid: 'another' } }))
    await expect(service.recordLocation(ref)).rejects.toMatchObject({ code: 'calendar-location-mismatch' })
    runtime.authenticatedPost.mockResolvedValueOnce(record()).mockResolvedValueOnce({ record_uid: 'another' } as never)
    await expect(service.recordLocation(ref)).rejects.toMatchObject({ code: 'calendar-location-mismatch' })
    runtime.authenticatedPost.mockImplementation(async path => {
      if (path.endsWith('/detail')) return record({ location: fact })
      runtime.requireSession.mockResolvedValue({ userId: 43 })
      return { record_uid: 'mine' } as never
    })
    await expect(service.recordLocation(ref)).rejects.toMatchObject({ code: 'calendar-location-ref-invalid' })
  })
  it('forwards only the opaque reference and cancellation through Host dispatch', async () => {
    const service = { calendarRecordLocation: vi.fn() }, signal = new AbortController().signal
    await dispatchArkmeHostOperation(service as never, 'calendar.record-location', { locationRef: 'opaque', userId: 999, recordUid: 'other' }, undefined, undefined, undefined, undefined, signal)
    expect(service.calendarRecordLocation).toHaveBeenCalledExactlyOnceWith('opaque', signal)
  })
})
