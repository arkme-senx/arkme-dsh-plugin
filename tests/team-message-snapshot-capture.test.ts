import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
import { prepareTeamCapture } from '../src/client/team-message-snapshot.js'

const input = { accountKey: 'test:42', conversationRef: 'opaque-conversation', operationUid: '11111111-1111-4111-8111-111111111111', startedAt: 1000, completeAt: 1000 }
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks() })
const supported = () => mocks.call.mockImplementation(async op => op === 'team.app.snapshot.capabilities'
  ? { schemaVersion: 1, recordPropertiesVersion: 1 } : { metadataRef: 'sealed' })

it('seals input facts without starting device or location collection at submission', async () => {
  const battery = vi.fn(), getCurrentPosition = vi.fn()
  vi.stubGlobal('navigator', { getBattery: battery, geolocation: { getCurrentPosition } })
  supported()
  await expect(prepareTeamCapture({ ...input, context: { clientName: '输入时设备', networkName: 'WiFi', electric: 0, charge: 1 },
    location: { latitude: 30, longitude: 120, capturedAtMillis: 900, accuracyMeters: 0, altitudeMeters: -50, speedMetersPerSecond: 0 } }, new AbortController().signal)).resolves.toEqual({ protocolVersion: 1, metadataRef: 'sealed' })
  expect(battery).not.toHaveBeenCalled(); expect(getCurrentPosition).not.toHaveBeenCalled()
  expect(mocks.call.mock.calls.find(([op]) => op === 'team.app.snapshot.seal')![1].metadata).toMatchObject({
    record_started_at: 1000, send_at: 1000, capture_context: { device_state: 'recorded', client_name: '输入时设备',
      electric: 0, charge: 1, automatic_location: { lat: 30, lon: 120, captured_at: 900, accuracy_meters: 0, alt: -50, speed: 0 } },
  })
})
it('keeps absent input facts unknown and does not invent a start after completion', async () => {
  supported()
  await prepareTeamCapture({ ...input, startedAt: 2000 }, new AbortController().signal)
  const metadata = mocks.call.mock.calls.find(([op]) => op === 'team.app.snapshot.seal')![1].metadata
  expect(metadata.record_started_at).toBeUndefined()
  expect(metadata.capture_context).toMatchObject({ device_state: 'unavailable', location_state: 'not_recorded' })
  expect(metadata.capture_context.automatic_location).toBeUndefined()
})
it('drops a location captured after completion and binds edit metadata to the selected revision', async () => {
  supported()
  await prepareTeamCapture({ ...input, messageRef: 'message', location: { latitude: 30, longitude: 120, capturedAtMillis: 2000 } }, new AbortController().signal)
  const metadata = mocks.call.mock.calls.find(([op]) => op === 'team.app.snapshot.seal')![1].metadata
  expect(metadata.revision_uid).toBe(input.operationUid)
  expect(metadata.edit_capture_context.automatic_location).toBeUndefined()
})
it.each([{ schemaVersion: 0 }, { schemaVersion: 1 }])('does not seal properties when the service lacks the complete capability', async capability => {
  mocks.call.mockResolvedValue(capability)
  await expect(prepareTeamCapture(input, new AbortController().signal)).resolves.toMatchObject({ protocolVersion: 0 })
  expect(mocks.call).toHaveBeenCalledOnce()
})
