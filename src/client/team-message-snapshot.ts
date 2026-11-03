import type {ArkmeRecordCaptureContext, ArkmeRecordLocationCapture} from '../types.js'
import type { TeamCaptureContext, TeamEditMetadata, TeamRecordMetadata } from '../team-snapshot-contract.js'
import { callArkme } from './api.js'

export interface PreparedTeamCapture { protocolVersion: 0 | 1; metadataRef?: string; notice?: string }
export async function prepareTeamCapture(input: { accountKey: string; conversationRef: string; operationUid: string; completeAt: number; startedAt?: number; messageRef?: string; context?: ArkmeRecordCaptureContext; location?: ArkmeRecordLocationCapture }, signal: AbortSignal): Promise<PreparedTeamCapture> {
  let protocolVersion: 0 | 1 = 0
  try {
    const capability = await callArkme<{schemaVersion:0|1;recordPropertiesVersion:0|1}>('team.app.snapshot.capabilities', {expectedAccountKey:input.accountKey}, signal)
    signal.throwIfAborted()
    if (capability?.schemaVersion !== 1 || capability.recordPropertiesVersion !== 1) return {protocolVersion,notice:'本次消息未保存记忆快照，服务暂不支持。'}
    protocolVersion = 1
    const context = input.context ?? {}
    const capture: TeamCaptureContext = {schema_version:1,captured_at:input.completeAt,device_state:'unavailable',location_state:'not_recorded'}
    const location = input.location
    if (location && location.capturedAtMillis <= input.completeAt) {
      capture.location_state='recorded'
      capture.automatic_location={lat:location.latitude,lon:location.longitude,captured_at:location.capturedAtMillis,...(location.accuracyMeters===undefined?{}:{accuracy_meters:location.accuracyMeters}),...(location.altitudeMeters===undefined?{}:{alt:location.altitudeMeters}),...(location.speedMetersPerSecond===undefined?{}:{speed:location.speedMetersPerSecond})}
    }
    signal.throwIfAborted()
    capture.device_state = context.clientName?.trim() ? 'recorded' : 'unavailable'
    if (context.clientName) capture.client_name = context.clientName
    if (context.networkName) capture.network_name = context.networkName
    if (context.electric !== undefined) capture.electric = context.electric
    if (context.charge !== undefined) capture.charge = context.charge
    const start = typeof input.startedAt==='number' && Number.isSafeInteger(input.startedAt) && input.startedAt>0 && input.startedAt<=input.completeAt ? input.startedAt : undefined
    const metadata: TeamRecordMetadata | TeamEditMetadata = input.messageRef
      ? {revision_uid:input.operationUid,revision_edit_at:input.completeAt,...(start===undefined?{}:{edit_duration_millis:input.completeAt-start}),edit_capture_context:capture}
      : {...(start===undefined?{}:{record_started_at:start}),send_at:input.completeAt,capture_context:capture}
    const sealed = await callArkme<{metadataRef:string}>('team.app.snapshot.seal',{expectedAccountKey:input.accountKey,conversationRef:input.conversationRef,operationUid:input.operationUid,kind:input.messageRef?'edit':'send',...(input.messageRef?{messageRef:input.messageRef}:{}),metadata},signal)
    if (!sealed?.metadataRef) throw new Error('capture seal unavailable')
    return {protocolVersion,metadataRef:sealed.metadataRef}
  } catch(error) {
    signal.throwIfAborted()
    return {protocolVersion,notice:'本次消息未保存记忆快照，采集或本机保存暂不可用。'}
  }
}
