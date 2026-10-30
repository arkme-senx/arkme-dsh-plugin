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
it('accepts ordinary Record properties and rejects malformed facts before sealing',()=>{
  const metadata={record_started_at:1000,send_at:1000,capture_context:{schema_version:1,captured_at:1000,client_name:'phone',device_state:'recorded',location_state:'permission_denied'}}
  expect(readTeamRecordMetadata(metadata).record_started_at).toBe(1000)
  expect(readTeamRecordMetadata({...metadata,capture_context:{...metadata.capture_context,network_name:'SSID',electric:0,charge:1}}).capture_context).toMatchObject({network_name:'SSID',electric:0,charge:1})
  expect(()=>readTeamRecordMetadata({...metadata,capture_context:{...metadata.capture_context,electric:101}})).toThrow()
  expect(()=>readTeamRecordMetadata({...metadata,send_at:999})).toThrow()
  expect(()=>readTeamRecordMetadata({...metadata,capture_context:{...metadata.capture_context,automatic_location:{lat:0,lon:0,captured_at:900}}})).toThrow()
})

it('retains capture outcomes separately without presenting missing locations as data',()=>{
 const value=decodeTeamMessageSnapshot({schema_version:1,recorded:true,version:1,snapshot_version:1,capture_context:{schema_version:1,captured_at:1000,device_state:'unavailable',location_state:'permission_denied'}},'opaque')
 expect(value.captureStates).toEqual({device:'unavailable',location:'permission_denied'})
 expect(value.detail.locationCapture).toBeUndefined();expect(value.detail.locationLabel).toBeUndefined()
})

it('projects recorded environment using the ordinary Record formatters',()=>{
 const value=decodeTeamMessageSnapshot({schema_version:1,version:1,snapshot_version:1,send_at:1793360000000,view_times:0,share_times:2,capture_context:{client_name:'Arkme device',network_name:'WiFi',electric:0,charge:1,automatic_location:{lat:30,lon:114,captured_at:1793360000000,alt:-20,speed:0}},position_detail:{city:'武汉市',county:'洪山区',road:'高新大道',poi:'停车场'},weather:{temp:18.4,condition_ch:'阴天'}},'opaque');
 expect(value.detail).toMatchObject({viewTimes:0,shareTimes:2,weather:'18° 阴天',altitudeMeters:-20,movement:'静止',locationLabel:'武汉·洪山高新大道停车场',captureContext:{clientName:'Arkme device',networkName:'WiFi',electric:0,charge:1}})
 expect(value.detail.belongDate).toBeTruthy()
})
