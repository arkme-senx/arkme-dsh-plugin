import { afterEach, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({call:vi.fn(),location:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.call}))
vi.mock('../src/client/record-capture-location.js',async original=>({...await original<typeof import('../src/client/record-capture-location.js')>(),captureArkmeRecordLocation:mocks.location}))
import { prepareTeamCapture } from '../src/client/team-message-snapshot.js'
import { ArkmeLocationCaptureError } from '../src/client/record-capture-location.js'
const input={accountKey:'test:42',conversationRef:'opaque-conversation',operationUid:'11111111-1111-4111-8111-111111111111',startedAt:1000,completeAt:1000}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.resetAllMocks()})
it('freezes only authorized position and pure device display without battery or network',async()=>{
  const battery=vi.fn();vi.stubGlobal('navigator',{userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/130',getBattery:battery})
  mocks.call.mockImplementation(async op=>op==='team.app.snapshot.capabilities'?{schemaVersion:1}:{metadataRef:'sealed-only'})
  mocks.location.mockResolvedValue({latitude:0,longitude:0,capturedAtMillis:900,accuracyMeters:0,altitudeMeters:50})
  const value=await prepareTeamCapture(input,new AbortController().signal)
  expect(value).toEqual({protocolVersion:1,metadataRef:'sealed-only'})
  const sealed=mocks.call.mock.calls.find(([op])=>op==='team.app.snapshot.seal')![1]
  expect(sealed.metadata).toMatchObject({record_started_at:1000,send_at:1000,capture_context:{location_state:'recorded',automatic_location:{lat:0,lon:0,captured_at:900,accuracy_meters:0}}})
  expect(battery).not.toHaveBeenCalled();expect(JSON.stringify(sealed)).not.toMatch(/network_name|electric|altitude|ssid/iu)
  expect(mocks.location.mock.calls[0]![0]).toBe('automatic-send')
})
it('records permission refusal and keeps absent start unknown',async()=>{
  mocks.call.mockImplementation(async op=>op==='team.app.snapshot.capabilities'?{schemaVersion:1}:{metadataRef:'sealed'})
  mocks.location.mockRejectedValue(new ArkmeLocationCaptureError('denied','denied'))
  await prepareTeamCapture({...input,startedAt:2000},new AbortController().signal)
  const metadata=mocks.call.mock.calls.find(([op])=>op==='team.app.snapshot.seal')![1].metadata
  expect(metadata.record_started_at).toBeUndefined();expect(metadata.capture_context.location_state).toBe('permission_denied');expect(metadata.capture_context.automatic_location).toBeUndefined()
})
it('does not collect for unsupported services or alter a frozen attempt with late location',async()=>{
  mocks.call.mockResolvedValue({schemaVersion:0})
  expect((await prepareTeamCapture(input,new AbortController().signal)).protocolVersion).toBe(0);expect(mocks.location).not.toHaveBeenCalled()
  vi.useFakeTimers();let finish!:(value:unknown)=>void
  mocks.call.mockImplementation(async op=>op==='team.app.snapshot.capabilities'?{schemaVersion:1}:{metadataRef:'sealed'})
  mocks.location.mockImplementation(()=>new Promise(resolve=>finish=resolve))
  const pending=prepareTeamCapture(input,new AbortController().signal)
  await vi.advanceTimersByTimeAsync(2501)
  await expect(pending).resolves.toMatchObject({metadataRef:'sealed'})
  const count=mocks.call.mock.calls.filter(([op])=>op==='team.app.snapshot.seal').length
  finish({latitude:30,longitude:120,capturedAtMillis:3000});await Promise.resolve()
  expect(mocks.call.mock.calls.filter(([op])=>op==='team.app.snapshot.seal')).toHaveLength(count)
})
