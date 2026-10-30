import { expect, it } from 'vitest'
import { decodeTeamMessageSnapshot, readTeamRecordMetadata } from '../src/team-snapshot-contract.js'

it('keeps exact Record clocks, zero values and unknown edit coverage',()=>{
  const value=decodeTeamMessageSnapshot({schema_version:1,recorded:true,version:3,snapshot_version:1,record_started_at:1000,send_at:1000,server_synced_at:3000,update_at:9000,record_duration_millis:0,edit_duration_millis:0,edit_duration_complete:true,capture_context:{client_name:'old device',automatic_location:{lat:0,lon:0,captured_at:900,accuracy_meters:0}}},'opaque-message')
  expect(value.detail).toMatchObject({startAtMillis:1000,completeAtMillis:1000,syncedAtMillis:3000,recordDurationMillis:0,editDurationMillis:0,durationState:'complete',locationCapture:{latitude:0,longitude:0,accuracyMeters:0}})
  const historical=decodeTeamMessageSnapshot({schema_version:1,recorded:false,version:2,snapshot_version:1,created_at:1000,update_at:2000,edit_duration_complete:false},'opaque')
  expect(historical.detail.completeAtMillis).toBeUndefined();expect(historical.detail.recordDurationMillis).toBeUndefined();expect(historical.detail.durationState).toBe('not-recorded')
  const partial=decodeTeamMessageSnapshot({schema_version:1,recorded:true,version:3,snapshot_version:1,record_duration_millis:10,edit_duration_complete:false},'opaque')
  expect(partial.detail.durationState).toBe('partial');expect(partial.detail.editDurationMillis).toBeUndefined()
})
it('rejects extra collection fields and contradictory location outcomes before sealing',()=>{
  const metadata={record_started_at:1000,send_at:1000,capture_context:{schema_version:1,captured_at:1000,client_name:'phone',device_state:'recorded',location_state:'permission_denied'}}
  expect(readTeamRecordMetadata(metadata).record_started_at).toBe(1000)
  expect(()=>readTeamRecordMetadata({...metadata,capture_context:{...metadata.capture_context,network_name:'SSID'}})).toThrow()
  expect(()=>readTeamRecordMetadata({...metadata,send_at:999})).toThrow()
  expect(()=>readTeamRecordMetadata({...metadata,capture_context:{...metadata.capture_context,automatic_location:{lat:0,lon:0,captured_at:900}}})).toThrow()
})
